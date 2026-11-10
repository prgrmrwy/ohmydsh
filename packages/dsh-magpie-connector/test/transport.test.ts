import { afterEach, expect, test, vi } from 'vitest'
import { Dispatcher1Wrapper, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { GatewayTransport } from '../src/host/transport.js'
import { createGateway, json } from './support/gateway.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const f of cleanup.splice(0).reverse()) await f() })
async function setup() { const g = await createGateway(); const t = new GatewayTransport(); cleanup.push(g.close, () => t.dispose()); return { g, t, identity: { baseUrl: g.baseUrl, key: 'mk-placeholder' } } }
test('spec Scenario "完整流程只触达白名单"', async () => {
  const { g, t, identity } = await setup()
  for (const [method, path] of [['GET', '/models'], ['POST', '/responses'], ['POST', '/chat/completions'], ['GET', '/magpie/quotas/cards'], ['POST', '/magpie/quotas/refresh']] as const) {
    g.handlers.set(`${method} /v1${path}`, json({})); const r = await t.request(identity, method, path); await r.text()
  }
  expect(g.requests).toHaveLength(5)
  for (const r of g.requests) { expect(r.headers.authorization).toBe('Bearer mk-placeholder'); for (const [k,v] of Object.entries(attributionHeaders())) expect(r.headers[k]).toBe(v) }
  for (const path of ['/api/usage', '/models?x=1', 'http://evil.test/v1/models', '/models/../api/usage']) await expect(t.request(identity, 'GET', path)).rejects.toThrow()
  expect(g.requests).toHaveLength(5)
})
test('spec Scenario "重置端点的 query 受限"', async () => {
  const { g, t, identity } = await setup()
  g.handlers.set('POST /v1/magpie/quotas/codex-reset', json({ code: 'reset', windows: 1 }))
  for (const path of [
    '/magpie/quotas/codex-reset?user=a%40b.com', // missing credit
    '/magpie/quotas/codex-reset?credit=r1', // missing user
    '/magpie/quotas/codex-reset', // no query at all
    '/magpie/quotas/codex-reset?user=a%40b.com&credit=r1&provider=x', // key outside the rule
    '/magpie/quotas/codex-reset?user=a%40b.com&credit=r1&url=http%3A%2F%2Fevil',
  ]) await expect(t.request(identity, 'POST', path)).rejects.toThrow()
  // GET on the reset path is not in the allowlist at all
  await expect(t.request(identity, 'GET', '/magpie/quotas/codex-reset?user=a%40b.com&credit=r1')).rejects.toThrow()
  expect(g.requests.filter(r => r.path.startsWith('/v1/magpie/quotas/codex-reset'))).toHaveLength(0)
  const ok = await t.request(identity, 'POST', '/magpie/quotas/codex-reset?user=a%40b.com&credit=r1')
  expect(ok.status).toBe(200); await ok.text()
  expect(g.requests.at(-1)?.path).toBe('/v1/magpie/quotas/codex-reset')
  expect(g.requests.at(-1)?.query).toBe('?user=a%40b.com&credit=r1')
})
test.each(['/responses', '/chat/completions'])('spec Scenario "重定向不被跟随": %s', async path => {
  const { g, t, identity } = await setup(); const other = await createGateway(); cleanup.push(other.close)
  for (const location of [other.baseUrl, '/api/usage']) {
    g.handlers.set(`POST /v1${path}`, res => { res.writeHead(307, { location }); res.end() })
    await expect(t.request(identity, 'POST', path, { body: '{}' })).rejects.toThrow('重定向')
  }
  expect(other.requests).toHaveLength(0); expect(g.requests.every(r => r.path === `/v1${path}`)).toBe(true)
})
test('model requests use middleware installed after transport and fetchFor creation', async () => {
  const { g, t, identity } = await setup()
  const fetchFor = t.fetchFor(identity), original = globalThis.fetch
  for (const path of ['/responses', '/chat/completions']) {
    g.handlers.set(`POST /v1${path}`, json({ ok: true }))
    // Replace the wrapper between requests too: neither the module nor fetchFor may cache it.
    const intercepted = vi.fn<typeof fetch>(async (input, init) => {
      const body = { ...JSON.parse(String(init?.body)), context: 'processed' }
      return original(input, { ...init, body: JSON.stringify(body) })
    })
    vi.stubGlobal('fetch', intercepted)
    const response = await fetchFor(identity.baseUrl + path, { method: 'POST', body: '{"model":"test"}' })
    expect(await response.json()).toEqual({ ok: true })
    expect(intercepted).toHaveBeenCalledTimes(1)
    expect(g.requests.at(-1)).toMatchObject({ body: { model: 'test', context: 'processed' }, headers: { authorization: 'Bearer mk-placeholder' } })
    for (const [key, value] of Object.entries(attributionHeaders())) expect(g.requests.at(-1)?.headers[key]).toBe(value)
  }
})
test('management endpoints bypass global fetch middleware', async () => {
  const { g, t, identity } = await setup()
  const intercepted = vi.fn<typeof fetch>(async () => { throw new Error('model middleware must not receive management requests') })
  vi.stubGlobal('fetch', intercepted)
  for (const [method, path] of [
    ['GET', '/models'], ['GET', '/magpie/quotas/cards'], ['POST', '/magpie/quotas/refresh'],
    ['POST', '/magpie/quotas/codex-reset?user=test&credit=one'],
  ] as const) {
    g.handlers.set(`${method} /v1${path.split('?')[0]}`, json({}))
    expect(await (await t.request(identity, method, path)).json()).toEqual({})
  }
  await expect(t.request(identity, 'POST', '/responses?unexpected=1')).rejects.toThrow('MAGPIE_QUERY_FORBIDDEN')
  await expect(t.request(identity, 'POST', '/forbidden')).rejects.toThrow('MAGPIE_ENDPOINT_FORBIDDEN')
  expect(intercepted).not.toHaveBeenCalled()
  expect(g.requests).toHaveLength(4)
})
test('model middleware retains the dedicated dispatcher and redirect policy', async () => {
  const { g, t, identity } = await setup(), originalFetch = globalThis.fetch
  const originalDispatcher = getGlobalDispatcher(), proxy = new MockAgent()
  proxy.disableNetConnect(); setGlobalDispatcher(proxy)
  cleanup.push(async () => { setGlobalDispatcher(originalDispatcher); await proxy.close() })
  const intercepted = vi.fn<typeof fetch>(async (input, init) => {
    expect(init).toMatchObject({ dispatcher: expect.any(Dispatcher1Wrapper), redirect: 'error' })
    return originalFetch(input, init)
  })
  vi.stubGlobal('fetch', intercepted)
  for (const path of ['/responses', '/chat/completions']) {
    g.handlers.set(`POST /v1${path}`, json({}))
    expect(await (await t.request(identity, 'POST', path)).json()).toEqual({})
  }
  expect(intercepted).toHaveBeenCalledTimes(2)
  expect(g.requests).toHaveLength(2)
})
test.each(['/responses', '/chat/completions'])('model middleware preserves caller and transport cancellation: %s', async path => {
  const { g, t, identity } = await setup(), original = globalThis.fetch
  const intercepted = vi.fn<typeof fetch>((input, init) => original(input, init))
  vi.stubGlobal('fetch', intercepted)
  const caller = new AbortController()
  caller.abort()
  await expect(t.request(identity, 'POST', path, { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  t.signal.abort()
  await expect(t.request(identity, 'POST', path)).rejects.toMatchObject({ name: 'AbortError' })
  expect(intercepted).toHaveBeenCalledTimes(2)
  expect(g.requests).toHaveLength(0)
})
test('spec Scenario "存在全局代理时仍直连"', async () => {
  const { g, t, identity } = await setup(); const original = getGlobalDispatcher(); const proxy = new MockAgent(); proxy.disableNetConnect(); setGlobalDispatcher(proxy)
  cleanup.push(async () => { setGlobalDispatcher(original); await proxy.close() })
  g.handlers.set('GET /v1/models', json({ data: [] }))
  expect((await t.request(identity, 'GET', '/models')).status).toBe(200); expect(g.requests).toHaveLength(1)
})
