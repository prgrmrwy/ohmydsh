import { createHash } from 'node:crypto'
import { credentialRef, type CredentialProvider, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  MAX_LINES, SettingsStore, isAccessMode, normalizeBaseUrl, validateLoadedLines, validatePendingCredentials,
  type AccessMode, type CredentialField, type LineSettings, type PendingCredential, type Settings,
} from './settings.js'
import { GatewayTransport, validateIdentity, type ConnectionIdentity } from './transport.js'
import { LineSelector, type Probe } from './selection.js'
import { mapCatalog, type CatalogModel } from './catalog.js'

export type Credentials = Pick<CredentialProvider, 'describe' | 'resolve' | 'set' | 'unset'>

/** Credential references bound to a line's stable random id. */
export function lineCredentialRefs(lineId: string): Record<CredentialField, CredentialRef> {
  const upper = lineId.toUpperCase()
  return {
    key: credentialRef(`MAGPIE_LINE_${upper}_API_KEY`),
    accessClientId: credentialRef(`MAGPIE_LINE_${upper}_ACCESS_CLIENT_ID`),
    accessClientSecret: credentialRef(`MAGPIE_LINE_${upper}_ACCESS_CLIENT_SECRET`),
  }
}
/** Inverse of {@link lineCredentialRefs} for credential-update events; undefined = not a line ref. */
export function lineIdOfCredentialRef(ref: unknown): string | undefined {
  const match = /^MAGPIE_LINE_([0-9A-F]{8})_(?:API_KEY|ACCESS_CLIENT_ID|ACCESS_CLIENT_SECRET)$/.exec(String(ref))
  return match ? match[1]!.toLowerCase() : undefined
}

