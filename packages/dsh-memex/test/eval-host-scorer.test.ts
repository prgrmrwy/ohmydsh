import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { registerFixedRound } from '../src/eval/round.js'
import { freezeSelection } from '../src/eval/selection.js'
import { createHostScorer } from '../src/eval/host-scorer.js'
it('binds the scorer to one frozen round and ignores caller-supplied facts or route', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-host-scorer-'))
  const round = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const item = round.items[0]!
  mkdirSync(join(root, round.id, item.id))
  freezeSelection(join(root, round.id, item.id, 'selection'), [{ id: 's:1', text: 'retryLimit is 4' }], ['s:1'])
  const observed: string[] = []
  const score = createHostScorer(root, round.id, async (protocol, budget) => {
    budget.claim(); observed.push(protocol.prompt)
    expect(protocol.model).toBe('judge')
    return { verdict: 'yes', quotes: [{ source: 's:1', quote: 'retryLimit is 4' }], reason: 'fixture' }
  })
  const result = await score({ ...round, judge: { provider: 'wrong', model: 'wrong' } }, { ...item, requiredFacts: ['injected'] }, new AbortController().signal)
  expect(result).toHaveLength(2)
  expect(observed.every(prompt => !prompt.includes('injected'))).toBe(true)
  await expect(score({ ...round, id: 'round-other' }, item, new AbortController().signal)).rejects.toThrow(/round/)
})
