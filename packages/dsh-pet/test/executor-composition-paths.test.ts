/**
 * Every path that can bring a Pet executor Agent to life must install the Pet
 * scoped composition.
 *
 * There are THREE, and Pet originally covered one:
 *
 *  1. Pet creates the executor (`agents.create`) — covered from the start.
 *  2. Pet resumes an evicted executor (`agents.resume`) — DSH unloads idle
 *     agents and mints a BRAND NEW scope on resume, so the previous scope's
 *     registrations are gone. Resuming without `setup` produced an executor
 *     with no allowlist boundary and no trusted-context tool.
 *  3. DSH itself loads the executor. The spec requires executor sessions to be
 *     visible and openable in the native session list, and the official
 *     session controller resumes any opened session with ITS OWN setup, which
 *     knows nothing about Pet. Pet's dispatcher then finds that agent through
 *     `agents.get` and reuses it verbatim.
 *
 * These cases drive the REAL plugin entry through cordis so the assertions are
 * about wiring, not about a hand-assembled subset that cannot regress the way
 * production did.
 */

import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import { describe, expect, it } from 'vitest'
import * as petPlugin from '../src/index.js'
import { PET_DOMAIN_NAME } from '../src/host/spec.js'
import { ROUTES } from '../src/wire.js'

interface TestRoute {
  path: string
  handler: (req: never, res: never) => Promise<void> | void
}

