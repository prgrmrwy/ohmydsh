import { describe, expect, it } from 'vitest'
import { classifyIp, HOME_NETWORKS, isClaudeFamily } from '../src/rules.js'

describe('classifyIp (whitelist semantics)', () => {
  it('hits the allowlist as home', () => {
    expect(classifyIp('1.2.3.4', ['1.2.3.4'])).toBe('home')
    expect(classifyIp('1.2.3.4', ['9.9.9.9', '1.2.3.4'])).toBe('home')
  })

  it('treats everything else as not-home — never inverts to home', () => {
    expect(classifyIp('203.0.113.1', ['1.2.3.4'])).toBe('not-home')
    // A rotating egress pool returning an unlisted address must NOT become
    // "home" just because it did not hit a known non-home set.
    expect(classifyIp('198.51.100.2', ['1.2.3.4'])).toBe('not-home')
  })

  it('never blocks on an empty allowlist', () => {
    expect(classifyIp('1.2.3.4', [])).toBe('not-home')
    expect(classifyIp('1.2.3.4')).toBe('not-home') // default allowlist has other entries
  })

  it('classifies the configured home egress IP as home via the default allowlist', () => {
    // Reads the constant instead of repeating the value: tests stay valid when
    // the owner updates HOME_NETWORKS (task 5.1 filled it from measurement).
    expect(classifyIp(HOME_NETWORKS[0] ?? '')).toBe('home')
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