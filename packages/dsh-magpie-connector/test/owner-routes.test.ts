import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mountRealHost, until } from './support/host.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, lineCredentials } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

/** Real host + real plugin against a mock gateway serving `data`; resolves after the first sync registered routes. */
async function mount(data: unknown[], extra: Record<string, unknown> = {}, expectRoutes = 1) {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data }))
  const host = await mountRealHost({
    credentials: lineCredentials('mk-owner'),
    settings: { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }], ...extra },
  })
  cleanup.push(gateway.close, () => host.dispose())
  await until(() => host.ownRoutes().length >= expectRoutes, 'routes registered')
  return { host, gateway }
}
const routeId = (key: string) => `dsh-magpie-connector-${key}`
const sessionController = () => import('@deepseek-ai/dsh-api-session-controller')

test('test_owner_routes_01 spec Scenario "按 owned_by 分组且不按名字猜测"', async () => {
  const { host } = await mount([
    { id: 'claude/claude-opus-5-5', owned_by: 'claude' },
    { id: 'custom/claude-looking', display_name: 'Claude Looking', owned_by: 'codex' },
    { id: 'opencode-go/kimi-k3', owned_by: 'opencode-go' },
    { id: 'x/gpt-lookalike' },
  ], {}, 4)
  const { buildModelCatalog } = await sessionController()
  const catalog = await buildModelCatalog({ llm: host.llm, agentDefaultModel: { currentSelection: () => ({}) } } as never, {} as never)
  expect(catalog.groups.map(g => [g.id, g.name, g.models.map(m => m.id)])).toEqual([
    [routeId('claude'), 'Magpie (Claude)', ['claude/claude-opus-5-5']],
    [routeId('codex'), 'Magpie (Codex)', ['custom/claude-looking']],
    [routeId('opencode-go'), 'Magpie (Opencode-go)', ['opencode-go/kimi-k3']],
    [routeId('other'), 'Magpie (Other)', ['x/gpt-lookalike']],
  ])
  expect(catalog.failures).toEqual([])
})

test('test_owner_routes_02 spec Scenario "不可信或大小写不同的 owned_by"', async () => {
  const owners = ['Claude', 'claude', 'a b', '', 'OTHER', 'x'.repeat(49), '<img src=x>', 123]
  const data = owners.map((owned_by, i) => ({ id: `m/${i}`, owned_by }))
  const { host } = await mount(data, {}, 2)
  const names = () => Object.fromEntries(host.llm.listProviders().filter(p => p.id.startsWith('dsh-magpie-connector')).map(p => [p.id, p.name]))
  expect(Object.keys(names()).sort()).toEqual([routeId('claude'), routeId('other')])
  expect(names()[routeId('claude')]).toBe('Magpie (Claude)')
  expect((await host.llm.listModels(routeId('claude'))).map(m => m.id)).toEqual(['m/0', 'm/1'])
  expect((await host.llm.listModels(routeId('other'))).map(m => m.id)).toEqual(['m/2', 'm/3', 'm/4', 'm/5', 'm/6', 'm/7'])
  for (const [id, name] of Object.entries(names())) {
    expect(id).toMatch(/^dsh-magpie-connector-[a-z0-9][a-z0-9._-]{0,47}$/)
    expect(name).not.toMatch(/[<>]/)
  }
  // Swapping the order of the two case variants must not change the display name.
  const swapped = await mount([data[1]!, data[0]!, ...data.slice(2)], {}, 2)
  expect(swapped.host.llm.listProviders().find(p => p.id === routeId('claude'))?.name).toBe('Magpie (Claude)')
})

test('test_owner_routes_03 spec Scenario "返回的 provider 等于被请求的 route"', async () => {
  const { host } = await mount([
    { id: 'claude/claude-opus-5-5', owned_by: 'claude', reasoning_levels: ['low', 'high'] },
    { id: 'codex/gpt-6.1-sol', owned_by: 'codex' },
  ], {}, 2)
  const claude = routeId('claude'), codex = routeId('codex')
  for (const m of await host.llm.listModels(claude)) expect(m.provider).toBe(claude)
  const efforts = async (provider: string) => (await host.llm.resolveModelInfo(provider, 'claude/claude-opus-5-5')).reasoning?.efforts.map(e => e.id)
  expect(await efforts(claude)).toEqual(['low', 'high'])
  expect(await efforts(codex)).toEqual(['low', 'high'])
  for (const provider of [claude, codex]) {
    expect((await host.llm.resolveModelInfo(provider, 'claude/claude-opus-5-5')).provider).toBe(provider)
    const prepared = await host.llm.prepareCall({ provider, model: 'claude/claude-opus-5-5' })
    expect(prepared.config.provider).toBe(provider)
  }
  expect(await host.llm.resolveModelInfo(claude, 'nope/x')).toMatchObject({ provider: claude, id: 'nope/x', name: 'nope/x' })
  expect((await host.llm.prepareCall({ provider: claude, model: 'nope/x' })).config).toMatchObject({ provider: claude, model: 'nope/x' })
})

test('test_owner_routes_04 spec Scenario "可见性与 effort 在归属 route 上保持"', async () => {
  const visibleModels = { Claude: ['m/a'], claude: [] }
  const { host } = await mount([
    { id: 'm/a', owned_by: 'Claude', reasoning_levels: ['low', 'high'] },
    { id: 'm/b', owned_by: 'claude' },
  ], { visibleModels, defaultEfforts: { 'm/a': 'high' } })
  const claude = routeId('claude')
  expect((await host.llm.listModels(claude)).map(m => m.id)).toEqual(['m/a'])
  expect((await host.llm.resolveModelInfo(claude, 'm/a')).reasoning?.defaultEffort).toBe('high')
  const saved = JSON.parse(readFileSync(`${host.home}/plugins/dsh-magpie-connector/settings.json`, 'utf8'))
  expect(saved.visibleModels).toEqual(visibleModels)
})

test('test_owner_routes_05 spec Scenario "other 组内保留各自的可见性键"', async () => {
  const { host } = await mount([
    { id: 'p/a', owned_by: 'a b' },
    { id: 'q/b' },
  ], { visibleModels: { 'a b': [], q: ['q/b'] } })
  const other = routeId('other')
  expect((await host.llm.listModels(other)).map(m => m.id)).toEqual(['q/b'])
  // Both belong to the route even though p/a is hidden by its own key.
  expect((await host.llm.resolveModelInfo(other, 'p/a')).id).toBe('p/a')
})

test('test_owner_routes_06 spec Scenario "原版宿主即可看到分组"', async () => {
  const require = createRequire(import.meta.url)
  expect(readFileSync(require.resolve('@deepseek-ai/dsh-api-session-controller'), 'utf8')).not.toContain('displayGroup')
  const { host } = await mount([
    { id: 'claude/claude-opus-5-5', owned_by: 'claude' },
    { id: 'codex/gpt-6.1-sol', owned_by: 'codex' },
  ], {}, 2)
  const { buildModelCatalog } = await sessionController()
  const catalog = await buildModelCatalog({ llm: host.llm, agentDefaultModel: { currentSelection: () => ({}) } } as never, {} as never)
  expect(catalog.groups.map(g => g.name)).toEqual(['Magpie (Claude)', 'Magpie (Codex)'])
  for (const route of host.ownRoutes()) {
    for (const m of await host.llm.listModels(route)) expect(m).not.toHaveProperty('displayGroup')
    for (const m of await host.llm.listModels(route)) expect(await host.llm.resolveModelInfo(route, m.id)).not.toHaveProperty('displayGroup')
  }
})
