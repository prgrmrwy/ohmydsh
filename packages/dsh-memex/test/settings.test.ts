import { describe, expect, it } from 'vitest'
import { validateMemexSettings } from '../src/scope/settings.js'

const valid = {
  autoDerive: true,
  scopes: [
    { name: 'apaas-nexus', remotePatterns: ['code\\.byted\\.org[:/]apaas/nexus'], publish: 'internal' as const },
    { name: 'ohmydsh', remotePatterns: ['github\\.com[:/]prgrmrwy/ohmydsh'], publish: 'external' as const },
  ],
  bindings: [{ name: 'workspace', read: ['apaas-nexus', 'personal'], write: ['apaas-nexus', 'personal'] }],
}

describe('memex settings validation', () => {
  it('accepts valid scopes and bindings', () => expect(() => validateMemexSettings(valid)).not.toThrow())
  it('allows an explicit personal entry to set its publication direction', () => expect(() => validateMemexSettings({ ...valid, scopes: [...valid.scopes, { name: 'personal', publish: 'external' }] })).not.toThrow())
  it('rejects duplicate scope names', () => expect(() => validateMemexSettings({ ...valid, scopes: [...valid.scopes, valid.scopes[0]!] })).toThrow(/duplicate scope/))
  it('rejects invalid remote regular expressions', () => expect(() => validateMemexSettings({ ...valid, scopes: [{ name: 'bad', remotePatterns: ['['] }] })).toThrow(/invalid remote pattern/))
  it('rejects binding references to unknown scopes', () => expect(() => validateMemexSettings({ ...valid, bindings: [{ name: 'bad', read: ['missing'], write: [] }] })).toThrow(/unknown scope/))
  it('rejects duplicate binding names', () => expect(() => validateMemexSettings({ ...valid, bindings: [valid.bindings[0]!, valid.bindings[0]!] })).toThrow(/duplicate binding/))
  it('rejects a scope in multiple bindings', () => expect(() => validateMemexSettings({ ...valid, bindings: [valid.bindings[0]!, { name: 'other', read: ['apaas-nexus'], write: [] }] })).toThrow(/multiple bindings/))
})
