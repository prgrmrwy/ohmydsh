import { describe, expect, it, vi } from 'vitest'
import { createRoutingRegistry, createRoutingDispatcher } from '../src/routing.js'

describe('routing authority boundaries', () => {
  it('unapproved_provider_unavailable_with_zero_callbacks', async () => {
    const registry = createRoutingRegistry('third-party')
    const decide = vi.fn(() => ({ status: 'selected' as const, authority: 'none' as const }))
    registry.register({ id: 'third-party', contractVersion: 1, stages: ['change-necessity'], decide })
    expect(await registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })).toMatchObject({ status: 'unavailable', reason: 'provider-not-approved', authority: 'none' })
    expect(decide).not.toHaveBeenCalled()
  })
  it('existing_change_returns_recorded_schema_without_callback', async () => {
    const registry = createRoutingRegistry('test')
    const decide = vi.fn(() => ({ status: 'selected' as const, authority: 'none' as const }))
    registry.register({ id: 'test', contractVersion: 1, stages: ['change-necessity'], decide, testOnly: true })
    const result = await createRoutingDispatcher().dispatch(registry, { stage: 'change-necessity', sessionId: 's', features: {}, changeName: 'add-auth' }, { existingChange: { schema: 'anvil' } })
    expect(result).toMatchObject({ status: 'selected', source: 'existing-change', schema: 'anvil', authority: 'none' })
    expect(decide).not.toHaveBeenCalled()
  })
  it('confident_result_has_authority_none_and_no_side_effects', async () => {
    const registry = createRoutingRegistry('test')
    registry.register({ id: 'test', contractVersion: 1, stages: ['change-necessity'], testOnly: true, decide: () => ({ status: 'selected', route: 'direct', confidence: 0.99, authority: 'some' as any }) })
    const result = await registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })
    expect(result).toMatchObject({ status: 'selected', authority: 'none' })
    expect(result).not.toHaveProperty('errorText')
  })
})
