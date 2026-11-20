import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountRealHost, until } from './support/host.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, lineCredentials } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const route = (key: string) => `dsh-magpie-connector-${key}`
const owners = (n: number) => Array.from({ length: n }, (_, i) => `o${String(i).padStart(2, '0')}`)
const knownOwners = (home: string) => (JSON.parse(readFileSync(join(home, 'plugins/dsh-magpie-connector/settings.json'), 'utf8')) as { knownOwners?: string[] }).knownOwners
const view = async (host: { call: (r: 'settings') => Promise<Response> }) => await (await host.call('settings')).json() as Record<string, any>

async function mount(data: unknown[], extra: Record<string, unknown> = {}, foreignRoutes?: string[]) {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data }))
  const host = await mountRealHost({ ...(foreignRoutes ? { foreignRoutes } : {}), credentials: lineCredentials('mk-owners'), settings: { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }], ...extra } })
  cleanup.push(gateway.close, () => host.dispose())
  return host
}

test('test_routing_owners_01 spec Scenario "routing 在同一次同步中优先准入"', async () => {
  const existing = owners(31)
  const host = await mount([{ id: 'zz/m', owned_by: 'zz' }, { id: 'group/ds', owned_by: 'opencode-go' }], { knownOwners: existing })
  await until(() => host.ownRoutes().includes(route('routing')), 'routing route')
  expect(knownOwners(host.home)).toEqual([...existing, 'routing'])
  expect((await host.llm.listModels(route('routing'))).map(m => m.id)).toEqual(['group/ds'])
  const body = await until(async () => { const v = await view(host); return v.ownerLimitReached ? v : undefined }, 'limit reported')
  expect(body.rejectedOwners).toEqual(['zz'])
})

test('test_routing_owners_02 spec Scenario "首次同步时 routing 排在最前"', async () => {
  const host = await mount([{ id: 'claude/a', owned_by: 'claude' }, { id: 'group/ds', owned_by: 'opencode-go' }])
  await until(() => host.ownRoutes().length >= 2, 'routes')
  expect(knownOwners(host.home)).toEqual(['routing', 'claude'])
})

test('test_routing_owners_03 spec Scenario "名额已满时 routing 被拒绝并报告"', async () => {
  const existing = [...owners(31), 'opencode-go']
  const host = await mount([{ id: 'group/ds', owned_by: 'opencode-go' }], { knownOwners: existing })
  const body = await until(async () => { const v = await view(host); return v.ownerLimitReached ? v : undefined }, 'limit reported')
  expect(body.rejectedOwners).toEqual(['routing'])
  expect(host.ownRoutes()).not.toContain(route('routing'))
  // Not admitted: the entry stays usable under its vendor route, as before the upgrade.
  await until(async () => (await host.llm.listModels(route('opencode-go'))).some(m => m.id === 'group/ds'), 'fallback listing')
  for (const id of host.ownRoutes().filter(id => id !== route('opencode-go'))) expect((await host.llm.listModels(id)).map(m => m.id)).not.toContain('group/ds')
})

test('test_routing_owners_04 spec Scenario "routing route 被占用时 replace 冲突"', async () => {
  const host = await mount([{ id: 'claude/a', owned_by: 'claude' }, { id: 'group/ds', owned_by: 'opencode-go' }], { knownOwners: ['claude'] }, [route('routing')])
  await until(async () => (await view(host)).lastSyncErrorKind === 'registration', 'registration error')
  expect((await view(host)).lastSyncError).toContain(route('routing'))
  expect(host.plugin.routes.current()).toEqual([route('claude')])
  expect((await host.llm.listModels(route('claude'))).map(m => m.id)).toEqual(['claude/a'])
  expect(knownOwners(host.home)).toEqual(['claude'])
})

test('test_routing_owners_05 spec Scenario "replace 冲突撤回后路由入口留在已注册的原厂商 route"', async () => {
  const host = await mount([{ id: 'claude/a', owned_by: 'claude' }, { id: 'group/mix', owned_by: 'claude' }], { knownOwners: ['claude'] }, [route('routing')])
  await until(async () => (await view(host)).lastSyncErrorKind === 'registration', 'registration error')
  expect((await host.llm.listModels(route('claude'))).map(m => m.id)).toEqual(['claude/a', 'group/mix'])
  for (const id of host.ownRoutes().filter(id => id !== route('claude'))) expect((await host.llm.listModels(id)).map(m => m.id)).not.toContain('group/mix')
  expect(knownOwners(host.home)).toEqual(['claude'])
})
