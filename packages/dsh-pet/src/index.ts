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
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
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
import { createLarkCliClient, createLocusLarkPort } from './host/channel/lark.js'
import { createPetRoutes } from './host/routes.js'
import { createPetEnvContributor } from './host/shell-env.js'
import { createPetSkillProvider, resolveInvocationSkill } from './host/skill-provider.js'
import { createWorktreeProvider } from './host/worktree-adapter.js'
import { loadWorktreeStatus } from './host/worktree-status.js'
import { registerPetTools } from './host/tools.js'
import { LocusRepository } from './host/locus/persistence.js'
import {
  createLocusChildAdapter,
  probeLocusChildPorts,
  type LocusHostContextLike,
} from './host/locus/child.js'
import { createLocusChildDelivery } from './host/locus/child-delivery.js'
import {
  createLocusChannelCapability,
  unavailableLocusChannelCapability,
} from './host/channel/locus-capability.js'
import { createLocusTurnObserver } from './host/locus/turn-observer.js'
import { createLocusManagementPort } from './host/locus/management.js'
import { createLocusResolution } from './host/locus/resolution.js'
import { createLocusController } from './host/locus/controller.js'
import { ControllerLocusRepositoryAdapter } from './host/locus/controller-persistence-adapter.js'
import { createProductionLocusDshPort } from './host/locus/dsh-port.js'
import { buildLocusDiagnostics } from './host/locus/diagnostics.js'
import { reconcileLocusChildren } from './host/locus/reconcile.js'
import {
  createPrepublicationCompositionLookup,
  LocusPrepublicationStagingRegistry,
} from './host/locus/prepublication-staging.js'
import { asRetiredAssociationStore } from './host/locus/retirement.js'
import { createDurableLocusAuthorizationResolver } from './host/locus/admission.js'
import { createLocusControlDispatcher } from './host/locus/control.js'
import { createLocusPermissionMutation } from './host/locus/permission-mutation.js'
import { asLocusContextRepository } from './host/locus/context-repository.js'
import { renderLocusDeliveryPrompt } from './host/locus/context.js'
import {
  composeLocusChild,
  type LocusChildPermission,
  type LocusCandidateAgent,
  type LocusCompositionPorts,
} from './host/locus/composition.js'
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
  // Unified locus provisioning/recovery uses the Host business API, not a
  // display-only session registry. Declaring it prevents Pet from racing ahead
  // of the service and silently publishing a permanently unavailable channel.
  'sessionController',
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
  // The additive locus store is a separate source of truth. It is opened on
  // the same durable domain but never falls back to legacy chat bindings.
  const locusRepository = new LocusRepository(domain)
  const locusStartup = await lifecycle.contain('Locus startup reconciliation', () =>
    locusRepository.reconcileStartup(),
  )
  if (locusStartup === undefined) return
  if (locusStartup.pendingDeliveries.length > 0 || locusStartup.recoverableOperations.length > 0) {
    ctx.logger.info(
      `dsh-pet locus recovery: ${String(locusStartup.pendingDeliveries.length)} pending Deliveries, ` +
      `${String(locusStartup.recoverableOperations.length)} recoverable operations; no side effect replayed`,
    )
  }
  // Shared by scoped locus replies, control receipts, and channel probes. It is
  // fixed to the dsh-pet profile and bot identity by the Lark adapter.
  const larkClient = createLarkCliClient()
  let currentLocusTurnProof: (childSessionId: string) =>
    | { readonly executionId: string; readonly turnId: string }
    | undefined = () => undefined
  const locusContextRepository = asLocusContextRepository(
    locusRepository,
    childSessionId => currentLocusTurnProof(childSessionId),
  )

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
  /**
   * `Context.inject()` starts an asynchronous Cordis fiber. Keep one promise
   * per live Agent context so concurrent create/resume/observer paths cannot
   * register the same scoped service twice or observe a half-installed scope.
   */
  const installingScopes = new WeakMap<object, Promise<void>>()
  const scopeComplete = (key: object, includeAllowlist: boolean): boolean =>
    contextToolAgents.has(key) && (!includeAllowlist || allowlistAgents.has(key))

  /** Install the Pet-owned scoped surface on one live executor Agent.
   *
   * Every Pet Task executor receives `pet_context`. Only the dedicated Pet
   * executor form also receives the allowlist Skill provider; a
   * workspace-resident executor deliberately uses its workspace's Skills.
   * The marker makes repeated installation idempotent without swallowing a
   * duplicate-registration error. The returned promise settles only after
   * every `inject()` fiber has run its callback and the markers are true.
   */
  const installPetScope = async (agentCtx: unknown, includeAllowlist: boolean): Promise<void> => {
    const scoped = agentCtx as Context
    const key = scoped as unknown as object
    if (scopeComplete(key, includeAllowlist)) return

    const previous = installingScopes.get(key)
    if (previous !== undefined) await previous
    if (scopeComplete(key, includeAllowlist)) return

    const installation = (async (): Promise<void> => {
      // Another caller may have completed while this request was waiting on a
      // prior installation. Re-check before touching either registry.
      if (scopeComplete(key, includeAllowlist)) return

      // Agent contexts are fresh fibers and do not inherit this plugin's inject
      // grants, so each scoped registration declares its dependency locally.
      // Mark each component only after its registration succeeds: a partial
      // failure can then be retried without duplicating the component that
      // already exists.
      if (includeAllowlist && !allowlistAgents.has(key)) {
        await Promise.resolve(
          scoped.inject(['skills'], skillCtx => {
            skillCtx.effect(
              () =>
                skillCtx.skills.registerProvider(() => createPetSkillProvider(repository, paths)),
              'dsh-pet: scoped allowlist Skill provider',
            )
            allowlistAgents.add(key)
          }),
        )
      }

      // `tools.register()` chooses its layer from the CALLING context's scope
      // tag. Calling it on the Host silently publishes globally, which is the
      // original leak this change fixes.
      if (!contextToolAgents.has(key)) {
        await Promise.resolve(
          scoped.inject(['tools'], toolCtx => {
            toolCtx.effect(
              () => registerPetTools(toolCtx, {
                repository,
                locusRepository: locusContextRepository,
              }),
              'dsh-pet: scoped caller-bound Agent tools',
            )
            contextToolAgents.add(key)
          }),
        )
      }

      if (!contextToolAgents.has(key) || (includeAllowlist && !allowlistAgents.has(key))) {
        throw new PetError('INTERNAL', 'Pet scoped surface dependencies were not installed')
      }
      composedAgents.add(key)
    })()
    installingScopes.set(key, installation)
    try {
      await installation
    } finally {
      if (installingScopes.get(key) === installation) installingScopes.delete(key)
    }
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
    await installPetScope(scoped, includeAllowlist)
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
  const composeForeignExecutor = async (agent: unknown): Promise<void> => {
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
      await installPetScope(view.ctx, task.residentWorkspaceId === undefined)
    } catch (error) {
      ctx.logger.warn(
        `dsh-pet: could not scope externally loaded executor ${String(sessionId)} (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }
  }

  /**
   * Compose a unified locus child while the runtime is still creating it.
   *
   * This branch is SYNCHRONOUS on purpose: at this boundary a throw vetoes
   * publication and rolls the agent back, so a locus child can never start
   * its first turn without its caller-bound surface or with a file policy
   * wider than its locus was granted. The ordinary Pet executor path stays
   * asynchronous below — it repairs an already-published agent, which is a
   * different guarantee.
   */
  const locusPrepublication = new LocusPrepublicationStagingRegistry()
  ctx.effect(
    () => () => { locusPrepublication.dispose() },
    'dsh-pet: dispose locus pre-publication staging',
  )
  const durableLocusCompositionLookup = {
    find: (sessionId: string) => {
      const matches = locusRepository.findByChildSessionId(sessionId)
      // Exactly one active generation may own a child. Anything else is
      // unproven identity, and the composer refuses rather than guessing.
      if (matches.length !== 1) return undefined
      const record = matches[0]
      if (record === undefined || record.state !== 'active') return undefined
      if (record.childSessionId !== sessionId) return undefined
      return {
        parentSessionId: record.parentSessionId,
        childSessionId: sessionId,
        locusId: record.id,
        generation: record.generation,
        permission: record.permission.effective,
      }
    },
  }
  const locusCompositionPorts: LocusCompositionPorts = {
    // Durable rows serve restores; the one-shot staging fallback serves the
    // fresh `agent/created` emitted before active publication.
    lookup: createPrepublicationCompositionLookup({
      durable: durableLocusCompositionLookup,
      staging: locusPrepublication,
    }),
    // The scoped surface is registered on the CHILD's own scope: resolving
    // `tools` from the Host scope would publish `pet_context` globally.
    surface: {
      install: (agent) => {
        const scope = agent.scope as unknown as {
          get(service: string): { register(definition: unknown): unknown } | undefined
        }
        const tools = scope.get('tools')
        if (tools === undefined) {
          throw new PetError('INTERNAL', 'Agent scope exposes no tools service')
        }
        registerPetTools(agent.scope as never, {
          repository,
          locusRepository: locusContextRepository,
          locusReply: {
            locusRepository: locusContextRepository,
            lark: larkClient,
          },
        })
      },
    },
    ...(() => {
      const policy = ctx.get('sandboxPolicy') as
        | { resolve?: (input: { session: unknown }) => { mode?: string } | undefined }
        | undefined
      const sessions = ctx.get('sessions') as { get?: (id: never) => unknown } | undefined
      if (policy?.resolve === undefined || sessions?.get === undefined) {
        // Absent policy seam keeps locus children unavailable rather than
        // publishing one whose file access was never verified.
        return {}
      }
      const modeOf = (permission: LocusChildPermission): string =>
        permission === 'write' ? 'workspace-write' : 'read-only'
      return {
        policy: {
          apply: (sessionId: string, permission: LocusChildPermission) => {
            const session = sessions.get?.(sessionId as never)
            if (session === undefined) {
              throw new PetError('INTERNAL', `Session ${sessionId} is not resolvable`)
            }
            // The official write seam is a free function exported by
            // dsh-sandbox-policy. The service itself only resolves policy;
            // inventing `service.setMode` type-checks against a test double but
            // is absent in the real Host and leaves every locus child
            // uncomposed.
            setSandboxMode(session as never, modeOf(permission) as never)
          },
          resolve: (sessionId: string): LocusChildPermission | undefined => {
            const session = sessions.get?.(sessionId as never)
            if (session === undefined) return undefined
            const resolved = policy.resolve?.({ session })?.mode
            if (resolved === 'read-only') return 'read'
            return resolved === 'workspace-write' ? 'write' : undefined
          },
        },
      }
    })(),
  }

  ctx.effect(
    () =>
      ctx.on('agent/created', (payload: { agent?: unknown }) => {
        const agent = payload?.agent as
          | { session?: { id?: unknown }; ctx?: unknown }
          | undefined
        const sessionId = agent?.session?.id
        // Call the locus composer exactly ONCE. A durable lookup is reusable,
        // but the fresh-child staging fallback is a one-shot claim; a
        // preliminary "is locus?" probe would consume it and make the real
        // composition fail as a duplicate publication. `composed:false` is
        // the ordinary-session answer and falls through unchanged.
        if (typeof sessionId === 'string' && agent?.ctx !== undefined) {
          const candidate: LocusCandidateAgent = { sessionId, scope: agent.ctx as never }
          // Rethrown deliberately: only a candidate that matched durable or
          // staged locus identity may veto publication.
          const result = composeLocusChild(candidate, locusCompositionPorts)
          if (result.composed) {
            composedAgents.add(agent.ctx as object)
            contextToolAgents.add(agent.ctx as object)
            return
          }
        }
        // Cordis event listeners are observe-only here. Await the scoped
        // installation without allowing an async rejection to escape into the
        // event dispatcher; dispatch itself performs a late fail-closed check.
        void composeForeignExecutor(payload?.agent)
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
        // Late repair is asynchronous because scoped `inject()` callbacks
        // are Cordis fibers. Await it before the fail-closed decision so a
        // native-loaded executor is never dispatched during a half-installed
        // scope.
        await composeForeignExecutor(agent)
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

  /**
   * Probe the unified locus child seams and the per-turn correlation observer.
   *
   * Both are required together. The observer is what lets a Delivery settle
   * against the exact child turn that ran it, and the locus controller refuses
   * to accept work without it — so a Host missing either seam keeps the
   * unified capability unavailable rather than accepting Feishu work it could
   * never settle. Settlement-notice support is proved from a literal marker
   * on the runtime instance the Host actually loaded. The reviewed local
   * launcher publishes it; the official pinned package does not, and remains
   * fail closed rather than relying on version strings or unknown fields.
   */
  const locusChildProbe = probeLocusChildPorts(ctx as unknown as LocusHostContextLike)

  /**
   * Reconcile durable locus rows against the live runtime, once at startup.
   *
   * Without this a locus whose child no longer exists still looks serviceable,
   * and the next Feishu message waits forever with no visible cause. The pass
   * only records facts: an unusable child is marked invalid with a reason and
   * never silently re-created, and a runtime that cannot answer leaves the row
   * untouched. Fire-and-forget, so a slow probe cannot delay Pet's readiness.
   */
  const locusReconcileAbort = new AbortController()
  ctx.effect(
    () => () => { locusReconcileAbort.abort() },
    'dsh-pet: cancel locus startup reconciliation',
  )
  const locusReconciled = await lifecycle.contain('Locus child reconciliation', async () => {
    const proof = locusChildProbe.available ? locusChildProbe.ports.proof : undefined
    const report = await reconcileLocusChildren(
      locusRepository.listLoci(),
      {
        store: {
          invalidate: async (locusId, reason, at) => {
            // The child is proven gone, so its pending Deliveries can never
            // complete. Honouring the pending-work guard here would leave the
            // endpoint permanently stuck with no diagnosis.
            await locusRepository.invalidateLocus(locusId, reason, at, undefined, {
              evenWithPendingWork: true,
            })
          },
          hasPendingDelivery: locusId => locusRepository.listPendingDeliveries(locusId).length > 0,
          clearBusy: async (locusId, at) => {
            await locusRepository.setLocusBusy(locusId, false, at)
          },
        },
        ...(proof === undefined
          ? {}
          : {
            probe: {
              check: async ({ parentSessionId, childSessionId, signal }) => {
                const found = await proof.findChild(parentSessionId, childSessionId, signal)
                // An explicit absence from the runtime's own child listing is
                // evidence; anything else must stay unproven.
                return found === undefined
                  ? { kind: 'unusable', reason: '子会话在运行时中已不存在，需要所有者重新建立。' }
                  : { kind: 'usable' }
              },
            },
          }),
        log: code => ctx.logger.info(`dsh-pet locus reconcile: ${code}`),
      },
      locusReconcileAbort.signal,
    )
    if (report.invalidated.length > 0 || report.busyCleared.length > 0) {
      ctx.logger.info(
        `dsh-pet: locus reconciliation invalidated ${String(report.invalidated.length)}`
        + `, cleared ${String(report.busyCleared.length)} stale busy fence(s)`,
      )
    }
    return report
  })
  // Do not publish/start the channel ahead of its child and busy-fence truth.
  // Lookup uncertainty is represented inside the report and remains fail-closed;
  // a reconciliation infrastructure failure degrades Pet before intake starts.
  if (locusReconciled === undefined) return

  if (!locusChildProbe.available) {
    ctx.logger.info(`dsh-pet: unified locus child seam unavailable — ${locusChildProbe.diagnostic}`)
  }
  const idleChildProvisioning = locusChildProbe.available
    && locusChildProbe.ports.subagent.supportsSettlementNotice === true
    && locusChildProbe.ports.subagent.supportsIdleContinuableCreate === true
    ? {
      create: async (input: {
        parentSessionId: string
        workspaceId: string
        locusId: string
        generation: number
        label: string
        permission: 'read'
      }) => {
        const reservation = locusPrepublication.reserve({
          parentSessionId: input.parentSessionId,
          locusId: input.locusId,
          generation: input.generation,
          permission: input.permission,
        })
        const adapter = createLocusChildAdapter(locusChildProbe.ports)
        try {
          const created = await adapter.createIdleChild({
            parentSessionId: input.parentSessionId,
            childId: reservation.childSessionId,
            label: input.label,
          })
          if (!created.ok) throw new Error(`Idle locus child creation failed (${created.reason})`)
          // createIdleContinuable returns only after agent/created. That event
          // must have consumed the one-shot composition claim before we expose
          // the resource to the durable controller.
          if (locusPrepublication.inspect(reservation.childSessionId)?.state !== 'claimed') {
            throw new Error('Idle locus child was created without synchronous scoped composition')
          }
          let finalized = false
          return {
            childSessionId: reservation.childSessionId,
            commit: () => {
              if (finalized) return
              locusPrepublication.commit(reservation)
              finalized = true
              adapter.dispose()
            },
            rollback: async () => {
              if (!finalized && locusPrepublication.inspect(reservation.childSessionId) !== undefined) {
                locusPrepublication.abort(reservation)
              }
              const released = await adapter.compensateChild({
                identity: created.identity,
                reason: 'locus provisioning rollback',
              })
              adapter.dispose()
              if (!released.ok) throw new Error(`Could not roll back locus child (${released.reason})`)
            },
          }
        } catch (error) {
          if (locusPrepublication.inspect(reservation.childSessionId) !== undefined) {
            locusPrepublication.abort(reservation)
          }
          adapter.dispose()
          throw error
        }
      },
    }
    : undefined

  const locusProvisioning = (() => {
    if (idleChildProvisioning === undefined || !locusRepository.supportsAtomicProvisioning()) {
      return undefined
    }
    const sessionController = ctx.get('sessionController') as
      | { inspect?: (sessionId: unknown) => Promise<unknown> }
      | undefined
    if (typeof sessionController?.inspect !== 'function') return undefined
    try {
      const dsh = createProductionLocusDshPort({
        repository,
        sessionController: sessionController as never,
        workspaceRegistry: ctx.workspaceRegistry as never,
        agents: ctx.agents as never,
        agentPresets: ctx.agentPresets as never,
        agentDefaultModel: ctx.agentDefaultModel as never,
        sessions: ctx.sessions as never,
        sessionTitle: ctx.sessionTitle as never,
        idleChildren: idleChildProvisioning,
      })
      const controller = createLocusController({
        repository: new ControllerLocusRepositoryAdapter(locusRepository),
        dsh,
        lark: createLocusLarkPort(),
        log: message => ctx.logger.info(`dsh-pet locus provisioning: ${message}`),
      })
      return { controller, dsh }
    } catch (error) {
      ctx.logger.info(
        `dsh-pet: locus provisioning composition failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
      return undefined
    }
  })()
  const locusProvisioningController = locusProvisioning?.controller
  const locusDshPort = locusProvisioning?.dsh

  // Legacy rows participate only as a terminal retirement marker. They never
  // supply routing, session identity, workspace or permission to the new path.
  const retiredAssociations = asRetiredAssociationStore(repository)
  const locusAuthorization = createDurableLocusAuthorizationResolver(
    locusRepository,
    retiredAssociations,
  )
  const locusResolution = createLocusResolution({
    store: locusRepository,
    retired: retiredAssociations,
    ...(locusProvisioningController === undefined
      ? {}
      : {
        provisioning: {
          ensureForDelivery: async ({ endpoint }) => {
            const ensured = endpoint.threadId === undefined
              ? await locusProvisioningController.ensureGroup({ chatId: endpoint.chatId })
              : await locusProvisioningController.ensureTopic({
                chatId: endpoint.chatId,
                threadId: endpoint.threadId,
              })
            const record = ensured.locus
            if (record.state !== 'active') {
              throw new Error(`Provisioned locus is ${record.state}, not active`)
            }
            return {
              id: record.locusId,
              endpoint: record.endpoint,
              generation: record.generation,
              parentSessionId: record.parentSessionId,
              childSessionId: record.childSessionId,
              workspaceId: record.workspaceId,
              state: 'active' as const,
            }
          },
        },
      }),
    log: reason => ctx.logger.info(`dsh-pet locus resolve: ${reason}`),
  })

  const locusPermissionMutation = (() => {
    const policy = ctx.get('sandboxPolicy') as
      | { resolve?: (input: { session: unknown }) => { mode?: string } | undefined }
      | undefined
    const controller = ctx.get('sessionController') as
      | { resolveAgent?: (sessionId: unknown) => Promise<unknown> }
      | undefined
    if (policy?.resolve === undefined || controller?.resolveAgent === undefined) return undefined
    return createLocusPermissionMutation({
      repository: locusRepository,
      sessions: {
        resolve: async (childSessionId) => {
          const resolved = await controller.resolveAgent!(childSessionId as never) as
            | { agent?: { session?: { id?: unknown } }; error?: unknown }
            | undefined
          if (resolved?.error !== undefined) return undefined
          const session = resolved?.agent?.session
          return session?.id === childSessionId ? { id: childSessionId, handle: session } : undefined
        },
      },
      policy: {
        apply: (resolved, mode) => {
          const session = resolved.handle
          if (session === undefined) throw new Error('Resolved child has no live session')
          setSandboxMode(session as never, mode as never)
        },
        resolve: (resolved) => {
          const session = resolved.handle
          if (session === undefined) return undefined
          return policy.resolve!({ session })?.mode
        },
      },
    })
  })()

  const locusControlDispatch = locusProvisioningController === undefined || locusDshPort === undefined || locusPermissionMutation === undefined
    ? undefined
    : createLocusControlDispatcher({
      allowOpenIds: () => repository.getChannelConfig().allowOpenIds,
      listSessions: async () => {
        const ids = new Set<string>()
        for (const workspace of ctx.workspaceRegistry.list()) {
          for (const id of workspace.sessionIds ?? []) ids.add(String(id))
        }
        const resolved = await Promise.all([...ids].map(id => locusDshPort.resolveSession(id)))
        return resolved.filter((session): session is NonNullable<typeof session> => session !== undefined)
      },
      bind: {
        bind: ({ endpoint, parentSessionId, chatName }) =>
          endpoint.threadId === undefined
            ? locusProvisioningController.ensureGroup({
              chatId: endpoint.chatId,
              parentSessionId,
              ...(chatName === undefined ? {} : { chatName }),
            })
            : locusProvisioningController.ensureTopic({
              chatId: endpoint.chatId,
              threadId: endpoint.threadId,
              parentSessionId,
              ...(chatName === undefined ? {} : { chatName }),
            }),
        rebuildProtected: ({ endpoint, parentSessionId, chatName, marker }) => {
          if (marker === 'legacy') {
            return locusProvisioningController.rebuildLegacyEndpoint({
              endpoint,
              parentSessionId,
              ...(chatName === undefined ? {} : { chatName }),
            })
          }
          const previous = locusRepository.getLatestLocusByEndpoint(endpoint)
          if (previous === undefined || previous.state === 'active') {
            throw new Error('Protected unified generation is unavailable for explicit rebuild')
          }
          return locusProvisioningController.rebuildExplicit({
            endpoint,
            previousLocusId: previous.id,
            parentSessionId,
          })
        },
      },
      exit: {
        unbindCurrent: async ({ endpoint }) => {
          const current = locusRepository.getCurrentLocus(endpoint)
          if (current === undefined) throw new Error('Current locus does not exist')
          const stopped = await locusRepository.stopLocus(current.id)
          if (stopped.state !== 'stopped') throw new Error('Locus did not reach stopped state')
          return { state: 'stopped' as const, busy: false as const }
        },
      },
      scope: {
        setCurrentMode: async ({ endpoint, actorId, mode }) => {
          const current = locusRepository.getCurrentLocus(endpoint)
          if (current === undefined) throw new Error('Current locus does not exist')
          const updated = await locusPermissionMutation.mutate({
            locusId: current.id,
            actorId,
            mode,
            fence: {
              expectedLocusId: current.id,
              expectedGeneration: current.generation,
              expectedUpdatedAt: current.updatedAt,
            },
          })
          return { mode: updated.permission.effective }
        },
      },
      chatName: chatId => larkClient.chatName(chatId),
    })

  const locusTurnObserver = (() => {
    // Subscribe before anything can be queued: a claim may be reported before
    // the queueing call resolves, and a missed claim leaves that Delivery
    // permanently unable to settle.
    const claimEvent = 'agent/inbox/claimed'
    const sessionEvent = 'session/event'
    try {
      return createLocusTurnObserver({
        onClaimed: listener =>
          ctx.on(claimEvent as never, ((payload: {
            agent?: { session?: { id?: unknown } }
            message?: { id?: unknown }
            turn?: unknown
          }) => {
            const childSessionId = payload?.agent?.session?.id
            const messageId = payload?.message?.id
            if (typeof childSessionId !== 'string' || typeof messageId !== 'string') return
            if (typeof payload.turn !== 'number') return
            listener({ childSessionId, messageId, turn: payload.turn })
          }) as never),
        onTurnEnd: listener =>
          ctx.on(sessionEvent as never, ((
            session: { id?: unknown },
            event: { type?: unknown; data?: { turn?: unknown; reason?: { kind?: unknown; error?: { message?: unknown } } } },
          ) => {
            if (event?.type !== 'turn/end') return
            const childSessionId = session?.id
            const turn = event.data?.turn
            if (typeof childSessionId !== 'string' || typeof turn !== 'number') return
            const kind = event.data?.reason?.kind
            const message = event.data?.reason?.error?.message
            listener({
              childSessionId,
              turn,
              outcome: kind === 'completed'
                ? 'completed'
                : kind === 'aborted'
                  ? 'aborted'
                  : kind === 'blocked'
                    ? 'blocked'
                    : 'failed',
              ...(typeof message === 'string' ? { reason: message } : {}),
            })
          }) as never),
        lookup: {
          find: ({ childSessionId, messageId }) => {
            const record = locusRepository.findDeliveryByMessageId(messageId)
            // Child identity AND an execution binding are both required: a
            // claim for another child, or for a Delivery that was never
            // queued, must not become a settlement proof.
            if (record === undefined || record.childSessionId !== childSessionId) return undefined
            if (record.executionId === undefined) return undefined
            return {
              deliveryId: record.deliveryId,
              executionId: record.executionId,
              correlation: {
                endpoint: record.endpoint,
                locusId: record.locusId,
                generation: record.generation,
                childSessionId: record.childSessionId,
              },
            }
          },
        },
        log: code => ctx.logger.info(`dsh-pet locus turn: ${code}`),
      })
    } catch (error) {
      ctx.logger.info(
        `dsh-pet: unified locus turn observer unavailable (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
      return undefined
    }
  })()
  if (locusTurnObserver !== undefined) {
    currentLocusTurnProof = childSessionId => locusTurnObserver.currentForChild?.(childSessionId)
  }
  /**
   * Why the unified Feishu channel is not published yet.
   *
   * Recorded explicitly rather than left implicit in "nothing was wired": the
   * owner-facing diagnostics must be able to say which capability is missing,
   * and a future composition must not be able to publish the channel while any
   * of these is still true.
   */
  const locusChannelGaps: string[] = []
  if (!locusChildProbe.available) {
    locusChannelGaps.push(`child seam unavailable (${locusChildProbe.diagnostic})`)
  }
  if (locusCompositionPorts.policy === undefined) {
    // The real Host exposes setSandboxMode as a free function and resolve on
    // the service. If either side is unavailable, a child could run wider (or
    // narrower) than the locus grant and the unified path must stay off.
    locusChannelGaps.push('sandbox policy apply/readback unavailable')
  }
  if (locusTurnObserver === undefined) {
    locusChannelGaps.push('per-turn correlation observer unavailable')
  }
  if (locusProvisioningController === undefined) {
    // Do not let the runtime patch alone switch every Feishu event to the new
    // exclusive path. New endpoints need the durable provisioning bridge;
    // otherwise every never-seen group would become unavailable.
    locusChannelGaps.push('durable locus provisioning is not composed')
  }
  if (locusControlDispatch === undefined) {
    locusChannelGaps.push('unified locus controls are not composed')
  }
  // A locus child answers in its own Feishu entry, so the runtime must be able
  // to keep its automatic settlement report out of the main session. Until the
  // runtime carrying that option is the pinned one, creating a locus child
  // would violate the "no automatic report to the parent" boundary.
  if (locusChildProbe.available && locusChildProbe.ports.subagent.supportsSettlementNotice !== true) {
    locusChannelGaps.push('runtime cannot suppress a child\'s automatic parent report')
  }
  if (locusChildProbe.available && locusChildProbe.ports.subagent.supportsIdleContinuableCreate !== true) {
    // Without idle creation the only API submits a real prompt before the
    // active locus can commit, reopening the fresh-child composition race.
    locusChannelGaps.push('runtime cannot create an idle continuable child')
  }
  const locusChildDelivery = locusChildProbe.available
    ? createLocusChildDelivery({
      // One adapter owns exactly one active child; use a factory so sibling
      // loci under the same main session do not contend for one singleton.
      createAdapter: () => createLocusChildAdapter(locusChildProbe.ports),
    })
    : undefined
  if (locusChildDelivery !== undefined) {
    ctx.effect(
      () => () => { locusChildDelivery.dispose() },
      'dsh-pet: dispose per-locus child adapters',
    )
  }

  /**
   * Compose the unified channel controller only when every gate is closed.
   *
   * `createLocusChannelCapability` refuses on its own when the observer is
   * missing, so this is defence in depth rather than the only check: the
   * point here is that a Host missing ANY gate keeps the legacy path instead
   * of publishing a controller that could accept Feishu work it cannot
   * settle, or create a child that would report into the main session.
   */
  const locusChannel = locusChannelGaps.length === 0
    && locusChildProbe.available
    && locusTurnObserver !== undefined
    && locusChildDelivery !== undefined
    ? createLocusChannelCapability({
      locus: locusResolution,
      deliveries: {
        findByMessageId: messageId => locusRepository.findDeliveryByMessageId(messageId),
        getById: deliveryId => locusRepository.getDelivery(deliveryId),
        accept: input => locusRepository.acceptDelivery(input),
        bindQueued: input => locusRepository.bindQueued(input),
        bindTurn: input => locusRepository.bindTurn(input),
        settleByTurn: input => locusRepository.settleByTurn(input),
      },
      child: locusChildDelivery,
      receipts: (() => {
        const inProgressReactions = new Map<string, string>()
        return {
          markAccepted: async (target: { messageId: string }) => {
            const reactionId = await larkClient.addReaction(target.messageId, 'OnIt')
            if (reactionId !== undefined) inProgressReactions.set(target.messageId, reactionId)
          },
          markSettled: async (
            target: { messageId: string },
            outcome: 'settled' | 'failed',
          ) => {
            const reactionId = inProgressReactions.get(target.messageId)
            if (reactionId !== undefined) {
              inProgressReactions.delete(target.messageId)
              await larkClient.removeReaction(target.messageId, reactionId)
            }
            await larkClient.addReaction(
              target.messageId,
              outcome === 'settled' ? 'DONE' : 'CRY',
            )
          },
          sendControl: (target: { messageId: string }, text: string) =>
            larkClient.reply(target.messageId, text),
        }
      })(),
      renderPrompt: ({ locus, message }) => {
        const locusId = locus.id ?? locus.locusId
        if (locusId === undefined) throw new Error('Active locus is missing its durable id')
        const record = locusRepository.getLocus(locusId)
        if (
          record === undefined || record.state !== 'active' ||
          record.childSessionId !== locus.childSessionId ||
          record.generation !== locus.generation
        ) {
          throw new Error('Active locus changed before delivery prompt rendering')
        }
        return renderLocusDeliveryPrompt({
          endpoint: record.endpoint,
          locus: { locusId: record.id, generation: record.generation, state: record.state },
          main: { sessionId: record.parentSessionId },
          child: { sessionId: record.childSessionId },
          workspace: { workspaceId: record.workspaceId },
          permission: record.permission,
          contextAnchor: record.contextAnchor ?? { status: 'unknown' },
          request: {
            messageId: message.messageId,
            senderOpenId: message.senderOpenId,
            ...(message.senderName === undefined ? {} : { senderName: message.senderName }),
            text: message.text,
            ...(message.replyToMessageId === undefined
              ? {}
              : { replyToMessageId: message.replyToMessageId }),
            replyTarget: message.replyTarget,
          },
        })
      },
      turns: locusTurnObserver,
      ...(locusControlDispatch === undefined ? {} : { controlDispatch: locusControlDispatch }),
      // Admission is supplied by InboundPipeline for every event so its
      // watermark belongs to the currently connected subscription generation.
      log: (code: string) => ctx.logger.info(`dsh-pet locus channel: ${code}`),
    })
    : unavailableLocusChannelCapability(
      locusChannelGaps.length === 0
        ? 'Unified locus channel dependencies are incomplete.'
        : locusChannelGaps.join('; '),
    )
  if (locusChannel.status === 'unavailable') {
    ctx.logger.info(
      `dsh-pet: unified Feishu channel stays unavailable — ${locusChannel.diagnostic}`,
    )
  } else {
    ctx.effect(() => () => { locusChannel.controller.dispose() }, 'dsh-pet: locus channel controller')
  }

  if (locusTurnObserver !== undefined) {
    ctx.effect(() => () => { locusTurnObserver.dispose() }, 'dsh-pet: locus turn observer')
    // In production LocusChannelController is the sole turn-correlation
    // consumer: it binds, settles and emits the reaction as one ordered
    // operation. A second subscriber could win the settle race and make the
    // controller observe `changed:false`, silently omitting DONE/CRY.
    //
    // When the unified capability is unavailable no controller is subscribed.
    // Keep a ledger-only recovery consumer for already queued rows (for
    // example a Host downgraded before restart); it emits no reaction and
    // cannot race an active controller.
    if (locusChannel.status === 'unavailable') {
      ctx.effect(
        () => locusTurnObserver.subscribe((event) => {
          const persist = async (): Promise<void> => {
            await locusRepository.bindTurn({
              deliveryId: event.deliveryId,
              correlation: event.correlation,
              executionId: event.executionId,
              turnId: event.turnId,
              startedAt: Date.now(),
            })
            if (event.phase === 'started') return
            await locusRepository.settleByTurn({
              deliveryId: event.deliveryId,
              executionId: event.executionId,
              correlation: { ...event.correlation, turnId: event.turnId },
              outcome: event.phase === 'completed' ? 'settled' : 'failed',
              settledAt: Date.now(),
              ...(event.reason === undefined ? {} : { failureReason: event.reason }),
            })
          }
          void persist().catch((error: unknown) => {
            ctx.logger.info(
              `dsh-pet locus turn: could not recover ${event.phase} (${
                error instanceof Error ? error.message : String(error)
              })`,
            )
          })
        }),
        'dsh-pet: recover queued locus turn without channel controller',
      )
    }
  }

  /**
   * Owner-facing unified locus management.
   *
   * Composed unconditionally, because it is read-and-lifecycle only: the
   * bidirectional view, endpoint/parent/child discovery, and the durable
   * stop/archive/scope transitions all resolve from Pet's own store. Actions
   * that would create an external resource (bind, default Q&A, rebuild) are
   * deliberately NOT supplied, so those routes keep reporting themselves
   * unavailable instead of half-creating a group.
   *
   * Session and workspace metadata is resolved from the Host registries. A
   * fact the Host cannot resolve stays absent rather than being guessed from
   * an id, which is what keeps "missing" distinguishable from "unnamed".
   */
  const describeSession = (sessionId: string): {
    readonly title?: string
    readonly availability?: 'available' | 'archived' | 'missing'
  } | undefined => {
    const session = ctx.sessions.get(sessionId as never)
    if (session === undefined) {
      // Absent from the live registry only proves it is not loaded. The
      // workspace's archived account is the durable evidence.
      const archived = (ctx.workspaceRegistry.archivedSessionIds ?? []) as readonly unknown[]
      return archived.some(id => String(id) === sessionId)
        ? { availability: 'archived' }
        : { availability: 'missing' }
    }
    // The title lives in the session log via the title service. A session
    // header has no `title`, so reading one there yields `undefined` for
    // EVERY session — the exact failure that once made every bound group
    // display the same fallback name.
    const resolved: unknown = ctx.sessionTitle.get(session)
    const title = typeof resolved === 'string' && resolved.trim() !== '' ? resolved : undefined
    return {
      availability: 'available',
      ...(title === undefined ? {} : { title }),
    }
  }

  let locusManagement!: ReturnType<typeof createLocusManagementPort>
  locusManagement = createLocusManagementPort({
    repository: locusRepository as never,
    resolvers: {
      main: describeSession,
      child: describeSession,
      workspace: (id) => {
        const workspace = ctx.workspaceRegistry.get(id as never) as
          | { title?: unknown; path?: unknown }
          | undefined
        if (workspace === undefined) return undefined
        return {
          ...(typeof workspace.title === 'string' ? { title: workspace.title } : {}),
          // Display-only. It is never an execution-root authorization: a
          // confirmed anchor is a separate, independently proven fact.
          ...(typeof workspace.path === 'string' ? { path: workspace.path } : {}),
        }
      },
    },
    ...(locusPermissionMutation === undefined ? {} : { permissionMutation: locusPermissionMutation }),
    ...(locusProvisioningController === undefined
      ? {}
      : {
        actions: {
          bind: async (request) => {
            const endpoint = request.endpoint.threadId === undefined
              ? { chatId: request.endpoint.chatId }
              : { chatId: request.endpoint.chatId, threadId: request.endpoint.threadId }
            const before = locusRepository.getLatestLocusByEndpoint(endpoint)
            const result = endpoint.threadId === undefined
              ? await locusProvisioningController.ensureGroup({
                chatId: endpoint.chatId,
                parentSessionId: request.parentSessionId,
              })
              : await locusProvisioningController.ensureTopic({
                chatId: endpoint.chatId,
                threadId: endpoint.threadId,
                parentSessionId: request.parentSessionId,
              })
            const view = await locusManagement.view()
            const locus = view.loci.find(item => item.locusId === result.locus.locusId)
            const previousLocus = before === undefined
              ? undefined
              : view.loci.find(item => item.locusId === before.id)
            if (locus === undefined) {
              throw new PetError('INTERNAL', 'Bound locus is absent from the durable view')
            }
            return {
              action: 'bind' as const,
              locus,
              ...(previousLocus === undefined ? {} : { previousLocus }),
              created: result.created,
              reused: result.reused,
              ...('warningText' in result && typeof result.warningText === 'string'
                ? { warningText: result.warningText }
                : {}),
            }
          },
          defaultQa: async (request) => {
            const ownerId = repository.getChannelConfig().allowOpenIds[0]
            if (ownerId === undefined) {
              throw new PetError('BINDING_INVALID', 'Pet allowlist 为空，无法确认默认 Q&A 群主。')
            }
            const result = await locusProvisioningController.createOrOpenDefaultQa({
              parentSessionId: request.parentSessionId,
              ownerId,
              ...(request.groupName === undefined ? {} : { groupName: request.groupName }),
            })
            const view = await locusManagement.view()
            const locus = view.loci.find(item => item.locusId === result.locus.locusId)
            if (locus === undefined) {
              throw new PetError('INTERNAL', 'Default Q&A locus is absent from the durable view')
            }
            return {
              action: 'default-qa' as const,
              locus,
              created: result.created,
              reused: result.reused,
            }
          },
          rebuild: async (request) => {
            const rebuilt = await locusProvisioningController.rebuildExplicit({
              endpoint: request.endpoint,
              previousLocusId: request.expectedLocusId!,
              parentSessionId: request.parentSessionId,
              ...(request.asDefaultQa === undefined ? {} : { asDefaultQa: request.asDefaultQa }),
            })
            const view = await locusManagement.view()
            const locus = view.loci.find(item => item.locusId === rebuilt.locus.locusId)
            const previousLocus = view.loci.find(item => item.locusId === rebuilt.previousLocus.locusId)
            if (locus === undefined || previousLocus === undefined) {
              throw new PetError('INTERNAL', 'Rebuilt locus generations are absent from the durable view')
            }
            return {
              action: 'rebuild' as const,
              locus,
              previousLocus,
              created: true,
              reused: false,
            }
          },
        },
      }),
    // Host service identity authorizes this loopback/same-origin management
    // surface. Resource ownership (for Q&A) is resolved separately from the
    // explicitly configured primary allowlist and never from the browser.
    identity: () => ({ actorId: 'host:dsh-pet' }),
  })

  // Q&A ownership uses the configured primary allowlist identity, the same
  // explicit owner contract the retired QA action used. It is Host-derived;
  // browser requests carry no actor/open_id and cannot choose another owner.
  ctx.effect(
    () =>
      capabilities.registerBuiltin({
        id: QA_GROUP_ACTION_ID,
        label: '答疑群',
        description: '通过统一 locus default-Q&A 创建或打开本会话的答疑入口。',
        probe: () => {
          if (locusProvisioningController === undefined) return '统一 locus 创建能力不可用。'
          if (repository.getChannelConfig().allowOpenIds[0] === undefined) {
            return '请先在 Pet 设置中配置本人为首位 allowlist 成员。'
          }
          return undefined
        },
      }),
    'dsh-pet: locus default-Q&A builtin action',
  )

  // Project Task/Invocation state from the durable session event firehose.
  // Without this nothing ever settles an Invocation: it would stay `running`
  // forever even after its turn completed.
  // The Lark channel. Unified locus is the only production Feishu execution
  // path. If its capability gates are open, ChannelService refuses enablement
  // and every inbound event fails closed; no legacy root/Invocation/QA branch
  // is wired as a fallback.
  const channel = new ChannelService({
    repository,
    coordinator,
    client: larkClient,
    ...(locusChannel.status === 'available'
      ? {
        locusController: locusChannel.controller,
        locusAuthorization,
        ...(locusProvisioningController === undefined
          ? {
            botLifecycleDiagnostic:
              'Bot-added initialization is unavailable; first allowlist @ will initialize the locus.',
          }
          : {
            botLifecycleInitializer: {
              ensureAuthorizedChat: async ({ chatId }: { chatId: string }) => {
                await locusProvisioningController.ensureGroup({ chatId })
              },
            },
          }),
        unifiedLocusReadiness: {
          childSession: 'verified' as const,
          defaultPermission: 'read' as const,
          readVerification: 'verified' as const,
        },
      }
      : {
        locusDiagnostic: locusChannel.diagnostic,
        unifiedLocusReadiness: {
          childSession: 'unavailable' as const,
          defaultPermission: 'read' as const,
          readVerification: 'unavailable' as const,
          diagnostic: locusChannel.diagnostic,
        },
      }),
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

  // Retire old Feishu Invocation work before draining ordinary Pet queues.
  // The retained invocation_channel row is history plus a cutover classifier;
  // it is never permission to dispatch the old root-executor path again.
  for (const task of repository.listTasks()) {
    if (task.archivedAt !== undefined) continue
    const legacy = repository.listInvocations(task.id).filter(invocation =>
      repository.getInvocationChannel(invocation.id) !== undefined &&
      (invocation.status === 'queued' ||
        invocation.status === 'dispatching' ||
        invocation.status === 'running' ||
        invocation.status === 'waiting-user' ||
        invocation.status === 'recovering'),
    )
    for (const invocation of legacy) {
      await repository.updateInvocation(invocation.id, invocation.revision, current => ({
        ...current,
        status: 'failed',
        errorSummary: '旧飞书 Invocation 已在统一 locus 破坏性切换中停止；未自动重放。',
      }))
      await repository.markChannelSettled(invocation.id)
    }
    if (legacy.length > 0) {
      await repository.setTaskStatus(
        task.id,
        'failed',
        '旧飞书在途工作已停止并标记待核查；不会进入统一 locus 或自动重放。',
      )
      continue
    }
    // Reconciliation frees ordinary wheel slots; those still resume normally.
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
    // Owner-facing locus view/discovery and durable lifecycle transitions.
    // The identity is Host-derived; routes reject any actor a browser sends.
    locus: locusManagement,
    locusIdentity: () => ({ actorId: 'host:dsh-pet' }),
    // One chain per current generation, assembled from durable records only.
    // Retired generations are omitted: the owner is diagnosing what an entry
    // does now, and listing superseded rows would obscure that.
    locusDiagnostics: () => locusRepository
      .listLoci()
      .filter(record => record.state === 'active' || record.state === 'invalid')
      .map(record => buildLocusDiagnostics(record, locusRepository.listDeliveries(record.id))),
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
