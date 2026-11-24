/**
 * Credential-bearing header rules (design D4, D5). Host-side cookie handling is
 * the security boundary: only cookies named `dshls.<A>.<fam>.<port>.*` reach the
 * upstream, so `dsh-auth-*`, Cockpit and every other same-host cookie never do.
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http'
import { AUTHORITY_HASH_LENGTH, namePrefix } from '../contract.js'
import type { ProxyTarget } from './target.js'

/**
 * `<A>`: first 8 chars of base64url(SHA-256(Host header value)). The Host value is
 * the DSH `host:port` the browser sees (the tunnel's local port under Cockpit).
 * Namespace separator only — not a credential. Shared by HTTP and WebSocket.
 */
export function authorityHash(hostHeader: string): string {
  return createHash('sha256').update(hostHeader).digest('base64url').slice(0, AUTHORITY_HASH_LENGTH)
}

/** The `dshls.<A>.<fam>.<port>.` prefix for a request's own authority and target. */
export function cookiePrefix(req: IncomingMessage, target: ProxyTarget): string {
  return namePrefix(authorityHash(req.headers.host ?? ''), target.fam, target.port)
}

/**
 * Keep only cookies carrying `prefix`, strip it. Returns undefined when none remain
 * (the Cookie header is then omitted entirely).
 */
export function filterCookieHeader(cookieHeader: string | string[] | undefined, prefix: string): string | undefined {
  if (cookieHeader === undefined) return undefined
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader
  const kept: string[] = []
  for (const part of raw.split(';')) {
    const pair = part.trim()
    if (pair.startsWith(prefix) && pair.length > prefix.length) kept.push(pair.slice(prefix.length))
  }
  return kept.length === 0 ? undefined : kept.join('; ')
}

/**
 * Upstream `Set-Cookie` → browser: name gets `prefix`, `Domain` removed, `Path` fixed to `/`,
 * everything else (HttpOnly, Secure, SameSite, Max-Age, Expires, …) kept in order.
 */
export function rewriteSetCookie(setCookie: string, prefix: string): string {
  const [pair = '', ...attributes] = setCookie.split(';').map((part) => part.trim())
  const kept = attributes.filter((attribute) => {
    const name = attribute.split('=', 1)[0]?.trim().toLowerCase()
    return attribute !== '' && name !== 'path' && name !== 'domain'
  })
  return [`${prefix}${pair}`, ...kept, 'Path=/'].join('; ')
}

/** Conditional request headers dropped for document requests (design D5; avoids reusing stale injected HTML). */
const DOCUMENT_CONDITIONALS = ['if-none-match', 'if-modified-since']

/** Hop-by-hop request headers the proxy never forwards (RFC 9110 §7.6.1 plus common non-standard ones). */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade', 'transfer-encoding', 'proxy-authenticate', 'expect'])

/** Request headers for the upstream, derived from the browser request (spec 请求与响应头的凭据处理). */
export function buildUpstreamHeaders(req: IncomingMessage, target: ProxyTarget): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue
    out[name] = value
  }
  out.host = target.authority
  out['accept-encoding'] = 'identity'

  // Cookie: allow-list by prefix (never a deny-list).
  const cookie = filterCookieHeader(req.headers.cookie, cookiePrefix(req, target))
  if (cookie === undefined) delete out.cookie
  else out.cookie = cookie

  delete out['proxy-authorization']
  // `Authorization` is forwarded verbatim to this request's target and never added.

  if (out.origin !== undefined) out.origin = target.origin
  if (out.referer !== undefined) out.referer = `${target.origin}/`

  const dest = req.headers['sec-fetch-dest']
  if (dest === 'iframe' || dest === 'document') for (const name of DOCUMENT_CONDITIONALS) delete out[name]
  return out
}
