import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime, CHECK_TIMEOUT_MS } from '../src/host/runtime.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'
import { LINE_ID, line, lineCredentials, memoryStore } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

type CheckBody = { kind: string; gatewayStatus?: number; reason?: string; latencyMs: number; modelCount?: number; models?: { id: string }[]; testedAt: string }
const check = async (runtime: MagpieRuntime, body: unknown): Promise<{ status: number; body: CheckBody }> => {
  const response = await runtime.lineCheck(body)
  return { status: response.status, body: await response.json() as CheckBody }
}
/** Reply that sends headers then destroys the socket mid-body. */
const truncated = () => (res: import('node:http').ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.write('{"data":[')
  setTimeout(() => res.destroy(), 5)
}
/** Reply that keeps the body open until the client gives up. */
const hanging = (status = 200) => (res: import('node:http').ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.write(status === 200 ? '{"data":[' : 'x'.repeat(10))
}

test('test_line_check_01 spec Scenario "检查未生效的草稿线路返回快照且不改变任何状态"', async () => {
  const active = await createGateway(), draft = await createGateway(); cleanup.push(active.close, draft.close)
  active.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  draft.handlers.set('GET /v1/models', json({ data: [{ id: 'm1' }, { id: 'm2' }] }))
  const credentials = lineCredentials('K1')
  const published: unknown[] = []
  const store = memoryStore([line(active.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store, routes => { published.push(routes) }); cleanup.push(() => runtime.dispose())
  await runtime.settings()
  const before = { current: runtime.current, selected: runtime.selectedLineId, store: JSON.stringify(store.value), published: published.length }
  expect(CHECK_TIMEOUT_MS).toBe(5000)

  const result = await check(runtime, { baseUrl: draft.baseUrl, key: 'K-draft' })
  expect(result.status).toBe(200)
  expect(result.body.kind).toBe('ok')
  expect(result.body.modelCount).toBe(2)
  expect(result.body.models).toEqual([{ id: 'm1' }, { id: 'm2' }])
  expect(result.body.testedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(typeof result.body.latencyMs).toBe('number')

  expect(runtime.current).toBe(before.current)
  expect(runtime.selectedLineId).toBe(before.selected)
  expect(JSON.stringify(store.value)).toBe(before.store)
  expect(published).toHaveLength(before.published)
  expect(active.requests).toHaveLength(0)
})

test('test_line_check_02 spec Scenario "连接阶段失败归入 unreachable"', async () => {
  const closed = await unreachableBaseUrl()
  const plain = await createGateway(); cleanup.push(plain.close)
  plain.handlers.set('GET /v1/models', json({ data: [] }))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([])); cleanup.push(() => runtime.dispose())

  const refused = await check(runtime, { baseUrl: closed, key: 'K1' })
  expect(refused.status).toBe(200)
  expect(refused.body.kind).toBe('unreachable')
  expect(refused.body.gatewayStatus).toBeUndefined()
  expect(refused.body.reason).toBeTruthy()

  // TLS against a plain-HTTP listener fails the handshake, not the HTTP layer.
  const tls = await check(runtime, { baseUrl: plain.baseUrl.replace('http://', 'https://'), key: 'K1' })
  expect(tls.body.kind).toBe('unreachable')
  expect(plain.requests).toHaveLength(0)
})

test('test_line_check_03 spec Scenario "网关非 2xx 按状态分类"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ error: 'nope' }, 401))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([])); cleanup.push(() => runtime.dispose())
  const unauthorized = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(unauthorized.body.kind).toBe('unauthorized')
  expect(unauthorized.body.gatewayStatus).toBe(401)

  gateway.handlers.set('GET /v1/models', json({ error: 'nope' }, 403))
  const forbidden = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(forbidden.body.kind).toBe('forbidden')
  expect(forbidden.body.gatewayStatus).toBe(403)

  gateway.handlers.set('GET /v1/models', json({ error: 'boom' }, 503))
  const http = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(http.body.kind).toBe('http')
  expect(http.body.gatewayStatus).toBe(503)
})

test('test_line_check_04 spec Scenario "3xx 不跟随并按状态归 redirect"', async () => {
  const source = await createGateway(), foreign = await createGateway(); cleanup.push(source.close, foreign.close)
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([])); cleanup.push(() => runtime.dispose())

  // 307 to another origin.
  source.handlers.set('GET /v1/models', res => { res.writeHead(307, { location: `${foreign.baseUrl}/models` }); res.end() })
  expect((await check(runtime, { baseUrl: source.baseUrl, key: 'K1' })).body.kind).toBe('redirect')
  expect(foreign.requests).toHaveLength(0)

  // 307 to the same origin but a non-whitelisted path.
  source.handlers.set('GET /v1/models', res => { res.writeHead(307, { location: '/api/usage' }); res.end() })
  expect((await check(runtime, { baseUrl: source.baseUrl, key: 'K1' })).body.kind).toBe('redirect')
  expect(source.requests.filter(request => request.path === '/api/usage')).toHaveLength(0)

  // 304 / 300 come back as responses (no redirect handling in undici for those statuses).
  for (const status of [304, 300]) {
    source.handlers.set('GET /v1/models', res => { res.writeHead(status); res.end() })
    const before = source.requests.length
    const result = await check(runtime, { baseUrl: source.baseUrl, key: 'K1' })
    expect(result.body.kind).toBe('redirect')
    const after = source.requests.slice(before)
    expect(after).toHaveLength(1)
    expect(after[0]!.path).toBe('/v1/models')
  }
  // Four checks in total, one request each, never a follow-up.
  expect(source.requests.filter(request => request.path === '/v1/models')).toHaveLength(4)
})

