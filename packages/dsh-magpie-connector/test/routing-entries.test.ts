import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildModelCatalog } from './support/model-catalog.js'
import { collect, mountRealHost, until } from './support/host.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, lineCredentials } from './support/line.js'
import { chatText } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const route = (key: string) => `dsh-magpie-connector-${key}`
const sse = (events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'

async function mount(catalog: { value: unknown[] }, extra: Record<string, unknown> = {}) {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', async (res, request) => json({ data: catalog.value })(res, request))
  const host = await mountRealHost({ credentials: lineCredentials('mk-routing'), settings: { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }], ...extra } })
  cleanup.push(gateway.close, () => host.dispose())
  return { host, gateway }
}
const view = async (host: { call: (r: 'settings') => Promise<Response> }) => await (await host.call('settings')).json() as Record<string, any>
const knownOwners = (home: string) => (JSON.parse(readFileSync(join(home, 'plugins/dsh-magpie-connector/settings.json'), 'utf8')) as { knownOwners?: string[] }).knownOwners

test('test_routing_entries_01 spec Scenario "按前缀识别与分类"', async () => {
  const { host } = await mount({ value: [
    { id: 'group/ds', owned_by: 'opencode-go' },
    { id: 'group/auto-kimi-k3', owned_by: 'opencode-go' },
    { id: 'auto/glm-5', owned_by: 'opencode-go' },
    { id: 'opencode-go/x', display_name: 'Routing group X', magpie_label: 'routing group', owned_by: 'opencode-go' },
    { id: 'Group/x', owned_by: 'opencode-go' },
  ] })
  await until(async () => (await view(host)).groups?.length >= 2, 'groups')
  const groups = (await view(host)).groups as { provider: string, models: { id: string, routingKind?: string }[] }[]
  const routing = groups.find(g => g.provider === 'routing')!
  expect(routing.models.map(m => [m.id, m.routingKind])).toEqual([['group/ds', 'custom'], ['group/auto-kimi-k3', 'auto'], ['auto/glm-5', 'auto']])
  const vendor = groups.find(g => g.provider === 'opencode-go')!
  expect(vendor.models.map(m => m.id)).toEqual(['opencode-go/x', 'Group/x'])
  for (const m of vendor.models) expect(m).not.toHaveProperty('routingKind')
})

test('test_routing_entries_02 spec Scenario "透传 id 与 effort"', async () => {
  const { host, gateway } = await mount({ value: [{ id: 'group/cheap-first', owned_by: 'opencode-go', reasoning_levels: ['low', 'high', 'max'], native_endpoints: [] }] })
  await until(() => host.ownRoutes().includes(route('routing')), 'routing route')
  expect((await host.call('settings', { defaultEffort: { model: 'group/cheap-first', effort: 'high' } })).status).toBe(200)
  const info = await host.llm.resolveModelInfo(route('routing'), 'group/cheap-first')
  expect(info.reasoning?.defaultEffort).toBe('high')
  gateway.handlers.set('POST /v1/chat/completions', res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(sse(chatText('hi'))) })
  await collect(host.llm.stream({ provider: route('routing'), model: 'group/cheap-first', messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }] }], reasoningEffort: info.reasoning!.defaultEffort } as never))
  const body = gateway.requests.find(r => r.path === '/v1/chat/completions')!.body as { model: string, reasoning_effort: string }
  expect(body.model).toBe('group/cheap-first')
  expect(body.reasoning_effort).toBe('high')
})

test('test_routing_entries_03 spec Scenario "路由入口归入 routing 而不随首个成员换组"', async () => {
  const catalog = { value: [
    { id: 'group/cheap-first', display_name: '便宜优先', owned_by: 'opencode-go' },
    { id: 'auto/kimi-k3', display_name: 'Kimi K3', owned_by: 'opencode-go' },
    { id: 'opencode-go/kimi-k3', owned_by: 'opencode-go' },
    { id: 'claude/claude-fable-5-2', owned_by: 'claude' },
  ] as Record<string, unknown>[] }
  const { host } = await mount(catalog)
  const expectGroups = async () => {
    const groups = (await buildModelCatalog(host.llm)).groups
    const by = (id: string) => groups.find(g => g.id === id)
    expect(by(route('routing'))?.name).toBe('Magpie (Routing)')
    expect(by(route('routing'))!.models.map(m => [m.id, m.name])).toEqual([['group/cheap-first', '便宜优先'], ['auto/kimi-k3', 'Kimi K3']])
    expect(by(route('opencode-go'))!.models.map(m => m.id)).toEqual(['opencode-go/kimi-k3'])
    expect(by(route('claude'))!.models.map(m => m.id)).toEqual(['claude/claude-fable-5-2'])
  }
  await until(() => host.ownRoutes().length >= 3, 'routes')
  await expectGroups()
  catalog.value[0]!.owned_by = 'claude'
  await host.call('settings', { resync: true })
  await expectGroups()
})

test('test_routing_entries_04 spec Scenario "首次安装只有路由入口"', async () => {
  const { host } = await mount({ value: [{ id: 'group/ds', owned_by: 'opencode-go' }] })
  await until(() => host.ownRoutes().length >= 1, 'routes')
  expect(knownOwners(host.home)).toEqual(['routing'])
  expect(host.ownRoutes()).toEqual([route('routing')])
  expect((await host.llm.listModels(route('routing'))).map(m => m.id)).toEqual(['group/ds'])
})

test('test_routing_entries_05 spec Scenario "名为 routing 的普通模型归入 other"', async () => {
  const { host } = await mount({ value: [{ id: 'routing/foo', owned_by: 'routing' }, { id: 'routing/bar' }] })
  await until(() => host.ownRoutes().length >= 1, 'routes')
  const groups = (await buildModelCatalog(host.llm)).groups
  expect(groups.find(g => g.id === route('other'))!.models.map(m => m.id)).toEqual(['routing/foo', 'routing/bar'])
  expect(groups.find(g => g.id === route('routing'))).toBeUndefined()
  const settings = (await view(host)).groups as { provider: string, models: Record<string, unknown>[] }[]
  expect(settings.map(g => g.provider)).toEqual(['other'])
  for (const m of settings[0]!.models) expect(m).not.toHaveProperty('routingKind')
  expect(knownOwners(host.home)).not.toContain('routing')
})

test('test_routing_entries_06 spec Scenario "旧会话保存的厂商 route 路由入口不再可用"', async () => {
  const { host } = await mount({ value: [{ id: 'group/ds', owned_by: 'opencode-go', reasoning_levels: ['low', 'high', 'max'] }, { id: 'opencode-go/kimi-k3', owned_by: 'opencode-go' }] },
    { knownOwners: ['opencode-go'], defaultEfforts: { 'group/ds': 'high' } })
  await until(() => host.ownRoutes().includes(route('routing')), 'routing route')
  expect((await host.llm.listModels(route('opencode-go'))).map(m => m.id)).toEqual(['opencode-go/kimi-k3'])
  expect((await host.llm.listModels(route('routing'))).map(m => m.id)).toEqual(['group/ds'])
  expect((await host.llm.resolveModelInfo(route('routing'), 'group/ds')).reasoning?.defaultEffort).toBe('high')
})
