import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

export type UpdateState = 'newer' | 'up-to-date' | 'ahead-of-latest' | 'invalid-metadata' | 'network-error' | 'timeout' | 'check-disabled' | 'state-unwritable'
export type UpdateResult = { state: UpdateState; installed: string; available?: string }
type Cache = { checkedAt: number; version: string; failureUntil?: number }
const URL = 'https://registry.npmjs.org/@fission-ai%2Fopenspec/latest'
const TTL = 24 * 60 * 60_000
const BACKOFF = 15 * 60_000
const valid = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)
const compare = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1; return 0 }

export function createUpdateChecker(options: {
  stateDir: string
  installed: string
  fetch?: typeof fetch
  now?: () => number
  enabled?: boolean
  mkdir?: typeof mkdir
}) {
  const fetcher = options.fetch ?? fetch
  const ensureDirectory = options.mkdir ?? mkdir
  const now = options.now ?? Date.now
  let flight: Promise<UpdateResult> | undefined
  let unwritableUntil = 0
  async function readCache(): Promise<Cache | undefined> {
    try {
      const cache = JSON.parse(await readFile(join(options.stateDir, 'update-cache.json'), 'utf8'))
      if (!Number.isFinite(cache.checkedAt) || cache.checkedAt > now()) return undefined
      if (cache.failureUntil !== undefined) return cache.failureUntil > now() ? cache : undefined
      if (now() - cache.checkedAt < TTL && valid(cache.version)) return cache
    } catch { /* absent/corrupt cache */ }
    return undefined
  }
  async function writeCache(cache: Cache) {
    await ensureDirectory(options.stateDir, { recursive: true })
    const temp = join(options.stateDir, `.cache-${randomBytes(8).toString('hex')}.tmp`)
    await writeFile(temp, JSON.stringify(cache))
    await rename(temp, join(options.stateDir, 'update-cache.json'))
  }
  async function requestDocument(explicit: boolean): Promise<{ version?: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), explicit ? 10_000 : 2_000)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let abortListener: (() => void) | undefined
    try {
      const response = await fetcher(URL, { method: 'GET', redirect: 'error', signal: controller.signal })
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 65_536) {
        void response.body?.cancel().catch(() => {})
        throw new Error(response.ok ? 'invalid-metadata' : 'network-error')
      }
      if (!response.body) throw new Error('invalid-metadata')
      reader = response.body.getReader()
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new DOMException('aborted', 'AbortError'))
        controller.signal.addEventListener('abort', abortListener, { once: true })
        if (controller.signal.aborted) abortListener()
      })
      const chunks: Uint8Array[] = []
      let bytes = 0
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted])
        if (done) break
        bytes += value.byteLength
        if (bytes > 65_536) throw new Error('invalid-metadata')
        chunks.push(value)
      }
      try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) }
      catch { throw new Error('invalid-metadata') }
    } finally {
      clearTimeout(timer)
      if (abortListener) controller.signal.removeEventListener('abort', abortListener)
      // Cancellation must not wait for an unresponsive remote source's cancel hook.
      if (reader) void reader.cancel().catch(() => {})
    }
  }
  async function check({ explicit = false }: { explicit?: boolean } = {}): Promise<UpdateResult> {
    if (options.enabled === false) return { state: 'check-disabled', installed: options.installed }
    if (flight) return flight
    flight = (async () => {
      let cache = await readCache()
      if (!explicit && cache?.failureUntil !== undefined && cache.failureUntil > now()) {
        return { state: 'network-error', installed: options.installed }
      }
      if (!explicit && cache && valid(cache.version) && now() - cache.checkedAt < TTL) return result(cache.version)
      if (unwritableUntil > now()) return { state: 'state-unwritable', installed: options.installed }
      try { await ensureDirectory(options.stateDir, { recursive: true }) }
      catch {
        unwritableUntil = now() + BACKOFF
        try { await requestDocument(explicit) }
        catch { /* state cannot be persisted; expose only normalized state */ }
        return { state: 'state-unwritable', installed: options.installed }
      }
      let lock
      try {
        lock = await open(join(options.stateDir, 'update.lock'), 'wx')
      } catch (lockError) {
        try {
          const lockPath = join(options.stateDir, 'update.lock')
          const observed = await stat(lockPath)
          if (now() - observed.mtimeMs > 30_000) {
            // Serialise reclamation of this exact observed inode. A delayed contender
            // must not delete the fresh replacement another process acquired.
            const claimPath = `${lockPath}.reclaim-${observed.dev}-${observed.ino}-${observed.mtimeMs}`
            const claim = await open(claimPath, 'wx')
            try {
              const current = await stat(lockPath)
              if (current.dev !== observed.dev || current.ino !== observed.ino || current.mtimeMs !== observed.mtimeMs) return { state: 'state-unwritable', installed: options.installed }
              await rm(lockPath)
              lock = await open(lockPath, 'wx')
            } finally { await claim.close(); await rm(claimPath, { force: true }).catch(() => {}) }
          }
          else if (!explicit && cache && valid(cache.version)) return result(cache.version)
          else return { state: 'state-unwritable', installed: options.installed }
        } catch {
          if ((lockError as NodeJS.ErrnoException)?.code !== 'EEXIST') {
            unwritableUntil = now() + BACKOFF
            return { state: 'state-unwritable', installed: options.installed }
          }
          unwritableUntil = now() + BACKOFF
          return { state: 'state-unwritable', installed: options.installed }
        }
      }
      const ownedIdentity = await lock!.stat()
      try {
        const doc = await requestDocument(explicit)
        if (!valid(doc.version)) { await writeCache({ checkedAt: now(), version: options.installed, failureUntil: now() + BACKOFF }); return { state: 'invalid-metadata', installed: options.installed } }
        await writeCache({ checkedAt: now(), version: doc.version })
        return result(doc.version)
      } catch (error) {
        const state: UpdateState = error instanceof Error && error.name === 'AbortError' ? 'timeout' : error instanceof Error && error.message === 'invalid-metadata' ? 'invalid-metadata' : 'network-error'
        try { await writeCache({ checkedAt: now(), version: options.installed, failureUntil: now() + BACKOFF }) }
        catch { unwritableUntil = now() + BACKOFF; return { state: 'state-unwritable', installed: options.installed } }
        return { state, installed: options.installed }
      } finally {
        await lock?.close().catch(() => {})
        const lockPath = join(options.stateDir, 'update.lock')
        const current = await stat(lockPath).catch(() => undefined)
        if (current?.dev === ownedIdentity.dev && current.ino === ownedIdentity.ino) await rm(lockPath, { force: true }).catch(() => {})
      }
    })()
    try { return await flight } finally { flight = undefined }
  }
  function result(version: string): UpdateResult {
    const cmp = compare(version, options.installed)
    return cmp > 0 ? { state: 'newer', installed: options.installed, available: version } : cmp < 0 ? { state: 'ahead-of-latest', installed: options.installed } : { state: 'up-to-date', installed: options.installed, available: version }
  }
  return { check }
}
