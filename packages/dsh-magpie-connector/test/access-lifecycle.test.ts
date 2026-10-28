import { afterEach, expect, test, vi } from 'vitest'
vi.mock('undici', async original => { const actual = await original<typeof import('undici')>(); return { ...actual, Agent: class extends actual.MockAgent { override async destroy() { await this.close() } } } })
import type { MockAgent } from 'undici'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { lineCredentials, memoryStore, line, LINE_ID, refs, seedAccess } from './support/line.js'
import { chatText } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const sse = (events: unknown[]) => events.map(event => typeof event === 'string' ? `data: ${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`).join('')

function setup() {
  const credentials = lineCredentials('gateway-key'); seedAccess(credentials, LINE_ID, 'access-id', 'access-secret')
  const store = memoryStore([line('https://gateway.test/v1', LINE_ID, 'cloudflare')])
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const agent = (runtime.transport as unknown as { agent: MockAgent }).agent
  agent.disableNetConnect()
  const pool = agent.get('https://gateway.test')
  pool.intercept({ method: 'GET', path: '/v1/models' }).reply(200, { data: [{ id: 'chat' }] }).persist()
  return { runtime, credentials, pool }
}

test('test_access_lifecycle_01 spec Scenario "Access rotation during discovery"', async () => {
  const { runtime, credentials } = setup()
  await runtime.start()
  let finish!: (response: Response) => void
  const delayed = new Promise<Response>(resolve => { finish = resolve })
  const request = vi.spyOn(runtime.transport, 'request').mockImplementationOnce(() => delayed)
  const pending = runtime.syncCatalog()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  const previous = runtime.current
  credentials.setRef(refs().accessClientSecret as unknown as string, 'rotated-secret')
  runtime.invalidateCredential(refs().accessClientSecret)
  await runtime.syncCatalog()
  finish(Response.json({ data: [{ id: 'stale-model' }] }))
  await pending
  expect(previous.bgAbort.signal.aborted).toBe(true)
  expect(runtime.current.catalog.map(model => model.info.id)).toEqual(['chat'])
  expect(request.mock.calls.at(-1)?.[0].accessClientSecret).toBe('rotated-secret')
})

test('test_access_lifecycle_02 spec Scenario "Prepared operation"', async () => {
  const { runtime, credentials, pool } = setup()
  await runtime.start()
  const adapter = new MagpieAdapter(runtime)
  const prepared = await adapter.prepareCall('dsh-magpie-connector', 'chat')
  pool.intercept({ method: 'POST', path: '/v1/chat/completions', headers: headers => {
    expect(headers.authorization).toBe('Bearer gateway-key')
    expect(headers['cf-access-client-id']).toBe('access-id')
    expect(headers['cf-access-client-secret']).toBe('access-secret')
    return true
  } }).reply(200, sse(chatText('hi')), { headers: { 'content-type': 'text/event-stream' } })
  credentials.setRef(refs().accessClientSecret as unknown as string, 'rotated-secret')
  runtime.invalidateCredential(refs().accessClientSecret)
  const chunks = []
  for await (const chunk of prepared.stream({ provider: 'dsh-magpie-connector', model: 'chat', messages: [] })) chunks.push(chunk)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
})
