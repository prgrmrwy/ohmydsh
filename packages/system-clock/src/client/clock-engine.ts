/**
 * The System Clock skew engine: turns ONE host clock sample into a live,
 * DST-correct 24-hour clock rendered in the host's IANA timezone.
 *
 * The host answers at most once per resync period (60s); between samples the
 * client renders `browserNow() + skew` where `skew = sample.now - browserNow()`
 * captured at fetch time. Rendering uses `Intl.DateTimeFormat` with the host
 * zone, so DST transitions and historical offsets come straight from the
 * browser's tz database — the client never needs to know the zone's rules.
 * If the host reported no IANA zone, the engine falls back to shifting the
 * instant by the fetched offset and rendering as UTC.
 *
 * This module is pure (no DOM, no global timers passed in), so the formatters
 * and the controller state machine are testable with injected clocks.
 *
 * @module dsh-system-clock/client/clock-engine
 */
import type { SystemClockSample } from '../contract.js'


/** Lifecycle state of the clock section. */
export type ClockStatus = 'loading' | 'ready' | 'unavailable'

/** One immutable frame emitted to the caller on every tick/resync. */
export interface ClockFrame {
  status: ClockStatus
  /** Host-zone wall time "HH:MM:SS" (24-hour, zero-padded). */
  time: string
  /** Host-zone date "YYYY-MM-DD 周X" (locale-aware weekday). */
  date: string
  /** Host IANA zone id ("" unavailable). */
  zone: string
  /** "UTC±HH:MM" label computed from the fetched host offset. */
  offsetLabel: string
  /** Host hostname. */
  hostname: string
  /** Consecutive failed fetches with no usable sample yet. */
  unavailableCount: number
}

/**
 * Format minutes-east-of-UTC as "UTC±HH:MM" using the `Date#getTimezoneOffset`
 * convention (west of UTC is positive): -480 → "UTC+08:00", +120 → "UTC-02:00".
 */
export function formatOffsetLabel(utcOffsetMinutes: number): string {
  const east = -utcOffsetMinutes
  const sign = east < 0 ? '-' : '+'
  const abs = Math.abs(east)
  const hh = Math.floor(abs / 60)
  const mm = abs % 60
  return `UTC${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Render wall time in an IANA zone. `hour12: false` guarantees 24-hour output
 * (no AM/PM) in every locale; the number format "HH:MM:SS" is locale-neutral.
 */
export function formatTime(instantMs: number, locale: string, zone: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: zone.length > 0 ? zone : 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return formatter.format(instantMs)
}

/**
 * Render a stable "YYYY-MM-DD 周X" date assembled from formatToParts, so the
 * separators never vary with locale while the weekday text still follows the
 * active locale (zh: "周三", en: "Tue").
 */
export function formatDate(instantMs: number, locale: string, zone: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone.length > 0 ? zone : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instantMs)
  const valueOf = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')} ${valueOf('weekday')}`
}

/** Instant (epoch ms) to render for a skew state. */
export interface SkewState {
  /** Host clock at fetch time (from the sample). */
  sample: SystemClockSample | undefined
  /** `sample.now - browserNow()` captured at fetch time. */
  skew: number
}

const EMPTY_FRAME: ClockFrame = {
  status: 'loading',
  time: '--:--:--',
  date: '',
  zone: '',
  offsetLabel: '',
  hostname: '',
  unavailableCount: 0,
}

/**
 * Pure frame derivation: combine skew state + a current instant + locale.
 * @param state - the skew state (may hold no sample yet).
 * @param instantMs - the instant to render (browserNow() + skew).
 * @param locale - active locale for date/weekday text.
 * @returns an immutable frame ready for display.
 */
