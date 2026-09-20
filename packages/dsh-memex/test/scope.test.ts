import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScopeResolver, deriveScopeFromLocalPath, deriveScopeFromRemote, hostOfRemote, pathSegmentMatches } from '../src/scope/resolver.js'

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

  it('derives a local library for directories that belong to no repository', () => {
    const homeDir = tempHome()
    const resolver = createScopeResolver({ homeDir, gitRemote: () => undefined, gitRoot: () => undefined })
    const route = resolver.resolve('/tmp/not-a-repo')
    expect(route).toMatchObject({ scope: 'tmp-not-a-repo', source: 'local', home: join(homeDir, '.dsh-memex', 'tmp-not-a-repo'), created: false })
    expect(resolver.ensure(route)).toMatchObject({ scope: 'tmp-not-a-repo', created: true })
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

  it('reports memory as on by default and off only when the entry says so', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      gitRemote: () => 'git@code.byted.org:apaas/nexus.git',
      config: { scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], publish: 'internal' }] },
    })
    expect(resolver.resolve('/work/nexus/src').memory).toBe(true)
    // An undeclared directory derives its own scope, which is on as well.
    expect(resolver.resolve('/work/unowned').memory).toBe(true)

    const off = createScopeResolver({
      homeDir: tempHome(),
      gitRemote: () => undefined,
      config: { scopes: [{ name: 'work-thing', pathPrefixes: ['/work/thing'], memory: false }] },
    })
    const route = off.resolve('/work/thing/src')
    expect(route).toMatchObject({ scope: 'work-thing', memory: false })
    // Switching memory off is not a reachability change: the route still resolves
    // and still carries its fallback grant.
    expect(route.access.write).toEqual(['work-thing', 'personal'])
  })

  // The fallback is a default grant in both directions: a new workspace has to be
  // usable without any configuration at all.
  it('grants the fallback library on an unconfigured scope', () => {
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: () => undefined })
    expect(resolver.accessFor('apaas-nexus')).toEqual({ current: 'apaas-nexus', read: ['apaas-nexus', 'personal'], write: ['apaas-nexus', 'personal'] })
  })

  it('keeps the fallback when a binding exists, because bindings only add', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { bindings: [{ name: 'project', read: ['apaas-nexus'], write: ['apaas-nexus'] }] },
      gitRemote: () => undefined,
    })
    expect(resolver.accessFor('apaas-nexus')).toEqual({ current: 'apaas-nexus', read: ['apaas-nexus', 'personal'], write: ['apaas-nexus', 'personal'] })
  })

  it('removes the fallback from both directions when the entry turns it off', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      gitRemote: () => undefined,
      config: { scopes: [{ name: 'apaas-nexus', fallback: false }] },
    })
    expect(resolver.accessFor('apaas-nexus')).toEqual({ current: 'apaas-nexus', read: ['apaas-nexus'], write: ['apaas-nexus'] })
  })

  it('lets an explicit binding listing outrank a turned-off fallback', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      gitRemote: () => undefined,
      config: {
        scopes: [{ name: 'apaas-nexus', fallback: false }],
        bindings: [{ name: 'project', read: ['apaas-nexus', 'personal'], write: ['apaas-nexus'] }],
      },
    })
    expect(resolver.accessFor('apaas-nexus')).toEqual({ current: 'apaas-nexus', read: ['apaas-nexus', 'personal'], write: ['apaas-nexus'] })
  })
})

