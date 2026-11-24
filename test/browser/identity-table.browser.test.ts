import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTRIES_KEY_PREFIX } from '../../src/contract.ts'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { frameId, openInTab, pageHandler, proxyUrl, registerPluginSw, tabError } from './tab-driver.ts'

const table = (h: BrowserHarness, id: string): Promise<Record<string, { fam: string; port: string; rest: string }> | null> =>
  h.evalDsh(`JSON.parse(sessionStorage.getItem(${JSON.stringify(ENTRIES_KEY_PREFIX + id)}) || 'null')`)

describe('页面看到直接地址，导航留在代理内 — 身份表', () => {
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

  it('spec Scenario "身份表写入失败时停止"', async () => {
    // Bare harness: no tab, so the failed frame is NOT blanked and its state can be inspected.
    const bare = await startBrowserHarness({ mode: 'bare' })
    try {
      const up = await bare.upstream('U1', pageHandler('U1'))
      await bare.open()
      await registerPluginSw(bare)
      await bare.evalDsh(`(() => { window.__msgs = []; window.addEventListener('message', (e) => window.__msgs.push(e.data)); return true })()`)
      const load = (id: string, rest: string) => bare.evalDsh(`(() => {
        document.querySelectorAll('iframe[data-dshls]').forEach((f) => f.remove())
        const f = document.createElement('iframe'); f.setAttribute('data-dshls', ${JSON.stringify(id)}); f.src = ${JSON.stringify(proxyUrl(up, rest))}; document.body.appendChild(f); return true
      })()`)
      const key = (id: string) => ENTRIES_KEY_PREFIX + id
      // Positive control: with a healthy table the same load installs fully (marker set, WebSocket replaced).
      await load('ok', '/ok')
      await waitFor(() => bare.evalTab<boolean>(`window.__dshlsMarker === true`), 'healthy load installs the script')
      expect(await bare.evalTab<boolean>(`!/\\[native code\\]/.test(Function.prototype.toString.call(WebSocket))`)).toBe(true)

      const cases: Array<[string, string]> = [
        ['bad-json', `sessionStorage.setItem(${JSON.stringify(key('bad-json'))}, 'not-json')`],
        ['bad-shape', `sessionStorage.setItem(${JSON.stringify(key('bad-shape'))}, JSON.stringify({ k1: { fam: 'x', port: '5173', rest: '/' } }))`],
        ['quota', `(() => { let n = 4 * 1024 * 1024; for (;;) { try { sessionStorage.setItem('fill' + Math.random(), 'x'.repeat(n)) } catch (e) { if (n < 16) break; n = Math.floor(n / 2) } } })()`],
      ]
      for (const [id, setup] of cases) {
        await bare.evalDsh(`(() => { window.__msgs.length = 0; ${setup}; return true })()`)
        await load(id, `/${id}`)
        await waitFor(() => bare.evalDsh<boolean>(`window.__msgs.some((m) => m.type === 'dshls:identity-unavailable')`), `identity-unavailable for ${id}`)
        // The failed document stopped before replacing WebSocket or setting the marker.
        expect(await bare.evalTab<boolean>(`/\\[native code\\]/.test(Function.prototype.toString.call(WebSocket))`)).toBe(true)
        expect(await bare.evalTab<boolean>(`window.__dshlsMarker === undefined`)).toBe(true)
        await bare.evalDsh(`(() => { Object.keys(sessionStorage).filter((k) => k.startsWith('fill')).forEach((k) => sessionStorage.removeItem(k)); return true })()`)
      }
    } finally {
      await bare.close()
    }
    // With the real tab the frame ends up at about:blank and the error is shown.
    await openInTab(h, u1, '/')
    const id = await frameId(h)
    await h.evalDsh(`(sessionStorage.setItem(${JSON.stringify(key(id))}, 'not-json'), true)`)
    await h.evalTab(`(location.reload(), true)`)
    await waitFor(async () => (await tabError(h)).includes('身份表不可用'), 'tab shows the identity-table error')
    await waitFor(() => h.evalDsh<boolean>(`document.querySelector('iframe[data-dshls]').contentWindow.location.href === 'about:blank'`), 'iframe at about:blank')
    await h.evalDsh(`(sessionStorage.removeItem(${JSON.stringify(key(id))}), true)`) // leave a clean slate for the next scenario
    function key(f: string): string { return ENTRIES_KEY_PREFIX + f }
  })

  it('spec Scenario "页面清空 sessionStorage 不影响身份表"', async () => {
    await openInTab(h, u1, '/clear')
    const id = await frameId(h)
    const entryKey = await h.evalTab<string>('navigation.currentEntry.key')
    expect((await table(h, id))?.[entryKey]).toMatchObject({ fam: 'p', port: String(u1.port), rest: '/clear' })
    await h.evalDsh(`(sessionStorage.setItem('dsh.sess', 'keep'), true)`)
    await h.evalTab(`(sessionStorage.setItem('page', '1'), true)`)
    expect(await h.evalTab<string | null>(`sessionStorage.getItem('page')`)).toBe('1')
    await h.evalTab(`(sessionStorage.clear(), true)`)
    // Positive control: the page's own clear() worked.
    expect(await h.evalTab<string | null>(`sessionStorage.getItem('page')`)).toBeNull()
    expect((await table(h, id))?.[entryKey]).toMatchObject({ fam: 'p', port: String(u1.port), rest: '/clear' })
    expect(await h.evalDsh<string | null>(`sessionStorage.getItem('dsh.sess')`)).toBe('keep')
  })

  it('spec Scenario "失效条目被剪除且不影响其它 frame"', async () => {
    await openInTab(h, u1, '/prune')
    const id = await frameId(h)
    const other = JSON.stringify({ k9: { fam: 'p', port: '4000', rest: '/other' } })
    await h.evalDsh(`(() => {
      const k = ${JSON.stringify(ENTRIES_KEY_PREFIX + id)}
      const t = JSON.parse(sessionStorage.getItem(k)); t['stale-key'] = { fam: 'p', port: '1234', rest: '/gone' }
      sessionStorage.setItem(k, JSON.stringify(t))
      sessionStorage.setItem(${JSON.stringify(ENTRIES_KEY_PREFIX + 'f2')}, ${JSON.stringify(other)})
      return true
    })()`)
    expect((await table(h, id))?.['stale-key']).toBeDefined()
    await h.evalTab(`(history.pushState(null, '', '/x'), true)`)
    await waitFor(async () => {
      const t = await table(h, id)
      return t !== null && t['stale-key'] === undefined && Object.values(t).some((v) => v.rest === '/x')
    }, 'stale key pruned after the write')
    expect(await h.evalDsh<string>(`sessionStorage.getItem(${JSON.stringify(ENTRIES_KEY_PREFIX + 'f2')})`)).toBe(other)
  })

  it('spec Scenario "跨文档导航后旧条目仍保留"', async () => {
    await openInTab(h, u1, '/a')
    const id = await frameId(h)
    const k1 = await h.evalTab<string>('navigation.currentEntry.key')
    await h.evalTab(`(location.href = 'http://127.0.0.1:${String(u2.port)}/b', true)`)
    await waitFor(() => h.evalTab<boolean>(`location.pathname === '/b' && !!window.__dshlsMarker`), 'second document installed')
    const k2 = await h.evalTab<string>('navigation.currentEntry.key')
    expect(k2).not.toBe(k1)
    const t = await table(h, id)
    expect(t?.[k1]).toEqual({ fam: 'p', port: String(u1.port), rest: '/a' })
    expect(t?.[k2]).toEqual({ fam: 'p', port: String(u2.port), rest: '/b' })
  })

  it('spec Scenario "挂载与卸载不删除其它存活 frame 的表"', async () => {
    const f = (id: string) => ENTRIES_KEY_PREFIX + id
    await h.evalDsh(`(() => {
      const alive = document.createElement('iframe'); alive.setAttribute('data-dshls', 'f2'); alive.id = 'alive-f2'; document.body.appendChild(alive)
      sessionStorage.setItem(${JSON.stringify(f('f0'))}, '{}')
      sessionStorage.setItem(${JSON.stringify(f('f2'))}, '{"k":{"fam":"p","port":"1","rest":"/"}}')
      return true
    })()`)
    // A new tab instance with frameId f1 (positive control: the old f0 table disappears, so the sweep ran).
    await h.evalDsh(`(() => {
      const el = document.createElement('div'); el.id = 'tab-f1'; document.body.appendChild(el)
      window.__f1 = ReactDOM.createRoot(el)
      ReactDOM.flushSync(() => window.__f1.render(React.createElement(window.__hx.exports.Tab, { frameId: 'f1' })))
      return true
    })()`)
    await waitFor(() => h.evalDsh<boolean>(`sessionStorage.getItem(${JSON.stringify(f('f0'))}) === null`), 'dead frame table swept on mount')
    expect(await h.evalDsh<boolean>(`sessionStorage.getItem(${JSON.stringify(f('f2'))}) !== null`)).toBe(true)
    await h.evalDsh(`(sessionStorage.setItem(${JSON.stringify(f('f1'))}, '{}'), ReactDOM.flushSync(() => window.__f1.unmount()), true)`)
    await waitFor(() => h.evalDsh<boolean>(`sessionStorage.getItem(${JSON.stringify(f('f1'))}) === null`), 'own table removed on unmount')
    expect(await h.evalDsh<boolean>(`sessionStorage.getItem(${JSON.stringify(f('f2'))}) !== null`)).toBe(true)
  })
})
