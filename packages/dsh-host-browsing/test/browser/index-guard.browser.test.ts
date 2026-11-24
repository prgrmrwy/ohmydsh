import { afterAll, describe, expect, it } from 'vitest'
import { ENTRIES_KEY_PREFIX, FRAME_ATTR } from '../../src/contract.ts'
import { REPORT_PATH, startBrowserHarness, waitFor, type BrowserHarness, type Report } from './harness.ts'
import { addressValue, openInTab, pageHandler, waitTabAt } from './tab-driver.ts'

const harnesses: BrowserHarness[] = []
afterAll(async () => {
  await Promise.all(harnesses.map((h) => h.close()))
})

/** Reports from the DSH index sentinel placed in the head AFTER the guard (extraHead). */
const SENTINEL2 = `<script>fetch('${REPORT_PATH}', { method: 'POST', body: JSON.stringify({ src: 'sentinel2', ctx: window.frameElement === null ? 'dsh-page' : window.frameElement.hasAttribute('${FRAME_ATTR}') ? 'tab-iframe' : 'plain-iframe', path: location.pathname }) })</script>`
const sentinel2 = (h: BrowserHarness, ctx: string): Report[] => h.reportsOf((r) => r.src === 'sentinel2' && r.ctx === ctx)
const bootedInTab = (h: BrowserHarness): Report[] => h.reportsOf((r) => r.src === 'dsh-index' && r.step === 'booted-in-iframe')

/** Test plugins pushing a structured head row through the official `webserver/index-inject` event. */
const headRowPlugin = (name: string, marker: string) => ({
  name,
  apply(ctx: { on(event: string, fn: (table: unknown[]) => void): void }) {
    ctx.on('webserver/index-inject', (table) => { table.push({ kind: 'script', text: `window.${marker} = 1`, placement: 'head' }) })
  },
})

describe('tab 内历史前进后退按条目身份恢复 — index 守卫', () => {
  it('spec Scenario "后退到根路径时 DSH 不启动"', async () => {
    // Positive control: WITHOUT the plugin (no guard) a data-dshls iframe loading the DSH index boots it (sentinel reports).
    const control = await startBrowserHarness({ mode: 'bare', hostPlugin: false })
    harnesses.push(control)
    await control.open()
    await control.evalDsh(`new Promise((r) => { const f = document.createElement('iframe'); f.setAttribute('${FRAME_ATTR}', 'c1'); f.src = '/'; f.onload = () => r(true); document.body.appendChild(f) })`)
    await waitFor(() => bootedInTab(control).length >= 1, 'control: sentinel reports without the guard')

    const h = await startBrowserHarness({ mode: 'tab' })
    harnesses.push(h)
    const up = await h.upstream('U1', pageHandler('U1'))
    await h.open()
    await openInTab(h, up, '/')
    await h.evalTab(`(location.assign('/page3'), true)`)
    await waitTabAt(h, '/page3')
    const before = up.requests.filter((r) => r.url === '/').length
    await h.evalTab('(history.back(), true)')
    await waitFor(async () => up.requests.filter((r) => r.url === '/').length === before + 1 && (await addressValue(h)) === `http://127.0.0.1:${String(up.port)}/`, 'back restored U1 /')
    await waitTabAt(h, '/')
    expect(bootedInTab(h)).toHaveLength(0)
    // The bare `/` request really reached DSH's index meanwhile (it is the design's accepted side effect).
    expect(h.dshRequests.filter((r) => r.url === '/' && r.headers['sec-fetch-dest'] === 'iframe').length).toBeGreaterThanOrEqual(1)
  })

  it('spec Scenario "最终 index 流水线中守卫是首个可执行脚本"', async () => {
    const h = await startBrowserHarness({
      mode: 'tab',
      extraHead: SENTINEL2,
      pluginsBefore: [headRowPlugin('before-plugin', '__before') as never],
      pluginsAfter: [headRowPlugin('after-plugin', '__after') as never],
    })
    harnesses.push(h)
    const up = await h.upstream('U1', pageHandler('U1'))
    await h.open()
    const cookie = await h.dsh.login()
    for (const path of ['/', '/index.html']) {
      const res = await h.dsh.request({ path, headers: { cookie } })
      expect(res.status).toBe(200)
      const html = res.text()
      // Both test plugins' rows are really in the page (so "first" means something).
      expect(html).toContain('window.__before = 1')
      expect(html).toContain('window.__after = 1')
      const head = html.slice(html.search(/<head(\s[^>]*)?>/i))
      const firstScript = head.search(/<script[\s>]/i)
      const beforeFirst = head.slice(head.indexOf('>') + 1, firstScript)
      expect(beforeFirst.replace(/<base href="\.\/">/, '').trim()).toBe('')
      const guardText = head.slice(firstScript, head.indexOf('</script>', firstScript))
      expect(guardText).toContain(FRAME_ATTR)
      expect(guardText).toContain(ENTRIES_KEY_PREFIX)
      expect(guardText).not.toContain('window.__before')
    }
    // Behaviour: the sentinel runs in the DSH page and in a plain iframe, but not in a data-dshls iframe with a known identity.
    await waitFor(() => sentinel2(h, 'dsh-page').length >= 1, 'sentinel in the DSH page')
    await h.evalDsh(`new Promise((r) => { const f = document.createElement('iframe'); f.id = 'plain'; f.src = '/'; f.onload = () => r(true); document.body.appendChild(f) })`)
    await waitFor(() => sentinel2(h, 'plain-iframe').length >= 1, 'sentinel in a plain iframe')
    await openInTab(h, up, '/')
    await h.evalTab(`(location.assign('/page3'), true)`)
    await waitTabAt(h, '/page3')
    const before = up.requests.filter((r) => r.url === '/').length
    await h.evalTab('(history.back(), true)')
    await waitFor(() => up.requests.filter((r) => r.url === '/').length === before + 1, 'back restored through the guard')
    await waitTabAt(h, '/')
    expect(sentinel2(h, 'tab-iframe')).toHaveLength(0)
  })
})
