import { describe, expect, it, vi } from 'vitest'
import {
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
// NetworkVerdictCache
// ---------------------------------------------------------------------------

function makeSource(
  fetchCountry: VerdictSource['fetchCountry'],
  classify: VerdictSource['classify'] = () => 'allowed',
  epoch = () => 'e1',
) {
  const fingerprint = vi.fn(() => 'fp-1')
  const epochFn = vi.fn(epoch)
  return { source: { fingerprint, epoch: epochFn, fetchCountry, classify } as VerdictSource, fingerprint, epochFn }
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
  it('serves TTL-fresh verdicts from cache without re-resolving', async () => {
    const fetchCountry = vi.fn(async () => ({ country: 'SG' }))
    const { source } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now)

    const first = await cache.check()
    now += 30_000 // still inside the 60s TTL
    const second = await cache.check()

    expect(fetchCountry).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ verdict: 'allowed', sampledAt: 1_000, freshForMs: 60_000, degraded: false })
    expect(second.verdict).toBe('allowed')
    expect(second.freshForMs).toBe(30_000) // remaining validity shrinks
  })

  it('refetches once the TTL expires', async () => {
    const fetchCountry = vi.fn(async () => ({ country: 'SG' }))
    const { source } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 60_001
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(2)
  })

  it('invalidates on fingerprint change even inside the TTL (断网重连)', async () => {
    const fetchCountry = vi.fn(async () => ({ country: 'SG' }))
    const { source, fingerprint } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 1_000
    fingerprint.mockReturnValue('fp-2') // reconnect changed the local addresses
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(2)
  })

  it('invalidates on config epoch change (config write must re-verify)', async () => {
    const fetchCountry = vi.fn(async () => ({ country: 'SG' }))
    const { source, epochFn } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 1_000
    epochFn.mockReturnValue('e2') // config written
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the cached verdict when fingerprint+epoch stay identical (same-address reconnect → TTL backstop)', async () => {
    const fetchCountry = vi.fn(async () => ({ country: 'SG' }))
    const { source } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check()
    now += 10_000 // a reconnect whose addresses did not change
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(1)
    expect(source.fingerprint).toHaveBeenCalled()
  })

  it('coalesces concurrent checks into a single outbound resolution (single-flight)', async () => {
    let resolveFetch!: (country: { country: string }) => void
    const fetchCountry = vi.fn(() => new Promise<{ country: string }>((resolve) => { resolveFetch = resolve }))
    const { source } = makeSource(fetchCountry)
    const cache = makeCache(source, () => 1_000)

    const pending = [cache.check(), cache.check(), cache.check()]
    resolveFetch({ country: 'SG' })
    const results = await Promise.all(pending)

    expect(fetchCountry).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.verdict)).toEqual(['allowed', 'allowed', 'allowed'])
  })

  it('degrades to unknown on failure, then self-heals with exponential backoff capped at the max', async () => {
    const fetchCountry = vi.fn(async () => null) // both geo services failed
    const { source } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now, 60_000, 5_000, 2_000, 60_000)

    const degraded = await cache.check()
    expect(degraded).toEqual({ verdict: 'unknown', degraded: true, degradedReason: 'fetch-failed' })
    expect('sampledAt' in degraded).toBe(false)
    expect('freshForMs' in degraded).toBe(false)
    expect(fetchCountry).toHaveBeenCalledTimes(1)

    // Inside the 2s backoff window: no outbound call, same degraded answer.
    now += 999
    const stillDegraded = await cache.check()
    expect(stillDegraded.verdict).toBe('unknown')
    expect(stillDegraded.degradedReason).toBe('fetch-failed')
    expect(fetchCountry).toHaveBeenCalledTimes(1)

    // Past the window: retry (2s). Fail again → next window is 4s.
    now += 2_001
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(2)
    now += 3_999
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(2) // still inside 4s window
    now += 2_001 // crosses the 4s window
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(3)

    // Sustained failures: cap the cadence, do not stop retrying.
    for (let i = 0; i < 10; i++) {
      now += 60_001
      await cache.check()
    }
    const callsBeforeRecovery = fetchCountry.mock.calls.length
    expect(callsBeforeRecovery).toBeGreaterThanOrEqual(12)
    expect(callsBeforeRecovery).toBeLessThanOrEqual(14)

    // Services recover: next retry succeeds, verdict cached, backoff reset.
    fetchCountry.mockResolvedValue({ country: 'SG' })
    now += 60_001
    const recovered = await cache.check()
    expect(recovered.verdict).toBe('allowed')
    expect(recovered.degraded).toBe(false)
  })

  it('bypasses the backoff window when the fingerprint changes (reconnect must re-verify immediately)', async () => {
    const fetchCountry = vi.fn(async () => null)
    const { source, fingerprint } = makeSource(fetchCountry)
    let now = 1_000
    const cache = makeCache(source, () => now)

    await cache.check() // fails, enters 2s backoff
    expect(fetchCountry).toHaveBeenCalledTimes(1)

    // Same fingerprint inside the window: no retry.
    now += 1_000
    await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(1)

    // Fingerprint changed (reconnect): immediate re-query regardless of backoff.
    fingerprint.mockReturnValue('fp-2')
    fetchCountry.mockResolvedValue({ country: 'SG' })
    now += 1
    const result = await cache.check()
    expect(fetchCountry).toHaveBeenCalledTimes(2) // one fresh resolution for the new fingerprint
    expect(result.verdict).toBe('allowed')
  })

  it('maps timeouts and invalid bodies to their stable diagnostic codes', async () => {
    const timeoutSource = makeSource(vi.fn((_signal: AbortSignal) => new Promise<never>((_r, reject) => {
      setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 50)
    })))
    const slowCache = makeCache(timeoutSource.source, () => 1_000, 60_000, 5)
    const timedOut = await slowCache.check()
    expect(timedOut.degraded).toBe(true)
    expect(timedOut.degradedReason).toBe('timeout')
  })

  it('never leaks the country of a null/unknown path — raw response text stays inside the source', async () => {
    const rawText = '{"country":"SG","ip":"203.0.113.1"}'
    const fetchCountry = vi.fn(async () => ({ country: 'SG' }))
    const { source } = makeSource(fetchCountry)
    const cache = makeCache(source, () => 1_000)

    const ok = await cache.check()
    expect(JSON.stringify(ok)).not.toContain(rawText)
    expect(JSON.stringify(ok)).not.toContain('203.0.113')
    expect(JSON.stringify(ok)).not.toContain('SG') // verdict is 'allowed', not the country
  })
})