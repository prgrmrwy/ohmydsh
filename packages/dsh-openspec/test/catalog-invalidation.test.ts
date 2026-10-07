import { describe, expect, it, vi } from 'vitest'
import { watchCatalogInvalidation } from '../src/catalog-invalidation.js'

describe('catalog invalidation', () => {
  it('disposal_during_pending_stat_never_invalidates_and_failed_refresh_can_retry', async () => {
    let resolve!: (value: { mtimeMs: number; size: number }) => void
    let stamp = 1
    const stat = vi.fn(async () => ({ mtimeMs: stamp, size: 1 }))
    const invalidate = vi.fn(async () => { if (invalidate.mock.calls.length === 1) throw new Error('retry') })
    const monitor = watchCatalogInvalidation({ configPath: '/config', stat, invalidate })
    await monitor.check(); stamp = 2
    await expect(monitor.check()).rejects.toThrow('retry')
    await monitor.check(); expect(invalidate).toHaveBeenCalledTimes(2)
    stat.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = monitor.check(); monitor.dispose(); resolve({ mtimeMs: 3, size: 1 }); await pending
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
  it('profile_edit_invalidates_provider_and_next_listing_reflects_it', async () => {
    const invalidate = vi.fn()
    const config = { mtimeMs: 10, size: 5 }
    const stat = vi.fn(async () => config)
    const monitor = watchCatalogInvalidation({ configPath: '/global/config.yaml', invalidate, stat, intervalMs: 30_000 })
    await monitor.check()
    config.mtimeMs = 20
    await monitor.check()
    expect(invalidate).toHaveBeenCalledTimes(1)
    monitor.dispose()
  })
})
