import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import * as TitleProvider from '@deepseek-ai/dsh-session-title-first-prompt-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'

class Adapter extends LlmAdapter {
  calls: GenerateOptions[] = []
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    const text = options.purpose === 'session-title' ? 'Daily title' : 'Answer'
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('EVAL-017: 六条件无标题辅助调用', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(SessionProjection)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 80, maxTitleBytes: 200 })
    const provider = ctx.plugin(TitleProvider, { provider: 'mock', model: 'title', targetWords: 4, targetCjkCharacters: 8, maxInputBytes: 4000, maxOutputTokens: 100, timeoutMs: 1000 }); await provider
    const adapter = new Adapter(); ctx.llm.registerAdapter(['mock'], adapter)
    for (let i = 0; i < 6; i++) {
      const handle = await ctx.agents.create({ sessionId: SessionId(`condition-${i}`), meta: { cwd: '/fictional' }, agentOptions: { provider: 'mock', model: 'main' } })
      try {
        ctx.sessionTitle.rename(handle.agent.session, `Memex selftest round/item/condition/${i}`)
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fictional question' }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
      } finally { await handle.dispose() }
    }
    expect(adapter.calls.filter(call => call.purpose === 'session-title')).toHaveLength(0)
    const daily = await ctx.agents.create({ sessionId: SessionId('daily-control'), meta: { cwd: '/ordinary' }, agentOptions: { provider: 'mock', model: 'main' } })
    try {
      daily.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'ordinary question' }], source: { kind: 'user' } }))
      await daily.agent.whenIdle()
      await provider.dispose()
      expect(adapter.calls.filter(call => call.purpose === 'session-title')).toHaveLength(1)
    } finally { await daily.dispose() }
  } finally { await ctx.fiber.dispose() }
})
