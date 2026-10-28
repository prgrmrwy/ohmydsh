import type { Context } from '@deepseek-ai/cordis'
import type { ScopeService } from '../scope/types.js'
import type { EvalLedger } from './ledger.js'
import { createRoundJudge } from './host-judge.js'
export async function createRegisteredRoundJudge(ctx: Context, root: string, round: string, cwd: string, ledger: EvalLedger, tracking: { owners: ReadonlySet<string>; healthy(): boolean }, scopes: Pick<ScopeService, 'resolve'>, timeoutMs: number): Promise<Awaited<ReturnType<typeof createRoundJudge>>> {
  if (!tracking.healthy()) throw new Error('Eval tracking unhealthy; no judge parent admitted')
  const id = ledger.reserve(round, 'judge', 'nomem')
  const owned = await createRoundJudge(ctx, root, round, { id, cwd, preset: 'memex-eval-judge' }, scopes, timeoutMs)
  const tracked = () => { if (!tracking.healthy() || !tracking.owners.has(id)) throw new Error(`Judge identity tracking unhealthy; preserve ${id}`) }
  tracked()
  return {
    judge: async (plan, item, signal) => { tracked(); return owned.judge(plan, item, signal) },
    dispose: async () => { tracked(); await owned.dispose() },
  }
}
