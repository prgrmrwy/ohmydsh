import { expect, test } from 'vitest'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json, sse } from './support/gateway.js'
import { models, responseText, chatText } from './support/wire.js'

for (const responses of [true, false]) test(`${responses ? 'Responses' : 'Chat'} content filter preserves known usage before error finish`, async () => {
  const gateway = await createGateway()
  const store = new SettingsStore(); store.value.baseUrl = gateway.baseUrl
  const runtime = new MagpieRuntime(credentialsMock('test-key').service, store)
  gateway.handlers.set('GET /v1/models', json(models))
  const events = responses ? responseText('hi', undefined, 'incomplete') : chatText('hi', undefined, 'content_filter')
  if (responses) {
    const terminal = events.at(-1) as { response: { incomplete_details: { reason: string } } }
    terminal.response.incomplete_details.reason = 'content_filter'
  }
  gateway.handlers.set(`POST /v1/${responses ? 'responses' : 'chat/completions'}`, sse(events))
  try {
    await runtime.start()
    const chunks = []
    for await (const chunk of new MagpieAdapter(runtime).stream({ provider: 'dsh-magpie-connector', model: responses ? 'codex/gpt-6.1-sol' : 'deepseek/deepseek-flash', messages: [] })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
    expect(chunks.at(-2)).toEqual({ type: 'usage', usage: { inputTokens: 350, cacheReadTokens: 600, cacheWriteTokens: 50, outputTokens: 20, totalTokens: 1020 } })
  } finally { await runtime.dispose(); await gateway.close() }
})
