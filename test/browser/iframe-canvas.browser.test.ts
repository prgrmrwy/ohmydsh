import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, type BrowserHarness, type Upstream } from './harness.ts'
import { openInTab } from './tab-driver.ts'

/** Extra test: a page that sets no background must sit on an opaque white canvas, even under DSH's dark theme. */
describe('iframe 的网页画布', () => {
  let h: BrowserHarness
  let up: Upstream
  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head></head><body>plain page, no background</body></html>')
    })
    await h.open()
  })
  afterAll(async () => { await h.close() })

  it('keeps an opaque white, light-scheme canvas under the dark theme', async () => {
    await h.evalDsh(`(() => { document.documentElement.style.colorScheme = 'dark'; document.body.setAttribute('data-ds-dark-theme', ''); document.body.style.background = '#222'; return true })()`)
    await openInTab(h, up, '/')
    const frame = await h.evalDsh<{ background: string; scheme: string }>(`(() => { const s = getComputedStyle(document.querySelector('iframe[data-dshls]')); return { background: s.backgroundColor, scheme: s.colorScheme } })()`)
    expect(frame.background).toBe('rgb(255, 255, 255)')
    expect(frame.scheme).toBe('light')
    // The page itself paints on that canvas (what the user sees), not on DSH's dark base.
    expect(await h.evalTab<string>(`getComputedStyle(document.documentElement).colorScheme`)).toBe('normal')
  })
})
