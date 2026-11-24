/**
 * Review M2: the 5 s Service Worker budget covers `register()` AND activation (spec 前置条件不满足时失败闭合).
 * Unit part drives the real `browserPlatform` with a fake `navigator.serviceWorker` and fake timers;
 * the Chromium part uses a real hanging / slow `sw.js` through the real tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserPlatform, SW_ACTIVE_TIMEOUT_MS } from '../../src/client/platform.ts'
import { startBrowserHarness, waitFor } from './harness.ts'
import { pageHandler, submitAddress, tabError } from './tab-driver.ts'

type Reg = { active: object | null }
function stubServiceWorker(register: () => Promise<Reg>): void {
  vi.stubGlobal('navigator', { serviceWorker: { register } })
}

describe('Service Worker 预算：注册加激活共用 5 秒', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  /** Settle `promise`, advancing fake time in 50 ms steps up to `limitMs`; reports when and how it ended. */
  async function race(promise: Promise<void>, limitMs: number): Promise<{ at: number; outcome: 'resolved' | 'rejected' | 'pending'; message?: string }> {
    let outcome: 'resolved' | 'rejected' | 'pending' = 'pending'
    let message: string | undefined
    let at = -1
    promise.then(() => { outcome = 'resolved' }, (e: Error) => { outcome = 'rejected'; message = e.message })
    for (let t = 0; t <= limitMs && outcome === 'pending'; t += 50) {
      await vi.advanceTimersByTimeAsync(50)
      if (outcome !== 'pending') at = t + 50
    }
    return { at, outcome, ...(message === undefined ? {} : { message }) }
  }

  it('register() that never settles fails at the 5 s budget', async () => {
    stubServiceWorker(() => new Promise<Reg>(() => undefined))
    const r = await race(browserPlatform.registerServiceWorker(), 9000)
    expect(r.outcome).toBe('rejected')
    expect(r.at).toBeLessThanOrEqual(SW_ACTIVE_TIMEOUT_MS + 100)
    expect(r.message).toMatch(/Service Worker/)
  })

  it('register() resolving only after 5200 ms still fails at 5 s, and the late result changes nothing', async () => {
    stubServiceWorker(() => new Promise<Reg>((resolve) => setTimeout(() => resolve({ active: {} }), 5200)))
    const promise = browserPlatform.registerServiceWorker()
    const r = await race(promise, 9000)
    expect(r.outcome).toBe('rejected')
    expect(r.at).toBeLessThanOrEqual(SW_ACTIVE_TIMEOUT_MS + 100)
    await vi.advanceTimersByTimeAsync(2000) // the late resolve must not blow up (no unhandled rejection / second settle)
  })

  it('registration that consumes most of the budget may still activate in the remainder', async () => {
    const reg: Reg = { active: null }
    stubServiceWorker(() => new Promise<Reg>((resolve) => setTimeout(() => resolve(reg), 3000)))
    setTimeout(() => { reg.active = {} }, 4500)
    const r = await race(browserPlatform.registerServiceWorker(), 9000)
    expect(r.outcome).toBe('resolved')
    expect(r.at).toBeLessThanOrEqual(4600)
  })

  it('a slow register() does not buy extra time for activation (one shared budget)', async () => {
    const reg: Reg = { active: null }
    stubServiceWorker(() => new Promise<Reg>((resolve) => setTimeout(() => resolve(reg), 3000)))
    const r = await race(browserPlatform.registerServiceWorker(), 9000)
    expect(r.outcome).toBe('rejected')
    expect(r.at).toBeLessThanOrEqual(SW_ACTIVE_TIMEOUT_MS + 100) // not 3000 + 5000
  })
})

describe('Service Worker 预算：真实 Chromium，tab 前置检查', () => {
  const SW_OK = `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))`

  it('a sw.js response that never completes yields an error within the budget and no iframe', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U1', pageHandler('U1'))
      await h.open()
      h.dsh.webServer.register({ kind: 'exact', path: '/dsh-local-service/sw.js', handler: (_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.write('/* partial */') } })
      const t0 = Date.now()
      await submitAddress(h, `127.0.0.1:${String(up.port)}`)
      await waitFor(async () => (await tabError(h)).includes('Service Worker'), 'tab reports the hanging registration', 8000, 100)
      expect(Date.now() - t0).toBeLessThan(7000)
      expect(await h.evalDsh<boolean>(`!!document.querySelector('iframe[data-dshls]')`)).toBe(false)
      expect(up.requests).toHaveLength(0)
    } finally {
      await h.close()
    }
  }, 30_000)

  it('a sw.js that only completes after 5200 ms is reported as a failure and never loads the page afterwards', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U1', pageHandler('U1'))
      await h.open()
      h.dsh.webServer.register({ kind: 'exact', path: '/dsh-local-service/sw.js', handler: (_req, res) => { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(SW_OK) }, 5200) } })
      const t0 = Date.now()
      await submitAddress(h, `127.0.0.1:${String(up.port)}`)
      await waitFor(async () => (await tabError(h)).includes('Service Worker'), 'tab reports the slow registration', 8000, 100)
      expect(Date.now() - t0).toBeLessThan(5200)
      await new Promise((r) => setTimeout(r, 2000)) // the late registration lands now
      expect(await h.evalDsh<boolean>(`!!document.querySelector('iframe[data-dshls]')`)).toBe(false)
      expect(up.requests).toHaveLength(0)
    } finally {
      await h.close()
    }
  }, 40_000)
})
