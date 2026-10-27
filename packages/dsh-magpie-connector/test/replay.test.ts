import { afterEach, expect, test } from 'vitest'
import { BlockAssembler, type ContentBlock, type GenerateOptions, type ReplayEnvelope, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm/message'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json, sse } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
import { models, chatText, responseText, chatTool, responseTool } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const protocols = [
  { model: 'codex/gpt-6.1-sol', path: '/v1/responses', text: responseText, tool: responseTool },
  { model: 'deepseek/deepseek-flash', path: '/v1/chat/completions', text: chatText, tool: chatTool },
]
async function setup() {
  const gateway = await createGateway()
  const store = new SettingsStore()
  store.value.baseUrl = gateway.baseUrl
  const runtime = new MagpieRuntime(credentialsMock('mock-replay-key').service, store)
  gateway.handlers.set('GET /v1/models', json(models))
  await runtime.start()
  gateway.requests.length = 0
  cleanup.push(gateway.close, () => runtime.dispose())
  return { gateway, adapter: new MagpieAdapter(runtime) }
}
const options = (model: string, messages: GenerateOptions['messages'] = [{ role: 'user', content: [{ type: 'text', text: 'U' }] }]): GenerateOptions => ({ provider: 'dsh-magpie-connector', model, messages })
async function assemble(stream: AsyncIterable<StreamChunk>) {
  const assembler = new BlockAssembler()
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) { assembler.push(chunk); chunks.push(chunk) }
  return { assembler, chunks }
}
function assistant(model: string, content: readonly ContentBlock[], replayState: unknown) {
  return createAssistantMessage({ content, source: { provider: 'dsh-magpie-connector', model, replayState } })
}
const continueInput = { role: 'user', content: [{ type: 'text', text: 'continue' }] } as const
const incomplete = { type: 'response.incomplete', response: { id: 'r1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } }
const reasoningItem = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'reasoning summary' }], encrypted_content: 'opaque-encrypted-reasoning' }
// The terminal response backfills encryption after thinking_end, as real pi-ai does.
const reasoningTool = (reasoning = reasoningItem) => [
  { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoning.id, summary: [] } },
  { type: 'response.output_item.done', output_index: 0, item: { ...reasoning, encrypted_content: undefined } },
  { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_comment', role: 'assistant', content: [], phase: 'commentary' } },
  { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: 'msg_comment', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will read it.' }] } },
  ...responseTool().slice(0, -1).map(event => ({ ...event, output_index: 2 })),
  { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [reasoning] } },
]

test('real BlockAssembler max-tokens drops the tool and its replay before the next Responses request', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  gateway.handlers.set(`POST ${p.path}`, sse([...responseTool().slice(0, -1), incomplete]))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  expect(assembler.finish).toMatchObject({ kind: 'max-tokens' })
  expect(assembler.blocks()).toEqual([])
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('done')))
  const history = assistant(p.model, assembler.blocks(), assembler.replayState)
  const next = await assemble(adapter.stream(options(p.model, [history, continueInput])))
  expect(next.assembler.finish).toMatchObject({ kind: 'stop' })
  const body = gateway.requests[1]!.body as { input: { type?: string }[] }
  expect(body.input.filter(item => item.type === 'function_call' || item.type === 'function_call_output')).toEqual([])
  expect(JSON.stringify(body)).not.toContain('No result provided')
  expect(assembler.replayState?.blocks).toEqual([])
})

test('max-tokens prunes tool metadata in step with mixed reasoning/text content, without losing encryption', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  gateway.handlers.set(`POST ${p.path}`, sse([...reasoningTool().slice(0, -1), { ...incomplete, response: { ...incomplete.response, output: [reasoningItem] } }]))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  expect(assembler.finish.kind).toBe('max-tokens')
  expect(assembler.blocks().map(block => block.type)).toEqual(['reasoning', 'text'])
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('done')))
  await assemble(adapter.stream(options(p.model, [assistant(p.model, assembler.blocks(), assembler.replayState), continueInput])))
  const body = gateway.requests[1]!.body as { input: { type?: string }[] }
  expect(body.input).toContainEqual(reasoningItem)
  expect(body.input.filter(item => item.type === 'function_call' || item.type === 'function_call_output')).toEqual([])
  expect(assembler.replayState?.blocks).toHaveLength(2)
})

