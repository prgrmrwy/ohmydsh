import { requirePristineJudgeParent } from './judge-parent.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { verifyJudgeRequest, judgeSystemText } from './judge-gate.js'
export interface BoundaryProtocol { provider: string; model: string; effort?: string; schema: unknown; prompt: string }

export function installJudgeBoundary(ctx: Context, parent: Agent, protocol: BoundaryProtocol, budget?: { claim(): void }): { checked(): number; dispose(): void } {
  const children = new Map<string, Agent>()
  let checked = 0
  let closed = false
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== parent.id) return undefined
    requirePristineJudgeParent(parent)
    if (closed) throw new Error('Judge creation window closed')
    if (children.size > 0) throw new Error('Judge creation window already claimed')
    if (!ctx.agents.isOwnedBy(agent.id, parent)) throw new Error('Judge live owner mismatch')
    children.set(agent.id, agent)
    agent.ctx.systemPrompt.section({ name: 'memex-eval:complete-judge', order: 0, text: judgeSystemText, interpolate: false, complete: true })
    agent.ctx.systemPrompt.suppressRuntimeContext()
    agent.ctx.tools.guard(execution => execution.name === 'structured_output' ? undefined : 'Judge may only submit structured_output')
    return undefined
  })
  ctx.on('llm/stream', function (request, next) {
    const child = request.sessionId === undefined ? undefined : children.get(request.sessionId)
    if (!child) return next()
    if (!isAgentLoopRequest(request) || ctx.agents.get(child.id) !== child || !ctx.agents.isOwnedBy(child.id, parent)) throw new Error('Judge exact live identity mismatch')
    requirePristineJudgeParent(parent)
    verifyJudgeRequest(request, protocol)
    budget?.claim()
    checked++
    return next()
  })
  return { checked: () => checked, dispose: () => { closed = true } }
}
