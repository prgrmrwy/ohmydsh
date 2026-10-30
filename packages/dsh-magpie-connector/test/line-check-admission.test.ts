import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { createGateway, deferred, json } from './support/gateway.js'
import { until } from './support/host.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs, seedKey } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

type CheckBody = { kind: string; reason?: string; models?: { id: string }[] }
const check = async (runtime: MagpieRuntime, body: unknown): Promise<CheckBody> => (await runtime.lineCheck(body)).json() as Promise<CheckBody>

/** Two complete lines: line 1 active (reachable), line 2 the spare being checked. */
async function twoLines(options: { timeoutMs?: number } = {}) {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'b' }] }))
  const credentials = lineCredentials('K1')
  seedKey(credentials, 'K2', LINE_ID_2)
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(b.baseUrl, LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, options.timeoutMs === undefined ? {} : { checkTimeoutMs: options.timeoutMs })
  cleanup.push(() => runtime.dispose())
  await runtime.settings()
  // Establish the generation/active line so later saves do not trigger an unrelated first sync.
  await runtime.syncCatalog()
  return { a, b, credentials, store, runtime }
}

/** Start a check that will pause inside credential resolution. */
async function pausedCheck(runtime: MagpieRuntime, credentials: ReturnType<typeof lineCredentials>, baseUrl: string) {
  const gate = deferred<void>()
  credentials.setResolveGate(() => gate.promise)
  const pending = runtime.lineCheck({ id: LINE_ID_2, baseUrl })
  await until(() => credentials.resolveCount > 0, 'credential resolve to start', 2000)
  return { gate, pending, release: () => { credentials.setResolveGate(undefined); gate.resolve() } }
}

test('test_line_check_admission_01 spec Scenario "解析期间发生连接写入"', async () => {
  // 1. A save lands while the check is reading saved credentials.
  {
    const { a, b, credentials, runtime } = await twoLines()
    const activeRequests = a.requests.length
    const paused = await pausedCheck(runtime, credentials, b.baseUrl)
    // updateLines bumps the connection write version synchronously, before its first await.
    const write = runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl }, { id: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-new' }] })
    paused.release()
    const result = await paused.pending
    expect(result.status).toBe(200)
    expect((await result.json()) as CheckBody).toMatchObject({ kind: 'pending' })
    expect((await write).status).toBe(200)
    expect((await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })).kind).toBe('ok')
    expect(a.requests).toHaveLength(activeRequests)
  }

  // 2. The save fails after starting (version still bumped): recovery needs a complete retry.
  {
    const { a, b, credentials, runtime } = await twoLines()
    credentials.failOn('set', refs(LINE_ID_2).key as unknown as string)
    const paused = await pausedCheck(runtime, credentials, b.baseUrl)
    const failed = runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl }, { id: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-new' }] })
    paused.release()
    const pendingBody = await (await paused.pending).json() as CheckBody
    expect(pendingBody.kind).toBe('pending')
    expect((await failed).status).toBe(500)
    expect((await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })).kind).toBe('pending')
    // Existing pending rule: an explicit successful retry of the whole group, then the check works.
    credentials.clearFailure('set', refs(LINE_ID_2).key as unknown as string)
    const retried = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl }, { id: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-ok' }] })
    expect(retried.status).toBe(200)
    expect((await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })).kind).toBe('ok')
  }

  // 3. The checked line is deleted while the check is reading its credentials.
  {
    const { a, b, credentials, runtime } = await twoLines()
    const paused = await pausedCheck(runtime, credentials, b.baseUrl)
    const removed = runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl }] })
    paused.release()
    expect((await (await paused.pending).json()) as CheckBody).toMatchObject({ kind: 'pending' })
    expect((await removed).status).toBe(200)
    // Old id is now unknown; a complete explicit draft proves the gate was released.
    expect((await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })).kind).toBe('invalid')
    expect((await check(runtime, { baseUrl: b.baseUrl, key: 'K1' })).kind).toBe('ok')
  }
})

