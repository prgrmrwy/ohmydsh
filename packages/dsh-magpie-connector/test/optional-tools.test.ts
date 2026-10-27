import { afterEach, expect, test, vi } from 'vitest'
import { BlockAssembler, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm/message'
import type { Model } from '@earendil-works/pi-ai'
import type { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { models, responseText, chatText, responseTool, chatTool } from './support/wire.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
})
const protocols = [
  { model: 'codex/gpt-6.1-sol', path: '/v1/responses', text: responseText, tool: responseTool, responses: true },
  { model: 'deepseek/deepseek-flash', path: '/v1/chat/completions', text: chatText, tool: chatTool, responses: false },
]
const bashTool = {
  name: 'bash', description: 'Run a fixture command; permission fields are optional.',
  parameters: {
    type: 'object', required: ['command'],
    properties: {
      command: { type: 'string' },
      sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
      justification: { type: 'string' },
    },
  },
}
const goalTool = {
  name: 'update_goal', description: 'Resume omits edit-only and blocked-only fields.',
  parameters: {
    type: 'object', required: ['action', 'goal_id', 'revision'],
    properties: {
      action: { type: 'string', enum: ['edit', 'resume', 'blocked'] },
      goal_id: { type: 'string' }, revision: { type: 'integer' },
      objective: { type: 'string' }, max_goal_rounds: { type: 'integer' }, blocked_reason: { type: 'string' },
    },
  },
}
const readTool = { name: 'read_file', description: 'Read a fixture.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
type WireTool = { name: string; parameters: unknown; strict?: boolean }
type WireBody = { tools?: (WireTool | { function: WireTool })[]; input?: unknown[]; messages?: unknown[] }
const options = (model: string, extra: Partial<GenerateOptions> = {}): GenerateOptions => ({
  provider: 'dsh-magpie-connector', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }], ...extra,
})
async function assemble(adapter: MagpieAdapter, input: GenerateOptions) {
  const result = new BlockAssembler()
  for await (const chunk of adapter.stream(input)) result.push(chunk)
  if (result.finish.kind === 'error') throw new Error(JSON.stringify(result.finish))
  return result
}
async function setup(p: typeof protocols[number]) {
  const store = new SettingsStore()
  store.value.baseUrl = 'https://gateway.invalid/v1'
  const runtime = new MagpieRuntime(credentialsMock('fixture-key').service, store)
  cleanup.push(() => runtime.dispose())
  const bodies: WireBody[] = []
  let events: unknown[] = p.text()
  // Keep the real SDK serialization and GatewayTransport.fetchFor Request boundary;
  // only its final request port is fake, so no network or real credentials are used.
  vi.spyOn(runtime.transport, 'request').mockImplementation(async (_identity, method, path, init) => {
    const url = new URL(path, store.value.baseUrl)
    if (method === 'GET' && path === '/models') return Response.json(models)
    expect(method).toBe('POST')
    expect(url.pathname).toBe(p.path)
    expect(typeof init?.body).toBe('string')
    bodies.push(JSON.parse(init!.body as string))
    return new Response(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  })
  await runtime.start()
  const adapter = new MagpieAdapter(runtime)
  // Observe the unmodified context returned by the actual bridge, not a helper mock.
  const context = vi.spyOn(adapter as unknown as { context(options: GenerateOptions, model: Model<string>): Promise<ReturnType<typeof normalizeContext>> }, 'context')
  return { adapter, bodies, context, reply: (next: unknown[]) => { events = next } }
}
const wireTools = (body: WireBody, responses: boolean): WireTool[] => (body.tools ?? []).map(tool => responses ? tool as WireTool : (tool as { function: WireTool }).function)
// Promote the omission observation to the locally/live-proven candidate contract:
// ordinary Responses tools explicitly opt out; Chat keeps its existing omission.
function expectOrdinaryStrict(tool: WireTool, responses: boolean) {
  if (responses) expect(tool.strict).toBe(false)
  else expect(tool).not.toHaveProperty('strict')
}

for (const p of protocols) {
  for (const fixture of [bashTool, goalTool]) test(`${p.path}: ${fixture.name} preserves optional schema with ${p.responses ? 'explicit strict:false' : 'unchanged strict omission'}`, async () => {
    const { adapter, bodies, context } = await setup(p)
    const tools = structuredClone([fixture])
    const original = structuredClone(tools)
    expect((await assemble(adapter, options(p.model, { tools }))).finish).toMatchObject({ kind: 'stop' })
    expect(bodies).toHaveLength(1)
    const bridge = await context.mock.results[0]!.value
    expect(bridge.messages[0]).toMatchObject({ role: 'system', toolsAdded: original })
    const [tool] = wireTools(bodies[0]!, p.responses)
    expect(tool!.parameters).toEqual(original[0]!.parameters)
    expect(tools).toEqual(original) // No required/nullable/additionalProperties rewrite or mutation.
    expect(bodies[0]).not.toHaveProperty('strict')
    expect(bodies[0]).not.toHaveProperty('text')
    expectOrdinaryStrict(tool!, p.responses)
    expect(tool).toEqual({ ...original[0], ...(p.responses ? { type: 'function', strict: false } : {}) })
  })

  for (const tools of [undefined, []]) test(`${p.path}: ${tools ? 'empty' : 'omitted'} tools do not introduce tool fields`, async () => {
    const { adapter, bodies } = await setup(p)
    expect((await assemble(adapter, options(p.model, tools ? { tools } : {}))).finish.kind).toBe('stop')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toHaveProperty('tools')
    expect(bodies[0]).not.toHaveProperty('tool_choice')
    expect(bodies[0]).not.toHaveProperty('strict')
    expect(bodies[0]).not.toHaveProperty('text')
  })

  test(`${p.path}: newly available optional tool coexists with assembled tool-call/result history`, async () => {
    const { adapter, bodies, reply } = await setup(p)
    reply(p.tool())
    const first = await assemble(adapter, options(p.model, { tools: [readTool] }))
    expect(first.finish.kind).toBe('tool-calls')
    const call = first.blocks().find(block => block.type === 'tool-call')!
    reply(p.text('done'))
    const tools = structuredClone([readTool, bashTool, goalTool])
    const original = structuredClone(tools)
    const messages = [
      first.message({ provider: 'dsh-magpie-connector', model: p.model, replayState: first.replayState }),
      createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'ok' }], isError: false }),
    ]
    expect((await assemble(adapter, options(p.model, { tools, messages }))).finish.kind).toBe('stop')
    expect(bodies).toHaveLength(2)
    const declared = wireTools(bodies[1]!, p.responses)
    expect(declared.map(tool => tool.name)).toEqual(original.map(tool => tool.name))
    for (const [index, tool] of declared.entries()) {
      expect(tool.parameters).toEqual(original[index]!.parameters)
      expectOrdinaryStrict(tool, p.responses)
      expect(tool).toEqual({ ...original[index], ...(p.responses ? { type: 'function', strict: false } : {}) })
    }
    expect(tools).toEqual(original)
    for (const body of bodies) {
      expect(body).not.toHaveProperty('strict')
      expect(body).not.toHaveProperty('text')
    }
    expectOrdinaryStrict(wireTools(bodies[0]!, p.responses)[0]!, p.responses)
    if (p.responses) {
      expect(bodies[1]!.input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'c1', name: 'read_file' }))
      expect(bodies[1]!.input).toContainEqual({ type: 'function_call_output', call_id: 'c1', output: 'ok' })
    } else {
      expect(bodies[1]!.messages).toContainEqual(expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } })] }))
      expect(bodies[1]!.messages).toContainEqual({ role: 'tool', tool_call_id: 'c1', content: 'ok' })
    }
  })
}
