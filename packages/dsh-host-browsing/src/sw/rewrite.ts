/** Pure request-rewrite rules of the plugin Service Worker (spec: 本插件 Service Worker 改写受控页面的子请求). */
import { ROUTE_PREFIX, proxyPath, type Family } from '../contract.js'
import type { ClientTarget } from './store.js'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export type RewriteDecision =
  /** Not ours: let the browser handle the request untouched. */
  | { kind: 'pass' }
  /** Same-origin, non-proxy path: needs the client's target. */
  | { kind: 'client-relative'; rest: string }
  /** Explicit loopback address. */
  | { kind: 'loopback'; to: string }

export function decide(url: URL, selfOrigin: string): RewriteDecision {
  if (url.origin === selfOrigin) {
    if (url.pathname.startsWith(`${ROUTE_PREFIX}/`)) return { kind: 'pass' }
    return { kind: 'client-relative', rest: url.pathname + url.search }
  }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    const fam: Family = url.hostname === '[::1]' ? 'p6' : 'p'
    return { kind: 'loopback', to: proxyPath(fam, url.port === '' ? '80' : url.port, url.pathname + url.search) }
  }
  return { kind: 'pass' }
}

export function forClient(target: ClientTarget, rest: string): string {
  return proxyPath(target.fam, target.port, rest)
}
