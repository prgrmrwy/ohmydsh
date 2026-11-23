/// <reference lib="webworker" />
/**
 * Plugin Service Worker (design D8). Scope `/dsh-local-service/`; it only ever controls proxied
 * documents (never the DSH main page).
 */
import { PROXY_PATH_RE, type Family } from '../contract.js'
import { decide, forClient } from './rewrite.js'
import { lookupClient, pruneClients, rememberClient } from './store.js'

declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    const alive = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map((c) => c.id))
    await pruneClients(alive).catch(() => undefined)
  })())
})

const badGateway = (text: string): Response => new Response(text, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

async function forward(request: Request, to: string): Promise<Response> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  try {
    // Buffer the body: streaming request bodies need HTTP/2 in Chromium and the Host speaks HTTP/1.1.
    const body = hasBody ? await request.arrayBuffer() : null
    return await fetch(new Request(to, {
      method: request.method,
      headers: request.headers,
      body,
      credentials: 'same-origin',
      redirect: request.redirect,
      cache: request.cache === 'only-if-cached' ? 'default' : request.cache,
    }))
  } catch (error) {
    return badGateway(`dshls: forward failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    // Navigation into a proxied document: remember which target the new client belongs to.
    const m = PROXY_PATH_RE.exec(url.pathname)
    if (m !== null && url.origin === self.location.origin && event.resultingClientId !== '') {
      event.waitUntil(rememberClient(event.resultingClientId, { fam: m[1] as Family, port: m[2] as string }).catch(() => undefined))
    }
    return
  }

  const decision = decide(url, self.location.origin)
  if (decision.kind === 'pass') return
  if (decision.kind === 'loopback') {
    event.respondWith(forward(request, decision.to))
    return
  }
  event.respondWith((async () => {
    const target = await lookupClient(event.clientId)
    if (target === undefined) return badGateway('dshls: unknown client — refusing to forward a same-origin request without a recorded target')
    return forward(request, forClient(target, decision.rest))
  })())
})
