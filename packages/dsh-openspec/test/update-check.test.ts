import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpdateChecker } from '../src/update-check.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function stateDir() { const root = await mkdtemp(join(tmpdir(), 'dsh-openspec-cache-')); roots.push(root); return root }
const latest = (version = '1.13.3') => new Response(JSON.stringify({ version }), { status: 200 })

describe('stable update check', () => {
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
