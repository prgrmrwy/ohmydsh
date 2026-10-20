import { afterEach, expect, it } from 'vitest'
import { JevClient, TIER_QUESTIONS, type JevResult } from '../src/jev.js'
import { fakeJev, json, tier, type Reply } from './fake-jev.js'

const env = (key?: string) => ({ get: (name: string) => name === 'OPENROUTER_API_KEY' && key !== undefined ? { value: key } : undefined })
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })
async function setup(reply: Reply, key: string | undefined = 'sk-or-test-SECRET') {
 const server = await fakeJev(reply); close = server.close
 return { server, client: new JevClient(env(key), server.base, 3000) }
}

it('request_body_and_limits', async () => {
 const { server, client } = await setup(tier('standard'))
 const result = await client.judge('继续', 'standard', new AbortController().signal)
 expect(result).toEqual({ kind: 'ok', tier: 'standard' })
 expect(server.bodies).toHaveLength(1)
 const body = server.bodies[0] as { model: string; state: string; questions: unknown }
 expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
 expect(body.model).toBe('typesafe/jev-1.13')
 expect(body.questions).toEqual(TIER_QUESTIONS)
 expect(body.state).toContain('standard')
 expect(body.state).toContain('继续')
 expect(server.headers[0]!.authorization).toBe('Bearer sk-or-test-SECRET')
 expect(new JevClient(env('k')).url).toBe('https://openrouter.ai/api/alpha/decisions')
})

it('redirect_is_rejected', async () => {
 const target = await fakeJev(tier('simple'))
 try {
  const { client } = await setup((_req, res) => { res.writeHead(302, { location: `${target.base}/x` }); res.end() })
  expect(await client.judge('x', undefined, new AbortController().signal)).toEqual({ kind: 'failed', category: 'rejected' })
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
  [tier('huge'), 'invalid-response'],
  [json(200, { error: { code: 402, message: 'Insufficient credits' } }), 'insufficient-credits'],
 ]
 const server = await fakeJev(cases[0]![0]); close = server.close
 const client = new JevClient(env('sk-or-test-SECRET'), server.base, 300)
 for (const [reply, category] of cases) {
  server.set(reply)
  expect(await client.judge('x', undefined, new AbortController().signal), category).toEqual({ kind: 'failed', category })
 }
 const before = server.bodies.length
 expect(await new JevClient(env(undefined), server.base).judge('x', undefined, new AbortController().signal)).toEqual({ kind: 'failed', category: 'missing-credential' })
 expect(await new JevClient(env(''), server.base).judge('x', undefined, new AbortController().signal)).toEqual({ kind: 'failed', category: 'missing-credential' })
 expect(server.bodies.length).toBe(before)
 expect(server.bodies.length).toBe(cases.length)
})

it('caller_cancel_is_cancelled_not_timeout', async () => {
 const { client } = await setup(() => {})
 const controller = new AbortController()
 const pending = client.judge('x', undefined, controller.signal)
 setTimeout(() => controller.abort(), 20)
 const result: JevResult = await pending
 expect(result).toEqual({ kind: 'cancelled' })
})
