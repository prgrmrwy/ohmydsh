import { describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor } from './harness.ts'
import { openInTab, pageHandler, proxyUrl } from './tab-driver.ts'

describe('可独立启停与卸载清理', () => {
  it('spec Scenario "卸载时关闭在途连接与 Service Worker"', async () => {
    const h = await startBrowserHarness({ mode: 'tab' })
    try {
      const up = await h.upstream('U1', (req, res, body) => {
        if (req.url === '/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.write('data: hello\n\n')
          return // stays open
        }
        pageHandler('U1')(req, res, body)
      }, { echoWebSocket: true })
      await h.open()
      await openInTab(h, up, '/')
      // One WebSocket and one SSE response, both in flight through the proxy.
      await h.evalTab(`new Promise((resolve) => {
        const life = (window.parent.__life = { wsClosed: false, sseEnded: false, sseGot: '' })
        const ws = new WebSocket('ws://localhost:${String(up.port)}/ws')
        ws.onopen = () => resolve(true)
        ws.onclose = () => { life.wsClosed = true }
        window.__ws = ws
        fetch('/events').then(async (r) => {
          const reader = r.body.getReader()
          for (;;) { const { done, value } = await reader.read(); if (done) break; life.sseGot += new TextDecoder().decode(value) }
          life.sseEnded = true
        }).catch(() => { life.sseEnded = true })
      })`)
      await waitFor(() => h.evalDsh<boolean>(`window.__life.sseGot.includes('hello')`), 'SSE started')
      // Positive control before unloading: route answers, upgrade route exists, worker registered, sockets open.
      const cookie = await h.dsh.login()
      const alive = await h.dsh.request({ path: proxyUrl(up, '/'), headers: { cookie, 'sec-fetch-site': 'same-origin' } })
      expect(alive.status).toBe(200)
      expect(up.openSockets()).toBe(1)
      expect(await h.evalDsh<number>(`navigator.serviceWorker.getRegistrations().then((r) => r.filter((x) => x.scope.endsWith('/dsh-local-service/')).length)`)).toBe(1)

      const t0 = Date.now()
      await h.disposeHostPlugin()
      await h.evalDsh('(window.__hx.dispose(), true)')
      await waitFor(() => h.evalDsh<boolean>(`window.__life.wsClosed && window.__life.sseEnded`), 'both in-flight connections closed', 1000, 25)
      expect(Date.now() - t0).toBeLessThan(2000)
      expect(up.openSockets()).toBe(0)
      // Routes are gone: the proxy path now falls through to DSH's fallback (404), and the upgrade route is gone.
      const gone = await h.dsh.request({ path: proxyUrl(up, '/'), headers: { cookie, 'sec-fetch-site': 'same-origin' } })
      expect(gone.status).toBe(404)
      const upgrade = await h.dsh.upgrade({ path: `/dsh-local-service/ws?fam=p&port=${String(up.port)}&path=%2Fws`, headers: { cookie, origin: h.dsh.origin } })
      expect(upgrade.kind).toBe('closed')
      await waitFor(() => h.evalDsh<boolean>(`navigator.serviceWorker.getRegistrations().then((r) => r.every((x) => !x.scope.endsWith('/dsh-local-service/')))`), 'plugin Service Worker unregistered', 5000)
    } finally {
      await h.close()
    }
  })
})
