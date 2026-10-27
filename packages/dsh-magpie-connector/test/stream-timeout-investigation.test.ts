import { afterEach, expect, test, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { EventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, deferred, json } from './support/gateway.js'
import { models, responseText } from './support/wire.js'

// Contract: any data from the gateway re-arms one 300s idle watchdog; DSH llm-retry owns retries.
// Synthetic wire fixtures exercise real pi-ai, not live SOL latency or private history.
type Mark = { at: number; layer: string; type: string; length?: number }
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
const options: GenerateOptions = {
  provider: 'dsh-magpie-connector', model: 'codex/gpt-6.1-sol', reasoningEffort: 'high' as never,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic fixture' }] }],
}
const added = (type: 'reasoning' | 'message' | 'function_call') => ({
  type: 'response.output_item.added', output_index: 0,
  item: type === 'reasoning' ? { type, id: 'rs_fixture', summary: [] }
    : type === 'message' ? { type, id: 'msg_fixture', role: 'assistant', content: [] }
      : { type, id: 'fc_fixture', call_id: 'c_fixture', name: 'fixture', arguments: '' },
})
const delta = (type: 'reasoning' | 'message' | 'function_call', value = 'x') => ({
  type: type === 'reasoning' ? 'response.reasoning_summary_text.delta'
    : type === 'message' ? 'response.output_text.delta' : 'response.function_call_arguments.delta',
  output_index: 0, content_index: 0, delta: value,
})
const done = (type: 'reasoning' | 'message' | 'function_call', value = 'x') => ({
  ...added(type), type: 'response.output_item.done',
  item: type === 'reasoning' ? { ...added(type).item, summary: [{ type: 'summary_text', text: value }] }
    : type === 'message' ? { ...added(type).item, content: [{ type: 'output_text', text: value }] }
      : { ...added(type).item, arguments: value },
})
const completed = { type: 'response.completed', response: { id: 'r_fixture', status: 'completed', output: [] } }
const finish = (chunks: StreamChunk[]) => chunks.findLast(c => c.type === 'finish')

async function fixture(headersDelay = 0) {
  const store = new SettingsStore()
  store.value.baseUrl = 'http://127.0.0.1:1/v1'
  const runtime = new MagpieRuntime(credentialsMock('synthetic-key').service, store)
  cleanup.push(() => runtime.dispose())
  vi.spyOn(runtime.transport, 'request').mockResolvedValue(Response.json(models))
  await runtime.start()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(0)
  const trace: Mark[] = []
  const mark = (layer: string, type: string, length?: number) => trace.push({ at: Date.now(), layer, type, ...(length === undefined ? {} : { length }) })
  const originalPush = EventStream.prototype.push
  vi.spyOn(EventStream.prototype, 'push').mockImplementation(function (this: EventStream<unknown, unknown>, event: unknown) {
    const e = event as { type: string; delta?: string }
    mark('pi', e.type, e.delta?.length)
    return originalPush.call(this, event)
  })
  const entered = deferred(), aborted = deferred()
  let body!: ReadableStreamDefaultController<Uint8Array>
  let calls = 0, signal: AbortSignal | null | undefined
  vi.spyOn(runtime.transport, 'fetchFor').mockReturnValue(async (_input, init) => {
    calls++
    signal = init?.signal
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller } })
    signal?.addEventListener('abort', () => {
      mark('transport', 'abort')
      body.error(new DOMException('Synthetic request aborted', 'AbortError'))
      aborted.resolve()
    }, { once: true })
    if (headersDelay) await new Promise<void>(resolve => setTimeout(resolve, headersDelay))
    mark('transport', 'headers-200')
    entered.resolve()
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  })
  const chunks: StreamChunk[] = []
  const run = (async () => {
    for await (const chunk of new MagpieAdapter(runtime).stream(options)) {
      chunks.push(chunk)
      mark('dsh', chunk.type)
    }
  })()
  if (headersDelay) await vi.advanceTimersByTimeAsync(headersDelay)
  await entered.promise
  const settle = () => vi.advanceTimersByTimeAsync(0)
  await settle()
  return {
    trace, chunks, run, aborted, mark, settle,
    calls: () => calls, signal: () => signal,
    advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
    raw(event: object) {
      mark('raw', (event as { type: string }).type)
      body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    comment() { mark('raw', 'comment'); body.enqueue(new TextEncoder().encode(': fixture heartbeat\n\n')) },
    end() { body.close() },
    fail(message: string) { mark('transport', 'producer-error'); body.error(new Error(message)) },
  }
}
const IDLE = 300_000
function timeout(f: Awaited<ReturnType<typeof fixture>>, at: number) {
  expect(finish(f.chunks)).toMatchObject({ reason: { kind: 'error', failure: { code: 'TIMEOUT', message: expect.stringContaining('MAGPIE_STREAM_TIMEOUT') } } })
  expect(f.trace.find(m => m.type === 'abort')?.at).toBe(at)
  expect(f.signal()?.aborted).toBe(true)
  expect(f.calls()).toBe(1)
}
async function expiresAt(f: Awaited<ReturnType<typeof fixture>>, at: number) {
  await f.advance(at - Date.now() - 1)
  expect(finish(f.chunks)).toBeUndefined()
  await f.advance(1)
  await f.run
  timeout(f, at)
}

test('silence from the start times out at the 300s idle budget', async () => {
  const f = await fixture()
  await expiresAt(f, IDLE)
})

