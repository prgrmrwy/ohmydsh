import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyProviderEvent,
  providerProjectionInitialState,
  providerSchema,
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

  it('schema accepts a valid projection and rejects a bad wire value', () => {
    expect(providerSchema.parse({ provider: 'codex', model: 'gpt-5-codex' })).toEqual({ provider: 'codex', model: 'gpt-5-codex' })
    expect(providerSchema.parse(null)).toBeNull()
    expect(() => providerSchema.parse({ model: 'x' })).toThrow()
    expect(() => providerSchema.parse({ provider: 'codex', model: 'gpt', extra: 1 })).toThrow()
  })
})
