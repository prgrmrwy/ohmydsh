import { afterEach, expect, test } from 'vitest'
import { BlockAssembler, type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm/message'
import { collect, mountRealHost, until } from './support/host.js'
import { createGateway, json, sse } from './support/gateway.js'
import { lineCredentials, LINE_ID } from './support/line.js'
import { responseText, responseTool } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const MODEL = 'codex/gpt-6.1-sol'
const CODEX = 'dsh-magpie-connector-codex', OTHER = 'dsh-magpie-connector-other'
const reasoningItem = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'reasoning summary' }], encrypted_content: 'opaque-encrypted-reasoning' }
const reasoningTool = () => [
  { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoningItem.id, summary: [] } },
  { type: 'response.output_item.done', output_index: 0, item: { ...reasoningItem, encrypted_content: undefined } },
  ...responseTool().slice(0, -1).map(event => ({ ...event, output_index: 1 })),
  { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [reasoningItem] } },
]
const user = { role: 'user', content: [{ type: 'text', text: 'U' }] } as const
const catalog = { data: [{ id: MODEL, owned_by: 'codex', native_endpoints: ['/v1/responses'] }, { id: 'x/y' }] }

async function mount(home?: string, gw?: Awaited<ReturnType<typeof createGateway>>) {
  const g = gw ?? await createGateway()
  g.handlers.set('GET /v1/models', json(catalog))
  const host = await mountRealHost({ ...(home ? { home } : {}), credentials: lineCredentials('mk-r'), settings: home ? undefined : { lines: [{ id: LINE_ID, baseUrl: g.baseUrl, accessMode: 'direct' }] } })
  if (!gw) cleanup.push(g.close)
  cleanup.push(() => host.dispose())
  await until(() => host.ownRoutes().length === 2, 'routes')
  return { g, host }
}
async function firstTurn(host: Awaited<ReturnType<typeof mount>>['host'], provider = CODEX) {
  const assembler = new BlockAssembler()
  for await (const chunk of host.llm.stream({ provider, model: MODEL, messages: [user] } as never) as AsyncIterable<StreamChunk>) assembler.push(chunk)
  const tool = assembler.blocks().find(b => b.type === 'tool-call')!
  return { assembler, tool }
}
const history = (assembler: BlockAssembler, tool: ContentBlock & { type: 'tool-call' }, provider = CODEX) => [
  user, assembler.message({ provider, model: MODEL, replayState: assembler.replayState }),
  createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false }),
] as GenerateOptions['messages']
const nextBody = async (host: Awaited<ReturnType<typeof mount>>['host'], g: Awaited<ReturnType<typeof createGateway>>, provider: string, messages: GenerateOptions['messages']) => {
  g.handlers.set('POST /v1/responses', sse(responseText('done')))
  g.requests.length = 0
  const chunks = await collect(host.llm.stream({ provider, model: MODEL, messages } as never))
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  return g.requests.find(r => r.path === '/v1/responses')!.body as { input: Record<string, unknown>[] }
}

test('test_owner_replay_01 spec Scenario "归属 route 上续聊保留推理元数据"', async () => {
  const { g, host } = await mount()
  g.handlers.set('POST /v1/responses', sse(reasoningTool()))
  const { assembler, tool } = await firstTurn(host)
  const messages = history(assembler, tool as never)
  for (const body of [await nextBody(host, g, CODEX, messages)]) {
    expect(body.input).toContainEqual(reasoningItem)
    expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'c1' }))
    expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'c1' }))
  }
  // Restart: rebuild runtime + adapter on the same home/gateway.
  const home = host.home
  await host.dispose()
  const restarted = await mount(home, g)
  const body = await nextBody(restarted.host, g, CODEX, messages)
  expect(body.input).toContainEqual(reasoningItem)
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'c1' }))
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'c1' }))
})

test('test_owner_replay_02 spec Scenario "跨本插件 route 续聊仍视为同模型"', async () => {
  const { g, host } = await mount()
  g.handlers.set('POST /v1/responses', sse(reasoningTool()))
  const { assembler, tool } = await firstTurn(host)
  expect(host.ownRoutes()).toContain(OTHER)
  // The adapter owns both routes, so the host keeps replayState sourced from -codex when dispatching on -other.
  const body = await nextBody(host, g, OTHER, history(assembler, tool as never))
  expect(body.input).toContainEqual(reasoningItem)
})

test('test_owner_replay_03 spec Scenario "篡改或外来回放退化为普通历史"', async () => {
  const { g, host } = await mount()
  g.handlers.set('POST /v1/responses', sse(reasoningTool()))
  const { assembler, tool } = await firstTurn(host)
  const replay = assembler.replayState as { response: Record<string, unknown>; blocks: unknown[] }
  const text = assembler.blocks()
  const mk = (content: readonly ContentBlock[], state: unknown, provider: string) => [user, createAssistantMessage({ content, source: { provider, model: MODEL, replayState: state as never } }), createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'ok' }], isError: false })] as GenerateOptions['messages']
  const edited = text.map((b, i) => i === 0 ? { ...b, text: 'EDITED' } : b) as ContentBlock[]
  const cases = [
    mk(text, { ...replay, response: { ...replay.response, provider: CODEX } }, CODEX),
    mk(edited, replay, CODEX),
    mk(text, replay, 'dsh-magpie-connector'),
  ]
  for (const messages of cases) {
    const body = await nextBody(host, g, CODEX, messages)
    expect(JSON.stringify(body)).not.toContain('opaque-encrypted-reasoning')
  }
})
