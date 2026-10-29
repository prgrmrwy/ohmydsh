import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs, seedAccess, seedKey } from './support/line.js'
import { SettingsStore } from '../src/host/settings.js'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const entry of cleanup.splice(0).reverse()) await entry() })
const LINE_3 = '0badf00d'

test('test_line_connection_01 spec Scenario "保存 key 后不回显"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const credentials = lineCredentials(undefined)
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const saved = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'mk-test-123' }] })
  expect(saved.status).toBe(200)
  const view = await (await runtime.settings()).json() as { lines: { key: { configured: boolean; writable: boolean } }[] }
  expect(view.lines[0]?.key).toEqual({ configured: true, writable: true })
  const text = await (await runtime.settings()).text()
  expect(text).not.toContain('mk-test-123')
  expect(JSON.stringify(store.value)).not.toContain('mk-test-123')
})

test('test_line_connection_02 spec Scenario "网关反射的 key 被脱敏"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', (res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid Bearer mk-1 and mk-2' })) })
  const credentials = lineCredentials('mk-1')
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'mk-2')
  const store = memoryStore([line(gateway.baseUrl, LINE_ID), line(await unreachableBaseUrl(), LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async (_host, port) => port === Number(new URL(gateway.baseUrl).port) })
  cleanup.push(() => runtime.dispose())
  await runtime.start()
  expect(runtime.current.lastSyncErrorKind).toBe('unauthorized')
  expect(runtime.current.lastSyncError).toContain('[redacted]')
  const text = await (await runtime.settings()).text()
  expect(text).not.toContain('mk-1'); expect(text).not.toContain('mk-2')
})

test('test_line_connection_03 spec Scenario "环境提供的 key 拒绝修改"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = credentialsMock(undefined, true)
  seedKey(credentials, 'env-key'); credentials.markReadonly(refs().key as unknown as string)
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'replacement' }] })
  expect(response.status).toBe(409)
  expect(credentials.writes).toEqual([])
  expect(credentials.values.get(refs().key as unknown as string)).toBe('env-key')
})

test('test_line_connection_04 spec Scenario "非法设置输入被拒绝"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const snapshot = JSON.stringify(store.value)
  for (const body of [
    { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct', key: '' }] },
    { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'bad key' }] },
    { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'x'.repeat(513) }] },
    { lines: [{ id: LINE_ID, baseUrl: 'ftp://host/v1', accessMode: 'direct' }] },
    { lines: [{ id: LINE_ID, baseUrl: 'http://u:p@host/v1', accessMode: 'direct' }] },
    { lines: [{ id: LINE_ID, baseUrl: 'http://host/v1?k=x', accessMode: 'direct' }] },
    { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }, { baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'K2' }] },
  ]) expect((await runtime.settings(body)).status).toBe(400)
  expect(credentials.writes).toEqual([])
  expect(JSON.stringify(store.value)).toBe(snapshot)
})

test('test_line_connection_05 spec Scenario "未配置时不提供模型且不发请求"', async () => {
  const credentials = lineCredentials(undefined)
  const store = memoryStore([])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const adapter = new MagpieAdapter(runtime)
  expect(await adapter.listModels('dsh-magpie-connector-other')).toEqual([])
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'dsh-magpie-connector', model: 'a', messages: [] })) chunks.push(chunk)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { message: expect.stringContaining('MAGPIE_NOT_CONFIGURED') } } })
})

test('test_line_connection_06 spec Scenario "请求不混用线路凭据"', async () => {
  const credentials = lineCredentials('K1')
  seedAccess(credentials, LINE_ID, 'cf-1', 'secret-1')
  seedKey(credentials, 'K2', LINE_ID_2)
  seedAccess(credentials, LINE_ID_2, 'cf-2', 'secret-2')
  const store = memoryStore([line(await unreachableBaseUrl(), LINE_ID), line('https://gateway.test/v1', LINE_ID_2, 'cloudflare')])
  void credentialsMock
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async host => host === 'gateway.test' })
  cleanup.push(() => runtime.dispose())
  const op = await runtime.beginOperation()
  try {
    expect(op.lineId).toBe(LINE_ID_2)
    expect(op.key).toBe('K2')
    expect(op.accessClientId).toBe('cf-2')
    expect(op.accessClientSecret).toBe('secret-2')
    const captured: { key?: string; accessClientId?: string; baseUrl?: string }[] = []
    vi.spyOn(runtime.transport, 'request').mockImplementation(async identity => { captured.push(identity); return Response.json({ data: [] }) })
    await runtime.transport.fetchFor(op)('https://gateway.test/v1/models')
    expect(captured[0]).toMatchObject({ key: 'K2', accessClientId: 'cf-2', baseUrl: 'https://gateway.test/v1' })
    expect(JSON.stringify(captured[0])).not.toContain('K1')
  } finally { op.release() }
})

