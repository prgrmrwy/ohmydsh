import type { FixedRound } from './round.js'
import type { EvalAttempt } from './routing.js'
import type { EvalLedger } from './ledger.js'
import type { ScopeService } from '../scope/types.js'
import type { TestedSessionPort } from './executor.js'
import { verifyAttemptRoute } from './routing.js'
import { executeFixedItem } from './executor.js'

export async function executePreparedItem(round: FixedRound, itemId: string, sessionId: string, attempt: EvalAttempt, ledger: EvalLedger, resolver: ScopeService, port: TestedSessionPort): Promise<void> {
  const item = round.items.find(item => item.id === itemId)
  const reserved = ledger.read().find(entry => entry.kind === 'reserved' && entry.id === sessionId)
  if (!item || !reserved || reserved.round !== round.id || reserved.question !== item.question || reserved.condition !== item.condition || attempt.condition !== item.condition) throw new Error('Execution reservation does not match frozen item')
  verifyAttemptRoute(resolver, attempt)
  await executeFixedItem(port, { sessionId, title: `Memex selftest ${item.id}/${sessionId.slice(-12)}`, route: round.tested, prompt: item.prompt,
    ...(item.followUp === undefined ? {} : { followUp: item.followUp }) })
}
