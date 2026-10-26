import { createHash } from 'node:crypto'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SettingsStore, normalizeBaseUrl } from './settings.js'
import { GatewayTransport } from './transport.js'
import { mapCatalog, type CatalogModel } from './catalog.js'
export const KEY_REF = credentialRef('MAGPIE_API_KEY')
export type Credentials = Pick<CredentialProvider, 'describe' | 'resolve' | 'set' | 'unset'>
export interface Generation { id: number; baseUrl: string; keyFingerprint: string; catalog: CatalogModel[]; bgAbort: AbortController; syncPromise?: Promise<void>; lastSyncAt?: string; lastSyncError?: string; lastSyncErrorKind?: string; [key: string]: unknown }
export interface Operation { gen: Generation; key: string; release(): void }
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
  private currentKey = ''
  private disposed = false
  private saving = false
  constructor(readonly credentials: Credentials, readonly store = new SettingsStore(), readonly publish = () => {}) {}
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
    const key = (await this.credentials.resolve(KEY_REF))?.value ?? ''
    if (this.disposed) throw new Error('MAGPIE_DISPOSED')
    // A newer resolution/event must win over a resolve started before it.
    if (snapshot !== this.current) return this.beginOperation()
    const fingerprint = key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : ''
    const changed = this.current.baseUrl !== this.store.value.baseUrl || this.current.keyFingerprint !== fingerprint
    this.currentKey = key
    if (changed) this.rotate(this.store.value.baseUrl, fingerprint)
    const op = { gen: this.current, key, release: this.retainKey(key) }
    if (changed && key && op.gen.baseUrl) void this.syncGeneration(op.gen, key)
    return op
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
      if (op) preparedKeys.push(op.key)
      else this.prepared.delete(ref)
    }
    for (const key of new Set([this.currentKey, ...this.activeKeys.keys(), ...preparedKeys])) if (key) text = text.split(key).join('[redacted]')
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
    try { await this.syncGeneration(op.gen, op.key) } finally { op.release() }
  }
  private syncGeneration(gen: Generation, key: string): Promise<void> {
    if (gen.syncPromise) return gen.syncPromise
    if (!gen.baseUrl || !key || !this.isCurrent(gen)) return Promise.resolve()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    this.activeKeys.set(key, (this.activeKeys.get(key) ?? 0) + 1)
    gen.syncPromise = (async () => {
      let httpError: string | undefined
      try {
        const response = await this.transport.request({ baseUrl: gen.baseUrl, key }, 'GET', '/models', { signal: AbortSignal.any([gen.bgAbort.signal, controller.signal]) })
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
        const count = (this.activeKeys.get(key) ?? 1) - 1
        if (count) this.activeKeys.set(key, count); else this.activeKeys.delete(key)
      }
    })()
    return gen.syncPromise
  }
  async settings(body?: unknown): Promise<Response> {
    if (body !== undefined) {
      try {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['baseUrl','key','resync'].includes(k))) throw new Error('Invalid settings')
        const update = body as { baseUrl?: unknown; key?: unknown; resync?: unknown }
        const baseUrl = update.baseUrl === undefined ? this.store.value.baseUrl : normalizeBaseUrl(update.baseUrl)
        if ('key' in update && update.key !== null && (typeof update.key !== 'string' || !update.key || update.key.length > 512 || /\s/.test(update.key))) throw new Error('Invalid API key')
        if ('resync' in update && update.resync !== true) throw new Error('Invalid resync')
        if ('key' in update && !(await this.credentials.describe(KEY_REF)).writable) return Response.json({error:'该 key 来自启动环境，不可修改'}, {status:409})
        this.saving = true
        try {
          if ('key' in update) { if (update.key === null) await this.credentials.unset(KEY_REF); else await this.credentials.set(KEY_REF, update.key as string) }
          this.store.save({ ...this.store.value, baseUrl })
        } finally { this.saving = false }
        await this.syncCatalog()
      } catch (error) { return Response.json({ error: this.redact(error instanceof Error ? error.message : String(error)) }, { status:400 }) }
    }
    const key = await this.credentials.describe(KEY_REF)
    const gen = this.current
    return Response.json({ baseUrl: this.store.value.baseUrl, key: {configured:key.configured,writable:key.writable},
      lastSyncAt: gen.lastSyncAt, lastSyncError: gen.lastSyncError, lastSyncErrorKind: gen.lastSyncErrorKind,
      groups: [...new Set(gen.catalog.map(m=>m.provider))].map(provider=>({provider,models:gen.catalog.filter(m=>m.provider===provider).map(m=>({id:m.info.id,name:m.info.name,efforts:m.efforts}))})),
      visibleModels: this.store.value.visibleModels, defaultEfforts: this.store.value.defaultEfforts,
    })
  }
  async dispose() { this.disposed = true; this.current.bgAbort.abort(); await this.transport.dispose() }
}
