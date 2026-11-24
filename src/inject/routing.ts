/** Address classification shared by navigation, form and WebSocket rewriting. */
import { ROUTE_PREFIX, proxyPath, type Family } from '../contract.js'

export type Classified =
  /** Already under the plugin prefix (proxy path): leave alone. */
  | { kind: 'proxied' }
  /** Same-origin non-proxy path, or a loopback address: send through the proxy. */
  | { kind: 'rewrite'; to: string; fam: Family; port: string; rest: string }
  /** `about:` and friends the tab itself uses. */
  | { kind: 'allowed' }
  | { kind: 'external'; url: string }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function classify(url: URL, selfOrigin: string, current: { fam: Family; port: string }): Classified {
  if (url.protocol === 'about:') return { kind: 'allowed' }
  if (url.origin === selfOrigin) {
    if (url.pathname.startsWith(`${ROUTE_PREFIX}/`)) return { kind: 'proxied' }
    const rest = url.pathname + url.search + url.hash
    return { kind: 'rewrite', to: proxyPath(current.fam, current.port, rest), fam: current.fam, port: current.port, rest }
  }
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) {
    const fam: Family = url.hostname === '[::1]' ? 'p6' : 'p'
    const port = url.port === '' ? '80' : url.port
    const rest = url.pathname + url.search + url.hash
    return { kind: 'rewrite', to: proxyPath(fam, port, rest), fam, port, rest }
  }
  return { kind: 'external', url: url.href }
}

/** WebSocket: map a page URL to the single Host upgrade entry, or undefined to leave it alone. */
export function webSocketTarget(raw: string | URL, base: string, current: { fam: Family; port: string }, wsRoute: string): string | undefined {
  let u: URL
  try {
    u = new URL(String(raw), base)
  } catch {
    return undefined
  }
  const proto = u.protocol
  if (proto !== 'ws:' && proto !== 'wss:' && proto !== 'http:' && proto !== 'https:') return undefined
  const self = new URL(base)
  let fam: Family
  let port: string
  if (u.host === self.host) {
    fam = current.fam
    port = current.port
  } else if ((proto === 'ws:' || proto === 'http:') && LOOPBACK.has(u.hostname)) {
    fam = u.hostname === '[::1]' ? 'p6' : 'p'
    port = u.port === '' ? '80' : u.port
  } else {
    return undefined
  }
  const scheme = self.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${self.host}${wsRoute}?fam=${fam}&port=${port}&path=${encodeURIComponent(u.pathname + u.search)}`
}
