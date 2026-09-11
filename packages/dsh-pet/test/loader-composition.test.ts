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
import { LOCUS_ROUTES, ROUTES } from '../src/wire.js'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * Minimal stand-ins for the DSH services Pet injects.
 *
 * Provided on the given context before Pet loads; cordis gates `apply` until
 * every declared inject resolves, so a missing stub reproduces the exact
 * startup stall a real Host would hit.
 */
function stubServices(
  ctx: Context,
  registered: { path: string }[],
  overrides: {
    sessions?: unknown
    agents?: unknown
    sessionController?: unknown
    connection?: { requestRejection(req: unknown): 401 | 403 | undefined }
  } = {},
): void {
  ctx.provide('webServer', {
    register: (route: { path: string }) => {
      registered.push(route)
      return () => {}
    },
  })
  ctx.provide('connection', overrides.connection ?? { requestRejection: () => undefined })
  ctx.provide('workspaceRegistry', {
    create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
    list: () => [],
    // The real registry resolves a workspace by id; omitting it here let a
    // consumer look correct while failing against the actual Host.
    get: (id: string) => (id === 'ws-pet' ? { id, path: '/pet', title: 'DSH Pet' } : undefined),
    archivedSessionIds: [],
  })
  ctx.provide('sessions', overrides.sessions ?? { list: () => [], get: () => undefined })
  ctx.provide('sessionController', overrides.sessionController ?? {
    inspect: async () => ({ session: undefined }),
    resolveAgent: async () => undefined,
  })
  // `resume` mirrors the real registry. Omitting it made the locus child
  // probe stop at parent resolution, masking every later capability gate.
  ctx.provide('agents', overrides.agents ?? {
    create: async () => ({ session: { id: 'x' } }),
    get: () => undefined,
    resume: async () => undefined,
    list: () => [],
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
  })
  // Declared in `inject`, so `apply` never runs without it.
  ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
  ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
  // `get` mirrors the real service: the title lives in the session log, not
  // on the header, so a consumer must read it from here.
  ctx.provide('sessionTitle', {
    rename: () => ({}),
    get: (session: { id?: string } | undefined) =>
      session?.id === 'main-live'
        ? '研发主会话'
        : session?.id === 'child-live' ? '项目子会话' : undefined,
  })
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('skills', { register: () => () => {} })
}

