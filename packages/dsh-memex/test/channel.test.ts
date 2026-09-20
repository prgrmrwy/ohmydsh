import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MEMEX_CHANNEL,
  MEMEX_REMOTE_ENDPOINT,
  MEMEX_RESOLVE_ENDPOINT,
  MEMEX_STORES_ENDPOINT,
  MEMEX_WORKSPACES_ENDPOINT,
  type MemexRemoteResult,
  type MemexResolveResult,
  type MemexStoresResult,
  type MemexWorkspacesResult,
} from '../src/contract.js'
import { registerMemexChannel, type MemexChannelOptions } from '../src/host/channel.js'
import { createScopeResolver } from '../src/scope/resolver.js'
import type { KernelResult, KernelRunOptions } from '../src/run/types.js'

type Handler = (endpoint: string, params?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>

interface Harness {
  readonly namespaceDir: string
  readonly calls: Array<{ args: readonly string[]; home: string }>
  call(endpoint: string, params?: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
  stores(): Promise<MemexStoresResult>
  workspaces(): Promise<MemexWorkspacesResult>
}

function harness(options: {
  failHomes?: readonly string[]
  scopes?: MemexChannelOptions['scopes']
  workspaces?: ReadonlyArray<{ id: string; title: string; path: string }> | 'unavailable' | 'throws'
} = {}): Harness {
  const namespaceDir = mkdtempSync(join(tmpdir(), 'dsh-memex-channel-'))
  const calls: Array<{ args: readonly string[]; home: string }> = []
  let handler: Handler | undefined

  const runner = async (args: readonly string[], runOptions: KernelRunOptions): Promise<KernelResult> => {
    calls.push({ args, home: runOptions.home })
    if (options.failHomes?.some(name => runOptions.home.endsWith(name)) === true) throw new Error('kernel unavailable')
    const configured = runOptions.home.endsWith('nexus')
    const stdout = configured
      ? ['remote: git@code.byted.org:apaas/memex-nexus.git', 'adapter: git', 'auto: on', 'last sync: 2026-09-19T18:07:37.638Z', ''].join('\n')
      : 'Sync not configured. Run `memex sync --init`.\n'
    return { ok: true, exitCode: 0, stdout, stderr: '' }
  }

  const resolver = createScopeResolver({
    namespaceDir,
    config: { scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], publish: 'internal' }] },
    gitRemote: () => undefined,
    gitRoot: () => undefined,
  })
  const scopes = options.scopes ?? {
    resolve: (cwd: string) => resolver.resolve(cwd),
    list: () => resolver.list(),
    resolveByName: (scope: string) => resolver.resolveByName(scope),
    bindingFor: (scope: string) => resolver.bindingFor(scope),
    accessFor: (scope: string) => resolver.accessFor(scope),
  }

  const ctx = {
    // The workspace registry is an optional peer, read through ctx.get.
    get(name: string) {
      if (name !== 'workspaceRegistry' || options.workspaces === 'unavailable') return undefined
      if (options.workspaces === 'throws') return { list: () => { throw new Error('registry offline') } }
      if (options.workspaces === undefined) return undefined
      return { list: () => options.workspaces }
    },
    inject(_services: string[], callback: (child: unknown) => void) {
      const child = {
        get: () => ({
          rpc: {
            handle(channel: string, next: Handler) {
              expect(channel).toBe(MEMEX_CHANNEL)
              handler = next
              return () => undefined
            },
          },
        }),
        effect: (callback2: () => () => void) => callback2(),
      }
      callback(child)
    },
  }
  registerMemexChannel(ctx as never, {
    scopes,
    config: () => ({ autoDerive: true, scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], publish: 'internal' }], bindings: [] }),
    runner,
    installedVersion: () => '0.4.1',
    namespaceDir,
    homeDir: '/home/u',
  })

  const call = async (endpoint: string, params?: unknown) => {
    if (handler === undefined) throw new Error('channel was not registered')
    return await handler(endpoint, params)
  }
  return {
    namespaceDir,
    calls,
    call,
    stores: async () => (await call(MEMEX_STORES_ENDPOINT)).value as MemexStoresResult,
    workspaces: async () => (await call(MEMEX_WORKSPACES_ENDPOINT)).value as MemexWorkspacesResult,
  }
}

