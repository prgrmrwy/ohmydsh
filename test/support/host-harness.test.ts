import { afterEach, describe, expect, it } from 'vitest'
import { closedPort, positiveControl, startHostHarness, startUpstream } from './host-harness.js'
import type { HostHarness, Upstream } from './host-harness.js'

/** Smoke test of the Node harness itself (tasks.md 0.3): the gate it provides is the real one. */
describe('host-harness smoke', () => {
  let harness: HostHarness | undefined
  const upstreams: Upstream[] = []

  afterEach(async () => {
    for (const upstream of upstreams.splice(0)) await upstream.close()
    await harness?.dispose()
    harness = undefined
  })

  /** Mount a route fenced by the real `connection.requestRejection`, as the plugin will. */
  async function mountFencedRoute(): Promise<HostHarness> {
    const h = await startHostHarness()
    const connection = h.connection!
    h.webServer.register({
      kind: 'exact',
      path: '/smoke',
      handler: (req, res) => {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('admitted')
      },
    })
    return h
  }

  it('real requestRejection: no cookie → 401, minted cookie → 200', async () => {
    harness = await mountFencedRoute()
    const anonymous = await harness.request({ path: '/smoke' })
    expect(anonymous.status).toBe(401)

    const cookie = await harness.login()
    expect(cookie).toMatch(/^dsh-auth-/)
    const authenticated = await harness.request({ path: '/smoke', headers: { cookie } })
    expect(authenticated.status).toBe(200)
    expect(authenticated.text()).toBe('admitted')
  })

  it('the gate is not a pass-through: forged cookie → 401, cross-site → 403, other authority\'s cookie → 401', async () => {
    harness = await mountFencedRoute()
    const cookie = await harness.login()
    const [name] = cookie.split('=')

    expect((await harness.request({ path: '/smoke', headers: { cookie: `${name}=v1.forged` } })).status).toBe(401)
    expect((await harness.request({ path: '/smoke', headers: { cookie, 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await harness.request({ path: '/smoke', headers: { cookie, origin: 'http://127.0.0.1:1' } })).status).toBe(403)

    // A second loopback authority gets its own cookie name; the first one is useless there.
    const otherAuthority = `localhost:${String(harness.port)}`
    const otherCookie = await harness.login(otherAuthority)
    expect(otherCookie.split('=')[0]).not.toBe(name)
    expect((await harness.request({ path: '/smoke', headers: { host: otherAuthority, cookie } })).status).toBe(401)
    expect((await harness.request({ path: '/smoke', headers: { host: otherAuthority, cookie: otherCookie } })).status).toBe(200)
  })

  it('upstream connection counter: 0 before traffic, positive control rings it', async () => {
    const upstream = await startUpstream()
    upstreams.push(upstream)
    expect(upstream.connections).toBe(0)
    await positiveControl(upstream)
    expect(upstream.connections).toBe(1)
    expect(upstream.requests.map((r) => r.url)).toEqual(['/__positive-control'])
  })

  it('closedPort() is refused and an unknown upgrade path is closed by the WebServer', async () => {
    harness = await startHostHarness()
    const port = await closedPort()
    await expect(harness.request({ path: '/', port })).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    expect(await harness.upgrade({ path: '/no-such-upgrade' })).toEqual({ kind: 'closed' })
  })

  it('connection: false leaves no connection service', async () => {
    harness = await startHostHarness({ connection: false, fallback: 'none' })
    expect(harness.connection).toBeUndefined()
    expect(harness.ctx.get('connection')).toBeUndefined()
  })
})
