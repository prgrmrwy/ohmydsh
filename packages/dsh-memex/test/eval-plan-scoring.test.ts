import { expect, it } from 'vitest'
import { summarizePlan } from '../src/eval/plan-scoring.js'
import type { FixedRound } from '../src/eval/round.js'
const plan = { items: [
  { id: 'writeback-mem', kind: 'Act', condition: 'mem', writebackApplicable: true },
  { id: 'writeback-nomem', kind: 'Act', condition: 'nomem', writebackApplicable: true },
] } as FixedRound
it('keeps every planned endpoint, missing partner and independent writeback denominator', () => {
  const result = summarizePlan(plan, { 'writeback-mem': { R: ['no'], K: [], A: ['yes'], W: ['yes'], endpoint: ['yes'] } })
  expect(result.items).toHaveLength(2)
  expect(result.endpoint).toEqual({ denominator: 2, pass: 1, fail: 0, unknown: 1 })
  expect(result.writeback).toEqual({ denominator: 2, pass: 1, fail: 0, unknown: 1 })
  expect(result.actionFunnel).toEqual({ denominator: 1, pass: 0, fail: 0, unknown: 1 })
})
it('refuses unplanned outcomes rather than adding them to the denominator', () => {
  expect(() => summarizePlan(plan, { 'daily': { R: [], K: [], A: [], W: [], endpoint: [] } })).toThrow(/outside/)
})
