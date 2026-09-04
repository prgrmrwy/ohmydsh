/**
 * Host network sampling: local fingerprint, egress IP fetch, verdict cache.
 *
 * All three pieces are dependency-injected (interfaces, fingerprint input,
 * fetch implementation, clock) so the cache semantics — TTL, fingerprint
 * invalidation, single-flight coalescing, fail-open degradation — are fully
 * unit-testable without real network or `node:os`.
 *
 * The produced {@link GuardCheckResult} never carries the IP: the raw address
 * lives only inside this module's refresh path and the cache entry, and is
 * never exposed to the RPC layer.
 *
 * @module dsh-home-network-model-guard/network
 */
import type { GuardCheckResult, NetworkVerdict } from './contract.js'
import { EGRESS_IP_ENDPOINT } from './rules.js'

/** The subset of `os.NetworkInterfaceInfo` the fingerprint reads. */
export interface NetworkInterfaceInfo {
  readonly address: string
  readonly family: string
  readonly internal: boolean
}

/** `os.networkInterfaces()`-shaped input (dict of name → infos). */
export type InterfacesLike = Record<string, readonly NetworkInterfaceInfo[] | undefined>

/**
 * Stable local network fingerprint: sorted, deduped, non-internal IPv4
 * addresses joined by ','.
 *
 * Reconnecting the interface (DHCP renew/change) alters this set, which is the
 * cheap, local, synchronously readable signal that invalidates a stale egress
 * verdict before its TTL expires ("断网重连后立即重新判定").
 *
 * @param interfaces - `os.networkInterfaces()` output.
 * @returns the fingerprint string (empty when no non-internal IPv4 address).
 */
export function fingerprintOf(interfaces: InterfacesLike): string {
  const addresses = new Set<string>()
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || info.family !== 'IPv4') continue
      addresses.add(info.address)
    }
  }
  return [...addresses].sort().join(',')
}

/** IPv4 dotted quad or IPv6 address — everything accepted forms a valid IP literal. */
const IP_LITERAL_RE = /^(?:[0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9a-fA-F:]+)$/

/** The egress query failed to run or returned nothing usable. */
export class EgressFetchError extends Error {}
/** The egress query answered but its body carried no parseable IP. */
export class EgressInvalidResponseError extends Error {}

/**
 * Fetch the host's public egress IP from the single fixed endpoint.
 *
 * Accepts either a JSON `{ "ip": "…" }` payload or a plain-text IP (the
 * configured endpoint answers plain text). The request carries no local
 * information; only the response body is read. Never persists anything.
 *
 * One immediate retry (≈250ms gap) protects against flaky first connects —
 * observed on the deployment home network where a first connect occasionally
 * times out while the retry succeeds. Still a single endpoint; failure after
 * the retry degrades the verdict (fail open) in the caller.
 *
 * @param fetchImpl - `fetch`-compatible implementation (injected for tests).
 * @param signal - caller-owned abort (timeout wiring lives in the cache).
 * @returns the egress IP literal.
 * @throws {@link EgressInvalidResponseError} on non-OK or unparseable bodies,
 * any other transport failure propagates as its own error.
 */
export async function fetchEgressIp(fetchImpl: typeof fetch, signal: AbortSignal): Promise<string> {
  let attempt = 0
  for (;;) {
    try {
      const response = await fetchImpl(EGRESS_IP_ENDPOINT, { signal })
      if (!response.ok) throw new EgressInvalidResponseError(`egress endpoint answered ${response.status}`)
      const text = await response.text()
      let candidate: unknown
      try {
        candidate = (JSON.parse(text) as { ip?: unknown })?.ip
      } catch {
        candidate = text.trim()
      }
      if (typeof candidate !== 'string' || !IP_LITERAL_RE.test(candidate)) {
        throw new EgressInvalidResponseError('egress response carried no parseable IP')
      }
      return candidate
    } catch (error) {
      attempt += 1
      if (attempt >= 2 || signal.aborted) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
    }
  }
}

/** Sources the cache needs; each is injected so the cache stays unit-testable. */
export interface VerdictSource {
  /** Current local network fingerprint (see {@link fingerprintOf}). */
  fingerprint(): string
  /** Fetch the egress IP; throws on failure (see {@link fetchEgressIp}). */
  fetchIp(signal: AbortSignal): Promise<string>
  /** Map one measured egress IP to a verdict (whitelist semantics). */
  classify(ip: string): NetworkVerdict
}

/** Cache knobs. */
export interface VerdictCacheOptions {
  /** How long a fresh verdict stays valid for an unchanged fingerprint. */
  readonly ttlMs: number
  /** Abort an egress fetch after this long; the answer then degrades. */
  readonly fetchTimeoutMs: number
  /** First backoff after a failed refresh; doubles on every failure. */
  readonly backoffBaseMs?: number
  /** Ceiling for the backoff interval (sustained retry cadence). */
  readonly backoffMaxMs?: number
}

