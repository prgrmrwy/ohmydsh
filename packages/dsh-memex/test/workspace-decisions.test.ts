import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScopeResolver } from '../src/scope/resolver.js'
import { validateMemexSettings } from '../src/scope/settings.js'
import type { ScopeConfig, ScopeResolverOptions } from '../src/scope/types.js'

function resolverFor(config: Partial<ScopeConfig>, extra: Partial<ScopeResolverOptions> = {}) {
  return createScopeResolver({
    homeDir: mkdtempSync(join(tmpdir(), 'dsh-memex-ws-')),
    gitRemote: () => undefined,
    gitRoot: () => undefined,
    config,
    ...extra,
  })
}

const full = (config: Partial<ScopeConfig>): ScopeConfig => ({ autoDerive: true, scopes: [], bindings: [], ...config })

describe('workspace declarations', () => {
  it('a path declaration turns memory off for one workspace of a shared library only', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'personal', pathPrefixes: ['/w/a', '/w/b'] }],
      workspaces: [{ path: '/w/a', memory: false }],
    })
    expect(resolver.resolve('/w/a')).toMatchObject({ scope: 'personal', memory: false })
    expect(resolver.resolve('/w/a').offBy.memory).toEqual([{ kind: 'workspace', path: '/w/a' }])
    expect(resolver.resolve('/w/b')).toMatchObject({ scope: 'personal', memory: true })
    expect(resolver.resolve('/w/b').offBy.memory).toEqual([])
  })

  it('one library is primary in one workspace and additional in another by declaration', () => {
    const config = full({
      scopes: [{ name: 'a', pathPrefixes: ['/w/p', '/w/q'] }, { name: 'b', pathPrefixes: ['/w/p', '/w/q'] }],
      workspaces: [{ path: '/w/p', primary: 'a' }, { path: '/w/q', primary: 'b' }],
    })
    expect(() => validateMemexSettings(config)).not.toThrow()
    const resolver = resolverFor(config)
    expect(resolver.resolve('/w/p/src')).toMatchObject({ scope: 'a', entries: ['a', 'b'] })
    expect(resolver.resolve('/w/q/src')).toMatchObject({ scope: 'b', entries: ['b', 'a'] })
  })

  it('a workspace primary declaration outranks the entry-level primary mark', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'a', primary: true, pathPrefixes: ['/w/p'] }, { name: 'b', pathPrefixes: ['/w/p'] }],
      workspaces: [{ path: '/w/p', primary: 'b' }],
    })
    expect(resolver.resolve('/w/p').scope).toBe('b')
  })

  it('a section without workspaces resolves exactly as 0.2.0 did', () => {
    const legacy: Partial<ScopeConfig> = {
      scopes: [
        { name: 'a', primary: true, pathPrefixes: ['/w/p'], memory: false },
        { name: 'b', pathPrefixes: ['/w/p'] },
        { name: 'c', pathPrefixes: ['/w/c'], fallback: false },
        { name: 'r', remotePatterns: ['org/repo'] },
      ],
    }
    for (const config of [legacy, { ...legacy, workspaces: [] }]) {
      const resolver = resolverFor(config, { gitRemote: cwd => (cwd.startsWith('/x') ? 'git@github.com:org/repo.git' : undefined) })
      expect(resolver.resolve('/w/p/src')).toMatchObject({ scope: 'a', memory: false, fallback: true, entries: ['a', 'b'] })
      expect(resolver.resolve('/w/p/src').access.write).toEqual(['a', 'b', 'personal'])
      expect(resolver.resolve('/w/c')).toMatchObject({ scope: 'c', memory: true, fallback: false })
      expect(resolver.resolve('/w/c').access).toEqual({ current: 'c', read: ['c'], write: ['c'] })
      expect(resolver.resolve('/x/repo')).toMatchObject({ scope: 'r', memory: true, fallback: true })
      expect(resolver.resolve('/tmp/loose/dir')).toMatchObject({ scope: 'loose-dir', memory: true, fallback: true })
    }
  })

  it('a declaration governs every directory beneath it across path, remote, derived and local routes', () => {
    const resolver = resolverFor({
      scopes: [{ name: 's', pathPrefixes: ['/w/proj/lib'] }, { name: 'r', remotePatterns: ['org/claimed'] }],
      workspaces: [{ path: '/w/proj', memory: false }],
    }, {
      gitRemote: cwd => cwd === '/w/proj/remote' ? 'git@github.com:org/claimed.git'
        : cwd === '/w/proj/derived' ? 'git@github.com:org/free.git' : undefined,
    })
    const routes = ['/w/proj/sub', '/w/proj/lib', '/w/proj/remote', '/w/proj/derived', '/w/proj']
      .map(cwd => resolver.resolve(cwd))
    expect(routes.map(route => route.source)).toEqual(['local', 'config', 'config', 'derived', 'local'])
    expect(routes.map(route => route.memory)).toEqual([false, false, false, false, false])
    // A sibling that merely shares the string prefix is not covered.
    expect(resolver.resolve('/w/project').memory).toBe(true)
  })

  it('adding or removing claims never reopens a directory a declaration closed', () => {
    const workspaces = [{ path: '/w/proj', memory: false as const, fallback: false as const }]
    const remote = { gitRemote: () => 'git@github.com:org/proj.git' }
    const claimed = resolverFor({ scopes: [{ name: 'a', pathPrefixes: ['/w/proj'] }], workspaces }, remote).resolve('/w/proj')
    const unclaimed = resolverFor({ scopes: [{ name: 'a' }], workspaces }, remote).resolve('/w/proj')
    expect(claimed).toMatchObject({ scope: 'a', memory: false, fallback: false })
    expect(unclaimed).toMatchObject({ scope: 'org-proj', source: 'derived', memory: false, fallback: false })
    expect(unclaimed.access.read).not.toContain('personal')
  })

  it('memory and fallback are off when either the declaration or the primary entry says off', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'e', pathPrefixes: ['/w/e'], fallback: false }, { name: 'd', pathPrefixes: ['/w/d'] }],
      workspaces: [{ path: '/w/d', fallback: false }],
    })
    const byEntry = resolver.resolve('/w/e')
    const byDeclaration = resolver.resolve('/w/d')
    expect([byEntry.fallback, byDeclaration.fallback]).toEqual([false, false])
    expect(byEntry.offBy.fallback).toEqual([{ kind: 'entry', scope: 'e' }])
    expect(byDeclaration.offBy.fallback).toEqual([{ kind: 'workspace', path: '/w/d' }])
    expect(byDeclaration.access.write).toEqual(['d'])
    // Both sources at once are both reported.
    const both = resolverFor({
      scopes: [{ name: 'e', pathPrefixes: ['/w/e'], memory: false }],
      workspaces: [{ path: '/w', memory: false }, { path: '/w/e', memory: false }],
    }).resolve('/w/e/x')
    expect(both.offBy.memory).toEqual([{ kind: 'workspace', path: '/w' }, { kind: 'workspace', path: '/w/e' }, { kind: 'entry', scope: 'e' }])
  })

  it('refuses to resolve a stale declared primary instead of falling back', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'a', primary: true, pathPrefixes: ['/w/p'] }, { name: 'b', pathPrefixes: ['/w/p'] }, { name: 'c' }],
      workspaces: [{ path: '/w/p', primary: 'c' }],
    })
    expect(() => resolver.resolve('/w/p/src')).toThrow(/workspace declaration \/w\/p names primary c, which does not claim it \(claimers: a, b\)/i)
  })

  it('a fallback declaration on one workspace leaves the same library\'s other workspaces reachable', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'shared', pathPrefixes: ['/w/a', '/w/b'] }],
      workspaces: [{ path: '/w/a', fallback: false }],
    })
    expect(resolver.resolve('/w/a').personal).toEqual({ read: false, write: false })
    expect(resolver.resolve('/w/b').personal).toEqual({ read: true, write: true })
    // A name-only lookup has no workspace, so it stays entry-level.
    expect(resolver.accessFor('shared').write).toContain('personal')
  })

  it('personal as current scope reports its fallback decision but is always reachable', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'personal', pathPrefixes: ['/w/p'], fallback: false }],
    })
    const route = resolver.resolve('/w/p')
    expect(route).toMatchObject({ scope: 'personal', fallback: false, personal: { read: true, write: true } })
  })

  it('reports how the route was claimed', () => {
    const resolver = resolverFor({
      scopes: [{ name: 'a', pathPrefixes: ['/w'] }, { name: 'r', remotePatterns: ['org/claimed'] }],
    }, { gitRemote: cwd => (cwd === '/x/claimed' ? 'git@github.com:org/claimed.git' : undefined) })
    expect(resolver.resolve('/w/p').claim).toEqual({ kind: 'path', prefix: '/w' })
    expect(resolver.resolve('/x/claimed').claim).toEqual({ kind: 'remote' })
    expect(resolver.resolve('/x/loose').claim).toEqual({ kind: 'none' })
  })
})
