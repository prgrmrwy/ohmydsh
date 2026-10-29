import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { EvalLedger } from './ledger.js'
import { retireTestRoot } from './release.js'

export interface HostRetirementOperations {
  archive(id: string): Promise<void>; settleJobs(): Promise<void>; drainDescendants(): Promise<void>;
  settleOneShots(): Promise<void>; healthy(): boolean
}

/** Only an explicitly reserved eval root is eligible; never borrows an AgentHandle. */
export async function retireHostTestRoot(ctx: Context, root: Agent, ledger: EvalLedger, operations: HostRetirementOperations): Promise<void> {
  if (!ledger.read().some(e => e.kind === 'reserved' && e.id === root.id)) throw new Error('Refusing to retire an unregistered test root')
  await retireTestRoot({
    ...operations, root,
    current: () => ctx.get('agents')?.get(root.id),
    cancel: agent => { agent.cancel({ kind: 'user' }) },
    whenIdle: agent => agent.whenIdle(),
    pending: agent => agent.inbox.nextTurn.length + agent.inbox.nextStep.length,
  })
}
