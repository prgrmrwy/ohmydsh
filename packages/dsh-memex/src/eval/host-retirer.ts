import type { Context } from '@deepseek-ai/cordis'
import type { EvalLedger } from './ledger.js'
export interface RetirementTracking { owners: ReadonlySet<string>; healthy(): boolean; settleJobs(): Promise<void> }
import { SessionId } from '@deepseek-ai/dsh-session'
import { retireHostTestRoot } from './host-retirement.js'
import { hostRetirementOperations, settleHostOneShots } from './runtime-services.js'

export function createHostRetirer(ctx: Context, ledger: EvalLedger, tracking: RetirementTracking): (id: string) => Promise<void> {
  return async id => {
    if (!ledger.read().some(entry => entry.kind === 'reserved' && entry.id === id) || !tracking.owners.has(id)) throw new Error('Refusing unregistered test root retirement')
    const root = ctx.get('agents')?.get(SessionId(id))
    if (!root) throw new Error('Registered test root unavailable; release proof missing')
    const operations = hostRetirementOperations(ctx, root, ledger, tracking, () => settleHostOneShots(ctx, root, tracking.owners, tracking.settleJobs))
    await retireHostTestRoot(ctx, root, ledger, operations)
  }
}