test('test_line_check_05 spec Scenario "2xx 的 body 读取失败与预算耗尽"', async () => {
  const gateway = await createGateway(), healthy = await createGateway(); cleanup.push(gateway.close, healthy.close)
  healthy.handlers.set('GET /v1/models', json({ data: [] }))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([]), () => {}, { checkTimeoutMs: 80 }); cleanup.push(() => runtime.dispose())

  gateway.handlers.set('GET /v1/models', truncated())
  const broken = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(broken.body.kind).toBe('unreachable')
  expect(gateway.requests.filter(request => request.path === '/v1/models')).toHaveLength(1)

  gateway.handlers.set('GET /v1/models', hanging())
  const timedOut = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(timedOut.body.kind).toBe('timeout')
  expect(timedOut.body.latencyMs).toBeLessThan(2000)
  // The gate is released: a healthy check right after succeeds.
  expect((await check(runtime, { baseUrl: healthy.baseUrl, key: 'K1' })).body.kind).toBe('ok')
})

test('test_line_check_06 spec Scenario "2xx body 的解码结果分类"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([])); cleanup.push(() => runtime.dispose())

  gateway.handlers.set('GET /v1/models', json('<html>not json</html>'))
  const html = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(html.body.kind).toBe('invalid-catalog')
  expect(html.body.modelCount).toBeUndefined()

  gateway.handlers.set('GET /v1/models', json({ data: {} }))
  expect((await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })).body.kind).toBe('invalid-catalog')

  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const empty = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(empty.body.kind).toBe('ok')
  expect(empty.body.modelCount).toBe(0)
  expect(empty.body.models).toEqual([])
})

test('test_line_check_07 spec Scenario "状态优先于错误 body 超时"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', hanging(403))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([]), () => {}, { checkTimeoutMs: 80 }); cleanup.push(() => runtime.dispose())

  const result = await check(runtime, { baseUrl: gateway.baseUrl, key: 'K1' })
  expect(result.body.kind).toBe('forbidden')
  expect(result.body.gatewayStatus).toBe(403)
  expect(result.body.reason).toContain('错误 body 未完整读取')
})

test('test_line_check_08 spec Scenario "reason 先脱敏再截断"', async () => {
  const secret = 'secret-ABCDEFGHIJK0123456789'
  const payload = 'x'.repeat(290) + secret + 'y'.repeat(30)
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', res => { res.writeHead(401, { 'content-type': 'text/plain' }); res.end(payload) })
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([])); cleanup.push(() => runtime.dispose())

  const result = await check(runtime, { baseUrl: gateway.baseUrl, key: secret })
  expect(result.body.kind).toBe('unauthorized')
  expect(result.body.reason).toBe('x'.repeat(290) + '[redacted]')
  expect(result.body.reason!.length).toBe(300)
  expect(result.body.reason).not.toContain(secret)
  // Truncate-then-redact would leave this prefix behind.
  expect(result.body.reason).not.toContain('secret-ABC')
})
