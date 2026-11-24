import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { addressValue, openInTab, pageHandler, submitAddress, waitTabAt } from './tab-driver.ts'

const depth = (h: BrowserHarness): Promise<string | null> => h.evalDsh<string | null>(`document.querySelector('[data-dshls-history-depth]') ? document.querySelector('[data-dshls-history-depth]').getAttribute('data-dshls-history-depth') : null`)
const backState = (h: BrowserHarness): Promise<{ exists: boolean; disabled: boolean }> => h.evalDsh(`(() => { const b = document.querySelector('button[aria-label="返回"]'); return { exists: !!b, disabled: !!b && b.hasAttribute('disabled') } })()`)
const clickBack = (h: BrowserHarness): Promise<unknown> => h.evalDsh(`(document.querySelector('button[aria-label="返回"]').click(), true)`)
/** Submit an address and wait until the NEW document is installed (a resubmit of the same address reloads the page). */
async function openFresh(h: BrowserHarness, up: Upstream, rest: string): Promise<void> {
  await openInTab(h, up, rest)
  await waitFor(async () => (await depth(h)) === '1', 'new document installed, stack reset to one')
}
const direct = (up: Upstream, rest: string): string => `http://127.0.0.1:${String(up.port)}${rest}`

describe('tab 顶部的返回按钮', () => {
  let h: BrowserHarness
  let up: Upstream
  let redirect = false

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', (req, res, body) => {
      if (redirect && req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(); return }
      pageHandler('U1')(req, res, body)
    })
    await h.open()
  })
  afterAll(async () => { await h.close() })

  it('spec Scenario "返回按钮回到上一页并同步地址栏"', async () => {
    await openFresh(h, up, '/')
    await h.evalTab(`(location.assign('/second'), true)`)
    await waitTabAt(h, '/second')
    await waitFor(async () => (await depth(h)) === '2', 'two visited pages')
    expect((await backState(h)).disabled).toBe(false) // positive control: enabled with two entries
    await clickBack(h)
    await waitTabAt(h, '/')
    await waitFor(async () => (await addressValue(h)) === direct(up, '/') && (await depth(h)) === '1', 'back restored / with depth 1')
  })

  it('spec Scenario "顶层历史穿插时只后退 iframe"', async () => {
    await openFresh(h, up, '/')
    await h.evalTab(`(location.assign('/second'), true)`)
    await waitTabAt(h, '/second')
    await waitFor(async () => (await depth(h)) === '2', 'two visited pages')
    const top = await h.evalDsh<{ hash: string; length: number }>(`(() => { history.pushState(null, '', '#x'); return { hash: location.hash, length: history.length } })()`)
    expect(top.hash).toBe('#x')
    await clickBack(h)
    await waitTabAt(h, '/')
    expect(await h.evalDsh<{ hash: string; length: number }>(`({ hash: location.hash, length: history.length })`)).toEqual(top)
    await h.evalDsh(`(history.replaceState(null, '', location.pathname + location.search), true)`)
  })

  it('spec Scenario "没有上一页时返回按钮禁用"', async () => {
    const fresh = await startBrowserHarness({ mode: 'tab' })
    try {
      const u = await fresh.upstream('U1', pageHandler('U1'))
      await fresh.open()
      const before = await backState(fresh)
      expect(before).toEqual({ exists: true, disabled: true })
      await fresh.evalDsh(`(document.querySelector('button[aria-label="返回"]').click(), true)`)
      expect(await fresh.evalDsh<boolean>(`!document.querySelector('iframe[data-dshls]')`)).toBe(true)
      await openFresh(fresh, u, '/')
      expect(await backState(fresh)).toEqual({ exists: true, disabled: true })
      const requests = u.requests.length
      await fresh.evalDsh(`(document.querySelector('button[aria-label="返回"]').click(), true)`)
      await new Promise((r) => setTimeout(r, 500))
      expect(await addressValue(fresh)).toBe(direct(u, '/'))
      expect(u.requests.length).toBe(requests)
    } finally { await fresh.close() }
  })

  it('spec Scenario "返回目标被重定向时不循环"', async () => {
    redirect = false
    await openFresh(h, up, '/a')
    await h.evalTab(`(location.assign('/b'), true)`)
    await waitTabAt(h, '/b')
    await waitFor(async () => (await depth(h)) === '2', 'stack [/a, /b]')
    redirect = true
    await clickBack(h)
    await waitFor(async () => (await depth(h)) === '1' && (await backState(h)).disabled, 'merged into /b, back disabled', 15_000, 100)
    await waitTabAt(h, '/b')
    await new Promise((r) => setTimeout(r, 1000))
    const settled = up.requests.length
    await new Promise((r) => setTimeout(r, 1000))
    expect(up.requests.length).toBe(settled)
    expect(await depth(h)).toBe('1')
    redirect = false
  })

  it('spec Scenario "提交新地址后访问栈重置"', async () => {
    const other = await h.upstream('U2', pageHandler('U2'))
    await openFresh(h, up, '/')
    await h.evalTab(`(location.assign('/second'), true)`)
    await waitTabAt(h, '/second')
    await waitFor(async () => (await depth(h)) === '2' && !(await backState(h)).disabled, 'stack of two, back enabled')
    await submitAddress(h, `127.0.0.1:${String(other.port)}/page`)
    await waitTabAt(h, '/page')
    await waitFor(async () => (await depth(h)) === '1' && (await backState(h)).disabled, 'stack reset to one, back disabled')
  })
})
