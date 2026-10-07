import { describe, expect, it, vi } from 'vitest'
import { createRoutingRegistry } from '../src/routing.js'

describe('experimental routing registry', () => {
  it('selected_provider_invoked_once_then_unavailable_after_dispose', async () => {
    const registry = createRoutingRegistry('fixture')
    const callback = vi.fn(async (request: any) => ({ status: 'selected', stage: request.stage, authority: 'none' as const }))
    const dispose = registry.register({ id: 'fixture', contractVersion: 1, stages: ['change-necessity'], decide: callback, testOnly: true })
    expect((await registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })).status).toBe('selected')
    dispose()
    expect((await registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })).status).toBe('unavailable')
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('invalid_or_missing_provider_never_falls_back', async () => {
    const registry = createRoutingRegistry('missing')
    const other = vi.fn()
    registry.register({ id: 'other', contractVersion: 1, stages: ['change-necessity'], decide: other, testOnly: true })
    expect(await registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })).toMatchObject({ status: 'unavailable', reason: 'no-active-provider' })
    expect(other).not.toHaveBeenCalled()
  })
  it('duplicate_and_incompatible_version_are_rejected', () => {
    const registry = createRoutingRegistry('x')
    const provider = { id: 'x', contractVersion: 1, stages: ['change-necessity'] as const, decide: () => ({ status: 'unavailable' as const, authority: 'none' as const }), testOnly: true }
    registry.register(provider)
    expect(() => registry.register(provider)).toThrowError(/routing-registration-invalid/)
    expect(() => registry.register({ ...provider, id: 'y', contractVersion: 2 })).toThrowError(/routing-registration-invalid/)
  })
})
