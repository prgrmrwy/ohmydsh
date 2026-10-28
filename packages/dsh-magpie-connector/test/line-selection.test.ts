import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import type { LineSettings } from '../src/host/settings.js'
import type { Probe } from '../src/host/selection.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line } from './support/line.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const direct = (id: string, baseUrl: string): LineSettings => line(baseUrl, id, 'direct')
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

test('test_line_selection_01 spec Scenario "单线路直接使用且不探测"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const probes: string[] = []
  const { runtime } = await setup([direct(LINE_ID, gateway.baseUrl)], async host => { probes.push(host); return true })
  await runtime.start()
  expect(probes).toEqual([])
  expect(runtime.current.lineId).toBe(LINE_ID)
  expect(gateway.requests).toHaveLength(1)
})

test('test_line_selection_02 spec Scenario "序号 1 可达时使用序号 1"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  b.handlers.set('GET /v1/models', json({ data: [] }))
  const probes: number[] = []
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => { probes.push(port); return port === portOf(a.baseUrl) })
  await runtime.start()
  expect(runtime.current.lineId).toBe(LINE_ID)
  expect(probes).toEqual([portOf(a.baseUrl)])
  expect(b.requests).toHaveLength(0)
})

test('test_line_selection_03 spec Scenario "序号 1 不可达时自动使用序号 2"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  b.handlers.set('GET /v1/models', json({ data: [] }))
  const probes: number[] = []
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => { probes.push(port); return port === portOf(b.baseUrl) })
  await runtime.start()
  expect(runtime.current.lineId).toBe(LINE_ID_2)
  expect(probes).toEqual([portOf(a.baseUrl), portOf(b.baseUrl)])
  expect(a.requests).toHaveLength(0)
  expect(b.requests.map(request => request.path)).toEqual(['/v1/models'])
})

test('test_line_selection_04 spec Scenario "全部不可达时用序号 1 并上抛真实错误"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({}, 503))
  b.handlers.set('GET /v1/models', json({ data: [] }))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async () => false)
  await runtime.start()
  expect(runtime.current.lineId).toBe(LINE_ID)
  expect(a.requests.map(request => request.path)).toEqual(['/v1/models'])
  expect(b.requests).toHaveLength(0)
  expect(runtime.current.lastSyncErrorKind).toBe('http')
  expect(runtime.current.catalog).toEqual([])
  void unreachableBaseUrl
})
