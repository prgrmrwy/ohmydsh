import type { Context } from '@deepseek-ai/cordis'
import type { ScopeService } from '../scope/types.js'
import type { EvalBridgeOptions } from './host.js'
import { loadFixedRound } from './round.js'
import { createJudgeParent } from './judge-parent.js'
import { createHostScorer } from './host-scorer.js'
import { runHostJudge } from './judge-runner.js'

export async function createRoundJudge(ctx: Context, root: string, round: string, parent: { id: string; cwd: string; preset: string }, scopes: Pick<ScopeService, 'resolve'>, timeoutMs: number): Promise<{ judge: EvalBridgeOptions['judge']; dispose(): Promise<void> }> {
  loadFixedRound(root, round)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid judge duration bound')
  const handle = await createJudgeParent(ctx, parent, scopes)
  let closed = false
  const active = new Map<Promise<unknown>, AbortController>()
  const scorer = createHostScorer(root, round, (protocol, budget, signal) => runHostJudge(ctx, handle.agent, protocol, signal, timeoutMs, budget))
  let disposal: Promise<void> | undefined
  const failures: unknown[] = []
  return {
    async judge(plan, item, signal) {
      if (closed) throw new Error('Round judge closed')
      if (failures.length) throw new Error('Round judge unhealthy; prior outcome requires inspection')
      if (active.size) throw new Error('Round judge busy; concurrent item refused before freezing')
      const abort = new AbortController(), disconnect = () => abort.abort(signal.reason)
      signal.addEventListener('abort', disconnect, { once: true })
      if (signal.aborted) disconnect()
      const work = scorer(plan, item, abort.signal)
      active.set(work, abort)
      try { return await work }
      catch (error) { failures.push(error); throw error }
      finally { active.delete(work); signal.removeEventListener('abort', disconnect) }
    },
    dispose() {
      closed = true
      return disposal ??= (async () => {
        for (const abort of active.values()) abort.abort()
        const outcomes = await Promise.allSettled([...active.keys()])
        const errors = [...failures, ...outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : [])]
        if (errors.length) throw new AggregateError(errors, 'Judge resource release unproven; preserve parent and inspect ledger')
        await handle.dispose()
      })()
    },
  }
}
