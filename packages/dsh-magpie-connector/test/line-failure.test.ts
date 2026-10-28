import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import type { LineSettings } from '../src/host/settings.js'
import type { Probe } from '../src/host/selection.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line } from './support/line.js'
import { createGateway, json } from './support/gateway.js'
import { chatText } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const entry of cleanup.splice(0).reverse()) await entry() })
const direct = (id: string, baseUrl: string): LineSettings => line(baseUrl, id, 'direct')
const portOf = (baseUrl: string) => Number(new URL(baseUrl).port)
const sse = (events: unknown[]) => events.map(event => typeof event === 'string' ? `data: ${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`).join('')

async function setup(lines: LineSettings[], probe?: Probe) {
  const credentials = credentialsMock('K1')
  for (const entry of lines) if (entry.id !== LINE_ID) credentials.setRef(lineCredentialRefs(entry.id).key as unknown as string, entry.id === LINE_ID_2 ? 'K2' : 'K3')
  const store = new SettingsStore()
  store.value.lines = lines;
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, probe ? { probe } : {})
  cleanup.push(() => runtime.dispose())
  return { runtime, credentials, store }
}
async function collect(runtime: MagpieRuntime, model = 'chat') {
  const adapter = new MagpieAdapter(runtime)
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'dsh-magpie-connector', model, messages: [] })) chunks.push(chunk)
  return chunks
}

test('test_line_failure_01 spec Scenario "连接阶段失败只失效缓存且不重放"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'chat' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'chat' }] }))
  let activePort = portOf(a.baseUrl)
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === activePort)
  await runtime.start()
  await a.close()
  const chunks = await collect(runtime)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } } })
  expect(b.requests).toHaveLength(0)
  activePort = portOf(b.baseUrl)
  await runtime.syncCatalog()
  expect(runtime.current.lineId).toBe(LINE_ID_2)
})

test('test_line_failure_02 spec Scenario "连接阶段失败后下一次操作改用备用线路并成功"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'chat' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'chat' }] }))
  let activePort = portOf(a.baseUrl)
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === activePort)
  await runtime.start()
  await a.close()
  expect((await collect(runtime)).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  activePort = portOf(b.baseUrl)
  await runtime.syncCatalog()
  vi.spyOn(runtime.transport, 'fetchFor').mockImplementation(() => async () => new Response(sse(chatText('hi')), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  const chunks = await collect(runtime)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(b.requests.map(request => request.path)).toEqual(['/v1/models'])
})

test('test_line_failure_03 spec Scenario "非连接阶段失败不重放"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'chat' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'chat' }] }))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === portOf(a.baseUrl))
  await runtime.start()
  const calls: unknown[] = []
  vi.spyOn(runtime.transport, 'fetchFor').mockImplementation(identity => { calls.push(identity); return async () => new Response(sse([chatText('hi')[0]]), { status: 200, headers: { 'content-type': 'text/event-stream' } }) })
  const chunks = await collect(runtime)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } } })
  expect(calls).toHaveLength(1)
  expect(b.requests).toHaveLength(0)
})

test('test_line_failure_04 spec Scenario "TCP 可达但网关报错时不自动换线"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({}, 503))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'b' }] }))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === portOf(a.baseUrl))
  await runtime.start()
  expect(runtime.current.lineId).toBe(LINE_ID)
  expect(runtime.current.lastSyncErrorKind).toBe('http')
  expect(b.requests).toHaveLength(0)
  const view = await (await runtime.settings()).json() as { activeLineId: string | null }
  expect(view.activeLineId).toBe(LINE_ID)
})
