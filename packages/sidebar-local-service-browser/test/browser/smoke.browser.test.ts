import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome, startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'

describe('browser harness smoke (tasks 0.2)', () => {
  let h: BrowserHarness
  let up: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ hostPlugin: false })
    up = await h.upstream('U1')
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('fails (never skips) when Chrome is missing', () => {
    expect(() => findChrome({ DSHLS_CHROME: '/nonexistent/chrome-binary' })).toThrow(/Chrome not found/)
    expect(findChrome()).toBe(h.chromePath)
  })

  it('loads cockpit → DSH through the real launch-token login, and evaluates in every frame level', async () => {
    expect(h.frameUrl(0)).toBe(h.cockpitUrl)
    // The DSH iframe was authenticated by the real connection: the page is served (not 401) and booted.
    expect(await h.evalDsh<string>('document.title')).toBe('dsh')
    expect(await h.evalCockpit<string>("document.getElementById('dsh') ? 'has-dsh-iframe' : 'none'")).toBe('has-dsh-iframe')
    // Auth is real: the same index without the cookie is rejected (positive control for the line above).
    const anonymous = await h.dsh.request({ path: '/' })
    expect(anonymous.status).toBe(401)
    // A nested tab-like iframe gets its own frame level.
    await h.evalDsh("(() => { const f = document.createElement('iframe'); f.id = 'probe'; f.setAttribute('data-dshls', 'f1'); f.src = '/__harness-sw/sw.js'; document.body.appendChild(f); return new Promise((r) => f.addEventListener('load', () => r(true))) })()")
    await waitFor(() => h.frameUrl(2)?.endsWith('/__harness-sw/sw.js'), 'depth-2 frame navigated')
  })

  it('collects page reports', async () => {
    const mark = h.mark()
    await h.evalDsh("window.__hx.report({ step: 'smoke-ping', n: 7 })")
    const report = await h.waitReport((r) => r.step === 'smoke-ping', 'smoke-ping', 5_000, mark)
    expect(report).toMatchObject({ src: 'dsh-page', n: 7 })
    expect(h.reportsOf((r) => r.step === 'never-sent')).toHaveLength(0)
  })

  it('counts upstream connections and browser direct hits, with a positive control', async () => {
    // Zero before anything touched the upstream.
    expect(up.connections).toBe(0)
    expect(up.directRequests()).toHaveLength(0)
    expect(h.directHits(up.port)).toHaveLength(0)
    // Positive control: a deliberate direct request from the browser rings every counter.
    await h.evalCockpit(`fetch('http://localhost:${String(up.port)}/ping', { mode: 'no-cors' }).then(() => true)`)
    await waitFor(() => up.requests.length === 1, 'upstream saw the direct request')
    expect(up.connections).toBeGreaterThanOrEqual(1)
    expect(up.directRequests().map((r) => r.url)).toEqual(['/ping'])
    expect(up.directRequests()[0]!.headers.host).toBe(`localhost:${String(up.port)}`)
    await waitFor(() => h.directHits(up.port).length === 1, 'CDP saw the direct request')
    expect(h.directHits(up.port)[0]).toMatchObject({ kind: 'http', method: 'GET' })
  })

  it('stops a Service Worker through the DevTools protocol', async () => {
    await h.evalDsh(`navigator.serviceWorker.register('/__harness-sw/sw.js', { scope: '/__harness-sw/' }).then(() => true)`)
    await waitFor(() => h.serviceWorker('/__harness-sw/sw.js')?.status === 'activated', 'probe SW activated')
    await h.stopServiceWorker('/__harness-sw/sw.js')
    expect(h.serviceWorker('/__harness-sw/sw.js')?.runningStatus).toBe('stopped')
  })
})
