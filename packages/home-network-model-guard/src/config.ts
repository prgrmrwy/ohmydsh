/**
 * Local guard configuration: blocklist countries, Geo endpoints, cache knobs.
 *
 * Real values live on the DSH host at
 * `$DSH_HOME/plugins/dsh-home-network-model-guard/config.json` — never in the
 * public repository. The repository ships only defaults and the schema. All
 * fields are non-secret; credentials, private keys, tokens and URL userinfo
 * are rejected on write.
 *
 * @module dsh-home-network-model-guard/config
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Default blocklist: mainland-China egress is blocked until configured otherwise. */
export const DEFAULT_BLOCKED_COUNTRIES: readonly string[] = ['CN']

/** Default primary and fallback Geo IP-location endpoints. */
export const DEFAULT_GEO_ENDPOINTS: readonly [string, string] = [
  'https://ipinfo.io/json',
  'https://ipwho.is/',
]

/** ISO 3166-1 alpha-2 country code pattern. */
const COUNTRY_CODE_RE = /^[A-Z]{2}$/

/** Credential-ish field names rejected on write. */
const FORBIDDEN_FIELD_RE = /(password|secret|token|credential|private.?key|api.?key)/i

/**
 * The parsed, validated guard configuration.
 */
export interface GuardConfig {
  /** ISO 3166-1 alpha-2 codes whose egress blocks Claude (default `CN`). */
  readonly blockedCountries: readonly string[]
  /** [primary, fallback] HTTPS Geo endpoints. */
  readonly geoEndpoints: readonly [string, string]
  /** Per-request abort delay, ms. */
  readonly timeoutMs: number
  /** Verdict cache TTL for an unchanged fingerprint/epoch, ms. */
  readonly ttlMs: number
  /** First backoff after a failed Geo resolution, ms. */
  readonly backoffBaseMs: number
  /** Sustained retry cadence ceiling, ms (default 60s). */
  readonly backoffMaxMs: number
}

/** Ship-safe defaults; overridden by the host config file when valid. */
export const DEFAULT_CONFIG: GuardConfig = Object.freeze({
  blockedCountries: DEFAULT_BLOCKED_COUNTRIES,
  geoEndpoints: DEFAULT_GEO_ENDPOINTS,
  timeoutMs: 5_000,
  ttlMs: 5 * 60_000,
  backoffBaseMs: 2_000,
  backoffMaxMs: 60_000,
})

function isHttpJsonEndpointUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length > 512) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  // No credentials embedded in the URL.
  if (url.username !== '' || url.password !== '') return false
  return true
}

function isCountryList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0 || value.length > 64) return false
  return value.every((entry) => typeof entry === 'string' && COUNTRY_CODE_RE.test(entry))
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Validate an unknown config value against the schema. Rejects credential
 * fields, non-HTTPS endpoints, URL userinfo and malformed country codes.
 *
 * @param raw - parsed JSON value.
 * @returns the validated config, or an error message.
 */
export function validateGuardConfig(raw: unknown): { ok: true; config: GuardConfig } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'config must be a JSON object' }
  }
  for (const key of Object.keys(raw as object)) {
    if (FORBIDDEN_FIELD_RE.test(key)) return { ok: false, error: `rejected field "${key}": credentials are not allowed` }
  }
  const record = raw as Record<string, unknown>

  let blockedCountries: readonly string[] = DEFAULT_BLOCKED_COUNTRIES
  if (record.blockedCountries !== undefined) {
    if (!isCountryList(record.blockedCountries)) return { ok: false, error: 'blockedCountries must be a list of ISO alpha-2 codes' }
    blockedCountries = [...new Set(record.blockedCountries.map((c) => c.toUpperCase()))]
  }

  let geoEndpoints: readonly [string, string] = DEFAULT_GEO_ENDPOINTS
  if (record.geoEndpoints !== undefined) {
    if (!Array.isArray(record.geoEndpoints) || record.geoEndpoints.length !== 2) {
      return { ok: false, error: 'geoEndpoints must contain exactly [primary, fallback] HTTPS URLs' }
    }
    const [primary, fallback] = record.geoEndpoints
    if (!isHttpJsonEndpointUrl(primary) || !isHttpJsonEndpointUrl(fallback)) {
      return { ok: false, error: 'geoEndpoints must be credential-free HTTPS URLs' }
    }
    geoEndpoints = [primary, fallback]
  }

  const pickNumber = (key: string, fallback: number): number => {
    const value = record[key]
    if (value === undefined) return fallback
    if (!isPositiveNumber(value)) throw new Error(`config field "${key}" must be a positive number`)
    return value
  }

  let timeoutMs = DEFAULT_CONFIG.timeoutMs
  let ttlMs = DEFAULT_CONFIG.ttlMs
  let backoffBaseMs = DEFAULT_CONFIG.backoffBaseMs
  let backoffMaxMs = DEFAULT_CONFIG.backoffMaxMs
  try {
    timeoutMs = pickNumber('timeoutMs', timeoutMs)
    ttlMs = pickNumber('ttlMs', ttlMs)
    backoffBaseMs = pickNumber('backoffBaseMs', backoffBaseMs)
    backoffMaxMs = pickNumber('backoffMaxMs', backoffMaxMs)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid numeric config field' }
  }
  if (backoffMaxMs < backoffBaseMs) return { ok: false, error: 'backoffMaxMs must be >= backoffBaseMs' }

  return { ok: true, config: { blockedCountries, geoEndpoints, timeoutMs, ttlMs, backoffBaseMs, backoffMaxMs } }
}

/**
 * Load and validate the host config file. Any missing/invalid file falls back
 * to {@link DEFAULT_CONFIG} (which keeps Claude fail-closed); the caller can
 * use {@link configEpochOf} to surface the fallback in diagnostics.
 *
 * @param path - host config file path.
 * @returns validated config; never throws.
 */
export function loadGuardConfig(path: string): GuardConfig {
  try {
    if (!existsSync(path)) return DEFAULT_CONFIG
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const result = validateGuardConfig(raw)
    return result.ok ? result.config : DEFAULT_CONFIG
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Config-generation identity for cache invalidation: mtime of the host
 * config file plus a fallback marker. A config write/replace changes the
 * epoch, so cached verdicts from an older config are never reused.
 *
 * @param path - host config file path.
 * @returns an opaque epoch string (never contains file content).
 */
export function configEpochOf(path: string): string {
  try {
    const stat = statSync(path)
    return `m:${stat.mtimeMs}`
  } catch {
    return 'default'
  }
}

/**
 * Validate and atomically write the host config file.
 *
 * The write goes to a temp file in the same directory (owner-only mode),
 * then renames over the target — a crash mid-write never leaves a truncated
 * config behind. The config directory is created with owner-only access.
 *
 * @param path - host config file path.
 * @param raw - parsed JSON value from the caller.
 * @returns `{ ok: true }` or a validation error; throws only on fs failure.
 */
export async function writeGuardConfig(configFile: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = validateGuardConfig(raw)
  if (!result.ok) return result
  await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 })
  const tmp = `${configFile}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify(result.config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, configFile)
  return { ok: true }
}