describe('local scope derivation', () => {
  it('takes the last two path segments, like the remote rule', () => {
    expect(deriveScopeFromLocalPath('/Users/me/Documents/learning')).toBe('documents-learning')
    expect(deriveScopeFromLocalPath('/Users/me/work/learning')).toBe('work-learning')
    expect(deriveScopeFromLocalPath('/Users/me/assistant')).toBe('me-assistant')
  })

  it('degrades to one fixed library name when the path yields no usable name', () => {
    expect(deriveScopeFromLocalPath('/')).toBe('local')
    expect(deriveScopeFromLocalPath('/tmp/中文目录')).toBe('local')
  })

  it('gives sibling-named directories different libraries', () => {
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: () => undefined, gitRoot: () => undefined })
    expect(resolver.resolve('/Users/me/work/learning').scope).toBe('work-learning')
    expect(resolver.resolve('/Users/me/Documents/learning').scope).toBe('documents-learning')
  })

  it('rejects two local paths that normalize to one scope', () => {
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: () => undefined, gitRoot: () => undefined })
    resolver.resolve('/a/Documents/learning')
    expect(() => resolver.resolve('/b/Documents/learning')).toThrow(/derive the same scope/)
  })

  it('rejects a remote and a local path that derive one scope', () => {
    const remotes = new Map([['/repo', 'git@host:documents/learning.git']])
    const resolver = createScopeResolver({ homeDir: tempHome(), gitRemote: cwd => remotes.get(cwd), gitRoot: () => undefined })
    expect(resolver.resolve('/repo').scope).toBe('documents-learning')
    expect(() => resolver.resolve('/x/Documents/learning')).toThrow(/derive the same scope/)
  })

  it('lets a declared scope govern a locally derived name', () => {
    const homeDir = tempHome()
    const resolver = createScopeResolver({
      homeDir,
      config: { scopes: [{ name: 'documents-learning', pathPrefixes: ['/elsewhere'], publish: 'internal', home: '/srv/lib' }] },
      gitRemote: () => undefined,
      gitRoot: () => undefined,
    })
    expect(resolver.resolve('/Users/me/Documents/learning')).toMatchObject({ scope: 'documents-learning', source: 'local', publish: 'internal', home: '/srv/lib' })
  })

  it('refuses a remote claimed by two scopes with no primary, instead of taking the first', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [
        { name: 'first', remotePatterns: ['code\\.byted\\.org'] },
        { name: 'second', remotePatterns: ['apaas/nexus'] },
      ] },
      gitRemote: () => 'git@code.byted.org:apaas/nexus.git',
      gitRoot: () => '/work/nexus',
    })
    expect(() => resolver.resolve('/work/nexus')).toThrow(/is claimed by first, second but has 0 primary entries/)
  })

  it('routes a two-entry workspace to its primary and lists the other as reachable', () => {
    const resolver = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [
        { name: 'proj-internal', primary: true, remotePatterns: ['apaas/nexus'], publish: 'internal' },
        { name: 'proj-public', remotePatterns: ['apaas/nexus'], publish: 'external' },
      ] },
      gitRemote: () => 'git@code.byted.org:apaas/nexus.git',
      gitRoot: () => '/work/nexus',
    })
    const route = resolver.resolve('/work/nexus')
    expect(route).toMatchObject({ scope: 'proj-internal', publish: 'internal' })
    expect(route.entries).toEqual(['proj-internal', 'proj-public'])
    expect(route.access.write).toEqual(['proj-internal', 'proj-public', 'personal'])
    // A path route carries the same relation.
    const byPath = createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [
        { name: 'proj-internal', primary: true, pathPrefixes: ['/work/proj'], publish: 'internal' },
        { name: 'proj-public', pathPrefixes: ['/work/proj'], publish: 'external' },
      ] },
      gitRemote: () => undefined,
      gitRoot: () => undefined,
    })
    const pathRoute = byPath.resolve('/work/proj/src')
    expect(pathRoute.scope).toBe('proj-internal')
    expect(pathRoute.entries).toEqual(['proj-internal', 'proj-public'])
    expect(byPath.resolveByName('proj-public').entries).toEqual(['proj-public', 'proj-internal'])
  })

  it('refuses a path prefix shared by two scopes without a unique primary', () => {
    const resolver = (extra: Record<string, boolean>) => createScopeResolver({
      homeDir: tempHome(),
      config: { scopes: [
        { name: 'one', pathPrefixes: ['/work/proj'], ...extra },
        { name: 'two', pathPrefixes: ['/work/proj'] },
      ] },
      gitRemote: () => undefined,
      gitRoot: () => undefined,
    })
    expect(() => resolver({}).resolve('/work/proj')).toThrow(/is claimed by one, two but has 0 primary entries/)
    expect(() => resolver({ primary: true }).resolve('/work/proj')).not.toThrow()
    expect(resolver({ primary: true }).resolve('/work/proj').scope).toBe('one')
  })

  it('labels every route with how it was produced', () => {
    const homeDir = tempHome()
    const namespace = join(homeDir, '.dsh-memex')
    mkdirSync(join(namespace, 'stray', 'cards'), { recursive: true })
    const resolver = createScopeResolver({
      homeDir,
      config: { scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] },
      gitRemote: cwd => (cwd === '/work/repo' ? 'git@github.com:org/repo.git' : undefined),
      gitRoot: () => undefined,
    })
    expect(resolver.resolve('/work/nexus/src').source).toBe('config')
    expect(resolver.resolve('/work/repo').source).toBe('derived')
    expect(resolver.resolve('/tmp/loose').source).toBe('local')
    expect(resolver.list().find(scope => scope.scope === 'stray')?.source).toBe('discovered')
    expect(resolver.list().find(scope => scope.scope === 'personal')?.source).toBe('implicit')
  })

  it('keeps personal resolvable without making it the fallback', () => {
    const homeDir = tempHome()
    const resolver = createScopeResolver({ homeDir, gitRemote: () => undefined, gitRoot: () => undefined })
    expect(resolver.resolveByName('personal')).toMatchObject({ home: join(homeDir, '.dsh-memex', 'personal') })
    expect(resolver.resolve('/tmp/loose').scope).not.toBe('personal')
  })
})