/** Compose Pet exactly as the profile patch does, over an isolated home. */
async function composeHost(options: {
  withSqlite?: boolean
  settleMs?: number
  connection?: { requestRejection(req: unknown): 401 | 403 | undefined }
} = {}): Promise<{
  ctx: Context
  home: string
  routes: { path: string; handler?: (req: never, res: never) => Promise<void> | void }[]
}> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
  const routes: { path: string; handler?: (req: never, res: never) => Promise<void> | void }[] = []
  const ctx = new Context()
  await ctx.plugin(Storage)
  stubServices(ctx, routes, options.connection === undefined ? {} : { connection: options.connection })

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

  it('applies the real Connection browser-auth fence to every exact route', async () => {
    let authChecks = 0
    const { routes } = await composeHost({
      connection: {
        requestRejection: () => {
          authChecks += 1
          return 401
        },
      },
    })
    const status = routes.find(route => route.path === ROUTES.status)
    expect(status?.handler).toBeTypeOf('function')

    let statusCode: number | undefined
    let payload: string | undefined
    await status!.handler!(
      { method: 'POST', headers: { host: '127.0.0.1:3080' } } as never,
      {
        writeHead(status: number) {
          statusCode = status
          return this
        },
        end(body: string) {
          payload = body
        },
      } as never,
    )

    expect(authChecks).toBe(1)
    expect(statusCode).toBe(401)
    expect(payload).toBe('unauthorized')
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
    ctx.provide('connection', { requestRejection: () => undefined })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, snapshotEvents: () => [], seq: 0 } : undefined),
    })
    ctx.provide('sessionController', { inspect: async () => ({ session: undefined }), resolveAgent: async () => undefined })
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
    ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
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
    while (
      Date.now() < deadline &&
      routes.find(route => route.path === ROUTES.skillMutate) === undefined
    ) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')

    // Pet follows the Host's default model selection; there is nothing
    // Pet-side to configure, and the route no longer accepts these fields.
    const configRoute = routes.find(route => route.path === ROUTES.configUpdate)
    expect(configRoute).toBeDefined()

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
    ctx.provide('connection', { requestRejection: () => undefined })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, snapshotEvents: () => [], seq: 0 } : undefined),
    })
    // A handle shaped like the real one: `.agent` carrying synchronous
    // `followup(UserMessage)` and an awaited `whenIdle()`.
    //
    // `ctx` is present because the real Agent has one, and creation awaits the
    // caller's `setup` against it before publishing. Pet refuses to dispatch
    // onto an executor whose scope it cannot account for, so a double without
    // a context would model an agent DSH never actually produces.
    const agentCtx = {
      inject: (_services: string[], callback: (scoped: unknown) => void) => {
        callback(agentCtx)
      },
      effect: (fn: () => unknown) => {
        fn()
        return () => {}
      },
      skills: { registerProvider: () => () => {} },
      tools: { register: () => () => {} },
    }
    const agentHandle = {
      agent: {
        ctx: agentCtx,
        followup: (message: unknown) => {
          followups.push(message)
        },
        whenIdle: async () => {
          idleAwaited += 1
        },
      },
    }
    ctx.provide('sessionController', { inspect: async () => ({ session: undefined }), resolveAgent: async () => undefined })
    ctx.provide('agents', {
      create: async (options: { sessionId: string; setup?: (c: unknown) => void | Promise<void> }) => {
        // The real factory awaits `setup` before publishing the agent.
        await options.setup?.(agentCtx)
        return { session: { id: options.sessionId } }
      },
      get: () => agentHandle,
      list: () => [],
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
    })
    ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
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
    while (
      Date.now() < deadline &&
      routes.find(route => route.path === ROUTES.skillMutate) === undefined
    ) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')
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
    ctx.provide('connection', { requestRejection: () => undefined })
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
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, snapshotEvents: () => [], seq: 0 } : undefined),
    })
    ctx.provide('sessionController', { inspect: async () => ({ session: undefined }), resolveAgent: async () => undefined })
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
    ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
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
    while (
      Date.now() < deadline &&
      routes.find(route => route.path === ROUTES.skillMutate) === undefined
    ) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    await registerSkill(routes, 'clean-worktree')
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
    ctx.provide('connection', { requestRejection: () => undefined })
    ctx.provide('workspaceRegistry', {
      create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
      list: () => [],
      archivedSessionIds: [],
      archiveSession: async () => {},
    })
    ctx.provide('sessions', {
      list: () => [],
      get: (id: string) => (id === 'src-1' ? { header: { cwd: '/repo' }, snapshotEvents: () => [], seq: 0 } : undefined),
    })
    // Only `anthropic` is routable in this Host.
    // The Host default names a provider this Host does not route.
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'ghost-provider', model: 'whatever' }),
    })
    ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
    ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
    ctx.provide('sessionTitle', { rename: () => ({}) })
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })
    ctx.provide('sessionController', { inspect: async () => ({ session: undefined }), resolveAgent: async () => undefined })
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
    while (
      Date.now() < deadline &&
      routes.find(route => route.path === ROUTES.skillMutate) === undefined
    ) {
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

describe('a locus child is composed at the real creation boundary', () => {
  /**
   * Compose Pet over a real loader with a live locus record, then emit the
   * runtime's own `agent/created` for that child.
   *
   * Executed rather than source-matched on purpose: this exact wiring is the
   * class of defect the integration-pitfalls note is about — a registration
   * can look correct, type-check, and still never take effect.
   */
  async function hostWithLocusChild(options: { policy?: 'read-only' | 'workspace-write' | 'absent' } = {}) {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string }[] = []
    const ctx = new Context()
    await ctx.plugin(Storage)
    const applied: { sessionId: string; mode: string }[] = []
    const modes = new Map<string, string>()
    const sessions = new Map<string, {
      id: string
      header: { cwd: string }
      snapshotEvents(): never[]
      seq: number
      append(type: string, data: { mode?: string }): void
    }>()
    const sessionOf = (id: string) => {
      const current = sessions.get(id)
      if (current !== undefined) return current
      const session = {
        id,
        header: { cwd: '/repo' },
        snapshotEvents: () => [],
        seq: 0,
        append(type: string, data: { mode?: string }) {
          if (type !== 'sandbox/mode' || data.mode === undefined) return
          modes.set(id, data.mode)
          applied.push({ sessionId: id, mode: data.mode })
        },
      }
      sessions.set(id, session)
      return session
    }
    // The real write path is `setSandboxMode(session, mode)`, which appends a
    // `sandbox/mode` event. Return stable session objects so the readback sees
    // the event it just wrote; a fresh object per get would hide the effect.
    stubServices(ctx, routes, {
      sessions: {
        list: () => [],
        get: (id: string) => sessionOf(id),
      },
    })
    if (options.policy !== 'absent') {
      ctx.provide('sandboxPolicy', {
        // Report what the Host actually resolved, which is what the composer
        // verifies against the locus grant.
        resolve: ({ session }: { session: { id: string } }) => ({
          mode: options.policy ?? modes.get(session.id),
        }),
      })
    }

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
    await ctx.plugin(StorageSqlite, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return { ctx, home, applied }
  }

  /** Insert one active locus generation through the durable repository. */
  async function seedLocus(ctx: Context, permission: 'read' | 'write'): Promise<void> {
    const { LocusRepository } = await import('../src/host/locus/persistence.js')
    const domain = ctx.storage.domain.get(PET_DOMAIN_NAME)
    expect(domain).toBeDefined()
    const repository = new LocusRepository(domain as never)
    await repository.putLocus({
      id: 'locus-live',
      generation: 1,
      endpoint: { chatId: 'oc-live' },
      parentSessionId: 'main-live',
      childSessionId: 'child-live',
      workspaceId: 'ws-live',
      source: 'auto',
      state: 'active',
      permission: { desired: permission, effective: permission, verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })
  }

  /** Emit the runtime's creation event exactly as DSH does. */
  function publish(ctx: Context, sessionId: string): { registered: string[] } {
    const registered: string[] = []
    const agentCtx = {
      get: (service: string) =>
        service === 'tools'
          ? { register: (definition: { name?: string }) => { registered.push(definition.name ?? '?'); return () => {} } }
          : undefined,
      inject: (_services: string[], callback: (scoped: unknown) => void) => { callback(agentCtx) },
      effect: (fn: () => unknown) => { fn(); return () => {} },
      tools: { register: (definition: { name?: string }) => { registered.push(definition.name ?? '?'); return () => {} } },
      skills: { registerProvider: () => () => {} },
    }
    ctx.emit('agent/created', { agent: { session: { id: sessionId }, ctx: agentCtx } })
    return { registered }
  }

  it('installs the caller-bound surface on the child and applies its read policy', async () => {
    const { ctx, applied } = await hostWithLocusChild()
    await seedLocus(ctx, 'read')

    const { registered } = publish(ctx, 'child-live')

    // The child got Pet's caller-bound tool on its OWN scope, and the Host
    // was asked for exactly the locus's granted permission.
    expect(registered).toContain('pet_context')
    expect(applied).toEqual([{ sessionId: 'child-live', mode: 'read-only' }])
  })

  it('vetoes publication when the Host cannot verify the locus permission', async () => {
    // The Host resolves a WIDER policy than the locus granted.
    const { ctx } = await hostWithLocusChild({ policy: 'workspace-write' })
    await seedLocus(ctx, 'read')

    // A synchronous throw out of `agent/created` is what rolls the agent back,
    // so a child never runs a turn with more file access than it was granted.
    expect(() => publish(ctx, 'child-live')).toThrow(/read/)
  })

  it('vetoes publication when the Host exposes no policy seam at all', async () => {
    const { ctx } = await hostWithLocusChild({ policy: 'absent' })
    await seedLocus(ctx, 'read')

    expect(() => publish(ctx, 'child-live')).toThrow(/policy/)
  })

  it('leaves ordinary sessions untouched', async () => {
    const { ctx, applied } = await hostWithLocusChild()
    await seedLocus(ctx, 'read')

    // Not a locus child: no veto, and no policy imposed on it.
    expect(() => publish(ctx, 'some-other-session')).not.toThrow()
    expect(applied).toEqual([])
  })
})

describe('the per-turn correlation observer is wired to real runtime events', () => {
  /**
   * Compose Pet over the real loader, seed one queued durable Delivery, then
   * emit the two runtime events a Host actually publishes.
   *
   * Executed rather than source-matched: a subscription can use the wrong
   * event name, read the wrong payload field, or attach too late, and every
   * one of those type-checks fine while silently leaving Deliveries unable to
   * settle.
   */
  async function hostWithQueuedDelivery() {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string }[] = []
    const ctx = new Context()
    await ctx.plugin(Storage)
    stubServices(ctx, routes, {
      sessions: {
        list: () => [],
        get: (id: string) => ({ id, header: { cwd: '/repo' }, snapshotEvents: () => [], seq: 0 }),
      },
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
    await ctx.plugin(StorageSqlite, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    const { LocusRepository } = await import('../src/host/locus/persistence.js')
    const repository = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    const endpoint = { chatId: 'oc-live' }
    await repository.putLocus({
      id: 'locus-live',
      generation: 1,
      endpoint,
      parentSessionId: 'main-live',
      childSessionId: 'child-live',
      workspaceId: 'ws-live',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const accepted = await repository.acceptDelivery({
      endpoint,
      locusId: 'locus-live',
      generation: 1,
      childSessionId: 'child-live',
      messageId: 'om-live',
      senderOpenId: 'ou_owner',
      acceptedAt: 2,
    })
    await repository.bindQueued({
      deliveryId: accepted.record.deliveryId,
      correlation: { endpoint, locusId: 'locus-live', generation: 1, childSessionId: 'child-live' },
      executionId: 'execution-live', inboxMessageId: 'inbox-execution-live',
      queuedAt: 3,
    })
    return { ctx, repository }
  }

  it('settles a queued Delivery from a real inbox claim and turn end', async () => {
    const host = await hostWithQueuedDelivery()

    // Exactly the two events DSH emits, with their real payload shapes.
    host.ctx.emit('agent/inbox/claimed' as never, {
      agent: { session: { id: 'child-live' } },
      message: { id: 'inbox-execution-live' },
      turn: 1,
    } as never)
    host.ctx.emit('session/event' as never, { id: 'child-live' } as never, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as never)

    await vi.waitFor(() => {
      expect(host.repository.findDeliveryByMessageId('om-live')?.status).toBe('settled')
    }, { timeout: 5_000 })
    // The durable record carries the exact turn proof, not a guess.
    expect(host.repository.findDeliveryByMessageId('om-live')?.turnId).toBe('child-live#1')
  })

  it('does not settle from a turn that claimed no Delivery', async () => {
    const host = await hostWithQueuedDelivery()

    // An initialization or GUI turn of the same child ends without ever
    // claiming this message.
    host.ctx.emit('session/event' as never, { id: 'child-live' } as never, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as never)
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(host.repository.findDeliveryByMessageId('om-live')?.status).toBe('queued')
  })
})

describe('owner-facing locus management is served by the real routes', () => {
  /** Compose Pet and seed two locus generations on one endpoint. */
  async function hostWithLoci(options: { scopeRuntime?: boolean } = {}) {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string; handler: (req: never, res: never) => Promise<void> | void }[] = []
    const ctx = new Context()
    await ctx.plugin(Storage)
    const modes = new Map<string, string>()
    const sessions = new Map<string, {
      id: string
      title: string
      header: { cwd: string; parentSession?: string; origin?: string }
      snapshotEvents(): never[]
      seq: number
      append(type: string, data: { mode?: string }): void
    }>()
    const sessionOf = (id: string) => {
      let session = sessions.get(id)
      if (session !== undefined) return session
      session = {
        id,
        title: id === 'main-live' ? '研发主会话' : '项目子会话',
        header: id === 'child-live'
          ? { cwd: '/repo', parentSession: 'main-live', origin: 'subagent' }
          : { cwd: '/repo' },
        snapshotEvents: () => [],
        seq: 0,
        append(type, data) {
          if (type === 'sandbox/mode' && data.mode !== undefined) modes.set(id, data.mode)
        },
      }
      sessions.set(id, session)
      return session
    }
    const main = { id: 'main-live', session: sessionOf('main-live') }
    const ordinaryControllerResolve = vi.fn(async () => ({ error: new Error('owned by subagent routing') }))
    stubServices(ctx, routes, {
      sessions: {
        list: () => [],
        get: (id: string) => id === 'main-live' || id === 'child-live' ? sessionOf(id) : undefined,
      },
      ...(options.scopeRuntime === true
        ? {
          agents: {
            create: async () => ({ session: { id: 'x' } }),
            get: (id: string) => id === 'main-live' ? main : undefined,
            resume: async () => undefined,
            list: () => [main],
          },
          sessionController: {
            inspect: async () => ({ session: undefined }),
            resolveAgent: ordinaryControllerResolve,
          },
        }
        : {}),
    })
    if (options.scopeRuntime === true) {
      // The API controller correctly refuses this subagent-owned child. Scope
      // must therefore use the continuation owner instead.
      ctx.provide('sandboxPolicy', {
        resolve: ({ session }: { session: { id: string } }) => ({ mode: modes.get(session.id) }),
      })
      ctx.provide('subagents', {
        startContinuable: async () => ({ childId: 'child-live' }),
        createIdleContinuable: async () => ({ childId: 'child-live' }),
        supportsSettlementNotice: true,
        supportsIdleContinuableCreate: true,
        supportsLiveContinuableChildSession: true,
        listChildren: async (_parentSessionId: string) => {
          return [{
            id: 'child-live', childSessionId: 'child-live', parentSessionId: 'main-live', kind: 'child', mode: 'continuable',
          }]
        },
        withLiveContinuableChildSession: async (
          spec: { parent: unknown; childId: string },
          operation: (session: unknown) => unknown,
        ) => {
          expect(spec.parent).toBe(main)
          expect(spec.childId).toBe('child-live')
          return operation(sessionOf('child-live'))
        },
        [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'message-1',
      })
    }

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
    await ctx.plugin(StorageSqlite, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && routes.find(r => r.path === LOCUS_ROUTES.view) === undefined) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    const { LocusRepository } = await import('../src/host/locus/persistence.js')
    const repository = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    const endpoint = { chatId: 'oc-live' }
    await repository.putLocus({
      id: 'locus-live',
      generation: 1,
      endpoint,
      parentSessionId: 'main-live',
      childSessionId: 'child-live',
      workspaceId: 'ws-pet',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const route = (target: string) => routes.find(r => r.path === target)!
    return { ctx, repository, route, endpoint, modes }
  }

  it('projects the owner view with resolved session and workspace facts', async () => {
    const host = await hostWithLoci()

    const result = await callRoute(host.route(LOCUS_ROUTES.view), {})

    expect(result.ok).toBe(true)
    const view = result.data as {
      loci: { locusId: string; main: { title?: string }; child: { title?: string }; state: { state: string } }[]
    }
    expect(view.loci.map(item => item.locusId)).toEqual(['locus-live'])
    // Resolved from the Host registries, not guessed from ids.
    expect(view.loci[0]?.main.title).toBe('研发主会话')
    expect(view.loci[0]?.child.title).toBe('项目子会话')
    expect(view.loci[0]?.state.state).toBe('active')
  })

  it('answers all three reverse-discovery directions from one durable truth', async () => {
    const host = await hostWithLoci()

    const byEndpoint = await callRoute(host.route(LOCUS_ROUTES.discovery), { endpoint: host.endpoint })
    const byParent = await callRoute(host.route(LOCUS_ROUTES.discovery), { parentSessionId: 'main-live' })
    const byChild = await callRoute(host.route(LOCUS_ROUTES.discovery), { childSessionId: 'child-live' })

    // Entry -> locus, main session -> its loci, child -> its own locus.
    expect((byEndpoint.data as { byEndpoint: { current?: { locusId: string } }[] })
      .byEndpoint[0]?.current?.locusId).toBe('locus-live')
    expect((byParent.data as { byParent: { loci: { locusId: string }[] }[] })
      .byParent[0]?.loci.map(item => item.locusId)).toEqual(['locus-live'])
    expect((byChild.data as { byChild: { locus?: { locusId: string } }[] })
      .byChild[0]?.locus?.locusId).toBe('locus-live')
  })

  it('stops a locus durably and keeps its history addressable', async () => {
    const host = await hostWithLoci()

    const stopped = await callRoute(host.route(LOCUS_ROUTES.stop), {
      action: 'stop',
      locusId: 'locus-live',
      endpoint: host.endpoint,
    })

    expect(stopped.ok).toBe(true)
    // Stopped is a durable marker, deliberately still addressable from the
    // endpoint: that is what lets an ordinary message be refused with an
    // explicit "rebuild required" instead of silently auto-creating a new
    // generation. What must be gone is its ROUTABILITY, not its history.
    expect(host.repository.getLocus('locus-live')?.state).toBe('stopped')
    expect(host.repository.getCurrentLocus(host.endpoint)?.state).toBe('stopped')
    expect(host.repository.findByChildSessionId('child-live')).toHaveLength(1)

    // The owner view keeps showing it, with its state, rather than hiding a
    // stopped entry the owner still has to act on.
    const view = await callRoute(host.route(LOCUS_ROUTES.view), {})
    expect((view.data as { loci: { locusId: string; state: { state: string } }[] }).loci)
      .toEqual([expect.objectContaining({ locusId: 'locus-live', state: expect.objectContaining({ state: 'stopped' }) })])
  })

  it('serves the message-to-execution diagnostic chain from the real route', async () => {
    const host = await hostWithLoci()
    const { LocusRepository } = await import('../src/host/locus/persistence.js')
    const repository = new LocusRepository(host.ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    const accepted = await repository.acceptDelivery({
      endpoint: host.endpoint,
      locusId: 'locus-live',
      generation: 1,
      childSessionId: 'child-live',
      messageId: 'om_diag_message_000001',
      senderOpenId: 'ou_sender_private',
      text: '这段正文不应出现在诊断里',
      acceptedAt: 5,
    })
    await repository.bindQueued({
      deliveryId: accepted.record.deliveryId,
      correlation: {
        endpoint: host.endpoint, locusId: 'locus-live', generation: 1, childSessionId: 'child-live',
      },
      executionId: 'execution-private', inboxMessageId: 'inbox-execution-private',
      queuedAt: 6,
    })

    const result = await callRoute(host.route(ROUTES.diagnostics), {})

    expect(result.ok).toBe(true)
    const chains = (result.data as { locus?: { deliveries: { stage: string; nextCheck: string }[] }[] }).locus
    expect(chains?.[0]?.deliveries[0]).toMatchObject({ stage: 'queued', executionBound: true, turnBound: false })
    // The chain names what to check next, which is the difference between a
    // status and something an owner can act on.
    expect(chains?.[0]?.deliveries[0]?.nextCheck).toContain('没有轮次认领')
    // And it never carries the conversation or the settlement tokens.
    const serialized = JSON.stringify(chains)
    expect(serialized).not.toContain('这段正文')
    expect(serialized).not.toContain('ou_sender_private')
    expect(serialized).not.toContain('execution-private')
  })

  it('refuses actions that would create an external resource', async () => {
    const host = await hostWithLoci()

    // These need a real group/child provisioning adapter, which this Host does
    // not compose. Reporting unavailable is required: half-creating a Feishu
    // group and then failing would leave a resource nobody owns.
    for (const [target, action] of [
      [LOCUS_ROUTES.bind, 'bind'],
      [LOCUS_ROUTES.rebuild, 'rebuild'],
    ] as const) {
      const refused = await callRoute(host.route(target), {
        action,
        endpoint: host.endpoint,
        parentSessionId: 'main-live',
        ...(action === 'rebuild'
          ? {
              expectedGeneration: 1,
              expectedLocusId: 'locus-live',
              expectedUpdatedAt: 1,
            }
          : {}),
      })
      expect(refused.ok).toBe(false)
      expect(refused.error).not.toBe('INVALID_REQUEST')
    }
    const refusedQa = await callRoute(host.route(LOCUS_ROUTES.defaultQa), {
      parentSessionId: 'main-live',
    })
    expect(refusedQa.ok).toBe(false)
  })

  it('uses the exact continuation-owned child but rejects write without a Host-authorized root', async () => {
    const host = await hostWithLoci({ scopeRuntime: true })

    const result = await callRoute(host.route(LOCUS_ROUTES.scope), {
      action: 'scope',
      locusId: 'locus-live',
      mode: 'write',
    })

    expect(result, JSON.stringify(result)).toMatchObject({ ok: false })
    expect(result.error).toBe('WRITE_UNSUPPORTED')
    expect(result.message).toContain('Host-derived')
    expect(host.modes.get('child-live')).toBe('read-only')
    expect(host.repository.getLocus('locus-live')?.permission).toMatchObject({
      desired: 'read', effective: 'read',
    })
    expect((host.ctx.sessionController as { resolveAgent: ReturnType<typeof vi.fn> }).resolveAgent).not.toHaveBeenCalled()
  })

  it('never accepts an operator identity from the request body', async () => {
    const host = await hostWithLoci()

    const result = await callRoute(host.route(LOCUS_ROUTES.scope), {
      action: 'scope',
      locusId: 'locus-live',
      mode: 'write',
      actorId: 'ou_attacker',
    })

    // An unknown field is rejected outright: the actor is Host-derived, so a
    // body that tries to supply one must never be partially honored.
    expect(result.ok).toBe(false)
    expect(host.repository.getLocus('locus-live')?.permission.effective).toBe('read')
  })
})

describe('startup reconciliation runs against the real runtime', () => {
  it('invalidates a locus whose child the runtime no longer lists', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string }[] = []
    const ctx = new Context()
    await ctx.plugin(Storage)
    stubServices(ctx, routes)
    // A runtime that can enumerate children and reports none: real evidence
    // that the persisted child cannot take another turn.
    ctx.provide('subagents', {
      startContinuable: async () => ({ childId: 'child-live' }),
      listChildren: async () => [],
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'message-1',
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
    await ctx.plugin(StorageSqlite, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })

    await ctx.plugin(petPlugin, { home, version: '0.1.0' })
    // Pet registers the domain during its async setup, so wait for it the
    // same way the other loader tests do before reading it.
    const ready = Date.now() + 15_000
    while (Date.now() < ready && ctx.storage.domain.get(PET_DOMAIN_NAME) === undefined) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const { LocusRepository } = await import('../src/host/locus/persistence.js')
    const seeded = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    await seeded.putLocus({
      id: 'locus-stale',
      generation: 1,
      endpoint: { chatId: 'oc-stale' },
      parentSessionId: 'main-gone',
      childSessionId: 'child-gone',
      workspaceId: 'ws-1',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: true,
      createdAt: 1,
      updatedAt: 1,
    })

    // The restart this pass exists for, driven against the SAME durable
    // domain and the SAME runtime seam Pet composed.
    const { reconcileLocusChildren } = await import('../src/host/locus/reconcile.js')
    const { probeLocusChildPorts } = await import('../src/host/locus/child.js')
    const probe = probeLocusChildPorts(ctx as never)
    const repository = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    const proof = probe.available ? probe.ports.proof : undefined
    expect(proof).toBeDefined()
    const report = await reconcileLocusChildren(repository.listLoci(), {
      store: {
        invalidate: async (id, reason, at) => {
          await repository.invalidateLocus(id, reason, at, undefined, { evenWithPendingWork: true })
        },
        clearBusy: async (id, at) => { await repository.setLocusBusy(id, false, at) },
      },
      probe: {
        check: async ({ parentSessionId, childSessionId, signal }) => (
          await proof!.findChild(parentSessionId, childSessionId, signal) === undefined
            ? { kind: 'unusable', reason: '子会话在运行时中已不存在，需要所有者重新建立。' }
            : { kind: 'usable' }
        ),
      },
    })
    expect(report.invalidated).toHaveLength(1)
    expect(repository.getLocus('locus-stale')?.state).toBe('invalid')

    // Recorded with a reason, never silently replaced by a fresh child: a
    // re-created child would discard the conversation this entry had.
    expect(repository.getLocus('locus-stale')?.invalidReason).toContain('重新建立')
  })

  it('leaves rows untouched when the runtime cannot enumerate children', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string }[] = []
    const ctx = new Context()
    await ctx.plugin(Storage)
    stubServices(ctx, routes)

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
    await ctx.plugin(StorageSqlite, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })

    await ctx.plugin(petPlugin, { home, version: '0.1.0' })
    // Pet registers the domain during its async setup, so wait for it the
    // same way the other loader tests do before reading it.
    const ready = Date.now() + 15_000
    while (Date.now() < ready && ctx.storage.domain.get(PET_DOMAIN_NAME) === undefined) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const { LocusRepository } = await import('../src/host/locus/persistence.js')
    const seeded = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    await seeded.putLocus({
      id: 'locus-kept',
      generation: 1,
      endpoint: { chatId: 'oc-kept' },
      parentSessionId: 'main-1',
      childSessionId: 'child-1',
      workspaceId: 'ws-1',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })

    // No `subagents` service at all: the probe cannot answer.
    await ctx.plugin(petPlugin, { home: await mkdtemp(path.join(tmpdir(), 'pet-loader-')), version: '0.1.0' })
    await new Promise(resolve => setTimeout(resolve, 200))

    const repository = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
    // A missing seam must not invalidate every entry the user has.
    expect(repository.getLocus('locus-kept')?.state).toBe('active')
  })
})

describe('the unified Feishu channel stays gated on real capabilities', () => {
  it('reports the exact missing capability instead of publishing the channel', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-loader-'))
    const routes: { path: string }[] = []
    const logs: string[] = []
    const ctx = new Context()
    await ctx.plugin(Storage)
    stubServices(ctx, routes)
    // A runtime exposing the child seams but NOT the ability to suppress a
    // child's automatic parent report — the pinned runtime's actual state.
    // `agents.resume` is present so the probe gets past parent resolution and
    // the assertion below is about the settlement-notice gate specifically.
    ctx.provide('subagents', {
      startContinuable: async () => ({ childId: 'child-live' }),
      listChildren: async () => [],
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'message-1',
    })
    // Capture the sink Pet actually writes to. Pet reports through `console`
    // rather than `ctx.logger`, because the Host logger's output never reaches
    // `$DSH_HOME/dsh.log` under `dsh web`; stubbing the logger here would
    // assert on a channel no operator can read.
    const restoreConsoleLog = console.log
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }

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
    await ctx.plugin(StorageSqlite, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })
    await ctx.plugin(petPlugin, { home, version: '0.1.0' })

    try {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline && routes.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      // The gate must name the missing capability, so an operator can tell
      // "not wired yet" from "wired and broken".
      const gate = logs.find(line => line.includes('unified Feishu channel stays unavailable'))
      expect(gate).toBeDefined()
      expect(gate).toContain('suppress')
    } finally {
      // Restore unconditionally: a patched `console.log` leaking out of this
      // case would silently swallow output from every later test.
      console.log = restoreConsoleLog
    }
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
    // The package ships NO Skills of its own. Bundling any would recreate the
    // built-in/external split this design removes: every Pet capability comes
    // from an ordinary Skill the user installs, exactly like `ws`.
    expect(pkg.files).not.toContain('skills')
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
    // npm may hoist a dependency to the workspace root or keep it nested
    // under this package (peer-conflict isolation), so check both roots.
    const roots = [
      path.resolve(__dirname, '..', 'node_modules'),
      path.resolve(__dirname, '..', '..', '..', 'node_modules'),
    ]
    for (const id of declared) {
      let exists = false
      for (const root of roots) {
        exists = await readFile(path.join(root, id, 'lib', 'client.js'), 'utf8').then(
          () => true,
          () => false,
        )
        if (exists) break
      }
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

describe('the Pet executor preset omits local-root Skill discovery', () => {
  it('differs from the shipped standard preset by exactly that plugin', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const preset = await readFile(
      nodePath.resolve(process.cwd(), '..', '..', 'presets', 'dsh-pet-executor', 'agent.cordis.yml'),
      'utf8',
    )

    // Without this the executor inherits `$DSH_HOME/skills`, `~/.agents/skills`
    // and project roots, so every globally installed Skill is visible to it —
    // the spec requires only Pet's allowlist to be publishable.
    const ids = [...preset.matchAll(/^- id: (\S+)$/gm)].map(match => match[1])
    expect(ids).not.toContain('skill-filesystem')
    // The catalog and loader must stay: the executor still needs to load the
    // Skills that Pet DOES allow.
    expect(ids).toContain('tool-skill')
  })
})
