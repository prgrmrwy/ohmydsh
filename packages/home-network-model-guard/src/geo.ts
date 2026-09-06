/**
 * Dual-backup Geo country resolution.
 *
 * Resolves the egress country/region code through two HTTPS IP-location
 * services used as backups of each other: the primary is tried first; on any
 * failure (transport, timeout, malformed body) the fallback is tried. Only
 * when BOTH fail does the caller see `null` → the verdict becomes `unknown`
 * and Claude fails closed (spec: 两个服务均不可达才判定未知).
 *
 * No local information is sent beyond what the services themselves require;
 * only the resolved country code is returned — the raw IP never leaves this
 * module's response object.
 *
 * @module dsh-home-network-model-guard/geo
 */

/** One resolved egress country code. */
export interface GeoCountryResult {
  /** ISO 3166-1 alpha-2 country code, upper-cased. */
  readonly country: string
  /** Which service produced the answer. */
  readonly source: 'primary' | 'fallback'
}

/**
 * Why a resolution failed. Mirrors the `degradedReason` vocabulary so the
 * cache can adopt the attribution verbatim instead of re-deriving it from
 * error text (design D5).
 */
export type GeoFailureReason = 'timeout' | 'invalid-response' | 'fetch-failed'

/**
 * Transport/parse failure for one Geo attempt.
 *
 * `reason` feeds the cache's `degradedReason` verbatim (design D5).
 * `transient` is an independent axis: it marks failures worth one immediate
 * retry within the same endpoint budget (design D3). A malformed body is
 * `invalid-response` but NOT transient — retrying yields the same answer.
 */
export class GeoServiceError extends Error {
  public constructor(
    message: string,
    public readonly reason: GeoFailureReason = 'fetch-failed',
    public readonly transient: boolean = true,
  ) {
    super(message)
    this.name = 'GeoServiceError'
  }
}

/** One endpoint exhausted its own budget (or the caller cancelled). */
export class GeoTimedOutError extends GeoServiceError {
  public constructor(message: string) {
    super(message, 'timeout', false)
    this.name = 'GeoTimedOutError'
  }
}

/** The endpoint answered, but the answer is unusable. */
export class GeoInvalidResponseError extends GeoServiceError {
  public constructor(message: string, transient: boolean) {
    super(message, 'invalid-response', transient)
    this.name = 'GeoInvalidResponseError'
  }
}

/** A failed resolution carrying its attribution. */
export interface GeoFailure {
  readonly reason: GeoFailureReason
}

/** Either a resolved country or an attributed failure. */
export type GeoResolution = GeoCountryResult | GeoFailure

/** Narrow a resolution to the success shape. */
export function isGeoCountryResult(value: GeoResolution): value is GeoCountryResult {
  return 'country' in value
}

/** Country-code candidates recognized across common Geo JSON payloads. */
const COUNTRY_FIELD_KEYS = ['country', 'countryCode', 'country_code'] as const

/** ISO 3166-1 alpha-2 country code pattern. */
const COUNTRY_CODE_RE = /^[A-Z]{2}$/

/**
 * Extract a valid country code from a parsed Geo JSON payload.
 * @param payload - parsed JSON object.
 * @returns the upper-cased country code, or undefined.
 */
export function countryCodeOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  for (const key of COUNTRY_FIELD_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const upper = value.toUpperCase()
    if (COUNTRY_CODE_RE.test(upper)) return upper
  }
  return undefined
}

/**
 * Try one Geo endpoint: fetch, parse, extract the country code.
 *
 * @param fetchImpl - injected `fetch`-compatible implementation.
 * @param endpoint - HTTPS Geo URL.
 * @param signal - caller-owned abort (timeout wiring lives in the source).
 * @returns the resolved country code.
 * @throws {@link GeoServiceError} on non-OK, non-JSON or country-less bodies.
 */