test('slow headers re-arm the idle budget when they arrive', async () => {
  const f = await fixture(250_000)
  expect(f.trace).toContainEqual({ at: 250_000, layer: 'transport', type: 'headers-200' })
  await expiresAt(f, 250_000 + IDLE)
})

test('any gateway data (created/in_progress/comments) keeps a long reasoning request alive', async () => {
  const f = await fixture()
  for (const time of [200_000, 400_000, 600_000]) {
    await f.advance(time - Date.now())
    f.raw({ type: time === 200_000 ? 'response.created' : 'response.in_progress', response: { id: 'r_fixture', status: 'in_progress' } })
    await f.settle()
  }
  await f.advance(800_000 - Date.now())
  f.comment()
  await f.settle()
  expect(finish(f.chunks)).toBeUndefined()
  await expiresAt(f, 800_000 + IDLE)
})

for (const type of ['reasoning', 'message', 'function_call'] as const) {
  test(`empty ${type} item start, content after 280s still completes`, async () => {
    const f = await fixture()
    f.raw(added(type))
    await f.settle()
    await f.advance(280_000)
    expect(finish(f.chunks)).toBeUndefined()
    const value = type === 'function_call' ? '{}' : 'x'
    f.raw(delta(type, value))
    f.raw(done(type, value))
    f.raw(completed)
    f.end()
    await f.run
    expect(finish(f.chunks)).toMatchObject({ reason: { kind: type === 'function_call' ? 'tool-calls' : 'stop' } })
    expect(f.calls()).toBe(1)
  })

  test(`${type} final block followed directly by done needs no delta`, async () => {
    const f = await fixture()
    await f.advance(65_000)
    f.raw(done(type, type === 'function_call' ? '{}' : 'final content'))
    f.raw(completed)
    f.end()
    await f.run
    expect(f.trace.some(m => m.layer === 'pi' && m.type.endsWith('_delta'))).toBe(false)
    expect(finish(f.chunks)).toMatchObject({ reason: { kind: type === 'function_call' ? 'tool-calls' : 'stop' } })
    expect(f.calls()).toBe(1)
  })
}

test('a dropped connection after start is a retryable TRANSPORT failure, never replayed here', async () => {
  const f = await fixture()
  await f.advance(12_000)
  f.fail('terminated')
  await f.run
  expect(finish(f.chunks)).toMatchObject({ reason: { kind: 'error', failure: { code: 'TRANSPORT' } } })
  expect(f.calls()).toBe(1)
})

test('an unrecognised producer failure stays non-retryable', async () => {
  const f = await fixture()
  f.fail('synthetic producer failure')
  await f.run
  expect(finish(f.chunks)).toMatchObject({ reason: { kind: 'error', failure: { code: 'MAGPIE_GENERATION_FAILED' } } })
})

test('an iterator throw after watchdog expiry is still reported as TIMEOUT', async () => {
  const originalIterator = EventStream.prototype[Symbol.asyncIterator]
  const release = deferred()
  vi.spyOn(EventStream.prototype, Symbol.asyncIterator).mockImplementation(async function* (this: EventStream<unknown, unknown>) {
    for await (const event of { [Symbol.asyncIterator]: () => originalIterator.call(this) }) {
      yield event
      if ((event as { type: string }).type === 'start') {
        await release.promise
        throw new Error('synthetic iterator throw after abort')
      }
    }
  })
  const f = await fixture()
  await f.advance(IDLE)
  await f.aborted.promise
  release.resolve()
  await f.run
  timeout(f, IDLE)
})

for (const success of [true, false]) test(`loopback real HTTP: empty start ${success ? 'allows 65s text + stop' : 'times out 300s after the last heartbeat'} with one POST and socket close`, async () => {
  const g = await createGateway()
  cleanup.push(g.close)
  g.handlers.set('GET /v1/models', json(models))
  const store = new SettingsStore()
  store.value.baseUrl = g.baseUrl
  const runtime = new MagpieRuntime(credentialsMock('synthetic-key').service, store)
  cleanup.push(() => runtime.dispose())
  await runtime.start()
  g.requests.length = 0
  const socketClosed = deferred(), gotStart = deferred()
  let response!: ServerResponse
  g.handlers.set('POST /v1/responses', res => {
    response = res
    res.once('close', () => socketClosed.resolve())
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    res.write(`data: ${JSON.stringify(added('reasoning'))}\n\n`)
  })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(0)
  const chunks: StreamChunk[] = []
  const run = (async () => {
    for await (const c of new MagpieAdapter(runtime).stream(options)) {
      chunks.push(c)
      if (c.type === 'block-start') gotStart.resolve()
    }
  })()
  await gotStart.promise
  await vi.advanceTimersByTimeAsync(55_000)
  response.write(': synthetic heartbeat\n\n')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(finish(chunks)).toBeUndefined()
  if (success) {
    await vi.advanceTimersByTimeAsync(5_000)
    response.write(`data: ${JSON.stringify(done('reasoning', ''))}\n\n`)
    for (const event of responseText()) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  } else {
    await vi.advanceTimersByTimeAsync(294_999)
    expect(finish(chunks)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
  }
  await run
  await socketClosed.promise
  expect(Date.now()).toBe(success ? 65_000 : 355_000)
  expect(finish(chunks)).toMatchObject({ reason: success ? { kind: 'stop' } : { kind: 'error', failure: { code: 'TIMEOUT' } } })
  if (success) expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'hi' }))
  expect(g.requests.map(r => [r.method, r.path])).toEqual([['POST', '/v1/responses']])
})
