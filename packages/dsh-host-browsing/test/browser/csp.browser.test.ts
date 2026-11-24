import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { openInTab, pageHandler, submitAddress } from './tab-driver.ts'

const CSP_PAGE = `<!doctype html><html><head></head><body>csp
<script nonce="old">window.__ran = (window.__ran || []).concat('nonce-old'); window.__sawMarker = !!window.__dshlsMarker</script>
<script>window.__ran = (window.__ran || []).concat('plain-inline')</script>
</body></html>`

describe('HTML 注入与传输语义 — CSP（Chromium）', () => {
  let h: BrowserHarness
  let up: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', (req, res, body) => {
      if (req.url === '/csp') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'unsafe-inline' 'nonce-old'" })
        res.end(CSP_PAGE)
        return
      }
      pageHandler('U1')(req, res, body)
    })
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "unsafe-inline 与已有 nonce 共存时仍追加"', async () => {
    await openInTab(h, up, '/') // controlled, installed baseline (positive control that the injected script runs at all)
    const before = h.dshRequests.length
    await submitAddress(h, `127.0.0.1:${String(up.port)}/csp`)
    await waitFor(() => h.evalTab<boolean>(`location.pathname === '/csp' && !!window.__dshlsMarker && document.readyState === 'complete'`), 'csp page installed')
    // Header: our nonce appended after the existing ones.
    const response = await h.dsh.request({ path: `/dsh-local-service/p/${String(up.port)}/csp`, headers: { cookie: await h.dsh.login(), 'sec-fetch-site': 'same-origin' } })
    const csp = String(response.headers['content-security-policy'])
    const injected = /<script nonce="([^"]+)">/.exec(response.text())
    expect(injected).not.toBeNull()
    expect(csp).toBe(`script-src 'unsafe-inline' 'nonce-old' 'nonce-${injected![1]!}'`)
    // Execution: injected script ran (marker visible to the nonce-old script), nonce-old ran, plain inline did not.
    expect(await h.evalTab<string[]>('window.__ran')).toEqual(['nonce-old'])
    expect(await h.evalTab<boolean>('window.__sawMarker')).toBe(true)
    expect(h.dshRequests.length).toBeGreaterThan(before)
  })
})
