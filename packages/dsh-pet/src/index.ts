/**
 * DSH Pet Host entry.
 *
 * `apply` stays registration-only: the Pet Host runs as a service inside the
 * existing `dsh web` Node process, so any synchronous throw here would abort
 * unrelated DSH capabilities. Every fallible asynchronous initialization step
 * is contained by the lifecycle machine and degrades Pet alone.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { reconcileArchives, registerArchiveObserver, type ArchiveSink } from './host/archive.js'
import { verifyBackendOwnership, verifyDatabaseLocation } from './host/backend.js'
import { PetChangeFeed } from './host/changes.js'
import { CapabilityRegistry } from './host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from './host/capture.js'
import { PetCoordinator, type PromptDispatcher } from './host/coordinator.js'
import {
  reconcileCreatingExecutors,
  validateModelSelection,
  type AgentRegistryLike,
  type PetModelSelection,
} from './host/executor.js'
import { PetError } from './host/errors.js'
import { PetLifecycleMachine } from './host/lifecycle.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from './host/paths.js'
import { rebuildProjection } from './host/projection.js'
import { PetRepository } from './host/repository.js'
import { createPetRoutes } from './host/routes.js'
import { createPetSkillProvider, resolveInvocationSkill } from './host/skill-provider.js'
import { createWorktreeProvider } from './host/worktree-adapter.js'
import { loadWorktreeStatus } from './host/worktree-status.js'
import { registerPetTools } from './host/tools.js'
import { currentAllowlist } from './host/skill-provider.js'
import { removeLegacyState } from './host/migrate.js'
import { petDomainSpec } from './host/spec.js'
import {
  ensurePetWorkspace,
  inspectWorkspace,
  repairWorkspace,
} from './host/workspace.js'

export const name = 'dsh-pet'

/**
 * Preset composing a Pet executor WITHOUT local-root Skill discovery.
 *
 * `standard` loads `skill-filesystem`, which would make every globally
 * installed Skill visible to the executor. Pet's scoped provider is additive
 * and cannot subtract it, so exclusion has to happen in the preset.
 */
export const PET_EXECUTOR_PRESET = 'dsh-pet-executor'

export const inject = [
  // `storage` is required in addition to `storageDomain`: the backend
  // ownership proof reads the hub's backend registry directly, and cordis
  // denies property access to a service that is not declared here.
  'storage',
  'storageDomain',
  'workspaceRegistry',
  'sessions',
  // Renaming the executor is a visible projection only; a missing service
  // would break Agent creation, so it is declared like every other inject.
  'sessionTitle',
  // Provider routability is proven before an executor is created.
  'llm',
  // Pet executors follow the Host's default model instead of a private copy.
  'agentDefaultModel',
  // Enumerates the presets offered for Pet executors.
  'agentPresets',
  'agents',
  'tools',
  'skills',
  'webServer',
]

/** Pet Host plugin configuration. */
export interface Config {
  /** Explicit DSH home override; defaults to the ambient harness home. */
  readonly home?: string
  /** Package version recorded as built-in provenance. */
  readonly version?: string
}

/**
 * Register the Pet Host.
 *
 * Contract: this function performs no fallible I/O. It registers lifecycle
 * effects and hands the real initialization to a contained async task, so a
 * Pet failure never prevents ordinary DSH services from loading.
 * @param ctx - Plugin context.
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const lifecycle = new PetLifecycleMachine()
  const paths = resolvePetPaths(config.home)

  ctx.effect(() => () => {
    lifecycle.markStopping()
  }, 'dsh-pet: contained Host lifecycle')

  // Fire-and-forget by design: a rejected initialization degrades Pet through
  // the lifecycle machine instead of rejecting the Host's plugin apply.
  void initialize(ctx, lifecycle, paths, config).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    lifecycle.markDegraded(`Pet initialization failed: ${reason}`)
    ctx.logger.warn(`dsh-pet degraded: ${reason}`)
  })
}

/**
 * Contained Pet initialization.
 *
 * Order is deliberate: directories, then storage ownership, then the durable
 * domain, then Workspace/Skill materialization, then reconciliation, and only
 * then are routes exposed and Pet marked ready.
 * @param ctx - Plugin context.
 * @param lifecycle - The Host lifecycle machine.
 * @param paths - Resolved Pet runtime paths.
 * @param config - Plugin configuration.
 * @returns resolution once Pet is ready or degraded.
 */
