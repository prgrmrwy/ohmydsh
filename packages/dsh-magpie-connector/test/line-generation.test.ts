import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import type { Probe } from '../src/host/selection.js'
import { SettingsStore } from '../src/host/settings.js'
import type { LineSettings } from '../src/host/settings.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line } from './support/line.js'
import { createGateway, json, deferred, unreachableBaseUrl } from './support/gateway.js'
import { chatText } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const entry of cleanup.splice(0).reverse()) await entry() })
const direct = (id: string, baseUrl: string): LineSettings => line(baseUrl, id, 'direct')
const sse = (events: unknown[]) => events.map(event => typeof event === 'string' ? `data: ${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`).join('')
const models = (ids: string[]) => json({ data: ids.map(id => ({ id })) })
const refs = (id: string) => lineCredentialRefs(id)

const portOf = (baseUrl: string) => Number(new URL(baseUrl).port)
async function setup(lines: LineSettings[], probe?: Probe) {
  const credentials = credentialsMock('K1')
  for (const entry of lines) if (entry.id !== LINE_ID) credentials.setRef(lineCredentialRefs(entry.id).key as unknown as string, entry.id === LINE_ID_2 ? 'K2' : 'K3')
  const store = new SettingsStore()
  store.value.lines = lines;
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, probe ? { probe } : {})
  cleanup.push(() => runtime.dispose())
  return { runtime, credentials, store }
}
function stubGeneration(runtime: MagpieRuntime) {
  const seen: { baseUrl?: string; key?: string }[] = []
  vi.spyOn(runtime.transport, 'fetchFor').mockImplementation(identity => {
    seen.push(identity)
    return async () => new Response(sse(chatText('hi')), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
  return seen
}
async function collect(adapter: MagpieAdapter, model = 'chat') {
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'dsh-magpie-connector', model, messages: [] })) chunks.push(chunk)
  return chunks
}

test('test_line_generation_01 spec Scenario "换地址后不显示旧目录"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(['a']))
  b.handlers.set('GET /v1/models', json({}, 503))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl)], async () => true)
  await runtime.start()
  expect(runtime.current.catalog).toHaveLength(1)
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: b.baseUrl, accessMode: 'direct' }] })
  expect(response.status).toBe(200)
  expect(runtime.current.catalog).toEqual([])
  expect(runtime.current.lastSyncError).toBeTruthy()
  expect(a.requests).toHaveLength(1)
  expect(b.requests.length).toBeGreaterThan(0)
})

test('test_line_generation_02 spec Scenario "换 key 后不显示旧卡片"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl)])
  await runtime.start()
  ;(runtime.current as unknown as { magpieCards?: unknown }).magpieCards = { cards: [{ provider: 'codex' }] }
  await runtime.settings({ lines: [{ ...runtime.config()[0]!, key: 'K2' }] })
  expect((runtime.current as unknown as { magpieCards?: unknown }).magpieCards).toBeUndefined()
})

test('test_line_generation_03 spec Scenario "旧代晚到的响应被丢弃"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  const entered = deferred(), gate = deferred()
  a.handlers.set('GET /v1/models', async res => { entered.resolve(); await gate.promise; json({ data: [{ id: 'OLD' }] })(res, {} as never) })
  b.handlers.set('GET /v1/models', models(['B1', 'B2']))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl)])
  await runtime.beginOperation().then(op => op.release())
  const stale = runtime.syncCatalog(); await entered.promise
  await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: b.baseUrl, accessMode: 'direct' }] })
  gate.resolve(); await stale
  expect(runtime.current.catalog.map(model => model.info.id)).toEqual(['B1', 'B2'])
})

test('test_line_generation_04 spec Scenario "已准备的调用按捕获值跑完"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  b.handlers.set('GET /v1/models', models(['chat']))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl)])
  await runtime.start()
  const adapter = new MagpieAdapter(runtime)
  const prepared = await adapter.prepareCall('dsh-magpie-connector', 'chat')
  const seen = stubGeneration(runtime)
  await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: b.baseUrl, accessMode: 'direct', key: 'K2' }] })
  const first = []
  for await (const chunk of prepared.stream({ provider: 'dsh-magpie-connector', model: 'chat', messages: [] })) first.push(chunk)
  expect(first.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  const second = await collect(adapter)
  expect(second.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(seen[0]).toMatchObject({ baseUrl: a.baseUrl, key: 'K1' })
  expect(seen[1]).toMatchObject({ baseUrl: b.baseUrl, key: 'K2' })
})

test('test_line_generation_05 spec Scenario "进行中的生成不被换代中止"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  b.handlers.set('GET /v1/models', models(['chat']))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl)])
  await runtime.start()
  const adapter = new MagpieAdapter(runtime)
  const seen: { baseUrl?: string }[] = []
  let push!: (chunk: string) => void; let close!: () => void
  const body = new ReadableStream<Uint8Array>({ start(controller) { push = chunk => controller.enqueue(new TextEncoder().encode(chunk)); close = () => controller.close() } })
  vi.spyOn(runtime.transport, 'fetchFor').mockImplementation(identity => { seen.push(identity); return async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }) })
  const events = chatText('hi')
  const iterator = adapter.stream({ provider: 'dsh-magpie-connector', model: 'chat', messages: [] })[Symbol.asyncIterator]()
  push(sse([events[0]]))
  await iterator.next()
  await new Promise(resolve => setTimeout(resolve, 20))
  await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: b.baseUrl, accessMode: 'direct' }] })
  push(sse(events.slice(1)))
  close()
  let last: unknown
  for (;;) { const next = await iterator.next(); if (next.done) break; last = next.value }
  expect(last).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(seen[0]).toMatchObject({ baseUrl: a.baseUrl, key: 'K1' })
  expect(b.requests.some(request => request.path === '/v1/models')).toBe(true)
})

