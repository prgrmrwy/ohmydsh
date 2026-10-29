import { afterEach, expect, test } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountRealHost, until } from './support/host.js'
import { createGateway, deferred, json } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, lineCredentials, refs } from './support/line.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const route = (key: string) => `dsh-magpie-connector-${key}`
const owned = (...keys: string[]) => ({ data: keys.flatMap(key => [{ id: `${key}/m`, owned_by: key }]) })
const settingsFile = (home: string) => join(home, 'plugins/dsh-magpie-connector/settings.json')
const readJson = (home: string) => JSON.parse(readFileSync(settingsFile(home), 'utf8')) as Record<string, unknown>
const view = async (host: { call: (r: 'settings') => Promise<Response> }) => await (await host.call('settings')).json() as Record<string, any>

/** A gateway whose /models blocks on `gate` and then serves `catalog.value`. */
async function gatedGateway(initial: unknown) {
  const gateway = await createGateway()
  const gate = deferred()
  const catalog = { value: initial }
  gateway.handlers.set('GET /v1/models', async (res, request) => { await gate.promise; await json(catalog.value)(res, request) })
  cleanup.push(gateway.close)
  return { gateway, gate, catalog }
}
const lineSettings = (baseUrl: string, extra: Record<string, unknown> = {}) => ({ lines: [{ id: LINE_ID, baseUrl, accessMode: 'direct' }], ...extra })

test('test_owner_persistence_01 spec Scenario "重启后 route 身份在同步前即存在"', async () => {
  const { gateway } = await gatedGateway(owned('claude'))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude', 'codex'] }) })
  cleanup.push(() => host.dispose())
  expect(host.ownRoutes().sort()).toEqual([route('claude'), route('codex')])
  const names = Object.fromEntries(host.llm.listProviders().map(p => [p.id, p.name]))
  expect(names[route('claude')]).toBe('Magpie (Claude)')
  expect(names[route('codex')]).toBe('Magpie (Codex)')
  expect(await host.llm.resolveModelInfo(route('claude'), 'claude/claude-opus-5-5')).toMatchObject({ provider: route('claude'), id: 'claude/claude-opus-5-5', name: 'claude/claude-opus-5-5' })
  expect(await host.llm.listModels(route('claude'))).toEqual([])
  expect(await host.llm.listModels(route('codex'))).toEqual([])
})

test('test_owner_persistence_02 spec Scenario "首次安装在同步前不注册 route"', async () => {
  const { gateway } = await gatedGateway(owned('claude'))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl) })
  cleanup.push(() => host.dispose())
  expect(host.ownRoutes()).toEqual([])
  expect((await host.call('settings')).status).toBe(200)
})

test('test_owner_persistence_03 spec Scenario "首次配置经设置请求同步出归属后注册"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json(owned('claude')))
  const host = await mountRealHost({ credentials: credentialsMock(undefined) })
  cleanup.push(() => host.dispose())
  let events = 0
  host.ctx.on('llm/adapters-updated' as never, (() => { events++ }) as never)
  const response = await Promise.race([
    host.call('settings', { lines: [{ baseUrl: gateway.baseUrl, key: 'mk-new' }], resync: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('settings request took > 5s')), 5000)),
  ])
  expect(response.status).toBe(200)
  const saved = readJson(host.home)
  expect(saved.knownOwners).toEqual(['claude'])
  expect((saved.lines as unknown[]).length).toBe(1)
  expect(events).toBeGreaterThan(0)
  expect(host.ownRoutes()).toEqual([route('claude')])
}, 8000)

test('test_owner_persistence_04 spec Scenario "resync 发现新归属不自锁"', async () => {
  const { gateway, gate } = await gatedGateway(owned('claude', 'deepseek'))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  cleanup.push(() => host.dispose())
  await until(() => gateway.requests.some(r => r.path === '/v1/models'), 'background sync in flight')
  const pending = host.call('settings', { resync: true })
  gate.resolve()
  const response = await Promise.race([pending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('resync locked')), 5000))])
  expect(response.status).toBe(200)
  expect(readJson(host.home).knownOwners).toEqual(['claude', 'deepseek'])
  await until(() => host.ownRoutes().includes(route('deepseek')), 'deepseek route')
}, 8000)

test('test_owner_persistence_05 spec Scenario "新归属被持久并发布"', async () => {
  const { gateway, gate } = await gatedGateway(owned('claude', 'deepseek'))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  cleanup.push(() => host.dispose())
  let events = 0
  host.ctx.on('llm/adapters-updated' as never, (() => { events++ }) as never)
  gate.resolve()
  await until(() => host.ownRoutes().includes(route('deepseek')), 'deepseek route')
  expect(readJson(host.home).knownOwners).toEqual(['claude', 'deepseek'])
  expect(events).toBeGreaterThan(0)
})

