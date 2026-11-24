import { describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness } from './harness.ts'
import { openInTab, pageHandler, waitTabAt } from './tab-driver.ts'

// Only the toolbar's button: the home page also has a button named 「刷新」 (re-query services).
const TOOLBAR_REFRESH = `.dshls-toolbar button[aria-label="刷新"]`
const toolbarRefresh = (h: BrowserHarness): Promise<{ exists: boolean; disabled: boolean }> =>
  h.evalDsh(`(() => { const b = document.querySelector('${TOOLBAR_REFRESH}'); return { exists: !!b, disabled: !!b && b.hasAttribute('disabled') } })()`)
const depth = (h: BrowserHarness): Promise<string | null> => h.evalDsh<string | null>(`document.querySelector('[data-dshls-history-depth]').getAttribute('data-dshls-history-depth')`)
const panelText = (h: BrowserHarness): Promise<string> => h.evalDsh<string>(`document.querySelector('.dshls-tab').innerText`)

describe('tab 工具栏的刷新按钮', () => {
  it('spec Scenario "刷新重新加载当前页面且栈深度不变"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U1', pageHandler('U1'))
      await h.open()
      await openInTab(h, up, '/')
      await waitFor(async () => (await depth(h)) === '1', 'fresh document installed')
      await h.evalTab(`(location.assign('/second'), true)`)
      await waitTabAt(h, '/second')
      await waitFor(async () => (await depth(h)) === '2', 'stack of two')
      const count = (): number => up.requests.filter((r) => r.url === '/second').length
      const before = count()
      const top = await h.evalDsh<number>('history.length')
      expect(await toolbarRefresh(h)).toEqual({ exists: true, disabled: false })
      await h.evalDsh(`(document.querySelector('${TOOLBAR_REFRESH}').click(), true)`)
      await waitFor(() => count() === before + 1, 'upstream received /second again')
      await waitTabAt(h, '/second')
      expect(await depth(h)).toBe('2')
      expect(await h.evalDsh<number>('history.length')).toBe(top)
    } finally { await h.close() }
  })

  it('spec Scenario "首页时刷新按钮禁用"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U1', pageHandler('U1'))
      await h.open()
      // Home's service probe must be finished before taking the baseline.
      await waitFor(async () => (await panelText(h)).includes('Host 上没有发现网页服务'), 'home finished loading')
      expect((await toolbarRefresh(h)).disabled).toBe(true)
      const before = up.requests.length
      await h.evalDsh(`(document.querySelector('${TOOLBAR_REFRESH}').click(), true)`)
      await new Promise((r) => setTimeout(r, 500))
      expect(up.requests.length).toBe(before)
      // Positive control: once a page is shown the same button is enabled.
      await openInTab(h, up, '/')
      expect((await toolbarRefresh(h)).disabled).toBe(false)
    } finally { await h.close() }
  })
})
