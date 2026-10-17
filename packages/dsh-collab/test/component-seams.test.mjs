import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function textResponse(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResponse(name, args) {
  const id = ToolCallId('component-call')
  const raw = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: raw },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: raw } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  requests = []
  constructor(script) { super(); this.script = [...script] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    this.requests.push(options)
    const step = this.script.shift()
    assert.ok(step, 'unexpected model request: script exhausted')
    const chunks = typeof step === 'function' ? await step(options) : step
    for (const chunk of chunks) yield chunk
  }
}

// The parent shell is deliberately fixture-only: no user HOME or credentials.
// Refuse an unisolated invocation before constructing any runtime component.
const fixtureHome = process.env.DSH_COLLAB_COMPONENT_HOME
assert.ok(fixtureHome, 'run with DSH_COLLAB_COMPONENT_HOME and HOME/DSH_HOME pointing to a fresh directory')
assert.equal(process.env.HOME, fixtureHome)
assert.equal(process.env.DSH_HOME, fixtureHome)

async function harness(t, script, options = {}) {
  const parent = await realpath(fixtureHome)
  const root = await mkdtemp(join(parent, 'case-'))
  const home = join(root, 'home')
  const cwd = join(root, 'workspace-b')
  await mkdir(home); await mkdir(cwd)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  const errors = []
  ctx.on('agent/error', payload => { errors.push(payload.error); return undefined })
  t.after(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      const checked = await realpath(root)
      assert.equal(dirname(checked), parent)
      assert.ok(basename(checked).startsWith('case-'))
      await rm(checked, { recursive: true })
    }
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  if (options.persistence) await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['scripted'], adapter)
  const handle = await ctx.agents.create({
    sessionId: SessionId('component-b'), meta: { cwd },
    agentOptions: { provider: 'scripted', model: 'scripted' },
  })
  function assertCompleted(turns, requests) {
    assert.deepEqual(errors, [], 'AgentLoop must not contain a hidden driver error')
    assert.equal(adapter.script.length, 0, 'all scripted responses consumed')
    assert.equal(adapter.requests.length, requests, 'no extra exhausted model request')
    const ended = handle.agent.session.snapshotEvents().filter(e => e.type === 'turn/end')
    assert.equal(ended.length, turns)
    for (const event of ended) assert.equal(event.data.reason.kind, 'completed')
  }
  return { ctx, adapter, agent: handle.agent, root, cwd, handle, assertCompleted }
}

function input(text, source = { kind: 'user' }) {
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

function requestText(request) { return JSON.stringify(request.messages) }

test('component-persistence: plugin source and exact message ID survive JSONL checkpoint/reopen', { timeout: 10000 }, async t => {
  const { ctx, agent, root, handle, assertCompleted } = await harness(t, [textResponse('persisted')], { persistence: true })
  const message = input('collab-pointer-persisted', { kind: 'plugin:dsh-collab' })
  agent.followup(message)
  await agent.whenIdle()
  assertCompleted(1, 1)
  assert.equal(await ctx.sessions.flush(agent.session), true, 'real durability listener participated')
  await handle.dispose()
  await ctx.fiber.dispose()

  // Read the physical format with a new persistence owner, not the old in-memory
  // SessionStore. This does not resume an Agent or mount any preset.
  const reader = new Context()
  try {
    await reader.plugin(SessionStore)
    await reader.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    const stored = await reader.sessionPersistence.open(SessionId('component-b'), 'read')
    let events
    try { events = (await stored.read()).events } finally { await stored.close() }
    const admitted = events.filter(e => e.type === 'user/message' && e.data.id === message.id)
    assert.equal(admitted.length, 1)
    assert.equal(admitted[0].data.source.kind, 'plugin:dsh-collab')
    assert.deepEqual(admitted[0].data.content, message.content)
    assert.equal(reader.sessions.get(SessionId('component-b')), undefined, 'read did not activate a live session')
  } finally {
    await reader.fiber.dispose()
  }
})

// Component probes, not the consumer's 30 acceptance scenarios or an installed
// Host signal chain. Assertions below observe actual AgentLoop events/requests.
test('component-identity: model arguments cannot replace exec.agent', { timeout: 10000 }, async t => {
  const { ctx, agent, cwd, assertCompleted } = await harness(t, [toolResponse('probe_caller', { callerSessionId: 'forged-a' }), textResponse('done')])
  const seen = []
  ctx.tools.register(defineTool({
    name: 'probe_caller', description: 'Test execution identity only',
    parameters: { callerSessionId: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      seen.push({ forged: args.callerSessionId, id: exec.agent.id, sessionId: exec.agent.session.id, cwd: exec.agent.session.header.cwd })
      return { sessionId: exec.agent.id }
    },
  }))
  agent.followup(input('call probe_caller with forged-a'))
  await agent.whenIdle()
  assert.deepEqual(seen, [{ forged: 'forged-a', id: 'component-b', sessionId: 'component-b', cwd }])
  assertCompleted(1, 2)
})

test('component-idle: followup wakes idle and preserves plugin source/message identity', { timeout: 10000 }, async t => {
  const { agent, adapter, assertCompleted } = await harness(t, [textResponse('received')])
  const message = input('collab-pointer-idle', { kind: 'plugin:dsh-collab' })
  assert.equal(agent.status, 'idle')
  assert.equal(agent.followup(message), undefined)
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 1)
  assert.ok(requestText(adapter.requests[0]).includes('collab-pointer-idle'))
  const event = agent.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.id === message.id)
  assert.ok(event, 'actual admitted message is recorded')
  assert.equal(event.data.source.kind, 'plugin:dsh-collab')
  assertCompleted(1, 1)
})

test('component-busy: followup waits for the next turn, not the current model request', { timeout: 10000 }, async t => {
  const started = deferred(); const release = deferred()
  const { ctx, agent, adapter, assertCompleted } = await harness(t, [async () => { started.resolve(); await release.promise; return textResponse('first') }, textResponse('second')])
  const claims = []
  ctx.on('agent/inbox/claimed', payload => { claims.push(payload); return undefined })
  const initial = input('initial-turn')
  agent.followup(initial)
  try {
    await started.promise
    assert.equal(agent.status, 'running')
    const pointer = input('collab-pointer-busy', { kind: 'plugin:dsh-collab' })
    agent.followup(pointer)
    assert.equal(adapter.requests.length, 1)
    assert.ok(!requestText(adapter.requests[0]).includes('collab-pointer-busy'))
    release.resolve()
    await agent.whenIdle()
    assert.equal(adapter.requests.length, 2)
    assert.ok(requestText(adapter.requests[1]).includes('collab-pointer-busy'))
    const admitted = agent.session.snapshotEvents().filter(e => e.type === 'user/message' && [initial.id, pointer.id].includes(e.data.id))
    assert.equal(admitted.length, 2)
    const turns = claims.filter(c => [initial.id, pointer.id].includes(c.message.id))
    assert.equal(turns.length, 2)
    assert.notEqual(turns[0].turn, turns[1].turn)
    assert.equal(admitted[1].data.id, pointer.id)
    assertCompleted(2, 2)
  } finally {
    release.resolve()
  }
})
