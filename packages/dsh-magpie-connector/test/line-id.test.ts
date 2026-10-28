import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

test('test_line_id_01 spec Scenario "新线路由 host 分配稳定 id"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  b.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(a.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true, newId: () => LINE_ID_2 })
  cleanup.push(() => runtime.dispose())
  const added = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
    { baseUrl: b.baseUrl, accessMode: 'direct', key: 'K2' },
  ] })
  expect(added.status).toBe(200)
  const ids = (await added.json() as { lines: { id: string }[] }).lines.map(entry => entry.id)
  expect(ids).toEqual([LINE_ID, LINE_ID_2])
  expect(ids[1]).toMatch(/^[0-9a-f]{8}$/)
  expect(credentials.values.get(refs(LINE_ID_2).key as unknown as string)).toBe('K2')
  const reordered = await runtime.settings({ lines: [
    { id: LINE_ID_2, baseUrl: b.baseUrl, accessMode: 'direct' },
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
  ] })
  expect(reordered.status).toBe(200)
  const edited = await runtime.settings({ lines: [
    { id: LINE_ID_2, baseUrl: 'http://changed.test/v1', accessMode: 'direct' },
    { id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' },
  ] })
  expect(edited.status).toBe(200)
  const restarted = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => restarted.dispose())
  expect((await (await restarted.settings()).json() as { lines: { id: string; baseUrl: string }[] }).lines.map(entry => [entry.id, entry.baseUrl])).toEqual([[LINE_ID_2, 'http://changed.test/v1'], [LINE_ID, a.baseUrl]])
})

test('test_line_id_02 spec Scenario "非法 line id 被拒绝"', async () => {
  const a = await createGateway(); cleanup.push(a.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  const store = memoryStore([line(a.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { newId: () => LINE_ID_2 })
  cleanup.push(() => runtime.dispose())
  const snapshot = JSON.stringify(store.value)
  for (const lines of [
    [{ id: 'deadbeef', baseUrl: 'http://x.test/v1', accessMode: 'direct' as const }],
    [{ id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' as const }, { id: LINE_ID, baseUrl: 'http://y.test/v1', accessMode: 'direct' as const }],
    [{ id: LINE_ID, baseUrl: a.baseUrl, accessMode: 'direct' as const }, { id: 'feedface', baseUrl: 'http://z.test/v1', accessMode: 'direct' as const, key: 'K5' }],
  ]) expect((await runtime.settings({ lines })).status).toBe(400)
  expect(credentials.writes).toEqual([])
  expect(JSON.stringify(store.value)).toBe(snapshot)
})
