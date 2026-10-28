import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { freezeInput, readFrozenInput } from '../src/eval/freeze.js'
import { registerFixedRound, loadFixedRound } from '../src/eval/round.js'

it('freezes six conditions from bundled verified input without accepting prompt or paths', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'eval-round-'))
  const plan = registerFixedRound(dir, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  expect(plan.items).toHaveLength(6)
  expect(plan.items.map(item => item.id)).toEqual(['know-mem', 'know-nomem', 'stale-mem', 'stale-nomem', 'writeback-mem', 'writeback-nomem'])
  expect(plan.items.filter(item => item.followUp)).toHaveLength(2)
  expect(plan.items.map(item => [item.id, item.kind, item.writebackApplicable])).toEqual([
    ['know-mem', 'Know', false], ['know-nomem', 'Know', false],
    ['stale-mem', 'Act', false], ['stale-nomem', 'Act', false],
    ['writeback-mem', 'Act', true], ['writeback-nomem', 'Act', true],
  ])
  expect(loadFixedRound(dir, plan.id)).toEqual(plan)
})

it('valid hashes do not authorize a changed fixed plan or resource bundle', () => {
  const source = mkdtempSync(join(realpathSync(tmpdir()), 'eval-round-source-'))
  const plan = registerFixedRound(source, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const frozen = readFrozenInput(join(source, plan.id)) as any
  for (const change of [
    (value: any) => { value.plan.items[0].prompt = 'arbitrary business input' },
    (value: any) => { value.plan.items.pop() },
    (value: any) => { value.plan.maxJudgeCalls = 120 },
    (value: any) => { value.resources['repo/README.md'] = Buffer.from('replacement').toString('base64') },
    (value: any) => { value.plan.judge.path = '/free' },
  ]) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-round-mutated-'))
    const value = structuredClone(frozen); change(value)
    freezeInput(join(root, plan.id), value)
    expect(() => loadFixedRound(root, plan.id)).toThrow()
  }
})

it('refuses arbitrary prompt/path/unknown fields or an insufficient judge budget', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'eval-round-reject-'))
  const base = { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }
  for (const extra of [{ prompt: 'injected' }, { path: '/tmp/free' }, { judge: { provider: 'mock', model: 'judge', arbitrary: true } }, { maxJudgeCalls: 1 }]) {
    expect(() => registerFixedRound(dir, { ...base, ...extra })).toThrow()
  }
  expect(() => loadFixedRound(dir, '../outside')).toThrow()
})
