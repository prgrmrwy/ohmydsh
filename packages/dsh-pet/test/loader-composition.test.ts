/**
 * Loader composition: the REAL plugin entry, not a hand-assembled subset.
 *
 * Every other suite exercises Pet's parts. This one loads `src/index.ts`
 * itself through cordis the way the DSH loader does, so a broken `apply`,
 * a missing inject key, an unhandled initialization rejection or a bad
 * bundle patch is caught here rather than at `dsh web` startup.
 *
 * It also proves the containment contract that keeps the rest of DSH alive:
 * `apply` must be registration-only and must never reject, even when Pet's
 * own dependencies are unusable.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import * as petPlugin from '../src/index.js'
import { PET_DOMAIN_NAME } from '../src/host/spec.js'
import { ROUTES } from '../src/wire.js'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * Minimal stand-ins for the DSH services Pet injects.
 *
 * Provided on the given context before Pet loads; cordis gates `apply` until
 * every declared inject resolves, so a missing stub reproduces the exact
 * startup stall a real Host would hit.
 */
function stubServices(ctx: Context, registered: { path: string }[]): void {
  ctx.provide('webServer', {
    register: (route: { path: string }) => {
      registered.push(route)
      return () => {}
    },
  })
  ctx.provide('workspaceRegistry', {
    create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
    list: () => [],
    archivedSessionIds: [],
  })
  ctx.provide('sessions', { list: () => [], get: () => undefined })
  ctx.provide('agents', { create: async () => ({ session: { id: 'x' } }), get: () => undefined, list: () => [] })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
  })
  ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
  ctx.provide('sessionTitle', { rename: () => ({}) })
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('skills', { register: () => () => {} })
}

