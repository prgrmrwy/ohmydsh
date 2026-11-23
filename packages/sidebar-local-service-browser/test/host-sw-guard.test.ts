import { afterEach, describe, expect, it } from 'vitest'
import { startProxyFixture } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

/** Host half of the spec requirement 禁止被代理页面注册 Service Worker (extra Node tests; ledger scenarios are browser-side). */
describe('Service-Worker: script requests on proxy paths', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    await f?.dispose()
    f = undefined
  })

  it('are answered 403 without connecting the upstream', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' })
      res.end('1')
    })
    const res = await f.get('/sw.js', { headers: { 'service-worker': 'script' } })
    expect(res.status).toBe(403)
    expect(f.upstream.connections).toBe(0)
    expect(f.upstream.requests).toHaveLength(0)
    // Positive control: without the header the same path is proxied.
    expect((await f.get('/sw.js')).status).toBe(200)
    expect(f.upstream.requests.map((r) => r.url)).toEqual(['/sw.js'])
  })

  it('applies to the p6 family too, and still sits behind authentication (401 first)', async () => {
    f = await startProxyFixture()
    expect((await f.get('/sw.js', { headers: { 'service-worker': 'script' } })).status).toBe(403)
    const p6 = await f.get(f.target('/sw.js', 'p6'), { absolute: true, headers: { 'service-worker': 'script' } })
    expect(p6.status).toBe(403)
    const anonymous = await f.get('/sw.js', { headers: { 'service-worker': 'script', cookie: undefined } })
    expect(anonymous.status).toBe(401)
    expect(f.upstream.connections).toBe(0)
  })
})
