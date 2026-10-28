import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, lineCredentials, memoryStore, refs } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const portOf = (baseUrl: string) => Number(new URL(baseUrl).port)

test('test_active_line_01 spec Scenario "设置读取返回并更新生效线路"', async () => {
  const a = await createGateway(), b = await createGateway(); cleanup.push(a.close, b.close)
  a.handlers.set('GET /v1/models', json({ data: [] }))
  b.handlers.set('GET /v1/models', json({ data: [] }))
  const credentials = lineCredentials('K1')
  credentials.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  const store = memoryStore([line(a.baseUrl, LINE_ID), line(b.baseUrl, LINE_ID_2)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async (_host, port) => port === portOf(b.baseUrl) })
  cleanup.push(() => runtime.dispose())
  const view = await (await runtime.settings()).json() as { activeLineId: string | null }
  expect(view.activeLineId).toBe(LINE_ID_2)
  expect(a.requests).toHaveLength(0)
  expect(b.requests).toHaveLength(0)
})

test('test_active_line_02 spec Scenario "无完整线路时 active 为空"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const credentials = lineCredentials(undefined)
  const store = memoryStore([line(gateway.baseUrl, LINE_ID)])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const view = await (await runtime.settings()).json() as { activeLineId: string | null; lines: { complete: boolean }[] }
  expect(view.activeLineId).toBeNull()
  expect(view.lines[0]?.complete).toBe(false)
  const adapter = new MagpieAdapter(runtime)
  expect(await adapter.listModels()).toEqual([])
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'dsh-magpie-connector', model: 'a', messages: [] })) chunks.push(chunk)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { message: expect.stringContaining('MAGPIE_NOT_CONFIGURED') } } })
  expect(gateway.requests).toHaveLength(0)
})
