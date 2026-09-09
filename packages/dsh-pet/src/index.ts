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
import { ChannelService } from './host/channel/service.js'
import { createLarkCliClient } from './host/channel/lark.js'
import { createQaGroup } from './host/qa/action.js'
import { bindExistingGroup, unbindGroup } from './host/qa/bind.js'
import { renderBindReceipt, renderUnbindReceipt } from './host/qa/bind-receipt.js'
import { QaDelivery } from './host/qa/delivery.js'
import { probeSubagentSeam, type HostContextLike } from './host/qa/subagents.js'
import { createPetRoutes } from './host/routes.js'
import { createPetEnvContributor } from './host/shell-env.js'
import { createPetSkillProvider, resolveInvocationSkill } from './host/skill-provider.js'
import { createWorktreeProvider } from './host/worktree-adapter.js'
import { loadWorktreeStatus } from './host/worktree-status.js'
import { registerPetTools } from './host/tools.js'
import { currentAllowlist } from './host/skill-provider.js'
import { removeLegacyState } from './host/migrate.js'
import { petDomainSpec } from './host/spec.js'
import {
  isForkChildTaskForm,
  PET_EXECUTOR_PRESET,
  QA_GROUP_ACTION_ID,
  STANDARD_PRESET,
} from './wire.js'
import {
  ensurePetWorkspace,
  inspectWorkspace,
  repairWorkspace,
} from './host/workspace.js'

