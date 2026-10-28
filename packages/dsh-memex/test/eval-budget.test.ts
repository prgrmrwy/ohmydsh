import { expect, it } from 'vitest'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeBudget, persistentJudgeBudget } from '../src/eval/budget.js'
it('admits the fixed twelve paired judgements but rejects a thirteenth before dispatch', () => {
  const budget = judgeBudget(12)
  for (let i = 0; i < 12; i++) budget.claim()
  expect(budget.used()).toBe(12)
  expect(() => budget.claim()).toThrow(/budget/)
  expect(budget.used()).toBe(12)
})
it('persistent claims survive reconstruction and are never refunded after uncertain delivery', () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-budget-'))
  for (let i = 0; i < 12; i++) persistentJudgeBudget(directory, 12).claim()
  const recovered = persistentJudgeBudget(directory, 12)
  expect(recovered.used()).toBe(12)
  expect(() => recovered.claim()).toThrow(/budget/)
})

it('only accepts the fixed selftest call cap, not an arbitrary override', () => {
  for (const count of [0, 11, 13, Number.NaN]) expect(() => judgeBudget(count)).toThrow()
})
