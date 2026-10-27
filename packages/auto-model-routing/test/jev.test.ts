import { afterEach, expect, it } from 'vitest'
import { JevClient, QUESTIONS, type PolicyResult } from '../src/jev.js'
import { fakeJev, json, type Reply } from './fake-jev.js'
/** A main-session depth answer. */
const depth = (choice: string, confidence = 1, probabilities: Record<string, unknown> = {}) => json(200, { model: 'typesafe/jev-1.13-20260917', answers: { depth: { type: 'choice', choice, probabilities, confidence } } })
const judge = (client: JevClient, state: string, signal: AbortSignal) => client.judgePolicy(state, signal, 'main')

const env = (key?: string) => ({ get: (name: string) => name === 'OPENROUTER_API_KEY' && key !== undefined ? { value: key } : undefined })
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })
async function setup(reply: Reply, key: string | undefined = 'sk-or-test-SECRET') {
 const server = await fakeJev(reply); close = server.close
 return { server, client: new JevClient(env(key), server.base, 3000) }
}

it('request_body_and_limits', async () => {
 const { server, client } = await setup(depth('higher', 0.73, { lower: 0.1, baseline: 0.1, higher: 0.8, bogus: 2, huge: 'x' }))
 const result = await judge(client, 'Previous user-turn tier: none\nUser message:\n继续', new AbortController().signal)
 // Distribution keeps only finite numbers in [0, 1].
 expect(result).toEqual({ kind: 'ok', depth: 'higher', confidence: 0.73, probabilities: { lower: 0.1, baseline: 0.1, higher: 0.8 }, ms: expect.any(Number), decisionProvider: 'openrouter', decisionModel: 'typesafe/jev-1.13' })
 expect(server.bodies).toHaveLength(1)
 const body = server.bodies[0] as { model: string; state: string; questions: unknown }
 expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
 expect(body.model).toBe('typesafe/jev-1.13')
 expect(body.questions).toEqual({ depth: QUESTIONS.depth })
 expect(body.state).toContain('继续')
 expect(server.headers[0]!.authorization).toBe('Bearer sk-or-test-SECRET')
 expect(new JevClient(env('k')).url).toBe('https://openrouter.ai/api/alpha/decisions')
})

it('spec Scenario "期限按设置生效"', async () => {
 const {server} = await setup((_req,res)=>{setTimeout(()=>res.end(JSON.stringify({answers:{depth:{choice:'lower'}}})),2000)})
 let key: string|undefined = 'key-A'
 let timeout = 1500
 const client = new JevClient({get:async()=>key ? {value:key}:undefined},server.base,()=>timeout)
 expect(await judge(client, 'x',new AbortController().signal)).toEqual({kind:'failed',category:'timeout'})
 key='key-B';timeout=2500
 expect(await judge(client, 'x',new AbortController().signal)).toMatchObject({kind:'ok',depth:'lower'})
 expect(server.headers.map(h=>h.authorization)).toEqual(['Bearer key-A','Bearer key-B'])
 key=undefined
 expect(await judge(client, 'x',new AbortController().signal)).toEqual({kind:'failed',category:'missing-credential'})
 expect(server.bodies).toHaveLength(2)
}, 6000)
it('cancel_during_async_credential_resolution_does_not_send', async () => {
 const {server}=await setup(depth('lower'))
 const controller = new AbortController()
 const client = new JevClient({get:async()=>{controller.abort();return {value:'key'}}},server.base,()=>1500)
 expect(await judge(client, 'x',controller.signal)).toEqual({kind:'cancelled'})
 expect(server.bodies).toHaveLength(0)
})
it('cancel_interrupts_pending_credential_lookup', async () => {
 const {server}=await setup(depth('lower'))
 const controller=new AbortController()
 const client=new JevClient({get:()=>new Promise(()=>{})},server.base)
 const pending=judge(client, 'x',controller.signal)
 controller.abort()
 expect(await pending).toEqual({kind:'cancelled'})
 expect(server.bodies).toHaveLength(0)
})
it('spec Scenario "不跟随重定向"', async () => {
 const target = await fakeJev(depth('lower'))
 try {
  const { client } = await setup((_req, res) => { res.writeHead(302, { location: `${target.base}/x` }); res.end() })
  expect(await judge(client, 'x', new AbortController().signal)).toEqual({ kind: 'failed', category: 'rejected' })
  expect(target.bodies).toHaveLength(0)
 } finally { await target.close() }
})

