import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScopeResolver, deriveScopeFromRemote, hostOfRemote, pathSegmentMatches } from '../src/scope/resolver.js'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-memex-scope-'))
}

describe('scope resolver', () => {
  it('derives org and repository from scp remotes', () => {
    expect(deriveScopeFromRemote('git@code.byted.org:apaas/nexus.git')).toBe('apaas-nexus')
    expect(deriveScopeFromRemote('git@github.com:prgrmrwy/dsh-cockpit.git')).toBe('prgrmrwy-dsh-cockpit')
  })

  it('normalizes URL remotes without retaining SSH userinfo', () => {
    expect(hostOfRemote('ssh://git@code.byted.org/apaas/nexus.git')).toBe('code.byted.org')
    expect(deriveScopeFromRemote('ssh://git@code.byted.org/apaas/nexus.git')).toBe('apaas-nexus')
  })

  it('matches path segments rather than string prefixes', () => {
    expect(pathSegmentMatches('/work/nexus/src', '/work/nexus')).toBe(true)
    expect(pathSegmentMatches('/work/nexus-ops', '/work/nexus')).toBe(false)
  })

  it('falls back to personal for non-git directories', () => {
    const homeDir = tempHome()
    const resolver = createScopeResolver({ homeDir, gitRemote: () => undefined })
    const route = resolver.resolve('/tmp/not-a-repo')
    expect(route).toMatchObject({ scope: 'personal', source: 'fallback', home: join(homeDir, '.dsh-memex', 'personal'), created: false })
    expect(resolver.ensure(route)).toMatchObject({ scope: 'personal', created: true })
  })

  it('derives a dedicated scope for GitHub repositories', () => {
    const homeDir = tempHome()
    const resolver = createScopeResolver({ homeDir, gitRemote: () => 'git@github.com:prgrmrwy/ohmydsh.git' })
    expect(resolver.resolve('/work/ohmydsh')).toMatchObject({ scope: 'prgrmrwy-ohmydsh', source: 'derived', home: join(homeDir, '.dsh-memex', 'prgrmrwy-ohmydsh') })
  })

  it('rejects different remotes that normalize to one scope', () => {
    const remotes = new Map([['/a', 'git@host:org/my_repo.git'], ['/b', 'git@host:org/my-repo.git']])
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: cwd => remotes.get(cwd) })
    resolver.resolve('/a')
    expect(() => resolver.resolve('/b')).toThrow(/derive the same scope/)
  })

  it('uses the longest matching path rather than the entry with most prefixes', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [
        { name: 'broad', pathPrefixes: ['/work', '/other'] },
        { name: 'specific', pathPrefixes: ['/work/repo'] },
      ] },
      gitRemote: () => undefined,
    })
    expect(resolver.resolve('/work/repo/src').scope).toBe('specific')
  })

  it('keeps list and resolve pure until ensure is called', () => {
    const homeDir = tempHome()
    const resolver = createScopeResolver({ homeDir, config: { scopes: [{ name: 'configured' }] }, gitRemote: () => undefined })
    resolver.resolve('/tmp/not-a-repo')
    resolver.list()
    expect(existsSync(join(homeDir, '.dsh-memex'))).toBe(false)
    resolver.ensure(resolver.resolveByName('configured'))
    expect(existsSync(join(homeDir, '.dsh-memex', 'configured', 'cards'))).toBe(true)
  })

  it('rejects a symlinked scope home before creating cards', () => {
    const homeDir = tempHome()
    const namespace = join(homeDir, '.dsh-memex')
    const outside = join(homeDir, 'outside')
    mkdirSync(namespace)
    mkdirSync(outside)
    symlinkSync(outside, join(namespace, 'unsafe'))
    const resolver = createScopeResolver({ homeDir, config: { scopes: [{ name: 'unsafe' }] }, gitRemote: () => undefined })
    expect(() => resolver.ensure(resolver.resolveByName('unsafe'))).toThrow(/symlink/)
  })

  it('uses configured paths before remote derivation', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], publish: 'internal' }] },
      gitRemote: () => 'git@code.byted.org:other/repo.git',
    })
    expect(resolver.resolve('/work/nexus/src')).toMatchObject({ scope: 'nexus', source: 'config', publish: 'internal' })
  })

  it('records git root and internal publication for configured remote matches', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [{ name: 'nexus', remotePatterns: ['code\\.byted\\.org'], publish: 'internal' }] },
      gitRemote: () => 'ssh://git@code.byted.org/apaas/nexus.git',
      gitRoot: () => '/work/nexus',
    })
    expect(resolver.resolve('/external/worktree')).toMatchObject({ scope: 'nexus', publish: 'internal', workspacePaths: ['/work/nexus'] })
  })

  it('applies degraded access when no binding exists', () => {
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: () => undefined })
    expect(resolver.accessFor('apaas-nexus')).toEqual({ current: 'apaas-nexus', read: ['apaas-nexus'], write: ['apaas-nexus', 'personal'] })
  })

  it('adds personal to configured readable scopes', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { bindings: [{ name: 'project', read: ['apaas-nexus'], write: ['apaas-nexus'] }] },
      gitRemote: () => undefined,
    })
    expect(resolver.accessFor('apaas-nexus')).toEqual({ current: 'apaas-nexus', read: ['apaas-nexus', 'personal'], write: ['apaas-nexus'] })
  })
})
