import { describe, expect, it } from 'vitest'
import { evaluateCrossWrite } from '../src/guard/index.js'
import type { ScopeResolution, ScopeService } from '../src/scope/types.js'

function scope(name: string, publish: 'internal' | 'external', workspacePaths: string[] = []): ScopeResolution {
  return { scope: name, home: `/memex/${name}`, publish, publishKnown: true, source: 'config', created: false, workspacePaths }
}

const internal = scope('apaas-nexus', 'internal', ['/work/nexus'])
const external = scope('ohmydsh', 'external')
const resolver = { list: () => [internal, external] } as ScopeService

describe('cross-write guard', () => {
  it('rejects a target whose publication direction is unknown', () => {
    const unknown = { ...external, publishKnown: false, source: 'discovered' as const }
    expect(evaluateCrossWrite({ slug: 'x', body: 'generic' }, unknown, resolver)).toMatchObject({ allowed: false, rules: ['configuration:publish-unknown'] })
  })
  it('does not gate writes to internal libraries', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'apaas-nexus details' }, internal, resolver).allowed).toBe(true)
  })
  it('keeps a rule with no input inactive instead of blocking every write', () => {
    const noPaths = scope('other-internal', 'internal')
    const service = { list: () => [noPaths, external] } as ScopeService
    const decision = evaluateCrossWrite({ slug: 'x', body: 'generic text' }, external, service)
    expect(decision).toMatchObject({ allowed: true, rules: [], warnings: ['structural:workspace-path-rule-inactive'] })
  })
  it('still rejects on the other rules while the path rule is inactive', () => {
    const noPaths = scope('other-internal', 'internal')
    const service = { list: () => [noPaths, external] } as ScopeService
    const decision = evaluateCrossWrite({ slug: 'x', body: 'other-internal detail' }, external, service)
    expect(decision.allowed).toBe(false)
    expect(decision.rules).toContain('deny-term:other-internal')
    expect(decision.warnings).toContain('structural:workspace-path-rule-inactive')
  })
  it('does not derive deny terms from external scope names', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'ohmydsh personal' }, external, resolver).allowed).toBe(true)
  })
  it('does not derive deny terms shorter than four characters', () => {
    const short = scope('api', 'internal', ['/work/api'])
    const service = { list: () => [short, external] } as ScopeService
    expect(evaluateCrossWrite({ slug: 'x', body: 'api usage' }, external, service, ['/work/api']).allowed).toBe(true)
  })
  it('rejects internal scope terms in external writes', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'apaas-nexus details' }, external, resolver)).toMatchObject({ allowed: false, rules: ['deny-term:apaas-nexus'] })
  })
  it('uses boundaries rather than matching scope substrings', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'prefixapaas-nexussuffix' }, external, resolver).allowed).toBe(true)
  })
  it('rejects private IPs, internal remotes and workspace paths', () => {
    const decision = evaluateCrossWrite({ slug: 'x', body: '127.0.0.1 fc00::1 ssh://git@code.byted.org/apaas/nexus.git byted.org /work/nexus/src' }, external, resolver, ['/work/nexus'])
    expect(decision.rules).toEqual(expect.arrayContaining(['structural:private-ip', 'structural:internal-remote', 'structural:workspace-path']))
  })
})
