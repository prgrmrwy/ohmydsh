import type { Context } from '@deepseek-ai/cordis'
import type { HostRoundInput } from './host-round.js'
export type ManagedRoundInput = Omit<HostRoundInput, 'ledger' | 'tracking' | 'judge'> & { generation: string; registryFile: string; judgeCwd: string; timeoutMs: number }
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadFixedRound } from './round.js'
import { EvalLedger } from './ledger.js'
import { startHostEvalTracking } from './runtime-tracking.js'
import { createRegisteredRoundJudge } from './registered-judge.js'
import { runHostRound } from './host-round.js'
import { durableWrite } from './freeze.js'

/** One Host invocation. Failure preserves the scene; no automatic resume or root disposal. */
export async function runManagedRound(ctx: Context, input: ManagedRoundInput, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (signal.aborted) throw new Error('Managed round aborted')
  if (!input.generation.trim()) throw new Error('Host generation required')
  loadFixedRound(input.root, input.round)
  if (existsSync(join(input.root, input.round, 'cancel-requested'))) throw new Error('Round cancelled; managed start refused')
  durableWrite(join(input.root, input.round, 'run-started.json'), JSON.stringify({ generation: input.generation }) + '\n')
  const ledger = new EvalLedger(join(input.root, input.round), input.registryFile)
  const tracking = startHostEvalTracking(ctx, ledger, input.generation, input.timeoutMs)
  const judge = await createRegisteredRoundJudge(ctx, input.root, input.round, input.judgeCwd, ledger, tracking, input.scopes, input.timeoutMs)
  const results = await runHostRound(ctx, { ...input, ledger, tracking, judge: judge.judge }, signal)
  const settle = async () => {
    if (!tracking.healthy()) throw new Error('Final round tracking unhealthy; release unproven')
    await tracking.settleJobs()
    if (!tracking.healthy()) throw new Error('Final round tracking unhealthy; release unproven')
  }
  await settle()
  await judge.dispose()
  await settle()
  return results
}