/** Compose Pet exactly as the profile patch does, over an isolated home. */
async function composeHost(options: { withSqlite?: boolean; settleMs?: number } = {}): Promise<{
  ctx: Context
  home: string
  routes: { path: string }[]
}> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
  const routes: { path: string }[] = []
  const ctx = new Context()
  await ctx.plugin(Storage)
  stubServices(ctx, routes)

  // The profile's default JSON-equivalent backend.
  await ctx.plugin({
    name: 'default-backend',
    inject: ['storage'],
    async apply(outer: Context) {
      await outer.plugin(
        {
          name: 'default-backend-inner',
          inject: ['storage'],
          apply(inner: Context, config: StorageSqlite.Config) {
            const backend = new StorageSqlite.SqliteStorageBackend(config)
            inner.effect(() => inner.storage.backend.register('json', backend))
            inner.provide(storageBackendServiceKey('json'), backend)
          },
          Config: StorageSqlite.Config,
        },
        { path: ':memory:' },
      )
    },
  })

  if (options.withSqlite !== false) {
    await ctx.plugin(StorageSqlite, {
      path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'),
    })
  }
  await ctx.plugin(StorageDomain, {
    backend: 'json',
    routes: { [PET_DOMAIN_NAME]: 'sqlite' },
  })

  await ctx.plugin(petPlugin, { home, version: '0.1.0' })
  // Pet's initialization is contained and asynchronous, so poll for the
  // observable end state instead of guessing a fixed delay.
  const deadline = Date.now() + (options.settleMs ?? 15_000)
  while (Date.now() < deadline) {
    if (routes.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return { ctx, home, routes }
}

describe('plugin entry shape', () => {
  it('exports the loader contract', () => {
    expect(petPlugin.name).toBe('dsh-pet')
    expect(typeof petPlugin.apply).toBe('function')
    expect(Array.isArray(petPlugin.inject)).toBe(true)
  })

  it('injects exactly the services the bundle patch declares', async () => {
    const patch = await readFile(path.join(packageRoot, 'cordis.patch.yml'), 'utf8')
    const block = patch.slice(patch.lastIndexOf('- id: dsh-pet'))
    const declared = [...block.matchAll(/^\s+- (\w+)$/gm)].map(match => match[1])

    // A mismatch means the loader would resolve a different service set than
    // the code expects, which only surfaces at real startup.
    expect([...declared].sort()).toEqual([...petPlugin.inject].sort())
  })

  it('routes the bundle patch to the exact domain name the spec declares', async () => {
    const patch = await readFile(path.join(packageRoot, 'cordis.patch.yml'), 'utf8')

    expect(patch).toContain(`${PET_DOMAIN_NAME}: sqlite`)
    // Guards the hyphen/underscore trap: DSH's UNIT_NAME_RE forbids hyphens.
    expect(PET_DOMAIN_NAME).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(patch).not.toMatch(/^\s+dsh-pet: sqlite$/m)
  })
})


/**
 * Register and enable a Skill through the real routes.
 *
 * There are no built-ins, so a test that invokes a capability must add its
 * Skill first — exactly as a user would.
 */
async function registerSkill(
  routes: { path: string; handler: (req: never, res: never) => Promise<void> | void }[],
  skillName: string,
): Promise<void> {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-skill-'))
  await writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${skillName}\npetContext: session-required\n---\nBody\n`,
  )
  await callRoute(routes.find(route => route.path === ROUTES.skillImport)!, { path: dir })
  await callRoute(routes.find(route => route.path === ROUTES.skillMutate)!, {
    skillName,
    action: 'enable',
  })
}

describe('Host service loads through the loader', () => {
  it('reaches ready and registers its exact routes', async () => {
    const { routes } = await composeHost()

    const paths = routes.map(route => route.path)
    expect(paths).toContain(ROUTES.status)
    expect(paths).toContain(ROUTES.invocationCreate)
    expect(paths).toContain(ROUTES.diagnostics)
    // Every registered path is an exact Pet route: no wildcard RPC bridge.
    for (const route of paths) expect(route.startsWith('/dsh-pet/api/')).toBe(true)
  })

  it('creates its owner-only state tree under the given DSH home', async () => {
    const { home } = await composeHost()
    const { readdir } = await import('node:fs/promises')

    const stateRoot = path.join(home, 'plugins', 'dsh-pet')
    const entries = await readdir(stateRoot)

    expect(entries).toContain('workspace')
    expect(entries).toContain('skills')
    expect(entries).toContain('state.sqlite')
  })

  it('ships no privileged built-in Skills', async () => {
    const { home } = await composeHost()
    const { readdir } = await import('node:fs/promises')

    const projection = await readdir(
      path.join(home, 'plugins', 'dsh-pet', 'workspace', '.dsh', 'skills'),
    ).catch(() => [] as string[])

    // Pet has no built-in category: every Skill is added by the user, so a
    // fresh Host starts with nothing projected.
    expect(projection).toEqual([])
  })

  it('registers no route when the sqlite backend is missing, and does not throw', async () => {
    // Degradation is terminal, so a short settle window is enough; polling
    // the full timeout here would only slow the suite down.
    const { routes } = await composeHost({ withSqlite: false, settleMs: 1_500 })

    // Ownership is unprovable, so Pet degrades and exposes nothing rather
    // than writing into a foreign medium.
    expect(routes).toEqual([])
  })
})

/** Drive one Pet route through its real handler. */
async function callRoute(
  route: { handler: (req: never, res: never) => Promise<void> | void },
  body: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string; message?: string }> {
  const req = {
    method: 'POST',
    headers: { host: '127.0.0.1:3080' },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from(JSON.stringify(body)))
      if (event === 'end') cb()
    },
    destroy: () => {},
  }
  let payload: unknown
  const res = {
    writeHead() {
      return this
    },
    end(text: string) {
      payload = JSON.parse(text)
    },
  }
  await route.handler(req as never, res as never)
  return payload as { ok: boolean; data?: unknown; error?: string; message?: string }
}

describe('a real Invocation scopes its executor Agent', () => {
  it('creates the executor with the Pet allowlist composition attached', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string; handler: (req: never, res: never) => Promise<void> | void }[] = []
    const createdAgents: { sessionId: string; setup?: unknown; meta?: { cwd?: string } }[] = []

    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.provide('webServer', {
      register: (route: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
        routes.push(route)
        return () => {}
      },
    })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, events: [] } : undefined),
    })
    ctx.provide('agents', {
      create: async (options: { sessionId: string }) => {
        createdAgents.push(options)
        return { session: { id: options.sessionId } }
      },
      get: () => ({}),
      list: () => [],
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
    })
    ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
    ctx.provide('sessionTitle', { rename: () => ({}) })
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('skills', { register: () => () => {} })

    await ctx.plugin({
      name: 'default-backend',
      inject: ['storage'],
      async apply(outer: Context) {
        await outer.plugin(
          {
            name: 'default-backend-inner',
            inject: ['storage'],
            apply(inner: Context, config: StorageSqlite.Config) {
              const backend = new StorageSqlite.SqliteStorageBackend(config)
              inner.effect(() => inner.storage.backend.register('json', backend))
              inner.provide(storageBackendServiceKey('json'), backend)
            },
            Config: StorageSqlite.Config,
          },
          { path: ':memory:' },
        )
      },
    })
    await ctx.plugin(StorageSqlite, {
      path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'),
    })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')

    // A provider/model must be configured before an executor may be created.
    const configRoute = routes.find(route => route.path === ROUTES.configUpdate)
    expect(configRoute).toBeDefined()
    const configured = await callRoute(configRoute!, {
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    })
    expect(configured.ok).toBe(true)

    const createRoute = routes.find(route => route.path === ROUTES.invocationCreate)
    const accepted = await callRoute(createRoute!, {
      clientInvocationId: 'inv-1',
      capabilityId: 'clean-worktree',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    expect(accepted.ok).toBe(true)
    expect(createdAgents).toHaveLength(1)
    // The isolation boundary: without this setup the executor would inherit
    // DSH's global Skill discovery.
    expect(typeof createdAgents[0]?.setup).toBe('function')
    expect(createdAgents[0]?.meta?.cwd).toBe(path.join(home, 'plugins', 'dsh-pet', 'workspace'))
  })
})

describe('dispatch uses the ordinary Agent lifecycle', () => {
  it('submits a real UserMessage through followup and flushes at the idle boundary', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string; handler: (req: never, res: never) => Promise<void> | void }[] = []
    const followups: unknown[] = []
    let idleAwaited = 0

    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.provide('webServer', {
      register: (route: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
        routes.push(route)
        return () => {}
      },
    })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, events: [] } : undefined),
    })
    // A handle shaped like the real one: `.agent` carrying synchronous
    // `followup(UserMessage)` and an awaited `whenIdle()`.
    const agentHandle = {
      agent: {
        followup: (message: unknown) => {
          followups.push(message)
        },
        whenIdle: async () => {
          idleAwaited += 1
        },
      },
    }
    ctx.provide('agents', {
      create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
      get: () => agentHandle,
      list: () => [],
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
    })
    ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
    ctx.provide('sessionTitle', { rename: () => ({}) })
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('skills', { register: () => () => {} })

    await ctx.plugin({
      name: 'default-backend',
      inject: ['storage'],
      async apply(outer: Context) {
        await outer.plugin(
          {
            name: 'default-backend-inner',
            inject: ['storage'],
            apply(inner: Context, config: StorageSqlite.Config) {
              const backend = new StorageSqlite.SqliteStorageBackend(config)
              inner.effect(() => inner.storage.backend.register('json', backend))
              inner.provide(storageBackendServiceKey('json'), backend)
            },
            Config: StorageSqlite.Config,
          },
          { path: ':memory:' },
        )
      },
    })
    await ctx.plugin(StorageSqlite, {
      path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'),
    })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')
    await callRoute(routes.find(route => route.path === ROUTES.configUpdate)!, {
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    })
    const accepted = await callRoute(routes.find(r => r.path === ROUTES.invocationCreate)!, {
      clientInvocationId: 'inv-1',
      capabilityId: 'clean-worktree',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    expect(accepted.ok).toBe(true)
    expect(followups).toHaveLength(1)

    // A structured UserMessage, never a raw string.
    const message = followups[0] as {
      role?: string
      id?: string
      content?: { type: string; text: string }[]
      source?: { kind?: string }
    }
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.source?.kind).toBe('user')
    // The leading token is what drives the ordinary Skill pre-step.
    expect(message.content?.[0]?.text?.startsWith('/clean-worktree')).toBe(true)
    // Flushed through the ordinary idle boundary.
    expect(idleAwaited).toBe(1)
  })
})

describe('archiving from the Pet route syncs the executor session', () => {
  it('archives the executor through the real route, not just the record', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string; handler: (req: never, res: never) => Promise<void> | void }[] = []
    const archivedSessions: string[] = []

    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.provide('webServer', {
      register: (route: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
        routes.push(route)
        return () => {}
      },
    })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
      archiveSession: async (sessionId: string) => {
        archivedSessions.push(sessionId)
      },
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, events: [] } : undefined),
    })
    ctx.provide('agents', {
      create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
      get: () => ({
        agent: { followup: () => {}, whenIdle: async () => {} },
      }),
      list: () => [],
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
    })
    ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
    ctx.provide('sessionTitle', { rename: () => ({}) })
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })

    await ctx.plugin({
      name: 'default-backend',
      inject: ['storage'],
      async apply(outer: Context) {
        await outer.plugin(
          {
            name: 'default-backend-inner',
            inject: ['storage'],
            apply(inner: Context, config: StorageSqlite.Config) {
              const backend = new StorageSqlite.SqliteStorageBackend(config)
              inner.effect(() => inner.storage.backend.register('json', backend))
              inner.provide(storageBackendServiceKey('json'), backend)
            },
            Config: StorageSqlite.Config,
          },
          { path: ':memory:' },
        )
      },
    })
    await ctx.plugin(StorageSqlite, {
      path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'),
    })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')
    await callRoute(routes.find(route => route.path === ROUTES.configUpdate)!, {
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    })
    const accepted = (await callRoute(routes.find(r => r.path === ROUTES.invocationCreate)!, {
      clientInvocationId: 'inv-1',
      capabilityId: 'clean-worktree',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })) as { ok: boolean; data?: { task?: { id: string; executorSessionId: string } } }
    expect(accepted.ok).toBe(true)
    const task = accepted.data?.task
    expect(task).toBeDefined()

    // A running Task cannot be archived: cancellation must settle first.
    const blocked = await callRoute(routes.find(r => r.path === ROUTES.taskArchive)!, {
      taskId: task!.id,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toBe('ARCHIVE_BLOCKED')
    expect(archivedSessions).toEqual([])

    await callRoute(routes.find(r => r.path === ROUTES.invocationCancel)!, { taskId: task!.id })
    const archived = await callRoute(routes.find(r => r.path === ROUTES.taskArchive)!, {
      taskId: task!.id,
    })

    expect(archived.ok).toBe(true)
    // The whole point: the executor session is archived too. Calling the
    // repository directly would leave it live and the two sides diverged.
    expect(archivedSessions).toEqual([task!.executorSessionId])
  })
})

describe('provider routability is proven before an executor is created', () => {
  it('refuses an Invocation whose configured provider is not routable', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string; handler: (req: never, res: never) => Promise<void> | void }[] = []
    const createdAgents: unknown[] = []

    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.provide('webServer', {
      register: (route: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
        routes.push(route)
        return () => {}
      },
    })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
      archiveSession: async () => {},
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, events: [] } : undefined),
    })
    // Only `anthropic` is routable in this Host.
    // The Host default names a provider this Host does not route.
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'ghost-provider', model: 'whatever' }),
    })
    ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
    ctx.provide('sessionTitle', { rename: () => ({}) })
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })
    ctx.provide('agents', {
      create: async (options: { sessionId: string }) => {
        createdAgents.push(options)
        return { session: { id: options.sessionId } }
      },
      get: () => ({ agent: { followup: () => {}, whenIdle: async () => {} } }),
      list: () => [],
    })

    await ctx.plugin({
      name: 'default-backend',
      inject: ['storage'],
      async apply(outer: Context) {
        await outer.plugin(
          {
            name: 'default-backend-inner',
            inject: ['storage'],
            apply(inner: Context, config: StorageSqlite.Config) {
              const backend = new StorageSqlite.SqliteStorageBackend(config)
              inner.effect(() => inner.storage.backend.register('json', backend))
              inner.provide(storageBackendServiceKey('json'), backend)
            },
            Config: StorageSqlite.Config,
          },
          { path: ':memory:' },
        )
      },
    })
    await ctx.plugin(StorageSqlite, {
      path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'),
    })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')

    // No Pet-side model config to set: Pet follows the Host default above.
    const refused = await callRoute(routes.find(r => r.path === ROUTES.invocationCreate)!, {
      clientInvocationId: 'inv-1',
      capabilityId: 'clean-worktree',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    expect(refused.ok).toBe(false)
    expect(refused.error).toBe('MODEL_UNAVAILABLE')
    expect(refused.message).toContain('not routable')
    // Never silently fall back to a different provider.
    expect(createdAgents).toEqual([])
  })
})

describe('the bundle patch composes into a real DSH profile', () => {
  it('uses the top-level patch-row form, not a `patch:` wrapper', async () => {
    const patch = await readFile(path.join(packageRoot, 'cordis.patch.yml'), 'utf8')

    // A `- patch:` wrapper is not a thing: composition fails with
    // "id is required for non-insert patches", which only surfaces when the
    // real profile tree is built.
    expect(patch).not.toMatch(/^- patch:/m)
    expect(patch).toMatch(/^- id: storage-domain$/m)
  })

  it('restates the profile default backend it overrides', async () => {
    const patch = await readFile(path.join(packageRoot, 'cordis.patch.yml'), 'utf8')
    const block = patch.slice(patch.indexOf('- id: storage-domain'))

    // A patch REPLACES the targeted row's whole config, so omitting
    // `backend` would drop the profile default and leave every other DSH
    // domain unrouted.
    expect(block).toMatch(/backend: json/)
    expect(block).toMatch(/dsh_pet: sqlite/)
  })

  it('declares every inject the Host entry requires', async () => {
    const patch = await readFile(path.join(packageRoot, 'cordis.patch.yml'), 'utf8')
    const block = patch.slice(patch.lastIndexOf('- id: dsh-pet'))

    for (const service of petPlugin.inject) {
      expect(block).toContain(`- ${service}`)
    }
  })
})

describe('Invocation state is projected from real session events', () => {
  it('subscribes to the session event firehose and maps turn outcomes', async () => {
    const source = await readFile(path.join(packageRoot, 'src', 'index.ts'), 'utf8')

    // Without this subscription nothing settles an Invocation: it stays
    // `running` forever even after its turn completed. Only a live Host
    // surfaced that, because unit tests call `onAgentEvent` directly.
    expect(source).toContain("ctx.on('session/event'")
    expect(source).toContain("event.type === 'turn/start'")
    expect(source).toContain("event.type !== 'turn/end'")
    // The three settled outcomes DSH reports.
    expect(source).toContain("case 'completed':")
    expect(source).toContain("case 'aborted':")
    expect(source).toContain("kind: 'turn-error'")
    // Only Pet executors are projected.
    expect(source).toContain('repository.findTaskByExecutor(executorSessionId) === undefined')
  })
})

describe('containment keeps ordinary DSH services loading', () => {
  it('never rejects apply even when Pet cannot initialize', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    stubServices(ctx, [])
    // No storageDomain at all: Pet's own dependency is unusable.
    ctx.provide('storageDomain', {
      open: async () => {
        throw new Error('domain unavailable')
      },
    })

    // The contract that protects the rest of the Host: registration-only
    // apply, contained async failure.
    await expect(ctx.plugin(petPlugin, { home: '/nonexistent/pet-home' })).resolves.toBeDefined()
    await new Promise(resolve => setTimeout(resolve, 200))

    // An unrelated plugin still loads afterwards.
    let unrelatedLoaded = false
    await ctx.plugin({
      name: 'unrelated',
      apply: () => {
        unrelatedLoaded = true
      },
    })
    expect(unrelatedLoaded).toBe(true)
  })

  it('does not emit an unhandled rejection during a failed initialization', async () => {
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      const ctx = new Context()
      await ctx.plugin(Storage)
      stubServices(ctx, [])
      ctx.provide('storageDomain', {
        open: async () => {
          throw new Error('domain unavailable')
        },
      })
      await ctx.plugin(petPlugin, { home: '/nonexistent/pet-home' })
      await new Promise(resolve => setTimeout(resolve, 300))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(onUnhandled).not.toHaveBeenCalled()
  })
})

describe('client bundle loads without Cockpit changes', () => {
  it('produces a loadable module-loader bundle', async () => {
    const bundlePath = path.join(packageRoot, 'lib', 'client.js')
    const source = await readFile(bundlePath, 'utf8').catch(() => undefined)
    if (source === undefined) {
      throw new Error('lib/client.js is missing; run `npm run build` before this suite')
    }

    // The bundle must self-register with the DSH module loader under the
    // package id the profile scanner expects.
    expect(source).toContain('window.__ModuleLoader__.load(')
    expect(source).toContain('id: "dsh-pet"')

    // Evaluate it against a stub loader to prove it is syntactically valid
    // and exports the client plugin contract.
    let captured: { id: string; factory: (req: unknown) => unknown } | undefined
    const sandboxWindow = {
      __ModuleLoader__: {
        load: (entry: { id: string; factory: (req: unknown) => unknown }) => {
          captured = entry
        },
      },
    }
    const evaluate = new Function('window', 'require', source)
    evaluate(sandboxWindow, require)

    expect(captured?.id).toBe('dsh-pet')
    const exported = captured?.factory(require) as { apply?: unknown; inject?: unknown }
    expect(typeof exported.apply).toBe('function')
    // `slots` alone is NOT loadable: `@deepseek-ai/dsh-client-ui-slots` ships
    // no client bundle, so an entry depending only on it never resolves and
    // its `apply` never runs — styles appear but no surface is ever mounted.
    // Naming the services Pet actually reads pulls in packages that do ship
    // bundles and provide the slot registry.
    expect(exported.inject).toEqual(['slots', 'sessions', 'workspaces', 'connection'])
  })

  it('declares the web client half in package metadata', async () => {
    const pkg = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { dsh?: { client?: { platform?: string } }; files?: string[] }

    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(pkg.files).toContain('skills')
  })

  it('touches no Cockpit package or source', async () => {
    const pkg = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>

    const names = [
      ...Object.keys(pkg['dependencies'] ?? {}),
      ...Object.keys(pkg['peerDependencies'] ?? {}),
      ...Object.keys(pkg['devDependencies'] ?? {}),
    ]

    expect(names.filter(name => name.includes('cockpit'))).toEqual([])
  })
})

describe('the client half declares every service it reads', () => {
  it('injects each ctx service used by the client sources', async () => {
    const entry = await readFile(
      path.join(packageRoot, 'src', 'client', 'index.tsx'),
      'utf8',
    )
    const declared = new Set(
      [...(/export const inject = \[([^\]]*)\]/.exec(entry)?.[1] ?? '').matchAll(/'([^']+)'/g)]
        .map(match => match[1]),
    )

    // Reading an undeclared service throws `cannot get property "X" without
    // inject` at runtime, which silently prevents the surface from mounting.
    const sources = ['index.tsx', 'overlay.tsx', 'settings.tsx']
    const used = new Set<string>()
    for (const file of sources) {
      const text = await readFile(path.join(packageRoot, 'src', 'client', file), 'utf8')
      for (const match of text.matchAll(/\bctx\.([a-zA-Z]+)/g)) {
        const service = match[1]
        if (service !== undefined && !['slots'].includes(service)) used.add(service)
      }
    }

    for (const service of used) {
      if (['effect', 'get', 'on'].includes(service)) continue
      expect(declared.has(service)).toBe(true)
    }
  })
})

