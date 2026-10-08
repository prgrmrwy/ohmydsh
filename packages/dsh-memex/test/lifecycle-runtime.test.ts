import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { emitAgentEvent, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
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

/** A model step that calls one tool, which makes the loop run another step with its result. */
function toolCallResponse(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const raw = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: raw },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: raw } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
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

async function harness(
  responses: number | StreamChunk[][],
  service: ScopeService = scopes(),
  sessionId = `memex-runtime-${typeof responses === 'number' ? responses : responses.length}`,
  options: { realTools?: boolean } = {},
) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  const lifecycle = registerMemexLifecycle(ctx, service)
  const written: string[][] = []
  // With real tools the model's recall/retro calls run through the real tool
  // implementations and report back to the lifecycle exactly as in production.
  if (options.realTools === true) {
    const runner: KernelRunner = async args => { written.push([...args]); return { ok: true, exitCode: 0, stdout: '', stderr: '' } }
    registerMemexTools(ctx, service, { runner, onToolSuccess: lifecycle.mark })
  }
  const script = typeof responses === 'number'
    ? Array.from({ length: responses }, (_, i) => textResponse(`reply-${i + 1}`))
    : responses
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['scripted'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId(sessionId), meta: { cwd: '/repo' }, agentOptions: { provider: 'scripted', model: 'scripted' } })
  return { ctx, adapter, lifecycle, handle, written }
}

async function step(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function requestText(request: GenerateOptions): string {
  return JSON.stringify(request.messages)
}

afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

/**
 * The real memex tools append recall telemetry under `$DSH_HOME`, which defaults
 * to the developer's own recall log. Without an isolated home every run of the
 * end-to-end tests below would add fixture rows to it and skew the very
 * statistics that log exists to support (same reason as acceptance.test.ts).
 */
let dshHome: string
beforeEach(() => {
  dshHome = mkdtempSync(join(tmpdir(), 'dsh-memex-runtime-home-'))
  vi.stubEnv('DSH_HOME', dshHome)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dshHome, { recursive: true, force: true })
})

describe('memex lifecycle with the real AgentLoop', () => {
  it('publishes startup guidance before the first model request', async () => {
    const { adapter, handle } = await harness(1)
    await step(handle.agent, 'start')
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('Memex Memory System Active')
    expect(requestText(adapter.requests[0]!)).toContain('Current memory scope: repo')
  })

  describe('write reminder', () => {
    /** Every assistant message the session recorded, in order, with the turn it belongs to. */
    function assistantMessages(ctx: Context, agent: Agent): { turn: number; text: string }[] {
      const seen: { turn: number; text: string }[] = []
      ctx.on('session/event', (session, event) => {
        if (session !== agent.session || event.type !== 'assistant/message') return
        const data = event.data as { turn: number; message: { content: { type: string; text?: string }[] } }
        seen.push({ turn: data.turn, text: data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') })
      })
      return seen
    }
    const reminderCount = (request: GenerateOptions) => requestText(request).split('Memex write reminder').length - 1

    it('does not add a model step to the turn that just finished', async () => {
      const { adapter, lifecycle, handle } = await harness(2)
      lifecycle.mark('recall', handle.agent.session)
      await step(handle.agent, 'finish')
      // The turn ends on the model's own reply: no request is spent on the reminder.
      expect(adapter.requests).toHaveLength(1)
      expect(reminderCount(adapter.requests[0]!)).toBe(0)
    })

    it('reaches the model with the next turn, exactly once', async () => {
      const { adapter, lifecycle, handle } = await harness(3)
      lifecycle.mark('recall', handle.agent.session)
      await step(handle.agent, 'first')
      await step(handle.agent, 'second')
      expect(adapter.requests).toHaveLength(2)
      expect(reminderCount(adapter.requests[1]!)).toBe(1)
      // Still unwritten, but a reminder already delivered is not repeated.
      await step(handle.agent, 'third')
      expect(adapter.requests).toHaveLength(3)
      expect(reminderCount(adapter.requests[2]!)).toBe(1)
    })

    it('starts no turn and sends no request on its own when the conversation goes quiet', async () => {
      const { adapter, lifecycle, handle } = await harness(2)
      lifecycle.mark('recall', handle.agent.session)
      await step(handle.agent, 'finish')
      await new Promise(resolve => setTimeout(resolve, 50))
      await handle.agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(handle.agent.status).toBe('idle')
    })

    it('is not delivered when the card gets written before the next turn', async () => {
      const { adapter, lifecycle, handle } = await harness(3)
      lifecycle.mark('recall', handle.agent.session)
      await step(handle.agent, 'first')
      lifecycle.mark('retro', handle.agent.session)
      await step(handle.agent, 'second')
      expect(reminderCount(adapter.requests[1]!)).toBe(0)
    })

    it('keeps the recall telemetry its real tool call produces inside the isolated home', async () => {
      const script = [toolCallResponse('c1', 'memex_recall', { query: 'topic' }), textResponse('ok')]
      const { handle } = await harness(script, scopes(), 'memex-telemetry-sandbox', { realTools: true })
      await step(handle.agent, 'look it up')
      // Present here means it was not written to the developer's own $DSH_HOME.
      const written = readdirSync(join(dshHome, 'plugins', 'dsh-memex')).filter(name => name.startsWith('recall-'))
      expect(written).toHaveLength(1)
    })

    it('leaves the answer as the last message of the turn even when the model then writes a card', async () => {
      // The reported failure, replayed through the real loop and the real
      // memex_retro tool. Turn 1 recalls and answers; the user returns, the
      // reminder rides along with turn 2, the model writes its card in that
      // turn and the turn still ends on a real answer.
      const script = [
        toolCallResponse('c1', 'memex_recall', { query: 'topic' }),
        textResponse('THE ANSWER'),
        toolCallResponse('c2', 'memex_retro', { slug: 'learned', title: 'Learned', body: 'body' }),
        textResponse('SECOND ANSWER'),
      ]
      const { ctx, adapter, handle, written } = await harness(script, scopes(), 'memex-answer-last', { realTools: true })
      const messages = assistantMessages(ctx, handle.agent)

      await step(handle.agent, 'question one')
      // Turn 1 recalled (tool step) and answered; nothing was added after the answer.
      expect(messages.map(m => [m.turn, m.text])).toEqual([[1, ''], [1, 'THE ANSWER']])
      expect(adapter.requests).toHaveLength(2)
      expect(adapter.requests.some(request => reminderCount(request) > 0)).toBe(false)

      await step(handle.agent, 'question two')
      expect(reminderCount(adapter.requests[2]!)).toBe(1)
      expect(written.some(args => args[0] === 'write')).toBe(true)
      expect(messages.filter(m => m.turn === 2).at(-1)!.text).toBe('SECOND ANSWER')
      // Writing the card is what ends the reminders: nothing is left to deliver.
      expect(adapter.requests).toHaveLength(4)
    })
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
