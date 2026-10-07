import { describe, expect, it, vi } from 'vitest'
import { watchCatalogInvalidation } from '../src/catalog-invalidation.js'

describe('catalog invalidation', () => {
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