async function initialize(
  ctx: Context,
  lifecycle: PetLifecycleMachine,
  paths: PetPaths,
  config: Config,
): Promise<void> {
  const directories = await lifecycle.contain('Pet state directories', async () => {
    await ensurePetDirectories(paths)
    return true
  })
  if (directories === undefined) return

  // Ownership before records: routing is by backend NAME, so a foreign
  // composition owning `sqlite` would silently capture Pet's data.
  const ownership = await verifyBackendOwnership(ctx, paths)
  if (!ownership.ok) {
    lifecycle.markDegraded(ownership.diagnostic ?? 'Pet storage backend ownership unproven')
    return
  }

  // Clear state written by the previous Skill model BEFORE opening: the
  // domain validates every stored record up front, so one legacy row would
  // fail the open and degrade a Host that used to work.
  const cleanup = await lifecycle.contain('Pet legacy state cleanup', async () =>
    removeLegacyState(paths.databaseFile),
  )
  if (cleanup !== undefined && cleanup.removedRows > 0) {
    ctx.logger.info(
      `dsh-pet cleared ${cleanup.removedRows} row(s) from the previous Skill model ` +
        `(${cleanup.clearedTables.join(', ')}); re-add the Skills you want`,
    )
  }

  const domain = await lifecycle.contain('Pet storage domain', () =>
    ctx.storageDomain.open(petDomainSpec),
  )
  if (domain === undefined) return


  // Force one durable write so the lazily materialized SQLite file exists,
  // then prove it landed at Pet's configured path rather than a foreign one.
  const location = await verifyDatabaseLocation(paths, async () => {
    await domain.global.set(domain.global.get())
  })
  if (!location.ok) {
    await domain.close()
    lifecycle.markDegraded(location.diagnostic ?? 'Pet database location unproven')
    return
  }
  ctx.effect(() => () => {
    void domain.close()
  }, 'dsh-pet: close durable domain')

  const repository = new PetRepository(domain)

  const workspaceId = await lifecycle.contain('Pet Workspace', () =>
    ensurePetWorkspace(ctx.workspaceRegistry as never, paths),
  )
  if (workspaceId === undefined) return
  if (repository.global.workspaceId !== workspaceId) {
    await repository.updateGlobal(current => ({ ...current, workspaceId }))
  }

  const version = config.version ?? '0.1.0'

  // Republish the managed projection so a drifted or stale link is repaired
  // before any Invocation can resolve a Skill through it.
  await lifecycle.contain('Pet Skill projection', () =>
    rebuildProjection(
      paths,
      currentAllowlist(repository).map(entry => ({
        skillName: entry.skillName,
        sourcePath: entry.sourcePath,
      })),
    ),
  )

  // Prove uncertain Tasks before accepting new work.
  await lifecycle.contain('Pet restart reconciliation', () =>
    reconcileCreatingExecutors(
      repository,
      sessionId => ctx.agents.get(sessionId as never) !== undefined,
    ),
  )

  // Account every live executor to the Pet Workspace. Attaching only at
  // creation leaves behind any executor made before this existed, plus any
  // whose attach failed — they keep working but never appear under DSH Pet.
  await lifecycle.contain('Pet workspace accounting', async () => {
    const workspace = ctx.workspaceRegistry.get(workspaceId as never)
    if (workspace === undefined) return
    for (const task of repository.listTasks()) {
      if (task.archivedAt !== undefined) continue
      const sessionId = task.executorSessionId
      if (sessionId === undefined) continue
      // `attachSession` is idempotent for an already-accounted session, and a
      // failure here must not block startup: mis-filing in the sidebar is
      // cosmetic next to refusing to serve the Task at all.
      await workspace.attachSession(sessionId as never).catch(() => undefined)
    }
  })

  // Compare stored archive state against the durable archived set before any
  // new Invocation is accepted.
  await lifecycle.contain('Pet archive reconciliation', () =>
    reconcileArchives(
      repository,
      new Set(
        (ctx.workspaceRegistry.archivedSessionIds as readonly string[]).map(id => String(id)),
      ),
    ),
  )

  const changes = new PetChangeFeed()

  // Archiving a terminal Task from Pet syncs its executor session; DSH
  // exposes archive but no unarchive, so this stays one-way by design.
  const archiveSink: ArchiveSink = {
    archiveSession: async sessionId => {
      await ctx.workspaceRegistry.archiveSession(sessionId as never)
    },
  }

  // Live archive edges, not just the startup snapshot: a user archiving an
  // executor natively must be reflected without waiting for a restart.
  ctx.effect(
    () => registerArchiveObserver(ctx, repository, archiveSink),
    'dsh-pet: observe durable archive lifecycle',
  )

  const capabilities = new CapabilityRegistry()

  // Pet tools are registered on the Host context so Pet executor Agents can
  // reach them; both resolve their target from the calling session.
  ctx.effect(
    () => registerPetTools(ctx, { repository }),
    'dsh-pet: caller-bound Agent tools',
  )

  /**
   * Scope every Pet executor Agent at creation time.
   *
   * Registering the allowlist provider on the AGENT context (not the Host
   * context) is what makes Pet's isolation real: only Pet executors see it,
   * and they see exactly the explicitly enabled revisions. The registration
   * happens inside `setup`, which the factory awaits before the session and
   * agent are published, so it exists before the first prompt is assembled.
   */
  const executorSetup = (agentCtx: unknown): void => {
    const scoped = agentCtx as Context
    // The agent context is a FRESH fiber: it does not inherit this plugin's
    // inject grants, so reading `scoped.skills` directly throws
    // `cannot get property "skills" without inject`. `ctx.inject` declares the
    // dependency for the callback body, which is where the registration runs.
    //
    // `registerProvider` (a factory receiving the registration control) — NOT
    // `register`, which contributes one single runtime skill. Registering from
    // the SCOPED agent context is what confines the allowlist to Pet executors
    // instead of publishing it globally.
    scoped.inject(['skills'], skillCtx => {
      skillCtx.effect(
        () =>
          skillCtx.skills.registerProvider(() => createPetSkillProvider(repository, paths)),
        'dsh-pet: scoped allowlist Skill provider',
      )
    })
  }
  const contextProviders = new SourceContextRegistry()

  // Optional Worktree Session enrichment: snapshot context only, no effects.
  const maintenance = await loadWorktreeStatus()

  // Optional Worktree Session enrichment. Without it a snapshot simply
  // carries no managed-worktree fields; Pet must never infer an execution
  // root from `cwd`, which stays at the repository root by design.
  if (maintenance !== undefined) {
    ctx.effect(
      () =>
        contextProviders.register(
          createWorktreeProvider({
            sessionStatus: async sessionId => {
              const session = ctx.sessions.get(sessionId as never)
              const repoPath = session?.header.cwd
              if (repoPath === undefined) return undefined
              return maintenance.wsStatus({ sessionId, repoPath }).then(
                status => ({
                  bound: true,
                  worktreePath: status.worktreePath,
                  taskBranch: status.taskBranch,
                  dependencyMode: status.dependencyMode,
                  lifecycle: status.phase,
                }),
                // An unbound session is a normal answer, not a provider fault.
                () => undefined,
              )
            },
          }),
        ),
      'dsh-pet: worktree source context provider',
    )
  }

  const resolver: SourceResolver = {
    getSession: sessionId => {
      const session = ctx.sessions.get(sessionId as never)
      if (session === undefined) return undefined
      // Titles are not on the header: DSH records them as log-only
      // `session/title` events, so the latest one is the durable title.
      const title = latestSessionTitle(session.events)
      return {
        id: sessionId,
        ...(title !== undefined ? { title } : {}),
        ...(session.header.cwd !== undefined ? { cwd: session.header.cwd } : {}),
        asOfSeq: session.events.length,
      }
    },
    getWorkspace: workspace => {
      const found = ctx.workspaceRegistry
        .list()
        .find((item: { id: string }) => item.id === workspace)
      if (found === undefined) return undefined
      return {
        id: found.id,
        ...(found.title !== undefined ? { title: found.title } : {}),
        ...(found.path !== undefined ? { path: found.path } : {}),
      }
    },
  }

  const dispatcher: PromptDispatcher = {
    dispatch: async (executorSessionId, text) => {
      const handle = ctx.agents.get(executorSessionId as never)
      if (handle === undefined) {
        throw new PetError(
          'INTERNAL',
          `Pet executor session ${executorSessionId} is not live`,
        )
      }
      // The ordinary DSH lifecycle: submit a normal user message through
      // `followup`, which is synchronous and void, then flush by awaiting the
      // agent's idle boundary. `followup` takes a UserMessage — never a raw
      // string — so the envelope rides the same path a native client uses and
      // the Skill pre-step sees the leading `/skill-name` token.
      const agent = (handle as { agent?: unknown }).agent ?? handle
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      ;(agent as { followup(input: unknown): void }).followup(message)
      const idle = (agent as { whenIdle?: () => Promise<void> }).whenIdle
      if (typeof idle === 'function') await idle.call(agent)
    },
  }

  const selection = (): PetModelSelection => {
    // FOLLOW DSH: an executor is an ordinary Agent, so it uses the Host's own
    // default model rather than a Pet-private copy the user has to maintain.
    // Read live on every Invocation — changing the DSH default takes effect
    // immediately, with no Pet-side migration or restart.
    const current = ctx.agentDefaultModel.currentSelection()

    // Still prove the provider is routable in THIS Host before creating an
    // executor. Pet never silently falls back to another provider, because a
    // different model could produce different side effects.
    // `LlmProviderInfo` carries only `id`/`name`, so validation is
    // provider-level; an unknown model surfaces at generation time.
    return validateModelSelection(
      { listProviders: () => ctx.llm.listProviders().map(item => ({ id: item.id })) },
      {
        providerId: current.provider,
        modelId: current.model,
        // The Pet agent preset stays Pet-owned: it selects the executor's
        // composition, not the model.
        //
        // Defaults to the Pet executor preset, which omits `skill-filesystem`.
        // On `standard` the executor would inherit local-root Skill discovery
        // and every globally installed Skill would be visible to it — a scoped
        // provider is additive and cannot subtract one the preset brought in.
        agentPreset: repository.global.agentPreset ?? PET_EXECUTOR_PRESET,
      },
    )
  }

  const coordinator = new PetCoordinator({
    repository,
    capabilities,
    agents: ctx.agents as unknown as AgentRegistryLike,
    dispatcher,
    resolver,
    contextProviders,
    workspacePath: paths.workspaceRoot,
    // Self-heal at the moment a session needs the Workspace: preparation runs
    // once at boot, so anything deleted or left stale afterwards would
    // otherwise persist until the next restart.
    // Account each executor to the Pet Workspace. Creating it with the right
    // `cwd` is not enough: DSH accounts sessions explicitly, so without this
    // the executor never appears under DSH Pet in the sidebar.
    attachToWorkspace: async sessionId => {
      const workspace = ctx.workspaceRegistry.get(workspaceId as never)
      await workspace?.attachSession(sessionId as never)
    },
    ensureWorkspace: async () => {
      const health = await inspectWorkspace(paths)
      if (health.ok) return []
      return (await repairWorkspace(paths)).problems
    },
    selection,
    executorSetup,
    verifySkill: async skillName => {
      // Throws SKILL_NOT_FOUND / SKILL_DISABLED. A registered Skill is the
      // user's own directory, so this proves it is still registered, enabled
      // and readable — not that its contents are unchanged.
      await resolveInvocationSkill(repository, paths, skillName)
    },
    renameExecutor: (executorSessionId, title) => {
      const session = ctx.sessions.get(executorSessionId as never)
      if (session === undefined) return
      ctx.sessionTitle.rename(session, title)
    },
  })

  // Project Task/Invocation state from the durable session event firehose.
  // Without this nothing ever settles an Invocation: it would stay `running`
  // forever even after its turn completed.
  ctx.effect(
    () =>
      ctx.on('session/event', (session: { id: unknown }, event: { type: string; data?: unknown }) => {
        const executorSessionId = String(session.id)
        if (repository.findTaskByExecutor(executorSessionId) === undefined) return

        if (event.type === 'turn/start') {
          void coordinator.onAgentEvent(executorSessionId, { kind: 'turn-start' })
          return
        }
        // An approval request blocks the turn on the user. Project it so the
        // panel shows `waiting-user` instead of an opaque `running`, and so a
        // queued Invocation is not started behind work that is actually
        // waiting. The decision resumes execution.
        if (event.type === 'approval/asked') {
          void coordinator.onAgentEvent(executorSessionId, { kind: 'waiting-user' })
          return
        }
        if (event.type === 'approval/decided') {
          void coordinator.onAgentEvent(executorSessionId, { kind: 'turn-start' })
          return
        }
        if (event.type !== 'turn/end') return

        const reason = (event.data as { reason?: { kind?: string; error?: { message?: string } } })
          ?.reason
        switch (reason?.kind) {
          case 'completed':
            void coordinator.onAgentEvent(executorSessionId, { kind: 'turn-complete' })
            return
          case 'aborted':
            void coordinator.onAgentEvent(executorSessionId, { kind: 'cancelled' })
            return
          default:
            // `failed`, `blocked` and any future reason settle as a failure
            // rather than leaving the Invocation running forever.
            void coordinator.onAgentEvent(executorSessionId, {
              kind: 'turn-error',
              message: reason?.error?.message ?? `turn ended: ${reason?.kind ?? 'unknown'}`,
            })
        }
      }),
    'dsh-pet: project Invocation state from session events',
  )

  for (const route of createPetRoutes({
    repository,
    capabilities,
    coordinator,
    lifecycle,
    paths,
    packageVersion: version,
    changes,
    archiveSink,
    inspectWorkspace: () => inspectWorkspace(paths),
    repairWorkspace: () => repairWorkspace(paths),
    listPresets: async () => {
      // Enumerate what this Host actually offers; a free-text preset name
      // could name a composition that does not exist.
      const presets = await ctx.agentPresets.list()
      return presets.map(preset => ({ id: preset.id, label: preset.name ?? preset.id }))
    },
    followedModel: () => {
      try {
        const current = ctx.agentDefaultModel.currentSelection()
        return { providerId: current.provider, modelId: current.model }
      } catch {
        // Display-only: never fail reading config because the default model
        // could not be resolved.
        return undefined
      }
    },
  })) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }),
      `dsh-pet: ${route.path}`,
    )
  }

  lifecycle.markReady()
  ctx.logger.info(`dsh-pet ready (state: ${paths.stateRoot})`)
}

