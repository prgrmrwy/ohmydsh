import { describe, expect, it } from 'vitest'
import {
  buildSystemClockSample,
  resolveHostIanaZone,
  resolveHostname,
  utcOffsetMinutesAt,
} from '../src/host-time.js'

describe('resolveHostIanaZone', () => {
  it('reads the zone from Intl when present', () => {
    const fakeIntl = { resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }) } as unknown as Intl.DateTimeFormat
    expect(resolveHostIanaZone(fakeIntl)).toBe('Asia/Shanghai')
  })

  it('returns "" when Intl reports no zone', () => {
    const fakeIntl = { resolvedOptions: () => ({ timeZone: undefined }) } as unknown as Intl.DateTimeFormat
    expect(resolveHostIanaZone(fakeIntl)).toBe('')
  })

  it('returns "" when Intl throws', () => {
    const fakeIntl = { resolvedOptions: () => { throw new Error('no icu') } } as unknown as Intl.DateTimeFormat
    expect(resolveHostIanaZone(fakeIntl)).toBe('')
  })
})

describe('utcOffsetMinutesAt', () => {
  it('uses the getTimezoneOffset sign convention (east of UTC is negative)', () => {
    const previous = process.env.TZ
    try {
      process.env.TZ = 'Asia/Shanghai'
      // 2021-01-01T00:00:00Z → Shanghai is UTC+8, west-of-UTC is positive → -480
      expect(utcOffsetMinutesAt(Date.UTC(2021, 0, 1, 0, 0, 0))).toBe(-480)
      process.env.TZ = 'America/New_York'
      // Same instant → New York is EST (UTC-5) → +300
      expect(utcOffsetMinutesAt(Date.UTC(2021, 0, 1, 0, 0, 0))).toBe(300)
    } finally {
      process.env.TZ = previous
    }
  })
})

describe('resolveHostname', () => {
  it('trims and passes through a provided name', () => {
    expect(resolveHostname('  dev-01 ')).toBe('dev-01')
  })

  it('falls back to localhost when empty', () => {
    expect(resolveHostname('   ')).toBe('localhost')
    expect(resolveHostname('')).toBe('localhost')
  })
})

describe('buildSystemClockSample', () => {
  it('assembles a coherent sample for one instant', () => {
    const sample = buildSystemClockSample(1_752_494_400_000, 'Asia/Shanghai', 'devbox')
    expect(sample.now).toBe(1_752_494_400_000)
    expect(sample.timeZone).toBe('Asia/Shanghai')
    expect(sample.hostname).toBe('devbox')
    expect(sample.utcOffsetMinutes).toBe(utcOffsetMinutesAt(sample.now))
  })
})
