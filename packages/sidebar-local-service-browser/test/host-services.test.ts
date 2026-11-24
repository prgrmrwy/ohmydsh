import net from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SERVICES_ROUTE } from '../src/contract.js'
import type { ServiceEntry } from '../src/contract.js'
import { parseLsof, parseProcNetTcp } from '../src/host/services.js'
import { startUpstream } from './support/host-harness.js'
import type { Upstream } from './support/host-harness.js'
import { startProxyFixture } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

const html = (body = 'ok') => (_req: unknown, res: import('node:http').ServerResponse): void => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><body>${body}</body></html>`)
}

/** A TCP server that accepts connections and never answers; counts open sockets (and the peak). */
async function startHanging(): Promise<{ port: number; open(): number; peak(): number; close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  let peak = 0
  const server = net.createServer((socket) => {
    sockets.add(socket)
    peak = Math.max(peak, sockets.size)
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(socket))
    socket.resume() // consume so the peer's FIN is noticed and the socket can close
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return {
    port: (server.address() as AddressInfo).port,
    open: () => sockets.size,
    peak: () => peak,
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()) }),
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('首页列出 Host 上的网页服务', () => {
  let f: ProxyFixture | undefined
  const extra: Upstream[] = []
  const hanging: Array<{ close(): Promise<void> }> = []
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const u of extra.splice(0)) await u.close()
    for (const h of hanging.splice(0)) await h.close()
    await f?.dispose()
    f = undefined
  })

  const list = async (fx: ProxyFixture, headers: Record<string, string | undefined> = {}): Promise<{ status: number; entries: ServiceEntry[]; headers: Record<string, unknown> }> => {
    const res = await fx.get(SERVICES_ROUTE, { absolute: true, headers })
    return { status: res.status, entries: res.status === 200 ? (JSON.parse(res.text()) as ServiceEntry[]) : [], headers: res.headers }
  }

  it('spec Scenario "列出正在运行的网页服务"', async () => {
    f = await startProxyFixture(html('A'))
    const b = await startUpstream((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
    extra.push(b)
    const A = f.upstream.port
    const W = f.harness.port

    // Real listener enumeration (lsof on macOS, /proc on Linux): A and B are genuinely listening on 127.0.0.1.
    const res = await list(f)
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toMatch(/^application\/json/)
    expect(res.entries).toContainEqual({ fam: 'p', port: A, process: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string') })
    const ports = res.entries.map((e) => e.port)
    expect(ports).not.toContain(b.port) // application/json: not a web page
    expect(ports).not.toContain(W) // DSH itself
    expect(ports).toEqual([...ports].sort((x, y) => x - y)) // ascending
    for (const entry of res.entries) {
      expect(entry.process === null || (typeof entry.process === 'string' && !/[\s/]/.test(entry.process))).toBe(true)
    }
    // The probe is a cookie-less, credential-less GET /.
    expect(b.requests.length).toBeGreaterThan(0) // positive control: B really was probed (and filtered out by its type)
    for (const upstream of [f.upstream, b]) {
      const probe = upstream.requests[0]!
      expect(probe.method).toBe('GET')
      expect(probe.url).toBe('/')
      expect(probe.headers.cookie).toBeUndefined()
      expect(probe.headers.authorization).toBeUndefined()
      expect(probe.headers['proxy-authorization']).toBeUndefined()
    }
  })

  it('spec Scenario "服务端点拒绝未认证与跨站请求"', async () => {
    f = await startProxyFixture(html())
    const noCookie = await list(f, { cookie: undefined })
    const sameSite = await list(f, { 'sec-fetch-site': 'same-site' })
    expect([noCookie.status, sameSite.status]).toEqual([401, 403])
    await sleep(100)
    expect(f.upstream.connections).toBe(0) // nothing was probed
    // Missing Sec-Fetch-Site is refused like on every route under the prefix.
    expect((await list(f, { 'sec-fetch-site': undefined })).status).toBe(403)
    expect(f.upstream.connections).toBe(0)
    // Positive control: the legitimate request does probe this port.
    expect((await list(f)).status).toBe(200)
    expect(f.upstream.connections).toBeGreaterThanOrEqual(1)
  })

  it('spec Scenario "无响应的端口不拖慢列表"', async () => {
    f = await startProxyFixture(html('A'))
    const stuck = await startHanging()
    hanging.push(stuck)
    const started = Date.now()
    const res = await list(f)
    const elapsed = Date.now() - started
    expect(res.status).toBe(200)
    expect(elapsed).toBeLessThan(3000)
    expect(res.entries.map((e) => e.port)).not.toContain(stuck.port)
    // Positive controls: the port was accepted-and-probed (a socket was opened to it), and a responsive one is listed.
    expect(stuck.peak()).toBeGreaterThanOrEqual(1)
    expect(res.entries.map((e) => e.port)).toContain(f.upstream.port)
  })

  // ---- extra (non-ledger) tests, using an injected listener enumeration -------------------------------------

  const listing = (...entries: Array<{ fam?: 'p' | 'p6'; port: number; process?: string | null }>) => () =>
    Promise.resolve(entries.map((e) => ({ fam: e.fam ?? 'p', port: e.port, process: e.process ?? null })))

  it('lister failure → 200 and an empty array without details (extra)', async () => {
    f = await startProxyFixture(html(), { internal: { listListeners: () => Promise.reject(new Error('lsof: permission denied /secret/path')) } })
    const res = await f.get(SERVICES_ROUTE, { absolute: true })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('[]')
  })

  it('process is plain text only: executable names pass, anything with space, slash or controls becomes null (extra)', async () => {
    const mk = async (): Promise<Upstream> => { const u = await startUpstream(html()); extra.push(u); return u }
    const [a, b, c, d, e] = [await mk(), await mk(), await mk(), await mk(), await mk()]
    f = await startProxyFixture(html(), {
      internal: {
        listListeners: listing(
          { port: a.port, process: 'node' },
          { port: b.port, process: 'Google Chrome' },
          { port: c.port, process: '/usr/bin/python3' },
          { port: d.port, process: '<img src=x onerror=alert(1)>' },
          { port: e.port },
        ),
      },
    })
    const res = await list(f)
    const byPort = new Map(res.entries.map((x) => [x.port, x.process]))
    expect(byPort.get(a.port)).toBe('node')
    for (const bad of [b, c, d, e]) expect(byPort.get(bad.port)).toBeNull()
    expect(res.entries).toHaveLength(5)
  })

  it('dedupes fam+port, sorts by port, excludes the DSH port, and answers 503 when the DSH port is unknown (extra)', async () => {
    const a = await startUpstream(html()); const b = await startUpstream(html())
    extra.push(a, b)
    const [lo, hi] = a.port < b.port ? [a, b] : [b, a]
    let dshPort = 0
    f = await startProxyFixture(html(), {
      internal: {
        listListeners: () => Promise.resolve([hi.port, lo.port, hi.port, dshPort].map((port) => ({ fam: 'p' as const, port, process: null }))),
      },
    })
    dshPort = f.harness.port // the lister reads it lazily: a listing that includes DSH itself
    const res = await list(f)
    expect(res.entries.map((e) => e.port)).toEqual([lo.port, hi.port])
    // The DSH port is never contacted by the discovery code.
    Object.defineProperty(f.harness.webServer, 'port', { get: () => hi.port, configurable: true })
    const before = hi.connections
    const excluded = await list(f)
    expect(excluded.entries.map((e) => e.port)).toEqual([lo.port]) // positive control: `hi` WOULD be listed if it were not DSH
    expect(hi.connections).toBe(before)
    Object.defineProperty(f.harness.webServer, 'port', { get: () => undefined, configurable: true })
    expect((await list(f)).status).toBe(503)
  })

  it('probes never follow a Location and never read the body (extra)', async () => {
    const target = await startUpstream(html('target'))
    const slow = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<html>')
      const timer = setInterval(() => res.write('x'.repeat(1024)), 20)
      res.on('close', () => clearInterval(timer))
    })
    const redirecting = await startUpstream((_req, res) => { res.writeHead(302, { 'content-type': 'text/html', location: `http://127.0.0.1:${String(target.port)}/` }); res.end() })
    extra.push(target, slow, redirecting)
    f = await startProxyFixture(html(), { internal: { listListeners: listing({ port: redirecting.port }, { port: slow.port }) } })
    let slowClosed: number | undefined
    slow.server.on('connection', (socket) => socket.on('close', () => { slowClosed = Date.now() }))
    const res = await list(f)
    const returnedAt = Date.now()
    // Any status counts: the 302 with text/html is listed; its Location target was never contacted.
    expect(res.entries.map((e) => e.port).sort()).toEqual([redirecting.port, slow.port].sort())
    expect(target.connections).toBe(0)
    // The streaming response was cut right after its headers, long before the stream could end.
    await vi.waitFor(() => expect(slowClosed).toBeDefined(), { timeout: 1000 })
    expect(slowClosed! - returnedAt).toBeLessThan(1000)
  })

  it('only the 64 lowest candidate ports are probed (extra)', async () => {
    const base = 20_000
    const candidates = Array.from({ length: 100 }, (_, i) => ({ fam: 'p' as const, port: base + 99 - i, process: null })) // descending on purpose
    const probed = new Set<number>()
    const original = net.Socket.prototype.connect
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      const first = Array.isArray(args[0]) ? args[0][0] : args[0]
      const port = typeof first === 'object' && first !== null ? (first as { port?: number }).port : first
      if (typeof port === 'number' && port >= base && port < base + 100) probed.add(port)
      return (original as (...a: unknown[]) => net.Socket).apply(this, args)
    } as never)
    f = await startProxyFixture(html(), { internal: { listListeners: () => Promise.resolve(candidates) } })
    const res = await list(f)
    expect(res.status).toBe(200)
    expect([...probed].sort((x, y) => x - y)).toEqual(Array.from({ length: 64 }, (_, i) => base + i))
  })

  it('at most 16 probes run at once (extra)', async () => {
    const servers = await Promise.all(Array.from({ length: 40 }, () => startHanging()))
    hanging.push(...servers)
    const ports = new Set(servers.map((s) => s.port))
    // Client side: a probe is "running" from its connect() until its socket closes (server-side counters lag the close).
    let running = 0
    let peak = 0
    const original = net.Socket.prototype.connect
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      const first = Array.isArray(args[0]) ? args[0][0] : args[0]
      const port = typeof first === 'object' && first !== null ? (first as { port?: number }).port : first
      if (typeof port === 'number' && ports.has(port)) {
        running += 1
        peak = Math.max(peak, running)
        this.once('close', () => { running -= 1 })
      }
      return (original as (...a: unknown[]) => net.Socket).apply(this, args)
    } as never)
    f = await startProxyFixture(html(), { internal: { probeTimeoutMs: 150, listListeners: () => Promise.resolve(servers.map((s) => ({ fam: 'p' as const, port: s.port, process: null }))) } })
    const res = await list(f)
    expect(res.entries).toEqual([])
    expect(servers.filter((s) => s.peak() > 0)).toHaveLength(40) // every candidate was probed (40 ≤ 64)
    expect(peak).toBe(16) // never above 16, and 16 really happen at once (control)
  })

  it('the 3 s budget covers enumeration and cancels outstanding probes; results so far are returned (extra)', async () => {
    const stuck = await Promise.all(Array.from({ length: 10 }, () => startHanging())) // < 16, so the fast port is probed at once
    hanging.push(...stuck)
    const fast = await startUpstream(html('fast'))
    extra.push(fast)
    // 1) deadline shorter than the probe timeout: probes still in flight at the deadline are destroyed.
    f = await startProxyFixture(html(), {
      internal: {
        servicesDeadlineMs: 400,
        probeTimeoutMs: 800,
        listListeners: () => Promise.resolve([fast, ...stuck].map((s) => ({ fam: 'p' as const, port: s.port, process: null }))),
      },
    })
    let started = Date.now()
    let res = await list(f)
    expect(Date.now() - started).toBeLessThan(900)
    expect(res.entries.map((e) => e.port)).toEqual([fast.port]) // the answered probe is kept, the rest dropped
    await vi.waitFor(() => expect(stuck.reduce((n, s) => n + s.open(), 0)).toBe(0), { timeout: 800 }) // sockets were destroyed, not left to time out
    await f.dispose()

    // 2) a hung enumeration (never settles) is cut by the same budget.
    f = await startProxyFixture(html(), { internal: { servicesDeadlineMs: 300, listListeners: () => new Promise(() => undefined) } })
    started = Date.now()
    res = await list(f)
    expect(Date.now() - started).toBeLessThan(900)
    expect(res).toMatchObject({ status: 200, entries: [] })
  })

  it('the default budget really is under 3 s even when 64 candidates all hang (extra)', async () => {
    const stuck = await Promise.all(Array.from({ length: 64 }, () => startHanging()))
    hanging.push(...stuck)
    f = await startProxyFixture(html(), { internal: { listListeners: () => Promise.resolve(stuck.map((s) => ({ fam: 'p' as const, port: s.port, process: null }))) } })
    const started = Date.now()
    const res = await list(f)
    expect(Date.now() - started).toBeLessThan(3000) // 64 / 16 × 800 ms = 3.2 s without a total deadline
    expect(res).toMatchObject({ status: 200, entries: [] })
    await vi.waitFor(() => expect(stuck.reduce((n, s) => n + s.open(), 0)).toBe(0), { timeout: 800 })
  })

  it('only GET (and HEAD) are accepted; the endpoint is read-only (extra)', async () => {
    f = await startProxyFixture(html())
    expect((await f.get(SERVICES_ROUTE, { absolute: true, method: 'POST', body: '{}' })).status).toBe(405)
    expect((await f.get(SERVICES_ROUTE, { absolute: true, method: 'DELETE' })).status).toBe(405)
    expect(f.upstream.connections).toBe(0)
  })
})

