/**
 * HTTP half of the Host proxy: one handler for the whole `/dsh-local-service`
 * prefix (design D1–D6).
 */
import { request as httpRequest } from 'node:http'
import { pipeline } from 'node:stream'
import type { Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { ROUTE_PREFIX, SW_SCRIPT } from '../contract.js'
import type { InjectConfig } from '../contract.js'
import { admitHttp, sendError } from './gate.js'
import type { BrowserFence } from './gate.js'
import { buildUpstreamHeaders, cookiePrefix, rewriteSetCookie } from './headers.js'
import { classifyLocation, externalRedirectNotice, stripFrameAncestors } from './redirect.js'
import { addNonceToCsp } from './csp.js'
import { HtmlInjector, injectIntoDocument } from './html-inject.js'
import { buildInjectMarkup, newNonce } from './inject.js'
import { parseProxyUrl } from './target.js'
import type { ProxyTarget } from './target.js'

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

export interface ProxyDeps {
  fence: BrowserFence
  /** Read per request: the Host WebServer's live listening port. */
  webServerPort(): number | undefined
  /** Text of the plugin Service Worker script. */
  swSource: string
  connectTimeoutMs: number
  /** Sockets/requests that must be destroyed on unload. */
  inflight: Set<{ destroy(): unknown }>
}

/** Hop-by-hop response headers (Node re-frames the body itself). */
const HOP_BY_HOP_RESPONSE = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade', 'transfer-encoding', 'proxy-authenticate'])

function forwardResponseHeaders(upstream: IncomingMessage, prefix: string): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(upstream.headers as IncomingHttpHeaders)) {
    if (value === undefined || HOP_BY_HOP_RESPONSE.has(name)) continue
    out[name] = value
  }
  if (upstream.headers['set-cookie'] !== undefined) out['set-cookie'] = upstream.headers['set-cookie'].map((cookie) => rewriteSetCookie(cookie, prefix))
  delete out['service-worker-allowed']
  delete out['x-frame-options']
  for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
    const value = upstream.headers[name]
    if (value === undefined) continue
    const stripped = stripFrameAncestors(Array.isArray(value) ? value.join(', ') : value)
    if (stripped === undefined) delete out[name]
    else out[name] = stripped
  }
  return out
}

/** Response worth injecting into: HTML, not HEAD, not 204/206/304. */
function isInjectable(method: string | undefined, status: number, headers: OutgoingHttpHeaders): boolean {
  if (method === 'HEAD' || status === 204 || status === 206 || status === 304) return false
  const type = headers['content-type']
  return typeof type === 'string' && /^\s*text\/html\s*(;|$)/i.test(type)
}

/** Decoder for an upstream Content-Encoding, `null` for identity/none, `undefined` for unsupported. */
function decoderFor(encoding: string | undefined): Transform | null | undefined {
  const value = (encoding ?? 'identity').trim().toLowerCase()
  if (value === '' || value === 'identity') return null
  if (value === 'gzip' || value === 'x-gzip') return createGunzip()
  if (value === 'deflate') return createInflate()
  if (value === 'br') return createBrotliDecompress()
  return undefined
}

export function createHttpHandler(deps: ProxyDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (!admitHttp(deps.fence, req, res)) return
    const rawUrl = req.url ?? '/'
    const pathname = rawUrl.split(/[?#]/, 1)[0] ?? ''
    if (pathname === SW_SCRIPT) {
      serveServiceWorker(deps, req, res)
      return
    }
    if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) {
      sendError(res, 404)
      return
    }
    const parsed = parseProxyUrl(rawUrl)
    if (parsed.kind === 'none') {
      sendError(res, 404)
      return
    }
    if (parsed.kind === 'bad-port') {
      sendError(res, 400, 'Bad Request: invalid port')
      return
    }
    const { target } = parsed
    const hostPort = deps.webServerPort()
    if (!Number.isInteger(hostPort) || (hostPort as number) <= 0) {
      sendError(res, 503, 'Service Unavailable: DSH port unknown')
      return
    }
    if (target.port === hostPort) {
      sendError(res, 400, 'Bad Request: target is the DSH server itself')
      return
    }
    // A proxied page must never get a persistent Service Worker (design D8): refuse script fetches for
    // registration before any upstream connection is made.
    if (String(req.headers['service-worker'] ?? '').trim().toLowerCase() === 'script') {
      sendError(res, 403, 'Forbidden: Service Worker scripts are not served through the local-service proxy')
      return
    }
    proxyHttp(deps, req, res, target)
  }
}

