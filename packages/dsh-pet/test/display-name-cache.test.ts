import { describe, expect, it } from 'vitest'
import { createDisplayCache } from '../src/host/locus/display-cache.js'

describe('createDisplayCache: display-only lookups for the management panel', () => {
  it('caches a successful lookup for 10 minutes and refetches after', async () => {
    let now = 0
    let calls = 0
    const cache = createDisplayCache(async (key: string) => { calls++; return `name-${key}` }, () => now)
    expect(await cache.get('c1')).toBe('name-c1')
    now = 9 * 60_000
    expect(await cache.get('c1')).toBe('name-c1')
    expect(calls).toBe(1)
    now = 11 * 60_000
    await cache.get('c1')
    expect(calls).toBe(2)
  })

  it('retries a failed or empty lookup after one minute, never throws', async () => {
    let now = 0
    let calls = 0
    const cache = createDisplayCache(async () => { calls++; throw new Error('lark down') }, () => now)
    expect(await cache.get('c1')).toBeUndefined()
    now = 30_000
    expect(await cache.get('c1')).toBeUndefined()
    expect(calls).toBe(1)
    now = 61_000
    await cache.get('c1')
    expect(calls).toBe(2)
  })
})
