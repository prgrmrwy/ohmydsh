import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyPath } from '../src/contract.js'
import { closedPort } from './support/host-harness.js'
import { startProxyFixture } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

/** Record the destination port of every outgoing TCP connect made in this process. */
function trackConnects(): { to(port: number): number; restore(): void } {
  const ports: number[] = []
  const original = net.Socket.prototype.connect
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    // net normalizes to a single `[options, cb]` array before calling Socket#connect.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0]
    const port = typeof first === 'number' ? first : typeof first === 'object' && first !== null ? (first as { port?: number }).port : undefined
    if (typeof port === 'number') ports.push(port)
    return (original as (...a: unknown[]) => net.Socket).apply(this, args)
  } as never)
  return { to: (port) => ports.filter((p) => p === port).length, restore: () => vi.restoreAllMocks() }
}

describe('代理目标限制', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    vi.restoreAllMocks()
    await f?.dispose()
    f = undefined
  })

  it('spec Scenario "指向 DSH 自身端口被拒绝"', async () => {
    f = await startProxyFixture()
    const dshPort = f.harness.port
    const connects = trackConnects()
    const res = await f.get(proxyPath('p', dshPort, '/'), { absolute: true })
    expect(res.status).toBe(400)
    // The only TCP connection to the DSH port is this test's own client; the proxy opened none.
    expect(connects.to(dshPort)).toBe(1)
    // Positive control: the same spy sees the proxy's connection to a legitimate target.
    expect((await f.get('/')).status).toBe(200)
    expect(connects.to(f.upstream.port)).toBeGreaterThanOrEqual(1)
  })

  it('spec Scenario "Host 端口未知时拒绝"', async () => {
    f = await startProxyFixture()
    // ctx.webServer.port is read per request; shadow the getter with `undefined` (port not yet known).
    Object.defineProperty(f.harness.webServer, 'port', { get: () => undefined, configurable: true })
    const res = await f.get('/')
    expect(res.status).toBe(503)
    expect(f.upstream.connections).toBe(0)
    // Positive control: with the port known again the same request is forwarded.
    delete (f.harness.webServer as { port?: number }).port
    expect((await f.get('/')).status).toBe(200)
    expect(f.upstream.connections).toBe(1)
  })

  it('spec Scenario "上游无服务时返回 502"', async () => {
    f = await startProxyFixture()
    const port = await closedPort()
    const res = await f.get(proxyPath('p', port, '/'), { absolute: true })
    expect(res.status).toBe(502)
    expect(res.text()).toContain(String(port))
  })

  it('spec Scenario "长流不被总时长截断"', async () => {
    // Spec numbers, default connect timeout: an SSE event every 5 s, 6 events, 30 s in total.
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      let sent = 0
      const timer = setInterval(() => {
        res.write(`data: ${String(++sent)}\n\n`)
        if (sent === 6) {
          clearInterval(timer)
          res.end()
        }
      }, 5000)
      res.on('close', () => clearInterval(timer))
    })
    const started = Date.now()
    const res = await f.get('/events')
    expect(res.status).toBe(200)
    expect(res.text().match(/^data: \d$/gm)).toEqual(['data: 1', 'data: 2', 'data: 3', 'data: 4', 'data: 5', 'data: 6'])
    expect(Date.now() - started).toBeGreaterThanOrEqual(29_000)
  }, 60_000)

  it('a long stream is not cut by any limit derived from the connect timeout (scaled, extra)', async () => {
    // Connect timeout configured to 100 ms, events every 250 ms for 1.5 s: any total-duration or idle
    // timeout derived from it would cut the stream. Fast companion of the spec-sized scenario above.
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      let sent = 0
      const timer = setInterval(() => {
        res.write(`data: ${String(++sent)}\n\n`)
        if (sent === 6) {
          clearInterval(timer)
          res.end()
        }
      }, 250)
      res.on('close', () => clearInterval(timer))
    }, { internal: { connectTimeoutMs: 100 } })
    const started = Date.now()
    const res = await f.get('/events')
    expect(res.status).toBe(200)
    expect(res.text().match(/^data: \d$/gm)).toEqual(['data: 1', 'data: 2', 'data: 3', 'data: 4', 'data: 5', 'data: 6'])
    expect(Date.now() - started).toBeGreaterThan(1200)
  })
})
