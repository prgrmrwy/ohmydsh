import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter, RETRY_POLICY, classifyFailure } from '../src/host/adapter.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json, sse } from './support/gateway.js'
import { models, responseText } from './support/wire.js'
import { credentialsMock } from './support/credentials.js'
import { line } from './support/line.js'

test('retry policy matches dsh-plugin-subscriptions: 10 retries, 1s doubling to 60s, 20% jitter, canonical codes', () => {
  expect(RETRY_POLICY).toMatchObject({ mode: 'normal', maxRetries: 10, initialDelayMs: 1000, maxDelayMs: 60_000, jitterRatio: 0.2 })
  expect([...(RETRY_POLICY as { retryableCodes: readonly string[] }).retryableCodes].sort()).toEqual(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'])
  expect(new MagpieAdapter({} as never).providerRetryPolicy()).toBe(RETRY_POLICY)
})

test.each([
  ['429 with retry-after', 429, { 'retry-after': '7' }, { code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 7000 }],
  ['503', 503, {}, { code: 'SERVER', status: 503 }],
  ['504', 504, {}, { code: 'TIMEOUT', status: 504 }],
  ['401', 401, {}, { code: 'AUTH', status: 401 }],
  ['400', 400, {}, { code: 'HTTP_400', status: 400 }],
] as const)('HTTP %s is sent once and classified for DSH llm-retry', async (_name, status, headers, failure) => {
  const g = await createGateway(); const store = new SettingsStore(); store.value.lines = [line(g.baseUrl)]
  const r = new MagpieRuntime(credentialsMock('placeholder').service, store); g.handlers.set('GET /v1/models', json(models)); await r.start()
  try {
    let attempts = 0
    g.handlers.set('POST /v1/responses', res => { attempts++; res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify({ error: { message: 'temporary' } })) })
    const chunks = []; for await (const c of new MagpieAdapter(r).stream({ provider: 'dsh-magpie-connector', model: 'codex/gpt-6.1-sol', messages: [] })) chunks.push(c)
    expect(attempts).toBe(1)
    expect(chunks.at(-1)).toMatchObject({ reason: { kind: 'error', failure } })
  } finally { await r.dispose(); await g.close() }
})

test('a completed response with no content is EMPTY_RESPONSE, not a silent stop', async () => {
  const g = await createGateway(); const store = new SettingsStore(); store.value.lines = [line(g.baseUrl)]
  const r = new MagpieRuntime(credentialsMock('placeholder').service, store); g.handlers.set('GET /v1/models', json(models)); await r.start()
  try {
    g.handlers.set('POST /v1/responses', sse(responseText().filter(e => (e as { type: string }).type === 'response.completed')))
    const chunks = []; for await (const c of new MagpieAdapter(r).stream({ provider: 'dsh-magpie-connector', model: 'codex/gpt-6.1-sol', messages: [] })) chunks.push(c)
    expect(chunks.at(-1)).toMatchObject({ reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } } })
  } finally { await r.dispose(); await g.close() }
})

test.each([
  ['terminated', 'TRANSPORT'], ['fetch failed', 'TRANSPORT'], ['connect ECONNREFUSED 10.0.0.1:3425', 'TRANSPORT'],
  ['upstream overloaded', 'SERVER'], ['Request timed out', 'TIMEOUT'], ['MAGPIE_STREAM_TRUNCATED', 'TRANSPORT'],
  ['MAGPIE_NOT_CONFIGURED', 'MAGPIE_NOT_CONFIGURED'], ['insufficient_quota', 'QUOTA'],
  ["This model's maximum context length is 128000 tokens", 'CONTEXT_WINDOW_EXCEEDED'], ['something odd', 'MAGPIE_GENERATION_FAILED'],
])('message %j classifies as %s', (message, code) => expect(classifyFailure(message).code).toBe(code))