for (const p of protocols) {
  for (const change of ['edit', 'remove'] as const) test(`${p.path}: current DSH text wins over ${change === 'edit' ? 'edited' : 'removed'} replay text`, async () => {
    const { gateway, adapter } = await setup()
    gateway.handlers.set(`POST ${p.path}`, sse(p.text('ORIGINAL-ASSISTANT-TEXT')))
    const { assembler } = await assemble(adapter.stream(options(p.model)))
    gateway.handlers.set(`POST ${p.path}`, sse(p.text('done')))
    const content: ContentBlock[] = change === 'edit' ? [{ type: 'text', text: 'HOST-EDITED-TEXT' }] : []
    await assemble(adapter.stream(options(p.model, [assistant(p.model, content, assembler.replayState), continueInput])))
    const wire = JSON.stringify(gateway.requests[1]!.body)
    expect(wire).not.toContain('ORIGINAL-ASSISTANT-TEXT')
    if (change === 'edit') expect(wire).toContain('HOST-EDITED-TEXT')
  })
}

test('Responses encrypted reasoning and text signatures survive an actual assembled tool round trip', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  gateway.handlers.set(`POST ${p.path}`, sse(reasoningTool()))
  const { assembler, chunks } = await assemble(adapter.stream(options(p.model)))
  expect(assembler.finish.kind).toBe('tool-calls')
  const tool = assembler.blocks().find(block => block.type === 'tool-call')!
  expect(tool.id).toBe('c1|fc_1')
  expect(tool.arguments).toBe('{ "path": "a" }')
  const replay = assembler.replayState!
  expect(replay.blocks).toEqual([
    expect.objectContaining({ type: 'reasoning', thinkingSignature: JSON.stringify(reasoningItem) }),
    expect.objectContaining({ type: 'text', textSignature: expect.any(String) }),
    expect.objectContaining({ type: 'tool-call' }),
  ])
  expect(replay.response).not.toHaveProperty('pi')
  expect(replay.response).not.toHaveProperty('content')
  expect(JSON.stringify(replay)).not.toContain('I will read it.')
  expect(JSON.stringify(replay)).not.toContain('"path"')
  expect(chunks.at(-2)?.type).toBe('usage')
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('done')))
  const history = assembler.message({ provider: 'dsh-magpie-connector', model: p.model, replayState: replay })
  await assemble(adapter.stream(options(p.model, [history, createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false })])))
  const body = gateway.requests[1]!.body as { input: unknown[] }
  expect(body.input).toContainEqual(reasoningItem)
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'message', id: 'msg_comment', phase: 'commentary', content: [expect.objectContaining({ text: 'I will read it.' })] }))
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'c1', id: 'fc_1', name: 'read_file', arguments: '{"path":"a"}' }))
  expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'c1', output: 'ok' })
  expect(JSON.stringify(body)).not.toContain('No result provided')
})

test('empty encrypted Responses reasoning is retained across tools, not mistaken for absent content', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  const opaque = { ...reasoningItem, summary: [] }
  gateway.handlers.set(`POST ${p.path}`, sse(reasoningTool(opaque)))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  expect(assembler.blocks()[0]).toEqual({ type: 'reasoning', text: '' })
  const tool = assembler.blocks().find(block => block.type === 'tool-call')!
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('done')))
  await assemble(adapter.stream(options(p.model, [assistant(p.model, assembler.blocks(), assembler.replayState), createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false })])))
  expect((gateway.requests[1]!.body as { input: unknown[] }).input).toContainEqual(opaque)
})

test('Chat reasoning field signature and tool pairing both survive replay', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[1]!
  gateway.handlers.set(`POST ${p.path}`, sse([{ id: 'r1', choices: [{ index: 0, delta: { reasoning_content: 'CHAT-REASONING' }, finish_reason: null }] }, ...chatTool()]))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  const tool = assembler.blocks().find(block => block.type === 'tool-call')!
  expect(assembler.replayState?.blocks?.[0]).toMatchObject({ type: 'reasoning', thinkingSignature: 'reasoning_content' })
  gateway.handlers.set(`POST ${p.path}`, sse(chatText('done')))
  await assemble(adapter.stream(options(p.model, [assistant(p.model, assembler.blocks(), assembler.replayState), createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false })])))
  expect((gateway.requests[1]!.body as { messages: unknown[] }).messages).toContainEqual(expect.objectContaining({ role: 'assistant', reasoning_content: 'CHAT-REASONING', tool_calls: [expect.objectContaining({ id: 'c1' })] }))
})

