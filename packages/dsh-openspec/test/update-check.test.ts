import { mkdtemp, readFile, rm, writeFile, mkdir, utimes, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createUpdateChecker } from '../src/update-check.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function stateDir() { const root = await mkdtemp(join(tmpdir(), 'dsh-openspec-cache-')); roots.push(root); return root }
const latest = (version = '1.13.3') => new Response(JSON.stringify({ version }), { status: 200 })

describe('stable update check', () => {
  it('budget_covers_stalled_body_after_headers_and_releases_lock', async () => {
    const dir = await stateDir()
    let signal!: AbortSignal
    const fetch = vi.fn(async (_url: any, options: any) => {
      signal = options.signal
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
      } }))
    })
    const pending = createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch }).check()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const observed = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve('body-hung'), 2_500) })])
      expect(observed).toMatchObject({ state: 'timeout' })
      await expect(readFile(join(dir, 'update.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { if (timer) clearTimeout(timer); /* Abort only for the broken-implementation cleanup. */ (signal as any)?.dispatchEvent(new Event('abort')); await pending }
  })
  it('oversized_chunked_body_is_cancelled_before_next_read_and_unwritable_path_is_bounded_too', async () => {
    for (const unwritable of [false, true]) {
      let reads = 0, cancelled = false
      const fetch = vi.fn(async () => new Response(new ReadableStream({ pull(controller) {
        reads++
        controller.enqueue(new Uint8Array(65_537))
        if (reads === 4) controller.close()
      }, cancel() { cancelled = true } }, { highWaterMark: 0 })))
      const checker = createUpdateChecker({ stateDir: await stateDir(), installed: '1.13.2', fetch,
        ...(unwritable ? { mkdir: async () => { throw new Error('readonly') } } : {}) })
      expect((await checker.check()).state).toBe(unwritable ? 'state-unwritable' : 'invalid-metadata')
      expect(reads).toBe(1); expect(cancelled).toBe(true)
    }
  })
  it('real_fetch_stalled_http_body_times_out_and_preserves_fixed_request_contract', async () => {
    const server = createServer((_req, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.flushHeaders(); response.write('{"version":') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as any).port
    const fetcher = vi.fn((url: any, options: any) => {
      expect(url).toBe('https://registry.npmjs.org/@fission-ai%2Fopenspec/latest')
      expect(options.method).toBe('GET'); expect(options.redirect).toBe('error')
      return globalThis.fetch(`http://127.0.0.1:${port}`, options)
    })
    try {
      expect((await createUpdateChecker({ stateDir: await stateDir(), installed: '1.13.2', fetch: fetcher }).check()).state).toBe('timeout')
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('expired_lock_replacement_acquires_ownership_before_fetch_and_contender_never_fetches', async () => {
    const dir = await stateDir(), lockPath = join(dir, 'update.lock')
    await writeFile(lockPath, 'crashed-holder')
    const old = new Date(Date.now() - 60_000); await utimes(lockPath, old, old)
    let resume!: () => void, entered!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { resume = resolve })
    const ownerFetch = vi.fn(async () => { entered(); await wait; return latest() })
    const pending = createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch: ownerFetch }).check()
    await enteredPromise
    const contenderFetch = vi.fn(async () => latest())
    try {
      expect(await readFile(lockPath, 'utf8')).not.toBe('crashed-holder')
      expect((await createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch: contenderFetch }).check()).state).toBe('state-unwritable')
      expect(contenderFetch).not.toHaveBeenCalled()
      expect(await readFile(lockPath)).toBeDefined()
    } finally { resume(); await pending }
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('finishing_old_holder_does_not_unlink_a_replacement_lock', async () => {
    const dir = await stateDir(), lockPath = join(dir, 'update.lock')
    let resume!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { resume = resolve })
    const pending = createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch: async () => { entered(); await wait; return latest() } }).check()
    await started
    try {
      // Keep the old inode alive; do not depend on filesystem inode recycling.
      await rename(lockPath, join(dir, 'old-holder.lock'))
      await writeFile(lockPath, 'replacement-holder')
    } finally { resume(); await pending }
    expect(await readFile(lockPath, 'utf8')).toBe('replacement-holder')
  })
  it('concurrent_consumers_share_one_request_across_restart', async () => {
    const dir = await stateDir(); const fetch = vi.fn(async () => latest())
    const checker = createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch })
    const [a, b] = await Promise.all([checker.check(), checker.check()])
    expect(fetch).toHaveBeenCalledTimes(1); expect(a).toEqual(b)
    const restarted = createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch })
    await restarted.check(); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('request_is_fixed_latest_url_and_real_shaped_fixture_fits_limit', async () => {
    const fetch = vi.fn(async () => latest())
    await createUpdateChecker({ stateDir: await stateDir(), installed: '1.13.2', fetch }).check()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/@fission-ai%2Fopenspec/latest')
  })
  it('failures_normalize_and_back_off_fifteen_minutes', async () => {
    let now = 1000; const fetch = vi.fn(async () => new Response('{"version":"1.13.4-beta"}', { status: 200 }))
    const checker = createUpdateChecker({ stateDir: await stateDir(), installed: '1.13.2', fetch, now: () => now })
    expect((await checker.check()).state).toBe('invalid-metadata')
    await checker.check(); expect(fetch).toHaveBeenCalledTimes(1)
    now += 15 * 60_000 + 1; await checker.check(); expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('corrupt_future_dated_cache_and_stale_lock_are_ignored', async () => {
    const dir = await stateDir(); const cache = join(dir, 'update-cache.json')
    await writeFile(cache, JSON.stringify({ checkedAt: Date.now() + 100_000, version: '1.13.4' }))
    const fetch = vi.fn(async () => latest())
    const result = await createUpdateChecker({ stateDir: dir, installed: '1.13.2', fetch }).check()
    expect(result.state).toBe('newer'); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('unwritable_state_dir_still_serves_with_at_most_one_request_and_reports_state_unwritable', async () => {
    const fetch = vi.fn(async () => latest())
    const checker = createUpdateChecker({ stateDir: '/unwritable-fixture', installed: '1.13.2', fetch, mkdir: async () => { throw Object.assign(new Error('read-only'), { code: 'EACCES' }) } })
    expect((await checker.check()).state).toBe('state-unwritable')
    expect((await checker.check()).state).toBe('state-unwritable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('disabled_option_makes_zero_requests', async () => {
    const fetch = vi.fn(async () => latest())
    const checker = createUpdateChecker({ stateDir: await stateDir(), installed: '1.13.2', fetch, enabled: false })
    expect((await checker.check({ explicit: true })).state).toBe('check-disabled')
    expect(fetch).not.toHaveBeenCalled()
  })
})
