import { runInNewContext, Script } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { ENTRIES_KEY_PREFIX, FRAME_ATTR, ROUTE_PREFIX } from '../src/contract.js'
import { GUARD_SCRIPT } from '../src/host/guard.js'
import * as plugin from '../src/index.js'
import { startHostHarness } from './support/host-harness.js'
import type { HostHarness } from './support/host-harness.js'

/**
 * The index guard (design D7 step 5), Host half. Its browser acceptance (guard is the first executable
 * script of the REAL index pipeline; DSH does not boot on back-navigation) belongs to
 * test/browser/index-guard.browser.test.ts. These Node tests pin placement and the guard's decision logic
 * against stub browser globals.
 */
describe('index guard tap', () => {
  let harness: HostHarness | undefined
  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  const INDEX = '<!doctype html><html><head><title>dsh</title><script>var dsh=1</script></head><body></body></html>'

  async function guardText(): Promise<string> {
    harness = await startHostHarness({ plugin })
    const html = harness.webServer.renderIndex(INDEX, {})
    // The official pipeline renders its own rows first (e.g. connection's recovery <script>); the tap runs AFTER them,
    // so the guard must be the very first thing after <head>, ahead of those rows.
    const match = /<head>(<script>[\s\S]*?<\/script>)/.exec(html)
    expect(match, 'a <script> must follow <head> immediately').not.toBeNull()
    const text = match![1]!.slice('<script>'.length, -'</script>'.length)
    expect(text, 'the first script after <head> must be the guard').toContain(FRAME_ATTR)
    return text
  }

  it('is inserted right after the first <head> and is valid JavaScript', async () => {
    const text = await guardText()
    expect(() => new Script(text)).not.toThrow()
    expect(text).toContain(FRAME_ATTR)
    expect(text).toContain(ENTRIES_KEY_PREFIX)
    expect(text).toContain(ROUTE_PREFIX)
    expect(text).not.toContain('</script')
    // Other markup is untouched.
    expect(harness!.webServer.renderIndex(INDEX, {})).toContain('<script>var dsh=1</script></head><body>')
  })

  it('prepends when the document has no <head>, ignoring <header> (extra)', async () => {
    harness = await startHostHarness({ plugin })
    const out = harness.webServer.renderIndex('<header>x</header>', {})
    expect(out.startsWith(`<script>${GUARD_SCRIPT}</script>`)).toBe(true)
    expect(out).toContain('<header>x</header>')
  })

  /** Run the guard against stub globals. */
  function run(text: string, env: { frame?: 'plain' | 'tab' | 'none'; table?: unknown; key?: string; storageThrows?: boolean }) {
    const calls = { stop: 0, replaced: [] as string[], messages: [] as unknown[] }
    const frameElement = env.frame === 'tab'
      ? { hasAttribute: (n: string) => n === FRAME_ATTR, getAttribute: (n: string) => (n === FRAME_ATTR ? 'frame1' : null) }
      : env.frame === 'plain'
        ? { hasAttribute: () => false, getAttribute: () => null }
        : null
    const sessionStorage = {
      getItem(key: string) {
        if (env.storageThrows) throw new Error('boom')
        return key === `${ENTRIES_KEY_PREFIX}frame1` && env.table !== undefined ? JSON.stringify(env.table) : null
      },
    }
    const location = { origin: 'http://127.0.0.1:3080', replace: (url: string) => { calls.replaced.push(url) } }
    const window = { frameElement, stop: () => { calls.stop += 1 } }
    runInNewContext(text, {
      window, location, sessionStorage, JSON,
      navigation: { currentEntry: { key: env.key ?? 'k1' } },
      parent: { postMessage: (message: unknown, origin: string) => { calls.messages.push([message, origin]) } },
    })
    return calls
  }

  it('does nothing outside the tab iframe (top level and ordinary iframes)', async () => {
    const text = await guardText()
    for (const frame of ['none', 'plain'] as const) {
      expect(run(text, { frame, table: { k1: { fam: 'p', port: '5173', rest: '/x' } } })).toEqual({ stop: 0, replaced: [], messages: [] })
    }
  })

  it('in the tab iframe: stops, then restores the recorded identity with a root-absolute path', async () => {
    const text = await guardText()
    const calls = run(text, { frame: 'tab', table: { k1: { fam: 'p6', port: '8080', rest: '/spa/r3?x=1#h' } } })
    expect(calls.stop).toBe(1)
    expect(calls.replaced).toEqual(['/dsh-local-service/p6/8080/spa/r3?x=1#h'])
    expect(calls.messages).toEqual([])
  })

  it.each([
    ['no table', undefined],
    ['unknown entry key', { other: { fam: 'p', port: '5173', rest: '/x' } }],
    ['bad family', { k1: { fam: 'q', port: '5173', rest: '/x' } }],
    ['bad port', { k1: { fam: 'p', port: '70000', rest: '/x' } }],
    ['non-decimal port', { k1: { fam: 'p', port: '51 73', rest: '/x' } }],
    ['rest without slash', { k1: { fam: 'p', port: '5173', rest: 'x' } }],
    ['not an object', 42],
  ])('in the tab iframe with %s: stops, never guesses, reports identity-unavailable', async (_label, table) => {
    const text = await guardText()
    const calls = run(text, { frame: 'tab', table })
    expect(calls.stop).toBe(1)
    expect(calls.replaced).toEqual([])
    expect(calls.messages).toHaveLength(1)
    // Exactly `no-identity`: the tab shows 「无法恢复该历史记录」 for it and 「身份表不可用：<reason>」 for any other reason.
    expect((calls.messages[0] as [unknown, string])[0]).toEqual({ type: 'dshls:identity-unavailable', reason: 'no-identity' })
    expect((calls.messages[0] as [unknown, string])[1]).toBe('http://127.0.0.1:3080')
  })

  it('a throwing sessionStorage is reported as identity-unavailable, not left half-initialised (extra)', async () => {
    const text = await guardText()
    const calls = run(text, { frame: 'tab', storageThrows: true })
    expect(calls.stop).toBe(1)
    expect(calls.replaced).toEqual([])
    expect(calls.messages).toHaveLength(1)
    const message = (calls.messages[0] as [{ type: string; reason: string }, string])[0]
    expect(message.type).toBe('dshls:identity-unavailable')
    // A real failure is NOT "no identity": the tab words it differently.
    expect(message.reason).not.toBe('no-identity')
    expect(message.reason).toMatch(/\S/)
  })
})
