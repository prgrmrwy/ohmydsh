import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyProviderEvent,
  providerProjectionInitialState,
  providerProjectionDefinition,
  providerSchema,
  providerStateSchema,
  viewProviderProjection,
} from '../src/provider.js'

/** Build a synthetic minimal event with the type/data discriminated union. */
function event(type: SessionEvent['type'], data: unknown, time = 1000): SessionEvent {
  return { type, seq: 1, time, data } as unknown as SessionEvent
}

function headerEvent(provider: string, model: string): SessionEvent {
  return event('request/header', { header: { config: { provider, model } }, reason: 'initial' })
}

describe('provider projection', () => {
  it('starts with no value (null projection)', () => {
    const state = providerProjectionInitialState
    expect(viewProviderProjection(state)).toBeNull()
  })

  it('records provider/model from a single request/header', () => {
    const state = applyProviderEvent(providerProjectionInitialState, headerEvent('codex', 'gpt-5-codex'))
    expect(state.provider).toBe('codex')
    expect(state.model).toBe('gpt-5-codex')
    expect(viewProviderProjection(state)).toEqual({ provider: 'codex', model: 'gpt-5-codex' })
  })

  it('lets a later header override the previous route', () => {
    let state = applyProviderEvent(providerProjectionInitialState, headerEvent('codex', 'gpt-5-codex'))
    state = applyProviderEvent(state, headerEvent('claude', 'claude-sonnet-4'))
    expect(viewProviderProjection(state)).toEqual({ provider: 'claude', model: 'claude-sonnet-4' })
  })

  it('returns the same reference for unrelated event types (zero downstream work)', () => {
    const base = applyProviderEvent(providerProjectionInitialState, headerEvent('grok', 'grok-4'))
    const next = applyProviderEvent(base, event('assistant/message', { turn: 1, step: 1, message: {} }))
    expect(next).toBe(base)
  })

  it('never reads the assistant message for the provider', () => {
    // The provider MUST come from the request header, not the statusless
    // assistant message (which carries no route identity).
    let state = providerProjectionInitialState
    state = applyProviderEvent(state, event('assistant/message', { turn: 1, step: 1, message: {} }))
    expect(viewProviderProjection(state)).toBeNull()
    state = applyProviderEvent(state, headerEvent('deepseek', 'deepseek-v4'))
    expect(state.provider).toBe('deepseek')
  })

  it('state schema accepts the empty fold state and rejects wire-shaped values', () => {
    // The persisted state keeps nullable fields; the wire value collapses the
    // empty case to null, so the two schemas are deliberately not interchangeable.
    expect(providerStateSchema.parse(providerProjectionInitialState)).toEqual({ provider: null, model: null })
    expect(providerStateSchema.parse({ provider: 'codex', model: 'gpt-5-codex' })).toEqual({ provider: 'codex', model: 'gpt-5-codex' })
    expect(() => providerStateSchema.parse(null)).toThrow()
    expect(() => providerStateSchema.parse({ provider: 'codex' })).toThrow()
  })

  it('registers a definition matching the host projection contract', () => {
    // Guards the rc.7 → 0.1.1 migration: state validation and the client view
    // are separate slots now (stateSchema + wire{viewSchema,view}).
    expect(providerProjectionDefinition.key).toBe('provider')
    expect(providerProjectionDefinition.stateSchema).toBe(providerStateSchema)
    expect(providerProjectionDefinition.wire.viewSchema).toBe(providerSchema)
    expect(providerProjectionDefinition.wire.view).toBe(viewProviderProjection)
    expect(providerProjectionDefinition.init()).toEqual({ provider: null, model: null })
    expect(Number.isInteger(providerProjectionDefinition.stateVersion)).toBe(true)
  })

  it('schema accepts a valid projection and rejects a bad wire value', () => {
    expect(providerSchema.parse({ provider: 'codex', model: 'gpt-5-codex' })).toEqual({ provider: 'codex', model: 'gpt-5-codex' })
    expect(providerSchema.parse(null)).toBeNull()
    expect(() => providerSchema.parse({ model: 'x' })).toThrow()
    expect(() => providerSchema.parse({ provider: 'codex', model: 'gpt', extra: 1 })).toThrow()
  })
})
