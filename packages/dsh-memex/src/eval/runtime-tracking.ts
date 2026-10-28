import type { Context } from '@deepseek-ai/cordis'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { EvalLedger } from './ledger.js'
import { startEvalTracking } from './tracking.js'

export function startHostEvalTracking(ctx: Context, ledger: EvalLedger, generation: string, timeoutMs: number): { owners: ReadonlySet<string>; healthy(): boolean; settleJobs(): Promise<void> } {
  const jobs = ctx.get('jobs')
  if (!jobs) throw new Error('Required eval jobs service unavailable')
  return startEvalTracking(ctx, ledger, {
    events: { subscribe: (filter, listener) => jobs.events.subscribe(filter, listener) },
    list: owner => jobs.list(SessionId(owner)),
    kill: (id, owner, reason) => jobs.kill(JobId(id), SessionId(owner), reason),
    wait: (id, bound, owner) => jobs.wait(JobId(id), bound, SessionId(owner)),
  }, generation, timeoutMs)
}