test('Chat tool ids and actual results survive replay through the real assembler', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[1]!
  gateway.handlers.set(`POST ${p.path}`, sse(chatTool()))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  const tool = assembler.blocks().find(block => block.type === 'tool-call')!
  gateway.handlers.set(`POST ${p.path}`, sse(chatText('done')))
  await assemble(adapter.stream(options(p.model, [assistant(p.model, assembler.blocks(), assembler.replayState), createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false })])))
  const body = gateway.requests[1]!.body as { messages: unknown[] }
  expect(body.messages).toContainEqual(expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } })] }))
  expect(body.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'c1', content: 'ok' }))
  expect(JSON.stringify(body)).not.toContain('No result provided')
})

for (const change of ['edit', 'remove'] as const) test(`changed reasoning (${change}) cannot restore old summary through its opaque signature`, async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  gateway.handlers.set(`POST ${p.path}`, sse(reasoningTool()))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  const content: ContentBlock[] = change === 'edit' ? [{ type: 'reasoning', text: 'HOST-EDITED-REASONING' }, ...assembler.blocks().slice(1)] : assembler.blocks().slice(1, 2)
  const tool = content.find(block => block.type === 'tool-call')
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('done')))
  await assemble(adapter.stream(options(p.model, [assistant(p.model, content, assembler.replayState), ...(tool ? [createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false })] : []), continueInput])))
  const wire = JSON.stringify(gateway.requests[1]!.body)
  expect(wire).not.toContain('reasoning summary')
  expect(wire).not.toContain('opaque-encrypted-reasoning')
  expect(wire).not.toContain('No result provided')
  if (change === 'edit') expect(wire).toContain('HOST-EDITED-REASONING')
  else expect(wire).not.toContain('function_call')
})

test('legacy response.pi is never a source of content or hidden calls', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  const legacy = { response: { pi: { role: 'assistant', api: 'openai-responses', provider: 'dsh-magpie-connector', model: p.model, content: [{ type: 'text', text: 'LEGACY-REMOVED-TEXT' }, { type: 'toolCall', id: 'old|fc_old', name: 'read_file', arguments: { path: 'removed' } }], stopReason: 'toolUse', timestamp: 0 } } }
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('done')))
  await assemble(adapter.stream(options(p.model, [assistant(p.model, [{ type: 'text', text: 'CURRENT-TEXT' }], legacy), continueInput])))
  const wire = JSON.stringify(gateway.requests[0]!.body)
  expect(wire).toContain('CURRENT-TEXT')
  expect(wire).not.toContain('LEGACY-REMOVED-TEXT')
  expect(wire).not.toContain('function_call')
  expect(wire).not.toContain('No result provided')
})

test('mismatched or malformed replay metadata degrades to current content', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[0]!
  gateway.handlers.set(`POST ${p.path}`, sse(responseText('current')))
  const { assembler } = await assemble(adapter.stream(options(p.model)))
  const replay = assembler.replayState!
  for (const state of [
    { ...replay, blocks: [] },
    { ...replay, response: { ...(replay.response as object), version: -1 } },
    { ...replay, response: { ...(replay.response as object), model: 'other-model' } },
    { ...replay, blocks: [null] },
    { ...replay, blocks: [{ type: 'reasoning', thinkingSignature: 42 }] },
  ] satisfies ReplayEnvelope[]) {
    const { assembler: next } = await assemble(adapter.stream(options(p.model, [assistant(p.model, assembler.blocks(), state), continueInput])))
    expect(next.finish.kind).toBe('stop')
    expect(JSON.stringify(gateway.requests.at(-1)!.body)).toContain('current')
  }
})

for (const p of protocols) test(`${p.path}: partial error has no replay envelope`, async () => {
  const { gateway, adapter } = await setup()
  const events = p.path === '/v1/responses' ? [...responseTool().slice(0, -1), { type: 'response.failed', response: { status: 'failed' } }] : [...chatTool().slice(0, 1), { error: { message: 'failed' } }]
  gateway.handlers.set(`POST ${p.path}`, sse(events))
  const { assembler, chunks } = await assemble(adapter.stream(options(p.model)))
  expect(assembler.finish.kind).toBe('error')
  expect(chunks.at(-1)).not.toHaveProperty('replayState')
  expect(assembler.replayState).toBeUndefined()
})

test('cancelled partial content has no unsafe full-message replay', async () => {
  const { gateway, adapter } = await setup()
  const p = protocols[1]!
  const controller = new AbortController()
  gateway.handlers.set(`POST ${p.path}`, sse([chatText()[0]], false))
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({ ...options(p.model), signal: controller.signal })) {
    chunks.push(chunk)
    if (chunk.type === 'text-delta') controller.abort()
  }
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
  expect(chunks.at(-1)).not.toHaveProperty('replayState')
})