test('test_line_generation_06 spec Scenario "外部改 key 触发换代"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  const { runtime, credentials } = await setup([direct(LINE_ID, a.baseUrl)])
  await runtime.start()
  const previous = runtime.current
  credentials.setRef(refs(LINE_ID).key as unknown as string, 'K2')
  runtime.invalidateCredential(refs(LINE_ID).key)
  expect(runtime.current).not.toBe(previous)
  expect(runtime.current.catalog).toEqual([])
  await runtime.syncCatalog()
  expect(a.requests.at(-1)?.headers.authorization).toBe('Bearer K2')
})

test('test_line_generation_07 spec Scenario "未收到事件时新操作发现 key 变化"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  const { runtime, credentials } = await setup([direct(LINE_ID, a.baseUrl)])
  await runtime.start()
  const previous = runtime.current
  credentials.setRef(refs(LINE_ID).key as unknown as string, 'K2')
  const op = await runtime.beginOperation()
  try {
    expect(op.gen).not.toBe(previous)
    expect(op.key).toBe('K2')
    expect(op.gen.catalog).toEqual([])
  } finally { op.release() }
})

test('test_line_generation_08 spec Scenario "自动切线路保留目录并清空卡片"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(Array.from({ length: 13 }, (_, index) => `m${index}`)))
  const bModels = deferred<Response>()
  b.handlers.set('GET /v1/models', async res => { await bModels.promise; json({ data: [{ id: 'B1' }, { id: 'B2' }] })(res, {} as never) })
  let activePort = portOf(a.baseUrl)
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === activePort)
  await runtime.start()
  expect(runtime.current.catalog).toHaveLength(13)
  ;(runtime.current as unknown as { magpieCards?: unknown }).magpieCards = { cards: [{ provider: 'codex' }] }
  activePort = portOf(b.baseUrl)
  runtime.selector.invalidate()
  const switching = runtime.syncCatalog()
  await vi.waitFor(() => expect(runtime.current.lineId).toBe(LINE_ID_2))
  expect(runtime.current.catalog).toHaveLength(13)
  expect((runtime.current as unknown as { magpieCards?: unknown }).magpieCards).toBeUndefined()
  bModels.resolve(Response.json({ data: [] }))
  await switching.catch(() => {})
  expect(runtime.current.catalog.map(model => model.info.id)).toEqual(['B1', 'B2'])
})

test('test_line_generation_09 spec Scenario "编辑非生效线路不换目录"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  b.handlers.set('GET /v1/models', models(['chat']))
  const other = await unreachableBaseUrl()
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, other)], async host => host === new URL(a.baseUrl).hostname)
  await runtime.start()
  const previous = runtime.current
  const response = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
    { id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' },
  ] })
  expect(response.status).toBe(200)
  expect(runtime.current).toBe(previous)
  expect(runtime.current.catalog).toHaveLength(1)
  expect(a.requests).toHaveLength(1)
})

test('test_line_generation_10 spec Scenario "删除生效线路后换线路并保留目录"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(Array.from({ length: 13 }, (_, index) => `m${index}`)))
  b.handlers.set('GET /v1/models', models(['B1']))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === portOf(a.baseUrl))
  await runtime.start()
  expect(runtime.current.catalog).toHaveLength(13)
  const response = await runtime.settings({ lines: [{ id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' }] })
  expect(response.status).toBe(200)
  expect(runtime.current.lineId).toBe(LINE_ID_2)
  expect(runtime.current.catalog.map(model => model.info.id)).toEqual(['B1'])
})

test('test_line_generation_11 spec Scenario "非生效线路外部凭据变化不换代"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  const { runtime, credentials } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, await unreachableBaseUrl())], async (_host, port) => port === portOf(a.baseUrl))
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  await runtime.start()
  const previous = runtime.current
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2-rotated')
  runtime.invalidateCredential(refs(LINE_ID_2).key)
  expect(runtime.current).toBe(previous)
  expect(runtime.current.catalog).toHaveLength(1)
})

test('test_line_generation_12 spec Scenario "随机 id 生效线路的外部凭据事件触发换代"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(['chat']))
  b.handlers.set('GET /v1/models', models(['chat']))
  const { runtime, credentials } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === portOf(b.baseUrl))
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  await runtime.start()
  expect(runtime.current.lineId).toBe(LINE_ID_2)
  const previous = runtime.current
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2-rotated')
  runtime.invalidateCredential(refs(LINE_ID_2).key)
  expect(runtime.current).not.toBe(previous)
  await runtime.syncCatalog()
  expect(b.requests.at(-1)?.headers.authorization).toBe('Bearer K2-rotated')
})

test('test_line_generation_13 spec Scenario "切换后同步失败保留继承目录"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', models(Array.from({ length: 13 }, (_, index) => `m${index}`)))
  b.handlers.set('GET /v1/models', json({}, 503))
  let activePort = portOf(a.baseUrl)
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === activePort)
  await runtime.start()
  const syncedAt = runtime.current.lastSyncAt
  activePort = portOf(b.baseUrl)
  runtime.selector.invalidate()
  await runtime.syncCatalog()
  expect(runtime.current.catalog).toHaveLength(13)
  expect(runtime.current.lastSyncAt).toBe(syncedAt)
  expect(runtime.current.lastSyncError).toBeTruthy()
  const op = await runtime.beginOperation()
  try { expect(op.baseUrl).toBe(b.baseUrl) } finally { op.release() }
})