test('test_owner_persistence_06 spec Scenario "保存 knownOwners 失败时仍发布已有 route 的目录变化"', async () => {
  const { gateway, gate, catalog } = await gatedGateway({ data: [{ id: 'claude/a', owned_by: 'claude' }] })
  gate.resolve()
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  cleanup.push(() => host.dispose())
  await until(async () => (await host.llm.listModels(route('claude'))).length === 1, 'claude/a listed')
  let events = 0
  host.ctx.on('llm/adapters-updated' as never, (() => { events++ }) as never)
  const store = host.plugin.runtime.store, save = store.save.bind(store)
  store.save = () => { throw new Error('disk full') }
  catalog.value = { data: [{ id: 'claude/a', owned_by: 'claude' }, { id: 'claude/b', owned_by: 'claude' }, { id: 'deepseek/x', owned_by: 'deepseek' }] }
  await host.call('settings', { resync: true })
  expect(events).toBeGreaterThan(0)
  const { buildModelCatalog } = await import('@deepseek-ai/dsh-api-session-controller')
  const built = await buildModelCatalog({ llm: host.llm, agentDefaultModel: { currentSelection: () => ({}) } } as never, {} as never)
  expect(built.groups.find(g => g.name === 'Magpie (Claude)')?.models.map(m => m.id)).toEqual(['claude/a', 'claude/b'])
  expect(host.ownRoutes()).not.toContain(route('deepseek'))
  expect((await view(host)).lastSyncErrorKind).toBe('settings')
  store.save = save
  await host.call('settings', { resync: true })
  expect(host.ownRoutes()).toContain(route('deepseek'))
})

test('test_owner_persistence_07 spec Scenario "replace 冲突时撤回追加并发布目录"', async () => {
  const { gateway, gate } = await gatedGateway({ data: [{ id: 'claude/a', owned_by: 'claude' }, { id: 'claude/b', owned_by: 'claude' }, { id: 'deepseek/x', owned_by: 'deepseek' }] })
  const host = await mountRealHost({ foreignRoutes: [route('deepseek')], credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  cleanup.push(() => host.dispose())
  gate.resolve()
  await until(async () => (await view(host)).lastSyncErrorKind === 'registration', 'registration error')
  expect((await view(host)).lastSyncError).toContain(route('deepseek'))
  expect(host.plugin.routes.current()).toEqual([route('claude')])
  expect((await host.llm.listModels(route('claude'))).map(m => m.id)).toEqual(['claude/a', 'claude/b'])
  expect(readJson(host.home).knownOwners).toEqual(['claude'])
})

test('test_owner_persistence_08 spec Scenario "撤回写入失败时下次启动按启动失败处理"', async () => {
  const { gateway, gate } = await gatedGateway(owned('claude', 'deepseek'))
  const credentials = lineCredentials('mk-1')
  const host = await mountRealHost({ foreignRoutes: [route('deepseek')], credentials, settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  const store = host.plugin.runtime.store, save = store.save.bind(store)
  let saves = 0
  store.save = value => { if (++saves > 1) throw new Error('disk full'); save(value) }
  gate.resolve()
  await until(async () => (await view(host)).lastSyncErrorKind === 'registration', 'registration error')
  expect(readJson(host.home).knownOwners).toEqual(['claude', 'deepseek'])
  await host.dispose()
  const bytes = readFileSync(settingsFile(host.home))
  const restarted = await mountRealHost({ home: host.home, foreignRoutes: [route('deepseek')], credentials })
  cleanup.push(() => restarted.dispose())
  expect(restarted.plugin.routes.current()).toEqual([])
  const response = await restarted.call('settings')
  expect(response.status).toBe(200)
  expect((await response.json() as any).routeRegistrationError).toMatchObject({ code: 'DUPLICATE_ADAPTER', route: route('deepseek') })
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(restarted.plugin.routes.current()).toEqual([])
  expect(readFileSync(settingsFile(host.home)).equals(bytes)).toBe(true)
})

test('test_owner_persistence_09 spec Scenario "首次注册 INVARIANT 不当作成功"', async () => {
  const { gateway, gate, catalog } = await gatedGateway(owned('claude', 'codex'))
  const host = await mountRealHost({ invariantListener: true, invariantOn: true, credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  gate.resolve()
  catalog.value = owned('claude', 'codex')
  await host.call('settings', { resync: true })
  const body = await view(host)
  expect(body.routeRegistrationError).toMatchObject({ code: 'INVARIANT' })
  expect(host.ownRoutes()).toEqual([route('claude')])
  expect(readJson(host.home).knownOwners).toEqual(['claude'])
  const bytes = readFileSync(settingsFile(host.home))
  await host.dispose().catch(() => {})
  const requests = gateway.requests.length
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(host.ownRoutes()).toEqual([route('claude')])
  expect(gateway.requests.length).toBe(requests)
  expect(readFileSync(settingsFile(host.home)).equals(bytes)).toBe(true)
})

test('test_owner_persistence_10 spec Scenario "线路保存期间的归属追加不被覆盖"', async () => {
  const { gateway, gate } = await gatedGateway(owned('claude', 'deepseek'))
  const dir = (await import('node:fs')).mkdtempSync(join((await import('node:os')).tmpdir(), 'magpie-persist-'))
  const path = join(dir, 'settings.json')
  writeFileSync(path, JSON.stringify(lineSettings(gateway.baseUrl, { knownOwners: ['claude'] })))
  const credentials = lineCredentials('mk-old')
  const setGate = deferred(), setStarted = deferred()
  const realSet = credentials.service.set.bind(credentials.service)
  credentials.service.set = async (ref, value) => { setStarted.resolve(); await setGate.promise; await realSet(ref, value) }
  const store = new SettingsStore(path)
  const runtime = new MagpieRuntime(credentials.service, store, () => ({ ok: true }), { probe: async () => true })
  cleanup.push(() => runtime.dispose())
  const sync = runtime.syncCatalog()
  await until(() => gateway.requests.some(r => r.path === '/v1/models'), 'sync in flight')
  const saving = runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, key: 'mk-new' }] })
  await setStarted.promise
  gate.resolve()
  await sync
  const mid = JSON.parse(readFileSync(path, 'utf8'))
  expect(mid.knownOwners).toEqual(['claude', 'deepseek'])
  expect(mid.credentialUpdatePending).toBeDefined()
  expect(new SettingsStore(path).value.knownOwners).toEqual(['claude', 'deepseek'])
  setGate.resolve()
  expect((await saving).status).toBe(200)
  runtime.savePreferences({ visibleModels: { claude: ['claude/m'] } })
  const final = JSON.parse(readFileSync(path, 'utf8'))
  expect(final.knownOwners).toEqual(['claude', 'deepseek'])
  expect(final.credentialUpdatePending).toBeUndefined()
  expect(final.visibleModels).toEqual({ claude: ['claude/m'] })
  expect(final.lines).toEqual([{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }])
  expect(refs(LINE_ID_2)).toBeDefined()
})

test('test_owner_persistence_11 spec Scenario "非法 knownOwners 被整体重置且不影响连接"', async () => {
  const invalid: unknown[] = ['claude', ['Claude'], ['claude', 'claude'], Array.from({ length: 33 }, (_, i) => `o${String(i).padStart(2, '0')}`), ['a b']]
  for (const knownOwners of invalid) {
    const { gateway, gate } = await gatedGateway(owned('claude'))
    const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners }) })
    cleanup.push(() => host.dispose())
    expect(host.ownRoutes()).toEqual([])
    const bytes = readFileSync(settingsFile(host.home))
    const body = await view(host)
    expect(body.knownOwnersReset).toBe(true)
    expect(body.lines).toHaveLength(1)
    expect(readFileSync(settingsFile(host.home)).equals(bytes)).toBe(true)
    gate.resolve()
    await until(() => host.ownRoutes().includes(route('claude')), 'route after first sync')
    expect(readJson(host.home).knownOwners).toEqual(['claude'])
  }
}, 15000)

