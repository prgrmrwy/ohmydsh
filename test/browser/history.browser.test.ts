import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTRIES_KEY_PREFIX } from '../../src/contract.ts'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { addressValue, frameId, hostSaw, openInTab, pageHandler, tabError, waitTabAt } from './tab-driver.ts'

const count = (up: Upstream, url: string): number => up.requests.filter((r) => r.url === url).length

describe('tab 内历史前进后退按条目身份恢复', () => {
  let h: BrowserHarness
  let u1: Upstream
  let u2: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    u1 = await h.upstream('U1', pageHandler('U1'))
    u2 = await h.upstream('U2', pageHandler('U2'))
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })
  const direct = (up: Upstream, rest: string) => `http://127.0.0.1:${String(up.port)}${rest}`
  const goCross = async (to: Upstream, rest: string) => {
    await h.evalTab(`(location.href = ${JSON.stringify(direct(to, rest))}, true)`)
    await waitTabAt(h, rest)
  }

  it('spec Scenario "跨端口后退回到正确的服务"', async () => {
    await openInTab(h, u1, '/form')
    await goCross(u2, '/page2')
    await h.evalTab('(history.back(), true)')
    await waitFor(async () => (await addressValue(h)) === direct(u1, '/form') && count(u1, '/form') === 2, 'back restored U1 /form')
    expect(count(u2, '/form')).toBe(0)
    // The design's documented side effect (positive control for the oracle): DSH itself saw the bare /form first.
    expect(hostSaw(h, '/form')).toBeGreaterThanOrEqual(1)
  })

  it('spec Scenario "应用内路由变化后跨端口后退"', async () => {
    await openInTab(h, u1, '/spa')
    await h.evalTab(`(history.pushState(null, '', '/spa/route2'), history.replaceState({ app: 1 }, '', '/spa/route3'), true)`)
    await goCross(u2, '/page2')
    await h.evalTab('(history.back(), true)')
    await waitFor(async () => (await addressValue(h)) === direct(u1, '/spa/route3') && count(u1, '/spa/route3') === 1, 'back restored U1 /spa/route3')
    expect(count(u2, '/spa/route3')).toBe(0)
  })

  it('spec Scenario "跨文档导航并重载后仍能按旧条目恢复"', async () => {
    await openInTab(h, u1, '/a')
    const id = await frameId(h)
    const a = await h.evalTab<string>('navigation.currentEntry.key')
    await goCross(u2, '/b')
    await h.evalTab('(location.reload(), true)')
    await waitTabAt(h, '/b')
    expect(await frameId(h)).toBe(id)
    const t = await h.evalDsh<Record<string, { fam: string; port: string; rest: string }>>(`JSON.parse(sessionStorage.getItem(${JSON.stringify(ENTRIES_KEY_PREFIX + id)}))`)
    expect(t[a]).toEqual({ fam: 'p', port: String(u1.port), rest: '/a' })
    const before = count(u1, '/a')
    await h.evalTab('(history.back(), true)')
    await waitFor(async () => (await addressValue(h)) === direct(u1, '/a') && count(u1, '/a') === before + 1, 'back after reload restored U1 /a')
    expect(count(u2, '/a')).toBe(0)
  })

  it('spec Scenario "没有身份记录时不猜测"', async () => {
    await openInTab(h, u1, '/x')
    await goCross(u2, '/y')
    // Control: with the table intact, back is restored (so a later blank is caused by the missing record).
    const u1Before = count(u1, '/x')
    await h.evalTab('(history.back(), true)')
    await waitFor(() => count(u1, '/x') === u1Before + 1, 'control: back restored with the table intact')
    await waitTabAt(h, '/x')
    await h.evalTab('(history.forward(), true)')
    await waitTabAt(h, '/y')
    // Now forget the identities and go back: nothing may be guessed.
    const id = await frameId(h)
    await h.evalDsh(`(sessionStorage.removeItem(${JSON.stringify(ENTRIES_KEY_PREFIX + id)}), true)`)
    const [b1, b2] = [u1.requests.length, u2.requests.length]
    await h.evalTab('(history.back(), true)')
    await waitFor(async () => (await tabError(h)).includes('无法恢复该历史记录'), 'tab refuses to guess')
    await waitFor(() => h.evalDsh<boolean>(`document.querySelector('iframe[data-dshls]').contentWindow.location.href === 'about:blank'`), 'iframe at about:blank')
    expect([u1.requests.length, u2.requests.length]).toEqual([b1, b2])
  })
})
