import { describe, expect, it } from 'vitest'
import { SERVICES_ROUTE } from '../../src/contract.ts'
import { startBrowserHarness, waitFor, type BrowserHarness } from './harness.ts'
import { addressValue, openInTab, pageHandler, waitTabAt } from './tab-driver.ts'

const SERVICES_PATH = SERVICES_ROUTE
const panelText = (h: BrowserHarness): Promise<string> => h.evalDsh<string>(`(document.querySelector('.dshls-tab') || document.body).innerText`)
const depth = (h: BrowserHarness): Promise<string | null> => h.evalDsh<string | null>(`document.querySelector('[data-dshls-history-depth]').getAttribute('data-dshls-history-depth')`)

/** The services endpoint belongs to the Host (tested in host-services.test.ts); here an exact route stands in so the tab is tested alone. */
function serveServices(h: BrowserHarness, body: unknown): { hits: () => number } {
  let hits = 0
  h.dsh.webServer.register({
    kind: 'exact',
    path: SERVICES_PATH,
    handler: (_req, res) => { hits += 1; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) },
  })
  return { hits: () => hits }
}

describe('首页列出 Host 上的网页服务', () => {
  it('spec Scenario "Home 按钮回到服务列表并可点选"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U1', pageHandler('U1'))
      const svc = serveServices(h, [{ fam: 'p', port: up.port, process: 'node' }])
      await h.open()
      await openInTab(h, up, '/')
      await h.evalTab(`(location.assign('/second'), true)`)
      await waitTabAt(h, '/second')
      await waitFor(async () => (await depth(h)) === '2', 'two visited pages')
      const before = svc.hits()
      await h.evalDsh(`(document.querySelector('button[aria-label="首页"]').click(), true)`)
      await waitFor(async () => (await panelText(h)).includes(String(up.port)), 'service listed on the home page')
      expect(await h.evalDsh<boolean>(`!document.querySelector('iframe[data-dshls]')`)).toBe(true)
      expect(await depth(h)).toBe('0')
      expect(await addressValue(h)).toBe('')
      expect(await panelText(h)).toContain('node')
      expect(svc.hits()).toBeGreaterThan(before) // positive control: the list really came from the endpoint
      await h.evalDsh(`(([...document.querySelectorAll('.dshls-tab button')].find((b) => b.innerText.includes(${JSON.stringify(String(up.port))})).click(), true))`)
      await waitTabAt(h, '/')
      expect(await h.evalDsh<string>(`document.querySelector('iframe[data-dshls]').getAttribute('src')`)).toBe(`/dsh-local-service/p/${String(up.port)}/`)
      await waitFor(async () => (await addressValue(h)) === `http://127.0.0.1:${String(up.port)}/`, 'address bar shows the direct address')
    } finally { await h.close() }
  })

  it('spec Scenario "没有发现服务时显示示例"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      serveServices(h, [])
      await h.open()
      await waitFor(async () => (await panelText(h)).includes('Host 上没有发现网页服务'), 'empty-state message')
      expect(await panelText(h)).toContain('127.0.0.1:5173')
    } finally { await h.close() }
  })
})
