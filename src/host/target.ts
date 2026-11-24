/**
 * Proxy target parsing (design D1/D3). The target host is decided by the
 * family alone; nothing in the request can name another host.
 */
import { ROUTE_PREFIX } from '../contract.js'
import type { Family } from '../contract.js'

export interface ProxyTarget {
  fam: Family
  port: number
  /** Connect address: `p` → 127.0.0.1, `p6` → ::1. */
  host: '127.0.0.1' | '::1'
  /** Upstream `Host` header / origin authority: `127.0.0.1:<port>` or `[::1]:<port>`. */
  authority: string
  /** `http://127.0.0.1:<port>` or `http://[::1]:<port>`. */
  origin: string
  /** Raw request target for the upstream: path + query, always starting with '/'. */
  path: string
}

export type TargetParse =
  | { kind: 'target'; target: ProxyTarget }
  /** The URL is under the family prefix but its port segment is not a decimal 1–65535. */
  | { kind: 'bad-port' }
  /** Not a proxy path at all. */
  | { kind: 'none' }

const FAMILY_HOST = { p: '127.0.0.1', p6: '::1' } as const

/** Canonical decimal 1–65535 (no sign, no leading zeros, no whitespace). */
export function parsePort(segment: string): number | undefined {
  if (!/^[1-9][0-9]{0,4}$/.test(segment)) return undefined
  const port = Number(segment)
  return port >= 1 && port <= 65535 ? port : undefined
}

export function targetFor(fam: Family, port: number, path = '/'): ProxyTarget {
  const host = FAMILY_HOST[fam]
  const authority = fam === 'p6' ? `[::1]:${String(port)}` : `127.0.0.1:${String(port)}`
  return { fam, port, host, authority, origin: `http://${authority}`, path }
}

/**
 * Parse a raw request target (`req.url`) of the form
 * `/dsh-local-service/<p|p6>/<port><rest>`. The rest (path + query) is taken
 * verbatim from the raw URL, never re-serialized.
 */
export function parseProxyUrl(rawUrl: string): TargetParse {
  const match = new RegExp(`^${ROUTE_PREFIX}/(p6?)/([^/?#]*)(.*)$`, 's').exec(rawUrl)
  if (match === null) return { kind: 'none' }
  const fam = match[1] as Family
  const port = parsePort(match[2] ?? '')
  if (port === undefined) return { kind: 'bad-port' }
  let rest = match[3] ?? ''
  if (rest === '' || rest.startsWith('?')) rest = `/${rest}`
  if (!rest.startsWith('/')) return { kind: 'none' }
  return { kind: 'target', target: targetFor(fam, port, rest) }
}
