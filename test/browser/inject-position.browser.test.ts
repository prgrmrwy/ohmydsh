import { request as httpRequest } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { openInTab, pageHandler, submitAddress } from './tab-driver.ts'

/**
 * Extra Chromium regression for implementation-review M1: whatever HTML comment form precedes the first
 * page script, the injected script must already have run when that page script executes (marker defined,
 * unprefixed pathname visible). Host-side positions are unit-tested in test/host-html-scanner.test.ts;
 * this proves the real browser tokenizer agrees with the scanner.
 */
const LEADING: Record<string, string> = {
  '/normal': '<!-- ok -->',
  '/abrupt': '<!-->',
  '/abrupt-dash': '<!--->',
  '/empty': '<!---->',
  '/bang': '<!-- x --!>',
  '/markup-inside': '<!-- <script>window.__swallowed = true</script> -->',
}

/** First page script: records what the injected script had already done by then. */
const FIRST_PAGE_SCRIPT = `<script>window.__first = { marker: !!window.__dshlsMarker, pathname: location.pathname, wsWrapped: String(window.WebSocket).indexOf('[native code]') === -1 }</script>`

const LONG_X = 'x'.repeat(262_144)
const PAGE_AFTER_COMMENT = `--><script>window.__first = { marker: !!window.__dshlsMarker, pathname: location.pathname }</script><html><head></head><body>long</body></html>`

describe('注入位置 — 各种前导注释形态（Chromium）', () => {
  let h: BrowserHarness
  let up: Upstream
  /** The raw-client request is held at the upstream until the test releases it. */
  let releaseHeld: () => void = () => undefined
  const held = new Promise<void>((resolve) => { releaseHeld = resolve })

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    const pages = Object.fromEntries(Object.entries(LEADING).map(([path, comment]) => [path, `<!doctype html>${comment}${FIRST_PAGE_SCRIPT}<html><head></head><body>${path}</body></html>`]))
    const normal = pageHandler('U1', pages)
    up = await h.upstream('U1', (req, res, body) => {
      const path = (req.url ?? '/').split('?')[0]
      if (path === '/long-held' || path === '/long-tab') {
        // `<!--` + 262144 × x, never closed until later: more than the Host is willing to buffer.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.write(`<!--${LONG_X}`)
        if (path === '/long-held') void held.then(() => res.end(PAGE_AFTER_COMMENT))
        else setTimeout(() => res.end(PAGE_AFTER_COMMENT), 400)
        return
      }
      normal(req, res, body)
    })
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('the injected script runs before the first page script after every leading comment form', async () => {
    await openInTab(h, up, '/') // controlled baseline
    for (const path of Object.keys(LEADING)) {
      await submitAddress(h, `127.0.0.1:${String(up.port)}${path}`)
      await waitFor(() => h.evalTab<boolean>(`location.pathname === ${JSON.stringify(path)} && !!window.__dshlsMarker && document.readyState === 'complete' && !!window.__first`), `${path} loaded`)
      const first = await h.evalTab<{ marker: boolean; pathname: string; wsWrapped: boolean }>('window.__first')
      expect(first, path).toEqual({ marker: true, pathname: path, wsWrapped: true })
      // The comment with markup inside really is a comment (control for the oracle).
      expect(await h.evalTab<boolean>('window.__swallowed === undefined'), path).toBe(true)
    }
  })

  it('spec Scenario "超长未结束的开头注释触发有界回退"', async () => {
    // Part 1 — a raw streaming client (no browser): bytes must arrive while the upstream is still paused,
    // and they must start with the injected script, placed BEFORE the unfinished `<!--`.
    const cookie = await h.dsh.login()
    const chunks: string[] = []
    let ended = false
    const request = httpRequest({
      host: '127.0.0.1',
      port: h.dsh.port,
      path: `/dsh-local-service/p/${String(up.port)}/long-held`,
      agent: false,
      headers: { host: h.dsh.authority, cookie, 'sec-fetch-site': 'same-origin' },
    }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => chunks.push(chunk))
      res.on('end', () => { ended = true })
    })
    request.on('error', () => undefined)
    request.end()
    try {
      const started = Date.now()
      await waitFor(() => chunks.join('').length > 0, 'first streamed bytes while the upstream is paused', 2000, 20)
      expect(Date.now() - started).toBeLessThan(2000)
      const early = chunks.join('')
      expect(ended).toBe(false)
      expect(early.startsWith('<script nonce="')).toBe(true)
      expect(early.indexOf('</script>')).toBeLessThan(early.indexOf('<!--'))
      // Release the upstream: the rest arrives, nothing is lost or duplicated.
      releaseHeld()
      await waitFor(() => ended, 'response end', 5000, 20)
      const body = chunks.join('')
      expect(body.endsWith(PAGE_AFTER_COMMENT)).toBe(true)
      expect(body.split('<script nonce="')).toHaveLength(2) // exactly one injected script
      expect(body).toContain(`<!--${LONG_X}-->`)
    } finally {
      releaseHeld()
      request.destroy()
    }

    // Part 2 — the same shape in the real tab: Chromium parses the final body, and the injected script
    // (fallback position, before the comment) has run before the page script that follows the comment.
    await openInTab(h, up, '/') // controlled baseline
    await submitAddress(h, `127.0.0.1:${String(up.port)}/long-tab`)
    await waitFor(() => h.evalTab<boolean>(`location.pathname === '/long-tab' && !!window.__dshlsMarker && document.readyState === 'complete' && !!window.__first`), 'long-tab loaded', 15_000, 100)
    expect(await h.evalTab<{ marker: boolean; pathname: string }>('window.__first')).toEqual({ marker: true, pathname: '/long-tab' })
  })
})