interface CacheEntry {
  verdict: NetworkVerdict
  fetchedAtMs: number
  fingerprint: string
}

/** Default sustained retry cadence: 2s → 4s → … → 60s, then keep trying. */
const DEFAULT_BACKOFF_BASE_MS = 2_000
const DEFAULT_BACKOFF_MAX_MS = 60_000

/** Timeout elevated so the degradation reason maps to `'timeout'`. */
class FetchTimedOutError extends Error {}

/**
 * Cached, single-flight network verdict source with sustained retry.
 *
 * Hit condition: TTL not expired AND fingerprint unchanged. Any miss starts a
 * refresh; concurrent callers share one in-flight refresh (single-flight).
 * A failed refresh degrades to `'unknown'` and is NOT cached, but the next
 * outbound attempt is postponed by an exponential backoff (2s → 4s → … → cap,
 * default 60s) so the host keeps retrying at most once per cap interval — the
 * verdict self-heals as soon as the network recovers without hammering the
 * endpoint (spec: 降级后可恢复，不停留在降级态).
 *
 * A fingerprint change (interface/reconnect) bypasses the backoff window and
 * re-queries immediately: the old conclusion belonged to a different network.
 */
export class NetworkVerdictCache {
  private cached: CacheEntry | null = null
  private flight: Promise<GuardCheckResult> | null = null
  /** Fingerprint of the most recent refresh attempt (success or failure). */
  private lastFingerprint: string | null = null
  private nextAttemptAtMs = 0
  private backoffMs: number
  private lastReason: NonNullable<GuardCheckResult['degradedReason']> = 'fetch-failed'

  public constructor(
    private readonly source: VerdictSource,
    private readonly now: () => number,
    private readonly options: VerdictCacheOptions,
  ) {
    this.backoffMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
  }

  /**
   * Answer the guard's network verdict, serving the cache when fresh.
   *
   * Never throws: every failure path lands in a degraded `'unknown'` result.
   * @returns the verdict plus freshness metadata (no IP ever).
   */
  public async check(): Promise<GuardCheckResult> {
    const fingerprint = this.source.fingerprint()
    const now = this.now()
    const entry = this.cached
    if (entry !== null && now - entry.fetchedAtMs < this.options.ttlMs && entry.fingerprint === fingerprint) {
      return {
        verdict: entry.verdict,
        sampledAt: entry.fetchedAtMs,
        freshForMs: this.options.ttlMs - (now - entry.fetchedAtMs),
        degraded: false,
      }
    }
    // Same network that just failed: stay inside the backoff window.
    if (this.flight === null && this.lastFingerprint === fingerprint && now < this.nextAttemptAtMs) {
      return { verdict: 'unknown', degraded: true, degradedReason: this.lastReason }
    }
    if (this.flight === null) {
      this.flight = this.refresh(fingerprint).finally(() => {
        this.flight = null
      })
    }
    return this.flight
  }

  private async refresh(fingerprint: string): Promise<GuardCheckResult> {
    const sampledAt = this.now()
    this.lastFingerprint = fingerprint
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.fetchTimeoutMs)
    timer.unref?.()
    try {
      let ip: string
      try {
        ip = await this.source.fetchIp(controller.signal)
      } catch (error) {
        if (controller.signal.aborted) throw new FetchTimedOutError('egress fetch timed out')
        if (error instanceof EgressInvalidResponseError) throw error
        throw new EgressFetchError(error instanceof Error ? error.message : String(error))
      }
      if (controller.signal.aborted) throw new FetchTimedOutError('egress fetch timed out')
      const verdict = this.source.classify(ip)
      this.cached = { verdict, fetchedAtMs: sampledAt, fingerprint }
      this.nextAttemptAtMs = 0
      this.backoffMs = this.options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
      return { verdict, sampledAt, freshForMs: this.options.ttlMs, degraded: false }
    } catch (error) {
      const reason = error instanceof FetchTimedOutError
        ? 'timeout'
        : error instanceof EgressInvalidResponseError
          ? 'invalid-response'
          : 'fetch-failed'
      this.lastReason = reason
      // Same network failed: back off. A later fingerprint change bypasses this.
      const backoff = this.backoffMs
      this.nextAttemptAtMs = sampledAt + backoff
      this.backoffMs = Math.min(backoff * 2, this.options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS)
      return { verdict: 'unknown', degraded: true, degradedReason: reason }
    } finally {
      clearTimeout(timer)
    }
  }
}