import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { emitAgentEvent, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { registerMemexLifecycle } from '../src/lifecycle/index.js'
import type { ScopeService } from '../src/scope/types.js'

const contexts: Context[] = []

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly script: StreamChunk[][]) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return Promise.resolve({ provider, id: model, name: model }) }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.script.shift()
    if (!response) throw new Error('script exhausted')
    for (const chunk of response) yield chunk
  }
}

function scopes(): ScopeService {
  const route = { scope: 'repo', home: '/memex/repo', publish: 'internal' as const, publishKnown: true,
    memory: true, source: 'derived' as const, created: false, workspacePaths: ['/repo'] }
  return {
    resolve: () => route,
    list: () => [route],
    resolveByName: () => route,
    ensure: value => value,
    bindingFor: () => undefined,
    accessFor: scope => ({ current: scope, read: [scope], write: [scope, 'personal'] }),
  }
}

async function harness(responses: number) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  const lifecycle = registerMemexLifecycle(ctx, scopes())
  const adapter = new ScriptedAdapter(Array.from({ length: responses }, (_, i) => textResponse(`reply-${i + 1}`)))
  ctx.llm.registerAdapter(['scripted'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId(`memex-runtime-${responses}`), meta: { cwd: '/repo' }, agentOptions: { provider: 'scripted', model: 'scripted' } })
  return { ctx, adapter, lifecycle, handle }
}

async function step(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function requestText(request: GenerateOptions): string {
  return JSON.stringify(request.messages)
}

afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('memex lifecycle with the real AgentLoop', () => {
  it('publishes startup guidance before the first model request', async () => {
    const { adapter, handle } = await harness(1)
    await step(handle.agent, 'start')
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('Memex Memory System Active')
    expect(requestText(adapter.requests[0]!)).toContain('Current memory scope: repo')
  })

  it('adds at most one reminder step after recall', async () => {
    const { adapter, lifecycle, handle } = await harness(2)
    lifecycle.mark('recall', handle.agent.session)
    await step(handle.agent, 'finish')
    expect(adapter.requests).toHaveLength(2)
    expect(requestText(adapter.requests[1]!)).toContain('Memex write reminder')
  })

  it('reinjects after a compact-source event while preserving write state', async () => {
    const { adapter, lifecycle, handle, ctx } = await harness(1)
    lifecycle.mark('recall', handle.agent.session)
    lifecycle.mark('write', handle.agent.session)
    emitAgentEvent(ctx, handle.agent, 'agent/session-start', { agent: handle.agent, source: 'compact' })
    await step(handle.agent, 'after compact')
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('Memex Memory System Active')
  })
})
