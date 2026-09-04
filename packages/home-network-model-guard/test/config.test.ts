import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, validateGuardConfig } from '../src/config.js'

describe('validateGuardConfig', () => {
  it('accepts an empty object and falls back to defaults', () => {
    const result = validateGuardConfig({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.blockedCountries).toEqual(['CN'])
      expect(result.config.geoEndpoints).toEqual(DEFAULT_CONFIG.geoEndpoints)
      expect(result.config.backoffBaseMs).toBe(2_000)
      expect(result.config.backoffMaxMs).toBe(60_000)
    }
  })

  it('accepts a valid override', () => {
    const result = validateGuardConfig({
      blockedCountries: ['CN', 'HK'],
      geoEndpoints: ['https://ipinfo.io/json', 'https://ipwho.is/'],
      timeoutMs: 3_000,
      ttlMs: 120_000,
      backoffBaseMs: 1_000,
      backoffMaxMs: 30_000,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.blockedCountries).toEqual(['CN', 'HK'])
      expect(result.config.timeoutMs).toBe(3_000)
    }
  })

  it('rejects credential-looking field names', () => {
    expect(validateGuardConfig({ apiKey: 'abc' }).ok).toBe(false)
    expect(validateGuardConfig({ password: 'x' }).ok).toBe(false)
    expect(validateGuardConfig({ secret: 'x' }).ok).toBe(false)
    expect(validateGuardConfig({ token: 'x' }).ok).toBe(false)
  })

  it('rejects non-HTTPS or credential-bearing Geo endpoints', () => {
    expect(validateGuardConfig({ geoEndpoints: ['http://ip-api.com/json', 'https://ipwho.is/'] }).ok).toBe(false)
    expect(validateGuardConfig({ geoEndpoints: ['https://user:pass@ipinfo.io/json', 'https://ipwho.is/'] }).ok).toBe(false)
    expect(validateGuardConfig({ geoEndpoints: ['https://ipinfo.io/json'] }).ok).toBe(false) // must be exactly two
  })

  it('rejects invalid blockedCountries shapes and codes', () => {
    expect(validateGuardConfig({ blockedCountries: [] }).ok).toBe(false)
    expect(validateGuardConfig({ blockedCountries: ['C'] }).ok).toBe(false)
    expect(validateGuardConfig({ blockedCountries: ['cn', 'HK'] }).ok).toBe(false) // lower-case rejected
    expect(validateGuardConfig({ blockedCountries: 'CN' }).ok).toBe(false)
  })

  it('rejects non-positive numeric knobs and inverted backoff bounds', () => {
    expect(validateGuardConfig({ timeoutMs: 0 }).ok).toBe(false)
    expect(validateGuardConfig({ ttlMs: -1 }).ok).toBe(false)
    expect(validateGuardConfig({ backoffBaseMs: 10_000, backoffMaxMs: 5_000 }).ok).toBe(false)
  })

  it('dedupes blockedCountries case-insensitively', () => {
    const result = validateGuardConfig({ blockedCountries: ['CN', 'CN', 'HK'] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.blockedCountries).toEqual(['CN', 'HK'])
  })
})