import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { addressValue, hostSaw, openInTab, pageHandler, proxyUrl, submitAddress, waitTabAt } from './tab-driver.ts'

const FIRST_SCRIPT_PAGE = `<!doctype html><html><head><script>window.__first = location.pathname + location.search</script></head><body>dash</body></html>`
const FORM_PAGE = `<!doctype html><html><head></head><body><form id="f" method="POST" action="/form"><input name="b" value="2"></form></body></html>`

describe('页面看到直接地址，导航留在代理内', () => {
  let h: BrowserHarness
  let up: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', pageHandler('U1', { '/dashboard?tab=2': FIRST_SCRIPT_PAGE, '/formpage': FORM_PAGE }))
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "页面读到无前缀的路径"', async () => {
    await submitAddress(h, `127.0.0.1:${String(up.port)}/dashboard?tab=2`)
    await waitTabAt(h, '/dashboard?tab=2')
    expect(await h.evalTab<string>('window.__first')).toBe('/dashboard?tab=2')
  })

  it('spec Scenario "location.assign 到根路径留在代理内"', async () => {
    await openInTab(h, up, '/')
    const before = h.dshRequests.length
    await h.evalTab(`(location.assign('/login'), true)`)
    await waitTabAt(h, '/login')
    const seen = h.dshRequests.slice(before).filter((r) => r.headers['sec-fetch-dest'] === 'iframe').map((r) => r.url)
    expect(seen).toContain(proxyUrl(up, '/login'))
    expect(hostSaw(h, '/login')).toBe(0)
    await waitFor(async () => (await addressValue(h)) === `http://127.0.0.1:${String(up.port)}/login`, 'address bar shows the direct address')
  })

  it('spec Scenario "location.replace 与 reload 也被改写"', async () => {
    await openInTab(h, up, '/a')
    const entries = await h.evalTab<number>('navigation.entries().length')
    const before = h.dshRequests.length
    await h.evalTab(`(location.replace('http://localhost:${String(up.port)}/b'), true)`)
    await waitTabAt(h, '/b')
    await h.evalTab('(location.reload(), true)')
    await waitFor(() => h.dshRequests.slice(before).filter((r) => r.url === proxyUrl(up, '/b') && r.headers['sec-fetch-dest'] === 'iframe').length === 2, 'two navigation requests to the proxied /b')
    await waitTabAt(h, '/b')
    expect(await h.evalTab<number>('navigation.entries().length')).toBe(entries)
    expect(hostSaw(h, '/b')).toBe(0)
  })

  it('spec Scenario "程序化表单提交保留 POST 正文"', async () => {
    await openInTab(h, up, '/formpage')
    await h.evalTab(`(document.getElementById('f').submit(), true)`)
    const post = await waitFor(() => up.requests.find((r) => r.method === 'POST' && r.url === '/form'), 'upstream received POST /form')
    expect(post.body).toBe('b=2')
    expect(hostSaw(h, '/form')).toBe(0)
  })

  it('spec Scenario "外部链接改为提示条"', async () => {
    await openInTab(h, up, '/ext')
    await h.evalTab(`(location.href = 'https://example.com/', true)`)
    const banner = await waitFor(() => h.evalDsh<{ href: string; target: string } | null>(
      `(() => { const a = document.querySelector('[data-dshls-external] a'); return a ? { href: a.href, target: a.target } : null })()`,
    ), 'external-link banner')
    expect(banner).toEqual({ href: 'https://example.com/', target: '_blank' })
    expect(await h.evalTab<string>('location.pathname')).toBe('/ext') // the iframe did not move
  })

  it('spec Scenario "pushState 后地址栏同步"', async () => {
    await openInTab(h, up, '/')
    await h.evalTab(`(history.pushState(null, '', '/settings'), true)`)
    await waitFor(async () => (await addressValue(h)) === `http://127.0.0.1:${String(up.port)}/settings`, 'address bar follows pushState')
  })
})
