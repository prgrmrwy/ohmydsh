/**
 * Helpers shared by the browser suites: drive the REAL tab (built client) in the DSH page and read
 * its state. All page-side reads go through DevTools evaluation (the proxied pages cannot use the
 * report endpoint: a same-origin root path from them is forwarded to the upstream by design).
 */
import { SW_SCRIPT, SW_SCOPE } from '../../src/contract.ts'
import { waitFor, type BrowserHarness, type Upstream } from './harness.ts'

export const proxyUrl = (up: Upstream, rest = '/', fam: 'p' | 'p6' = 'p'): string => `/dsh-local-service/${fam}/${String(up.port)}${rest}`
export const directUrl = (up: Upstream, rest = '/'): string => `http://127.0.0.1:${String(up.port)}${rest}`

/** Type `text` into the tab's address bar and submit it. */
export async function submitAddress(h: BrowserHarness, text: string): Promise<void> {
  await h.evalDsh(`(() => {
    const input = document.querySelector('input[data-dshls-address]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await h.evalDsh(`(() => { const f = document.querySelector('input[data-dshls-address]').form; f.requestSubmit(); return true })()`)
}

/** Wait until the tab iframe holds an injected document whose (page-visible) location is `pathAndSearch`. */
export async function waitTabAt(h: BrowserHarness, pathAndSearch: string, timeoutMs = 15_000): Promise<void> {
  await waitFor(async () => {
    const state = await h.evalTab<{ at: string; marker: boolean; ready: string }>(
      `({ at: location.pathname + location.search, marker: !!window.${'__dshlsMarker'}, ready: document.readyState })`,
    )
    return state.marker && state.ready !== 'loading' && state.at === pathAndSearch
  }, `tab iframe injected at ${pathAndSearch}`, timeoutMs, 100)
}

/** Type an address and wait for the injected page to be up at its direct path. */
export async function openInTab(h: BrowserHarness, up: Upstream, rest = '/'): Promise<void> {
  await submitAddress(h, `127.0.0.1:${String(up.port)}${rest}`)
  await waitTabAt(h, rest.replace(/#.*$/, ''))
}

export const addressValue = (h: BrowserHarness): Promise<string> => h.evalDsh<string>(`document.querySelector('input[data-dshls-address]').value`)
export const tabError = (h: BrowserHarness): Promise<string> => h.evalDsh<string>(`document.querySelector('[role="alert"]') ? document.querySelector('[role="alert"]').textContent : ''`)
export const frameId = (h: BrowserHarness): Promise<string> => h.evalDsh<string>(`document.querySelector('iframe[data-dshls]').getAttribute('data-dshls')`)

/** Register + activate the plugin Service Worker by hand (for suites that run without the tab). */
export async function registerPluginSw(h: BrowserHarness): Promise<void> {
  await h.evalDsh(`navigator.serviceWorker.register(${JSON.stringify(SW_SCRIPT)}, { scope: ${JSON.stringify(SW_SCOPE)} }).then(() => true)`)
  await waitFor(() => h.serviceWorker('/dsh-local-service/sw.js')?.status === 'activated', 'plugin Service Worker activated')
}

/** Count Host-side requests whose URL equals `url`. */
export const hostSaw = (h: BrowserHarness, url: string): number => h.dshRequests.filter((r) => r.url === url).length

/** Standard upstream: HTML pages echoing their name, plus /assets, /api, /events (SSE-like) helpers. */
export function pageHandler(name: string, pages: Record<string, string> = {}) {
  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: string): void => {
    const path = (req.url ?? '/').split('?')[0]!
    const custom = pages[req.url ?? ''] ?? pages[path]
    if (custom !== undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(custom)
      return
    }
    if (path.startsWith('/assets/')) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`${name}-asset`); return }
    if (path.startsWith('/api')) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`${name}-api`); return }
    if (req.method === 'POST') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><head></head><body>${name} posted ${body}</body></html>`); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head></head><body>${name} page ${req.url ?? ''}</body></html>`)
  }
}
