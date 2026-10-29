import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { freezeInput } from '../src/eval/freeze.js'
import { freezeSelection } from '../src/eval/selection.js'
import { registerFixedRound } from '../src/eval/round.js'
import { scoreFrozenItem } from '../src/eval/score-item.js'
import { loadOfflineOutcomes } from '../src/eval/offline-outcomes.js'

it('uses the same fixed two calls to judge answer and independently check successful write content with quoted provenance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-writeback-protocol-'))
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 't' }, judge: { provider: 'mock', model: 'j' }, maxJudgeCalls: 12 })
  const item = plan.items.find(value => value.id === 'writeback-mem')!, directory = join(root, plan.id, item.id)
  // freezeInput owns directory creation; selection is a sibling.
  freezeInput(directory, {})
  freezeSelection(join(directory, 'selection'), [{ id: 'root:answer', text: item.requiredFacts.join('; ') }], ['root:answer'])
  freezeInput(join(directory, 'program-evidence'), { retrieval: [], writes: [{ source: 'root:4', tool: 'memex_retro', at: 10, success: true, targetCorrect: true, slug: 'lease', content: 'Lantern leaseSeconds is 45; previous 15-second statement is stale.' }], sessions: [] })
  let count = 0
  await scoreFrozenItem(directory, item, plan.judge, async protocol => {
    count++
    const input = JSON.parse(protocol.prompt)
    expect(input.writeback).toMatchObject({ applicable: true })
    expect(input.evidence.map((e: { id: string }) => e.id)).toEqual(['root:answer'])
    expect(input.writeback.evidence).toEqual([{ id: 'root:4:write', text: 'Lantern leaseSeconds is 45; previous 15-second statement is stale.' }])
    return { verdict: 'yes', reason: 'fictional answer', quotes: [{ source: 'root:answer', quote: item.requiredFacts[0] }],
      writeback: { verdict: 'yes', reason: 'fictional correct write', quotes: [{ source: 'root:4:write', quote: 'leaseSeconds is 45' }] } }
  })
  expect(count).toBe(2)
  const outcome = loadOfflineOutcomes(root, plan.id)[item.id]!
  expect(outcome.W).toEqual(['yes', 'yes', 'yes'])
  expect(outcome.endpoint).toEqual(['yes', 'yes', 'yes', 'yes', 'yes'])
})
