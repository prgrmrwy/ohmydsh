import { expect, it } from 'vitest'
import { auditExecution } from '../src/eval/audit.js'

it('a descendant route mismatch makes the whole item a configuration mismatch', () => {
  const result = auditExecution('root', { provider: 'p', model: 'fixed', effort: 'high' }, [
    { id: 'root', events: [{ type: 'request', seq: 1, route: { provider: 'p', model: 'fixed', effort: 'high' }, inputTokens: 10, outputTokens: 3 }] },
    { id: 'child', parent: 'root', events: [{ type: 'request', seq: 1, route: { provider: 'other', model: 'fixed', effort: 'high' }, inputTokens: 2, outputTokens: 1 }] },
  ])
  expect(result.status).toBe('configuration-mismatch')
  expect(result.inputTokens).toBe(12)
  expect(result.sessions).toEqual(['root', 'child'])
})

it('deduplicates seed identities without dropping descendant cost', () => {
  const request = { type: 'request' as const, seq: 1, originSession: 'root', originSeq: 1, route: { provider: 'p', model: 'fixed' }, inputTokens: 10, outputTokens: 3 }
  const result = auditExecution('root', { provider: 'p', model: 'fixed' }, [
    { id: 'root', events: [request] },
    { id: 'child', parent: 'root', events: [request, { type: 'request', seq: 2, route: { provider: 'p', model: 'fixed' }, inputTokens: 2, outputTokens: 1 }] },
    { id: 'daily', events: [{ type: 'request', seq: 1, route: { provider: 'other', model: 'other' }, inputTokens: 9000, outputTokens: 9000 }] },
  ])
  expect(result.status).toBe('valid')
  expect(result.inputTokens).toBe(12)
  expect(result.outputTokens).toBe(4)
})

it('conflicting inherited event identities never hide a descendant route mismatch', () => {
  const result = auditExecution('root', { provider: 'p', model: 'fixed' }, [
    { id: 'root', events: [{ type: 'request', seq: 1, route: { provider: 'p', model: 'fixed' }, inputTokens: 1, outputTokens: 1 }] },
    { id: 'child', parent: 'root', events: [{ type: 'request', seq: 1, originSession: 'root', originSeq: 1, route: { provider: 'wrong', model: 'fixed' }, inputTokens: 1, outputTokens: 1 }] },
  ])
  expect(result.status).not.toBe('valid')
})

it('aggregates raw token categories once per inherited identity and leaves unrecorded categories unknown', () => {
  const event = { type: 'request' as const, seq: 1, originSession: 'root', originSeq: 1, route: { provider: 'p', model: 'm' }, inputTokens: 15, outputTokens: 1, tokenCategories: { uncachedInput: 2, cacheRead: 10, cacheWrite: 3 } }
  const result = auditExecution('root', event.route, [{ id: 'root', events: [event] }, { id: 'child', parent: 'root', events: [event] }])
  expect(result).toMatchObject({ tokenCategories: event.tokenCategories, inputTokens: 15 })
  const { tokenCategories: _categories, ...legacy } = event
  expect(auditExecution('root', event.route, [{ id: 'root', events: [legacy] }]).tokenCategories).toBeUndefined()
})

it('refuses aggregate token overflow even when every request has safe integer usage', () => {
  const route = { provider: 'p', model: 'm' }
  for (const field of ['inputTokens', 'outputTokens'] as const) {
    const event = { type: 'request' as const, seq: 1, route, inputTokens: 1, outputTokens: 1, [field]: Number.MAX_SAFE_INTEGER }
    const result = auditExecution('root', route, [{ id: 'root', events: [event, { ...event, seq: 2 }] }])
    expect(result.status).toBe('evidence-missing')
  }
})

it('missing logs or absent route evidence remain evidence-missing, never a pass', () => {
  for (const sessions of [[], [{ id: 'root', events: [] }], [{ id: 'root', events: [{ type: 'request' as const, seq: 1 }] }], [{ id: 'root', missing: true, events: [] }]]) {
    expect(auditExecution('root', { provider: 'p', model: 'fixed' }, sessions).status).toBe('evidence-missing')
  }
})
