import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { createGateway, json, deferred } from './support/gateway.js'
import { LINE_ID, line, lineCredentials, memoryStore } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const entry of cleanup.splice(0).reverse()) await entry() })
const publishedCounter = { value: 0 }
async function setup(lines: { baseUrl: string }[] = [], key = 'mk-placeholder') {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials(key)
  const store = memoryStore(lines.map(entry => line(entry.baseUrl)))
  const runtime = new MagpieRuntime(credentials.service, store, () => { publishedCounter.value++ }, { newId: () => LINE_ID })
  cleanup.push(() => runtime.dispose())
  gateway.handlers.set('GET /v1/models', json({ data: Array.from({ length: 13 }, (_, index) => ({ id: `model-${index}` })) }))
  return { gateway, runtime, store, credentials }
}

test('test_catalog_sync_01 spec Scenario "保存地址后自动同步并发布"', async () => {
  publishedCounter.value = 0
  const { gateway, runtime } = await setup([], 'mk-placeholder')
  const saved = await runtime.settings({ lines: [{ baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'mk-placeholder' }] })
  expect(saved.status).toBe(200)
  expect(gateway.requests.filter(request => request.path === '/v1/models')).toHaveLength(1)
  expect(runtime.current.catalog).toHaveLength(13)
  expect(publishedCounter.value).toBeGreaterThan(0)
})

test('test_catalog_sync_02 spec Scenario "同步失败保留当前代目录"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('mk-placeholder')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  gateway.handlers.set('GET /v1/models', json({ data: Array.from({ length: 13 }, (_, index) => ({ id: `model-${index}` })) }))
  await runtime.start()
  const at = runtime.current.lastSyncAt
  gateway.handlers.set('GET /v1/models', json({}, 503))
  await runtime.syncCatalog()
  expect(runtime.current.catalog).toHaveLength(13)
  expect(runtime.current.lastSyncErrorKind).toBe('http')
  expect(runtime.current.lastSyncAt).toBe(at)
})

test('test_catalog_sync_03 spec Scenario "同代重复触发只发一次请求"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('mk-placeholder')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const entered = deferred(), gate = deferred()
  gateway.handlers.set('GET /v1/models', async res => { entered.resolve(); await gate.promise; json({ data: [] })(res, {} as never) })
  const first = runtime.start(); await entered.promise
  const others = [runtime.syncCatalog(), runtime.syncCatalog()]
  gate.resolve(); await Promise.all([first, ...others])
  expect(gateway.requests).toHaveLength(1)
})

test('test_catalog_sync_04 spec Scenario "同步超时"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('mk-placeholder')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  gateway.handlers.set('GET /v1/models', json({ data: Array.from({ length: 13 }, (_, index) => ({ id: `model-${index}` })) }))
  await runtime.start()
  const entered = deferred()
  gateway.handlers.set('GET /v1/models', () => entered.resolve())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const sync = runtime.syncCatalog(); await entered.promise
  await vi.advanceTimersByTimeAsync(15_000); await sync
  expect(runtime.current.lastSyncErrorKind).toBe('unreachable')
  expect(runtime.current.catalog).toHaveLength(13)
})

test('test_catalog_sync_05 spec Scenario "key 无效的分类"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('mk-placeholder')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  gateway.handlers.set('GET /v1/models', json({}, 401))
  await runtime.start()
  expect(runtime.current.lastSyncErrorKind).toBe('unauthorized')
})
