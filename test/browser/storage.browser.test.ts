import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBrowserHarness, waitFor, type BrowserHarness, type Upstream } from './harness.ts'
import { openInTab, pageHandler } from './tab-driver.ts'

describe('页面内 cookie 与存储视图按端口隔开', () => {
  let h: BrowserHarness
  let up: Upstream

  beforeAll(async () => {
    h = await startBrowserHarness({ mode: 'tab' })
    up = await h.upstream('U1', (req, res, body) => {
      if (req.url === '/start') {
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['csrftoken=t1; Path=/start', 'sid=s1; Path=/; HttpOnly'] })
        res.end('<!doctype html><html><head></head><body>start</body></html>')
        return
      }
      pageHandler('U1')(req, res, body)
    })
    await h.open()
  })
  afterAll(async () => {
    await h.close()
  })

  it('spec Scenario "JS 读写 cookie 使用原名"', async () => {
    await openInTab(h, up, '/start')
    const read = await h.evalTab<string>(`document.cookie`)
    expect(read).toContain('csrftoken=t1')
    expect(read).not.toContain('dsh-auth-')
    expect(read).not.toContain('sid=') // HttpOnly: invisible to scripts (positive control below: it is still sent)
    await h.evalTab(`(document.cookie = 'theme=dark', true)`)
    expect(await h.evalTab<string>(`document.cookie`)).toContain('theme=dark')
    await h.evalTab(`fetch('/ping').then((r) => r.status)`)
    const ping = await waitFor(() => up.requests.find((r) => r.url === '/ping'), 'upstream saw /ping')
    const sent = (ping.headers.cookie ?? '').split('; ').sort()
    expect(sent).toEqual(['csrftoken=t1', 'sid=s1', 'theme=dark'])
    expect(ping.headers.cookie).not.toContain('dsh-auth-')
  })

  it('spec Scenario "localStorage.clear 不影响 DSH 的键"', async () => {
    await h.evalDsh(`(localStorage.setItem('dsh.settings', 'keep'), true)`)
    await h.evalTab(`(localStorage.setItem('a', '1'), true)`)
    // Positive control: the write is real, stored under the target prefix, and visible to the page by its plain name.
    expect(await h.evalTab<string | null>(`localStorage.getItem('a')`)).toBe('1')
    expect(await h.evalDsh<string[]>(`Object.keys(localStorage).filter((k) => k.startsWith('dshls.') && k.endsWith('.a'))`)).toHaveLength(1)
    await h.evalTab(`(localStorage.clear(), true)`)
    expect(await h.evalTab<string | null>(`localStorage.getItem('a')`)).toBeNull()
    expect(await h.evalDsh<string | null>(`localStorage.getItem('dsh.settings')`)).toBe('keep')
  })
})
