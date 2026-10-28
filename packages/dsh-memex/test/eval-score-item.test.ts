import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { freezeSelection } from '../src/eval/selection.js'
import { scoreFrozenItem } from '../src/eval/score-item.js'
import type { RoundItem } from '../src/eval/round.js'
it('stops between paired judgements after carrier cancellation', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-score-cancel-'))
  freezeSelection(join(root, 'selection'), [{ id: 's:1', text: 'retryLimit is 4' }], ['s:1'])
  const abort = new AbortController()
  let calls = 0
  await expect(scoreFrozenItem(root, item, { provider: 'mock', model: 'judge' }, async () => {
    calls++; abort.abort()
    return { verdict: 'unknown', reason: 'cancelled', quotes: [] }
  }, abort.signal)).rejects.toThrow(/aborted/)
  expect(calls).toBe(1)
})
const item = { id: 'know-mem', requiredFacts: ['retryLimit is 4'], judgements: ['facts', 'source-grounding'] } as RoundItem
it('consumes frozen selection, performs exactly two serial criteria and validates quotes', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-score-item-'))
  freezeSelection(join(root, 'selection'), [{ id: 's:1', text: 'config.json: retryLimit is 4' }], ['s:1'])
  const criteria: string[] = []
  const result = await scoreFrozenItem(root, item, { provider: 'mock', model: 'judge' }, async protocol => {
    criteria.push(JSON.parse(protocol.prompt).criterion)
    return { verdict: 'yes', quotes: [{ source: 's:1', quote: 'retryLimit is 4' }], reason: 'fixture' }
  })
  expect(criteria).toEqual(['facts', 'source-grounding'])
  expect(result.map(value => value.verdict)).toEqual(['yes', 'yes'])
  await expect(scoreFrozenItem(root, item, { provider: 'mock', model: 'judge' }, async () => { throw new Error('must not retry') })).rejects.toThrow(/EEXIST/)
})
