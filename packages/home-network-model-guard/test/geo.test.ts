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

  it('falls back when the primary fails and uses the fallback result', async () => {
    const fetchImpl = vi.fn()
    fetchImpl.mockImplementationOnce(async () => new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ countryCode: 'JP' }), { status: 200 }))
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(signal)
    expect(result).toEqual({ country: 'JP', source: 'fallback' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns null when BOTH services fail', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network unreachable') })
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(signal)
    expect(result).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops early when the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ country: 'SG' }), { status: 200 }))
    const source = new GeoCountrySource(['https://primary.test/json', 'https://fallback.test/json'], fetchImpl as unknown as typeof fetch)
    const result = await source.resolveCountry(controller.signal)
    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})