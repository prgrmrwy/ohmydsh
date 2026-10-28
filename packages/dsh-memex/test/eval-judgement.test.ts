import { expect, it } from 'vitest'
import { readJudgement } from '../src/eval/judgement.js'
const evidence = [{ id: 'e1', text: 'leaseSeconds is 45' }]
it('accepts a yes/no only with actual nonblank source quotes', () => {
  expect(readJudgement({ verdict: 'yes', quotes: [{ source: 'e1', quote: 'leaseSeconds is 45' }], reason: 'matches' }, evidence)).toEqual({ verdict: 'yes', provenance: 'checked', reason: 'matches' })
  for (const quotes of [[], [{ source: 'e1', quote: ' ' }], [{ source: 'e1', quote: 'is 15' }]]) expect(readJudgement({ verdict: 'no', quotes, reason: 'bad evidence' }, evidence).verdict).toBe('unknown')
})
it('unknown requires a reason and does not require fabricated quotes', () => {
  expect(readJudgement({ verdict: 'unknown', quotes: [], reason: 'evidence absent' }, evidence).verdict).toBe('unknown')
  expect(readJudgement({ verdict: 'unknown', quotes: [], reason: '' }, evidence).provenance).toBe('invalid')
})
it('malformed output cannot become a yes even if statically cast', () => {
  for (const value of [null, {}, { verdict: 'YES' }, { verdict: 'yes', quotes: 'e1', reason: 'x' }, { verdict: 'yes', quotes: [null], reason: 'x' }]) expect(readJudgement(value, evidence)).toMatchObject({ verdict: 'unknown', provenance: 'invalid' })
})
