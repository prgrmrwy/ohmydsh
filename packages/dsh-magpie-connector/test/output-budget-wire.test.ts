import { afterEach, expect, test, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json, sse } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
import { chatText, responseText } from './support/wire.js'
import { line } from './support/line.js'

// Record the model pi-ai receives; everything else runs the real implementation.
const seenModels = vi.hoisted(() => [] as { id: string; maxTokens: number }[])
vi.mock('@earendil-works/pi-ai', async importOriginal => {
  const real = await importOriginal<typeof import('@earendil-works/pi-ai')>()
  return { ...real, createProvider: ((...args: Parameters<typeof real.createProvider>) => {
    const provider = real.createProvider(...args)
    return { ...provider, stream: (model: { id: string; maxTokens: number }, ...rest: unknown[]) => { seenModels.push({ id: model.id, maxTokens: model.maxTokens }); return (provider.stream as (...a: unknown[]) => unknown)(model, ...rest) } }
  }) as typeof real.createProvider }
})

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { seenModels.length = 0; for (const f of cleanup.splice(0).reverse()) await f() })
const capacity = { context_window: 500000, max_output_tokens: 393216 }
const catalog = { data: [
  { id: 'codex/gpt-6.1-sol', native_endpoints: ['/v1/responses'], ...capacity },
  { id: 'deepseek/deepseek-flash', native_endpoints: [], ...capacity },
  { id: 'x/no-output', native_endpoints: [], context_window: 500000 },
  { id: 'x/no-output-responses', native_endpoints: ['/v1/responses'], context_window: 500000 },
] }
const protocols = [{ model: 'codex/gpt-6.1-sol', path: '/responses', text: responseText, field: 'max_output_tokens' }, { model: 'deepseek/deepseek-flash', path: '/chat/completions', text: chatText, field: 'max_completion_tokens' }]
async function setup() {
  const g = await createGateway(); const c = credentialsMock('mk-test-123'); const store = new SettingsStore(); store.value.lines = [line(g.baseUrl)]
  const r = new MagpieRuntime(c.service, store); g.handlers.set('GET /v1/models', json(catalog)); await r.start(); g.requests.length = 0
  cleanup.push(g.close, () => r.dispose())
  g.handlers.set('POST /v1/responses', sse(responseText())); g.handlers.set('POST /v1/chat/completions', sse(chatText()))
  return { g, a: new MagpieAdapter(r) }
}
const run = async (a: MagpieAdapter, model: string, extra: Partial<GenerateOptions> = {}) => {
  const chunks: StreamChunk[] = []
  for await (const c of a.stream({ provider: 'dsh-magpie-connector', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }] }], ...extra })) chunks.push(c)
  expect(chunks.findLast(c => c.type === 'finish')).toMatchObject({ reason: { kind: 'stop' } })
}

test('spec Scenario "SDK 模型上限为最大输出能力"', async () => {
  for (const p of protocols) {
    const { g, a } = await setup()
    await run(a, p.model, { maxTokens: 184464 })
    expect(seenModels.at(-1)).toEqual({ id: p.model, maxTokens: 393216 })
    expect((g.requests[0]!.body as Record<string, unknown>)[p.field]).toBe(184464)
  }
})
test('a direct adapter call does not fill the default budget (DSH llm does that)', async () => {
  for (const p of protocols) {
    const { g, a } = await setup()
    await run(a, p.model)
    expect(g.requests[0]!.body).not.toHaveProperty(p.field)
  }
})
test('an explicit maxTokens is sent for a model without an output capacity', async () => {
  for (const [model, field] of [['x/no-output', 'max_completion_tokens'], ['x/no-output-responses', 'max_output_tokens']] as const) {
    const { g, a } = await setup()
    await run(a, model, { maxTokens: 100 })
    expect(seenModels.at(-1)).toEqual({ id: model, maxTokens: 16384 })
    expect((g.requests[0]!.body as Record<string, unknown>)[field]).toBe(100)
  }
})
test('spec Scenario "没有最大输出能力时使用回退值"', async () => {
  const { g, a } = await setup()
  await run(a, 'x/no-output')
  expect(seenModels.at(-1)).toEqual({ id: 'x/no-output', maxTokens: 16384 })
  expect(g.requests[0]!.body).not.toHaveProperty('max_completion_tokens')
})
