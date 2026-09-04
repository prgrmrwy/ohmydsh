/**
 * Host network sampling: local fingerprint, Geo country resolution, verdict
 * cache with configuration-generation awareness.
 *
 * All pieces are dependency-injected (fingerprint input, country resolver,
 * clock, epoch) so the cache semantics — TTL, fingerprint/epoch invalidation,
 * single-flight coalescing, exponential backoff with sustained retry — are
 * fully unit-testable without real network or `node:os`.
 *
 * The produced {@link GuardCheckResult} never carries the IP: the raw address
 * lives only inside the injected Geo source and is never exposed to the RPC
 * layer.
 *
 * @module dsh-home-network-model-guard/network
 */
import type { GuardCheckResult, NetworkVerdict } from './contract.js'

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

/** Sources the cache needs; each is injected so the cache stays unit-testable. */
export interface VerdictSource {
  /** Current local network fingerprint (see {@link fingerprintOf}). */
  fingerprint(): string
  /** Current config-generation identity (config writes invalidate verdicts). */
  epoch(): string
  /**
   * Resolve the egress country code with primary→fallback failover.
   * @returns the country code, or `null` when BOTH services failed.
   */
  fetchCountry(signal: AbortSignal): Promise<{ readonly country: string; readonly source: 'primary' | 'fallback' } | null>
  /** Map one resolved country code to a verdict (blocklist semantics). */
  classify(country: string): NetworkVerdict
}

/** Cache knobs. */
export interface VerdictCacheOptions {
  /** How long a fresh verdict stays valid for an unchanged fingerprint/epoch. */
  readonly ttlMs: number
  /** Abort a Geo fetch after this long; the answer then degrades. */
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
  epoch: string
}

/** Default sustained retry cadence: 2s → 4s → … → 60s, then keep trying. */
const DEFAULT_BACKOFF_BASE_MS = 2_000
const DEFAULT_BACKOFF_MAX_MS = 60_000

/** Timeout elevated so the degradation reason maps to `'timeout'`. */
class FetchTimedOutError extends Error {}

/**
 * Cached, single-flight network verdict source with sustained retry.
 *
 * Hit condition: TTL not expired AND fingerprint unchanged AND config epoch
 * unchanged. Any miss starts a refresh; concurrent callers share one in-flight
 * refresh (single-flight). A failed refresh degrades to `'unknown'` and is NOT
 * cached, but the next outbound attempt is postponed by an exponential backoff
 * (2s → 4s → … → cap, default 60s) so the host keeps retrying at most once per
 * cap interval — the verdict self-heals as soon as the services recover
 * without hammering the endpoints.
 *
 * A fingerprint change (interface/reconnect) or a config epoch change bypasses
 * the backoff window and re-queries immediately: the old conclusion belonged
 * to a different network or policy.
 */
export class NetworkVerdictCache {
  private cached: CacheEntry | null = null
  private flight: Promise<GuardCheckResult> | null = null
  /** Fingerprint of the most recent refresh attempt (success or failure). */
  private lastFingerprint: string | null = null
  /** Epoch of the most recent refresh attempt. */
  private lastEpoch: string | null = null
  private nextAttemptAtMs = 0
  private backoffMs: number
  private lastReason: NonNullable<GuardCheckResult['degradedReason']> = 'fetch-failed'
  /** Latest successful resolution facts, kept for the settings diagnosis only. */
  private lastResolution: { country: string; source: 'primary' | 'fallback'; atMs: number } | null = null

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
    const epoch = this.source.epoch()
    const now = this.now()
    const entry = this.cached
    if (entry !== null && now - entry.fetchedAtMs < this.options.ttlMs && entry.fingerprint === fingerprint && entry.epoch === epoch) {
      return {
        verdict: entry.verdict,
        sampledAt: entry.fetchedAtMs,
        freshForMs: this.options.ttlMs - (now - entry.fetchedAtMs),
        degraded: false,
      }
    }
    // Same network AND same config that just failed: stay inside the backoff
    // window. A fingerprint or epoch change bypasses it immediately.
    if (this.flight === null && this.lastFingerprint === fingerprint && this.lastEpoch === epoch && now < this.nextAttemptAtMs) {
      return { verdict: 'unknown', degraded: true, degradedReason: this.lastReason }
    }
    if (this.flight === null) {
      this.flight = this.refresh(fingerprint, epoch).finally(() => {
        this.flight = null
      })
    }
    return this.flight
  }

  private async refresh(fingerprint: string, epoch: string): Promise<GuardCheckResult> {
    const sampledAt = this.now()
    this.lastFingerprint = fingerprint
    this.lastEpoch = epoch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.fetchTimeoutMs)
    timer.unref?.()
    try {
      let result: { readonly country: string; readonly source: 'primary' | 'fallback' } | null
      try {
        result = await this.source.fetchCountry(controller.signal)
      } catch (error) {
        if (controller.signal.aborted) throw new FetchTimedOutError('geo fetch timed out')
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      if (controller.signal.aborted) throw new FetchTimedOutError('geo fetch timed out')
      if (result === null) throw new Error('both geo services failed')
      const verdict = this.source.classify(result.country)
      this.cached = { verdict, fetchedAtMs: sampledAt, fingerprint, epoch }
      this.lastResolution = { country: result.country, source: result.source, atMs: sampledAt }
      this.nextAttemptAtMs = 0
      this.backoffMs = this.options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
      return { verdict, sampledAt, freshForMs: this.options.ttlMs, degraded: false }
    } catch (error) {
      const reason = error instanceof FetchTimedOutError
        ? 'timeout'
        : error instanceof Error && /not JSON|no country|non-2xx|status/.test(error.message)
          ? 'invalid-response'
          : 'fetch-failed'
      this.lastReason = reason
      // Same network + config failed: back off. A later fingerprint/epoch
      // change bypasses this.
      const backoff = this.backoffMs
      this.nextAttemptAtMs = sampledAt + backoff
      this.backoffMs = Math.min(backoff * 2, this.options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS)
      return { verdict: 'unknown', degraded: true, degradedReason: reason }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Diagnostics facts for the settings page: the latest successful
   * resolution (country + which service) and its age. Never contains the raw
   * IP; returns `null` when nothing has resolved yet.
   */
  public diagnostics(): { country: string; source: 'primary' | 'fallback'; atMs: number } | null {
    return this.lastResolution
  }
}