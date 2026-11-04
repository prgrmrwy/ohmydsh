import { afterEach, expect, test } from 'vitest'
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { GatewayTransport } from '../src/host/transport.js'
import { createGateway, json } from './support/gateway.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
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
test('spec Scenario "重定向不被跟随"', async () => {
  const { g, t, identity } = await setup(); const other = await createGateway(); cleanup.push(other.close)
  for (const location of [other.baseUrl, '/api/usage']) {
    g.handlers.set('POST /v1/responses', res => { res.writeHead(307, { location }); res.end() })
    await expect(t.request(identity, 'POST', '/responses', { body: '{}' })).rejects.toThrow('重定向')
  }
  expect(other.requests).toHaveLength(0); expect(g.requests.every(r => r.path === '/v1/responses')).toBe(true)
})
test('spec Scenario "存在全局代理时仍直连"', async () => {
  const { g, t, identity } = await setup(); const original = getGlobalDispatcher(); const proxy = new MockAgent(); proxy.disableNetConnect(); setGlobalDispatcher(proxy)
  cleanup.push(async () => { setGlobalDispatcher(original); await proxy.close() })
  g.handlers.set('GET /v1/models', json({ data: [] }))
  expect((await t.request(identity, 'GET', '/models')).status).toBe(200); expect(g.requests).toHaveLength(1)
})
