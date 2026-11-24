import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { hostSaw, openInTab, pageHandler, proxyUrl } from './tab-driver.ts'

describe('禁止被代理页面注册 Service Worker', () => {
  let h: BrowserHarness
  let up: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', (req, res, body) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' })
        res.end('self.addEventListener("fetch", () => {})')
        return
      }
      pageHandler('U1')(req, res, body)
    })
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "上游宽作用域注册被拒绝"', async () => {
    const outcome = await h.evalDsh<string>(`navigator.serviceWorker.register(${JSON.stringify(proxyUrl(up, '/sw.js'))}, { scope: '/' }).then(() => 'registered', (e) => e.name + ': ' + e.message)`)
    expect(outcome).toMatch(/403/)
    expect(up.requests.filter((r) => r.url === '/sw.js')).toHaveLength(0)
    // Positive control: without the Service-Worker header the same URL is proxied to the upstream.
    await h.evalDsh(`fetch(${JSON.stringify(proxyUrl(up, '/sw.js'))}).then((r) => r.status)`)
    await waitFor(() => up.requests.filter((r) => r.url === '/sw.js').length === 1, 'plain GET reaches the upstream')
    expect(await h.evalDsh<number>(`navigator.serviceWorker.getRegistrations().then((r) => r.filter((x) => x.scope.endsWith('/')  && !x.scope.endsWith('/dsh-local-service/')).length)`)).toBe(0)
  })

  it('spec Scenario "页面内注册调用被拒绝"', async () => {
    await openInTab(h, up, '/')
    const before = up.requests.filter((r) => r.url === '/sw.js').length
    const outcome = await h.evalTab<string>(`navigator.serviceWorker.register('/sw.js').then(() => 'registered', (e) => e.name)`)
    expect(outcome).toBe('SecurityError')
    expect(up.requests.filter((r) => r.url === '/sw.js').length).toBe(before)
    // Positive control: a plain fetch of the same path from the same page does reach the upstream.
    await h.evalTab(`fetch('/sw.js').then((r) => r.status)`)
    await waitFor(() => up.requests.filter((r) => r.url === '/sw.js').length === before + 1, 'fetch /sw.js reaches the upstream')
  })

  it('spec Scenario "残留注册被清理"', async () => {
    const staleUrl = '/dsh-local-service/p/5173/sw.js'
    // An exact route (wins over the plugin prefix route) so a script under that path can be registered at all.
    const dispose = h.dsh.webServer.register({
      kind: 'exact',
      path: staleUrl,
      handler: (_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('self.addEventListener("fetch", () => {})') },
    })
    try {
      await h.evalDsh(`Promise.all([
        navigator.serviceWorker.register(${JSON.stringify(staleUrl)}, { scope: '/dsh-local-service/p/5173/' }),
        navigator.serviceWorker.register('/dsh-local-service/sw.js', { scope: '/dsh-local-service/' }),
      ]).then(() => true)`)
      const scopes = () => h.evalDsh<string[]>(`navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => (r.active || r.waiting || r.installing || { scriptURL: '' }).scriptURL.replace(location.origin, '') + ' @ ' + r.scope.replace(location.origin, '')))`)
      expect(await scopes()).toEqual(expect.arrayContaining([`${staleUrl} @ /dsh-local-service/p/5173/`, '/dsh-local-service/sw.js @ /dsh-local-service/']))
      // Mounting the tab again is the trigger.
      await h.evalDsh(`(() => { window.__hx.unmount(); window.__hx.mount(); return true })()`)
      await waitFor(async () => !(await scopes()).some((s) => s.startsWith(staleUrl)), 'stale registration unregistered')
      expect(await scopes()).toEqual(expect.arrayContaining(['/dsh-local-service/sw.js @ /dsh-local-service/']))
      expect(hostSaw(h, staleUrl)).toBeGreaterThan(0)
    } finally {
      dispose()
    }
  })
})
