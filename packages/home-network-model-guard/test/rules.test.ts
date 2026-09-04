import { describe, expect, it } from 'vitest'
import { classifyCountry, isClaudeFamily } from '../src/rules.js'

describe('classifyCountry (blocklist semantics)', () => {
  it('hits the blocklist as blocked', () => {
    expect(classifyCountry('CN', ['CN'])).toBe('blocked')
    expect(classifyCountry('cn', ['CN'])).toBe('blocked') // lower-case input normalized
    expect(classifyCountry('CN', ['US', 'CN'])).toBe('blocked')
  })

  it('treats everything else as allowed — never inverts to blocked', () => {
    expect(classifyCountry('SG', ['CN'])).toBe('allowed')
    expect(classifyCountry('US', ['CN'])).toBe('allowed')
    // A country absent from the blocklist must never become "blocked".
    expect(classifyCountry('JP', ['CN'])).toBe('allowed')
  })

  it('blocks by default list containing CN', () => {
    expect(classifyCountry('CN', ['CN'])).toBe('blocked')
    expect(classifyCountry('HK', ['CN'])).toBe('allowed')
  })
})

describe('isClaudeFamily (provider + model dual-field)', () => {
  it('matches the subscriptions claude route id', () => {
    expect(isClaudeFamily('claude', 'claude-sonnet-4-5')).toBe(true)
    expect(isClaudeFamily('claude', '')).toBe(true)
    expect(isClaudeFamily(' anthropic ', 'claude-opus-4-1')).toBe(true)
  })

  it('matches anthropic models even under a non-claude provider string', () => {
    expect(isClaudeFamily('api-key', 'claude-sonnet-4-5')).toBe(true)
    expect(isClaudeFamily('deepseek', 'claude-haiku-4-5')).toBe(true)
  })

  it('does not match non-Claude selections', () => {
    expect(isClaudeFamily('deepseek', 'deepseek-chat')).toBe(false)
    expect(isClaudeFamily('grok', 'grok-4')).toBe(false)
    expect(isClaudeFamily('', '')).toBe(false)
  })
})