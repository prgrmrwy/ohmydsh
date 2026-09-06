import { describe, expect, it, vi } from 'vitest'
import { countryCodeOf, fetchCountryOf, GeoCountrySource } from '../src/geo.js'

const signal = new AbortController().signal

describe('countryCodeOf', () => {
  it('extracts common country fields', () => {
    expect(countryCodeOf({ country: 'SG' })).toBe('SG')
    expect(countryCodeOf({ countryCode: 'cn' })).toBe('CN')
    expect(countryCodeOf({ country_code: 'JP' })).toBe('JP')
  })

  it('rejects malformed values', () => {
    expect(countryCodeOf({ country: 'Singapore' })).toBeUndefined()
    expect(countryCodeOf({ country: 'C' })).toBeUndefined()
    expect(countryCodeOf({})).toBeUndefined()
    expect(countryCodeOf('CN')).toBeUndefined()
    expect(countryCodeOf(null)).toBeUndefined()
  })
})

describe('fetchCountryOf', () => {
  it('parses a JSON country payload', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ country: 'SG', ip: '203.0.113.1' }), { status: 200 }))
    await expect(fetchCountryOf(fetchImpl as unknown as typeof fetch, 'https://example.test/json', signal)).resolves.toBe('SG')
  })

  it('rejects non-OK responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 502 }))
    await expect(fetchCountryOf(fetchImpl as unknown as typeof fetch, 'https://example.test/json', signal)).rejects.toThrow()
  })

  it('rejects non-JSON or country-less bodies', async () => {
    const noJson = vi.fn(async () => new Response('not json', { status: 200 }))
    await expect(fetchCountryOf(noJson as unknown as typeof fetch, 'https://example.test/json', signal)).rejects.toThrow()
    const noCountry = vi.fn(async () => new Response(JSON.stringify({ ip: '1.2.3.4' }), { status: 200 }))
    await expect(fetchCountryOf(noCountry as unknown as typeof fetch, 'https://example.test/json', signal)).rejects.toThrow()
  })
})

describe('GeoCountrySource (primary → fallback failover)', () => {
  it('uses the primary result when it succeeds', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ country: 'SG' }), { status: 200 }))
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(signal)
    expect(result).toEqual({ country: 'SG', source: 'primary' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to the second endpoint when the primary fails deterministically', async () => {
    const fetchImpl = vi.fn()
    // A country-less body is deterministic: no retry, straight to the fallback.
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ ip: '1.2.3.4' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ countryCode: 'JP' }), { status: 200 }))
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(signal)
    expect(result).toEqual({ country: 'JP', source: 'fallback' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports an attributed failure when BOTH services fail', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network unreachable') })
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(signal)
    expect(result).toEqual({ reason: 'fetch-failed' })
    // two endpoints × (initial attempt + one transient retry)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('stops early when the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ country: 'SG' }), { status: 200 }))
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(controller.signal)
    expect(result).toEqual({ reason: 'timeout' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

/** A fetch stub that never settles until its own signal aborts. */
function hangingFetch(): (url: string, init?: { signal?: AbortSignal }) => Promise<Response> {
  return async (_url, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })
}

describe('GeoCountrySource (per-endpoint timeout budgets)', () => {
  it('still attempts the fallback after the primary exhausts its own timeout', async () => {
    const tried: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      tried.push(url)
      if (url.includes('primary')) return await hangingFetch()(url, init)
      return new Response(JSON.stringify({ country: 'JP' }), { status: 200 })
    })
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(new AbortController().signal, 50)
    expect(result).toEqual({ country: 'JP', source: 'fallback' })
    expect(tried).toHaveLength(2)
  }, 2_000)

  it('aborts in-flight work and skips remaining endpoints when the caller cancels', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(hangingFetch())
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    setTimeout(() => controller.abort(), 20)
    const result = await source.resolveCountry(controller.signal, 5_000)
    expect(result).toEqual({ reason: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns null only after BOTH endpoints exhaust their own budgets', async () => {
    const fetchImpl = vi.fn(hangingFetch())
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(new AbortController().signal, 30)
    expect(result).toEqual({ reason: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  }, 2_000)
})

describe('GeoCountrySource (in-budget transient retry)', () => {
  it('retries a transient primary failure once and keeps the primary result', async () => {
    const tried: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      tried.push(url)
      if (tried.length === 1) throw new Error('connection reset')
      return new Response(JSON.stringify({ country: 'SG' }), { status: 200 })
    })
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(new AbortController().signal, 5_000)
    expect(result).toEqual({ country: 'SG', source: 'primary' })
    expect(tried).toEqual(['https://primary.test/json', 'https://primary.test/json'])
  })

  it('does NOT retry a primary that exhausted its own budget — the fallback keeps its full budget', async () => {
    const tried: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      tried.push(url)
      if (url.includes('primary')) return await hangingFetch()(url, init)
      return new Response(JSON.stringify({ country: 'JP' }), { status: 200 })
    })
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(new AbortController().signal, 50)
    expect(result).toEqual({ country: 'JP', source: 'fallback' })
    // primary attempted exactly once (no retry), then the fallback
    expect(tried).toEqual(['https://primary.test/json', 'https://fallback.test/json'])
  }, 2_000)

  it('does NOT retry a deterministic bad body', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ip: '1.2.3.4' }), { status: 200 }))
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(new AbortController().signal, 5_000)
    expect(result).toEqual({ reason: 'invalid-response' })
    // one attempt per endpoint, no retries
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})