test('test_line_connection_07 spec Scenario "删除线路只清可写凭据"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('K1')
  seedKey(credentials, 'K2', LINE_ID_2); seedAccess(credentials, LINE_ID_2, 'id2', 'secret2')
  seedKey(credentials, 'env-K3', LINE_3); seedAccess(credentials, LINE_3, 'env-id3', 'env-secret3')
  for (const field of ['key', 'accessClientId', 'accessClientSecret'] as const) credentials.markReadonly(refs(LINE_3)[field] as unknown as string)
  const store = memoryStore([
    line(gateway.baseUrl, LINE_ID),
    line('https://line2.invalid/v1', LINE_ID_2, 'cloudflare'),
    line('https://line3.invalid/v1', LINE_3, 'cloudflare'),
  ])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }] })
  expect(response.status).toBe(200)
  const view = await response.json() as { retainedCredentials: { lineId: string; field: string }[] }
  expect(view.retainedCredentials).toContainEqual({ lineId: LINE_3, field: 'key' })
  expect(view.retainedCredentials).toContainEqual({ lineId: LINE_3, field: 'accessClientId' })
  expect(view.retainedCredentials).toContainEqual({ lineId: LINE_3, field: 'accessClientSecret' })
  expect(credentials.values.get(refs(LINE_ID_2).key as unknown as string)).toBeUndefined()
  expect(credentials.values.get(refs(LINE_ID_2).accessClientId as unknown as string)).toBeUndefined()
  expect(credentials.values.get(refs(LINE_3).key as unknown as string)).toBe('env-K3')
})

test('test_line_connection_08 spec Scenario "整表重排不丢凭据"', async () => {
  const credentials = lineCredentials('K1')
  seedKey(credentials, 'K2', LINE_ID_2); seedAccess(credentials, LINE_ID_2)
  const store = memoryStore([line('http://a.test:1/v1', LINE_ID), line('https://b.test/v1', LINE_ID_2, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [
    { id: LINE_ID_2, baseUrl: 'https://b.test/v1', accessMode: 'cloudflare' },
    { id: LINE_ID, baseUrl: 'http://a.test:1/v1', accessMode: 'direct' },
  ] })
  expect(response.status).toBe(200)
  expect(credentials.values.get(refs().key as unknown as string)).toBe('K1')
  expect(credentials.values.get(refs(LINE_ID_2).key as unknown as string)).toBe('K2')
  expect(credentials.values.get(refs(LINE_ID_2).accessClientId as unknown as string)).toBe('cf-id')
  const view = await (await runtime.settings()).json() as { lines: { id: string; key: { configured: boolean }; access: { clientId: { configured: boolean } } }[] }
  expect(view.lines.find(entry => entry.id === LINE_ID)?.key.configured).toBe(true)
  expect(view.lines.find(entry => entry.id === LINE_ID_2)?.access.clientId.configured).toBe(true)
})

test('test_line_connection_09 spec Scenario "手改或损坏的持久设置被整体拒绝"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-corrupt-'))
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'settings.json')
  const corrupt = { lines: [{ id: 'A1B2C3D4', baseUrl: 'http://a.test/v1', accessMode: 'direct' }, { id: 'a1b2c3d4', baseUrl: 'http://b.test/v1', accessMode: 'direct' }], visibleModels: {}, defaultEfforts: {} }
  writeFileSync(path, JSON.stringify(corrupt))
  const before = readFileSync(path)
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('K1')
  const store = new SettingsStore(path)
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const view = await (await runtime.settings()).json() as { lines: unknown[]; activeLineId: string | null }
  expect(view.lines).toEqual([])
  expect(view.activeLineId).toBeNull()
  expect(gateway.requests).toHaveLength(0)
  expect(readFileSync(path).equals(before)).toBe(true)
  expect(credentials.writes).toEqual([])
})
