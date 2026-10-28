import type { ItemJudgements } from './plan-scoring.js'
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadFixedRound } from './round.js'
import { loadSelection } from './selection.js'
import { readJudgement } from './judgement.js'
import { semanticOutcome } from './outcome.js'
import { readFrozenInput } from './freeze.js'
import { buildJudgeProtocol } from './judge-protocol.js'
import { isDeepStrictEqual } from 'node:util'

function optionalRaw(path: string): unknown {
  let fd: number
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid raw judgement artifact')
    return JSON.parse(readFileSync(fd, 'utf8')) as unknown
  } finally { closeSync(fd) }
}

/** Read-only diagnostics; never starts judges or trusts outcome.json as provenance evidence. */
export function loadOfflineOutcomes(root: string, roundId: string): Record<string, ItemJudgements> {
  const round = loadFixedRound(root, roundId)
  return Object.fromEntries(round.items.map(item => {
    const directory = join(root, roundId, item.id)
    const raw = [0, 1].map(index => optionalRaw(join(directory, 'judge-protocols', `${index}-raw.json`)))
    if (raw.every(value => value === undefined)) return [item.id, semanticOutcome(item, undefined)]
    const selection = loadSelection(join(directory, 'selection'))
    const protocols = readFrozenInput(join(directory, 'judge-protocols'))
    const expected = item.judgements.map(criterion => buildJudgeProtocol(round.judge, criterion, item.requiredFacts, selection.evidence))
    if (!isDeepStrictEqual(protocols, expected)) throw new Error('Frozen judge protocol mismatch; raw results not attributable')
    return [item.id, semanticOutcome(item, raw.map(value => readJudgement(value, selection.evidence)))]
  }))
}
