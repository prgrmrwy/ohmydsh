import { afterEach, describe, expect, it } from 'vitest'
import { startProxyFixture } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

describe('重定向与外部跳转', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    await f?.dispose()
    f = undefined
  })

  it('spec Scenario "根路径与协议相对重定向"', async () => {
    const locations = ['/login', '//localhost:4000/cb']
    f = await startProxyFixture((req, res) => {
      res.writeHead(302, { location: locations.shift() ?? '/exhausted' })
      res.end()
    })
    const first = await f.get('/')
    const second = await f.get('/')
    expect(first.status).toBe(302)
    expect(first.headers.location).toBe(`/dsh-local-service/p/${String(f.upstream.port)}/login`)
    expect(second.headers.location).toBe('/dsh-local-service/p/4000/cb')
  })

  it('rewrites other loopback targets by family and keeps path, query and hash (extra)', async () => {
    const port = (): string => String(f!.upstream.port)
    const locations = [
      `http://127.0.0.1:${'PORT'}/a?b=1#c`, // same family and port, absolute
      'http://[::1]:7000/x', // IPv6 loopback → p6
      'http://localhost/x', // no port → default 80
      '../up?x=1', // relative to the upstream request URL
    ]
    f = await startProxyFixture((req, res) => {
      res.writeHead(302, { location: (locations.shift() ?? '/').replace('PORT', String(f!.upstream.port)) })
      res.end()
    })
    const seen: string[] = []
    for (let i = 0; i < 4; i++) seen.push(String((await f.get('/dir/page')).headers.location))
    expect(seen).toEqual([
      `/dsh-local-service/p/${port()}/a?b=1#c`,
      '/dsh-local-service/p6/7000/x',
      '/dsh-local-service/p/80/x',
      `/dsh-local-service/p/${port()}/up?x=1`,
    ])
  })

  it('spec Scenario "导航遇到外部重定向时返回提示页"', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(302, { location: 'https://sso.example.com/x' })
      res.end()
    })
    const nav = await f.get('/', { headers: { 'sec-fetch-mode': 'navigate' } })
    expect(nav.status).toBe(200)
    expect(nav.headers['content-type']).toMatch(/^text\/html/)
    expect(nav.headers.location).toBeUndefined()
    const html = nav.text()
    expect(html).toContain('https://sso.example.com/x')
    expect(html).toMatch(/<a [^>]*rel="noopener"[^>]*>/)
    expect(html).toMatch(/<a [^>]*target="_blank"[^>]*>/)
    // Positive control: a non-navigation request keeps the upstream redirect untouched.
    const sub = await f.get('/', { headers: { 'sec-fetch-mode': 'cors' } })
    expect(sub.status).toBe(302)
    expect(sub.headers.location).toBe('https://sso.example.com/x')
  })

  it('spec Scenario "禁嵌头被移除"', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      })
      res.end('ok')
    })
    const res = await f.get('/')
    expect(res.headers['x-frame-options']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBeDefined()
    expect(res.headers['content-security-policy']).not.toMatch(/frame-ancestors/i)
    expect(res.headers['content-security-policy']).toBe("default-src 'self'")
  })

  it('drops a CSP header that only held frame-ancestors (extra)', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-security-policy': "frame-ancestors 'self'" })
      res.end('ok')
    })
    expect((await f.get('/')).headers['content-security-policy']).toBeUndefined()
  })
})
