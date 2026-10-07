import { describe, expect, it } from 'vitest'
import { createRoutingRegistry, createRoutingDispatcher } from '../src/routing.js'

describe('routing API exposure', () => {
  it('single_entry_is_only_route_to_provider_and_no_other_export_reaches_it', async () => {
    const registry = createRoutingRegistry('test')
    let calls = 0
    registry.register({ id: 'test', contractVersion: 1, stages: ['change-necessity'], testOnly: true, decide: () => { calls++; return { status: 'needs-review', authority: 'none' } } })
    const entry = createRoutingDispatcher()
    await entry.dispatch(registry, { stage: 'change-necessity', sessionId: 's', features: {} })
    expect(calls).toBe(1)
    expect(Object.keys(entry).sort()).toEqual(['consumeToken', 'dispatch', 'issueFormalToken', 'issueToken', 'validateCandidateText', 'validateChange'])
  })
})
