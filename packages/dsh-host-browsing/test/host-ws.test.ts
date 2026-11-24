import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { WS_ROUTE, namePrefix } from '../src/contract.js'
import { positiveControl } from './support/host-harness.js'
import type { UpgradeOutcome } from './support/host-harness.js'
import { startProxyFixture, waitFor } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

const authorityHash = (host: string): string => createHash('sha256').update(host).digest('base64url').slice(0, 8)

/** Upstream that completes real WebSocket handshakes (ws library) and echoes. */
function echoUpgrade(received: { headers: IncomingMessage['headers']; url: string }[], closed: { at?: number } = {}) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => [...protocols][0] ?? false })
  wss.on('connection', (socket) => {
    socket.send('hello-from-upstream') // sent immediately: may share a TCP segment with the 101 head
    socket.on('close', () => { closed.at = Date.now() })
    socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }))
  })
  return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    received.push({ headers: req.headers, url: req.url ?? '' })
    wss.handleUpgrade(req, socket as never, head, (ws) => wss.emit('connection', ws, req))
  }
}

describe('WebSocket 代理 (Host 侧)', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    await f?.dispose()
    f = undefined
  })

  const wsPath = (fam: string, port: number | string, path: string): string =>
    `${WS_ROUTE}?fam=${fam}&port=${String(port)}&path=${encodeURIComponent(path)}`
  const refused = (outcome: UpgradeOutcome): void => {
    expect(outcome.kind).not.toBe('upgraded')
    if (outcome.kind === 'response') expect(outcome.status).toBeGreaterThanOrEqual(400)
  }

  it('spec Scenario "跨端口 Origin 的升级被拒绝"', async () => {
    const received: { headers: IncomingMessage['headers']; url: string }[] = []
    f = await startProxyFixture(undefined, { upstream: { onUpgrade: echoUpgrade(received) } })
    const path = wsPath('p', f.upstream.port, '/echo')
    // Valid session cookie but Origin is another loopback port while Host is the DSH authority.
    const crossPort = await f.harness.upgrade({ path, headers: { cookie: f.cookie, origin: 'http://127.0.0.1:9999' } })
    refused(crossPort)
    expect(f.upstream.connections).toBe(0)
    // Positive control: the very same request with the matching Origin is upgraded and reaches the upstream.
    const ok = await f.harness.upgrade({ path, headers: { cookie: f.cookie, origin: f.harness.origin } })
    expect(ok.kind).toBe('upgraded')
    if (ok.kind === 'upgraded') ok.socket.destroy()
    expect(f.upstream.connections).toBe(1)
    // No session at all is refused too.
    refused(await f.harness.upgrade({ path, headers: { origin: f.harness.origin } }))
    expect(f.upstream.connections).toBe(1)
  })

  it('spec Scenario "非法 path 被拒绝"', async () => {
    const received: { headers: IncomingMessage['headers']; url: string }[] = []
    f = await startProxyFixture(undefined, { upstream: { onUpgrade: echoUpgrade(received) } })
    const headers = { cookie: f.cookie, origin: f.harness.origin }
    refused(await f.harness.upgrade({ path: wsPath('p', f.upstream.port, '/x\r\nHost: evil'), headers }))
    for (const bad of ['x', '/a b', '/a#frag', '/a\tb', '/é']) {
      refused(await f.harness.upgrade({ path: wsPath('p', f.upstream.port, bad), headers }))
    }
    refused(await f.harness.upgrade({ path: `${WS_ROUTE}?fam=p&port=${String(f.upstream.port)}`, headers })) // path missing
    refused(await f.harness.upgrade({ path: wsPath('p', 'abc', '/ok'), headers })) // bad port
    refused(await f.harness.upgrade({ path: wsPath('p', 70000, '/ok'), headers }))
    refused(await f.harness.upgrade({ path: wsPath('p', f.harness.port, '/ok'), headers })) // the DSH server itself
    refused(await f.harness.upgrade({ path: wsPath('x', f.upstream.port, '/ok'), headers })) // unknown family
    expect(f.upstream.connections).toBe(0)
    // Positive control: a well-formed request is proxied.
    const ok = await f.harness.upgrade({ path: wsPath('p', f.upstream.port, '/ok'), headers })
    expect(ok.kind).toBe('upgraded')
    if (ok.kind === 'upgraded') ok.socket.destroy()
    expect(f.upstream.connections).toBe(1)
  })

  it('spec Scenario "上游拒绝升级时关闭客户端"', async () => {
    f = await startProxyFixture(undefined, {
      upstream: { onUpgrade: (_req, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nSet-Cookie: leak=1\r\n\r\n') } },
    })
    const outcome = await f.harness.upgrade({ path: wsPath('p', f.upstream.port, '/echo'), headers: { cookie: f.cookie, origin: f.harness.origin } })
    expect(outcome.kind).toBe('closed')
    expect(f.upstream.upgrades).toHaveLength(1)
  })

  it('proxies a real WebSocket end to end with the header allow-list (extra, Node-level mirror of the browser scenario)', async () => {
    const received: { headers: IncomingMessage['headers']; url: string }[] = []
    const upstreamClosed: { at?: number } = {}
    f = await startProxyFixture(undefined, { upstream: { onUpgrade: echoUpgrade(received, upstreamClosed) } })
    const h1 = authorityHash(f.harness.authority)
    const mine = namePrefix(h1, 'p', f.upstream.port)
    const client = new WebSocket(`ws://${f.harness.authority}${wsPath('p', f.upstream.port, '/echo?room=1')}`, ['v1'], {
      origin: f.harness.origin,
      headers: {
        cookie: `${f.cookie}; ${mine}sid=abc; ${mine.replace('.p.', '.p6.')}sid=nope; other=1`,
        authorization: 'Bearer secret',
        'x-custom': 'should-not-pass',
      },
    })
    const messages: string[] = []
    client.on('message', (data) => messages.push(String(data)))
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject) })
    expect(client.protocol).toBe('v1')
    client.send('ping')
    await waitFor(() => messages.includes('ping') && messages.includes('hello-from-upstream'), 2000, 'echo + upstream greeting')

    const seen = received[0]!
    expect(seen.url).toBe('/echo?room=1')
    expect(seen.headers['sec-websocket-protocol']).toBe('v1')
    expect(seen.headers.cookie).toBe('sid=abc')
    expect(seen.headers.origin).toBe(`http://127.0.0.1:${String(f.upstream.port)}`)
    expect(seen.headers.host).toBe(`127.0.0.1:${String(f.upstream.port)}`)
    expect(seen.headers.authorization).toBeUndefined()
    expect(seen.headers['x-custom']).toBeUndefined()

    // Closing the client closes the upstream side within 1 s.
    const closedAt = Date.now()
    client.close()
    await waitFor(() => upstreamClosed.at !== undefined, 1000, 'upstream socket closed after client close')
    expect(upstreamClosed.at! - closedAt).toBeLessThan(1000)
  })

  it('closes the client within 1 s when the upstream closes (extra)', async () => {
    let upstreamSocket: import('ws').WebSocket | undefined
    const wss = new WebSocketServer({ noServer: true })
    wss.on('connection', (socket) => { upstreamSocket = socket })
    f = await startProxyFixture(undefined, { upstream: { onUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket as never, head, (ws) => wss.emit('connection', ws, req)) } })
    const client = new WebSocket(`ws://${f.harness.authority}${wsPath('p', f.upstream.port, '/x')}`, { origin: f.harness.origin, headers: { cookie: f.cookie } })
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject) })
    await waitFor(() => upstreamSocket !== undefined, 1000, 'upstream connection')
    const closed = new Promise<number>((resolve) => client.once('close', () => resolve(Date.now())))
    const t0 = Date.now()
    upstreamSocket!.close()
    expect((await closed) - t0).toBeLessThan(1000)
    await positiveControl(f.upstream)
  })
})
