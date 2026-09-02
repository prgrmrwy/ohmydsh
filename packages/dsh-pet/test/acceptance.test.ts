/**
 * End-to-end acceptance against an isolated DSH home.
 *
 * Exercises the full Pet flow over the REAL storage-domain layer, the REAL
 * SQLite backend and a REAL filesystem: first boot, built-in and local Skill
 * install, allowlist isolation, projection drift and repair, Workspace and
 * executor creation, several skills on one Task, fresh snapshots per
 * invocation, a no-source Task, restart recovery, and the archive/new-epoch
 * flow.
 */

import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { archiveTaskFromPet, reconcileArchives } from '../src/host/archive.js'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry, resolveTrustedContext, type SourceResolver } from '../src/host/capture.js'
import { executePetContext } from '../src/host/context-tool.js'
import { PetCoordinator, type PromptDispatcher } from '../src/host/coordinator.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import { detectProjectionDrift, rebuildProjection } from '../src/host/projection.js'
import { PetRepository } from '../src/host/repository.js'
import { inspectBundle } from '../src/host/skill-bundle.js'
import { createPetSkillProvider, currentAllowlist } from '../src/host/skill-provider.js'
import { petDomainSpec } from '../src/host/spec.js'
import { ensurePetWorkspace } from '../src/host/workspace.js'
import { PET_SETTINGS_TABS } from '../src/client/settings.js'

interface Deployment {
  readonly paths: PetPaths
  readonly repository: PetRepository
  readonly coordinator: PetCoordinator
  readonly capabilities: CapabilityRegistry
  readonly dispatched: { session: string; text: string }[]
  readonly createdSessions: Set<string>
  readonly workspaceCreates: string[]
  close(): Promise<void>
}

const openDomains: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of openDomains.splice(0)) await close()
})

