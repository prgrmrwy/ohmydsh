import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import * as clientEntry from '../src/client/index.js'
import { ROUTE_PREFIX, TAB_ID, WS_ROUTE, proxyPath } from '../src/contract.js'
import * as plugin from '../src/index.js'
import { startHostHarness, startUpstream } from './support/host-harness.js'
import type { HostHarness, Upstream } from './support/host-harness.js'
import { waitFor } from './support/proxy-fixture.js'

const INDEX = '<!doctype html><html><head><title>dsh</title></head><body></body></html>'
/** The marker every guard text carries (see src/host/guard.ts). */
const GUARD_MARK = 'data-dshls'

describe('可独立启停与卸载清理', () => {
  let harness: HostHarness | undefined
  let upstream: Upstream | undefined
  afterEach(async () => {
    await upstream?.close()
    await harness?.dispose()
    harness = undefined
    upstream = undefined
  })

  /** What a browser-less probe can observe of "the plugin is mounted". */
  async function probe(h: HostHarness, port = 5173) {
    const http = await h.request({ path: proxyPath('p', port, '/') })
    const upgrade = await h.upgrade({ path: `${WS_ROUTE}?fam=p&port=${String(port)}&path=%2Fecho` })
    const index = h.webServer.renderIndex(INDEX, {})
    return { http, upgrade, index }
  }

  it('spec Scenario "正常启用时注册 tab 与路由"', async () => {
    // Host half: with connection available the prefix route, the upgrade route and the index tap are live.
    harness = await startHostHarness({ plugin })
    const mounted = await probe(harness)
    // The plugin's own fence answers (401 without a session); an unregistered path would be a plain 404 / closed socket.
    expect(mounted.http.status).toBe(401)
    expect(mounted.upgrade).toMatchObject({ kind: 'response', status: 401 })
    expect(mounted.index).toContain(GUARD_MARK)
    // Control: a path outside the prefix is not the plugin's.
    expect((await harness.request({ path: '/not-ours/p/5173/' })).status).toBe(404)
    expect(await harness.upgrade({ path: '/not-ours/ws' })).toEqual({ kind: 'closed' })

    // Web half: with better-sidebar available the tab id is registered; without it nothing is.
    const tabs: string[] = []
    const web = new Context()
    web.provide('betterSidebar', { registerTab: (tab: { id: string }) => { tabs.push(tab.id); return () => undefined } })
    const fiber = web.plugin(clientEntry as never)
    await fiber
    await waitFor(() => tabs.length > 0, 2000, 'tab registration')
    expect(tabs).toEqual([TAB_ID])
    // Without betterSidebar the client entry is not even applied (inject gate), so no tab/SW can be registered.
    const bare = new Context()
    let applied = 0
    await bare.plugin({ name: clientEntry.name, inject: clientEntry.inject, apply: () => { applied += 1 } } as never)
    await new Promise((r) => setTimeout(r, 50))
    expect(applied).toBe(0)
    // Positive control for the spy: providing the service afterwards applies it.
    bare.provide('betterSidebar', { registerTab: () => () => undefined })
    await waitFor(() => applied === 1, 2000, 'client apply after betterSidebar appears')
  })

  it('spec Scenario "缺少 connection 时不暴露路由"', async () => {
    harness = await startHostHarness({ plugin, connection: false, fallback: 'none' })
    const bare = await probe(harness)
    expect(bare.http.status).toBe(404)
    expect(bare.upgrade).toEqual({ kind: 'closed' })
    expect(bare.index).not.toContain(GUARD_MARK)
    await harness.dispose()

    // Positive control: the identical probe with connection present IS handled by the plugin.
    harness = await startHostHarness({ plugin })
    const withConnection = await probe(harness)
    expect(withConnection.http.status).toBe(401)
    expect(withConnection.index).toContain(GUARD_MARK)
  })

  it('unload removes both routes and the index tap, and kills in-flight upstream connections within 1 s (Node mirror of the browser scenario, extra)', async () => {
    harness = await startHostHarness({ plugin })
    const cookie = await harness.login()
    let sseClosed: number | undefined
    const wss = new WebSocketServer({ noServer: true })
    let wsUpstreamClosed: number | undefined
    wss.on('connection', (s) => { s.on('close', () => { wsUpstreamClosed = Date.now() }) })
    upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: 1\n\n')
      res.on('close', () => { sseClosed = Date.now() })
    }, { onUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket as never, head, (ws) => wss.emit('connection', ws, req)) })

    // An SSE response in flight …
    const sse: Buffer[] = []
    httpRequest({
      host: '127.0.0.1', port: harness.port, path: proxyPath('p', upstream.port, '/events'), agent: false,
      headers: { host: harness.authority, cookie, 'sec-fetch-site': 'same-origin' },
    }, (res) => { res.on('data', (c: Buffer) => sse.push(c)) }).on('error', () => {}).end()
    // … and an open WebSocket.
    const client = new WebSocket(`ws://${harness.authority}${WS_ROUTE}?fam=p&port=${String(upstream.port)}&path=%2Fws`, { origin: harness.origin, headers: { cookie } })
    const clientClosed = new Promise<number>((resolve) => client.once('close', () => resolve(Date.now())))
    client.on('error', () => {})
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject) })
    await waitFor(() => sse.length > 0, 2000, 'SSE first event')

    // Mounted before unload (so the "gone" assertions below are meaningful).
    expect(harness.webServer.renderIndex(INDEX, {})).toContain(GUARD_MARK)
    expect((await harness.request({ path: proxyPath('p', upstream.port, '/') })).status).toBe(401)

    const t0 = Date.now()
    await harness.disposePlugins()
    await waitFor(() => sseClosed !== undefined && wsUpstreamClosed !== undefined, 1000, 'upstream connections destroyed')
    expect((await clientClosed) - t0).toBeLessThan(1000)

    // Routes and tap are gone: plain 404 / closed socket, and no guard in the index.
    const after = await probe(harness, upstream.port)
    expect(after.http.status).toBe(404)
    expect(after.upgrade).toEqual({ kind: 'closed' })
    expect(after.index).not.toContain(GUARD_MARK)
    expect(ROUTE_PREFIX).toBe('/dsh-local-service')
  })
})
