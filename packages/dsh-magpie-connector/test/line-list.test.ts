import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const portOf = (baseUrl: string) => Number(new URL(baseUrl).port)

test('test_line_list_01 spec Scenario "首次安装为 0 条并提供添加入口"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const credentials = lineCredentials(undefined)
  const store = memoryStore([])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { newId: () => LINE_ID })
  cleanup.push(() => runtime.dispose())
  const empty = await (await runtime.settings()).json() as { lines: unknown[]; activeLineId: string | null }
  expect(empty.lines).toEqual([])
  expect(empty.activeLineId).toBeNull()
  const saved = await runtime.settings({ lines: [{ baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'mk-1' }] })
  expect(saved.status).toBe(200)
  const view = await saved.json() as { lines: { id: string }[] }
  expect(view.lines.map(entry => entry.id)).toEqual([LINE_ID])
  expect(gateway.requests.filter(request => request.path === '/v1/models')).toHaveLength(1)
})

test('test_line_list_02 spec Scenario "添加备用线路并调整优先级"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  b.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  let next = LINE_ID_2
  const store = memoryStore([line(a.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true, newId: () => next })
  cleanup.push(() => runtime.dispose())
  const added = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
    { baseUrl: b.baseUrl, accessMode: 'direct', key: 'K2' },
  ] })
  expect(added.status).toBe(200)
  const reordered = await runtime.settings({ lines: [
    { id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' },
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
  ] })
  expect(reordered.status).toBe(200)
  expect(store.value.lines.map(entry => entry.id)).toEqual([LINE_ID_2, LINE_ID])
  const restarted = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => restarted.dispose())
  expect((await (await restarted.settings()).json() as { lines: { id: string }[] }).lines.map(entry => entry.id)).toEqual([LINE_ID_2, LINE_ID])
  void next
})

test('test_line_list_03 spec Scenario "删除线路且至少保留一条"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(await unreachableBaseUrl(), LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => runtime.dispose())
  expect((await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' }] })).status).toBe(200)
  expect((await runtime.settings({ lines: [] })).status).toBe(400)
  expect(store.value.lines).toHaveLength(1)
})

test('test_line_list_04 spec Scenario "未完整线路不参与自动选择"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', json({}, 503))
  const credentials = lineCredentials('K1') // no key for the second line
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(await unreachableBaseUrl(), LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => false })
  cleanup.push(() => runtime.dispose())
  await runtime.start()
  expect(runtime.current.lineId).toBe(LINE_ID)
  expect((await (await runtime.settings()).json() as { lines: { id: string; complete: boolean }[] }).lines.find(entry => entry.id === LINE_ID_2)?.complete).toBe(false)
})

test('test_line_list_05 spec Scenario "折叠线路可展开编辑"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(await unreachableBaseUrl(), LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async (_host, port) => port === portOf(a.baseUrl) })
  cleanup.push(() => runtime.dispose())
  await runtime.start()
  const previous = runtime.current
  const response = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
    { id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' },
  ] })
  expect(response.status).toBe(200)
  expect(runtime.current).toBe(previous)
  expect((await (await runtime.settings()).json() as { lines: { id: string; baseUrl: string }[] }).lines.find(entry => entry.id === LINE_ID_2)?.baseUrl).toBe(b.baseUrl)
})

test('test_line_list_06 spec Scenario "线路数量上限"', async () => {
  const gateways = await Promise.all(Array.from({ length: 5 }, () => createGateway()))
  cleanup.push(...gateways.map(gateway => gateway.close))
  const lines = gateways.map((gateway, index) => line(gateway.baseUrl, ['a1b2c3d4', '9f0e7d6c', '0badf00d', 'feedface', 'deadbeef'][index]!))
  const credentials = lineCredentials('K1')
  for (const entry of lines.slice(1)) credentials.setRef(refs(entry.id).key as unknown as string, `K-${entry.id}`)
  const store = memoryStore(lines)
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true, newId: () => 'cafebabe' })
  cleanup.push(() => runtime.dispose())
  const before = JSON.stringify(store.value)
  const response = await runtime.settings({ lines: [
    ...lines.map(entry => ({ id: entry.id, baseUrl: entry.baseUrl, accessMode: 'direct' as const })),
    { baseUrl: 'http://extra.test/v1', accessMode: 'direct' as const, key: 'K6' },
  ] })
  expect(response.status).toBe(400)
  expect(JSON.stringify(store.value)).toBe(before)
})
