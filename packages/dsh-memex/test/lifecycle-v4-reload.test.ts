import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MEMEX_SOURCE_KIND, registerMemexLifecycle } from '../src/lifecycle/index.js'
import type { ScopeService } from '../src/scope/types.js'

// Spec runtime-api-migration: a change that writes into persisted sessions must
// be proven by reloading through the target runtime's own persistence path.
// DSH 0.2.0 (format v4) refuses a `kind: 'plugin'` source on read, so the old
// memex shape would have produced a session that cannot be reopened.

class OneReply extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return Promise.resolve({ provider, id: model, name: model }) }
  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const route = { scope: 'repo', home: '/memex/repo', publish: 'internal' as const, publishKnown: true,
  memory: true, source: 'derived' as const, created: false, workspacePaths: ['/repo'] }
const scopes: ScopeService = {
  resolve: () => route, list: () => [route], resolveByName: () => route, ensure: value => value,
  bindingFor: () => undefined, accessFor: scope => ({ current: scope, read: [scope], write: [scope, 'personal'] }),
}

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

async function host(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['scripted'], new OneReply())
  return ctx
}

describe('memex recall guidance in a persisted session', () => {
  it('is written with the memex source kind and the session reopens through persistence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'memex-v4-')); dirs.push(root)
    const writer = await host(root)
    registerMemexLifecycle(writer, scopes)
    const handle = await writer.agents.create({ sessionId: SessionId('memex-v4'), meta: { cwd: '/repo' }, agentOptions: { provider: 'scripted', model: 'scripted' } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    // Whatever memex wrote is what must survive a reopen; identify it by text so
    // the reload assertion is independent of the source shape under test.
    const isRecall = (event: { type: string; data: unknown }): boolean => event.type === 'user/message'
      && JSON.stringify((event.data as { content?: unknown }).content ?? '').includes('Memex Memory System Active')
    expect(handle.agent.session.snapshotEvents().filter(isRecall)).toHaveLength(1)
    await handle.dispose()
    await writer.fiber.dispose()

    // A fresh Host reads the stored log through the same persistence backend.
    // On DSH 0.2.0 this is the v4 admission path that refuses `kind: 'plugin'`.
    const reader = await host(root)
    const stored = await reader.sessionPersistence.open(SessionId('memex-v4'), 'read')
    let events
    try { events = (await stored.read()).events } finally { await stored.close() }
    const reloaded = events.filter(isRecall)
    expect(reloaded).toHaveLength(1)
    expect((reloaded[0]!.data as { source: unknown }).source).toEqual({ kind: MEMEX_SOURCE_KIND, form: 'instructions' })
    await reader.fiber.dispose()
  })
})
