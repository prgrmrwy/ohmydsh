import { afterEach, expect, test, vi } from 'vitest'
vi.mock('undici', async original => { const actual = await original<typeof import('undici')>(); return { ...actual, Agent: class extends actual.MockAgent { override async destroy() { await this.close() } } } })
import type { MockAgent } from 'undici'
import { MagpieRuntime } from '../src/host/runtime.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, line, lineCredentials, memoryStore, refs, seedAccess } from './support/line.js'
import { chatText } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

function setup(mode: 'cloudflare' | 'direct' = 'cloudflare') {
  const credentials = lineCredentials('gateway-key')
  if (mode === 'cloudflare') seedAccess(credentials, LINE_ID, 'access-id', 'access-secret')
  const baseUrl = mode === 'cloudflare' ? 'https://gateway.test/v1' : 'http://gateway.test/v1'
  const store = memoryStore([line(baseUrl, LINE_ID, mode)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const agent = (runtime.transport as unknown as { agent: MockAgent }).agent
  agent.disableNetConnect()
  const pool = agent.get(mode === 'cloudflare' ? 'https://gateway.test' : 'http://gateway.test')
  return { runtime, credentials, pool }
}
const sseBody = (events: unknown[]) => events.map(event => typeof event === 'string' ? `data: ${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`).join('')

test('test_access_auth_01 spec Scenario "Protected gateway"', async () => {
  const { runtime, pool } = setup()
  const seen: string[] = []
  for (const [method, path] of [['GET', '/v1/models'], ['GET', '/v1/magpie/quotas/cards'], ['POST', '/v1/magpie/quotas/refresh'], ['POST', '/v1/chat/completions'], ['POST', '/v1/responses']] as const) {
    pool.intercept({ method, path, headers: headers => {
      expect(headers.authorization).toBe('Bearer gateway-key')
      expect(headers['cf-access-client-id']).toBe('access-id')
      expect(headers['cf-access-client-secret']).toBe('access-secret')
      seen.push(path); return true
    } }).reply(200, { data: [] }).persist()
  }
  const op = await runtime.beginOperation()
  try {
    for (const [method, path] of [['GET', '/models'], ['GET', '/magpie/quotas/cards'], ['POST', '/magpie/quotas/refresh'], ['POST', '/chat/completions'], ['POST', '/responses']] as const) await runtime.transport.request(op, method, path)
  } finally { op.release() }
  expect(new Set(seen).size).toBe(5)
})

test('test_access_auth_02 spec Scenario "LAN connection"', async () => {
  const { runtime, pool } = setup('direct')
  pool.intercept({ method: 'GET', path: '/v1/models', headers: headers => {
    expect(headers.authorization).toBe('Bearer gateway-key')
    expect(headers['cf-access-client-id']).toBeUndefined()
    expect(headers['cf-access-client-secret']).toBeUndefined()
    return true
  } }).reply(200, { data: [{ id: 'chat' }] }).persist()
  await runtime.start()
  expect(runtime.current.catalog.map(model => model.info.id)).toEqual(['chat'])
})

test('test_access_auth_03 spec Scenario "Invalid pair"', async () => {
  const credentials = lineCredentials('gateway-key')
  const store = memoryStore([line('https://gateway.test/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://gateway.test/v1', accessMode: 'cloudflare', accessClientId: 'only-id' }] })
  expect(response.status).toBe(400)
  expect(credentials.writes).toEqual([])
})

test('test_access_confidential_01 spec Scenario "Settings read and failed request"', async () => {
  const { runtime, pool } = setup()
  pool.intercept({ method: 'GET', path: '/v1/models' }).reply(401, JSON.stringify({ error: 'invalid token access-secret' }), { headers: { 'content-type': 'application/json' } }).persist()
  await runtime.start()
  const text = await (await runtime.settings()).text()
  expect(text).not.toContain('access-secret')
  expect(text).not.toContain('access-id')
  expect(runtime.current.lastSyncError).toBeTruthy()
  expect(runtime.current.lastSyncError).not.toContain('access-secret')
})

test('test_access_confidential_02 spec Scenario "Read-only credential source"', async () => {
  const { runtime, credentials } = setup()
  credentials.markReadonly(refs().accessClientId as unknown as string)
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://gateway.test/v1', accessMode: 'cloudflare', accessClientId: 'next', accessClientSecret: 'next' }] })
  expect(response.status).toBe(409)
  expect(credentials.writes).toEqual([])
  void sseBody; void chatText
})
