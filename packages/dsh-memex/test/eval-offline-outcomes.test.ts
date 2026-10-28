import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { registerFixedRound } from '../src/eval/round.js'
import { freezeSelection } from '../src/eval/selection.js'
import { freezeInput } from '../src/eval/freeze.js'
import { buildJudgeProtocol } from '../src/eval/judge-protocol.js'
import { loadOfflineOutcomes } from '../src/eval/offline-outcomes.js'
function fixture(changedProtocol = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-outcomes-'))
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const directory = join(root, plan.id, 'know-mem'); mkdirSync(directory)
  freezeSelection(join(directory, 'selection'), [{ id: 'root:1', text: 'retryLimit is 4' }], ['root:1'])
  const item = plan.items[0]!
  const protocols = item.judgements.map(criterion => buildJudgeProtocol(plan.judge, criterion, item.requiredFacts, [{ id: 'root:1', text: 'retryLimit is 4' }]))
  if (changedProtocol) protocols[0]!.prompt = 'a different task'
  freezeInput(join(directory, 'judge-protocols'), protocols)
  return { root, plan, directory }
}
it('rechecks raw quotes, keeps missing conditions unknown and ignores forged summarized outcomes', () => {
  const f = fixture()
  writeFileSync(join(f.directory, 'outcome.json'), JSON.stringify([{ verdict: 'yes' }, { verdict: 'yes' }]))
  for (const index of [0, 1]) writeFileSync(join(f.directory, 'judge-protocols', `${index}-raw.json`), JSON.stringify({ verdict: 'yes', reason: 'fixture', quotes: [{ source: 'root:1', quote: index ? 'invented' : 'retryLimit is 4' }] }))
  const result = loadOfflineOutcomes(f.root, f.plan.id)
  expect(result['know-mem']?.endpoint).toEqual(['yes', 'unknown'])
  expect(result['know-nomem']?.endpoint).toEqual(['unknown', 'unknown'])
  expect(result['know-mem']?.R).toEqual([])
})
it('refuses raw results paired with a hash-valid but different frozen protocol', () => {
  const f = fixture(true)
  for (const index of [0, 1]) writeFileSync(join(f.directory, 'judge-protocols', `${index}-raw.json`), JSON.stringify({ verdict: 'yes', reason: 'fixture', quotes: [{ source: 'root:1', quote: 'retryLimit is 4' }] }))
  expect(() => loadOfflineOutcomes(f.root, f.plan.id)).toThrow(/protocol/)
})
it('missing raw responses stay unknown but symbolic raw artifacts fail closed', () => {
  const f = fixture()
  expect(loadOfflineOutcomes(f.root, f.plan.id)['know-mem']?.endpoint).toEqual(['unknown', 'unknown'])
  const target = join(f.root, 'foreign.json'); writeFileSync(target, '{}')
  symlinkSync(target, join(f.directory, 'judge-protocols', '0-raw.json'))
  expect(() => loadOfflineOutcomes(f.root, f.plan.id)).toThrow()
})
