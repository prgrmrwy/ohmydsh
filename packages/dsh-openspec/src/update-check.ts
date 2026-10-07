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
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), explicit ? 10_000 : 2_000)
        try {
          const response = await fetcher(URL, { method: 'GET', redirect: 'error', signal: controller.signal })
          if (response.ok) {
            const text = await response.text()
            if (Buffer.byteLength(text) <= 65_536) JSON.parse(text)
          }
        } catch { /* state cannot be persisted; expose only normalized state */ }
        finally { clearTimeout(timer) }
        return { state: 'state-unwritable', installed: options.installed }
      }
      let lock
      try {
        lock = await open(join(options.stateDir, 'update.lock'), 'wx')
      } catch (lockError) {
        try {
          const lockPath = join(options.stateDir, 'update.lock')
          if (now() - (await stat(lockPath)).mtimeMs > 30_000) await rm(lockPath, { force: true })
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
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), explicit ? 10_000 : 2_000)
        let response: Response
        try { response = await fetcher(URL, { method: 'GET', redirect: 'error', signal: controller.signal }) }
        finally { clearTimeout(timer) }
        if (!response.ok) throw new Error('network-error')
        const declaredLength = Number(response.headers.get('content-length') ?? 0)
        if (declaredLength > 65_536) throw new Error('invalid-metadata')
        const text = await response.text()
        if (Buffer.byteLength(text) > 65_536) throw new Error('invalid-metadata')
        const doc = JSON.parse(text)
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
        await rm(join(options.stateDir, 'update.lock'), { force: true }).catch(() => {})
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
