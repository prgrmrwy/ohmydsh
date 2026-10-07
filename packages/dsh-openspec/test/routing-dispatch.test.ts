import { describe, expect, it, vi } from 'vitest'
import { createRoutingDispatcher, createRoutingRegistry } from '../src/routing.js'

describe('routing dispatcher', () => {
  it('two_stage_tokens_correlate_and_candidate_kinds_differ', async () => {
    const now = () => 1000; const dispatcher = createRoutingDispatcher({ now })
    const registry = createRoutingRegistry('test')
    const decide = vi.fn(async (request: any) => ({ status: 'selected', stage: request.stage, token: request.token, candidateId: 'schema', authority: 'none' as const }))
    registry.register({ id: 'test', contractVersion: 1, stages: ['change-necessity', 'workflow-selection'], decide, testOnly: true })
    const firstToken = dispatcher.issueFormalToken('s', 'formal-workflow')!
    const token = dispatcher.issueFormalToken('s', 'formal-workflow')!
    const first = await dispatcher.dispatch(registry, { stage: 'workflow-selection', sessionId: 's', firstStageOutcome: 'formal-workflow', token: firstToken, features: {} })
    const second = await dispatcher.dispatch(registry, { stage: 'workflow-selection', sessionId: 's', firstStageOutcome: 'formal-workflow', token, features: {}, candidates: [{ id: 'schema', kind: 'official-schema' }, { id: 'external', kind: 'external-workflow' }] }, { eligibleCandidateIds: ['schema', 'external'] })
    expect(dispatcher.consumeToken(token, 's')).toBe(false)
    expect(first.authority).toBe('none'); expect(second.authority).toBe('none')
    expect(second.candidates).toEqual([{ id: 'schema', kind: 'official-schema', description: '' }, { id: 'external', kind: 'external-workflow', description: '' }])
  })
  it('invalid_stage_tokens_refused_with_zero_callbacks', async () => {
    let now = 1000; const d = createRoutingDispatcher({ now: () => now })
    const registry = createRoutingRegistry('test'); const callback = vi.fn(() => ({ status: 'selected' as const, authority: 'none' as const }))
    registry.register({ id: 'test', contractVersion: 1, stages: ['workflow-selection'], testOnly: true, decide: callback })
    const token = d.issueToken('session-A')
    expect(d.consumeToken(token, 'session-B')).toBe(false)
    const expired = d.issueToken('session-A'); now += 600_001
    expect(d.consumeToken(expired, 'session-A')).toBe(false)
    const forged = await d.dispatch(registry, { stage: 'workflow-selection', sessionId: 'session-A', firstStageOutcome: 'direct', token: 'forged', features: {} })
    expect(forged).toMatchObject({ status: 'unavailable', reason: 'invalid-stage-token' })
    expect(callback).not.toHaveBeenCalled()
  })
  it('traversal_change_name_rejected_and_candidate_text_bounded_stripped_labeled', async () => {
    const dispatcher = createRoutingDispatcher()
    expect(await dispatcher.validateChange('/tmp/root', '../../etc', 'openspec/changes')).toMatchObject({ valid: false, reason: 'invalid-change-name' })
    const text = dispatcher.validateCandidateText('x'.repeat(2047) + '\\u0001evil')
    expect(text).toContain('[untrusted schema description]')
    expect(text).not.toContain('\\u0001')
    expect(text.length).toBeLessThanOrEqual(2048 + 40)
  })
  it('unknown_features_or_ineligible_candidate_needs_review', async () => {
    const registry = createRoutingRegistry('x')
    registry.register({ id: 'x', contractVersion: 1, stages: ['change-necessity'], decide: () => ({ status: 'needs-review', authority: 'none' as const }), testOnly: true })
    const dispatcher = createRoutingDispatcher()
    const result = await dispatcher.dispatch(registry, { stage: 'change-necessity', sessionId: 's', features: { conversation: 'raw' } })
    expect(result.status).toBe('needs-review')
    expect(result.reason).toBe('unknown-feature')
  })
})
