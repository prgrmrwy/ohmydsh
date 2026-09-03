import { describe, expect, it, vi } from 'vitest'
import {
  EgressInvalidResponseError,
  fetchEgressIp,
  fingerprintOf,
  NetworkVerdictCache,
  type VerdictSource,
} from '../src/network.js'

// ---------------------------------------------------------------------------
// fingerprintOf
// ---------------------------------------------------------------------------

describe('fingerprintOf', () => {
  it('collects non-internal IPv4 addresses, sorted and deduped', () => {
    const interfaces = {
      en0: [
        { address: '198.51.100.7', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      en1: [{ address: '198.51.100.7', family: 'IPv4', internal: false }], // duplicate across interfaces
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    }
    expect(fingerprintOf(interfaces)).toBe('198.51.100.7')
  })

  it('sorts multiple addresses', () => {
    const interfaces = {
      utun: [
        { address: '10.0.0.2', family: 'IPv4', internal: false },
        { address: '10.0.0.1', family: 'IPv4', internal: false },
      ],
    }
    expect(fingerprintOf(interfaces)).toBe('10.0.0.1,10.0.0.2')
  })

  it('is empty when only internal/ipv6 entries exist', () => {
    expect(fingerprintOf({ lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] })).toBe('')
    expect(fingerprintOf({})).toBe('')
  })
})

// ---------------------------------------------------------------------------
// fetchEgressIp
// ---------------------------------------------------------------------------

describe('fetchEgressIp', () => {
  const signal = new AbortController().signal

  it('parses the JSON { ip } payload of the configured endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ip: '1.2.3.4' }), { status: 200 }))
    await expect(fetchEgressIp(fetchImpl as unknown as typeof fetch, signal)).resolves.toBe('1.2.3.4')
  })

  it('accepts plain-text IP bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response('9.9.9.9', { status: 200 }))
    await expect(fetchEgressIp(fetchImpl as unknown as typeof fetch, signal)).resolves.toBe('9.9.9.9')
  })

  it('rejects non-OK responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 502 }))
    await expect(fetchEgressIp(fetchImpl as unknown as typeof fetch, signal)).rejects.toBeInstanceOf(EgressInvalidResponseError)
  })

  it('rejects unparseable bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response('not an ip at all', { status: 200 }))
    await expect(fetchEgressIp(fetchImpl as unknown as typeof fetch, signal)).rejects.toBeInstanceOf(EgressInvalidResponseError)
  })

  it('retries once when the first attempt fails, then succeeds on the retry', async () => {
    const fetchImpl = vi.fn()
    fetchImpl.mockRejectedValueOnce(new Error('flaky connect'))
      .mockResolvedValueOnce(new Response('203.0.113.20', { status: 200 }))
    await expect(fetchEgressIp(fetchImpl as unknown as typeof fetch, signal)).resolves.toBe('203.0.113.20')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// NetworkVerdictCache
// ---------------------------------------------------------------------------

function makeSource(fetchIp: VerdictSource['fetchIp'], classify: VerdictSource['classify'] = () => 'home') {
  const fingerprint = vi.fn(() => 'fp-1')
  return { source: { fingerprint, fetchIp, classify } as VerdictSource, fingerprint }
}

function makeCache(source: VerdictSource, now: () => number, ttlMs = 60_000, fetchTimeoutMs = 5_000) {
  return new NetworkVerdictCache(source, now, { ttlMs, fetchTimeoutMs })
}

describe('NetworkVerdictCache', () => {
  it('serves TTL-fresh verdicts from cache without re-fetching', async () => {
    const fetchIp = vi.fn(async () => '1.2.3.4')
    const { source } = makeSource(fetchIp)
    let now = 1_000
    const cache = makeCache(source, () => now)

    const first = await cache.check()
    now += 30_000 // still inside the 60s TTL
    const second = await cache.check()

    expect(fetchIp).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ verdict: 'home', sampledAt: 1_000, freshForMs: 60_000, degraded: false })
    expect(second.verdict).toBe('home')
    expect(second.freshForMs).toBe(30_000) // remaining validity shrinks
  })

  it('refetches once the TTL expires', async () => {
    const fetchIp = vi.fn(async () => '1.2.3.4')
    const { source } = makeSource(fetchIp)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 60_001
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(2)
  })

  it('invalidates on fingerprint change even inside the TTL (断网重连)', async () => {
    const fetchIp = vi.fn(async () => '1.2.3.4')
    const { source, fingerprint } = makeSource(fetchIp)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 1_000
    fingerprint.mockReturnValue('fp-2') // reconnect changed the local addresses
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the cached verdict when the fingerprint stays identical (same-address reconnect → TTL backstop)', async () => {
    const fetchIp = vi.fn(async () => '1.2.3.4')
    const { source } = makeSource(fetchIp)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 10_000 // a reconnect whose addresses did not change
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(1)
    expect(source.fingerprint).toHaveBeenCalled()
  })

  it('coalesces concurrent checks into a single outbound fetch (single-flight)', async () => {
    let resolveFetch!: (ip: string) => void
    const fetchIp = vi.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve }))
    const { source } = makeSource(fetchIp)
    const cache = makeCache(source, () => 1_000)

    const pending = [cache.check(), cache.check(), cache.check()]
    resolveFetch('1.2.3.4')
    const results = await Promise.all(pending)

    expect(fetchIp).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.verdict)).toEqual(['home', 'home', 'home'])
  })

  it('degrades to unknown on fetch failure, does not cache it, and retries on the next request', async () => {
    const fetchIp = vi.fn()
    fetchIp.mockRejectedValueOnce(new Error('network unreachable')).mockResolvedValueOnce('1.2.3.4')
    const { source } = makeSource(fetchIp)
    const cache = makeCache(source, () => 1_000)

    const degraded = await cache.check()
    expect(degraded).toEqual({ verdict: 'unknown', degraded: true, degradedReason: 'fetch-failed' })
    expect('sampledAt' in degraded).toBe(false)
    expect('freshForMs' in degraded).toBe(false)

    // Next request retries (spec: 降级后可恢复) and succeeds, now cached.
    const recovered = await cache.check()
    expect(recovered.verdict).toBe('home')
    expect(recovered.degraded).toBe(false)
    expect(fetchIp).toHaveBeenCalledTimes(2)
  })

  it('maps timeouts and invalid bodies to their stable diagnostic codes', async () => {
    const timeoutSource = makeSource(vi.fn((_signal: AbortSignal) => new Promise<never>((_r, reject) => {
      setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 50)
    })))
    const slowCache = makeCache(timeoutSource.source, () => 1_000, 60_000, 5)
    const timedOut = await slowCache.check()
    expect(timedOut.degraded).toBe(true)
    expect(timedOut.degradedReason).toBe('timeout')

    const invalidSource = makeSource(vi.fn(async () => { throw new EgressInvalidResponseError('no ip'); }))
    const invalidCache = makeCache(invalidSource.source, () => 1_000)
    const invalid = await invalidCache.check()
    expect(invalid.degradedReason).toBe('invalid-response')
  })

  it('never leaks the IP into any result payload', async () => {
    const ip = '203.0.113.1'
    const fetchIp = vi.fn(async () => ip)
    const classify = vi.fn(() => 'home' as const)
    const { source } = makeSource(fetchIp, classify)
    const cache = makeCache(source, () => 1_000)

    const ok = await cache.check()
    expect(JSON.stringify(ok)).not.toContain(ip)
    expect(JSON.stringify(ok)).not.toContain('203.0.113')

    // degraded path equally clean
    fetchIp.mockRejectedValueOnce(new Error('boom'))
    const degraded = await cache.check()
    expect(JSON.stringify(degraded)).not.toContain(ip)
    // the measured IP reached classification, never the result
    expect(classify).toHaveBeenCalledWith(ip)
  })
})