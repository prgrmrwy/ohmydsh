import { requirePristineJudgeParent } from './judge-parent.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { verifyJudgeRequest, judgeSystemText } from './judge-gate.js'
export interface BoundaryProtocol { provider: string; model: string; effort?: string; schema: unknown; prompt: string }
const teamToolNames = new Set(['spawn_teammate', 'send_message', 'list_agents', 'interrupt_agent', 'wait_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update'])

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
    // Stock Team can register own tools before the first subagent descriptor exists.
    // Project only its known schemas away; the execution guard and final gate remain authoritative.
    agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembly = await next()
      return { ...assembly, tools: assembly.tools.filter(tool => !teamToolNames.has(tool.name)) }
    })
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
    // 0.2.1 injects the committed working directory as a required runtime-context line;
    // bind it to this child's own directory, which must still equal the judge parent's.
    const directories = ctx.get('workingDirectory' as never) as { get(session: unknown): string } | undefined
    const directory = directories?.get(child.session)
    if (directory !== undefined && directory !== directories!.get(parent.session)) throw new Error('Judge working directory mismatch')
    verifyJudgeRequest(request, protocol, directory)
    budget?.claim()
    checked++
    return next()
  })
  return { checked: () => checked, dispose: () => { closed = true } }
}
