/**
 * Shared wire contract for dsh-system-clock.
 *
 * One Connection RPC channel carries a single read-only endpoint that
 * samples the DSH **host** machine's clock — the wall-clock facts the browser
 * cannot own: the host process epoch, its IANA timezone, its current UTC
 * offset, and its hostname. The web half renders a live 24-hour clock in the
 * host timezone by combining one sample with a local skew engine; it never
 * falls back to the browser's own local time (which would be a different
 * machine's clock when the GUI is reached over an SSH tunnel).
 *
 * @module dsh-system-clock/contract
 */

/** The Connection RPC channel this package registers on the host. */
export const SYSTEM_CLOCK_CHANNEL = '/dsh-system-clock'
/** The read-only endpoint answering with one {@link SystemClockSample}. */
export const SYSTEM_CLOCK_NOW_ENDPOINT = 'now'

/** One host clock sample as answered by the `now` endpoint. */
export interface SystemClockSample {
  /** Host clock epoch milliseconds at sample time (Date.now() on the host). */
  now: number
  /**
   * Host IANA timezone id (e.g. "Asia/Shanghai"), or "" if the host could
   * not resolve a named zone (rare; the client then uses the offset).
   */
  timeZone: string
  /**
   * Host wall-clock offset from UTC in minutes, using the `Date.getTimezoneOffset`
   * sign convention: WEST of UTC is positive, EAST is negative.
   */
  utcOffsetMinutes: number
  /** Host machine hostname (short form; multi-device identification). */
  hostname: string
}
