import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { emitAgentEvent, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMemexLifecycle } from '../src/lifecycle/index.js'
import { ScopeRuntime } from '../src/scope/runtime.js'
import { registerMemexTools, type KernelRunner } from '../src/tools/index.js'
import type { ScopeConfig, ScopeService } from '../src/scope/types.js'

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

async function harness(responses: number, service: ScopeService = scopes(), sessionId = `memex-runtime-${responses}`) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  const lifecycle = registerMemexLifecycle(ctx, service)
  const adapter = new ScriptedAdapter(Array.from({ length: responses }, (_, i) => textResponse(`reply-${i + 1}`)))
  ctx.llm.registerAdapter(['scripted'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId(sessionId), meta: { cwd: '/repo' }, agentOptions: { provider: 'scripted', model: 'scripted' } })
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
    emitAgentEvent(ctx, handle.agent, 'agent/created', { agent: handle.agent, source: 'compact' })
    await step(handle.agent, 'after compact')
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('Memex Memory System Active')
  })

  describe('switching memory while a session runs', () => {
    const on: ScopeConfig = { autoDerive: true, bindings: [], scopes: [{ name: 'repo', pathPrefixes: ['/repo'] }], workspaces: [] }
    const off: ScopeConfig = { ...on, workspaces: [{ path: '/repo', memory: false }] }

    function live(config: ScopeConfig) {
      const runtime = new ScopeRuntime(config, {
        homeDir: mkdtempSync(join(tmpdir(), 'dsh-memex-live-')), gitRemote: () => undefined, gitRoot: () => undefined,
      })
      const runner: KernelRunner = async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' })
      const calls: string[][] = []
      const tools = new Map<string, ToolDefinition>()
      registerMemexTools({
        logger: () => ({ warn: () => undefined }),
        tools: { register(definition: ToolDefinition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
      } as never, runtime.current, { runner: async (args, options) => { calls.push(args); return runner(args, options) } })
      const write = (agent: Agent) => tools.get('memex_write')!.execute({ slug: 'note', content: '---\ntitle: Note\n---\nBody\n' }, { agent } as never)
      return { runtime, calls, write }
    }

    it('reopening memory enables tools immediately but does not inject recall into a started session', async () => {
      const { runtime, calls, write } = live(off)
      const started = await harness(3, runtime.current, 'memex-reopen-started')
      await step(started.handle.agent, 'before')
      expect(requestText(started.adapter.requests[0]!)).not.toContain('Memex Memory System Active')
      await expect(write(started.handle.agent)).rejects.toThrow(/Memory is off/)

      runtime.replace(on)
      await expect(write(started.handle.agent)).resolves.toBeDefined()
      expect(calls).toEqual([['write', '--', 'note']])
      await step(started.handle.agent, 'after')
      expect(requestText(started.adapter.requests[1]!)).not.toContain('Memex Memory System Active')

      const next = await harness(1, runtime.current, 'memex-reopen-next')
      await step(next.handle.agent, 'fresh')
      expect(requestText(next.adapter.requests[0]!)).toContain('Memex Memory System Active')
    })

    it('closing memory mid-session refuses later tool calls without retracting injected recall', async () => {
      const { runtime, calls, write } = live(on)
      const started = await harness(2, runtime.current, 'memex-close-midway')
      await step(started.handle.agent, 'before')
      expect(requestText(started.adapter.requests[0]!)).toContain('Memex Memory System Active')

      runtime.replace(off)
      await expect(write(started.handle.agent)).rejects.toThrow(/Memory is off for this workspace/)
      expect(calls).toEqual([])
      await step(started.handle.agent, 'after')
      // The recall instructions already in the transcript stay there.
      expect(requestText(started.adapter.requests[1]!)).toContain('Memex Memory System Active')
    })
  })
})
