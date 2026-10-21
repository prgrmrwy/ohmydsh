import { mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { buildLocusRecord, type LocusRecord } from '../../src/host/locus/aggregate.js'
import { LocusRepository } from '../../src/host/locus/persistence.js'
import * as petStoragePlugin from '../../src/host/storage/plugin.js'
import { PET_BACKEND_NAME } from '../../src/host/storage/backend.js'
import { withAtomicWrites } from '../../src/host/storage/atomic-domain.js'
import { PET_DOMAIN_NAME, petDomainSpec } from '../../src/host/spec.js'
import type { RouteRegistration } from '../../src/host/http.js'
import * as petPlugin from '../../src/index.js'

// Scope tags use a package-private Symbol, so mint from ToolRuntime's own
// dependency root rather than the repository's second physical dsh-scope copy.
const graphRequire = process.env.PET_INQUIRY_LAUNCHER
  ? createRequire(path.join(process.env.PET_INQUIRY_LAUNCHER, 'package.json'))
  : require
const requireFromTools = createRequire(graphRequire.resolve('@deepseek-ai/dsh-tools/package.json'))
const scopeEntry = requireFromTools.resolve('@deepseek-ai/dsh-scope')
export const { createScope } = await import(pathToFileURL(scopeEntry).href) as typeof import('@deepseek-ai/dsh-scope')

export const MAIN = 'main-1'
export const CHILD_A = 'child-a'
export const CHILD_B = 'child-b'

export async function agentScope(
  ctx: Context,
  sessionId: string,
): Promise<{ key: object; scope: Context; dispose: () => Promise<void> }> {
  const loopCtx = await new Promise<Context>(resolve => {
    ctx.inject(['tools'], injected => resolve(injected as Context))
  })
  const key = { id: sessionId }
  const scope = createScope(loopCtx, key as never)
  return {
    key,
    scope: scope.ctx.extend({ agent: key }) as Context,
    dispose: () => scope.dispose(),
  }
}

export function locus(
  id: string,
  child: string,
  overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {},
): LocusRecord {
  return buildLocusRecord({
    id,
    generation: 1,
    parentSessionId: MAIN,
    childSessionId: child,
    endpoint: { chatId: `chat-${id}` },
    workspaceId: 'workspace',
    source: 'explicit',
    state: 'active',
    childComposition: 'safe-v1',
    ...overrides,
  })
}

export async function composePetStorage(ctx: Context, statePath: string): Promise<void> {
  const [Storage, Domain] = await Promise.all([
    import('@deepseek-ai/dsh-storage'),
    import('@deepseek-ai/dsh-storage-domain'),
  ])
  await ctx.plugin(Storage.default as never)
  // A default backend for every domain that is NOT Pet's: the route table is
  // an override map, so `backend: 'json'` still has to resolve to something.
  await ctx.plugin({
    name: 'default-backend',
    inject: ['storage'],
    apply(inner: Context) {
      const backend = { kv: { open: () => Promise.reject(new Error('no default unit in this suite')) }, close: () => Promise.resolve() }
      inner.effect(() => inner.storage.backend.register('json', backend as never))
      inner.provide(Storage.storageBackendServiceKey('json'), backend as never)
    },
  } as never)
  await ctx.plugin(petStoragePlugin as never, { path: statePath })
  await ctx.plugin(Domain as never, { backend: 'json', routes: { [PET_DOMAIN_NAME]: PET_BACKEND_NAME } })
}

export async function openDomainOnly(statePath: string): Promise<Context> {
  const ctx = new Context()
  await composePetStorage(ctx, statePath)
  return ctx
}

/**
 * Open Pet's domain with atomic writes attached, exactly as `src/index.ts`
 * does. A domain opened without this advertises no transaction support, and
 * every store refuses its writes — correct fail-closed behavior, but not what
 * a test seeding real records wants.
 * @param ctx - a context already carrying Pet's storage stack.
 * @returns the domain, ready for the stores.
 */
export async function openPetDomain(ctx: Context): Promise<never> {
  const domain = await ctx.storageDomain.open(petDomainSpec)
  const backend = ctx.storage.backend.get(PET_BACKEND_NAME) as unknown as {
    unitFor(name: string): Promise<{ applyBatch(writes: readonly never[]): Promise<void> } | undefined>
  }
  return withAtomicWrites(domain as never, await backend.unitFor(PET_DOMAIN_NAME) as never) as never
}

export interface LoadedHost {
  ctx: Context
  routes: { path: string }[]
  publish(sessionId: string, scope: unknown): void
  toolNames(scope?: unknown): string[]
  route(routePath: string): RouteRegistration | undefined
  agentScope(sessionId: string): Promise<{ key: object; scope: Context; dispose: () => Promise<void> }>
  close(): Promise<void>
}

export async function loadPetHost(
  seed: readonly LocusRecord[] = [],
  existingHome?: string,
  seedDomain?: (domain: Awaited<ReturnType<typeof openPetDomain>>) => Promise<void>,
  beforePet?: (ctx: Context) => Promise<void>,
): Promise<LoadedHost> {
  const home = existingHome ?? await mkdtemp(path.join(tmpdir(), 'pet-assembly-'))
  const routes: { path: string }[] = []
  const live = new Map<string, { ctx: Context; id: string }>()

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // The storage hub is composed by `composePetStorage` below, together with
  // Pet's backend and the domain layer, in the order the real Host uses.
  ctx.provide('webServer', {
    register: (route: { path: string }) => {
      routes.push(route)
      return () => {}
    },
  })
  ctx.provide('connection', { requestRejection: () => undefined })
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'pet-project-'))
  await mkdir(path.join(home, 'attachments'), { recursive: true })
  ctx.provide('workspaceRegistry', {
    create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
    list: () => [],
    get: (id: string) =>
      id === 'ws-pet' ? { id, path: '/pet', title: 'DSH Pet', sessionIds: [] } : undefined,
    archivedSessionIds: [],
  })
  // A locus child's composition applies its file policy through the official
  // free function `setSandboxMode`, which appends a `sandbox/mode` event to the
  // exact Session, and then READS BACK what the policy service resolved. Both
  // halves are modelled here: a session that records appended modes, and a
  // policy service that answers from those records. A stand-in that accepted
  // the write without reflecting it would let a child be published with a
  // permission the Host never actually applied.
  const appliedModes = new Map<string, string>()
  ctx.provide('sessions', {
    list: () => [],
    get: (id: string) =>
      live.has(id)
        ? {
          id,
          header: { cwd: projectRoot },
          snapshotEvents: () => [],
          seq: 0,
          append: (type: string, data: { mode?: string }) => {
            if (type === 'sandbox/mode' && typeof data?.mode === 'string') {
              appliedModes.set(id, data.mode)
            }
            return { type, data, seq: 0 }
          },
        }
        : undefined,
  })
  ctx.provide('sandboxPolicy', {
    resolve: (input: { session?: { id?: string } }) => {
      const id = input?.session?.id
      const mode = id === undefined ? undefined : appliedModes.get(id)
      return mode === undefined ? undefined : { mode, workspaceRoot: projectRoot }
    },
  })
  ctx.provide('sessionController', {
    inspect: async (id: string) => {
      // Cold identity: the main session has no parent; each child names it.
      if (id === MAIN) return { meta: { id } }
      if (id === CHILD_A || id === CHILD_B) return { meta: { id, parentSession: MAIN } }
      throw new Error(`session "${id}" not found`)
    },
    resolveAgent: async () => undefined,
  })
  ctx.provide('agents', {
    create: async () => ({ agent: { id: 'x' }, dispose: async () => {} }),
    get: (id: string) => live.get(id),
    resume: async () => undefined,
    list: () => [],
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
  })
  ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
  ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
  ctx.provide('sessionTitle', {
    rename: () => ({}),
    get: (session: { id?: string } | undefined) =>
      session?.id === undefined ? undefined : { title: `title ${session.id}` },
  })
  ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })

  await composePetStorage(ctx, path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'))

  if (seed.length > 0) {
    const seeded = await openPetDomain(ctx)
    const repository = new LocusRepository(seeded)
    for (const row of seed) await repository.putLocus(row)
    await seedDomain?.(seeded)
    await seeded.close()
  }

  await beforePet?.(ctx)
  await ctx.plugin(petPlugin, { home, version: '0.1.0' })

  // Pet's initialization is contained and asynchronous; poll for its observable
  // end state rather than guessing a delay.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && routes.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  expect(routes.length).toBeGreaterThan(0)

  return {
    ctx,
    routes,
    publish(sessionId, scope) {
      ctx.emit('agent/created' as never, { agent: { id: sessionId, ctx: scope } } as never)
    },
    toolNames: scope =>
      (ctx.tools as unknown as { schemas(s?: unknown): { name: string }[] })
        .schemas(scope)
        .map(schema => schema.name),
    route: routePath => routes.find(route => route.path === routePath) as RouteRegistration | undefined,
    agentScope: async sessionId => {
      const built = await agentScope(ctx, sessionId)
      live.set(sessionId, { ctx: built.scope, id: sessionId })
      return built
    },
    close: async () => {
      await ctx.fiber.dispose()
    },
  }
}