export const name = 'dsh-pet'


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

  // Heal a stored blank preset. Sessions created while it was set fail to
  // resume with `preset "" not found`, and the value is invisible in the
  // panel, so a user cannot clear it themselves.
  if (repository.global.agentPreset?.trim() === '') {
    await repository.updateGlobal(current => {
      const { agentPreset: _blank, ...rest } = current
      return rest
    })
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
      // Both `agents.get` and `sessions.get` mean LOADED, and nothing is
      // loaded at startup — either check would report every session as gone
      // and condemn healthy Tasks. The workspace's session account is the
      // durable record, so ask that instead.
      sessionId => {
        const workspace = ctx.workspaceRegistry.get(workspaceId as never)
        const accounted = (workspace?.sessionIds ?? []) as readonly unknown[]
        return accounted.some(id => String(id) === sessionId)
      },
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
  //
  // The probe extends the set comparison with DELETION: a session can be gone
  // from disk without ever having been archived, and without this a Task
  // bound to it sat in `recovering` forever. `observeSession` reads persisted
  // state, so it is the check that separates this from a merely unloaded
  // session — verified against the actual failure (send-cr: three executors
  // absent from both disk and the archive ledger). Probing is best-effort:
  // a transient probe failure keeps the Task active rather than destroying
  // it on a flaky service.
  const probeExecutor = async (sessionId: string): Promise<boolean | 'unknown'> => {
    const query = ctx.get('sessionQuery') as
      | {
          observeSession(
            id: string,
            options: { projectionMode: 'all' },
          ): Promise<{ [Symbol.dispose]?: () => void }>
        }
      | undefined
    // `sessionQuery` is an injectable service, and this plugin does NOT
    // declare it (it is probed lazily on purpose). At Pet's own startup step
    // the service may not be registered yet — the plugins offering it load in
    // the same startup wave. Treating that as "session exists" (the previous
    // `undefined → true`) skipped EVERY task during the startup reconciliation
    // and the miss was never revisited: the delete-only observer only re-runs
    // on archive changes. Treating it as "gone" would destroy live tasks on an
    // early service hole. The honest answer is "unknown": the probe reports
    // that, and the caller retries rather than deciding.
    if (query === undefined) return 'unknown'
    try {
      const observation = await query.observeSession(sessionId, { projectionMode: 'all' })
      observation[Symbol.dispose]?.()
      return true
    } catch {
      return false
    }
  }
  // Startup reconciliation. A probe that returns `unknown` means the
  // sessionQuery service was not registered yet — the plugins offering it
  // load in the same startup wave — so this run concluded nothing; schedule
  // one retry after the wave settles, then give up (a still-unknown result at
  // that point keeps the Task active rather than guessing either way).
  const reconcileOnce = async (): Promise<boolean> => {
    const outcomes = await reconcileArchives(
      repository,
      new Set(
        (ctx.workspaceRegistry.archivedSessionIds as readonly string[]).map(id => String(id)),
      ),
      probeExecutor,
    )
    return outcomes.some(outcome => outcome.action === 'probe-unknown')
  }
  const reconcileTimers: ReturnType<typeof setTimeout>[] = []
  const scheduleReconcileRetry = (): void => {
    // The service registration has settled by then in practice, but a bounded
    // timer keeps this from looping forever on a host that never registers
    // the service. A still-unknown result at that point leaves the Task
    // active rather than guessing either way.
    reconcileTimers.push(setTimeout(() => void reconcileOnce(), 15_000))
  }
  await lifecycle.contain('Pet archive reconciliation', async () => {
    const indeterminate = await reconcileOnce()
    if (indeterminate) scheduleReconcileRetry()
  })

  const changes = new PetChangeFeed()

  // Archiving a terminal Task from Pet syncs its executor session; DSH
  // exposes archive but no unarchive, so this stays one-way by design.
  const archiveSink: ArchiveSink = {
    archiveSession: async sessionId => {
      await ctx.workspaceRegistry.archiveSession(sessionId as never)
    },
  }

  // Live archive edges, not just the startup snapshot: a user archiving an
  // executor natively must be reflected without waiting for a restart. The
  // same probe as startup reconciliation runs on every edge, so a DELETED
  // executor is also settled live — not just on the next restart.
  ctx.effect(
    () =>
      registerArchiveObserver(
        ctx,
        repository,
        archiveSink,
        probeExecutor,
        // Same bounded retry as startup: an edge arriving while the probing
        // service is still registering must not produce a permanent miss.
        scheduleReconcileRetry,
      ),
    'dsh-pet: observe durable archive lifecycle',
  )

  const capabilities = new CapabilityRegistry()

  // Publish configured values as ordinary `DSH_PET_*` variables on every shell
  // call an executor makes. Deliberately OPTIONAL: a Host without the
  // shell-env registry injects nothing and a Skill needing a value reports it
  // missing, which is far better than degrading all of Pet over this.
  // `ctx.get` rather than `ctx.shellEnv`: cordis guards property access and
  // throws `cannot get property "shellEnv" without inject` for a service this
  // plugin does not declare, which would abort initialization instead of
  // degrading. `get` returns `undefined` for an absent service.
  const shellEnv = ctx.get('shellEnv') as
    | { register(contributor: never): () => void }
    | undefined
  if (shellEnv === undefined) {
    ctx.logger.info('dsh-pet: shellEnv unavailable; DSH_PET_* variables are not injected')
  } else {
    // Called DIRECTLY, not wrapped in `ctx.effect`. `register` already runs
    // inside its own effect and owns its disposal, so an extra wrapper only
    // adds a way to run it twice — and the second call throws
    // `contributor "..." is already registered`, which aborts the rest of Pet's
    // initialization. That is how the executor ended up with five tools and no
    // `bash`. Registration failure must never cost Pet its Agent tools, so the
    // call is additionally contained.
    try {
      shellEnv.register(createPetEnvContributor(repository) as never)
    } catch (error) {
      ctx.logger.warn(
        `dsh-pet: DSH_PET_* injection unavailable (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }
  }

  /**
   * Agent contexts already carrying the Pet composition.
   *
   * The SAME executor Agent can be offered this composition more than once:
   * Pet installs it through `setup`, and the `agent/created` observer below
   * covers agents Pet did not start. A second registration of the same tool
   * name throws `tool "..." is already registered in this scope`, so this set
   * is the deduplication — deliberately an explicit marker rather than a
   * swallowed exception, because that is precisely how the `shellEnv` incident
   * cost the executor its `bash` tool.
   *
   * Weak so a disposed Agent's context does not pin memory here.
   */
  const composedAgents = new WeakSet<object>()
  const allowlistAgents = new WeakSet<object>()
  const contextToolAgents = new WeakSet<object>()

  /** Install the Pet-owned scoped surface on one live executor Agent.
   *
   * Every Pet Task executor receives `pet_context`. Only the dedicated Pet
   * executor form also receives the allowlist Skill provider; a
   * workspace-resident executor deliberately uses its workspace's Skills.
   * The marker makes repeated installation idempotent without swallowing a
   * duplicate-registration error.
   */
  const installPetScope = (agentCtx: unknown, includeAllowlist: boolean): void => {
    const scoped = agentCtx as Context
    const key = scoped as unknown as object
    if (composedAgents.has(key)) return

    // Agent contexts are fresh fibers and do not inherit this plugin's inject
    // grants, so each scoped registration declares its dependency locally.
    // Mark each component only after its registration succeeds: a partial
    // failure can then be retried without duplicating the component that
    // already exists.
    if (includeAllowlist && !allowlistAgents.has(key)) {
      scoped.inject(['skills'], skillCtx => {
        skillCtx.effect(
          () =>
            skillCtx.skills.registerProvider(() => createPetSkillProvider(repository, paths)),
          'dsh-pet: scoped allowlist Skill provider',
        )
        allowlistAgents.add(key)
      })
    }

    // `tools.register()` chooses its layer from the CALLING context's scope
    // tag. Calling it on the Host silently publishes globally, which is the
    // original leak this change fixes.
    if (!contextToolAgents.has(key)) {
      scoped.inject(['tools'], toolCtx => {
        toolCtx.effect(
          () => registerPetTools(toolCtx, { repository }),
          'dsh-pet: scoped caller-bound Agent tools',
        )
        contextToolAgents.add(key)
      })
    }
    if (!contextToolAgents.has(key) || (includeAllowlist && !allowlistAgents.has(key))) {
      throw new PetError('INTERNAL', 'Pet scoped surface dependencies were not installed')
    }
    composedAgents.add(key)
  }

  /** Mount the selected preset, then install the Pet-owned scoped surface.
   *
   * `meta.agentPreset` only records a name; actual composition requires
   * `agentPresets.mount` inside setup. Preset mounting must happen before
   * scoped providers are registered (see the integration pitfalls note).
   */
  const executorSetup = async (
    agentCtx: unknown,
    presetId: string | undefined,
    includeAllowlist: boolean,
  ): Promise<void> => {
    const scoped = agentCtx as Context
    await ctx.agentPresets.mount(scoped as never, presetId as never)
    installPetScope(scoped, includeAllowlist)
  }

  /** Whether an Agent already carries the Pet-owned scoped surface. */
  const isComposed = (agent: unknown): boolean => {
    const agentCtx = (agent as { ctx?: unknown } | undefined)?.ctx
    return agentCtx !== undefined && composedAgents.has(agentCtx as object)
  }

  /**
   * Scope an executor loaded by DSH itself without mounting its preset again.
   * The native session controller already mounted the persisted preset before
   * publication; Pet only contributes `pet_context` and, for non-resident
   * Tasks, its allowlist provider. Listener failures are contained because a
   * synchronous throw from `agent/created` would veto publication.
   */
  const composeForeignExecutor = (agent: unknown): void => {
    const view = agent as { session?: { id?: unknown }; ctx?: unknown } | undefined
    const sessionId = view?.session?.id
    if (sessionId === undefined || view?.ctx === undefined) return
    const task = repository.findTaskByExecutor(String(sessionId))
    if (task === undefined || composedAgents.has(view.ctx as object)) return
    // A `qa-chat` Task's "executor" is a fork CHILD of a user session, not a
    // Pet root executor: it is composed and driven by DSH's subagent
    // machinery, and its whole reason to exist is the tool surface it
    // INHERITED from its parent. Pet must contribute nothing to it.
    //
    // This listener fires for every agent DSH publishes, and a QA child's
    // session id is stored as `executorSessionId`, so without this guard the
    // lookup above matched and Pet installed its scoped surface on the child:
    //
    // - `pet_context` became visible, so the model called it as instructed and
    //   got `NO_CURRENT_INVOCATION` ("has no running or waiting Invocation") —
    //   QA delivery queues a child turn directly and never creates an
    //   Invocation record, so that lookup can never succeed for this form.
    // - worse, a QA Task carries no `residentWorkspaceId` (always for `/bind`,
    //   and whenever the source session is unfiled), so `includeAllowlist` was
    //   true and the Pet allowlist provider REPLACED the child's inherited
    //   Skill catalog — the exact boundary the spec forbids Pet to impose on
    //   this form.
    if (isForkChildTaskForm(task.sourceKind)) return
    try {
      installPetScope(view.ctx, task.residentWorkspaceId === undefined)
    } catch (error) {
      ctx.logger.warn(
        `dsh-pet: could not scope externally loaded executor ${String(sessionId)} (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }
  }

  ctx.effect(
    () =>
      ctx.on('agent/created', (payload: { agent?: unknown }) => {
        composeForeignExecutor(payload?.agent)
      }),
    'dsh-pet: scope externally loaded executors',
  )
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
      // 0.1.2 removed `Session.events`; `snapshotEvents()` is the immutable
      // full-log read and `seq` is the next-event watermark (= log length).
      const title = latestSessionTitle(session.snapshotEvents())
      return {
        id: sessionId,
        ...(title !== undefined ? { title } : {}),
        ...(session.header.cwd !== undefined ? { cwd: session.header.cwd } : {}),
        asOfSeq: session.seq,
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
        // Treat blank as unset, not as a preset name. `??` only catches
        // `undefined`, so an empty string — written by the removed "默认组合"
        // option — reached DSH verbatim and failed session resume with
        // `preset "" not found`.
        agentPreset:
          repository.global.agentPreset === undefined ||
          repository.global.agentPreset.trim() === ''
            ? PET_EXECUTOR_PRESET
            : repository.global.agentPreset,
      },
    )
  }

  /** Resolve the preset that the persisted session actually runs.
   *
   * A user may change preset while a session is blank, so the creation header
   * is only a fallback; the `agentPreset` projection is authoritative. This
   * mirrors the native session controller's resume path instead of guessing
   * from Pet's current setting.
   */
  const persistedPresetFor = async (sessionId: string): Promise<string> => {
    const query = ctx.get('sessionQuery') as
      | {
          observeSession(
            id: string,
            options: { projectionMode: 'all' },
          ): Promise<{
            header: { agentPreset?: unknown }
            projections?: { values?: { agentPreset?: unknown } }
            [Symbol.dispose]?: () => void
          }>
        }
      | undefined
    if (query === undefined) {
      throw new PetError(
        'INTERNAL',
        `Pet executor session ${sessionId} cannot be resumed because sessionQuery is unavailable`,
      )
    }

    const observation = await query.observeSession(sessionId, { projectionMode: 'all' })
    try {
      const projected = observation.projections?.values?.agentPreset
      const stored = typeof projected === 'string' ? projected : observation.header.agentPreset
      if (typeof stored !== 'string' || stored.trim() === '') {
        throw new PetError(
          'INTERNAL',
          `Pet executor session ${sessionId} has no persisted Agent preset`,
        )
      }
      return stored
    } finally {
      observation[Symbol.dispose]?.()
    }
  }

  const dispatcher: PromptDispatcher = {
    dispatch: async (executorSessionId, text) => {
      // `agents.get` only finds a LOADED agent. DSH unloads idle ones, so a
      // Pet Task that sat unused had its executor evicted and every later
      // dispatch failed — the session itself was never gone. Resume it from
      // its persisted state instead of reporting the Task as unrecoverable.
      // `agents.get` and `sessions.get` both mean LOADED, not "exists": DSH
      // unloads idle entries, so a Pet Task left alone had its executor
      // evicted and every later dispatch failed while the session was intact.
      // Gate on resume itself — it reads persisted state, so it is the only
      // check that can tell an evicted session from a deleted one.
      let handle: unknown = ctx.agents.get(executorSessionId as never)
      if (handle === undefined) {
        try {
          const current = selection()
          const task = repository.findTaskByExecutor(executorSessionId)
          if (task === undefined) {
            throw new PetError(
              'TASK_NOT_FOUND',
              `Pet executor session ${executorSessionId} is not bound to a Task`,
            )
          }
          const presetId = await persistedPresetFor(executorSessionId)
          const expectedFormPreset =
            task.residentWorkspaceId === undefined ? undefined : STANDARD_PRESET
          if (expectedFormPreset !== undefined && presetId !== expectedFormPreset) {
            throw new PetError(
              'INTERNAL',
              `Workspace-resident Pet executor ${executorSessionId} persisted unexpected preset ${presetId}`,
            )
          }
          handle = await ctx.agents.resume({
            resumeSessionId: executorSessionId as never,
            // Same flat model shape as creation. The preset name is persisted
            // for display, but setup still needs the resolved id because
            // `agentPresets.mount` is what actually composes its tools.
            agentOptions: {
              provider: current.providerId,
              model: current.modelId,
            },
            // Resume mints a BRAND NEW agent scope. Mount the Task form's
            // preset, then restore `pet_context`; only dedicated Pet executors
            // regain the allowlist provider.
            setup: (agentCtx: unknown) =>
              executorSetup(agentCtx, presetId, task.residentWorkspaceId === undefined),
          } as never)
        } catch (error) {
          throw new PetError(
            'INTERNAL',
            `Pet executor session ${executorSessionId} could not be resumed: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      // The ordinary DSH lifecycle: submit a normal user message through
      // `followup`, which is synchronous and void, then flush by awaiting the
      // agent's idle boundary. `followup` takes a UserMessage — never a raw
      // string — so the envelope rides the same path a native client uses and
      // the Skill pre-step sees the leading `/skill-name` token.
      const agent = (handle as { agent?: unknown }).agent ?? handle

      // Fail closed on the isolation boundary.
      //
      // A live agent here may have been loaded by DSH itself rather than by
      // Pet — the user opening the executor from the native session list does
      // exactly that, and the official session controller composes it with a
      // preset-only setup. The `agent/created` observer normally scopes such
      // an agent; this is the check that makes a miss visible instead of
      // silently running an Invocation with Host-wide Skill discovery.
      if (!isComposed(agent)) {
        // Late, best-effort repair for an agent that predates the observer
        // (registered after Pet's own initialization) before refusing.
        composeForeignExecutor(agent)
      }
      if (!isComposed(agent)) {
        throw new PetError(
          'INTERNAL',
          `Pet executor session ${executorSessionId} is missing its Pet scoped surface, so this ` +
            'Invocation would run without trusted context or its Task-form boundary. Reopen ' +
            'the Task to have Pet load the executor itself.',
        )
      }
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      ;(agent as { followup(input: unknown): void }).followup(message)
      const idle = (agent as { whenIdle?: () => Promise<void> }).whenIdle
      if (typeof idle === 'function') await idle.call(agent)
    },
  }


  /**
   * Account a session to a workspace.
   *
   * Creating a session with the right `cwd` is not enough: DSH accounts
   * sessions explicitly, so without this an executor — or a QA child — exists
   * but never appears under its project in the sidebar. Falls back to the Pet
   * workspace, where an ordinary executor belongs; resident Tasks and QA
   * children pass the workspace they actually relate to.
   */
  const attachSessionToWorkspace = async (
    sessionId: string,
    targetWorkspaceId?: string,
  ): Promise<void> => {
    const target = targetWorkspaceId ?? workspaceId
    const workspace = ctx.workspaceRegistry.get(target as never)
    await workspace?.attachSession(sessionId as never)
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
    attachToWorkspace: attachSessionToWorkspace,
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

  // The subagent seam behind the QA group, PROBED rather than injected: a
  // declared dependency this Host lacks would stop Pet from loading at all,
  // which is the failure mode the lifecycle contract forbids. An absent seam
  // means the QA action reports itself unavailable; everything else carries on.
  const qaProbe = probeSubagentSeam(ctx as unknown as HostContextLike)
  if (!qaProbe.available) {
    ctx.logger.info(`dsh-pet: QA group unavailable — ${qaProbe.diagnostic}`)
  }
  const qaSeam = qaProbe.available ? qaProbe.seam : undefined

  // One client shared by the channel and the QA paths, so a test double
  // installed for one is not silently bypassed by the other.
  const larkClient = createLarkCliClient()

  // Owns the settlement subscription, so it is created once and disposed with
  // Pet rather than rebuilt per message.
  const qaDelivery =
    qaSeam === undefined
      ? undefined
      : new QaDelivery({
          repository,
          client: larkClient,
          seam: qaSeam,
          onChange: () => changes.publish(),
          log: message => ctx.logger.info(`dsh-pet qa: ${message}`),
        })
  if (qaDelivery !== undefined) {
    ctx.effect(() => () => qaDelivery.dispose(), 'dsh-pet: qa settlement subscription')
  }

  /**
   * Resolve a source session's managed execution facts.
   *
   * Shared by both QA entry points, and always through the Worktree Session
   * contract — never inferred from a `cwd`, which that plugin deliberately
   * leaves at the repository root.
   */
  const resolveSourceWorktree = async (
    sessionId: string,
  ): Promise<
    { executionRoot: string; branch?: string; repositoryRoot?: string } | undefined
  > => {
    const session = ctx.sessions.get(sessionId as never) as { header?: { cwd?: string } } | undefined
    const repoPath = session?.header?.cwd
    if (maintenance === undefined || repoPath === undefined) return undefined
    return maintenance
      .wsStatus({ sessionId, repoPath })
      .then(status => ({
        executionRoot: status.worktreePath,
        ...(status.taskBranch !== '' ? { branch: status.taskBranch } : {}),
        repositoryRoot: repoPath,
      }))
      // An unbound session is the ordinary non-worktree case, not a fault.
      .catch(() => undefined)
  }

  // `/bind`: attach an existing group to an existing session. Present only
  // with the seam, exactly like the Q&A action — without it the command is
  // never recognised and unbound groups behave as before.
  const bindCommand =
    qaSeam === undefined
      ? undefined
      : {
          handle: async (
            event: { chat_id: string; message_id: string },
            prefix: string,
          ): Promise<{ kind: 'accepted'; invocationId: string } | { kind: 'error'; reason: string }> => {
            const bindDeps = {
              repository,
              client: larkClient,
              seam: qaSeam,
              attachToWorkspace: attachSessionToWorkspace,
              log: (message: string) => ctx.logger.info(`dsh-pet bind: ${message}`),
              listSessions: () =>
                ctx.sessions.list().map(session => {
                  const header = (session as unknown as { header?: { parentSession?: string } })
                    .header
                  // The title is NOT on the header — it is maintained by the
                  // session-title service in the session log, and reading
                  // `header.title` silently yields `undefined` for every
                  // session, which showed up as every bound group being named
                  // "答疑 · DSH" and every receipt naming a raw id.
                  const title = ctx.sessionTitle.get(session)?.title
                  return {
                    id: String(session.id),
                    ...(title !== undefined && title !== '' ? { title } : {}),
                    ...(header?.parentSession !== undefined
                      ? { parentSession: header.parentSession }
                      : {}),
                  }
                }),
              resolveWorktree: resolveSourceWorktree,
              // Best-effort: the receipt states the blast radius when it can,
              // and omits the line when Lark will not say.
              memberCount: (chatId: string) =>
                larkClient.memberCount(chatId).catch(() => undefined),
            }
            let text: string
            try {
              const outcome = await bindExistingGroup(bindDeps as never, {
                chatId: event.chat_id,
                prefix,
              })
              text = renderBindReceipt(outcome)
              if (outcome.ok) changes.publish()
            } catch (error) {
              text = `绑定失败：${error instanceof Error ? error.message : String(error)}`
            }
            // The reply goes to the GROUP, not to whoever typed: members have
            // a right to know their group just gained an agent carrying
            // someone else's working context.
            await larkClient.reply(event.message_id, text).catch(() => undefined)
            return { kind: 'accepted', invocationId: `bind-${event.message_id}` }
          },
          unbind: async (event: {
            chat_id: string
            message_id: string
          }): Promise<{ kind: 'accepted'; invocationId: string }> => {
            let text: string
            try {
              text = renderUnbindReceipt(await unbindGroup({ repository }, event.chat_id))
              changes.publish()
            } catch (error) {
              text = `解绑失败：${error instanceof Error ? error.message : String(error)}`
            }
            // Announced in the group for the same reason binding is: the
            // members were told an agent joined, so they are told it left.
            await larkClient.reply(event.message_id, text).catch(() => undefined)
            return { kind: 'accepted', invocationId: `unbind-${event.message_id}` }
          },
        }

  // The Q&A wheel action. Registered unconditionally so the reason it cannot
  // run is visible on the wheel itself; an action that simply vanished would
  // read as a Pet bug rather than as missing configuration.
  ctx.effect(
    () =>
      capabilities.registerBuiltin({
        id: QA_GROUP_ACTION_ID,
        label: '答疑群',
        description:
          '基于当前会话建一个飞书答疑群：把这段会话上下文 fork 成一个子代理，' +
          '你再拉人进群，群成员 @bot 即可向它提问。' +
          '子代理看到的是本会话最近一轮完成的内容；被你拉进群的人即视为可信。',
        probe: () => {
          if (qaSeam === undefined) {
            return qaProbe.available ? undefined : qaProbe.diagnostic
          }
          const config = repository.getChannelConfig()
          if (config.botAppId === undefined) return '尚未绑定飞书 bot（设置 → 飞书）'
          if (config.allowOpenIds.length === 0) return '飞书 allowlist 为空，无法确定邀请谁'
          return undefined
        },
      }),
    'dsh-pet: qa builtin action',
  )

  // Project Task/Invocation state from the durable session event firehose.
  // Without this nothing ever settles an Invocation: it would stay `running`
  // forever even after its turn completed.
  // The Lark channel. Composed as one unit so it can be absent entirely, and
  // built AFTER the coordinator it drives. Nothing here can reject into
  // startup: a channel that cannot run leaves the rest of Pet untouched.
  const channel = new ChannelService({
    repository,
    coordinator,
    client: larkClient,
    ...(qaDelivery !== undefined ? { qaDelivery } : {}),
    ...(bindCommand !== undefined ? { bindCommand } : {}),
    locator: {
      locate: workspaceId => {
        const match = ctx.workspaceRegistry
          .list()
          .find((item: { id: string }) => item.id === workspaceId) as
          | { path?: string }
          | undefined
        return match?.path
      },
    },
    onChange: () => changes.publish(),
    log: message => ctx.logger.info(message),
  })

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

        // Resolved by PENDING FEEDBACK, not by the serial slot: the slot only
        // holds `running`/`waiting-user`, and by the time `turn/end` arrives
        // the Invocation has usually already settled — asking for the slot
        // returned nothing, so the in-progress reaction was never removed and
        // both marks stayed on the message.
        const settlingTask = repository.findTaskByExecutor(executorSessionId)
        const settling =
          settlingTask === undefined
            ? undefined
            : repository.findPendingChannelFeedback(settlingTask.id)?.invocationId

        const reason = (event.data as { reason?: { kind?: string; error?: { message?: string } } })
          ?.reason
        switch (reason?.kind) {
          case 'completed':
            void coordinator.onAgentEvent(executorSessionId, { kind: 'turn-complete' })
            if (settling !== undefined) void channel?.settle(settling, 'succeeded')
            return
          case 'aborted':
            void coordinator.onAgentEvent(executorSessionId, { kind: 'cancelled' })
            if (settling !== undefined) void channel?.settle(settling, 'failed')
            return
          default:
            // `failed`, `blocked` and any future reason settle as a failure
            // rather than leaving the Invocation running forever.
            void coordinator.onAgentEvent(executorSessionId, {
              kind: 'turn-error',
              message: reason?.error?.message ?? `turn ended: ${reason?.kind ?? 'unknown'}`,
            })
            if (settling !== undefined) void channel?.settle(settling, 'failed')
        }
      }),
    'dsh-pet: project Invocation state from session events',
  )

  // Drain queues left by a restart. Reconciliation frees the Invocation slot,
  // but nothing re-dispatches on its own: a Task whose slot just opened would
  // otherwise sit with queued work until the user invoked something new.
  for (const task of repository.listTasks()) {
    if (task.archivedAt !== undefined) continue
    void coordinator.pump(task.id).catch(() => undefined)
  }

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
    channel,
    // Present only with the seam: the route refuses outright rather than
    // half-creating a group when this Host cannot fork.
    ...(qaSeam === undefined
      ? {}
      : {
          createQaGroup: async (source: { sessionId: string; title?: string }) => {
            // The source session's workspace decides where the child is
            // filed. Read from the Host registry rather than trusted from the
            // browser: the client may name a workspace the session does not
            // belong to.
            const session = ctx.sessions.get(source.sessionId as never) as
              | { workspaceId?: string; header?: { cwd?: string } }
              | undefined
            const sourceWorkspaceId =
              typeof session?.workspaceId === 'string' ? session.workspaceId : undefined

            // Resolve the managed execution root through the Worktree Session
            // contract — never from `cwd`, which that plugin deliberately
            // leaves at the repository root. A fork copies the parent's cwd
            // verbatim but inherits no binding, so without this the child
            // would treat the MAIN CHECKOUT as its working directory: the
            // parent is governed by its binding, the child would run bare.
            const repoPath = session?.header?.cwd
            let worktree: { executionRoot: string; branch?: string; repositoryRoot?: string } | undefined
            if (maintenance !== undefined && repoPath !== undefined) {
              worktree = await maintenance
                .wsStatus({ sessionId: source.sessionId, repoPath })
                .then(status => ({
                  executionRoot: status.worktreePath,
                  ...(status.taskBranch !== '' ? { branch: status.taskBranch } : {}),
                  repositoryRoot: repoPath,
                }))
                // An unbound session is the ordinary non-worktree case, not a
                // fault: the child then simply works where its cwd points.
                .catch(() => undefined)
            }

            return createQaGroup(
              {
                repository,
                client: larkClient,
                seam: qaSeam,
                attachToWorkspace: attachSessionToWorkspace,
                log: message => ctx.logger.info(`dsh-pet qa: ${message}`),
              },
              {
                sessionId: source.sessionId,
                ...(source.title !== undefined ? { title: source.title } : {}),
                ...(sourceWorkspaceId !== undefined ? { workspaceId: sourceWorkspaceId } : {}),
                ...(worktree !== undefined ? { worktree } : {}),
              },
            )
          },
        }),
    listPresets: async () => {
      // Enumerate what this Host actually offers; a free-text preset name
      // could name a composition that does not exist.
      const presets = await ctx.agentPresets.list()
      return presets.map(preset => ({ id: preset.id, label: preset.name ?? preset.id }))
    },
    listWorkspaces: async () => {
      // The Pet Workspace itself is excluded: it holds executor sessions, so
      // it is never the SOURCE a user configures a CR group for.
      const petWorkspaceId = repository.global.workspaceId
      return ctx.workspaceRegistry
        .list()
        .filter((item: { id: string }) => item.id !== petWorkspaceId)
        .map((item: { id: string; title?: string; path?: string }) => ({
          id: item.id,
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(item.path !== undefined ? { path: item.path } : {}),
        }))
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

  // Starts only when configuration says the channel is enabled, and stops
  // with Pet: the consumer gets SIGTERM so lark-cli can clean up its
  // server-side subscription. The shared bus daemon is left alone — it is not
  // ours and other lark-cli users may still be attached.
  ctx.effect(() => {
    channel.start()
    return () => channel.stop()
  }, 'dsh-pet: lark channel subscription')

  // Flush the sessions QA work touched before Pet goes away. Session
  // persistence writes in batches, so a Host that exits without this can lose
  // the tail of a child's log — and a QA child's tail is the answer someone
  // in the group is still reading. Best-effort by design: teardown must not
  // fail because a flush did.
  ctx.effect(
    () => () => {
      for (const binding of repository.listChatBindings()) {
        if (binding.kind !== 'qa' || binding.qaChildSessionId === undefined) continue
        const session = ctx.sessions.get(binding.qaChildSessionId as never)
        if (session === undefined) continue
        void ctx.sessions.flush(session).catch(() => undefined)
      }
    },
    'dsh-pet: flush qa child sessions on stop',
  )

  lifecycle.markReady()
  ctx.logger.info(`dsh-pet ready (state: ${paths.stateRoot})`)
}

/**
 * Read the last assistant message text from a session's event log.
 *
 * Currently unused by the channel: replying is the agent's own job, so no
 * Host-side path needs the transcript tail. Kept and tested because reading
 * this shape correctly is easy to get wrong (see the note referenced below)
 * and a future model-driven reply tool will need exactly this.
 *
 * The shape is `assistant/message` events carrying
 * `data.message.content[]` (verified against a real log; see
 * docs/notes/dsh-plugin-integration-pitfalls.md §4), where the readable
 * answer is the `text` parts —
 * `reasoning` and `tool-call` parts sit in the same array and must not be
 * sent to a chat. Returns `undefined` rather than guessing when nothing
 * readable is present, in which case no reply is sent at all.
 * @param events - The session's event log.
 * @returns the final assistant text, or `undefined`.
 */
export function latestAssistantText(events: readonly unknown[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as
      | { type?: string; data?: { message?: { role?: unknown; content?: unknown } } }
      | undefined
    if (event?.type !== 'assistant/message') continue
    const message = event.data?.message
    if (message?.role !== 'assistant') continue
    const content = message.content
    if (!Array.isArray(content)) continue

    const parts: string[] = []
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue
      const entry = part as { type?: unknown; text?: unknown }
      // `text` only: reasoning is the model thinking aloud and a tool-call is
      // machinery, neither of which belongs in a chat reply.
      if (entry.type !== 'text') continue
      if (typeof entry.text === 'string' && entry.text.trim() !== '') parts.push(entry.text)
    }
    if (parts.length > 0) return parts.join('\n\n')
  }
  return undefined
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
