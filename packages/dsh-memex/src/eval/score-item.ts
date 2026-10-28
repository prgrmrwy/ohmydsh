import type { RoundItem, ModelRoute } from './round.js'
import type { BoundaryProtocol } from './judge-boundary.js'
import type { CheckedJudgement } from './judgement.js'
import { join } from 'node:path'
import { loadSelection } from './selection.js'
import { freezeInput, readFrozenInput, durableWrite } from './freeze.js'
import { buildJudgeProtocol } from './judge-protocol.js'
import { readJudgement } from './judgement.js'

export async function scoreFrozenItem(directory: string, item: RoundItem, route: ModelRoute, judge: (protocol: BoundaryProtocol) => Promise<unknown>, signal?: AbortSignal): Promise<CheckedJudgement[]> {
  const requireActive = () => { if (signal?.aborted) throw new Error('Frozen item scoring aborted') }
  requireActive()
  const selection = loadSelection(join(directory, 'selection'))
  if (JSON.stringify(item.judgements) !== JSON.stringify(['facts', 'source-grounding'])) throw new Error('Unexpected frozen criterion plan')
  const protocols = item.judgements.map(criterion => buildJudgeProtocol(route, criterion, item.requiredFacts, selection.evidence))
  const frozen = join(directory, 'judge-protocols')
  freezeInput(frozen, protocols)
  const actual = readFrozenInput(frozen) as BoundaryProtocol[]
  const results: CheckedJudgement[] = []
  for (const [index, protocol] of actual.entries()) {
    requireActive()
    durableWrite(join(frozen, `${index}-started`), 'Do not retry uncertain judgement\n')
    const raw = await judge(protocol)
    durableWrite(join(frozen, `${index}-raw.json`), JSON.stringify(raw) + '\n')
    results.push(readJudgement(raw, selection.evidence))
  }
  return results
}
