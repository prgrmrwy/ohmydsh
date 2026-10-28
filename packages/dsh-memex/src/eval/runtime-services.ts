import { requireOneShotRelease } from './descendants.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-subagent'
import type { EvalLedger } from './ledger.js'
import type { HostRetirementOperations } from './host-retirement.js'

export async function settleHostOneShots(ctx: Context, root: Agent, known: ReadonlySet<string>, settleJobs: () => Promise<void>): Promise<void> {
  const subagents = ctx.get('subagents')
  const agents = ctx.get('agents')
  if (!subagents || !agents) throw new Error('Required descendant release service unavailable')
  await requireOneShotRelease({
    list: () => subagents.listDescendants(root.id),
    live: id => agents.get(SessionId(id)) !== undefined,
    known, settleJobs,
  })
}

export function hostRetirementOperations(ctx: Context, root: Agent, ledger: EvalLedger, tracking: Pick<HostRetirementOperations, 'healthy' | 'settleJobs'>, settleOneShots: () => Promise<void>): HostRetirementOperations {
  const workspaces = ctx.get('workspaceRegistry')
  const subagents = ctx.get('subagents')
  if (!workspaces || !subagents) throw new Error('Required eval retirement service unavailable')
  return {
    ...tracking, settleOneShots,
    async archive(id): Promise<void> {
      if (id !== root.id || !ledger.read().some(e => e.kind === 'reserved' && e.id === id)) throw new Error('Refusing archive of unregistered test root')
      await workspaces.archiveSession(SessionId(id), { stopActivity: true })
    },
    async drainDescendants(): Promise<void> { await subagents.drainContinuableDescendants([root]) },
  }
}
