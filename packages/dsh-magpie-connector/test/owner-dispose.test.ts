import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountRealHost, until } from './support/host.js'
import { createGateway, deferred, json } from './support/gateway.js'
import { lineCredentials, LINE_ID } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const route = (key: string) => `dsh-magpie-connector-${key}`
const file = (home: string) => join(home, 'plugins/dsh-magpie-connector/settings.json')
const settings = (baseUrl: string, extra: Record<string, unknown> = {}) => ({ lines: [{ id: LINE_ID, baseUrl, accessMode: 'direct' }], ...extra })
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
process.on('unhandledRejection', onUnhandled)
afterEach(() => { expect(unhandled).toEqual([]) })

test('test_owner_dispose_01 spec Scenario "dispose 不删除数据"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'claude/m', owned_by: 'claude' }] }))
  const credentials = lineCredentials('mk-1')
  const unset = credentials.service.unset
  let unsets = 0
  credentials.service.unset = async ref => { unsets++; return unset(ref) }
  const host = await mountRealHost({ credentials, settings: settings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  await until(() => gateway.requests.length > 0, 'sync')
  await new Promise(resolve => setTimeout(resolve, 30))
  const bytes = readFileSync(file(host.home))
  expect(host.ownRoutes()).toEqual([route('claude')])
  await host.dispose()
  expect(unsets).toBe(0)
  expect(readFileSync(file(host.home)).equals(bytes)).toBe(true)
  expect(host.ownRoutes()).toEqual([])
})

test('test_owner_dispose_02 spec Scenario "dispose 时有进行中的请求"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const gate = deferred()
  gateway.handlers.set('GET /v1/models', async (res, request) => { await gate.promise; await json({ data: [{ id: 'codex/m', owned_by: 'codex' }] })(res, request) })
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: settings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  await until(() => gateway.requests.length > 0, 'sync in flight')
  const bytes = readFileSync(file(host.home))
  await host.dispose()
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(host.ownRoutes()).toEqual([])
  expect(readFileSync(file(host.home)).equals(bytes)).toBe(true)
})

test('test_owner_dispose_03 spec Scenario "注册句柄 dispose 抛错时其它清理仍执行"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const gate = deferred()
  gateway.handlers.set('GET /v1/models', async (res, request) => { await gate.promise; await json({ data: [{ id: 'claude/m', owned_by: 'claude' }] })(res, request) })
  const host = await mountRealHost({ invariantListener: true, foreignRoutes: [route('zz')], credentials: lineCredentials('mk-1'), settings: settings(gateway.baseUrl, { knownOwners: ['claude'] }) })
  expect(host.ownRoutes().sort()).toEqual([route('claude'), route('zz')])
  await until(() => gateway.requests.length > 0, 'sync in flight')
  const bytes = readFileSync(file(host.home))
  host.invariant.on = true
  const dispose = host.dispose()
  const settled = await dispose.then(() => 'ok', error => error)
  void settled
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(host.llm.listProviders().map(p => p.id)).toContain(route('zz'))
  expect(readFileSync(file(host.home)).equals(bytes)).toBe(true)
  expect(host.plugin.runtime.isCurrent(host.plugin.runtime.current)).toBe(false)
  expect(gateway.requests.filter(r => r.path === '/v1/models')).toHaveLength(1)
})

test('test_owner_dispose_04 spec Scenario "尚未注册任何 route 时 dispose"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const gate = deferred()
  gateway.handlers.set('GET /v1/models', async (res, request) => { await gate.promise; await json({ data: [{ id: 'claude/m', owned_by: 'claude' }] })(res, request) })
  const host = await mountRealHost({ credentials: lineCredentials('mk-1'), settings: settings(gateway.baseUrl) })
  await until(() => gateway.requests.length > 0, 'sync in flight')
  const bytes = readFileSync(file(host.home))
  await host.dispose()
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(host.ownRoutes()).toEqual([])
  expect(readFileSync(file(host.home)).equals(bytes)).toBe(true)
  expect(JSON.parse(readFileSync(file(host.home), 'utf8')).knownOwners).toBeUndefined()
})