test('test_owner_persistence_12 spec Scenario "归属下架后 route 保留"', async () => {
  const { gateway, gate } = await gatedGateway(owned('claude'))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: ['claude', 'deepseek'] }) })
  cleanup.push(() => host.dispose())
  gate.resolve()
  await until(async () => (await view(host)).lastSyncAt, 'first sync')
  expect(host.ownRoutes().sort()).toEqual([route('claude'), route('deepseek')])
  expect(host.llm.listProviders().find(p => p.id === route('deepseek'))?.name).toBe('Magpie (Deepseek)')
  expect(await host.llm.listModels(route('deepseek'))).toEqual([])
  expect(readJson(host.home).knownOwners ?? ['claude', 'deepseek']).toEqual(['claude', 'deepseek'])
  const { buildModelCatalog } = await import('@deepseek-ai/dsh-api-session-controller')
  const built = await buildModelCatalog({ llm: host.llm, agentDefaultModel: { currentSelection: () => ({}) } } as never, {} as never)
  expect(built.groups.map(g => g.name)).toEqual(['Magpie (Claude)'])
})

test('test_owner_persistence_13 spec Scenario "归属上限按出现顺序截断"', async () => {
  const existing = Array.from({ length: 30 }, (_, i) => `o${String(i).padStart(2, '0')}`)
  const { gateway, gate, catalog } = await gatedGateway(owned('za', 'zb', 'zc'))
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: lineSettings(gateway.baseUrl, { knownOwners: existing }) })
  cleanup.push(() => host.dispose())
  gate.resolve()
  await until(() => host.ownRoutes().includes(route('zb')), 'za/zb registered')
  expect(host.ownRoutes()).toHaveLength(32)
  expect(host.ownRoutes()).not.toContain(route('zc'))
  expect(readJson(host.home).knownOwners).toEqual([...existing, 'za', 'zb'])
  const body = await view(host)
  expect(body.ownerLimitReached).toBe(true)
  expect(body.rejectedOwners).toEqual(['zc'])
  for (const id of host.ownRoutes()) expect((await host.llm.listModels(id)).map(m => m.id)).not.toContain('zc/m')
  catalog.value = owned('za', 'zb')
  await host.call('settings', { resync: true })
  expect((await view(host)).ownerLimitReached).toBe(false)
})
