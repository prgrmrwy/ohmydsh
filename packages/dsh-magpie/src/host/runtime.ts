import { createHash } from 'node:crypto'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SettingsStore, normalizeBaseUrl } from './settings.js'
import { GatewayTransport, validateIdentity, type ConnectionIdentity } from './transport.js'
import { mapCatalog, type CatalogModel } from './catalog.js'
export const KEY_REF = credentialRef('MAGPIE_API_KEY')
export const ACCESS_CLIENT_ID_REF = credentialRef('MAGPIE_ACCESS_CLIENT_ID')
export const ACCESS_CLIENT_SECRET_REF = credentialRef('MAGPIE_ACCESS_CLIENT_SECRET')
const credentialFields = { key: KEY_REF, accessClientId: ACCESS_CLIENT_ID_REF, accessClientSecret: ACCESS_CLIENT_SECRET_REF } as const
export type Credentials = Pick<CredentialProvider, 'describe' | 'resolve' | 'set' | 'unset'>
export interface Generation { id: number; baseUrl: string; keyFingerprint: string; catalog: CatalogModel[]; bgAbort: AbortController; syncPromise?: Promise<void>; lastSyncAt?: string; lastSyncError?: string; lastSyncErrorKind?: string; [key: string]: unknown }
export interface Operation extends ConnectionIdentity { gen: Generation; release(): void }
export class MagpieRuntime {
  current: Generation = { id: 0, baseUrl: '', keyFingerprint: '', catalog: [], bgAbort: new AbortController() }
  readonly transport = new GatewayTransport()
  private activeKeys = new Map<string, number>()
  private prepared = new Set<WeakRef<Operation>>()
  trackPrepared(op: Operation): () => void {
    const ref = new WeakRef(op)
    this.prepared.add(ref)
    return () => { this.prepared.delete(ref) }
  }
  private currentSecrets: string[] = []
  private updating = false
  private disposed = false
  private saving = false
  private failedFields: string[] = []
  constructor(readonly credentials: Credentials, readonly store = new SettingsStore(), readonly publish = () => {}) {
    const pending = store.value.credentialUpdatePending
    this.failedFields = pending === undefined ? [] : Array.isArray(pending) && pending.length > 0 && pending.every(field => Object.hasOwn(credentialFields, field)) ? [...pending] : Object.keys(credentialFields)
  }
  async start() { await this.syncCatalog() }
  private rotate(baseUrl: string, fingerprint: string) {
    this.current.bgAbort.abort()
    this.current = { id: this.current.id + 1, baseUrl, keyFingerprint: fingerprint, catalog: [], bgAbort: new AbortController() }
    this.publish()
  }
  invalidateCredential() {
    if (this.disposed) return
    this.rotate(this.store.value.baseUrl, '!invalidated')
    // Own writes still invalidate synchronously; defer only discovery until commit.
    if (!this.saving) void this.syncCatalog().catch(() => {})
  }
  async beginOperation(): Promise<Operation> {
    if (this.disposed) throw new Error('MAGPIE_DISPOSED')
    const snapshot = this.current
    if (this.failedFields.length) throw new Error('MAGPIE_SETTINGS_WRITE_FAILED')
    if (this.saving) throw new Error('MAGPIE_SETTINGS_UPDATING')
    const [key, accessClientId, accessClientSecret] = await Promise.all(Object.values(credentialFields).map(async ref => (await this.credentials.resolve(ref))?.value ?? '')) as [string, string, string]
    if (this.disposed) throw new Error('MAGPIE_DISPOSED')
    // A newer resolution/event must win over a resolve started before it.
    if (this.failedFields.length) throw new Error('MAGPIE_SETTINGS_WRITE_FAILED')
    if (this.saving) throw new Error('MAGPIE_SETTINGS_UPDATING')
    if (snapshot !== this.current) return this.beginOperation()
    const identity = { baseUrl: this.store.value.baseUrl, key, accessClientId, accessClientSecret }
    this.currentSecrets = [key, accessClientId, accessClientSecret]
    const fingerprint = this.currentSecrets.some(Boolean) ? createHash('sha256').update(JSON.stringify(this.currentSecrets)).digest('hex').slice(0, 16) : ''
    const changed = this.current.baseUrl !== identity.baseUrl || this.current.keyFingerprint !== fingerprint
    if (changed) this.rotate(identity.baseUrl, fingerprint)
    validateIdentity(identity)
    const op = { ...identity, gen: this.current, release: this.retainIdentity(identity) }
    if (changed && key && op.gen.baseUrl) void this.syncGeneration(op.gen, op)
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
  async settings(body?: unknown): Promise<Response> {
    if (body !== undefined) {
      try {
        if (this.updating) return Response.json({error:'MAGPIE_SETTINGS_UPDATING'}, {status:409})
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['baseUrl','key','accessClientId','accessClientSecret','resync'].includes(k))) throw new Error('Invalid settings')
        const update = body as Record<string, unknown>
        const baseUrl = 'baseUrl' in update ? normalizeBaseUrl(update.baseUrl) : this.store.value.baseUrl
        const fields = Object.keys(credentialFields) as (keyof typeof credentialFields)[]
        if (this.failedFields.some(field => !(field in update))) return Response.json({error:'MAGPIE_SETTINGS_WRITE_FAILED: retry all failed credential fields explicitly'}, {status:409})
        for (const field of fields) {
          const value = update[field]
          if (field in update && value !== null && (typeof value !== 'string' || !value || value.length > 512 || /[^\x21-\x7e]/.test(value))) throw new Error(`Invalid ${field}`)
        }
        if ('resync' in update && update.resync !== true) throw new Error('Invalid resync')
        this.updating = true
        try {
          for (const field of fields) if (field in update && !(await this.credentials.describe(credentialFields[field])).writable) return Response.json({error:'Credential comes from the startup environment and is read-only'}, {status:409})
          const values = await Promise.all(fields.map(async field => field in update ? update[field] as string | null : (await this.credentials.resolve(credentialFields[field]))?.value ?? ''))
          validateIdentity({baseUrl, key:values[0] ?? '', accessClientId:values[1] ?? '', accessClientSecret:values[2] ?? ''})
          // Credential writes are not transactional: keep the old URL and invalidate on any write failure.
          this.saving = true
          try {
            const attempted = fields.filter(field => field in update)
            // Persist the non-secret quarantine before any credential mutation, including crash/restart.
            if (attempted.length) this.store.save({ ...this.store.value, credentialUpdatePending: attempted })
            for (const field of fields) if (field in update) {
              if (update[field] === null) await this.credentials.unset(credentialFields[field])
              else await this.credentials.set(credentialFields[field], update[field] as string)
            }
            const { credentialUpdatePending: _pending, ...cleanSettings } = this.store.value
            this.store.save({ ...cleanSettings, baseUrl })
            this.failedFields = []
          } catch {
            this.failedFields = fields.filter(field => field in update)
            this.invalidateCredential()
            return Response.json({error:'MAGPIE_SETTINGS_WRITE_FAILED: credentials may be partially updated; reread settings and retry the complete connection'}, {status:500})
          } finally { this.saving = false }
          await this.syncCatalog()
        } finally { this.updating = false }
      } catch (error) { return Response.json({ error: this.redact(error instanceof Error ? error.message : String(error)) }, { status:400 }) }
    }
    const [key, clientId, clientSecret] = await Promise.all(Object.values(credentialFields).map(ref => this.credentials.describe(ref)))
    const secrets = await Promise.all(Object.values(credentialFields).map(async ref => (await this.credentials.resolve(ref))?.value ?? ''))
    this.currentSecrets = secrets
    const status = (value: {configured:boolean;writable:boolean}) => ({configured:value.configured,writable:value.writable})
    const gen = this.current
    return Response.json(this.redactJson({ baseUrl: this.store.value.baseUrl, key: status(key!), access: {clientId:status(clientId!),clientSecret:status(clientSecret!)},
      lastSyncAt: gen.lastSyncAt, lastSyncError: gen.lastSyncError, lastSyncErrorKind: gen.lastSyncErrorKind,
      groups: [...new Set(gen.catalog.map(m=>m.provider))].map(provider=>({provider,models:gen.catalog.filter(m=>m.provider===provider).map(m=>({id:m.info.id,name:m.info.name,efforts:m.efforts}))})),
      visibleModels: this.store.value.visibleModels, defaultEfforts: this.store.value.defaultEfforts,
    }))
  }
  async dispose() { this.disposed = true; this.current.bgAbort.abort(); await this.transport.dispose() }
}
