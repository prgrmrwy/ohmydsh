import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import Sessions from '@deepseek-ai/dsh-session'
import Agents from '@deepseek-ai/dsh-agent'
import Llm, { LlmAdapter, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Projections from '@deepseek-ai/dsh-session-projection'
import Loop from '@deepseek-ai/dsh-agent-loop'
import { installModelSelection } from '#model-source/core/agent/src/model-selection.ts'
import { installModelSelectionProjection } from '#model-source/api/session-controller/src/model-selection-projection.ts'

it('real AgentLoop headers and adapter show request-local effort while a later hand selection survives unchanged', async () => {
  const ctx = new Context()
  let release!: () => void
  let entered!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const received: string[] = []
  try {
    for (const plugin of [Sessions, Agents, Llm, Tools, Prompt, Projections]) await ctx.plugin(plugin)
    installModelSelectionProjection(ctx)
    ctx.llm.registerAdapter(['gateway'], new class extends LlmAdapter {
      override async resolveModel(provider: string, id: string) { return { provider, id, name: 'GPT', reasoning: {
        efforts: ['low', 'medium', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })),
      } } }
      override async *stream(options) {
        received.push(options.reasoningEffort)
        entered(); await hold
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
    }())
    await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
    const agent = await ctx.agentLoop.create('model-display', { provider: 'gateway', model: 'codex/gpt' })
    const selected = { provider: 'gateway', model: 'codex/gpt', reasoningEffort: ReasoningEffortId('medium') }
    installModelSelection(agent.ctx, { current: selected, assembled: undefined })
    agent.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), reasoningEffort: ReasoningEffortId('high') }), { prepend: true })
    agent.session.append('model/selection', selected)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'inert test' }], source: { kind: 'user' } }))
    await started
    const newer = { ...selected, reasoningEffort: ReasoningEffortId('low') }
    agent.session.append('model/selection', newer)
    release(); await agent.whenIdle()
    expect(received).toEqual(['high'])
    expect(agent.session.requestHeader()?.config).toMatchObject({ provider: 'gateway', model: 'codex/gpt', reasoningEffort: 'high' })
    expect(ctx.sessionProjections.snapshot(agent.session).values.modelSelection).toEqual({ lastUsed: { ...selected, reasoningEffort: 'high' }, next: newer })
  } finally { release?.(); await ctx.fiber.dispose() }
})