describe('module-level client deps must be resolvable', () => {
  it('declares only packages that ship a client bundle', async () => {
    const pkg = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { dsh?: { client?: { inject?: string[] } } }
    const declared = pkg.dsh?.client?.inject ?? []
    expect(declared.length).toBeGreaterThan(0)

    // The loader resolves these ids to client bundles. A package that ships
    // none can never resolve, so the entry waits forever and its `apply`
    // never runs — styles appear but no surface mounts, with no error.
    // `@deepseek-ai/dsh-client-ui-slots` is exactly such a package.
    const root = path.resolve(__dirname, '..', '..', '..', 'node_modules')
    for (const id of declared) {
      const bundle = path.join(root, id, 'lib', 'client.js')
      const exists = await readFile(bundle, 'utf8').then(
        () => true,
        () => false,
      )
      expect({ id, shipsClientBundle: exists }).toEqual({ id, shipsClientBundle: true })
    }
  })

  it('declares the packages owning every slot Pet registers into', async () => {
    const pkg = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { dsh?: { client?: { inject?: string[] } } }
    const declared = new Set(pkg.dsh?.client?.inject ?? [])

    // `shell.overlay` is declared by ui-layout and `settings.section` by
    // ui-settings; without depending on their owners the slots may not exist
    // when Pet loads.
    expect(declared.has('@deepseek-ai/dsh-client-ui-layout')).toBe(true)
    expect(declared.has('@deepseek-ai/dsh-client-ui-settings')).toBe(true)
  })
})
