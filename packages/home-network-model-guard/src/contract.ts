/**
 * Shared wire contract for dsh-home-network-model-guard.
 *
 * One Connection RPC channel carries a single read-only endpoint that answers
 * the DSH **host**'s egress verdict for the sending guard: whether the host's
 * egress country/region hits the configured blocklist (default CN). The
 * browser cannot own this fact — the GUI is often reached over an SSH tunnel
 * from a different machine — so the host samples it via two backup Geo
 * services and the web half only ever receives the classification, never the
 * IP itself.
 *
 * @module dsh-home-network-model-guard/contract
 */

/** The Connection RPC channel this package registers on the host. */
export const GUARD_CHANNEL = '/dsh-home-network-model-guard'
/** The read-only endpoint answering with one {@link GuardCheckResult}. */
export const GUARD_CHECK_ENDPOINT = 'check'
/** The read-only endpoint answering with one {@link GuardStatus}. */
export const GUARD_STATUS_ENDPOINT = 'status'
/** The write endpoint applying a validated configuration. */
export const GUARD_SET_CONFIG_ENDPOINT = 'set-config'

/**
 * Host egress classification.
 *
 * - `'allowed'`: egress country/region resolved and NOT in the blocklist.
 * - `'blocked'`: egress country/region resolved and in the blocklist (default CN).
 * - `'unknown'`: no conclusion (both Geo services failed / degraded) — fail closed.
 */
export type NetworkVerdict = 'allowed' | 'blocked' | 'unknown'

/** One host network verdict as answered by the `check` endpoint. */
export interface GuardCheckResult {
  /** The host egress classification. */
  verdict: NetworkVerdict
  /**
   * Host epoch milliseconds of the underlying successful Geo resolution;
   * absent when the verdict is `'unknown'` (nothing was measured).
   */
  sampledAt?: number
  /**
   * Remaining validity in milliseconds before the host cache expires;
   * absent when the verdict is `'unknown'`.
   */
  freshForMs?: number
  /** True when this answer came from a degraded path (no fresh measurement). */
  degraded: boolean
  /**
   * Stable short diagnostic code; never verbatim error text (which could in
   * principle carry the IP). Absent when not degraded.
   */
  degradedReason?: 'fetch-failed' | 'timeout' | 'invalid-response'
}

/**
 * Diagnostics view for the settings page: the verdict plus the sanitized
 * resolution facts and the current configuration. `country` is the resolved
 * ISO code (a Geo conclusion, not an IP) and is shown only in the settings
 * diagnosis; the automatic `check` response never carries it.
 */
export interface GuardStatus {
  verdict: NetworkVerdict
  sampledAt?: number
  freshForMs?: number
  degraded: boolean
  degradedReason?: GuardCheckResult['degradedReason']
  /** ISO country code of the latest successful resolution (diagnostics only). */
  country?: string
  /** Which Geo service answered the latest resolution. */
  source?: 'primary' | 'fallback'
  /** Current effective configuration (never contains secrets). */
  config: {
    blockedCountries: readonly string[]
    geoEndpoints: readonly [string, string]
    timeoutMs: number
    ttlMs: number
    backoffBaseMs: number
    backoffMaxMs: number
  }
  /** Config-generation identity; changes when the config is written. */
  configEpoch: string
}