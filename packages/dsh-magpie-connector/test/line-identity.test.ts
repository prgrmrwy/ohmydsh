import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

test('test_line_identity_01 spec Scenario "只注册一个 route"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const credentials = lineCredentials('mk-1')
  const store = memoryStore([line(gateway.baseUrl)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const op = await runtime.beginOperation()
  try {
    expect(op.lineId).toBe(LINE_ID)
    expect(op.key).toBe('mk-1')
    expect(String(refs().key)).toBe('MAGPIE_LINE_A1B2C3D4_API_KEY')
  } finally { op.release() }
})

test('test_line_identity_02 spec Scenario "凭据引用由稳定 id 绑定"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'b' }] }))
  const credentials = lineCredentials('K1')
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(b.baseUrl, LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => runtime.dispose())
  const first = await runtime.beginOperation()
  try { expect(first.key).toBe('K1'); expect(first.baseUrl).toBe(a.baseUrl) } finally { first.release() }
  const reordered = await runtime.settings({ lines: [
    { id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' },
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
  ] })
  expect(reordered.status).toBe(200)
  const second = await runtime.beginOperation()
  try {
    expect(second.lineId).toBe(LINE_ID_2)
    expect(second.key).toBe('K2')
    expect(second.baseUrl).toBe(b.baseUrl)
  } finally { second.release() }
  expect(credentials.values.get(refs().key as unknown as string)).toBe('K1')
  expect(credentials.values.get(refs(LINE_ID_2).key as unknown as string)).toBe('K2')
  void unreachableBaseUrl
})
