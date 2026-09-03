/**
 * Shared wire contract for dsh-home-network-model-guard.
 *
 * One Connection RPC channel carries a single read-only endpoint that answers
 * the DSH **host**'s network verdict for the sending guard: whether the host's
 * public egress IP belongs to the configured home-network allowlist. The
 * browser cannot own this fact — the GUI is often reached over an SSH tunnel
 * from a different machine — so the host samples it and the web half only ever
 * receives the classification, never the IP itself.
 *
 * @module dsh-home-network-model-guard/contract
 */

/** The Connection RPC channel this package registers on the host. */
export const GUARD_CHANNEL = '/dsh-home-network-model-guard'
/** The read-only endpoint answering with one {@link GuardCheckResult}. */
export const GUARD_CHECK_ENDPOINT = 'check'

/**
 * Host network classification.
 *
 * - `'home'`: egress IP hit the home allowlist (the only value that may block).
 * - `'not-home'`: egress IP was measured but did not hit the allowlist.
 * - `'unknown'`: no conclusion (fetch failed / degraded) — fail open.
 */
export type NetworkVerdict = 'home' | 'not-home' | 'unknown'

/** One host network verdict as answered by the `check` endpoint. */
export interface GuardCheckResult {
  /** The host network classification. */
  verdict: NetworkVerdict
  /**
   * Host epoch milliseconds of the underlying successful egress fetch;
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