describe('listener parsers (extra)', () => {
  it('parseLsof: lsof -F output → candidates on 127.0.0.1, ::1, 0.0.0.0, :: only', () => {
    const out = [
      'p101', 'cnode', 'f21', 'tIPv4', 'n127.0.0.1:5173',
      'p102', 'cGoogle\\x20Chrome', 'f30', 'tIPv6', 'n[::1]:8080',
      'p103', 'cpython3', 'f4', 'tIPv4', 'n*:8000',
      'p103', 'cpython3', 'f5', 'tIPv6', 'n*:8000',
      'p104', 'cnginx', 'f6', 'tIPv4', 'n192.168.1.5:80', // not loopback/wildcard
      'p105', 'ctailscaled', 'f7', 'tIPv6', 'n[fe80::1]:443',
      'p106', 'cdocker', 'f8', 'tIPv4', 'n0.0.0.0:2375',
      'p107', 'cnode', 'f9', 'tIPv4', 'n127.0.0.1:5173->127.0.0.1:9000', // not a listener
      '',
    ].join('\n')
    expect(parseLsof(out).sort((a, b) => a.port - b.port || a.fam.localeCompare(b.fam))).toEqual([
      { fam: 'p', port: 2375, process: 'docker' },
      { fam: 'p', port: 5173, process: 'node' },
      { fam: 'p', port: 8000, process: 'python3' },
      { fam: 'p6', port: 8000, process: 'python3' },
      { fam: 'p6', port: 8080, process: null }, // escaped space → not a bare executable name
    ])
  })

  it('parseProcNetTcp: LISTEN rows on loopback/wildcard, tcp and tcp6', () => {
    const header = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'
    const v4 = [
      header,
      '   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000 100 0 0 10 0', // 127.0.0.1:5173 LISTEN
      '   1: 00000000:1F40 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000 100 0 0 10 0', // 0.0.0.0:8000
      '   2: 0501A8C0:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 33333 1 0000 100 0 0 10 0', // 192.168.1.5:80
      '   3: 0100007F:1435 0100007F:C000 01 00000000:00000000 00:00000000 00000000  1000        0 44444 1 0000 100 0 0 10 0', // ESTABLISHED
    ].join('\n')
    const v6 = [
      header,
      '   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55555 1 0000 100 0 0 10 0', // [::1]:8080
      '   1: 00000000000000000000000000000000:1F40 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 66666 1 0000 100 0 0 10 0', // [::]:8000
    ].join('\n')
    const rows = [...parseProcNetTcp(v4, 'p'), ...parseProcNetTcp(v6, 'p6')]
    expect(rows.map(({ fam, port, inode }) => ({ fam, port, inode }))).toEqual([
      { fam: 'p', port: 5173, inode: '11111' },
      { fam: 'p', port: 8000, inode: '22222' },
      { fam: 'p6', port: 8080, inode: '55555' },
      { fam: 'p6', port: 8000, inode: '66666' },
    ])
  })
})
