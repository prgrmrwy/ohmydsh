import { homedir } from 'node:os'
import { join } from 'node:path'
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
  // The fallback flag is a per-entry decision, absent meaning "on".
  it('accepts a scope that turns its fallback entry off', () => expect(() => validateMemexSettings({
    ...valid,
    scopes: [...valid.scopes, { name: 'solo', fallback: false }],
  })).not.toThrow())
  it('accepts a scope with memory switched off', () => expect(() => validateMemexSettings({
    ...valid,
    scopes: [...valid.scopes, { name: 'work-thing', memory: false }],
  })).not.toThrow())
  it('allows an explicit personal entry to set its publication direction', () => expect(() => validateMemexSettings({ ...valid, scopes: [...valid.scopes, { name: 'personal', publish: 'external' }] })).not.toThrow())
  it('rejects duplicate scope names', () => expect(() => validateMemexSettings({ ...valid, scopes: [...valid.scopes, valid.scopes[0]!] })).toThrow(/duplicate scope/))
  it('rejects invalid remote regular expressions', () => expect(() => validateMemexSettings({ ...valid, scopes: [{ name: 'bad', remotePatterns: ['['] }] })).toThrow(/invalid remote pattern/))
  it('rejects binding references to unknown scopes', () => expect(() => validateMemexSettings({ ...valid, bindings: [{ name: 'bad', read: ['missing'], write: [] }] })).toThrow(/unknown scope/))
  it('rejects duplicate binding names', () => expect(() => validateMemexSettings({ ...valid, bindings: [valid.bindings[0]!, valid.bindings[0]!] })).toThrow(/duplicate binding/))
  it('rejects a scope in multiple bindings', () => expect(() => validateMemexSettings({ ...valid, bindings: [valid.bindings[0]!, { name: 'other', read: ['apaas-nexus'], write: [] }] })).toThrow(/multiple bindings/))

  it('rejects two scopes sharing one library path', () => expect(() => validateMemexSettings({
    autoDerive: true,
    bindings: [],
    scopes: [{ name: 'one', home: '~/libs/shared' }, { name: 'two', home: join(homedir(), 'libs', 'shared') }],
  })).toThrow(/share the library path/))

  it('rejects a scope claiming the implicit personal library path', () => expect(() => validateMemexSettings({
    autoDerive: true,
    bindings: [],
    scopes: [{ name: 'mine', home: '~/.dsh-memex/personal' }],
  })).toThrow(/mine and personal share the library path/))

  it('rejects two scopes claiming one workspace with no primary, and with two', () => {
    const shared = { autoDerive: true, bindings: [], scopes: [
      { name: 'one', remotePatterns: ['apaas/nexus'] },
      { name: 'two', remotePatterns: ['apaas/nexus'] },
    ] }
    expect(() => validateMemexSettings(shared)).toThrow(/has 0 primary entries; mark exactly one/)
    expect(() => validateMemexSettings({ ...shared, scopes: [
      { name: 'one', primary: true, remotePatterns: ['apaas/nexus'] },
      { name: 'two', primary: true, remotePatterns: ['apaas/nexus'] },
    ] })).toThrow(/has 2 primary entries; mark exactly one/)
  })

  it('accepts one workspace split across two libraries when exactly one is primary', () => {
    expect(() => validateMemexSettings({ autoDerive: true, bindings: [], scopes: [
      { name: 'proj-internal', primary: true, pathPrefixes: ['~/work/proj'], publish: 'internal' },
      { name: 'proj-public', pathPrefixes: ['~/work/proj'], publish: 'external' },
    ] })).not.toThrow()
  })

  it('rejects a shared path prefix without a unique primary', () => {
    const shared = (primary?: [boolean, boolean]) => ({ autoDerive: true, bindings: [], scopes: [
      { name: 'one', pathPrefixes: ['~/work/proj'], ...(primary?.[0] === true ? { primary: true } : {}) },
      { name: 'two', pathPrefixes: ['~/work/proj'], ...(primary?.[1] === true ? { primary: true } : {}) },
    ] })
    expect(() => validateMemexSettings(shared())).toThrow(/path prefix .*proj is claimed by one, two but has 0 primary entries/)
    expect(() => validateMemexSettings(shared([true, true]))).toThrow(/has 2 primary entries/)
    expect(() => validateMemexSettings(shared([true, false]))).not.toThrow()
  })

  it('lets a lone claimer stay unmarked', () => expect(() => validateMemexSettings({
    autoDerive: true,
    bindings: [],
    scopes: [{ name: 'solo', pathPrefixes: ['~/work/solo'] }],
  })).not.toThrow())

  it('accepts distinct homes and a pattern repeated inside one scope', () => expect(() => validateMemexSettings({
    autoDerive: true,
    bindings: [],
    scopes: [{ name: 'one', remotePatterns: ['one', 'one'] }, { name: 'two' }],
  })).not.toThrow())
})
