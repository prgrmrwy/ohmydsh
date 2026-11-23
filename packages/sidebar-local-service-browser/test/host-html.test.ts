import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { INJECT_CONFIG_GLOBAL } from '../src/contract.js'
import { startProxyFixture, waitFor } from './support/proxy-fixture.js'
import type { ProxyFixture } from './support/proxy-fixture.js'

const INJECTED = /<script nonce="([A-Za-z0-9_-]{16,})">/

describe('HTML 注入与传输语义', () => {
  let f: ProxyFixture | undefined
  afterEach(async () => {
    await f?.dispose()
    f = undefined
  })

  it('spec Scenario "注入在任何页面脚本之前并加入 nonce"', async () => {
    const page = "<!doctype html><script>fetch('http://localhost:8000/x')</script><html><head><title>t</title>"
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'nonce-r4nd' 'strict-dynamic'" })
      res.end(page)
    })
    const res = await f.get('/')
    const html = res.text()
    const tag = INJECTED.exec(html)
    expect(tag).not.toBeNull()
    const nonce = tag![1]!
    const doctype = html.indexOf('<!doctype html>')
    const injected = html.indexOf(tag![0])
    const original = html.indexOf("<script>fetch('http://localhost:8000/x')")
    expect(doctype).toBe(0)
    expect(injected).toBe('<!doctype html>'.length)
    expect(original).toBeGreaterThan(injected)
    expect(res.headers['content-security-policy']).toBe(`script-src 'nonce-r4nd' 'strict-dynamic' 'nonce-${nonce}'`)
    // The page text after the injection is untouched, and the inline script carries the per-response config.
    expect(html.endsWith(page.slice('<!doctype html>'.length))).toBe(true)
    expect(html.slice(injected, original)).toContain(INJECT_CONFIG_GLOBAL)
    expect(html.slice(injected, original)).toContain(`"port":"${String(f.upstream.port)}"`)
    expect(html.slice(injected, original)).toContain('"fam":"p"')
    expect(html.slice(injected, original)).toMatch(/"prefix":"dshls\.[A-Za-z0-9_-]{8}\.p\.\d+\."/)
    // Fresh nonce per response.
    const again = INJECTED.exec((await f.get('/')).text())
    expect(again![1]).not.toBe(nonce)
  })

  it('spec Scenario "unsafe-inline 策略不被收紧"', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'self' 'unsafe-inline'" })
      res.end('<!doctype html><html><head></head><body>x</body></html>')
    })
    const res = await f.get('/')
    expect(res.headers['content-security-policy']).toBe("script-src 'self' 'unsafe-inline'")
    // Still injected (the inline script is allowed by 'unsafe-inline').
    expect(res.text()).toMatch(INJECTED)
  })

  it('Host CSP header: unsafe-inline + existing nonce gets our nonce (extra)', async () => {
    // Host half of the ledger scenario owned by test/browser/csp.browser.test.ts (execution semantics need Chromium).
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'unsafe-inline' 'nonce-old'" })
      res.end('<!doctype html><html><head></head><body><script nonce="old">1</script><script>2</script></body></html>')
    })
    const res = await f.get('/')
    const nonce = INJECTED.exec(res.text())![1]
    expect(res.headers['content-security-policy']).toBe(`script-src 'unsafe-inline' 'nonce-old' 'nonce-${nonce}'`)
  })

  it('spec Scenario "gzip HTML 解压后注入，未知编码拒绝"', async () => {
    const body = '<!doctype html><html><head></head><body>zipped</body></html>'
    const encodings: Record<string, () => Buffer> = {
      '/gzip': () => gzipSync(body),
      '/deflate': () => deflateSync(body),
      '/br': () => brotliCompressSync(body),
    }
    f = await startProxyFixture((req, res) => {
      const encode = encodings[req.url ?? '']
      if (encode !== undefined) {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': req.url!.slice(1), etag: '"v1"', 'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT' })
        res.end(encode())
        return
      }
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd-x' })
      res.end(Buffer.from('not-decodable'))
    })
    for (const path of ['/gzip', '/deflate', '/br']) {
      const res = await f.get(path)
      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.etag).toBeUndefined()
      expect(res.headers['last-modified']).toBeUndefined()
      expect(res.headers['content-length']).toBeUndefined()
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.text()).toMatch(INJECTED)
      expect(res.text()).toContain('zipped</body></html>')
    }
    expect((await f.get('/other')).status).toBe(502)
    // The proxy asked for identity in the first place.
    expect(f.upstream.requests[0]!.headers['accept-encoding']).toBe('identity')
  })

  it('spec Scenario "带脚本的 404 页面同样注入"', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head></head><body>missing<script>x()</script></body></html>')
    })
    const res = await f.get('/missing')
    expect(res.status).toBe(404)
    expect(res.text().startsWith('<!doctype html><script nonce="')).toBe(true)
  })

  it('spec Scenario "流式 HTML 先到先发"', async () => {
    // The spec holds the rest back for 10 s; here the upstream is held until the test releases it, which
    // proves the same thing deterministically: bytes (script + "a") arrive while the response is incomplete.
    let release!: () => void
    const released = new Promise<void>((resolve) => { release = resolve })
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<html><head></head><body>a')
      void released.then(() => res.end('b</body></html>'))
    })
    const chunks: string[] = []
    let ended = false
    const request = httpRequest({
      host: '127.0.0.1',
      port: f.harness.port,
      path: f.target('/'),
      agent: false,
      headers: { host: f.harness.authority, cookie: f.cookie, 'sec-fetch-site': 'same-origin' },
    }, (res) => {
      res.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
      res.on('end', () => { ended = true })
    })
    request.end()
    try {
      const started = Date.now()
      await waitFor(() => chunks.join('').includes('a'), 2000, 'first streamed bytes')
      expect(Date.now() - started).toBeLessThan(2000)
      const early = chunks.join('')
      expect(early).toMatch(INJECTED)
      expect(early).toContain('<body>a')
      expect(ended).toBe(false)
      // Positive control: the held-back remainder does arrive once released.
      release()
      await waitFor(() => ended, 2000, 'response end')
      expect(chunks.join('')).toContain('b</body></html>')
    } finally {
      release()
      request.destroy()
    }
  })

  it('spec Scenario "非 HTML 与 HEAD 不改写正文"', async () => {
    const blob = randomBytes(1024 * 1024)
    f = await startProxyFixture((req, res) => {
      if (req.url === '/blob') {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(blob.length) })
        res.end(blob)
        return
      }
      if (req.url === '/page' && req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': '500' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head></head><body>page</body></html>')
    })
    const got = await f.get('/blob')
    expect(got.status).toBe(200)
    expect(got.body.equals(blob)).toBe(true)
    const head = await f.get('/page', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
    expect(head.headers['content-length']).toBe('500')
    // Positive control: the same HTML via GET IS injected, so "not injected" above is meaningful.
    expect((await f.get('/page')).text()).toMatch(INJECTED)
  })

  it('injects the scanner position after BOM, whitespace, doctype and comments only (extra)', async () => {
    const pages: Record<string, string> = {
      '/bom': '\uFEFF  \n<!DOCTYPE html>\n<!-- c1 --><!--c2--> <html><head></head></html>',
      '/header': '<!doctype html><header>text</header>',
      '/text': 'plain text first <b>x</b>',
      '/only-skipped': '<!doctype html><!-- only a comment -->',
      '/comment-with-tag': '<!-- <script>no</script> --><p>x</p>',
    }
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(pages[req.url ?? ''])
    })
    const at = async (path: string): Promise<string> => (await f!.get(path)).text()
    const bom = await at('/bom')
    expect(bom.startsWith('\uFEFF  \n<!DOCTYPE html>\n<!-- c1 --><!--c2--> <script nonce="')).toBe(true)
    expect(bom).toMatch(/<\/script><html><head><\/head><\/html>$/)
    expect(await at('/header')).toMatch(/^<!doctype html><script nonce="[^"]+">.*<\/script><header>text<\/header>$/s)
    expect(await at('/text')).toMatch(/^<script nonce="[^"]+">.*<\/script>plain text first <b>x<\/b>$/s)
    expect(await at('/only-skipped')).toMatch(/^<!doctype html><!-- only a comment --><script nonce="[^"]+">.*<\/script>$/s)
    expect(await at('/comment-with-tag')).toMatch(/^<!-- <script>no<\/script> --><script nonce="[^"]+">.*<\/script><p>x<\/p>$/s)
  })

  it('destroys the upstream connection within 1 s of a client abort (extra)', async () => {
    let upstreamClosed = false
    f = await startProxyFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: 1\n\n')
      res.on('close', () => { upstreamClosed = true })
    })
    const chunks: Buffer[] = []
    const request = httpRequest({
      host: '127.0.0.1',
      port: f.harness.port,
      path: f.target('/events'),
      agent: false,
      headers: { host: f.harness.authority, cookie: f.cookie, 'sec-fetch-site': 'same-origin' },
    }, (res) => { res.on('data', (c: Buffer) => chunks.push(c)) })
    request.on('error', () => {})
    request.end()
    await waitFor(() => chunks.length > 0, 2000, 'first event')
    expect(upstreamClosed).toBe(false)
    request.destroy()
    await waitFor(() => upstreamClosed, 1000, 'upstream destroyed after client abort')
  })

  it('the external-redirect notice page is injected too, so the tab sees the marker (extra)', async () => {
    f = await startProxyFixture((req, res) => {
      res.writeHead(302, { location: 'https://sso.example.com/x' })
      res.end()
    })
    const res = await f.get('/', { headers: { 'sec-fetch-mode': 'navigate' } })
    expect(res.status).toBe(200)
    expect(res.text()).toMatch(INJECTED)
  })
})