/**
 * Read the latest durable session title from a session's event log.
 *
 * DSH stores titles as log-only `session/title` events rather than header
 * fields, so the most recent such event is the current title. An unrecognized
 * event shape yields no title instead of a guess.
 * @param events - The session's event log.
 * @returns the latest title, or `undefined` when none was recorded.
 */
export function latestSessionTitle(events: readonly unknown[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as { type?: string; data?: { title?: unknown } } | undefined
    if (event?.type !== 'session/title') continue
    const title = event.data?.title
    if (typeof title === 'string' && title.trim() !== '') return title
  }
  return undefined
}

export * from './wire.js'
export { PetLifecycleMachine } from './host/lifecycle.js'
export { PetChangeFeed } from './host/changes.js'
export { reconcileArchives, archiveTaskFromPet } from './host/archive.js'
export { PetRepository } from './host/repository.js'
export { PetError } from './host/errors.js'
export { PetCoordinator } from './host/coordinator.js'
export { CapabilityRegistry } from './host/capabilities.js'
export { SourceContextRegistry, resolveTrustedContext } from './host/capture.js'
export { executePetContext, PET_CONTEXT_TOOL } from './host/context-tool.js'
export { createWorktreeProvider } from './host/worktree-adapter.js'
export { resolvePetPaths, ensurePetDirectories, isContainedBy } from './host/paths.js'
export { petDomainSpec, PET_DOMAIN_NAME, PET_DOMAIN_VERSION } from './host/spec.js'
export { inspectBundle, BUNDLE_LIMITS } from './host/skill-bundle.js'
export {
  rebuildProjection,
  detectProjectionDrift,
  inspectProjectionEntry,
} from './host/projection.js'
export { createPetSkillProvider, currentAllowlist } from './host/skill-provider.js'
