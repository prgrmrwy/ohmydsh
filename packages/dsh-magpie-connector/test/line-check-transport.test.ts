import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs, seedAccess, seedKey } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

test('test_line_check_transport_01 spec Scenario "线路检查只触达被检查线路的 /v1/models"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [{ id: 'm1' }] }))
  b.handlers.set('GET /v1/models', json({ data: [{ id: 'm2' }] }))
  const credentials = lineCredentials('K1')
  seedKey(credentials, 'K2', LINE_ID_2)
  const published: unknown[] = []
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(b.baseUrl, LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, routes => { published.push(routes) }); cleanup.push(() => runtime.dispose())

  // Establish the active line without any gateway traffic (settings read only selects).
  const view = await (await runtime.settings()).json() as { activeLineId: string }
  expect(view.activeLineId).toBe(LINE_ID)
  expect(a.requests).toHaveLength(0)

  const response = await runtime.lineCheck({ id: LINE_ID_2, baseUrl: b.baseUrl })
  const body = await response.json() as { kind: string }
  expect(response.status).toBe(200)
  expect(body.kind).toBe('ok')

  expect(b.requests.filter(request => request.path === '/v1/models')).toHaveLength(1)
  expect(b.requests[0]!.method).toBe('GET')
  expect(b.requests[0]!.headers.authorization).toBe('Bearer K2')
  expect(a.requests).toHaveLength(0)
  // No directory sync / re-selection / route publication happened just because of the check.
  expect(runtime.selectedLineId).toBe(LINE_ID)
  expect(published).toHaveLength(0)
})

test('test_line_check_transport_02 spec Scenario "检查直连草稿不携带 Access 头"', async () => {
  const draft = await createGateway(); cleanup.push(draft.close)
  draft.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  seedAccess(credentials, LINE_ID, 'cf-id', 'cf-secret')
  // The saved line is a Cloudflare line; the draft being checked is direct, so it must not inherit
  // that line's Access headers.
  const store = memoryStore([line('https://magpie.example/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store); cleanup.push(() => runtime.dispose())

  const body = await (await runtime.lineCheck({ baseUrl: draft.baseUrl, accessMode: 'direct', key: 'K-draft' })).json() as { kind: string }
  expect(body.kind).toBe('ok')
  expect(draft.requests).toHaveLength(1)
  expect(draft.requests[0]!.headers.authorization).toBe('Bearer K-draft')
  expect(draft.requests[0]!.headers['cf-access-client-id']).toBeUndefined()
  expect(draft.requests[0]!.headers['cf-access-client-secret']).toBeUndefined()
  expect(refs(LINE_ID).accessClientId).toBe('MAGPIE_LINE_A1B2C3D4_ACCESS_CLIENT_ID')
})
