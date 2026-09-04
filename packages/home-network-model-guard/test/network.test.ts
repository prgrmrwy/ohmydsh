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

function makeCache(
  source: VerdictSource,
  now: () => number,
  ttlMs = 60_000,
  fetchTimeoutMs = 5_000,
  backoffBaseMs?: number,
  backoffMaxMs?: number,
) {
  return new NetworkVerdictCache(source, now, { ttlMs, fetchTimeoutMs, ...(backoffBaseMs !== undefined ? { backoffBaseMs } : {}), ...(backoffMaxMs !== undefined ? { backoffMaxMs } : {}) })
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

  it('degrades to unknown, then self-heals with exponential backoff capped at the max', async () => {
    const fetchIp = vi.fn()
    fetchIp.mockRejectedValue(new Error('network unreachable'))
    const { source } = makeSource(fetchIp)
    let now = 1_000
    const cache = makeCache(source, () => now, 60_000, 5_000, 2_000, 60_000)

    const degraded = await cache.check()
    expect(degraded).toEqual({ verdict: 'unknown', degraded: true, degradedReason: 'fetch-failed' })
    expect('sampledAt' in degraded).toBe(false)
    expect('freshForMs' in degraded).toBe(false)
    expect(fetchIp).toHaveBeenCalledTimes(1)

    // Inside the 2s backoff window: no outbound call, same degraded answer.
    now += 999
    const stillDegraded = await cache.check()
    expect(stillDegraded.verdict).toBe('unknown')
    expect(stillDegraded.degradedReason).toBe('fetch-failed')
    expect(fetchIp).toHaveBeenCalledTimes(1)

    // Past the window: retry (2s). Fail again → next window is 4s.
    now += 2_001
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(2)
    now += 3_999
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(2) // still inside 4s window
    now += 2_001 // crosses the 4s window
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(3)

    // Sustained failures: cap the cadence, do not stop retrying.
    for (let i = 0; i < 10; i++) {
      now += 60_001
      await cache.check()
    }
    const callsBeforeRecovery = fetchIp.mock.calls.length
    expect(callsBeforeRecovery).toBeGreaterThanOrEqual(12)
    expect(callsBeforeRecovery).toBeLessThanOrEqual(14)

    // Network recovers: next retry succeeds, verdict cached, backoff reset.
    fetchIp.mockResolvedValue('1.2.3.4')
    now += 60_001
    const recovered = await cache.check()
    expect(recovered.verdict).toBe('home')
    expect(recovered.degraded).toBe(false)
    // Backoff reset: a later fresh failure starts from the base again.
    fetchIp.mockRejectedValueOnce(new Error('again'))
    now += 60_001
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(callsBeforeRecovery + 2)
    const callsAfter = fetchIp.mock.calls.length
    now += 999
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(callsAfter)
    now += 2_001
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(callsAfter + 1)
  })

  it('bypasses the backoff window when the fingerprint changes (reconnect must re-verify immediately)', async () => {
    const fetchIp = vi.fn()
    fetchIp.mockRejectedValueOnce(new Error('down')).mockResolvedValue('1.2.3.4')
    const { source, fingerprint } = makeSource(fetchIp)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check() // fails, enters 2s backoff
    expect(fetchIp).toHaveBeenCalledTimes(1)

    // Same fingerprint inside the window: no retry.
    now += 1_000
    await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(1)

    // Fingerprint changed (reconnect): immediate re-query regardless of backoff.
    fingerprint.mockReturnValue('fp-2')
    now += 1
    const result = await cache.check()
    expect(fetchIp).toHaveBeenCalledTimes(2) // one fresh fetch for the new fingerprint
    expect(source.fingerprint).toHaveBeenCalled()
    expect(result.verdict).toBe('home')
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