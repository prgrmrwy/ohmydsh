import { describe, expect, it } from 'vitest'
import { evaluateCrossWrite } from '../src/guard/index.js'
import type { ScopeResolution, ScopeService } from '../src/scope/types.js'
import { parseOrgProfile } from '../src/org.js'

function scope(name: string, publish: 'internal' | 'external', workspacePaths: string[] = []): ScopeResolution {
  return { scope: name, home: `/memex/${name}`, publish, publishKnown: true, memory: true, source: 'config', created: false, workspacePaths }
}

const internal = scope('team-acme', 'internal', ['/work/acme'])
const external = scope('ohmydsh', 'external')
const resolver = { list: () => [internal, external] } as ScopeService

describe('cross-write guard', () => {
  it('rejects a target whose publication direction is unknown', () => {
    const unknown = { ...external, publishKnown: false, source: 'discovered' as const }
    expect(evaluateCrossWrite({ slug: 'x', body: 'generic' }, unknown, resolver)).toMatchObject({ allowed: false, rules: ['configuration:publish-unknown'] })
  })
  it('does not gate writes to internal libraries', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'team-acme details' }, internal, resolver).allowed).toBe(true)
  })
  it('warns instead of blocking when an unrelated scope has unknown direction', () => {
    const stray = { ...scope('stray-dir', 'external'), publishKnown: false, source: 'discovered' as const }
    const service = { list: () => [internal, stray, external] } as ScopeService
    const decision = evaluateCrossWrite({ slug: 'x', body: 'generic text' }, external, service, ['/work/acme'])
    expect(decision.allowed).toBe(true)
    expect(decision.warnings).toContain('configuration:known-scope-publish-unknown')
  })
  it('still derives deny terms from a scope whose direction is unknown', () => {
    const stray = { ...scope('unknown-internal', 'external'), publishKnown: false, source: 'discovered' as const }
    const service = { list: () => [stray, external] } as ScopeService
    expect(evaluateCrossWrite({ slug: 'x', body: 'unknown-internal notes' }, external, service).rules).toContain('deny-term:unknown-internal')
  })
  it('keeps a rule with no input inactive instead of blocking every write', () => {
    const noPaths = scope('other-internal', 'internal')
    const service = { list: () => [noPaths, external] } as ScopeService
    const decision = evaluateCrossWrite({ slug: 'x', body: 'generic text' }, external, service)
    expect(decision).toMatchObject({ allowed: true, rules: [] })
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
    expect(evaluateCrossWrite({ slug: 'x', body: 'team-acme details' }, external, resolver)).toMatchObject({ allowed: false, rules: ['deny-term:team-acme'] })
  })
  it('uses boundaries rather than matching scope substrings', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'prefixteam-acmesuffix' }, external, resolver).allowed).toBe(true)
  })
  const org = parseOrgProfile({ internalHosts: ['git.corp.example'], internalDomains: ['corp.example', 'intra.example'] })
  it('rejects private IPs, internal remotes and workspace paths', () => {
    const decision = evaluateCrossWrite({ slug: 'x', body: '127.0.0.1 fc00::1 ssh://git@git.corp.example/team/acme.git /work/acme/src' }, external, resolver, ['/work/acme'], org)
    expect(decision.rules).toEqual(expect.arrayContaining(['structural:private-ip', 'structural:internal-remote', 'structural:workspace-path']))
  })
  it('rejects hosts under a configured internal domain, by label boundary', () => {
    expect(evaluateCrossWrite({ slug: 'x', body: 'see wiki.intra.example/page' }, external, resolver, [], org).rules).toContain('structural:internal-domain')
    expect(evaluateCrossWrite({ slug: 'x', body: 'see notintra.example/page' }, external, resolver, [], org).rules).not.toContain('structural:internal-domain')
  })
  it('matches scp, ssh and https remote forms on a configured host', () => {
    for (const remote of ['git@git.corp.example:team/acme.git', 'ssh://me@git.corp.example/team/acme.git', 'https://git.corp.example/team/acme']) {
      expect(evaluateCrossWrite({ slug: 'x', body: remote }, external, resolver, [], org).rules).toContain('structural:internal-remote')
    }
  })
  it('keeps the internal-host rules inactive and reported when no organization is configured', () => {
    const decision = evaluateCrossWrite({ slug: 'x', body: 'git@git.corp.example:team/acme.git' }, external, resolver)
    expect(decision.rules).not.toContain('structural:internal-remote')
    expect(decision.warnings).toContain('structural:internal-host-rule-inactive')
  })
})
