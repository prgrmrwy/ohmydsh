import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { installJudgeBoundary, type BoundaryProtocol } from './judge-boundary.js'
import { requirePristineJudgeParent } from './judge-parent.js'
import { runBoundedJudge } from './judge-lifetime.js'

const busy = new WeakSet<Agent>()

export async function runHostJudge(ctx: Context, parent: Agent, protocol: BoundaryProtocol, signal: AbortSignal, timeoutMs: number, budget?: { claim(): void }): Promise<unknown> {
  if (busy.has(parent)) throw new Error('Judge parent already in use')
  requirePristineJudgeParent(parent)
  const subagents = ctx.get('subagents')
  if (!subagents) throw new Error('Judge spawn service unavailable')
  busy.add(parent)
  let boundary!: ReturnType<typeof installJudgeBoundary>
  let gate: ReturnType<Context['plugin']> | undefined
  try {
    gate = ctx.plugin({ name: 'memex-eval-judge-request', inject: ['agents'], apply(child: Context) { boundary = installJudgeBoundary(child, parent, protocol, budget) } })
    await gate
    requirePristineJudgeParent(parent)
    const routing = ctx.get('autoModelRouting' as never) as { call(operation: 'state' | 'setMode', payload: unknown): Promise<unknown> } | undefined
    if (!routing) throw new Error('Judge routing service unavailable')
    const payload = { sessionId: parent.id, mode: 'MANUAL' }
    const acknowledged = await routing.call('setMode', payload) as { mode?: unknown } | null
    const actual = await routing.call('state', { sessionId: parent.id }) as { mode?: unknown } | null
    if (acknowledged?.mode !== 'MANUAL' || actual?.mode !== 'MANUAL') throw new Error('Judge parent MANUAL readback mismatch; child not spawned')
    requirePristineJudgeParent(parent)
    return await runBoundedJudge(signal, timeoutMs, async childSignal => {
      const run = await subagents.start('spawn', {
        parent, signal: childSignal, prompt: [{ type: 'text', text: protocol.prompt }],
        agentOptions: { provider: protocol.provider, model: protocol.model, maxTokens: 2048,
          ...(protocol.effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(protocol.effort) }) },
        outputSchema: protocol.schema as ObjectJsonSchema, maxDepth: 1, toolFilter: { allow: [] },
      })
      return {
        result: run.result.then(result => {
          if (result.stopReason !== 'completed' || result.structured === undefined || boundary.checked() === 0) throw new Error('Judge structured result unavailable')
          return result.structured
        }),
        dispose: () => run.dispose(),
      }
    })
  } finally {
    boundary?.dispose()
    try { await gate?.dispose() } finally { busy.delete(parent) }
  }
}
