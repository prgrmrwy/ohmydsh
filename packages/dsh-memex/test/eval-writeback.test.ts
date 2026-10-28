import { expect, it } from 'vitest'
import { classifyWriteback, observeWriteback } from '../src/eval/writeback.js'

it('classifies only by the explicit request or reminder that preceded the first successful write', () => {
  expect(classifyWriteback([{ at: 5, kind: 'write', success: true }, { at: 6, kind: 'request' }])).toBe('proactive')
  expect(classifyWriteback([{ at: 1, kind: 'reminder' }, { at: 2, kind: 'request' }, { at: 3, kind: 'write', success: true }])).toBe('requested')
  expect(classifyWriteback([{ at: 1, kind: 'reminder' }, { at: 3, kind: 'write', success: true }])).toBe('reminded')
})
it('failed writes do not establish writeback or erase a later successful write', () => {
  expect(classifyWriteback([{ at: 1, kind: 'write', success: false }])).toBe('not-written')
  expect(classifyWriteback([{ at: 1, kind: 'write', success: false }, { at: 2, kind: 'request' }, { at: 3, kind: 'write', success: true }])).toBe('requested')
})
it('ambiguous cross-session order is unknown rather than inventing causality', () => {
  expect(classifyWriteback([{ at: 3, kind: 'request' }, { at: 3, kind: 'write', success: true }])).toBe('unknown')
  expect(classifyWriteback([{ at: Number.NaN, kind: 'write', success: true }])).toBe('unknown')
})

it('EVAL-041: 先主动后要求不追溯改类', () => {
  // turn 1 writes successfully; the explicit request only arrives in turn 2
  expect(classifyWriteback([{ at: 1, kind: 'write', success: true }, { at: 2, kind: 'request' }, { at: 3, kind: 'write', success: true }])).toBe('proactive')
})

it('EVAL-042: 明确要求后未写', () => {
  const observed = observeWriteback([{ at: 1, kind: 'request' }, { at: 2, kind: 'write', success: false }, { at: 3, kind: 'write', success: false }])
  expect(observed.class).toBe('not-written')
  expect(observed.class).not.toBe('requested')
  expect(observed.failedWrites).toBe(2)
})
