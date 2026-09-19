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
    expect(deriveScopeFromRemote('git@git.corp.example:team/acme.git')).toBe('team-acme')
    expect(deriveScopeFromRemote('git@github.com:prgrmrwy/dsh-cockpit.git')).toBe('prgrmrwy-dsh-cockpit')
  })

  it('normalizes URL remotes without retaining SSH userinfo', () => {
    expect(hostOfRemote('ssh://git@git.corp.example/team/acme.git')).toBe('git.corp.example')
    expect(deriveScopeFromRemote('ssh://git@git.corp.example/team/acme.git')).toBe('team-acme')
  })

  it('matches path segments rather than string prefixes', () => {
    expect(pathSegmentMatches('/work/acme/src', '/work/acme')).toBe(true)
    expect(pathSegmentMatches('/work/acme-ops', '/work/acme')).toBe(false)
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

  it('honours a configured library home inside its own repository', () => {
    const homeDir = tempHome()
    const repo = mkdtempSync(join(tmpdir(), 'dsh-memex-repo-'))
    const resolver = createScopeResolver({
      homeDir,
      config: { scopes: [{ name: 'proj', pathPrefixes: [repo], publish: 'internal', home: join(repo, 'docs', 'memex') }] },
      gitRemote: () => undefined,
    })
    const route = resolver.resolve(join(repo, 'src'))
    expect(route.home).toBe(join(repo, 'docs', 'memex'))
    expect(route.homeSource).toBe('configured')
    expect(resolver.ensure(route)).toMatchObject({ created: true })
    expect(existsSync(join(repo, 'docs', 'memex', 'cards'))).toBe(true)
    expect(existsSync(join(homeDir, '.dsh-memex'))).toBe(false)
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
      config: { scopes: [{ name: 'acme', pathPrefixes: ['/work/acme'], publish: 'internal' }] },
      gitRemote: () => 'git@git.corp.example:other/repo.git',
    })
    expect(resolver.resolve('/work/acme/src')).toMatchObject({ scope: 'acme', source: 'config', publish: 'internal' })
  })

  it('records git root and internal publication for configured remote matches', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [{ name: 'acme', remotePatterns: ['git\\.corp\\.example'], publish: 'internal' }] },
      gitRemote: () => 'ssh://git@git.corp.example/team/acme.git',
      gitRoot: () => '/work/acme',
    })
    expect(resolver.resolve('/external/worktree')).toMatchObject({ scope: 'acme', publish: 'internal', workspacePaths: ['/work/acme'] })
  })

  it('applies degraded access when no binding exists', () => {
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: () => undefined })
    expect(resolver.accessFor('team-acme')).toEqual({ current: 'team-acme', read: ['team-acme'], write: ['team-acme', 'personal'] })
  })

  it('adds personal to configured readable scopes', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { bindings: [{ name: 'project', read: ['team-acme'], write: ['team-acme'] }] },
      gitRemote: () => undefined,
    })
    expect(resolver.accessFor('team-acme')).toEqual({ current: 'team-acme', read: ['team-acme', 'personal'], write: ['team-acme'] })
  })
})
