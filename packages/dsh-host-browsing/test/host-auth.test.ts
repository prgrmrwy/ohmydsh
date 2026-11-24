import { afterEach, describe, expect, it } from 'vitest'
import { SW_SCRIPT } from '../src/contract.js'
import { positiveControl } from './support/host-harness.js'
import { startProxyFixture } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

describe('代理请求的认证与来源限制', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    await f?.dispose()
    f = undefined
  })

  it('spec Scenario "已认证的同源请求被转发"', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello')
    })
    const res = await f.get('/', { headers: { 'sec-fetch-site': 'same-origin' } })
    expect(res.status).toBe(200)
    expect(res.text().endsWith('hello')).toBe(true)
    expect(f.upstream.requests).toHaveLength(1)
    expect(f.upstream.requests[0]!.url).toBe('/')
    expect(f.upstream.requests[0]!.headers.host).toBe(`127.0.0.1:${String(f.upstream.port)}`)
  })

  it('spec Scenario "未认证请求不触达上游"', async () => {
    f = await startProxyFixture()
    // Real connection service: no dsh-auth-* cookie → its own requestRejection says 401.
    const res = await f.get('/', { headers: { cookie: undefined } })
    expect(res.status).toBe(401)
    expect(f.upstream.connections).toBe(0)
    // Positive control: the same request WITH the minted cookie does reach the upstream.
    expect((await f.get('/')).status).toBe(200)
    expect(f.upstream.connections).toBe(1)
  })

  it('spec Scenario "其它本机网页借用会话被拒绝"', async () => {
    f = await startProxyFixture()
    // Another loopback page's <img>: valid cookie, same-site, and no Origin header at all.
    const res = await f.get('/delete', { headers: { 'sec-fetch-site': 'same-site', origin: undefined } })
    expect(res.status).toBe(403)
    expect(f.upstream.connections).toBe(0)
    // Positive control: only the Sec-Fetch-Site value differs, and that request is forwarded.
    expect((await f.get('/delete', { headers: { 'sec-fetch-site': 'same-origin', origin: undefined } })).status).toBe(200)
    expect(f.upstream.connections).toBe(1)
    // `none` (user-initiated, e.g. address bar) is the other admitted value.
    expect((await f.get('/delete', { headers: { 'sec-fetch-site': 'none' } })).status).toBe(200)
  })

  it('spec Scenario "sw.js 适用同一来源检查"', async () => {
    f = await startProxyFixture()
    const sameOrigin = await f.raw({ path: SW_SCRIPT, headers: { 'sec-fetch-site': 'same-origin' } })
    const sameSite = await f.raw({ path: SW_SCRIPT, headers: { 'sec-fetch-site': 'same-site' } })
    const missing = await f.raw({ path: SW_SCRIPT, headers: { 'sec-fetch-site': undefined } })
    expect([sameOrigin.status, sameSite.status, missing.status]).toEqual([200, 403, 403])
    expect(sameOrigin.headers['content-type']).toMatch(/^text\/javascript/)
    // The plugin's SW must not get a wider scope than its directory.
    expect(sameOrigin.headers['service-worker-allowed']).toBeUndefined()
    expect(sameOrigin.headers['cache-control']).toBe('no-store')
    // And without a session it is 401 as for every other route under the prefix.
    expect((await f.raw({ path: SW_SCRIPT, headers: { cookie: undefined } })).status).toBe(401)
  })

  it('spec Scenario "缺少 Sec-Fetch-Site 被拒绝"', async () => {
    f = await startProxyFixture()
    const res = await f.get('/', { headers: { 'sec-fetch-site': undefined } })
    expect(res.status).toBe(403)
    expect(f.upstream.connections).toBe(0)
    await positiveControl(f.upstream)
    expect((await f.get('/')).status).toBe(200)
  })
})
