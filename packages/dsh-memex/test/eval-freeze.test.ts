import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { freezeInput, readFrozenInput } from '../src/eval/freeze.js'

it('EVAL-012: 原输入删除后仍可复现', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-freeze-'))
  const input = { version: 'test-v1', questions: [{ id: 'know', gold: '4' }], judge: { model: 'fixed' } }
  freezeInput(join(root, 'round'), input)
  input.questions[0]!.gold = 'changed'
  expect(readFrozenInput(join(root, 'round'))).toEqual({ version: 'test-v1', questions: [{ id: 'know', gold: '4' }], judge: { model: 'fixed' } })
})

it('EVAL-013: 冻结数据被改时拒绝续跑', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-freeze-'))
  const round = join(root, 'round')
  freezeInput(round, { version: 'v1', gold: 4 })
  writeFileSync(join(round, 'input.json'), '{"version":"v1","gold":99}\n')
  expect(() => readFrozenInput(round)).toThrow(/hash mismatch/)
})
