import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { openInTab, pageHandler } from './tab-driver.ts'

/** Connect from the page and resolve with how it ended: echo of `message`, or `closed` without ever opening. */
const wsRoundTrip = (url: string, protocols: string[] | undefined, message: string): string => `new Promise((resolve) => {
  const ws = new WebSocket(${JSON.stringify(url)}${protocols === undefined ? '' : `, ${JSON.stringify(protocols)}`})
  let opened = false
  ws.onopen = () => { opened = true; ws.send(${JSON.stringify(message)}) }
  ws.onmessage = (e) => { resolve('echo:' + e.data); ws.close() }
  ws.onclose = () => resolve(opened ? 'closed-after-open' : 'never-opened')
  setTimeout(() => resolve('timeout'), 8000)
})`

describe('WebSocket 代理', () => {
  let h: BrowserHarness
  let u1: Upstream
  let u2: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    u1 = await h.upstream('U1', pageHandler('U1'), { echoWebSocket: (req) => req.url === '/echo' && req.headers.cookie === 'sid=abc' })
    u2 = await h.upstream('U2', pageHandler('U2'), { echoWebSocket: true })
    await h.open()
    await openInTab(h, u1, '/')
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "带登录态的 WebSocket 透传"', async () => {
    // Gate control: without the cookie the upstream refuses the upgrade.
    expect(await h.evalTab<string>(wsRoundTrip(`ws://localhost:${String(u1.port)}/echo`, ['v1'], 'ping'))).toBe('never-opened')
    await h.evalTab(`(document.cookie = 'sid=abc', true)`)
    expect(await h.evalTab<string>(wsRoundTrip(`ws://localhost:${String(u1.port)}/echo`, ['v1'], 'ping'))).toBe('echo:ping')
    const accepted = u1.upgrades[u1.upgrades.length - 1]!
    expect(accepted.url).toBe('/echo')
    expect(accepted.headers['sec-websocket-protocol']).toBe('v1')
    expect(accepted.headers.cookie).toBe('sid=abc')
    expect(h.dshUpgrades.some((r) => r.url.startsWith('/dsh-local-service/ws?'))).toBe(true)
  })

  it('spec Scenario "只连 WebSocket 的另一端口也可用"', async () => {
    expect(u2.requests).toHaveLength(0) // never loaded over HTTP
    expect(await h.evalTab<string>(wsRoundTrip(`ws://127.0.0.1:${String(u2.port)}/ws`, undefined, 'x'))).toBe('echo:x')
    expect(h.directHits(u2.port)).toHaveLength(0)
    // Positive control: a direct browser WebSocket to the same port IS counted as a direct hit.
    await h.evalCockpit(wsRoundTrip(`ws://127.0.0.1:${String(u2.port)}/ws`, undefined, 'direct'))
    await waitFor(() => h.directHits(u2.port).some((r) => r.kind === 'websocket'), 'direct WebSocket observed')
  })
})
