import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScopeService } from '../scope/types.js'
import { createEvalBridge } from './host.js'
import { EvalLedger } from './ledger.js'
import { startHostEvalTracking } from './runtime-tracking.js'
import { createRegisteredRoundJudge } from './registered-judge.js'

export interface HostEvalOptions {
  /** Live Host resolver; the judge parent route is verified against it, never reconstructed. */
  scopes?: Pick<ScopeService, 'resolve'>
  judgeCwd?: string
  timeoutMs?: number
  generation?: string
}

/**
 * Host-side eval bridge mounted on the existing authenticated memex channel.
 * The managed judge for a round is assembled lazily on its first judgement:
 * resource tracking is subscribed before the judge parent exists, and a
 * missing Host service fails closed before any session or model call.
 */
export function createHostEvalDispatch(ctx: Context, root = join(homedir(), '.dsh-memex-eval', 'selftest'), options: HostEvalOptions = {}) {
  const generation = options.generation ?? `host-${randomUUID()}`
  const timeoutMs = options.timeoutMs ?? 120_000
  const judgeCwd = options.judgeCwd ?? join(homedir(), '.dsh-memex-eval-runs', 'judge', 'repo')
  const rounds = new Map<string, Promise<{ judge: Awaited<ReturnType<typeof createRegisteredRoundJudge>>; settleJobs(): Promise<void> }>>()

  const managed = (round: string) => {
    let owned = rounds.get(round)
    if (!owned) {
      owned = (async () => {
        if (!options.scopes) throw new Error('Host scope resolver unavailable; no judge parent created')
        const ledger = new EvalLedger(join(root, round), join(root, 'eval-registry.ndjson'))
        const tracking = startHostEvalTracking(ctx, ledger, generation, timeoutMs)
        const judge = await createRegisteredRoundJudge(ctx, root, round, judgeCwd, ledger, tracking, options.scopes, timeoutMs)
        return { judge, settleJobs: () => tracking.settleJobs() }
      })()
      rounds.set(round, owned)
    }
    return owned
  }

  const bridge = createEvalBridge({
    root,
    currentDefault: () => {
      const service = ctx.get('agentDefaultModel' as never) as { currentSelection(): unknown } | undefined
      if (!service) throw new Error('Default model service unavailable')
      return service.currentSelection()
    },
    judge: async (plan, item, signal) => (await managed(plan.id)).judge.judge(plan, item, signal),
    cancel: async round => {
      const owned = rounds.get(round)
      if (!owned) return
      const { judge, settleJobs } = await owned
      await settleJobs()
      // A prior uncertain judgement keeps the parent for manual inspection.
      if (existsSync(join(root, round, 'unhealthy'))) throw new Error('Round unhealthy; judge parent preserved, release unproven')
      await judge.dispose()
    },
  })
  return (endpoint: string, payload: unknown, signal: AbortSignal) => bridge.dispatch(endpoint, payload, signal)
}
