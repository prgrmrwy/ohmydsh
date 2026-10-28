import type { Context } from '@deepseek-ai/cordis'
import type { EvalLedger } from './ledger.js'
import { attachEvalJobs, type EvalJobsPort } from './host-jobs.js'
import { registerEvalIdentities } from './identities.js'

/** Bind on the Host before any registered session/job is created. Context disposal removes listeners. */
export function startEvalTracking(ctx: Context, ledger: EvalLedger, jobs: EvalJobsPort, generation: string, timeoutMs: number): { owners: ReadonlySet<string>; healthy(): boolean; settleJobs(): Promise<void> } {
  const history = ledger.releaseHistory(generation)
  const identities = registerEvalIdentities(ctx, ledger)
  let healthy = true
  const resource = attachEvalJobs(jobs, identities.owners, generation, event => {
    try {
      ledger.recordRelease(event)
      if (event.type === 'registered') ledger.recordJob(event.owner, event.id)
    } catch (error) { healthy = false; throw error }
  }, timeoutMs, history)
  ctx.effect(() => resource.dispose, 'memex-eval jobs event subscription')
  return {
    owners: identities.owners,
    healthy: () => healthy && identities.healthy(),
    async settleJobs(): Promise<void> {
      if (!healthy || !identities.healthy()) throw new Error('Eval identity/resource evidence unhealthy')
      await resource.settle()
    },
  }
}
