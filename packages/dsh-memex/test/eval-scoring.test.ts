import { expect, it } from 'vitest'
import { aggregateLayer, summarizeCondition } from '../src/eval/scoring.js'
import { summarizePlan } from '../src/eval/plan-scoring.js'
import type { FixedRound } from '../src/eval/round.js'

it('EVAL-038: Act 跳过 Know 层', () => {
  const items = ['a1', 'a2', 'a3'].map(id => ({ id, question: id, kind: 'Act', condition: 'mem', writebackApplicable: false }))
  const plan = { id: 'round-x', items } as FixedRound
  const result = summarizePlan(plan, {
    a1: { R: ['yes'], K: [], A: ['yes'], W: [], endpoint: ['yes'] },
    a2: { R: ['no'], K: [], A: ['yes'], W: [], endpoint: ['yes'] },
    a3: { R: ['unknown'], K: [], A: ['unknown'], W: [], endpoint: ['unknown'] },
  })
  expect(result.actionFunnel.denominator).toBe(1)
  expect(result.knowFunnel.denominator).toBe(0)
  expect(result.items.every(item => item.layers.K === 'not-applicable')).toBe(true)
  expect(result.endpoint).toEqual({ denominator: 3, pass: 2, fail: 0, unknown: 1 })
})

it('EVAL-039: 层内 no 优先于 unknown', () => {
  expect(aggregateLayer(['no', 'unknown'])).toBe('fail')
  expect(aggregateLayer(['unknown', 'no'])).toBe('fail')
  expect(aggregateLayer(['yes', 'unknown'])).toBe('unknown')
})

it('EVAL-040: 写回不被不适用层挡住', () => {
  const plan = { id: 'round-x', items: [{ id: 'wb', question: 'writeback', kind: 'Know', condition: 'mem', writebackApplicable: true }] } as FixedRound
  const result = summarizePlan(plan, { wb: { R: ['no'], K: ['no'], A: [], W: ['yes'], endpoint: ['no'] } })
  expect(result.items[0]!.layers.A).toBe('not-applicable')
  expect(result.writeback).toEqual({ denominator: 1, pass: 1, fail: 0, unknown: 0 })
})
it('no outranks unknown; empty layers stay not applicable', () => {
  expect(aggregateLayer(['yes', 'unknown', 'no'])).toBe('fail')
  expect(aggregateLayer(['yes', 'unknown'])).toBe('unknown')
  expect(aggregateLayer(['yes'])).toBe('pass')
  expect(aggregateLayer([])).toBe('not-applicable')
})
it('Know and Act use separate applicability and retain the endpoint when recall fails', () => {
  const act = summarizeCondition({ kind: 'Act', condition: 'mem', R: ['no'], K: ['no'], A: ['yes'], W: ['yes'], endpoint: ['yes'] })
  expect(act).toEqual({ layers: { R: 'fail', K: 'not-applicable', A: 'pass', W: 'pass' }, funnel: { K: false, A: false }, endpoint: 'pass' })
  const know = summarizeCondition({ kind: 'Know', condition: 'nomem', R: ['no'], K: ['yes'], A: ['no'], W: [], endpoint: ['yes'] })
  expect(know.layers).toEqual({ R: 'not-applicable', K: 'pass', A: 'not-applicable', W: 'not-applicable' })
  expect(know.funnel).toEqual({ K: true, A: false })
})
it('missing required applicable judgements are unknown, never not-applicable', () => {
  const result = summarizeCondition({ kind: 'Know', condition: 'mem', R: [], K: [], A: [], W: [], endpoint: [] })
  expect(result.layers.R).toBe('unknown')
  expect(result.layers.K).toBe('unknown')
  expect(result.endpoint).toBe('unknown')
  expect(result.layers.A).toBe('not-applicable')
})

it('writeback applicability is explicit, so missing writeback judgements remain unknown', () => {
  const base = { kind: 'Act' as const, condition: 'mem' as const, R: [], K: [], A: [], W: [], endpoint: [] }
  expect(summarizeCondition({ ...base, writebackApplicable: true }).layers.W).toBe('unknown')
  expect(summarizeCondition({ ...base, writebackApplicable: false }).layers.W).toBe('not-applicable')
})

it('writeback stays independent of recall and action outcomes', () => {
  const result = summarizeCondition({ kind: 'Act', condition: 'mem', R: ['unknown'], K: [], A: ['no'], W: ['yes'], endpoint: ['no'] })
  expect(result.layers.W).toBe('pass')
  expect(result.endpoint).toBe('fail')
})
