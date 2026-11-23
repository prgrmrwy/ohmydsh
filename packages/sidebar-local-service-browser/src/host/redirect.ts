/**
 * `Location` handling and framing headers (spec 重定向与外部跳转).
 *
 * The upstream Location is resolved against the upstream request URL with WHATWG
 * URL rules and then classified: loopback targets become proxy paths; anything
 * else is "external" and, for navigations, replaced by a notice page so the
 * iframe is never navigated to another origin.
 */
import { proxyPath } from '../contract.js'
import type { ProxyTarget } from './target.js'
import { parsePort } from './target.js'

export type LocationOutcome =
  | { kind: 'proxy'; location: string }
  | { kind: 'external'; url: string }
  | { kind: 'unchanged' }

export function classifyLocation(location: string, target: ProxyTarget): LocationOutcome {
  let url: URL
  try {
    url = new URL(location, `${target.origin}${target.path}`)
  } catch {
    return { kind: 'unchanged' }
  }
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  if (!loopback) return { kind: 'external', url: url.href }
  const port = parsePort(url.port === '' ? '80' : url.port)
  if (port === undefined) return { kind: 'external', url: url.href }
  const fam = url.hostname === '[::1]' ? 'p6' : 'p'
  return { kind: 'proxy', location: `${proxyPath(fam, port, `${url.pathname}${url.search}`)}${url.hash}` }
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** Notice page returned instead of an external redirect on a navigation. */
export function externalRedirectNotice(url: string): string {
  const safe = escapeHtml(url)
  return `<!doctype html><html><head><meta charset="utf-8"><title>External redirect</title></head><body>`
    + `<p>此页面想跳转到外部地址 / This page tried to redirect to an external address:</p>`
    + `<p><code>${safe}</code></p>`
    + `<p><a href="${safe}" target="_blank" rel="noopener">在新窗口打开 / Open in a new window</a></p>`
    + `</body></html>`
}

/**
 * Remove `frame-ancestors` from every policy of a CSP header value. Returns
 * undefined when nothing is left (the header is then dropped).
 */
export function stripFrameAncestors(csp: string): string | undefined {
  const policies = csp.split(',').map((policy) => policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '' && directive.split(/\s+/, 1)[0]?.toLowerCase() !== 'frame-ancestors')
    .join('; '))
    .filter((policy) => policy !== '')
  return policies.length === 0 ? undefined : policies.join(', ')
}
