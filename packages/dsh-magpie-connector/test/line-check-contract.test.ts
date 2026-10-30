import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import type { ConnectionIdentity } from '../src/host/transport.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, seedAccess, seedKey } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

type CheckBody = { kind: string; reason?: string; modelCount?: number }
const check = async (runtime: MagpieRuntime, body: unknown): Promise<{ status: number; body: CheckBody }> => {
  const response = await runtime.lineCheck(body)
  return { status: response.status, body: await response.json() as CheckBody }
}

test('test_line_check_contract_01 spec Scenario "请求形状非法返回 400"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(gateway.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store); cleanup.push(() => runtime.dispose())
  const A = gateway.baseUrl, K = 'K1'
  const inputs: unknown[] = [
    { id: '', baseUrl: A, key: K },
    { id: 42, baseUrl: A },
    {},
    { baseUrl: 42 },
    { baseUrl: A, accessMode: 42 },
    { baseUrl: A, accessMode: 'proxy' },
    { baseUrl: A, accessMode: '' },
    { baseUrl: A, key: 42 },
    { baseUrl: A, key: null },
    { baseUrl: A, accessClientId: 42 },
    { baseUrl: A, accessClientId: null },
    { baseUrl: A, accessClientSecret: 42 },
    { baseUrl: A, accessClientSecret: null },
    { baseUrl: A, unknownKey: 1 },
  ]
  for (const input of inputs) {
    const result = await check(runtime, input)
    expect(result.status, JSON.stringify(input)).toBe(400)
  }
  expect(credentials.resolveCount).toBe(0)
  expect(gateway.requests).toHaveLength(0)
})

test('test_line_check_contract_02 spec Scenario "值非法归入 invalid"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  seedKey(credentials, 'K2', LINE_ID_2)
  seedAccess(credentials, LINE_ID_2, 'I2', 'S2')
  const store = memoryStore([line(gateway.baseUrl, LINE_ID), line('https://magpie.example/v1', LINE_ID_2, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store); cleanup.push(() => runtime.dispose())
  const A = gateway.baseUrl, C = 'https://magpie.example/v1'
  const inputs: unknown[] = [
    { id: LINE_ID, baseUrl: 'ftp://gw/v1' },
    { id: LINE_ID, baseUrl: 'https://gw' },
    { id: LINE_ID, baseUrl: 'https://u:p@gw/v1' },
    { accessMode: 'direct', baseUrl: A, accessClientId: 'I' },
    { id: LINE_ID, baseUrl: A, key: 'bad key' },
    { id: LINE_ID_2, baseUrl: C, accessMode: 'cloudflare', accessClientId: 'bad id' },
    { id: LINE_ID_2, baseUrl: C, accessMode: 'cloudflare', accessClientSecret: 'bad secret' },
    { id: LINE_ID, baseUrl: A, key: 'a'.repeat(513) },
  ]
  for (const input of inputs) {
    const result = await check(runtime, input)
    expect(result.status, JSON.stringify(input)).toBe(200)
    expect(result.body.kind, JSON.stringify(input)).toBe('invalid')
  }
  expect(gateway.requests).toHaveLength(0)
})

test('test_line_check_contract_03 spec Scenario "草稿不完整一律 incomplete"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(gateway.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store); cleanup.push(() => runtime.dispose())
  const C = 'https://magpie.example/v1'
  const inputs: unknown[] = [
    { baseUrl: 'http://gw:3425/v1', accessMode: 'cloudflare', key: 'K2', accessClientId: 'I2', accessClientSecret: 'S2' },
    { baseUrl: C, accessMode: 'cloudflare', key: 'K2', accessClientId: 'I2' },
    { baseUrl: C, accessMode: 'cloudflare', key: 'K2', accessClientSecret: 'S2' },
    { baseUrl: C, accessMode: 'cloudflare', key: 'K2', accessClientId: '', accessClientSecret: 'S2' },
    { baseUrl: C, accessMode: 'cloudflare', key: 'K2', accessClientId: 'I2', accessClientSecret: '' },
    { id: LINE_ID, baseUrl: '' },
  ]
  for (const input of inputs) {
    const result = await check(runtime, input)
    expect(result.status, JSON.stringify(input)).toBe(200)
    expect(result.body.kind, JSON.stringify(input)).toBe('incomplete')
  }
  expect(gateway.requests).toHaveLength(0)
  expect(credentials.resolveCount).toBe(0)
})

test('test_line_check_contract_04 spec Scenario "凭据留空沿用保存值"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K')
  seedKey(credentials, 'K2', LINE_ID_2)
  seedAccess(credentials, LINE_ID_2, 'I2', 'S2')
  const store = memoryStore([line(gateway.baseUrl, LINE_ID), line('https://magpie.example/v1', LINE_ID_2, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store); cleanup.push(() => runtime.dispose())

  const omitted = await check(runtime, { id: LINE_ID, baseUrl: gateway.baseUrl })
  expect(omitted.body.kind).toBe('ok')
  expect(gateway.requests.at(-1)!.headers.authorization).toBe('Bearer K')
  expect(JSON.stringify(omitted.body)).not.toContain('Bearer K')

  const empty = await check(runtime, { id: LINE_ID, baseUrl: gateway.baseUrl, key: '' })
  expect(empty.body.kind).toBe('ok')
  expect(gateway.requests.at(-1)!.headers.authorization).toBe('Bearer K')

  // Cloudflare lines need https, so observe the resolved identity at the transport seam instead of
  // standing up a TLS server: only the identity shape matters for the fallback contract.
  const seen: ConnectionIdentity[] = []
  const original = runtime.transport.request.bind(runtime.transport)
  ;(runtime.transport as unknown as { request: unknown }).request = async (identity: ConnectionIdentity) => {
    seen.push(identity)
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const cloudflare = await check(runtime, { id: LINE_ID_2, baseUrl: 'https://magpie.example/v1', accessMode: 'cloudflare' })
    expect(cloudflare.body.kind).toBe('ok')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.key).toBe('K2')
    expect(seen[0]!.accessClientId).toBe('I2')
    expect(seen[0]!.accessClientSecret).toBe('S2')
  } finally {
    ;(runtime.transport as unknown as { request: unknown }).request = original
  }
})

test('test_line_check_contract_05 spec Scenario "无 id 的草稿只用显式字段"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const runtime = new MagpieRuntime(credentials.service, memoryStore([line(gateway.baseUrl, LINE_ID)])); cleanup.push(() => runtime.dispose())

  const result = await check(runtime, { baseUrl: gateway.baseUrl })
  expect(result.status).toBe(200)
  expect(result.body.kind).toBe('incomplete')
  expect(credentials.resolveCount).toBe(0)
  expect(gateway.requests).toHaveLength(0)
})

test('test_line_check_contract_06 spec Scenario "未知或未提交的线路 id"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const runtime = new MagpieRuntime(credentials.service, memoryStore([line(gateway.baseUrl, LINE_ID)])); cleanup.push(() => runtime.dispose())

  const unknown = await check(runtime, { id: 'deadbeef', baseUrl: gateway.baseUrl, key: 'K1' })
  expect(unknown.status).toBe(200)
  expect(unknown.body.kind).toBe('invalid')

  const malformed = await check(runtime, { id: 'not-hex', baseUrl: gateway.baseUrl, key: 'K1' })
  expect(malformed.status).toBe(400)

  expect(credentials.resolveCount).toBe(0)
  expect(gateway.requests).toHaveLength(0)
})