it('failure_categories', async () => {
 const cases: [Reply, string][] = [
  [json(402, { error: { code: 402 } }), 'insufficient-credits'],
  [json(401, {}), 'unauthorized'],
  [json(403, {}), 'unauthorized'],
  [json(429, {}), 'rate-limited'],
  [json(451, {}), 'region-blocked'],
  [json(404, {}), 'rejected'],
  [json(500, {}), 'unavailable'],
  [(req) => { req.socket.destroy() }, 'unavailable'],
  [() => { /* never answers */ }, 'timeout'],
  [(_req, res) => { res.writeHead(200); res.end('not json') }, 'invalid-response'],
  [depth('huge'), 'invalid-response'],
  [json(200, { error: { code: 402, message: 'Insufficient credits' } }), 'insufficient-credits'],
 ]
 const server = await fakeJev(cases[0]![0]); close = server.close
 const client = new JevClient(env('sk-or-test-SECRET'), server.base, 300)
 for (const [reply, category] of cases) {
  server.set(reply)
  expect(await judge(client, 'x', new AbortController().signal), category).toEqual({ kind: 'failed', category })
 }
 const before = server.bodies.length
 expect(await judge(new JevClient(env(undefined), server.base), 'x', new AbortController().signal)).toEqual({ kind: 'failed', category: 'missing-credential' })
 expect(await judge(new JevClient(env(''), server.base), 'x', new AbortController().signal)).toEqual({ kind: 'failed', category: 'missing-credential' })
 expect(server.bodies.length).toBe(before)
 expect(server.bodies.length).toBe(cases.length)
})

it('response_limit_counts_utf8_bytes', async () => {
 const prefix = '{"answers":{"depth":{"choice":"lower"}},"padding":"'
 const suffix = '"}'
 const exact = prefix + '界'.repeat(1000) + ' '.repeat(65536 - Buffer.byteLength(prefix + suffix) - 3000) + suffix
 const { server, client } = await setup((_req, res) => { res.end(exact) })
 expect(Buffer.byteLength(exact)).toBe(65536)
 expect(await judge(client, 'x', new AbortController().signal)).toMatchObject({ kind: 'ok', depth: 'lower' })
 const oversized = exact.replace('界', '界 ')
 server.set((_req, res) => { res.end(oversized) })
 expect(oversized.length).toBeLessThan(65536)
 expect(Buffer.byteLength(oversized)).toBe(65537)
 expect(await judge(client, 'x', new AbortController().signal)).toEqual({ kind: 'failed', category: 'invalid-response' })
 expect(server.bodies).toHaveLength(2)
})

it('oversized_stream_is_cancelled_before_eof', async () => {
 let closed = false
 const { server } = await setup((_req, res) => {
  res.on('close', () => { closed = true })
  res.writeHead(200)
  res.write('x'.repeat(40000))
  res.write('x'.repeat(40000))
  // Never end: the byte limit, not the deadline, must stop this response.
 })
 const client = new JevClient(env('test'), server.base, 500)
 expect(await judge(client, 'x', new AbortController().signal)).toEqual({ kind: 'failed', category: 'invalid-response' })
 await expect.poll(() => closed).toBe(true)
 expect(server.bodies).toHaveLength(1)
})

it('http_error_is_classified_without_waiting_for_body', async () => {
 let closed = false
 const { server } = await setup((_req, res) => {
  res.on('close', () => { closed = true })
  res.writeHead(402)
  res.write('body is intentionally incomplete')
 })
 const client = new JevClient(env('test'), server.base, 500)
 expect(await judge(client, 'x', new AbortController().signal)).toEqual({ kind: 'failed', category: 'insufficient-credits' })
 await expect.poll(() => closed).toBe(true)
 expect(server.bodies).toHaveLength(1)
})

it.each(['caller', 'deadline'] as const)('response_stream_respects_abort (%s)', async source => {
 let closed = false
 let started!: () => void
 const writing = new Promise<void>(resolve => { started = resolve })
 const { server } = await setup((_req, res) => {
  res.on('close', () => { closed = true })
  res.writeHead(200)
  res.write('{"answers":')
  started()
 })
 const controller = new AbortController()
 const client = new JevClient(env('test'), server.base, source === 'caller' ? 3000 : 300)
 const pending = judge(client, 'x', controller.signal)
 await writing
 if (source === 'caller') controller.abort()
 expect(await pending).toEqual(source === 'caller' ? { kind: 'cancelled' } : { kind: 'failed', category: 'timeout' })
 await expect.poll(() => closed).toBe(true)
 expect(server.bodies).toHaveLength(1)
})

it('caller_cancel_is_cancelled_not_timeout', async () => {
 const { client } = await setup(() => {})
 const controller = new AbortController()
 const pending = judge(client, 'x', controller.signal)
 setTimeout(() => controller.abort(), 20)
 const result: PolicyResult = await pending
 expect(result).toEqual({ kind: 'cancelled' })
})
