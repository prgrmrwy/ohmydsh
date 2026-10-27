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
