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

/** Transport/parse failure for one Geo attempt. */
export class GeoServiceError extends Error {}

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
    throw new GeoServiceError(error instanceof Error ? error.message : 'transport failure')
  }
  if (!response.ok) throw new GeoServiceError(`endpoint answered ${response.status}`)
  let payload: unknown
  try {
    payload = JSON.parse(await response.text()) as unknown
  } catch {
    throw new GeoServiceError('response body is not JSON')
  }
  const country = countryCodeOf(payload)
  if (country === undefined) throw new GeoServiceError('response carried no country code')
  return country
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
   * @param signal - caller-owned abort.
   * @returns the resolved country and its source, or `null` when BOTH
   * services failed (or the signal aborted).
   */
  public async resolveCountry(signal: AbortSignal): Promise<GeoCountryResult | null> {
    for (const [index, endpoint] of this.endpoints.entries()) {
      if (signal.aborted) return null
      try {
        const country = await fetchCountryOf(this.fetchImpl, endpoint, signal)
        return { country, source: index === 0 ? 'primary' : 'fallback' }
      } catch {
        // fall through to the next service (backup semantics)
      }
    }
    return null
  }
}