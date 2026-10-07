import { describe, expect, it, vi } from 'vitest'
import { createRoutingRegistry } from '../src/routing.js'

describe('routing failures', () => {
  it('needs_review_passes_through_without_substitution', async () => {
    const registry = createRoutingRegistry('fixture')
    registry.register({ id: 'fixture', contractVersion: 1, stages: ['change-necessity'], decide: () => ({ status: 'needs-review', reason: 'uncertain', authority: 'none' as const }), testOnly: true })
    expect(await registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })).toMatchObject({ status: 'needs-review', reason: 'uncertain', authority: 'none' })
  })
  it('timeout_cancel_throw_unload_normalize_and_persist_no_text', async () => {
    vi.useFakeTimers()
    try {
      const registry = createRoutingRegistry('fixture')
      const dispose = registry.register({ id: 'fixture', contractVersion: 1, stages: ['change-necessity'], decide: () => new Promise(() => {}), testOnly: true })
      const pending = registry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })
      dispose()
      await vi.runOnlyPendingTimersAsync()
      expect(await pending).toMatchObject({ status: 'unavailable', authority: 'none' })
      const errorRegistry = createRoutingRegistry('bad')
      errorRegistry.register({ id: 'bad', contractVersion: 1, stages: ['change-necessity'], decide: () => { throw new Error('private request text') }, testOnly: true })
      const result = await errorRegistry.dispatch({ stage: 'change-necessity', sessionId: 's', features: {} })
      expect(result).not.toHaveProperty('errorText')
      expect(JSON.stringify(result)).not.toContain('private request text')
      expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-error', errorClass: 'provider-error' })
    } finally { vi.useRealTimers() }
  })
})
