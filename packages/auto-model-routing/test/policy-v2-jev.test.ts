import { afterEach, expect, it } from 'vitest'
import { JevClient, TIER_QUESTIONS } from '../src/jev.js'
import { fakeJev, json } from './fake-jev.js'
import questions from '../src/policy-v2-rubric.json' with { type: 'json' }
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.() })
it('asks independent dimensions in one call and keeps legacy questions untouched', async () => {
  const server = await fakeJev(json(200, { answers: { capability: { type: 'choice', choice: 'bounded' }, depth: { type: 'choice', choice: 'baseline' } } }))
  close = server.close
  const client = new JevClient({ get: () => ({ value: 'test' }) }, server.base)
  expect(await client.judgePolicy('synthetic task', new AbortController().signal, 'child')).toMatchObject({ kind: 'ok', capability: 'bounded', depth: 'baseline' })
  expect(server.bodies).toHaveLength(1)
  expect(server.bodies[0]).toMatchObject({ questions })
  expect(TIER_QUESTIONS).toHaveProperty('tier')
  server.set(json(200, { answers: { depth: { choice: 'higher' } } }))
  expect(await client.judgePolicy('main', new AbortController().signal, 'main')).toMatchObject({ kind: 'ok', depth: 'higher' })
  expect((server.bodies[1] as { questions: unknown }).questions).not.toHaveProperty('capability')
})
it('rejects missing dimensions, invalid choices, and maps failure without a fallback', async () => {
  const server = await fakeJev(json(200, { answers: { depth: { choice: 'baseline' } } }))
  close = server.close
  const client = new JevClient({ get: () => ({ value: 'test' }) }, server.base)
  const signal = new AbortController().signal
  expect(await client.judgePolicy('x', signal, 'child')).toEqual({ kind: 'failed', category: 'invalid-response' })
  server.set(json(200, { answers: { capability: { choice: 'insufficient_context' }, depth: { choice: 'baseline' } } }))
  expect(await client.judgePolicy('x', signal, 'child')).toMatchObject({ kind: 'ok', capability: 'insufficient_context', depth: 'baseline' })
  server.set(json(200, { answers: { capability: { choice: 'bounded' }, depth: { choice: 'max' } } }))
  expect(await client.judgePolicy('x', signal, 'child')).toEqual({ kind: 'failed', category: 'invalid-response' })
  server.set(json(200,{ answers: { capability: { choice: ['bounded'] }, depth: { choice: 'baseline' } } }))
  expect(await client.judgePolicy('x', signal, 'child')).toEqual({kind:'failed',category:'invalid-response'})
  server.set(json(200,{ answers: { capability: { choice: 'bounded' }, depth: { choice: 'not-requested' } } }))
  expect(await client.judgePolicy('x', signal, 'child','capability')).toMatchObject({kind:'ok',capability:'bounded',depth:'baseline'})
  server.set(json(402, {}))
  expect(await client.judgePolicy('x', signal, 'child')).toEqual({ kind: 'failed', category: 'insufficient-credits' })
})
