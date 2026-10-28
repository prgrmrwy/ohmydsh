import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HostRoundInput, HostRoundState } from './host-round.js'
export type ManagedRoundInput = Omit<HostRoundInput, 'ledger' | 'tracking' | 'judge'> & { generation: string; registryFile: string; judgeCwd: string; timeoutMs: number }
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { loadFixedRound } from './round.js'
import { EvalLedger } from './ledger.js'
import { startHostEvalTracking } from './runtime-tracking.js'
import { createRegisteredRoundJudge } from './registered-judge.js'
import { archiveHostRoundAttempts, runHostRound, validateHostRoundResume } from './host-round.js'
import { durableWrite, readRegular } from './freeze.js'
import { ensureDirectory } from './prepare-item.js'
import { createHostRetirer } from './host-retirer.js'
import { requirePristineJudgeParent } from './judge-parent.js'
import { settleHostOneShots } from './runtime-services.js'

export interface ManagedRoundExecution {
  run(input: ManagedRoundInput, signal: AbortSignal): Promise<Record<string, unknown>>
  resume(input: ManagedRoundInput, signal: AbortSignal): Promise<Record<string, unknown>>
}

/** Retains live capabilities, not a recovery token: rebuilding the dispatcher must fail closed. */
export function createManagedRoundExecution(ctx: Context): ManagedRoundExecution {
  let active = false, complete = false, failed = false, resumeBlocked = false, disposed = false
  ctx.effect?.(() => () => { disposed = true }, 'memex-eval retained execution continuity')
  let owned: {
    input: ManagedRoundInput; ledger: EvalLedger; tracking: ReturnType<typeof startHostEvalTracking>;
    judge: Awaited<ReturnType<typeof createRegisteredRoundJudge>>; state: HostRoundState;
    judgeRoots: { id: string; root: Agent | undefined }[]; ledgerBytes?: string; registryBytes?: string
  } | undefined
  const admission = (input: ManagedRoundInput, signal: AbortSignal) => {
    if (active) throw new Error('Managed execution active; concurrent run/resume refused')
    if (disposed) throw new Error('Host execution context disposed; continuous handles unavailable')
    if (signal.aborted) throw new Error('Managed round aborted')
    if (!input.generation.trim()) throw new Error('Host generation required')
    loadFixedRound(input.root, input.round)
    if (existsSync(join(input.root, input.round, 'cancel-requested'))) throw new Error('Round cancelled; managed start refused')
  }
  const work = async (input: ManagedRoundInput, signal: AbortSignal, resume: boolean): Promise<Record<string, unknown>> => {
    admission(input, signal)
    if (!resume && owned) throw new Error('Managed execution already started; use explicit resume for this owned round')
    if (resume) {
      if (!owned) throw new Error('Continuous owned Host handles missing from memory; resume refused')
      if (Object.keys(owned.input).length !== Object.keys(input).length || Object.entries(owned.input).some(([key, value]) => input[key as keyof ManagedRoundInput] !== value)) throw new Error('Managed Host generation/input identity mismatch')
      if (resumeBlocked) throw new Error('Prior resume proof failed; retained resource evidence requires manual inspection')
      if (!failed || complete) throw new Error('No ordinary incomplete execution to resume')
    }
    active = true
    try {
      if (!resume) {
        durableWrite(join(input.root, input.round, 'run-started.json'), JSON.stringify({ generation: input.generation }) + '\n')
        ensureDirectory(dirname(input.registryFile))
        ensureDirectory(input.judgeCwd)
        const ledger = new EvalLedger(join(input.root, input.round), input.registryFile)
        const tracking = startHostEvalTracking(ctx, ledger, input.generation, input.timeoutMs)
        const judge = await createRegisteredRoundJudge(ctx, input.root, input.round, input.judgeCwd, ledger, tracking, input.scopes, input.timeoutMs)
        owned = { input: { ...input }, ledger, tracking, judge, state: { attempts: [], results: {} },
          judgeRoots: ledger.read?.().filter(entry => entry.kind === 'reserved' && entry.question === 'judge').map(entry => ({ id: entry.id, root: ctx.get?.('agents')?.get(SessionId(entry.id)) })) ?? [] }
      }
      const current = owned!
      const { ledger, tracking, judge, state } = current
      const settle = async () => {
        if (!tracking.healthy()) throw new Error('Final round tracking unhealthy; release unproven')
        await tracking.settleJobs()
        if (!tracking.healthy()) throw new Error('Final round tracking unhealthy; release unproven')
      }
      if (resume) {
        // A failed revalidation cannot be repaired by rebasing disk evidence on a later call.
        resumeBlocked = true
        if (!state.attempts.some(attempt => attempt.outcome === undefined && attempt.retryable && attempt.directory === join(input.root, input.round, attempt.item))) throw new Error(`No proven retired ordinary failure to resume; inspect raw roots: ${state.attempts.filter(attempt => attempt.outcome === undefined).map(attempt => attempt.session).join(', ')}`)
        if (!tracking.healthy()) throw new Error('Continuous Host tracking unhealthy; resume refused')
        if (!current.ledgerBytes || !current.registryBytes || readRegular(join(ledger.directory, 'ledger.ndjson')).toString() !== current.ledgerBytes || readRegular(input.registryFile).toString() !== current.registryBytes) throw new Error('Retained identity/registry evidence changed; resume refused')
        if (!current.judgeRoots.length || current.judgeRoots.some(parent => !parent.root || ctx.get?.('agents')?.get(SessionId(parent.id)) !== parent.root)) throw new Error('Owned judge parent live identity unproven; resume refused')
        if (readRegular(join(input.root, input.round, 'run-started.json')).toString() !== JSON.stringify({ generation: input.generation }) + '\n') throw new Error('Host generation evidence mismatch')
        validateHostRoundResume(ctx, { ...input, ledger, tracking, judge: judge.judge }, state)
        await settle()
        const retire = createHostRetirer(ctx, ledger, tracking)
        for (const attempt of state.attempts) await retire(attempt.session)
        for (const parent of current.judgeRoots) {
          requirePristineJudgeParent(parent.root!)
          await settleHostOneShots(ctx, parent.root!, tracking.owners, tracking.settleJobs)
          requirePristineJudgeParent(parent.root!)
        }
        await settle()
        validateHostRoundResume(ctx, { ...input, ledger, tracking, judge: judge.judge }, state)
        archiveHostRoundAttempts({ ...input, ledger, tracking, judge: judge.judge }, state)
        resumeBlocked = false
      }
      failed = false
      const results = await runHostRound(ctx, { ...input, ledger, tracking, judge: judge.judge }, signal, state)
      await settle()
      await judge.dispose()
      await settle()
      complete = true
      return results
    } catch (error) {
      failed = true
      // Snapshot only this invocation's continuous identity evidence; absence never enables resume.
      if (owned) {
        try {
          owned.ledgerBytes = readRegular(join(owned.ledger.directory, 'ledger.ndjson')).toString()
          owned.registryBytes = readRegular(input.registryFile).toString()
        } catch { delete owned.ledgerBytes; delete owned.registryBytes }
      }
      throw error
    } finally { active = false }
  }
  return { run: (input, signal) => work(input, signal, false), resume: (input, signal) => work(input, signal, true) }
}

/** Default one-shot behavior is unchanged; callers must explicitly retain an execution to resume. */
export async function runManagedRound(ctx: Context, input: ManagedRoundInput, signal: AbortSignal): Promise<Record<string, unknown>> {
  return createManagedRoundExecution(ctx).run(input, signal)
}
