/**
 * Pure host-side facts for the clock sample — timezone resolution, UTC offset
 * and hostname — kept free of side effects so they are unit-testable with
 * injected fixed values.
 *
 * @module dsh-system-clock/host-time
 */
import { hostname as osHostname } from 'node:os'
import type { SystemClockSample } from './contract.js'

/** Resolve the host process IANA timezone id, or "" when unavailable. */
export function resolveHostIanaZone(intl?: Intl.DateTimeFormat): string {
  try {
    const zone = (intl ?? new Intl.DateTimeFormat()).resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length > 0 ? zone : ''
  } catch {
    return ''
  }
}

/**
 * Host wall-clock offset from UTC in minutes at a given epoch,
 * `Date#getTimezoneOffset` sign convention (west of UTC is positive).
 */
export function utcOffsetMinutesAt(now: number): number {
  return new Date(now).getTimezoneOffset()
}

/** Short-form hostname of the machine running DSH. */
export function resolveHostname(name?: string): string {
  const raw = (name ?? osHostname()).trim()
  return raw.length === 0 ? 'localhost' : raw
}

/**
 * Build a {@link SystemClockSample} for one instant.
 * @param now - the sample epoch milliseconds.
 * @param zone - the resolved host IANA zone ("" allowed).
 * @returns the immutable sample.
 */
export function buildSystemClockSample(now: number, zone: string, host: string): SystemClockSample {
  return {
    now,
    timeZone: zone,
    utcOffsetMinutes: utcOffsetMinutesAt(now),
    hostname: resolveHostname(host),
  }
}
