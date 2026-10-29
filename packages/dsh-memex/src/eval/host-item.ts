import type { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { ScopeService } from '../scope/types.js'
import type { EvalAttempt } from './routing.js'
import type { EvalLedger } from './ledger.js'
import type { RetirementTracking } from './host-retirer.js'
import type { EvidenceBackend } from './artifact-location.js'
import type { EvalBridgeOptions } from './host.js'
export interface HostItemInput {
  root: string; round: string; item: string; session: string; attempt: EvalAttempt; ledger: EvalLedger; scopes: ScopeService;
  controller: SessionController; routing(operation: 'state' | 'setMode', payload: unknown): Promise<unknown>;
  tracking: RetirementTracking; backend: EvidenceBackend; judge: EvalBridgeOptions['judge'];
  lifecycle?(stage: 'execute' | 'retired' | 'collect' | 'score'): void;
}
import { join, sep } from 'node:path'

/** `<home>/.dsh-memex-eval-runs/<mem|nomem>/eval-<uuid>/repo` → `<home>`; any other layout is refused. */
export function attemptHome(cwd: string): string {
  const match = new RegExp(`^(.+)\\${sep}\\.dsh-memex-eval-runs\\${sep}(?:mem|nomem)\\${sep}eval-[a-f0-9-]{36}\\${sep}repo$`).exec(cwd)
  if (!match) throw new Error('Attempt workspace outside the fixed eval layout')
  return match[1]!
}
import { loadFixedRound } from './round.js'
import { runFixedItem } from './item-runner.js'
import { controllerExecutionPort } from './controller.js'
import { executePreparedItem } from './prepared-execution.js'
import { createHostRetirer } from './host-retirer.js'
import { createHostEvidenceReader } from './host-reader.js'
import { collectItemEvidence } from './collection.js'
import { installTestedBudget, testedLimits } from './tested-budget.js'
import { freezeInput } from './freeze.js'
import { EvalPhaseFailure, type EvalPhase } from './failure.js'

/** Internal assembly only: no free-form plan, prompt, path or schema is accepted over RPC. */
export async function runHostItem(ctx: Context, input: HostItemInput, signal: AbortSignal): Promise<unknown> {
  const round = loadFixedRound(input.root, input.round)
  const item = round.items.find(item => item.id === input.item)
  if (!item) throw new Error('Execution item outside frozen plan')
  const healthy = () => { if (!input.tracking.healthy()) throw new Error('Host item tracking unhealthy; preserve scene') }
  healthy()
  const directory = join(input.root, round.id, item.id)
  freezeInput(join(directory, 'tested-limits'), testedLimits)
  const budget = installTestedBudget(ctx, input.ledger, input.session, signal)
  const port = controllerExecutionPort(input.controller, input.routing, input.attempt.cwd, budget.signal, directory)
  const retire = createHostRetirer(ctx, input.ledger, input.tracking)
  let phase: EvalPhase = 'execute'
  try { return await runFixedItem(item, {
    execute: async () => { phase = 'execute'; input.lifecycle?.('execute'); try { await executePreparedItem(round, item.id, input.session, input.attempt, input.ledger, input.scopes, port) } catch (error) { throw new EvalPhaseFailure('execute', error) } },
    retire: async () => { phase = 'retire'; await retire(input.session); healthy(); input.lifecycle?.('retired') },
    collect: async () => { phase = 'collect'; healthy(); input.lifecycle?.('collect'); await collectItemEvidence(directory, input.ledger, input.session, round.tested, createHostEvidenceReader(ctx, input.ledger, input.backend), { home: attemptHome(input.attempt.cwd), own: { cwd: input.attempt.cwd, home: input.attempt.home } }, [item.prompt, ...(item.followUp ? [item.followUp] : [])]); healthy() },
    score: () => { phase = 'score'; healthy(); input.lifecycle?.('score'); return input.judge(round, item, signal) },
  }, budget.signal) } catch (error) { throw error instanceof EvalPhaseFailure ? error : new EvalPhaseFailure(phase, error) } finally { budget.dispose() }
}