export async function fetchCountryOf(fetchImpl: typeof fetch, endpoint: string, signal: AbortSignal): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(endpoint, { signal })
  } catch (error) {
    if (signal.aborted) throw new GeoTimedOutError('attempt aborted')
    throw new GeoServiceError(error instanceof Error ? error.message : 'transport failure')
  }
  // A non-2xx is worth one retry (the endpoint may be briefly degraded); a
  // malformed body is deterministic and must NOT be retried (design D3).
  if (!response.ok) throw new GeoInvalidResponseError(`endpoint answered ${response.status}`, true)
  let payload: unknown
  try {
    payload = JSON.parse(await response.text()) as unknown
  } catch {
    throw new GeoInvalidResponseError('response body is not JSON', false)
  }
  const country = countryCodeOf(payload)
  if (country === undefined) throw new GeoInvalidResponseError('response carried no country code', false)
  return country
}

/** Default per-endpoint budget when the caller does not supply one. */
const DEFAULT_PER_ENDPOINT_TIMEOUT_MS = 5_000

/** Fixed pause before the single in-budget retry (design D3). */
const RETRY_BACKOFF_MS = 150

/** Sleep that resolves early when the signal aborts (never rejects). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Primary-then-fallback Geo country source.
 *
 * @param endpoints - `[primary, fallback]` HTTPS Geo endpoints.
 * @param fetchImpl - injected `fetch`-compatible implementation.
 */
export class GeoCountrySource {
  public constructor(
    private readonly endpoints: readonly [string, string],
    private readonly fetchImpl: typeof fetch,
  ) {}

  /**
   * Resolve the egress country code with primary→fallback failover.
   *
   * Each endpoint gets its OWN timeout budget: a slow or hanging primary
   * consumes only its own budget and can never starve the fallback of its
   * attempt (spec: 任一端点的超时、挂起或耗时 MUST NOT 剥夺另一端点的尝试机会).
   * Only the caller's own cancellation short-circuits the whole loop.
   *
   * @param signal - caller-owned abort (cancels every remaining attempt).
   * @param perEndpointTimeoutMs - per-endpoint budget in ms.
   * @returns the resolved country and its source, or `null` when BOTH
   * services failed (or the caller aborted).
   */
  public async resolveCountry(
    signal: AbortSignal,
    perEndpointTimeoutMs: number = DEFAULT_PER_ENDPOINT_TIMEOUT_MS,
  ): Promise<GeoResolution> {
    let lastReason: GeoFailureReason = 'fetch-failed'
    for (const [index, endpoint] of this.endpoints.entries()) {
      // Only the caller's cancellation skips the remaining endpoints; a
      // previous endpoint's exhausted budget MUST NOT short-circuit here.
      if (signal.aborted) return { reason: 'timeout' }
      try {
        const country = await this.attemptEndpoint(endpoint, signal, perEndpointTimeoutMs)
        return { country, source: index === 0 ? 'primary' : 'fallback' }
      } catch (error) {
        // Attribution of the LAST endpoint wins: it is the final fact before
        // the resolution gives up (design D5).
        lastReason = error instanceof GeoServiceError ? error.reason : 'fetch-failed'
        // fall through to the next service (backup semantics)
      }
    }
    return { reason: lastReason }
  }

  /**
   * One endpoint attempt bounded by its own budget, combined with the caller's
   * signal so either source of cancellation aborts the in-flight request.
   *
   * A transient failure is retried at most once inside this same budget after
   * a short fixed backoff (design D3). Budget exhaustion and deterministic
   * bad bodies are never retried.
   */
  private async attemptEndpoint(endpoint: string, callerSignal: AbortSignal, budgetMs: number): Promise<string> {
    const combined = AbortSignal.any([callerSignal, AbortSignal.timeout(budgetMs)])
    try {
      return await fetchCountryOf(this.fetchImpl, endpoint, combined)
    } catch (error) {
      const retriable = error instanceof GeoServiceError && error.transient && !combined.aborted
      if (!retriable) throw error
      await delay(RETRY_BACKOFF_MS, combined)
      if (combined.aborted) throw new GeoTimedOutError('budget exhausted before retry')
      return await fetchCountryOf(this.fetchImpl, endpoint, combined)
    }
  }
}