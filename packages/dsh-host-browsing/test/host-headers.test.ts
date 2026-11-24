import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { namePrefix } from '../src/contract.js'
import { startProxyFixture } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

/** Independent oracle for the spec's `<A>`: first 8 chars of base64url(SHA-256(Host header value)). */
const authorityHash = (host: string): string => createHash('sha256').update(host).digest('base64url').slice(0, 8)

describe('请求与响应头的凭据处理', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    await f?.dispose()
    f = undefined
  })

  it('spec Scenario "只有本端口的代理 cookie 被转发"', async () => {
    f = await startProxyFixture()
    const h1 = authorityHash(f.harness.authority)
    const mine = namePrefix(h1, 'p', f.upstream.port)
    const otherPort = namePrefix(h1, 'p', f.upstream.port === 4000 ? 4001 : 4000)
    const res = await f.get('/', {
      headers: {
        // `f.cookie` is the real dsh-auth-… session cookie the gate requires.
        cookie: `${f.cookie}; ${mine}sid=abc; ${otherPort}sid=zzz; other=1`,
        'proxy-authorization': 'Basic x',
        authorization: 'Bearer t',
      },
    })
    expect(res.status).toBe(200)
    const seen = f.upstream.requests[0]!.headers
    expect(seen.cookie).toBe('sid=abc')
    expect(seen.authorization).toBe('Bearer t')
    expect(seen['proxy-authorization']).toBeUndefined()
  })

  it('spec Scenario "另一台机器的代理 cookie 不被转发"', async () => {
    f = await startProxyFixture()
    const h1 = authorityHash(f.harness.authority)
    // h2: the authority hash of ANOTHER DSH (a second tunnel on 127.0.0.1:<port+1>).
    const h2 = authorityHash(`127.0.0.1:${String(f.harness.port + 1)}`)
    expect(h2).not.toBe(h1)
    const res = await f.get('/', {
      headers: { cookie: `${f.cookie}; ${namePrefix(h1, 'p', f.upstream.port)}sid=abc; ${namePrefix(h2, 'p', f.upstream.port)}sid=other` },
    })
    expect(res.status).toBe(200)
    expect(f.upstream.requests[0]!.headers.cookie).toBe('sid=abc')
    // No proxy cookie at all → no Cookie header is sent (the dsh-auth session cookie never is).
    const none = await f.get('/none')
    expect(none.status).toBe(200)
    expect(f.upstream.requests[1]!.headers.cookie).toBeUndefined()
  })

  it('spec Scenario "上游 Set-Cookie 被改名并放到根路径"', async () => {
    f = await startProxyFixture((req, res) => {
      res.setHeader('set-cookie', ['sid=abc; Path=/api; Domain=localhost; HttpOnly', 'theme=dark; Max-Age=60; SameSite=Lax'])
      res.setHeader('service-worker-allowed', '/')
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    const res = await f.get('/')
    const h1 = authorityHash(f.harness.authority)
    const prefix = namePrefix(h1, 'p', f.upstream.port)
    expect(res.headers['set-cookie']).toEqual([
      `${prefix}sid=abc; HttpOnly; Path=/`,
      `${prefix}theme=dark; Max-Age=60; SameSite=Lax; Path=/`,
    ])
    expect(res.headers['service-worker-allowed']).toBeUndefined()
  })

  it('spec Scenario "Origin 与 Referer 改写为上游地址"', async () => {
    f = await startProxyFixture()
    await f.get('/', { headers: { origin: f.harness.origin, referer: `${f.harness.origin}/form?x=1` } })
    const seen = f.upstream.requests[0]!.headers
    expect(seen.origin).toBe(`http://127.0.0.1:${String(f.upstream.port)}`)
    expect(seen.referer).toBe(`http://127.0.0.1:${String(f.upstream.port)}/`)
  })

  it('spec Scenario "文档请求去掉条件头"', async () => {
    f = await startProxyFixture()
    await f.get('/', { headers: { 'sec-fetch-dest': 'iframe', 'if-none-match': '"v1"', 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' } })
    const doc = f.upstream.requests[0]!.headers
    expect(doc['if-none-match']).toBeUndefined()
    expect(doc['if-modified-since']).toBeUndefined()
    // Positive control: a sub-resource request (Sec-Fetch-Dest: script) keeps its validators.
    await f.get('/app.js', { headers: { 'sec-fetch-dest': 'script', 'if-none-match': '"v1"' } })
    expect(f.upstream.requests[1]!.headers['if-none-match']).toBe('"v1"')
  })
})
