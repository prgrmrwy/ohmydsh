import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IDB_NAME, IDB_STORE } from '../../src/sw/constants.ts'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { hostSaw, openInTab, pageHandler, proxyUrl } from './tab-driver.ts'

describe('本插件 Service Worker 改写受控页面的子请求', () => {
  let h: BrowserHarness
  let u1: Upstream
  let u2: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    u1 = await h.upstream('U1', pageHandler('U1'))
    u2 = await h.upstream('U2', pageHandler('U2'))
    await h.open()
    await openInTab(h, u1, '/')
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "根路径资源改写到当前端口"', async () => {
    expect(await h.evalTab<string>(`location.pathname`)).toBe('/') // the injected script restored the direct address
    expect(await h.evalTab<string>(`fetch('/assets/main.js').then((r) => r.text())`)).toBe('U1-asset')
    expect(hostSaw(h, proxyUrl(u1, '/assets/main.js'))).toBe(1)
    expect(hostSaw(h, '/assets/main.js')).toBe(0) // DSH itself never saw the root path
    // Positive control: the DSH main page (not controlled) asking the same path DOES reach DSH.
    await h.evalDsh(`fetch('/assets/main.js').then((r) => r.status)`)
    expect(hostSaw(h, '/assets/main.js')).toBe(1)
  })

  it('spec Scenario "写死的另一本机端口地址被改写"', async () => {
    expect(await h.evalTab<string>(`fetch('http://localhost:${String(u2.port)}/api/x').then((r) => r.text())`)).toBe('U2-api')
    expect(hostSaw(h, proxyUrl(u2, '/api/x'))).toBe(1)
    expect(u2.requests.map((r) => r.url)).toEqual(['/api/x'])
    expect(u2.directRequests()).toHaveLength(0)
    expect(h.directHits(u2.port)).toHaveLength(0)
    // Positive control: a deliberate direct request from the browser rings both counters.
    await h.evalCockpit(`fetch('http://localhost:${String(u2.port)}/control', { mode: 'no-cors' }).then(() => true)`)
    await waitFor(() => u2.directRequests().length === 1, 'upstream counted the direct request')
    await waitFor(() => h.directHits(u2.port).length === 1, 'CDP counted the direct request')
  })

  it('spec Scenario "Service Worker 重启后仍按原端口改写"', async () => {
    await h.stopServiceWorker('/dsh-local-service/sw.js')
    expect(await h.evalTab<string>(`fetch('/api/data').then((r) => r.text())`)).toBe('U1-api')
    expect(hostSaw(h, proxyUrl(u1, '/api/data'))).toBe(1)
    expect(hostSaw(h, '/api/data')).toBe(0)
  })

  it('spec Scenario "未知 client 不放行"', async () => {
    // Forget every client record (IndexedDB) and restart the worker so memory is empty too.
    await h.evalDsh(`new Promise((resolve, reject) => {
      const open = indexedDB.open(${JSON.stringify(IDB_NAME)}, 1)
      open.onsuccess = () => {
        const tx = open.result.transaction(${JSON.stringify(IDB_STORE)}, 'readwrite')
        tx.objectStore(${JSON.stringify(IDB_STORE)}).clear()
        tx.oncomplete = () => { open.result.close(); resolve(true) }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })`)
    await h.stopServiceWorker('/dsh-local-service/sw.js')
    const status = await h.evalTab<number>(`fetch('/api/x').then((r) => r.status)`)
    expect(status).toBe(502)
    expect(hostSaw(h, '/api/x')).toBe(0)
    expect(hostSaw(h, proxyUrl(u1, '/api/x'))).toBe(0)
    // Positive control: the uncontrolled DSH page asking `/api/x` is answered (404) by DSH itself, and is counted.
    await h.evalDsh(`fetch('/api/x').then((r) => r.status)`)
    expect(hostSaw(h, '/api/x')).toBe(1)
  })

  it('spec Scenario "DSH 主页面不受控"', async () => {
    expect(await h.evalDsh<boolean>(`navigator.serviceWorker.controller === null`)).toBe(true)
    // Positive control: the plugin worker is active, and it does control the proxied document.
    expect(h.serviceWorker('/dsh-local-service/sw.js')?.status).toBe('activated')
    expect(await h.evalTab<boolean>(`!!navigator.serviceWorker.controller`)).toBe(true)
    const before = u1.requests.length
    await h.evalDsh(`fetch('/api/sessions').then((r) => r.status)`)
    expect(hostSaw(h, '/api/sessions')).toBe(1)
    expect(u1.requests.length).toBe(before)
  })
})