describe('memex settings channel', () => {
  it('reports every library with its source, declaration state and sampled sync', async () => {
    const h = harness()
    mkdirSync(join(h.namespaceDir, 'nexus', 'cards'), { recursive: true })
    mkdirSync(join(h.namespaceDir, 'stray', 'cards'), { recursive: true })
    writeFileSync(join(h.namespaceDir, 'nexus', 'cards', 'one.md'), '# one\n')
    writeFileSync(join(h.namespaceDir, 'nexus', 'cards', 'nested.md'), '# nested\n')
    mkdirSync(join(h.namespaceDir, 'nexus', 'cards', 'deep'))
    writeFileSync(join(h.namespaceDir, 'nexus', 'cards', 'deep', 'two.md'), '# two\n')

    const result = await h.stores()
    const nexus = result.stores.find(store => store.scope === 'nexus')!
    expect(nexus).toMatchObject({ declared: true, primary: false, source: 'config', exists: true, cards: 3, homeSource: 'namespace', publish: 'internal', memory: true })
    expect(nexus.sync).toMatchObject({ known: true, configured: true, remote: 'git@code.byted.org:apaas/memex-nexus.git', auto: true })

    const stray = result.stores.find(store => store.scope === 'stray')!
    expect(stray).toMatchObject({ declared: false, source: 'discovered', publishKnown: false })
    expect(stray.sync).toMatchObject({ known: true, configured: false })
    expect(result.kernel).toMatchObject({ expected: '0.4.1', version: '0.4.1', matches: true })
    expect(result.namespaceDir).toBe(h.namespaceDir)
  })

  it('isolates one library sampling failure from the rest', async () => {
    const failing = harness({ failHomes: ['broken'] })
    mkdirSync(join(failing.namespaceDir, 'nexus', 'cards'), { recursive: true })
    mkdirSync(join(failing.namespaceDir, 'broken', 'cards'), { recursive: true })
    const result = await failing.stores()
    expect(result.stores.find(store => store.scope === 'broken')?.sync).toEqual({ known: false, degraded: 'unavailable' })
    expect(result.stores.find(store => store.scope === 'nexus')?.sync).toMatchObject({ known: true, configured: true })
  })

  it('answers the workspace registry with the route each directory takes', async () => {
    const h = harness({
      workspaces: [
        { id: 'w1', title: 'nexus', path: '/work/nexus' },
        { id: 'w2', title: 'learning', path: '/home/u/Documents/learning' },
      ],
    })
    const result = await h.workspaces()
    expect(result.known).toBe(true)
    // Configured `~/…` prefixes are compared against absolute registry paths, so
    // the browser is told which home to expand with.
    expect(result.homeDir).toBe('/home/u')
    expect(result.items.map(item => [item.title, item.route?.scope, item.route?.memory])).toEqual([
      ['nexus', 'nexus', true],
      ['learning', 'documents-learning', true],
    ])
  })

  it('distinguishes "no workspace registry" from "no workspaces"', async () => {
    // An empty list would tell the user they have none; the page has to know the
    // difference to degrade instead of lying.
    for (const mode of ['unavailable', 'throws'] as const) {
      const h = harness({ workspaces: mode })
      expect(await h.workspaces()).toEqual({ known: false, homeDir: '/home/u', items: [] })
    }
  })

  it('answers resolve for a directory that does not exist and creates nothing', async () => {
    const h = harness()
    const target = join(h.namespaceDir, '..', 'never-created', 'notes')
    const result = (await h.call(MEMEX_RESOLVE_ENDPOINT, { path: target })).value as MemexResolveResult
    expect(result).toMatchObject({ scope: 'never-created-notes', source: 'local', local: true, exists: false })
    expect(existsSync(join(h.namespaceDir, 'never-created-notes'))).toBe(false)
    expect(existsSync(target)).toBe(false)
  })

  it('reports ambiguous configuration instead of guessing a scope', async () => {
    const namespaceDir = mkdtempSync(join(tmpdir(), 'dsh-memex-channel-'))
    const resolver = createScopeResolver({
      namespaceDir,
      config: { scopes: [
        { name: 'one', remotePatterns: ['code\\.byted\\.org'] },
        { name: 'two', remotePatterns: ['apaas/nexus'] },
      ] },
      gitRemote: () => 'git@code.byted.org:apaas/nexus.git',
      gitRoot: () => undefined,
    })
    const h = harness({
      scopes: {
        resolve: (cwd: string) => resolver.resolve(cwd),
        list: () => resolver.list(),
        resolveByName: (scope: string) => resolver.resolveByName(scope),
        bindingFor: (scope: string) => resolver.bindingFor(scope),
        accessFor: (scope: string) => resolver.accessFor(scope),
      },
    })
    const response = await h.call(MEMEX_RESOLVE_ENDPOINT, { path: '/work/nexus' })
    expect(response.ok).toBe(false)
    expect(response.error?.message).toMatch(/is claimed by one, two but has 0 primary entries/)
  })

  it('maps every remote action onto the kernel command line', async () => {
    const h = harness()
    mkdirSync(join(h.namespaceDir, 'nexus', 'cards'), { recursive: true })
    for (const [action, expected] of [
      ['sync', ['sync']],
      ['push', ['sync', 'push']],
      ['pull', ['sync', 'pull']],
      ['auto-on', ['sync', 'on']],
      ['auto-off', ['sync', 'off']],
    ] as const) {
      h.calls.length = 0
      const result = (await h.call(MEMEX_REMOTE_ENDPOINT, { scope: 'nexus', action })).value as MemexRemoteResult
      expect(result.status).toBe('ok')
      expect(h.calls).toEqual([{ args: expected, home: join(h.namespaceDir, 'nexus') }])
    }
    h.calls.length = 0
    await h.call(MEMEX_REMOTE_ENDPOINT, { scope: 'nexus', action: 'init', url: 'git@code.byted.org:apaas/other.git' })
    expect(h.calls).toEqual([{ args: ['sync', '--init', 'git@code.byted.org:apaas/other.git'], home: join(h.namespaceDir, 'nexus') }])
  })

  it('refuses an init without a URL and an unknown action', async () => {
    const h = harness()
    expect((await h.call(MEMEX_REMOTE_ENDPOINT, { scope: 'nexus', action: 'init' })).error?.message).toMatch(/requires the remote URL/)
    expect((await h.call(MEMEX_REMOTE_ENDPOINT, { scope: 'nexus', action: 'recreate' })).error?.message).toMatch(/unknown remote action/)
    expect((await h.call(MEMEX_REMOTE_ENDPOINT, { scope: 'nope', action: 'sync' })).error?.message).toMatch(/Unknown scope/)
    expect(h.calls).toEqual([])
  })

  it('reports a failed action as an outcome, not a transport error', async () => {
    const namespaceDir = mkdtempSync(join(tmpdir(), 'dsh-memex-channel-'))
    const resolver = createScopeResolver({ namespaceDir, config: { scopes: [{ name: 'nexus' }] }, gitRemote: () => undefined, gitRoot: () => undefined })
    const h = harness({
      scopes: {
        resolve: (cwd: string) => resolver.resolve(cwd),
        list: () => resolver.list(),
        resolveByName: (scope: string) => resolver.resolveByName(scope),
        bindingFor: (scope: string) => resolver.bindingFor(scope),
        accessFor: (scope: string) => resolver.accessFor(scope),
      },
    })
    const runner = async (): Promise<KernelResult> => ({ ok: false, exitCode: 1, stdout: '', stderr: 'Merge conflict during init.' })
    const ctx = {
      inject(_services: string[], callback: (child: unknown) => void) {
        callback({ get: () => ({ rpc: { handle: (_c: string, next: Handler) => { handler = next; return () => undefined } } }), effect: (cb: () => () => void) => cb() })
      },
    }
    let handler: Handler | undefined
    registerMemexChannel(ctx as never, {
      scopes: {
        resolve: (cwd: string) => resolver.resolve(cwd),
        list: () => resolver.list(),
        resolveByName: (scope: string) => resolver.resolveByName(scope),
        bindingFor: (scope: string) => resolver.bindingFor(scope),
        accessFor: (scope: string) => resolver.accessFor(scope),
      },
      config: () => ({ autoDerive: true, scopes: [{ name: 'nexus' }], bindings: [] }),
      runner: runner as never,
      installedVersion: () => undefined,
      namespaceDir,
    })
    const response = await handler!(MEMEX_REMOTE_ENDPOINT, { scope: 'nexus', action: 'push' })
    expect(response.ok).toBe(true)
    expect(response.value).toMatchObject({ status: 'failed', message: 'Merge conflict during init.' })
    expect(h.calls).toEqual([])
  })
})
