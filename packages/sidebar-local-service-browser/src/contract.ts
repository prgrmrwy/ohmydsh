/**
 * Shared contract between the Host proxy, the injected page script, the
 * plugin Service Worker and the better-sidebar tab of
 * dsh-sidebar-local-service-browser.
 *
 * Source of truth: openspec/changes/sidebar-local-service-browser/{specs,design}.
 * Every literal that two halves must agree on lives here; neither half may
 * hard-code a copy. Changing a value here is a contract change — update the
 * spec first.
 *
 * @module dsh-sidebar-local-service-browser/contract
 */

/** Host prefix route (registered WITHOUT a trailing slash; webserver prefix match is `p === prefix || p.startsWith(prefix + '/')`). */
export const ROUTE_PREFIX = '/dsh-local-service'

/** Exact upgrade route for proxied WebSockets: `?fam=&port=&path=`. */
export const WS_ROUTE = `${ROUTE_PREFIX}/ws`

/** Plugin Service Worker script; its default scope is SW_SCOPE. */
export const SW_SCRIPT = `${ROUTE_PREFIX}/sw.js`
export const SW_SCOPE = `${ROUTE_PREFIX}/`

/** Read-only service discovery endpoint: `GET` → JSON `ServiceEntry[]` sorted by port ascending. */
export const SERVICES_ROUTE = `${ROUTE_PREFIX}/services`

/** One discovered web service on the Host machine (`process` is a bare executable name or null). */
export interface ServiceEntry {
  fam: Family
  port: number
  process: string | null
}

/** Target families: `p` → Host 127.0.0.1, `p6` → Host ::1. */
export type Family = 'p' | 'p6'
export const FAMILIES: readonly Family[] = ['p', 'p6']

/** Proxy path for a target: `/dsh-local-service/<fam>/<port><rest>` (rest starts with '/'). */
export function proxyPath(fam: Family, port: number | string, rest = '/'): string {
  return `${ROUTE_PREFIX}/${fam}/${String(port)}${rest.startsWith('/') ? rest : `/${rest}`}`
}

/** Matches a proxy pathname; groups: fam, port, rest (rest may be ''). */
export const PROXY_PATH_RE = /^\/dsh-local-service\/(p6?)\/(\d+)(\/.*)?$/

/** iframe attribute carrying the tab's random frame id; marks "this is the tab iframe". */
export const FRAME_ATTR = 'data-dshls'

/** Native sessionStorage key holding one frame's identity table: `${ENTRIES_KEY_PREFIX}${frameId}`. */
export const ENTRIES_KEY_PREFIX = '__dshls.entries.'
/** Max identity records kept per frame (oldest-written evicted first). */
export const ENTRIES_MAX = 500

/** One identity record: which target an entry (keyed by navigation entry key) belongs to. */
export interface EntryIdentity {
  fam: Family
  /** Decimal port string. */
  port: string
  /** pathname + search + hash as the page saw it; starts with '/'. */
  rest: string
}

/** Cookie/storage name prefix: `dshls.<A>.<fam>.<port>.` where A = authorityHash(Host header). */
export function namePrefix(authorityHash: string, fam: Family, port: number | string): string {
  return `dshls.${authorityHash}.${fam}.${String(port)}.`
}

/** Length of the base64url SHA-256 prefix used as authority hash. */
export const AUTHORITY_HASH_LENGTH = 8

/** Read-only marker the injected script defines on `window` once fully installed. */
export const INJECT_MARKER = '__dshlsMarker'

/**
 * Per-response configuration the Host bakes into the inline injected script.
 * The injected bundle reads it from `globalThis[INJECT_CONFIG_GLOBAL]`, which
 * the Host defines in the same inline <script> right before the bundle text.
 */
export const INJECT_CONFIG_GLOBAL = '__dshlsConfig'
export interface InjectConfig {
  fam: Family
  port: string
  /** Full cookie/storage prefix (namePrefix(...)); the page never computes the hash itself. */
  prefix: string
}

/** Messages from the injected script (inside the tab iframe) to the tab (its parent). Sent with postMessage to the same origin. */
export type InjectToTabMessage =
  | { type: 'dshls:installed'; fam: Family; port: string; rest: string }
  | { type: 'dshls:location'; fam: Family; port: string; rest: string }
  | { type: 'dshls:uncontrolled' }
  | { type: 'dshls:identity-unavailable'; reason: string }
  | { type: 'dshls:external'; url: string }

/** Message tag namespace check. */
export function isInjectMessage(data: unknown): data is InjectToTabMessage {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string' && (data as { type: string }).type.startsWith('dshls:')
}

/** better-sidebar tab id. */
export const TAB_ID = 'sidebar-local-service-browser'