export function deriveFrame(state: SkewState, instantMs: number, locale: string): ClockFrame {
  const sample = state.sample
  if (sample === undefined) {
    return { ...EMPTY_FRAME, status: 'unavailable' }
  }
  if (sample.timeZone.length === 0) {
    // Rare fallback: no IANA zone on the host — shift the instant by the
    // fetched offset so the UTC render shows the host wall clock.
    const shifted = instantMs - sample.utcOffsetMinutes * 60_000
    return {
      status: 'ready',
      time: formatTime(shifted, locale, ''),
      date: formatDate(shifted, locale, ''),
      zone: '',
      offsetLabel: formatOffsetLabel(sample.utcOffsetMinutes),
      hostname: sample.hostname,
      unavailableCount: 0,
    }
  }
  return {
    status: 'ready',
    time: formatTime(instantMs, locale, sample.timeZone),
    date: formatDate(instantMs, locale, sample.timeZone),
    zone: sample.timeZone,
    offsetLabel: formatOffsetLabel(sample.utcOffsetMinutes),
    hostname: sample.hostname,
    unavailableCount: 0,
  }
}

/**
 * A framework-free clock controller: one initial sample + periodic resync,
 * per-tick frame emission, and visibility-driven resync orchestration hooks.
 * Timers are injected so tests never touch real globals.
 */
export interface ClockControllerOptions {
  /** Fetch ONE host clock sample (the injected `connection.rpc` wrapper). */
  fetch: () => Promise<SystemClockSample>
  /** Browser clock read (injected for tests; default `Date.now`). */
  now: () => number
  /** Active locale read (injected; re-read each frame so locale switches land). */
  locale: () => string
  /** Per-second tick; default 1000. */
  tickMs?: number
  /** Resync period; default 60_000. */
  resyncMs?: number
  /** Called on startup, every tick, and after every resync with a new frame. */
  onFrame: (frame: ClockFrame) => void
  /** Injected timer factory (default global setInterval). */
  setInterval?: (handler: () => void, ms: number) => number
  /** Injected timer clear (default global clearInterval). */
  clearInterval?: (handle: number) => void
}

/** The running controller: start/stop/resync with an inspectable state. */
export interface ClockController {
  start(): void
  stop(): void
  /** Force a resync now (used on initial mount and on visibilitychange). */
  resync(): Promise<void>
  /** Push one fresh frame now (called by the per-tick timer). */
  tick(): void
  /** Last derived frame (undefined before start). */
  getFrame(): ClockFrame | undefined
}

const DEFAULT_TICK_MS = 1000
const DEFAULT_RESYNC_MS = 60_000

/**
 * Create a running-or-stopped clock controller.
 * @param options - injected clock/fetch/timers/callback.
 * @returns the controller handle.
 */
export function createClockController(options: ClockControllerOptions): ClockController {
  const now = options.now ?? Date.now
  const locale = options.locale ?? (() => 'en')
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const resyncMs = options.resyncMs ?? DEFAULT_RESYNC_MS
  const setIntervalFn = options.setInterval ?? setInterval
  const clearIntervalFn = options.clearInterval ?? clearInterval

  let state: SkewState = { sample: undefined, skew: 0 }
  let unavailableCount = 0
  let frame: ClockFrame | undefined
  let tickHandle = 0
  let resyncHandle = 0

  const emit = (): void => {
    frame = deriveFrame(state, now() + state.skew, locale())
    if (state.sample === undefined) {
      frame = { ...frame, status: 'unavailable', unavailableCount }
    }
    options.onFrame(frame)
  }

  const resync = async (): Promise<void> => {
    try {
      const sample = await options.fetch()
      state = { sample, skew: sample.now - now() }
      unavailableCount = 0
    } catch {
      if (state.sample === undefined) unavailableCount += 1
    }
    emit()
  }

  const tick = (): void => {
    emit()
  }

  return {
    start(): void {
      if (tickHandle !== 0 || resyncHandle !== 0) return
      void resync()
      tickHandle = setIntervalFn(tick, tickMs)
      resyncHandle = setIntervalFn(() => { void resync() }, resyncMs)
    },
    stop(): void {
      if (tickHandle !== 0) clearIntervalFn(tickHandle)
      if (resyncHandle !== 0) clearIntervalFn(resyncHandle)
      tickHandle = 0
      resyncHandle = 0
    },
    resync,
    tick,
    getFrame: () => frame,
  }
}
