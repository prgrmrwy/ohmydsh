import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  CallId,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { activeBindingContext, cleanedBindingContext, installContext } from '../src/host/context.js'
import { installSubagentInheritance, rememberBind } from '../src/host/policy.js'
import type { OperationRecord } from '../src/wire.js'

const contexts: Context[] = []

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Deterministic public LLM fixture: each real AgentLoop step consumes one response. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.script.shift()
    if (response === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of response) yield chunk
  }
}

function operation(state: 'admitted' | 'cleaned' | 'released' = 'admitted'): OperationRecord {
  return {
    schemaVersion: 2,
    operationId: 'operation-12345678',
    repoRoot: '/repo',
    gitCommonDir: '/repo/.git',
    baseRef: 'main',
    baseCommit: 'abc',
    taskBranch: 'ws/task',
    worktreePath: '/repo/.worktrees/task',
    taskHash: 'hash',
    dependencyMode: 'lean',
    dshHome: '/repo/.git/ws/home/operation-12345678',
    phase: 'prepared',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    binding: {
      mode: 'source-session',
      sourceSessionId: 'session-a',
      state,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

async function harness(responses: number): Promise<{ ctx: Context; adapter: ScriptedAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(Array.from({ length: responses }, (_, index) => textResponse(`reply-${index + 1}`)))
  ctx.llm.registerAdapter(['scripted'], adapter)
  return { ctx, adapter }
}

async function createBoundAgent(
  ctx: Context,
  record: OperationRecord,
  seed?: readonly SessionEvent[],
): Promise<AgentHandle> {
  return ctx.agents.create({
    sessionId: SessionId('session-a'),
    meta: { cwd: record.repoRoot },
    ...(seed === undefined ? {} : { seed }),
    agentOptions: { provider: 'scripted', model: 'scripted' },
    setup(agentCtx) {
      installContext(agentCtx.agent, record)
    },
  })
}

async function step(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
}

function runtimeContextEvents(agent: Agent): SessionEvent<'user/message'>[] {
  return agent.session.events.flatMap(event =>
    event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
      ? [event]
      : [],
  )
}

function eventText(event: SessionEvent<'user/message'>): string {
  return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('Worktree Session AgentLoop runtime-context projection', () => {
  it('projects the first active snapshot once, skips identical later turns, and restores dedupe from a public seed', async () => {
    const record = operation()
    const { ctx, adapter } = await harness(3)
    let handle = await createBoundAgent(ctx, record)

    await step(handle.agent, 'first')
    expect(runtimeContextEvents(handle.agent)).toHaveLength(1)
    expect(eventText(runtimeContextEvents(handle.agent)[0]!)).toContain(activeBindingContext(record))

    await step(handle.agent, 'same context, later turn')
    expect(runtimeContextEvents(handle.agent)).toHaveLength(1)

    const seed = [...handle.agent.session.events]
    await handle.dispose()
    handle = await createBoundAgent(ctx, record, seed)
    await step(handle.agent, 'cold replay')

    expect(runtimeContextEvents(handle.agent)).toHaveLength(1)
    expect(runtimeContextEvents(handle.agent).filter(event => event.seq >= seed.length)).toHaveLength(0)
    expect(adapter.requests).toHaveLength(3)
  })

  it('restores an active snapshot once after a surface replacement shadows it', async () => {
    const record = operation()
    const { ctx } = await harness(3)
    const { agent } = await createBoundAgent(ctx, record)

    await step(agent, 'first')
    const first = runtimeContextEvents(agent)[0]
    if (first === undefined) throw new Error('first step did not project runtime context')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: first.seq, end: first.seq },
      sourceEventSeqs: [first.seq],
    })

    await step(agent, 'after compaction')
    expect(runtimeContextEvents(agent)).toHaveLength(2)
    expect(eventText(runtimeContextEvents(agent)[1]!)).toBe(eventText(first))

    await step(agent, 'same context after recovery')
    expect(runtimeContextEvents(agent)).toHaveLength(2)
  })

  it('inherits the exact parent binding into an unpublished child before its first step', async () => {
    const record = operation()
    const { ctx } = await harness(2)
    const parent = await createBoundAgent(ctx, record)
    rememberBind(ctx, parent.agent.id as string, record)
    const child = await ctx.agents.create({
      sessionId: SessionId('session-child'),
      meta: { cwd: record.repoRoot, parentSession: parent.agent.id, origin: 'subagent', delegationDepth: 1 },
      agentOptions: { provider: 'scripted', model: 'scripted' },
      setup(childCtx) { installSubagentInheritance(childCtx) },
    })
    await step(child.agent, 'child first step')
    expect(runtimeContextEvents(child.agent)).toHaveLength(1)
    expect(eventText(runtimeContextEvents(child.agent)[0]!)).toContain(activeBindingContext(record))
    await step(child.agent, 'child later step')
    expect(runtimeContextEvents(child.agent)).toHaveLength(1)
  })

  it('keeps a cleaned Session deny-all guard on the real ToolRuntime dispatch path', async () => {
    const cleaned = operation('cleaned')
    const { ctx } = await harness(1)
    let bodyCalls = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'read',
      description: 'test read fixture',
      parameters: { file_path: { type: 'string', required: true } },
      async execute() { bodyCalls += 1; return [{ type: 'text', text: 'must not execute' }] },
    }))
    const { agent } = await createBoundAgent(ctx, cleaned)
    rememberBind(ctx, agent.session.id as string, cleaned)
    const result = await ctx.tools.execute({
      callId: CallId('cleaned-read'),
      name: 'read',
      arguments: { file_path: cleaned.worktreePath + '/file.txt' },
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.isError && result.error.message).toMatch(/已清理/)
    expect(bodyCalls).toBe(0)
  })

  it('removes the cleaned guard/context on release and emits the standard cleared projection once', async () => {
    const cleaned = operation('cleaned')
    const released = operation('released')
    const { ctx } = await harness(2)
    let bodyCalls = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'read',
      description: 'release fixture',
      parameters: { file_path: { type: 'string', required: true } },
      async execute() { bodyCalls += 1; return [{ type: 'text', text: 'ordinary' }] },
    }))
    const { agent } = await createBoundAgent(ctx, cleaned)
    rememberBind(ctx, agent.session.id as string, cleaned)
    await step(agent, 'cleaned')
    rememberBind(ctx, agent.session.id as string, released)
    const result = await ctx.tools.execute({ callId: CallId('released-read'), name: 'read', arguments: { file_path: '/repo/file.txt' }, agent, signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect(bodyCalls).toBe(1)
    await step(agent, 'released')
    const projections = runtimeContextEvents(agent)
    expect(projections).toHaveLength(2)
    expect(eventText(projections[0]!)).toContain('已清理')
    expect(eventText(projections[1]!)).toContain('Current runtime context')
    expect(eventText(projections[1]!)).not.toContain('Worktree Session（已清理）')
    rememberBind(ctx, agent.session.id as string, released)
    expect(await ctx.tools.execute({ callId: CallId('released-read-again'), name: 'read', arguments: { file_path: '/repo/again.txt' }, agent, signal: new AbortController().signal })).toMatchObject({ isError: false })
  })

  it('adds one terminal snapshot for active to cleaned and does not repeat it', async () => {
    const active = operation()
    const cleaned = operation('cleaned')
    const { ctx } = await harness(3)
    const { agent } = await createBoundAgent(ctx, active)

    await step(agent, 'active')
    installContext(agent, cleaned)
    installContext(agent, cleaned)
    await step(agent, 'cleaned')

    expect(runtimeContextEvents(agent)).toHaveLength(2)
    expect(eventText(runtimeContextEvents(agent)[1]!)).toContain(cleanedBindingContext(cleaned))

    await step(agent, 'still cleaned')
    expect(runtimeContextEvents(agent)).toHaveLength(2)
  })
})