/** Drive one Pet HTTP route the way the Web client does. */
async function callRoute(
  route: TestRoute,
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

/** Register and enable a Skill through the real routes; Pet ships none. */
async function registerSkill(routes: TestRoute[], skillName: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-skill-'))
  await writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${skillName}\n---\nBody\n`,
  )
  await callRoute(routes.find(route => route.path === ROUTES.skillImport)!, { path: dir })
  await callRoute(routes.find(route => route.path === ROUTES.skillMutate)!, {
    skillName,
    action: 'enable',
  })
}

/** What one composed Host exposes to a test. */
interface ComposedHost {
  ctx: Context
  home: string
  routes: TestRoute[]
  created: { sessionId: string; setup?: unknown }[]
  resumed: { resumeSessionId: string; setup?: unknown }[]
  /** Preset ids actually mounted by create/resume setup. */
  mountedPresets: string[]
  /** Change the persisted preset projection returned on resume. */
  setPersistedPreset: (presetId: string) => void
  /** Set to return a live agent from `agents.get`, simulating an already-loaded executor. */
  setLiveAgent: (agent: unknown) => void
  followups: unknown[]
}

/**
 * Compose the real Pet plugin over stub DSH services.
 * @param options - `liveAgent` seeds `agents.get` before any Invocation.
 * @returns the composed Host and the recorders the assertions read.
 */
async function composeHost(): Promise<ComposedHost> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-paths-'))
  const routes: TestRoute[] = []
  const created: { sessionId: string; setup?: unknown }[] = []
  const resumed: { resumeSessionId: string; setup?: unknown }[] = []
  const mountedPresets: string[] = []
  const followups: unknown[] = []
  let persistedPreset = 'dsh-pet-executor'
  let liveAgent: unknown

  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.provide('webServer', {
    register: (route: TestRoute) => {
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
    get: (id: string) =>
      id === 'src-1' ? { header: { cwd: '/repo' }, snapshotEvents: () => [], seq: 0 } : undefined,
  })
  ctx.provide('sessionQuery', {
    observeSession: async () => ({
      header: { agentPreset: 'dsh-pet-executor' },
      projections: { values: { agentPreset: persistedPreset } },
      [Symbol.dispose]: () => {},
    }),
  })

  /** A handle shaped like the real one, recording dispatched follow-ups. */
  const makeHandle = (sessionId: string, agentCtx: FakeAgentContext): unknown => {
    const agent = {
      ctx: agentCtx,
      session: { id: sessionId },
      followup: (message: unknown) => {
        followups.push(message)
      },
      whenIdle: async () => {},
    }
    return { agent, session: { id: sessionId } }
  }

  ctx.provide('agents', {
    create: async (options: {
      sessionId: string
      setup?: (agentCtx: unknown) => void | Promise<void>
    }) => {
      created.push(options)
      const agentCtx = makeAgentContext()
      // The real factory awaits setup before publishing the Agent.
      await options.setup?.(agentCtx)
      liveAgent = makeHandle(options.sessionId, agentCtx)
      return liveAgent
    },
    resume: async (options: {
      resumeSessionId: string
      setup?: (agentCtx: unknown) => void | Promise<void>
    }) => {
      resumed.push(options)
      const agentCtx = makeAgentContext()
      await options.setup?.(agentCtx)
      liveAgent = makeHandle(options.resumeSessionId, agentCtx)
      return liveAgent
    },
    get: () => liveAgent,
    list: () => [],
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
  })
  ctx.provide('agentPresets', {
    list: async () => [],
    mount: async (_agentCtx: unknown, presetId: string) => {
      mountedPresets.push(presetId)
    },
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
  while (
    Date.now() < deadline &&
    routes.find(route => route.path === ROUTES.skillMutate) === undefined
  ) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  return {
    ctx,
    home,
    routes,
    created,
    resumed,
    mountedPresets,
    followups,
    setPersistedPreset: presetId => {
      persistedPreset = presetId
    },
    setLiveAgent: agent => {
      liveAgent = agent
    },
  }
}

/** Start one Invocation through the real route. */
async function invoke(
  host: ComposedHost,
  clientInvocationId: string,
): Promise<{ ok: boolean; data?: unknown; error?: string; message?: string }> {
  return callRoute(host.routes.find(route => route.path === ROUTES.invocationCreate)!, {
    clientInvocationId,
    capabilityId: 'demo',
    sourceKind: 'session',
    sourceSessionId: 'src-1',
  })
}

/**
 * Settle the running Invocation through the real session-event projection.
 *
 * Invocations on one Task are strictly serial, so without this the second
 * `invoke` merely QUEUES behind the first and never reaches dispatch — the
 * path under test would never run.
 * @param host - The composed Host.
 * @param executorSessionId - The Task's executor session.
 */
async function settleTurn(host: ComposedHost, executorSessionId: string): Promise<void> {
  host.ctx.emit(
    'session/event' as never,
    { id: executorSessionId } as never,
    { type: 'turn/end', data: { reason: { kind: 'completed' } } } as never,
  )
  // The projection dispatches asynchronously.
  await new Promise(resolve => setTimeout(resolve, 50))
}

/** The executor session id of the Task created by the first Invocation. */
function executorOf(accepted: { data?: unknown }): string {
  return (accepted.data as { task: { executorSessionId: string } }).task.executorSessionId
}

/** The Task id created by the first Invocation. */
function taskOf(accepted: { data?: unknown }): string {
  return (accepted.data as { task: { id: string } }).task.id
}

/** A recording stand-in for an Agent's scoped context. */
interface FakeAgentContext {
  /** Service names the composition injected, in order. */
  injected: string[]
  inject(services: string[], callback: (ctx: FakeAgentContext) => void): void
  effect(fn: () => unknown): () => void
  skills: { registerProvider(create: () => unknown): () => void }
  tools: { register(definition: unknown): () => void }
}

/**
 * Build an agent-context double that records what a composition installed.
 *
 * The real agent context is a fresh fiber that gates service access behind
 * `inject`, which is why the composition must register inside those callbacks;
 * this double keeps that shape so the test exercises the same code path.
 * @returns the recording context.
 */
function makeAgentContext(): FakeAgentContext {
  const ctx: FakeAgentContext = {
    injected: [],
    inject(services, callback) {
      ctx.injected.push(...services)
      // Real Cordis schedules injected plugin callbacks asynchronously. A
      // synchronous double hid the production-only setup failure.
      queueMicrotask(() => callback(ctx))
    },
    effect(fn) {
      fn()
      return () => {}
    },
    skills: { registerProvider: () => () => {} },
    tools: { register: () => () => {} },
  }
  return ctx
}

describe('path 1: Pet creates the executor', () => {
  it('hands the Pet composition to Agent creation', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')

    expect((await invoke(host, 'inv-1')).ok).toBe(true)
    expect(host.created).toHaveLength(1)
    expect(typeof host.created[0]?.setup).toBe('function')
  })
})

describe('path 2: Pet resumes an evicted executor', () => {
  it('hands the SAME composition to resume', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')

    // First Invocation creates the executor.
    const first = await invoke(host, 'inv-1')
    expect(first.ok).toBe(true)
    expect(typeof host.created[0]?.setup).toBe('function')
    expect(host.mountedPresets).toEqual(['dsh-pet-executor'])
    await settleTurn(host, executorOf(first))

    // DSH unloads the idle agent: `agents.get` now finds nothing, so the next
    // dispatch must resume it into a fresh scope.
    host.setLiveAgent(undefined)
    expect((await invoke(host, 'inv-2')).ok).toBe(true)

    expect(host.resumed).toHaveLength(1)
    expect(typeof host.resumed[0]?.setup).toBe('function')
    // Creation and resume both ACTUALLY mount the Pet preset. Identity of the
    // wrapper function is irrelevant; the resulting composition is the
    // contract.
    expect(host.mountedPresets).toEqual(['dsh-pet-executor', 'dsh-pet-executor'])
  })

  it('mounts the persisted preset projection instead of current Pet settings', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')

    const first = await invoke(host, 'inv-1')
    expect(first.ok).toBe(true)
    await settleTurn(host, executorOf(first))

    // A preset selection event may have changed the session after creation.
    // The projection is authoritative; using selection() here would silently
    // make the header/log and the model-visible tool surface disagree.
    host.setPersistedPreset('pet-custom')
    host.setLiveAgent(undefined)
    expect((await invoke(host, 'inv-2')).ok).toBe(true)
    expect(host.mountedPresets).toEqual(['dsh-pet-executor', 'pet-custom'])
  })
})

describe('path 3: DSH itself loaded the executor', () => {
  it('does not dispatch onto an agent that never received the Pet composition', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')

    // First Invocation creates the executor normally.
    const first = await invoke(host, 'inv-1')
    expect(first.ok).toBe(true)
    await settleTurn(host, executorOf(first))
    const dispatchedAfterCreate = host.followups.length

    // Now simulate what the official session controller does when a user opens
    // the executor from the native session list: it resumes the session with
    // its OWN preset-only setup, so the live agent carries no Pet scope.
    host.setLiveAgent({
      agent: {
        followup: (message: unknown) => {
          host.followups.push(message)
        },
        whenIdle: async () => {},
      },
      // Deliberately NOT marked as Pet-composed.
    })

    expect((await invoke(host, 'inv-2')).ok).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 50))

    // The Invocation must NOT have been handed to that unbounded agent.
    expect(host.followups).toHaveLength(dispatchedAfterCreate)

    // And the refusal must be visible rather than silent: a failed dispatch
    // moves the Task to `recovering` with a diagnostic, so the user learns the
    // Invocation did not run.
    const detail = await callRoute(
      host.routes.find(route => route.path === ROUTES.taskDetail)!,
      { taskId: taskOf(first) },
    )
    const task = (detail.data as { task: { status: string; diagnostic?: string } }).task
    expect(task.status).toBe('recovering')
    expect(task.diagnostic ?? '').toContain('Pet scope')
  })

  it('scopes an externally loaded executor through the agent/created observer', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')

    const first = await invoke(host, 'inv-1')
    expect(first.ok).toBe(true)
    await settleTurn(host, executorOf(first))
    const dispatchedAfterCreate = host.followups.length

    // The official session controller publishes the agent it loaded. Pet's
    // observer must recognize the Pet executor session and scope it, so the
    // user opening the Task natively does not break later Invocations.
    const foreign = {
      ctx: makeAgentContext(),
      session: { id: executorOf(first) },
      followup: (message: unknown) => {
        host.followups.push(message)
      },
      whenIdle: async () => {},
    }
    host.ctx.emit('agent/created' as never, { agent: foreign } as never)

    // Asserted BEFORE any dispatch: the observer alone must have installed the
    // composition. Checking only that a later Invocation ran would also pass
    // on dispatch's late repair, hiding a missing observer.
    expect(foreign.ctx.injected).toEqual(['skills', 'tools'])

    host.setLiveAgent(foreign)
    expect((await invoke(host, 'inv-2')).ok).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 50))

    // And with the boundary in place the Invocation is allowed through.
    expect(host.followups.length).toBeGreaterThan(dispatchedAfterCreate)
  })

  it('is idempotent when the same agent is offered the composition twice', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')

    const first = await invoke(host, 'inv-1')
    expect(first.ok).toBe(true)
    await settleTurn(host, executorOf(first))

    const foreign = {
      ctx: makeAgentContext(),
      session: { id: executorOf(first) },
      followup: () => {},
      whenIdle: async () => {},
    }

    // Two publications of the same agent must not throw: a duplicate tool
    // registration would abort the agent's load, which is exactly how the
    // `shellEnv` incident cost the executor its `bash` tool.
    expect(() => {
      host.ctx.emit('agent/created' as never, { agent: foreign } as never)
      host.ctx.emit('agent/created' as never, { agent: foreign } as never)
    }).not.toThrow()

    // Registered exactly once.
    expect(foreign.ctx.injected).toEqual(['skills', 'tools'])
  })

  it('ignores agents whose session is not a Pet executor', async () => {
    const host = await composeHost()
    await registerSkill(host.routes, 'demo')
    expect((await invoke(host, 'inv-1')).ok).toBe(true)

    const ordinary = {
      ctx: makeAgentContext(),
      session: { id: 'some-unrelated-session' },
    }
    host.ctx.emit('agent/created' as never, { agent: ordinary } as never)

    // An ordinary DSH session must never receive Pet's registrations.
    expect(ordinary.ctx.injected).toEqual([])
  })
})
