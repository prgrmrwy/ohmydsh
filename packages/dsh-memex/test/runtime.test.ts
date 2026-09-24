import { describe, expect, it } from 'vitest'
import { ScopeRuntime } from '../src/scope/runtime.js'

const original = {
  autoDerive: false,
  scopes: [{ name: 'old', pathPrefixes: ['/workspace'], publish: 'internal' as const }],
  bindings: [],
}

const replacement = {
  autoDerive: false,
  scopes: [{ name: 'new', pathPrefixes: ['/workspace'], publish: 'external' as const }],
  bindings: [],
}

describe('ScopeRuntime', () => {
  it('keeps a stable service facade that observes live resolver replacement', () => {
    const runtime = new ScopeRuntime(original)
    const service = runtime.current
    expect(service.resolve('/workspace/project').scope).toBe('old')
    runtime.replace(replacement)
    expect(runtime.current).toBe(service)
    expect(service.resolve('/workspace/project').scope).toBe('new')
  })
})
