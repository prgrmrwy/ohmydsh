import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway } from './support/gateway.js'
import { LINE_ID, line, lineCredentials, memoryStore, refs, seedAccess, seedKey } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

test('test_line_access_01 spec Scenario "默认直连，选择 Cloudflare Access 后才出现令牌输入（AMD4）"', async () => {
  const credentials = lineCredentials('K1')
  const store = memoryStore([line('https://gateway.invalid/v1')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://gateway.invalid/v1', accessMode: 'cloudflare', accessClientId: 'cf-id', accessClientSecret: 'cf-secret' }] })
  expect(response.status).toBe(200)
  const view = await (await runtime.settings()).json() as { lines: { accessMode: string; key: { configured: boolean }; access: { clientId: { configured: boolean } } }[] }
  expect(view.lines[0]?.accessMode).toBe('cloudflare')
  expect(view.lines[0]?.key.configured).toBe(true)
  expect(view.lines[0]?.access.clientId.configured).toBe(true)
  expect(credentials.writes).toEqual(['cf-id', 'cf-secret'])
})

test('test_line_access_02 spec Scenario "切回直连并保存即清除 Access 凭据（AMD4）"', async () => {
  const credentials = lineCredentials('K1'); seedAccess(credentials)
  const store = memoryStore([line('https://gateway.invalid/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://gateway.invalid/v1', accessMode: 'direct', accessClientId: null, accessClientSecret: null }] })
  expect(response.status).toBe(200)
  const view = await (await runtime.settings()).json() as { lines: { accessMode: string; access: { clientId: { configured: boolean } } }[] }
  expect(view.lines[0]?.accessMode).toBe('direct')
  expect(view.lines[0]?.access.clientId.configured).toBe(false)
  expect(credentials.values.has(refs().accessClientId as unknown as string)).toBe(false)
})

test('test_line_access_03 spec Scenario "Access 线路必须是 https"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const before = credentials.writes.length
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'cloudflare', accessClientId: 'cf', accessClientSecret: 'secret' }] })
  expect(response.status).toBe(400)
  expect(credentials.writes.length).toBe(before)
  expect((await (await runtime.settings()).json() as { lines: { accessMode: string }[] }).lines[0]?.accessMode).toBe('direct')
})

test('test_line_access_04 spec Scenario "Access 凭据缺失时线路未完整"', async () => {
  const credentials = lineCredentials('K1'); seedAccess(credentials)
  const store = memoryStore([line('https://gateway.invalid/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  credentials.removeRef(refs().accessClientSecret as unknown as string)
  runtime.invalidateCredential(refs().accessClientSecret)
  const view = await (await runtime.settings()).json() as { lines: { complete: boolean }[]; activeLineId: string | null }
  expect(view.lines[0]?.complete).toBe(false)
  expect(view.activeLineId).toBeNull()
  const op = await runtime.beginOperation()
  try { expect(op.baseUrl).toBe('') } finally { op.release() }
  void credentialsMock
})

test('test_line_access_05 spec Scenario "环境 Access 线路完整可用但只读"', async () => {
  const credentials = lineCredentials('K1'); seedAccess(credentials, LINE_ID, 'env-id', 'env-secret')
  credentials.markReadonly(refs().accessClientId as unknown as string); credentials.markReadonly(refs().accessClientSecret as unknown as string)
  const store = memoryStore([line('https://gateway.invalid/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const view = await (await runtime.settings()).json() as { lines: { complete: boolean }[] }
  expect(view.lines[0]?.complete).toBe(true)
  const op = await runtime.beginOperation()
  try { expect(op.accessClientId).toBe('env-id'); expect(op.accessClientSecret).toBe('env-secret') } finally { op.release() }
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://gateway.invalid/v1', accessMode: 'cloudflare', accessClientId: 'next', accessClientSecret: 'next' }] })
  expect(response.status).toBe(409)
  expect(credentials.values.get(refs().accessClientId as unknown as string)).toBe('env-id')
})

test('test_line_access_06 spec Scenario "直连线路提交 Access 值被拒绝"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct', accessClientId: 'cf', accessClientSecret: 'secret' }] })
  expect(response.status).toBe(400)
  expect(credentials.writes).toEqual([])
})

test('test_line_access_07 spec Scenario "环境 Access 使接入方式只读"', async () => {
  const credentials = lineCredentials('K1'); seedAccess(credentials); seedKey(credentials, 'K1')
  credentials.markReadonly(refs().accessClientId as unknown as string); credentials.markReadonly(refs().accessClientSecret as unknown as string)
  const store = memoryStore([line('https://gateway.invalid/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://gateway.invalid/v1', accessMode: 'direct' }] })
  expect(response.status).toBe(409)
  expect((await (await runtime.settings()).json() as { lines: { accessMode: string }[] }).lines[0]?.accessMode).toBe('cloudflare')
  expect(credentials.writes).toEqual([])
})