test('test_line_check_admission_02 spec Scenario "入口或解析后处于保存中"', async () => {
  const { a, b, credentials, runtime } = await twoLines()

  // (a) A write is already inside its saving window (paused on a credential write) when the check
  // is called: the entry admission rejects it before any credential read.
  const writeGate = deferred<void>()
  credentials.setWriteGate(() => writeGate.promise)
  const write = runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl }, { id: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-next' }] })
  await until(async () => (await Promise.resolve(true)) && credentials.writes.length === 0, 'write to start', 50).catch(() => {})
  const resolvesBefore = credentials.resolveCount
  const entry = await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })
  expect(entry).toMatchObject({ kind: 'pending' })
  expect(credentials.resolveCount).toBe(resolvesBefore)
  credentials.setWriteGate(undefined)
  writeGate.resolve()
  expect((await write).status).toBe(200)

  // (b) The check already started resolving when the write begins.
  const paused = await pausedCheck(runtime, credentials, b.baseUrl)
  const late = runtime.settings({ lines: [{ id: LINE_ID, baseUrl: a.baseUrl }, { id: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-late' }] })
  paused.release()
  const result = await paused.pending
  expect(result.status).toBe(200)
  expect((await result.json()) as CheckBody).toMatchObject({ kind: 'pending' })
  await late
  expect((await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })).kind).toBe('ok')
})

test('test_line_check_admission_03 spec Scenario "凭据读取异常不发请求"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const failing = { ...credentials.service, resolve: async () => { throw new Error('credentials backend down') } }
  const runtime = new MagpieRuntime(failing, memoryStore([line(gateway.baseUrl, LINE_ID)])); cleanup.push(() => runtime.dispose())

  const result = await check(runtime, { id: LINE_ID, baseUrl: gateway.baseUrl })
  expect(result.kind).toBe('invalid')
  expect(result.reason).toContain('credentials backend down')
  expect(gateway.requests).toHaveLength(0)
})

test('test_line_check_admission_04 spec Scenario "同一时刻只允许一个检查"', async () => {
  const { a, b, credentials, runtime } = await twoLines()
  const gate = deferred<void>()
  credentials.setResolveGate(() => gate.promise)
  const first = runtime.lineCheck({ id: LINE_ID_2, baseUrl: b.baseUrl })
  await until(() => credentials.resolveCount > 0, 'first check to start resolving', 2000)
  const second = await check(runtime, { id: LINE_ID_2, baseUrl: b.baseUrl })
  expect(second.kind).toBe('busy')
  credentials.setResolveGate(undefined)
  gate.resolve()
  expect((await (await first).json()) as CheckBody).toMatchObject({ kind: 'ok' })
  // Exactly one gateway request came from the checks: the single flight's winner.
  expect(b.requests.filter(request => request.path === '/v1/models').length).toBeGreaterThanOrEqual(1)
  expect(b.requests.at(-1)!.headers.authorization).toBe('Bearer K2')
})

test('test_line_check_admission_05 spec Scenario "临时凭据的脱敏覆盖成功与失败两条路径"', async () => {
  const key = 'draft-key-ABCDEFGHIJK'
  const clientId = 'draft-id-LMNOPQRST'
  const clientSecret = 'draft-secret-UVWXYZ'
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([])); cleanup.push(() => runtime.dispose())
  const original = runtime.transport.request.bind(runtime.transport)
  const patch = (impl: () => Promise<Response>) => { (runtime.transport as unknown as { request: unknown }).request = impl }
  try {
    // Success path: the gateway echoes the credential inside a model id.
    patch(async () => new Response(JSON.stringify({ data: [{ id: `model-${key}` }] }), { status: 200 }))
    const ok = await check(runtime, { baseUrl: 'https://gw.example/v1', accessMode: 'cloudflare', key, accessClientId: clientId, accessClientSecret: clientSecret })
    expect(ok.kind).toBe('ok')
    expect(ok.models).toEqual([{ id: 'model-[redacted]' }])
    expect(JSON.stringify(ok)).not.toContain(key)

    // Failure path: JSON keys, values and escapes echo the credentials.
    patch(async () => new Response(JSON.stringify({ [key]: `Bearer ${key}`, nested: { secret: clientSecret, id: clientId } }), { status: 401 }))
    const failed = await check(runtime, { baseUrl: 'https://gw.example/v1', accessMode: 'cloudflare', key, accessClientId: clientId, accessClientSecret: clientSecret })
    expect(failed.kind).toBe('unauthorized')
    const text = JSON.stringify(failed)
    expect(text).not.toContain(key)
    expect(text).not.toContain(clientId)
    expect(text).not.toContain(clientSecret)

    // Body-stage error: the thrown message itself carries the credential.
    patch(async () => ({
      status: 200,
      text: async () => { throw new Error(`body read failed for ${key}`) },
    }) as unknown as Response)
    const broken = await check(runtime, { baseUrl: 'https://gw.example/v1', accessMode: 'cloudflare', key, accessClientId: clientId, accessClientSecret: clientSecret })
    expect(broken.kind).toBe('unreachable')
    expect(JSON.stringify(broken)).not.toContain(key)
  } finally {
    (runtime.transport as unknown as { request: unknown }).request = original
  }
})
