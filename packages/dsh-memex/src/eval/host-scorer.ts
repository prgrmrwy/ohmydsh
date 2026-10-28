import type { EvalBridgeOptions } from './host.js'
import type { BoundaryProtocol } from './judge-boundary.js'
import { join } from 'node:path'
import { loadFixedRound } from './round.js'
import { persistentJudgeBudget } from './budget.js'
import { scoreFrozenItem } from './score-item.js'

export function createHostScorer(root: string, roundId: string, run: (protocol: BoundaryProtocol, budget: { claim(): void }, signal: AbortSignal) => Promise<unknown>): EvalBridgeOptions['judge'] {
  return async (requestedRound, requestedItem, signal) => {
    if (requestedRound.id !== roundId) throw new Error('Judge parent bound to another round')
    const frozen = loadFixedRound(root, roundId)
    const item = frozen.items.find(item => item.id === requestedItem.id)
    if (!item) throw new Error('Judge item outside frozen round')
    const budget = persistentJudgeBudget(join(root, roundId), frozen.maxJudgeCalls)
    return scoreFrozenItem(join(root, roundId, item.id), item, frozen.judge, protocol => run(protocol, budget, signal), signal)
  }
}