function injectConfig(req: IncomingMessage, target: ProxyTarget): InjectConfig {
  return { fam: target.fam, port: String(target.port), prefix: cookiePrefix(req, target) }
}

function serveServiceWorker(deps: ProxyDeps, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(req.method === 'HEAD' ? undefined : deps.swSource)
}

function proxyHttp(deps: ProxyDeps, req: IncomingMessage, res: ServerResponse, target: ProxyTarget): void {
  const upstreamReq = httpRequest({
    host: target.host,
    port: target.port,
    method: req.method ?? 'GET',
    path: target.path,
    headers: buildUpstreamHeaders(req, target),
    agent: false,
  })
  deps.inflight.add(upstreamReq)
  const done = (): void => { deps.inflight.delete(upstreamReq) }
  upstreamReq.once('close', done)

  // Connect timeout only: armed while connecting, disarmed on connect. Established streams have no total limit.
  upstreamReq.once('socket', (socket) => {
    if (!socket.connecting) return
    const timer = setTimeout(() => {
      upstreamReq.destroy(Object.assign(new Error(`connect timeout to ${target.authority}`), { code: 'ETIMEDOUT' }))
    }, deps.connectTimeoutMs)
    const clear = (): void => clearTimeout(timer)
    socket.once('connect', clear)
    socket.once('close', clear)
  })

  upstreamReq.once('error', () => {
    sendError(res, 502, `Bad Gateway: cannot reach ${target.authority} (port ${String(target.port)})`)
  })
  upstreamReq.once('response', (upstream) => {
    const headers = forwardResponseHeaders(upstream, cookiePrefix(req, target))
    upstream.once('error', () => res.destroy())
    const location = headers.location
    if (typeof location === 'string') {
      const outcome = classifyLocation(location, target)
      if (outcome.kind === 'proxy') headers.location = outcome.location
      else if (outcome.kind === 'external' && req.headers['sec-fetch-mode'] === 'navigate') {
        // Never navigate the iframe to another origin: answer with a notice page instead.
        upstream.resume()
        // The notice is itself a proxied document: it carries the injected marker like any other.
        const nonce = newNonce()
        const html = injectIntoDocument(Buffer.from(externalRedirectNotice(outcome.url), 'utf8'), Buffer.from(buildInjectMarkup(nonce, injectConfig(req, target)), 'utf8'))
        const notice: OutgoingHttpHeaders = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
        if (headers['set-cookie'] !== undefined) notice['set-cookie'] = headers['set-cookie']
        res.writeHead(200, notice)
        res.end(req.method === 'HEAD' ? undefined : html)
        return
      }
    }
    const status = upstream.statusCode ?? 502
    if (!isInjectable(req.method, status, headers)) {
      res.writeHead(status, upstream.statusMessage, headers)
      upstream.pipe(res)
      return
    }
    const decoder = decoderFor(typeof headers['content-encoding'] === 'string' ? headers['content-encoding'] : undefined)
    if (decoder === undefined) {
      upstream.resume()
      sendError(res, 502, `Bad Gateway: unsupported content-encoding from port ${String(target.port)}`)
      return
    }
    const nonce = newNonce()
    const csp = headers['content-security-policy']
    if (typeof csp === 'string') headers['content-security-policy'] = addNonceToCsp(csp, nonce)
    for (const name of ['content-length', 'etag', 'last-modified', 'content-encoding', 'content-md5', 'accept-ranges']) delete headers[name]
    headers['cache-control'] = 'no-store'
    res.writeHead(status, upstream.statusMessage, headers)
    const injector = new HtmlInjector(Buffer.from(buildInjectMarkup(nonce, injectConfig(req, target)), 'utf8'))
    const stages = decoder === null ? [upstream, injector, res] : [upstream, decoder, injector, res]
    pipeline(stages as [IncomingMessage, ...Transform[], ServerResponse], (error) => {
      if (error) res.destroy()
    })
  })
  // Client went away → drop the upstream connection (spec: within 1 s).
  res.once('close', () => {
    if (!res.writableFinished) upstreamReq.destroy()
  })
  req.pipe(upstreamReq)
  req.once('error', () => upstreamReq.destroy())
}
