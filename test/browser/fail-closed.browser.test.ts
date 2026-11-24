import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { openInTab, pageHandler, submitAddress, tabError } from './tab-driver.ts'

const iframeExists = (h: BrowserHarness): Promise<boolean> => h.evalDsh<boolean>(`!!document.querySelector('iframe[data-dshls]')`)

describe('前置条件不满足时失败闭合（尽力而为）', () => {
  let h: BrowserHarness
  let up: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', pageHandler('U1'))
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "浏览器不支持 Navigation API"', async () => {
    await h.evalDsh(`(() => {
      window.__navDesc = Object.getOwnPropertyDescriptor(window, 'navigation') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'navigation')
      Object.defineProperty(window, 'navigation', { value: undefined, configurable: true })
      return true
    })()`)
    await submitAddress(h, `127.0.0.1:${String(up.port)}`)
    await waitFor(async () => (await tabError(h)).includes('当前浏览器不支持 Navigation API'), 'tab explains the missing Navigation API')
    expect(await iframeExists(h)).toBe(false)
    expect(up.requests).toHaveLength(0)
    // Positive control: once the API is back, the very same input loads.
    await h.evalDsh(`(Object.defineProperty(window, 'navigation', window.__navDesc), true)`)
    await openInTab(h, up, '/')
    expect(await iframeExists(h)).toBe(true)
  })

  it('spec Scenario "Service Worker 注册失败"', async () => {
    const fresh = await startBrowserHarness({ mode: 'tab' })
    try {
      const u = await fresh.upstream('U1', pageHandler('U1'))
      await fresh.open()
      // An exact route wins over the plugin's prefix route: the worker script answers 500.
      const dispose = fresh.dsh.webServer.register({ kind: 'exact', path: '/dsh-local-service/sw.js', handler: (_req, res) => { res.writeHead(500); res.end('boom') } })
      await submitAddress(fresh, `127.0.0.1:${String(u.port)}`)
      await waitFor(async () => (await tabError(fresh)).includes('Service Worker 注册失败'), 'tab explains the registration failure')
      expect(await fresh.evalDsh<boolean>(`!!document.querySelector('iframe[data-dshls]')`)).toBe(false)
      expect(u.requests).toHaveLength(0)
      // Positive control: with the failing route gone the same input loads.
      dispose()
      await openInTab(fresh, u, '/')
      expect(await fresh.evalDsh<boolean>(`!!document.querySelector('iframe[data-dshls]')`)).toBe(true)
    } finally {
      await fresh.close()
    }
  })

  it('spec Scenario "页面未受控时停止并只重载一次"', async () => {
    const fresh = await startBrowserHarness({ mode: 'tab' })
    try {
      const u = await fresh.upstream('U1', pageHandler('U1'))
      await fresh.open()
      await openInTab(fresh, u, '/') // positive control: a controlled load installs normally
      // Drop the worker: later documents under the scope are no longer controlled.
      await fresh.evalDsh(`navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then(() => true)`)
      // Snapshot the frame inside the message handler: it runs before the tab reacts (listener order).
      await fresh.evalDsh(`(() => {
        window.__snap = []
        window.addEventListener('message', (e) => {
          if (!e.data || e.data.type !== 'dshls:uncontrolled') return
          const w = e.source
          const f = document.querySelector('iframe[data-dshls]')
          window.__snap.push({
            marker: w.__dshlsMarker === true,
            wsNative: /\\[native code\\]/.test(Function.prototype.toString.call(w.WebSocket)),
            table: sessionStorage.getItem('__dshls.entries.' + f.getAttribute('data-dshls')),
          })
        })
        return true
      })()`)
      const key = await fresh.evalDsh<string>(`'__dshls.entries.' + document.querySelector('iframe[data-dshls]').getAttribute('data-dshls')`)
      const tableBefore = await fresh.evalDsh<string>(`sessionStorage.getItem(${JSON.stringify(key)})`)
      const loadsBefore = u.requests.filter((r) => r.url === '/again').length
      await submitAddress(fresh, `127.0.0.1:${String(u.port)}/again`)
      await waitFor(async () => (await tabError(fresh)) !== '', 'tab shows the error after the second report', 20_000)
      await waitFor(() => fresh.evalDsh<boolean>(`document.querySelector('iframe[data-dshls]').contentWindow.location.href === 'about:blank'`), 'iframe at about:blank')
      const snaps = await fresh.evalDsh<Array<{ marker: boolean; wsNative: boolean; table: string }>>('window.__snap')
      expect(snaps).toHaveLength(2) // reported twice: the first load and the single reload
      for (const s of snaps) {
        expect(s.marker).toBe(false)
        expect(s.wsNative).toBe(true)
        expect(s.table).toBe(tableBefore) // nothing written for the uncontrolled documents
      }
      expect(u.requests.filter((r) => r.url === '/again').length - loadsBefore).toBe(2) // exactly one reload
    } finally {
      await fresh.close()
    }
  })
})

const tabPanelText = (h: BrowserHarness): Promise<string> => h.evalDsh<string>(`(document.querySelector('.dshls-tab') || document.body).innerText`)
const iframeAtBlank = (h: BrowserHarness): Promise<boolean> => h.evalDsh<boolean>(`document.querySelector('iframe[data-dshls]').contentWindow.location.href === 'about:blank'`)

describe('前置条件不满足时失败闭合（尽力而为）— 按内容类型分流', () => {
  it('spec Scenario "非网页响应显示类型和可读状态码"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U8', (_req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end() })
      await h.open()
      await submitAddress(h, `127.0.0.1:${String(up.port)}/`)
      await waitFor(async () => (await tabPanelText(h)).includes('这个地址返回的不是网页'), 'not-a-web-page title', 15_000, 100)
      await waitFor(() => iframeAtBlank(h), 'iframe at about:blank')
      const text = await tabPanelText(h)
      expect(text).toContain('text/plain')
      expect(text).toContain('404')
      expect(text).not.toContain('页面阻止了注入脚本')
      // No link may point at a proxy path (it would open a un-injected document outside the tab).
      expect(await h.evalDsh<string[]>(`[...document.querySelectorAll('.dshls-tab a[href], .dshls-tab [href]')].map((a) => a.getAttribute('href')).filter((x) => x.includes('/dsh-local-service/'))`)).toEqual([])
      // Positive control for that oracle: an HTML page loads normally and shows no such title.
      const web = await h.upstream('U9', pageHandler('U9'))
      await openInTab(h, web, '/')
      expect(await tabPanelText(h)).not.toContain('这个地址返回的不是网页')
    } finally {
      await h.close()
    }
  })

  it('spec Scenario "被阻止注入的网页仍提示注入被阻止"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U5', pageHandler('U5'))
      await h.open()
      // An exact route beats the plugin's prefix route, so this text/html document is served WITHOUT the injected script.
      h.dsh.webServer.register({
        kind: 'exact',
        path: `/dsh-local-service/p/${String(up.port)}/blocked`,
        handler: (_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><head></head><body>no inject here</body></html>') },
      })
      await submitAddress(h, `127.0.0.1:${String(up.port)}/blocked`)
      await waitFor(async () => (await tabPanelText(h)).includes('页面阻止了注入脚本'), 'blocked title', 15_000, 100)
      await waitFor(() => iframeAtBlank(h), 'iframe at about:blank')
      expect(await tabPanelText(h)).not.toContain('这个地址返回的不是网页')
    } finally {
      await h.close()
    }
  })
})
