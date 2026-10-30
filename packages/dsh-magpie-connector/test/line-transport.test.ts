import { afterEach, expect, test, vi } from 'vitest'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import type { Probe } from '../src/host/selection.js'
import { LatencyController } from '../src/host/latency.js'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import type { LineSettings } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line } from './support/line.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const entry of cleanup.splice(0).reverse()) await entry() })
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

test('test_line_transport_01 spec Scenario "完整流程只触达白名单"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  for (const path of ['/v1/models', '/v1/magpie/quotas/cards']) gateway.handlers.set(`GET ${path}`, json({ data: [] }))
  for (const path of ['/v1/responses', '/v1/chat/completions', '/v1/magpie/quotas/refresh']) gateway.handlers.set(`POST ${path}`, json({ data: [] }))
  const { runtime } = await setup([direct(LINE_ID, gateway.baseUrl)])
  const op = await runtime.beginOperation()
  try {
    for (const [method, path] of [['GET', '/models'], ['POST', '/responses'], ['POST', '/chat/completions'], ['GET', '/magpie/quotas/cards'], ['POST', '/magpie/quotas/refresh']] as const) await runtime.transport.request(op, method, path)
  } finally { op.release() }
  expect(new Set(gateway.requests.map(request => `${request.method} ${request.path}`))).toEqual(new Set(['GET /v1/models', 'POST /v1/responses', 'POST /v1/chat/completions', 'GET /v1/magpie/quotas/cards', 'POST /v1/magpie/quotas/refresh']))
  expect(gateway.requests.every(request => !request.path.startsWith('/api/'))).toBe(true)
})

test('test_line_transport_02 spec Scenario "重定向不被跟随"', async () => {
  const gateway = await createGateway(), other = await createGateway(); cleanup.push(gateway.close, other.close)
  gateway.handlers.set('GET /v1/models', (res) => { res.writeHead(307, { location: other.baseUrl + '/models' }); res.end() })
  const { runtime } = await setup([direct(LINE_ID, gateway.baseUrl)])
  await runtime.syncCatalog()
  expect(runtime.current.lastSyncError).toBeTruthy()
  expect(other.requests).toHaveLength(0)
})

test('test_line_transport_03 spec Scenario "存在全局代理时仍直连"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const original = getGlobalDispatcher()
  const proxy = new MockAgent(); proxy.disableNetConnect()
  setGlobalDispatcher(proxy)
  cleanup.push(async () => { setGlobalDispatcher(original); await proxy.close() })
  const { runtime } = await setup([direct(LINE_ID, gateway.baseUrl)])
  await runtime.syncCatalog()
  expect(gateway.requests.filter(request => request.path === '/v1/models')).toHaveLength(1)
})

test('test_line_transport_04 spec Scenario "多线路时只触达生效线路 origin"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'b' }] }))
  b.handlers.set('GET /v1/magpie/quotas/cards', json({ data: [] }))
  const { runtime } = await setup([direct(LINE_ID, a.baseUrl), direct(LINE_ID_2, b.baseUrl)], async (_host, port) => port === portOf(b.baseUrl))
  await runtime.start()
  const op = await runtime.beginOperation()
  try { await runtime.transport.request(op, 'GET', '/magpie/quotas/cards') } finally { op.release() }
  expect(a.requests).toHaveLength(0)
  expect(b.requests.map(request => request.path)).toEqual(['/v1/models', '/v1/magpie/quotas/cards'])
})

test('test_line_transport_05 spec Scenario "明文 http 线路不携带 Access 头"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  gateway.handlers.set('GET /v1/magpie/quotas/cards', json({ data: [] }))
  const { runtime, credentials } = await setup([direct(LINE_ID, gateway.baseUrl), { id: LINE_ID_2, baseUrl: 'https://other.invalid/v1', accessMode: 'cloudflare' }])
  credentials.setRef(lineCredentialRefs(LINE_ID_2).accessClientId as unknown as string, 'cf-id')
  credentials.setRef(lineCredentialRefs(LINE_ID_2).accessClientSecret as unknown as string, 'cf-secret')
  await runtime.start()
  const op = await runtime.beginOperation()
  try { await runtime.transport.request(op, 'GET', '/magpie/quotas/cards') } finally { op.release() }
  for (const request of gateway.requests) {
    expect(request.headers['cf-access-client-id']).toBeUndefined()
    expect(request.headers['cf-access-client-secret']).toBeUndefined()
  }
})

test('test_line_transport_06 spec Scenario "探测只建 TCP 连接不发 HTTP"', async () => {
  const reachable = await createGateway(), skipped = await createGateway(), keyless = await createGateway(); cleanup.push(reachable.close, skipped.close, keyless.close)
  reachable.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const probes: { host: string; port: number }[] = []
  const { runtime } = await setup([
    direct(LINE_ID, reachable.baseUrl),
    direct(LINE_ID_2, skipped.baseUrl),
    direct('0badf00d', keyless.baseUrl),
  ], async (host, port) => { probes.push({ host, port }); return port === portOf(reachable.baseUrl) })
  await runtime.start()
  expect(probes.length).toBeGreaterThan(0)
  expect(probes[0]!.port).toBe(portOf(reachable.baseUrl))
  // Settings-page measurement also connects the key-less but parseable line, over TCP only.
  const latency = new LatencyController(() => runtime.config())
  cleanup.push(async () => latency.dispose())
  const measured = await (await latency.read()).json() as { lines: { id: string; ms: number | null }[] }
  expect(measured.lines.map(entry => entry.id).sort()).toEqual([LINE_ID, LINE_ID_2, '0badf00d'].sort())
  expect(reachable.requests.map(request => request.path)).toEqual(['/v1/models'])
  expect(skipped.requests).toHaveLength(0)
  expect(keyless.requests).toHaveLength(0)
  expect([...probes.map(entry => entry.port), ...measured.lines.map(() => 0)].length).toBeGreaterThan(0)
})