export interface Generation {
  id: number
  lineId: string
  baseUrl: string
  accessMode: AccessMode
  keyFingerprint: string
  catalog: CatalogModel[]
  bgAbort: AbortController
  syncPromise?: Promise<void>
  lastSyncAt?: string
  lastSyncError?: string
  lastSyncErrorKind?: string
  [key: string]: unknown
}
export interface Operation extends ConnectionIdentity { gen: Generation; release(): void }
export interface RuntimeOptions {
  probe?: Probe
  now?: () => number
  /** Deterministic id seam for tests; defaults to 8 random hex chars. */
  newId?: (existing: readonly string[]) => string
}
interface ResolvedLine {
  line: LineSettings
  key: string
  accessClientId: string
  accessClientSecret: string
  complete: boolean
}
interface LoadedConfig { lines: LineSettings[]; pending: PendingCredential[] }
type CredentialStatus = { configured: boolean; writable: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const emptyGeneration = (): Generation => ({ id: 0, lineId: '', baseUrl: '', accessMode: 'direct', keyFingerprint: '', catalog: [], bgAbort: new AbortController() })
const randomHexId = (existing: readonly string[]): string => {
  const taken = new Set(existing.map(id => id.toLowerCase()))
  for (;;) { const id = require('node:crypto').randomBytes(4).toString('hex') as string; if (!taken.has(id)) return id }
}
const CONNECTION_FIELDS: CredentialField[] = ['key', 'accessClientId', 'accessClientSecret']

/**
 * Host half of the connector, single-schema (BREAKING) design. Owns the ordered
 * line list, the active-line identity (line id + address + access mode + that
 * line's credential fingerprint) and the generation that guards stale results.
 * Legacy `baseUrl` settings and legacy fixed credential refs are intentionally
 * not read or migrated.
 */
export class MagpieRuntime {
  current: Generation = emptyGeneration()
  readonly transport = new GatewayTransport()
  readonly selector: LineSelector
  private activeKeys = new Map<string, number>()
  private prepared = new Set<WeakRef<Operation>>()
  private currentSecrets: string[] = []
  private failedFields: PendingCredential[] = []
  private retained: PendingCredential[] = []
  private updating = false
  private disposed = false
  private saving = false
  private readonly newId: (existing: readonly string[]) => string
  selectedLineId: string | null = null
  constructor(readonly credentials: Credentials, readonly store = new SettingsStore(), readonly publish = () => {}, options: RuntimeOptions = {}) {
    this.selector = new LineSelector(options)
    this.transport.onConnectionFailure = lineId => this.selector.invalidate(lineId)
    this.newId = options.newId ?? randomHexId
    this.failedFields = this.loadConfig().pending
  }
  /** Strict load: any invalid persisted line/pending makes the whole connection read as empty. */
  private loadConfig(): LoadedConfig {
    try {
      return { lines: validateLoadedLines(this.store.value.lines), pending: validatePendingCredentials(this.store.value.credentialUpdatePending) }
    } catch { return { lines: [], pending: [] } }
  }
  private cleanSettings(lines: LineSettings[], pending?: PendingCredential[]): Settings {
    return { lines, visibleModels: this.store.value.visibleModels ?? {}, defaultEfforts: this.store.value.defaultEfforts ?? {}, ...(pending ? { credentialUpdatePending: pending } : {}) }
  }
  async start() { await this.syncCatalog() }
  trackPrepared(op: Operation): () => void {
    const ref = new WeakRef(op)
    this.prepared.add(ref)
    return () => { this.prepared.delete(ref) }
  }
  private async resolveLine(line: LineSettings): Promise<ResolvedLine> {
    const refs = lineCredentialRefs(line.id)
    const [key, accessClientId, accessClientSecret] = await Promise.all(Object.values(refs).map(async ref => (await this.credentials.resolve(ref))?.value ?? '')) as [string, string, string]
    return { line, key, accessClientId, accessClientSecret, complete: false }
  }
  private completeness(resolved: ResolvedLine): boolean {
    const { line, key, accessClientId, accessClientSecret } = resolved
    if (!line.baseUrl || !key) return false
    if (line.accessMode !== 'cloudflare') return true
    if (!accessClientId || !accessClientSecret) return false
    try { return new URL(line.baseUrl).protocol === 'https:' } catch { return false }
  }
  private rotate(lineId: string, baseUrl: string, accessMode: AccessMode, fingerprint: string, carry?: { catalog: CatalogModel[]; lastSyncAt?: string }) {
    this.current.bgAbort.abort()
    this.current = {
      id: this.current.id + 1, lineId, baseUrl, accessMode, keyFingerprint: fingerprint,
      catalog: carry?.catalog ? [...carry.catalog] : [], bgAbort: new AbortController(),
      ...(carry?.lastSyncAt ? { lastSyncAt: carry.lastSyncAt } : {}),
    }
    this.publish()
  }
  private identityOf(resolved: ResolvedLine | undefined): ConnectionIdentity {
    if (!resolved) return { lineId: '', baseUrl: '', accessMode: 'direct', key: '', accessClientId: '', accessClientSecret: '' }
    const { line, key, accessClientId, accessClientSecret } = resolved
    const cloudflare = line.accessMode === 'cloudflare'
    return { lineId: line.id, baseUrl: line.baseUrl, accessMode: line.accessMode, key, accessClientId: cloudflare ? accessClientId : '', accessClientSecret: cloudflare ? accessClientSecret : '' }
  }
  private fingerprintOf(identity: ConnectionIdentity): string {
    if (!identity.lineId && !identity.baseUrl && !identity.key) return ''
    const material = [identity.lineId, identity.baseUrl, identity.accessMode, identity.key, identity.accessClientId ?? '', identity.accessClientSecret ?? '']
    return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16)
  }
  /** Resolve every configured line, then pick the first reachable complete one. */
  private async selectActive(): Promise<{ lines: ResolvedLine[]; active: ResolvedLine | undefined }> {
    const config = this.loadConfig()
    const lines = await Promise.all(config.lines.map(line => this.resolveLine(line)))
    for (const resolved of lines) resolved.complete = this.completeness(resolved)
    const complete = lines.filter(line => line.complete)
    this.currentSecrets = lines.flatMap(line => [line.key, line.accessClientId, line.accessClientSecret]).filter(Boolean)
    const picked = await this.selector.select(complete.map(line => line.line))
    const active = picked ? complete.find(line => line.line.id === picked.id && line.line.baseUrl === picked.baseUrl) : undefined
    this.selectedLineId = active ? active.line.id : null
    return { lines, active }
  }
  invalidateCredential(ref?: unknown) {
    if (this.disposed) return
    if (ref !== undefined) {
      const lineId = lineIdOfCredentialRef(ref)
      if (lineId === undefined) return
      if (lineId !== this.current.lineId) return
    }
    this.rotate(this.current.lineId, this.current.baseUrl, this.current.accessMode, '!invalidated')
    if (!this.saving) void this.syncCatalog().catch(() => {})
  }
  async beginOperation(): Promise<Operation> {
    if (this.disposed) throw new Error('MAGPIE_DISPOSED')
    const snapshot = this.current
    if (this.failedFields.length) throw new Error('MAGPIE_SETTINGS_WRITE_FAILED')
    if (this.saving) throw new Error('MAGPIE_SETTINGS_UPDATING')
    const { active } = await this.selectActive()
    if (this.disposed) throw new Error('MAGPIE_DISPOSED')
    if (this.failedFields.length) throw new Error('MAGPIE_SETTINGS_WRITE_FAILED')
    if (this.saving) throw new Error('MAGPIE_SETTINGS_UPDATING')
    if (snapshot !== this.current) return this.beginOperation()
    const identity = this.identityOf(active)
    const fingerprint = this.fingerprintOf(identity)
    const changed = this.current.lineId !== identity.lineId || this.current.baseUrl !== identity.baseUrl || this.current.keyFingerprint !== fingerprint
    if (changed) {
      const lineSwitch = !!this.current.lineId && !!identity.lineId && this.current.lineId !== identity.lineId
      const carry = lineSwitch ? { catalog: this.current.catalog, ...(this.current.lastSyncAt ? { lastSyncAt: this.current.lastSyncAt } : {}) } : undefined
      this.rotate(identity.lineId ?? '', identity.baseUrl ?? '', identity.accessMode ?? 'direct', fingerprint, carry)
    }
    validateIdentity(identity)
    const op = { ...identity, gen: this.current, release: this.retainIdentity(identity) }
    if (changed && op.key && op.gen.baseUrl) void this.syncGeneration(op.gen, op)
    return op
  }
  retainIdentity(identity: ConnectionIdentity): () => void {
    const releases = [identity.key, identity.accessClientId ?? '', identity.accessClientSecret ?? ''].map(value => this.retainKey(value))
    return () => { for (const release of releases) release() }
  }
  retainKey(key: string): () => void {
    if (key) this.activeKeys.set(key, (this.activeKeys.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released || !key) return
      released = true
      const count = (this.activeKeys.get(key) ?? 1) - 1
      if (count > 0) this.activeKeys.set(key, count)
      else this.activeKeys.delete(key)
    }
  }
  isCurrent(gen: Generation) { return !this.disposed && gen === this.current }
  redact(text: string) {
    const preparedKeys: string[] = []
    for (const ref of this.prepared) {
      const op = ref.deref()
      if (op) preparedKeys.push(op.key, op.accessClientId ?? '', op.accessClientSecret ?? '')
      else this.prepared.delete(ref)
    }
    for (const key of [...new Set([...this.currentSecrets, ...this.activeKeys.keys(), ...preparedKeys])].sort((a, b) => b.length - a.length)) if (key) text = text.split(key).join('[redacted]')
    return text
  }
  redactJson(value: unknown): unknown {
    if (typeof value === 'string') return this.redact(value)
    if (Array.isArray(value)) return value.map(item => this.redactJson(item))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.redact(key), this.redactJson(item)]))
    return value
  }
  formatErrorBody(text: string): string {
    try { return JSON.stringify(this.redactJson(JSON.parse(text))) }
    catch { return this.redact(text) }
  }
  async syncCatalog() {
    const op = await this.beginOperation()
    try { await this.syncGeneration(op.gen, op) } finally { op.release() }
  }
  private syncGeneration(gen: Generation, identity: ConnectionIdentity): Promise<void> {
    if (gen.syncPromise) return gen.syncPromise
    if (!gen.baseUrl || !identity.key || !this.isCurrent(gen)) return Promise.resolve()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const release = this.retainIdentity(identity)
    gen.syncPromise = (async () => {
      let httpError: string | undefined
      try {
        const response = await this.transport.request(identity, 'GET', '/models', { signal: AbortSignal.any([gen.bgAbort.signal, controller.signal]) })
        if (!response.ok) {
          httpError = `HTTP ${response.status}: ${this.formatErrorBody(await response.text())}`
          const error = new Error(httpError)
          Object.assign(error, { status: response.status }); throw error
        }
        const catalog = mapCatalog(JSON.parse(JSON.stringify(await response.json()), (_key, value) => typeof value === 'string' ? this.redact(value) : value))
        if (!this.isCurrent(gen)) return
        gen.catalog = catalog; gen.lastSyncAt = new Date().toISOString(); delete gen.lastSyncError; delete gen.lastSyncErrorKind; this.publish()
      } catch (error) {
        if (!this.isCurrent(gen)) return
        const status = (error as { status?: number }).status
        gen.lastSyncError = httpError ?? this.redact(error instanceof Error ? error.message : String(error))
        gen.lastSyncErrorKind = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status ? 'http' : 'unreachable'
      } finally {
        clearTimeout(timer); delete gen.syncPromise
        release()
      }
    })()
    return gen.syncPromise
  }

  // ---- settings surface ---------------------------------------------------

  async settings(body?: unknown): Promise<Response> {
    if (body !== undefined) {
      if (this.updating) return Response.json({ error: 'MAGPIE_SETTINGS_UPDATING' }, { status: 409 })
      this.updating = true
      try {
        if (!isRecord(body)) throw new Error('Invalid settings')
        if (Object.keys(body).some(key => !['lines', 'resync'].includes(key))) throw new Error('Invalid settings')
        if ('resync' in body && body.resync !== true) throw new Error('Invalid resync')
        if (!('lines' in body)) {
          if (body.resync !== true) throw new Error('Invalid settings')
          await this.syncCatalog()
          return this.settingsView()
        }
        if (!Array.isArray(body.lines)) throw new Error('Invalid lines')
        const response = await this.updateLines(body.lines)
        if (body.resync === true && response.ok) await this.syncCatalog()
        return response
      } catch (error) {
        const message = this.redact(error instanceof Error ? error.message : String(error))
        const status = message.includes('MAGPIE_SETTINGS_WRITE_FAILED') || message.includes('MAGPIE_SETTINGS_UPDATING') ? 409 : 400
        return Response.json({ error: message }, { status })
      } finally { this.updating = false }
    }
    return this.settingsView()
  }

  /** Structured line-list update: the only settings write path (BREAKING schema). */
  private async updateLines(requested: unknown[]): Promise<Response> {
    if (requested.length === 0 || requested.length > MAX_LINES) throw new Error('Invalid lines')
    const config = this.loadConfig()
    const existing = config.lines
    const byId = new Map(existing.map(line => [line.id, line]))
    const takenIds = [...existing.map(line => line.id), ...this.failedFields.map(entry => entry.lineId)]
    const seen = new Set<string>()
    const nextLines: LineSettings[] = []
    const writes: { lineId: string; field: CredentialField; value: string | null }[] = []
    const provided = new Set<string>()
    for (const entry of requested) {
      if (!isRecord(entry)) throw new Error('Invalid line')
      let lineId: string
      if (entry.id === undefined) {
        lineId = this.newId(takenIds)
        if (!/^[0-9a-f]{8}$/.test(lineId)) throw new Error('Invalid line id')
        takenIds.push(lineId)
      } else {
        if (typeof entry.id !== 'string' || !byId.has(entry.id)) throw new Error('Invalid line id')
        lineId = entry.id
      }
      if (seen.has(lineId)) throw new Error('Duplicate line id')
      seen.add(lineId)
      const previous = byId.get(lineId)
      const baseUrl = 'baseUrl' in entry ? (entry.baseUrl === '' ? '' : normalizeBaseUrl(entry.baseUrl)) : previous?.baseUrl ?? ''
      const accessMode = 'accessMode' in entry ? entry.accessMode : previous?.accessMode ?? 'direct'
      if (!isAccessMode(accessMode)) throw new Error('Invalid accessMode')
      nextLines.push({ id: lineId, baseUrl, accessMode })
      for (const field of CONNECTION_FIELDS) {
        if (!(field in entry)) continue
        const value = entry[field]
        if (value !== null && (typeof value !== 'string' || !value || value.length > 512 || /[^\x21-\x7e]/.test(value))) throw new Error(`Invalid ${field}`)
        writes.push({ lineId, field, value: value as string | null })
        provided.add(`${lineId}:${field}`)
      }
    }
    const nonEmpty = nextLines.map(line => line.baseUrl).filter(Boolean)
    if (new Set(nonEmpty).size !== nonEmpty.length) throw new Error('Invalid baseUrl')
    // Pending writes for lines that still exist must be retried explicitly.
    for (const entry of this.failedFields) {
      if (nextLines.some(line => line.id === entry.lineId) && !provided.has(`${entry.lineId}:${entry.field}`)) {
        return Response.json({ error: 'MAGPIE_SETTINGS_WRITE_FAILED: retry all failed credential fields explicitly' }, { status: 409 })
      }
    }
    for (const write of writes) {
      const ref = lineCredentialRefs(write.lineId)[write.field]
      if (!(await this.credentials.describe(ref)).writable) return Response.json({ error: 'Credential comes from the startup environment and is read-only' }, { status: 409 })
    }
    for (const write of writes) {
      if (write.value === null || write.field === 'key') continue
      const line = nextLines.find(candidate => candidate.id === write.lineId)
      if (line?.accessMode === 'direct') throw new Error('MAGPIE_ACCESS_DIRECT_REJECTED')
    }
    for (const line of nextLines) {
      const previous = byId.get(line.id)
      if (!previous || previous.accessMode === line.accessMode) continue
      const refs = lineCredentialRefs(line.id)
      const statuses = await Promise.all([this.credentials.describe(refs.accessClientId), this.credentials.describe(refs.accessClientSecret)])
      if (statuses.some(status => status.configured && !status.writable)) return Response.json({ error: 'Credential comes from the startup environment and is read-only' }, { status: 409 })
    }
    for (const line of nextLines) {
      if (line.accessMode !== 'cloudflare') continue
      if (!line.baseUrl.startsWith('https:')) throw new Error('MAGPIE_ACCESS_HTTPS_REQUIRED')
      const supplied = new Map(writes.filter(write => write.lineId === line.id).map(write => [write.field, write.value]))
      const resolved = await this.resolveLine(byId.get(line.id) ?? line)
      const effective = (field: 'accessClientId' | 'accessClientSecret') => {
        if (supplied.has(field)) return supplied.get(field) ?? ''
        return resolved[field]
      }
      if (!effective('accessClientId') || !effective('accessClientSecret')) throw new Error('MAGPIE_ACCESS_PAIR_REQUIRED')
    }
    const removed = existing.filter(line => !seen.has(line.id))
    const cleanup: PendingCredential[] = [
      ...this.failedFields.filter(entry => !nextLines.some(line => line.id === entry.lineId)),
      ...removed.flatMap(line => CONNECTION_FIELDS.map(field => ({ lineId: line.id, field }))),
    ]
    const pending: PendingCredential[] = [
      ...writes.map(write => ({ lineId: write.lineId, field: write.field })),
      ...cleanup,
    ]
    const retained: PendingCredential[] = []
    this.saving = true
    try {
      // Marker saves keep the committed line list; a failed write must not apply the new lines.
      if (pending.length) this.store.save(this.cleanSettings(existing, pending))
      for (const write of writes) {
        const ref = lineCredentialRefs(write.lineId)[write.field]
        if (write.value === null) await this.credentials.unset(ref)
        else await this.credentials.set(ref, write.value)
      }
      for (const entry of cleanup) {
        const ref = lineCredentialRefs(entry.lineId)[entry.field]
        const status = await this.credentials.describe(ref)
        if (!status.configured) continue
        if (!status.writable) { retained.push(entry); continue }
        await this.credentials.unset(ref)
      }
      this.retained = retained
      this.store.save(this.cleanSettings(nextLines))
      this.failedFields = []
    } catch {
      this.failedFields = pending
      this.invalidateCredential()
      return Response.json({ error: 'MAGPIE_SETTINGS_WRITE_FAILED: credentials may be partially updated; reread settings and retry the complete connection' }, { status: 500 })
    } finally { this.saving = false }
    await this.reconcileActiveLine()
    return this.settingsView()
  }

  /** Sync only when the active identity changed (the caller may also ask for a resync). */
  private async reconcileActiveLine() {
    const { active } = await this.selectActive()
    const identity = this.identityOf(active)
    const fingerprint = this.fingerprintOf(identity)
    const changed = this.current.lineId !== identity.lineId || this.current.baseUrl !== identity.baseUrl || this.current.keyFingerprint !== fingerprint
    if (changed) await this.syncCatalog()
  }
  private retainedNow(lines: LineSettings[]): PendingCredential[] {
    const currentIds = new Set(lines.map(line => line.id))
    return this.retained.filter(entry => currentIds.has(entry.lineId) || entry.lineId === '' ? false : true)
  }
  private async settingsView(): Promise<Response> {
    const config = this.loadConfig()
    const lines = await Promise.all(config.lines.map(line => this.resolveLine(line)))
    for (const resolved of lines) resolved.complete = this.completeness(resolved)
    this.currentSecrets = lines.flatMap(line => [line.key, line.accessClientId, line.accessClientSecret]).filter(Boolean)
    let active: ResolvedLine | undefined
    if (!this.failedFields.length) {
      const complete = lines.filter(line => line.complete)
      const picked = await this.selector.select(complete.map(line => line.line))
      active = picked ? complete.find(line => line.line.id === picked.id && line.line.baseUrl === picked.baseUrl) : undefined
      this.selectedLineId = active ? active.line.id : null
    } else { active = lines.find(line => line.line.id === this.current.lineId) }
    const status = (value: { configured: boolean; writable: boolean }): CredentialStatus => ({ configured: value.configured, writable: value.writable })
    const viewLines = await Promise.all(lines.map(async resolved => {
      const refs = lineCredentialRefs(resolved.line.id)
      const [key, clientId, clientSecret] = await Promise.all(Object.values(refs).map(ref => this.credentials.describe(ref)))
      return {
        id: resolved.line.id, baseUrl: resolved.line.baseUrl, accessMode: resolved.line.accessMode, complete: resolved.complete,
        key: status(key!), access: { clientId: status(clientId!), clientSecret: status(clientSecret!) },
        refs: { key: String(refs.key), accessClientId: String(refs.accessClientId), accessClientSecret: String(refs.accessClientSecret) },
      }
    }))
    const gen = this.current
    return Response.json(this.redactJson({
      lines: viewLines, activeLineId: active?.line.id ?? null,
      pending: this.failedFields, retainedCredentials: this.retainedNow(config.lines),
      lastSyncAt: gen.lastSyncAt, lastSyncError: gen.lastSyncError, lastSyncErrorKind: gen.lastSyncErrorKind,
      groups: [...new Set(gen.catalog.map(m => m.provider))].map(provider => ({ provider, models: gen.catalog.filter(m => m.provider === provider).map(m => ({ id: m.info.id, name: m.info.name, efforts: m.efforts })) })),
      visibleModels: this.store.value.visibleModels, defaultEfforts: this.store.value.defaultEfforts,
    }))
  }
  /** Preference-only writes also persist the single clean schema (drops legacy fields). */
  savePreferences(patch: { visibleModels?: Record<string, string[]>; defaultEfforts?: Record<string, string> }) {
    const config = this.loadConfig()
    this.store.save({
      lines: config.lines,
      visibleModels: patch.visibleModels ?? this.store.value.visibleModels ?? {},
      defaultEfforts: patch.defaultEfforts ?? this.store.value.defaultEfforts ?? {},
      ...(this.failedFields.length ? { credentialUpdatePending: this.failedFields } : {}),
    })
  }
  config(): LineSettings[] { return this.loadConfig().lines }
  async dispose() { this.disposed = true; this.current.bgAbort.abort(); this.selector.dispose(); await this.transport.dispose() }
}

