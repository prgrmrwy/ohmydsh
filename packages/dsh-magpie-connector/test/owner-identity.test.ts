import { afterEach, expect, test } from 'vitest'
import { collect, mountRealHost, until } from './support/host.js'
import { createGateway, json, sse } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
import { lineCredentials, LINE_ID, LINE_ID_2, refs } from './support/line.js'
import { responseText } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const OLD = 'dsh-magpie-connector'
const catalog = { data: [
  { id: 'claude/c', owned_by: 'claude' },
  { id: 'codex/gpt-6.1-sol', owned_by: 'codex', native_endpoints: ['/v1/responses'] },
] }

test('test_owner_identity_01 spec Scenario "只注册归属 route"', async () => {
  const g = await createGateway(); g.handlers.set('GET /v1/models', json(catalog))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: { lines: [{ id: LINE_ID, baseUrl: g.baseUrl, accessMode: 'direct' }] } })
  cleanup.push(g.close, () => host.dispose())
  await until(() => host.ownRoutes().length === 2, 'two routes')
  expect(host.ownRoutes().sort()).toEqual([`${OLD}-claude`, `${OLD}-codex`])
  expect(host.ownRoutes()).not.toContain(OLD)
  g.handlers.set('POST /v1/responses', sse(responseText('hi')))
  const finish = (await collect(host.llm.stream({ provider: `${OLD}-codex`, model: 'codex/gpt-6.1-sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }] }] } as never))).at(-1)
  expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(g.requests.find(r => r.path === '/v1/responses')?.headers.authorization).toBe('Bearer mk-1')
})

test('test_owner_identity_02 spec Scenario "旧 route 选择不再可用"', async () => {
  const g = await createGateway(); g.handlers.set('GET /v1/models', json(catalog))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: { lines: [{ id: LINE_ID, baseUrl: g.baseUrl, accessMode: 'direct' }] } })
  cleanup.push(g.close, () => host.dispose())
  await until(() => host.ownRoutes().length === 2, 'two routes')
  g.requests.length = 0
  await expect(host.llm.prepareCall({ provider: OLD, model: 'codex/gpt-6.1-sol' })).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  const { buildModelCatalog } = await import('@deepseek-ai/dsh-api-session-controller')
  const built = await buildModelCatalog({ llm: host.llm, agentDefaultModel: { currentSelection: () => ({}) } } as never, {} as never)
  expect(built.groups.map(group => group.id)).not.toContain(OLD)
  expect(g.requests.filter(r => r.method === 'POST')).toEqual([])
})

test('test_owner_identity_03 spec Scenario "凭据引用由稳定 id 绑定"', async () => {
  const [a, b] = [await createGateway(), await createGateway()]
  for (const [gw, text] of [[a, 'A'], [b, 'B']] as const) { gw.handlers.set('GET /v1/models', json(catalog)); gw.handlers.set('POST /v1/responses', sse(responseText(text))) }
  const credentials = credentialsMock()
  credentials.setRef(refs(LINE_ID).key as unknown as string, 'K1'); credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  const lines = [{ id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' }, { id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' }]
  const host = await mountRealHost({ credentials, settings: { lines } })
  cleanup.push(a.close, b.close, () => host.dispose())
  await until(() => host.ownRoutes().length === 2, 'two routes')
  const gen = async (gw: typeof a) => {
    gw.requests.length = 0
    await collect(host.llm.stream({ provider: `${OLD}-codex`, model: 'codex/gpt-6.1-sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }] }] } as never))
    return gw.requests.find(r => r.path === '/v1/responses')?.headers.authorization
  }
  // Move line 2 first and save, then make each line the only reachable one by closing the other's path.
  const saved = await host.call('settings', { lines: [{ id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' }, { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' }] })
  expect(saved.status).toBe(200)
  expect(await gen(b)).toBe('Bearer K2')
  await host.call('settings', { lines: [{ id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' }, { id: LINE_ID_2, baseUrl: 'http://127.0.0.1:1/v1', accessMode: 'direct' }] })
  expect(await gen(a)).toBe('Bearer K1')
  expect(credentials.values.has('MAGPIE_API_KEY')).toBe(false)
})
