import { mkdtempSync, realpathSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { registerFixedRound } from '../src/eval/round.js'
import { EvalLedger } from '../src/eval/ledger.js'
import { prepareFixedItem } from '../src/eval/prepare-item.js'

it('materializes only verified frozen resources, reserves identity and freezes attempt before any Session exists', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prepare-'))
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prepare-home-'))
  const round = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const ledger = new EvalLedger(join(root, round.id))
  const prepared = prepareFixedItem(root, round.id, 'know-mem', home, ledger)
  expect(prepared.attempt.cwd).toContain('/.dsh-memex-eval-runs/mem/eval-')
  expect(existsSync(join(prepared.attempt.cwd, 'config.json'))).toBe(true)
  expect(existsSync(join(prepared.attempt.home, 'cards/retry-limit.md'))).toBe(true)
  expect(existsSync(join(prepared.attempt.cwd, 'questions.json'))).toBe(false)
  expect(ledger.read()).toEqual([expect.objectContaining({ kind: 'reserved', id: prepared.session, round: round.id, question: 'know', condition: 'mem' })])
  expect(() => prepareFixedItem(root, round.id, 'know-mem', home, ledger)).toThrow(/exist/)
  expect(ledger.read()).toHaveLength(1)
})
it('EVAL-013 (resume level): tampered frozen gold fails the hash check before any identity, attempt or session exists', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prepare-tamper-'))
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prepare-tamper-home-'))
  const round = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const input = join(root, round.id, 'input.json')
  const frozen = JSON.parse(readFileSync(input, 'utf8')) as { resources: Record<string, string> }
  const gold = Buffer.from(frozen.resources['questions.json']!, 'base64').toString()
  expect(gold).toContain('4')
  frozen.resources['questions.json'] = Buffer.from(gold.replace('4', '9')).toString('base64')
  writeFileSync(input, JSON.stringify(frozen, null, 2) + '\n')
  const ledger = new EvalLedger(join(root, round.id))
  expect(() => prepareFixedItem(root, round.id, 'know-mem', home, ledger)).toThrow(/hash mismatch/)
  expect(ledger.read()).toEqual([])
  expect(existsSync(join(root, round.id, 'know-mem'))).toBe(false)
  expect(existsSync(join(home, '.dsh-memex-eval-runs'))).toBe(false)
})

it('rejects unplanned items before creating a directory or reserving identity', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prepare-invalid-'))
  const round = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const ledger = new EvalLedger(join(root, round.id))
  expect(() => prepareFixedItem(root, round.id, '../daily', root, ledger)).toThrow(/outside/)
  expect(ledger.read()).toEqual([])
})