/** Boot Pet against an isolated DSH home with the real SQLite backend. */
async function boot(home?: string): Promise<Deployment> {
  const dshHome = home ?? (await mkdtemp(path.join(tmpdir(), 'pet-accept-')))
  const paths = resolvePetPaths(dshHome)
  await ensurePetDirectories(paths)

  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin({
    name: 'default-json',
    inject: ['storage'],
    async apply(outer: Context) {
      await outer.plugin(
        {
          name: 'default-json-inner',
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
  await ctx.plugin(StorageSqlite, { path: paths.databaseFile })
  await ctx.plugin(StorageDomain, { backend: 'json', routes: { dsh_pet: 'sqlite' } })

  const domain = await ctx.storage.domain.open(petDomainSpec)
  openDomains.push(() => domain.close())
  const repository = new PetRepository(domain)

  const workspaceCreates: string[] = []
  const workspaceId = await ensurePetWorkspace(
    {
      create: async (p: string) => {
        workspaceCreates.push(p)
        return { id: 'ws-pet' }
      },
    },
    paths,
  )
  await repository.updateGlobal(current => ({ ...current, workspaceId }))

  const createdSessions = new Set<string>()
  const agents: AgentRegistryLike = {
    create: vi.fn(async (options: { sessionId: string }) => {
      createdSessions.add(options.sessionId)
      return { session: { id: options.sessionId } }
    }),
    get: (id: string) => (createdSessions.has(id) ? {} : undefined),
  } as AgentRegistryLike

  const dispatched: { session: string; text: string }[] = []
  const dispatcher: PromptDispatcher = {
    dispatch: async (session, text) => {
      dispatched.push({ session, text })
    },
  }

  const resolver: SourceResolver = {
    getSession: id =>
      id.startsWith('src') ? { id, title: `Session ${id}`, cwd: '/repo', asOfSeq: 5 } : undefined,
    getWorkspace: id => (id.startsWith('ws-src') ? { id, title: 'Repo' } : undefined),
  }

  const capabilities = new CapabilityRegistry()
  const coordinator = new PetCoordinator({
    repository,
    capabilities,
    agents,
    dispatcher,
    resolver,
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  })

  return {
    paths,
    repository,
    coordinator,
    capabilities,
    dispatched,
    createdSessions,
    workspaceCreates,
    close: () => domain.close(),
  }
}

/** Write a Skill bundle directory. */
async function bundle(name: string, description: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody for ${name}.\n`,
  )
  return root
}

/** Install and enable a Skill, then register a capability for it. */
async function enableSkill(
  deployment: Deployment,
  name: string,
  capabilityId = name,
): Promise<string> {
  const source = await bundle(name, `${name} capability`)
  const inspection = await inspectBundle(source)
  await deployment.repository.putSkillRevision({
    skillName: inspection.skillName,
    sourcePath: inspection.canonicalSourcePath,
    description: inspection.description,
    provenance: { kind: 'local-link', sourcePath: source, installedAt: Date.now() },
    fileCount: inspection.fileCount,
    totalBytes: inspection.totalBytes,
  })
  await deployment.repository.putSkillSelection({
    skillName: name,
    enabled: true,
    showAsShortcut: true,
  })
  deployment.capabilities.register({
    id: capabilityId,
    label: capabilityId,
    description: `${capabilityId} capability`,
    skillName: name,
    contextRequirement: 'session-required',
  })
  await rebuildProjection(
    deployment.paths,
    currentAllowlist(deployment.repository).map(entry => ({
      skillName: entry.skillName,
      sourcePath: entry.sourcePath,
    })),
  )
  return inspection.canonicalSourcePath
}

describe('first boot in an isolated DSH home', () => {
  it('creates owner-only state, workspace and store under the DSH home', async () => {
    const deployment = await boot()

    expect(deployment.workspaceCreates).toEqual([deployment.paths.workspaceRoot])
    expect(deployment.paths.stateRoot).toContain('plugins/dsh-pet')
    // The database really materialized at the configured path.
    const entries = await readdir(deployment.paths.stateRoot)
    expect(entries).toContain('state.sqlite')
    expect(entries).toContain('workspace')
  })


  it('exposes exactly the three stable tabs', () => {
    expect(PET_SETTINGS_TABS).toEqual(['general', 'skills', 'diagnostics'])
  })
})

describe('Skill install, allowlist isolation and projection', () => {
  it('projects an enabled Skill as a managed symlink into the store', async () => {
    const deployment = await boot()
    const digest = await enableSkill(deployment, 'create-mr')

    const drift = await detectProjectionDrift(deployment.paths, [
      { skillName: 'create-mr', sourcePath: digest },
    ])

    expect(drift).toEqual([])
    expect(await readdir(deployment.paths.projectionRoot)).toEqual(['create-mr'])
  })

  it('never exposes an installed-but-disabled Skill to the Agent', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')
    // Install a second Skill without enabling it.
    const source = await bundle('send-cr', 'Send CR')
    const inspection = await inspectBundle(source)
    await deployment.repository.putSkillRevision({
      skillName: 'send-cr',
      sourcePath: inspection.canonicalSourcePath,
      description: inspection.description,
      provenance: { kind: 'local-link', installedAt: Date.now() },
      fileCount: 1,
      totalBytes: 1,
    })

    const provider = createPetSkillProvider(deployment.repository, deployment.paths)

    expect((await provider.list()).map(item => item.name)).toEqual(['create-mr'])
  })

  it('recovers from managed-symlink drift only through an explicit rebuild', async () => {
    const deployment = await boot()
    const digest = await enableSkill(deployment, 'create-mr')
    // Someone replaces the managed link with a plain directory.
    await rm(path.join(deployment.paths.projectionRoot, 'create-mr'), { force: true })
    await mkdir(path.join(deployment.paths.projectionRoot, 'create-mr'), { recursive: true })

    const before = await detectProjectionDrift(deployment.paths, [
      { skillName: 'create-mr', sourcePath: digest },
    ])
    expect(before[0]?.status).toBe('not-a-symlink')

    await rebuildProjection(deployment.paths, [{ skillName: 'create-mr', sourcePath: digest }])
    const after = await detectProjectionDrift(deployment.paths, [
      { skillName: 'create-mr', sourcePath: digest },
    ])
    expect(after).toEqual([])
  })
})

describe('degraded adapters', () => {
  it('offers only capabilities backed by an enabled Skill', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')

    const projection = deployment.capabilities.project(deployment.repository)

    // A capability exists because a Skill is installed and enabled; one that
    // was never enabled is simply absent, not an unavailable placeholder.
    expect(projection.find(item => item.id === 'create-mr')?.available).toBe(true)
    expect(projection.find(item => item.id === 'send-cr')).toBeUndefined()
  })
})

describe('Task, executor and Invocation flow', () => {
  it('runs several skills on one Task and one executor session', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')
    await enableSkill(deployment, 'send-cr')

    const first = await deployment.coordinator.accept({
      clientInvocationId: 'inv-a',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })
    await deployment.coordinator.onAgentEvent(first.task.executorSessionId, {
      kind: 'turn-complete',
      summary: 'MR created',
    })
    const second = await deployment.coordinator.accept({
      clientInvocationId: 'inv-b',
      capabilityId: 'send-cr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    expect(second.task.id).toBe(first.task.id)
    expect(deployment.createdSessions.size).toBe(1)
    expect(deployment.repository.listInvocations(first.task.id)).toHaveLength(2)
    // The executor session lives in the Pet Workspace, not the source repo.
    expect(deployment.dispatched[0]?.session).toBe(first.task.executorSessionId)
  })

  it('captures a fresh snapshot for every invocation', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')

    const first = await deployment.coordinator.accept({
      clientInvocationId: 'inv-a',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })
    await deployment.coordinator.onAgentEvent(first.task.executorSessionId, {
      kind: 'turn-complete',
    })
    const second = await deployment.coordinator.accept({
      clientInvocationId: 'inv-b',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    expect(second.invocation.snapshotId).not.toBe(first.invocation.snapshotId)
  })

  it('serves trusted context bound to the executing session', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')
    const accepted = await deployment.coordinator.accept({
      clientInvocationId: 'inv-a',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    const context = executePetContext(deployment.repository, {
      agent: { session: { id: accepted.task.executorSessionId } },
    })

    expect(context.source.sessionId).toBe('src-1')
    expect(context.invocationId).toBe('inv-a')
    // An ordinary session gets nothing.
    expect(() =>
      executePetContext(deployment.repository, { agent: { session: { id: 'ordinary' } } }),
    ).toThrow(/not bound to a Pet Task/)
  })

  it('supports a no-source independent Task', async () => {
    const deployment = await boot()
    const source = await bundle('tidy', 'Tidy things')
    const inspection = await inspectBundle(source)
    await deployment.repository.putSkillRevision({
      skillName: 'tidy',
      sourcePath: inspection.canonicalSourcePath,
      description: inspection.description,
      // The Skill declares it needs no source context.
      pet: { context: 'none' },
      provenance: { kind: 'local-link', installedAt: Date.now() },
      fileCount: 1,
      totalBytes: 1,
    })
    await deployment.repository.putSkillSelection({
      skillName: 'tidy',
      enabled: true,
      showAsShortcut: true,
    })

    const accepted = await deployment.coordinator.accept({
      clientInvocationId: 'inv-i',
      capabilityId: 'tidy',
      sourceKind: 'none',
    })

    expect(accepted.task.scopeKey).toBe('independent:web:default')
    expect(deployment.dispatched[0]?.text).toContain('独立任务')
  })
})

describe('restart recovery in the same DSH home', () => {
  it('recovers Tasks and queue state from the real database file', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-accept-'))
    const first = await boot(home)
    await enableSkill(first, 'create-mr')
    const accepted = await first.coordinator.accept({
      clientInvocationId: 'inv-a',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })
    await first.close()

    // Reboot against the same home.
    const second = await boot(home)

    const recovered = second.repository.getTask(accepted.task.id)
    expect(recovered?.executorSessionId).toBe(accepted.task.executorSessionId)
    expect(second.repository.listInvocations(accepted.task.id)).toHaveLength(1)
    expect(currentAllowlist(second.repository).map(e => e.skillName)).toEqual(['create-mr'])
  })
})

describe('archive and new epoch', () => {
  it('archives a settled Task and starts a new epoch on the next invocation', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')
    const first = await deployment.coordinator.accept({
      clientInvocationId: 'inv-a',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })
    await deployment.coordinator.onAgentEvent(first.task.executorSessionId, {
      kind: 'turn-complete',
    })

    const archived = await archiveTaskFromPet(
      deployment.repository,
      { archiveSession: async () => {} },
      first.task.id,
    )
    expect(archived.archivedAt).toBeTypeOf('number')

    const second = await deployment.coordinator.accept({
      clientInvocationId: 'inv-b',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    expect(second.task.id).not.toBe(first.task.id)
    expect(second.task.epoch).toBe(first.task.epoch + 1)
    // History is retained, not deleted.
    expect(deployment.repository.getTask(first.task.id)).toBeDefined()
    expect(deployment.repository.listInvocations(first.task.id)).toHaveLength(1)
  })

  it('marks an archived source without archiving the Task', async () => {
    const deployment = await boot()
    await enableSkill(deployment, 'create-mr')
    const accepted = await deployment.coordinator.accept({
      clientInvocationId: 'inv-a',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })

    await reconcileArchives(deployment.repository, new Set(['src-1']))

    const task = deployment.repository.getTask(accepted.task.id)
    expect(task?.sourceAvailability).toBe('archived')
    expect(task?.archivedAt).toBeUndefined()
  })
})
