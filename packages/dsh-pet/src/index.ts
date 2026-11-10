/**
 * DSH Pet Host entry.
 *
 * `apply` stays registration-only: the Pet Host runs as a service inside the
 * existing `dsh web` Node process, so any synchronous throw here would abort
 * unrelated DSH capabilities. Every fallible asynchronous initialization step
 * is contained by the lifecycle machine and degrades Pet alone.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { TodoRecord } from './host/ledger/todo.js'
import type { PetTodoView } from './wire.js'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-title'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { reconcileArchives, registerArchiveObserver, type ArchiveSink } from './host/archive.js'
import { verifyBackendOwnership, verifyDatabaseLocation } from './host/backend.js'
import { PetChangeFeed } from './host/changes.js'
import { CapabilityRegistry } from './host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from './host/capture.js'
import { PetCoordinator, type PromptDispatcher } from './host/coordinator.js'
import { FollowupCoordinator, isClientUserMessage } from './host/followup.js'
import {
  reconcileCreatingExecutors,
  validateModelSelection,
  type AgentRegistryLike,
  type PetModelSelection,
} from './host/executor.js'
import { PetError } from './host/errors.js'
import { PetLifecycleMachine } from './host/lifecycle.js'
import { withOfflinePetStateMigrationGuidance } from './host/migration-guidance.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from './host/paths.js'
import { rebuildProjection } from './host/projection.js'
import { PetRepository } from './host/repository.js'
import { ChannelService } from './host/channel/service.js'
import { createLarkCliClient, createLocusLarkPort } from './host/channel/lark.js'
import { createLocusMediaPort, sweepMediaSpool, type LocusMediaPort } from './host/channel/media.js'
import { resolvePetLarkCliCompat } from './host/channel/lark-cli-compat.js'
import { createPetRoutes } from './host/routes.js'
import { withBrowserAuth } from './host/http.js'
import { createPetEnvContributor } from './host/shell-env.js'
import { createPetSkillProvider, resolveInvocationSkill } from './host/skill-provider.js'
import { createWorktreeProvider } from './host/worktree-adapter.js'
import { loadWorktreeStatus } from './host/worktree-status.js'
import { registerPetTools, registerPetLocusMainTools } from './host/tools.js'
import { SharedFactLedgerStore } from './host/ledger/store.js'
import { legacyTodoBackend } from './host/ledger/backend.js'
import { projectTodoForOwner } from './host/ledger/owner-view.js'
import { createOwnerLedger } from './host/ledger/owner-ledger.js'
import { LocusCollab, type LocusMainRef } from './host/collab/locus-collab.js'
import type { LocusMainToolsDeps, SubagentMessenger, WorkHistoryEvent } from './host/collab/locus-tools.js'
import { CollabTodoBackend } from './host/collab/todo-backend.js'
import type { TodoBackend } from './host/ledger/backend.js'
import type { CollabService } from './host/collab/types.js'
import {
  acceptTodo,
  type AcceptTodoDeps,
  type TodoDispatchPort,
} from './host/ledger/dispatch.js'
import type {
  PetLocusFinishInput,
  PetLocusFinishResult,
  PetLocusWaitInput,
  PetLocusWaitResult,
} from './host/tools.js'
import {
  DEFAULT_DELIVERY_LEASE_MS,
  MAX_DELIVERY_LEASE_MS,
  type DeliveryCorrelation,
  type DeliveryFinishInput,
  type DeliveryRecord,
} from './host/locus/delivery.js'
import { createExpiryScheduler } from './host/locus/expiry-scheduler.js'
import { createRefusedReplyTracker } from './host/locus/refused-reply.js'
import { createDisplayCache } from './host/locus/display-cache.js'
import { StopPreparation, PET_PREPARE_STOP_ROUTE, publishStopDescriptor, releaseStopDescriptor } from './host/locus/stop-preparation.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { petRoute } from './host/http.js'
import { resumeModelFor } from './host/inquiry/resume-model.js'
import {
  proveStartupDeliveryFromColdRead,
  type LocusSessionQueryLike,
} from './host/locus/startup-recovery.js'
import {
  createLocusChildAdapter,
  applyLocusInheritedToolCeiling,
  probeLocusChildPorts,
  type LocusHostContextLike,
} from './host/locus/child.js'
import { createLocusChildDelivery } from './host/locus/child-delivery.js'
import { createLocusLazyChildCreator } from './host/locus/lazy-child.js'
import { createFirstPromptRegistry } from './host/locus/first-prompt.js'
import { createFirstDeliveryPublication } from './host/locus/first-delivery-publication.js'
import { createDeliveryExecutionProof, type RefusedReplyExecutionProof } from './host/locus/delivery-execution-proof.js'
import { areLocusPresetsDeclared, LOCUS_BASE_PRESET } from './host/locus/preset.js'
import {
  createLocusChannelCapability,
  unavailableLocusChannelCapability,
} from './host/channel/locus-capability.js'
import { createLocusTurnObserver } from './host/locus/turn-observer.js'
import {
  entranceReadProbeFor,
  measureEntranceReadability,
} from './host/channel/entrance-capability.js'
import { createLocusManagementPort, createLocusSessionDescriber, type LocusSessionPeek } from './host/locus/management.js'
import { createLocusResolution } from './host/locus/resolution.js'
import { peekTitleFromProjection } from './host/locus/session-peek.js'
import { attestLocusMainSurface, foldLocusMainSettings, isUsableLocusMainSession, LOCUS_MAIN_DENIED_TOOLS } from './host/locus/locus-main.js'
import { createLocusController, type EnsureGroupResult, type EnsureTopicResult } from './host/locus/controller.js'
import { createProductionLocusDshPort } from './host/locus/dsh-port.js'
import { buildLocusDiagnostics } from './host/locus/diagnostics.js'
import { reconcileLocusChildren, recoverLocusStartupV20, type ReconcileRow, type StartupCompensatorsV20 } from './host/locus/reconcile.js'
import {
  createPrepublicationCompositionLookup,
  LocusPrepublicationStagingRegistry,
} from './host/locus/prepublication-staging.js'
import { createDurableLocusAuthorizationResolver, type LocusAuthorizationStore } from './host/locus/admission.js'
import { createLocusControlDispatcher, locusSessionIdMatchesPrefix } from './host/locus/control.js'
import { createLocusAccessMutation } from './host/locus/access-mutation.js'
import type { LocusAccessModeV20 } from './host/locus/contract-v20.js'
import { handleLocusAgentCreated } from './host/locus/agent-created.js'
import { LocusRepositoryV20 } from './host/locus/persistence-v20.js'
import { asLocusContextRepository, type LocusContextRepository } from './host/locus/context-repository.js'
import { isDocEndpoint, parseDocChatId } from './host/locus/doc-endpoint.js'
import { createDocControlMessenger, DOC_DISCLOSURE_TEXT, finishDocReply, reactOnDocTrigger, sendDocControlReceipt } from './host/channel/doc-comment-egress.js'
import { renderLocusDeliveryFor } from './host/locus/context.js'
import { createLocusHistoryCursor } from './host/locus/history-cursor.js'
import {
  composeLocusChild,
  LOCUS_FULL_ACCESS_TOOL_NAMES,
  type LocusCandidateAgent,
  type LocusCompositionPorts,
} from './host/locus/composition.js'
import { installLocusProjectReadGuard, locusDeniedRoots } from './host/locus/project-read-guard.js'
import { locusLarkCliOutboundGuard } from './host/locus/lark-cli-egress-guard.js'
import { currentAllowlist } from './host/skill-provider.js'
import { PET_DOMAIN_NAME } from './host/spec.js'
import { petDomainSpec } from './host/domain.js'
import { withAtomicWrites } from './host/storage/atomic-domain.js'
import { PET_BACKEND_NAME } from './host/storage/backend.js'
import { createSessionInspector } from './host/session-inspection.js'
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
  // Raw WebServer routes do not inherit DSH browser-session auth. Requiring
  // Connection lets every Pet management route use its official fence.
  'connection',
]

/** Pet Host plugin configuration. */
export interface Config {
  /** Explicit DSH home override; defaults to the ambient harness home. */
  readonly home?: string
  /** Package version recorded as built-in provenance. */
  readonly version?: string
}

/**
 * Operator-facing Pet log line.
 *
 * Deliberately `console`, not `ctx.logger`: under `dsh web` the Host logger's
 * output does not reach `$DSH_HOME/dsh.log`, while plugin stdout/stderr does.
 * These diagnostics exist to be read during an incident, so they are written
 * where an operator can actually grep them. The prefix makes
 * `grep '\[dsh-pet\]'` return Pet's own records rather than unrelated stack
 * frames that merely mention the package path.
 * @param message - Operator-facing text; must not contain secrets.
 */
function petLog(message: string): void {
  console.log(`[dsh-pet] ${message}`)
}

/**
 * Operator-facing Pet warning; same sink and reasoning as {@link petLog}.
 * @param message - Operator-facing text; must not contain secrets.
 */
function petWarn(message: string): void {
  console.warn(`[dsh-pet] ${message}`)
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
  // Route every contained failure to the DSH log. Without this a step that
  // aborts initialization before `createPetRoutes` runs is invisible: each Pet
  // route answers 405, the Web client can only say "not registered", and no
  // record exists anywhere of which step actually failed.
  //
  // `console.warn`, NOT `ctx.logger`: under `dsh web` the Host's logger output
  // does not reach `$DSH_HOME/dsh.log`, while stderr from the plugin process
  // does. An operator-facing failure that only a debugger can read is the same
  // blind spot this reporter exists to remove, so the sink is chosen for where
  // it actually lands rather than for looking idiomatic.
  const lifecycle = new PetLifecycleMachine(diagnostic => {
    petWarn(`degraded: ${withOfflinePetStateMigrationGuidance(diagnostic)}`)
  })
  const paths = resolvePetPaths(config.home)

  ctx.effect(() => () => {
    lifecycle.markStopping()
  }, 'dsh-pet: contained Host lifecycle')

  // Fire-and-forget by design: a rejected initialization degrades Pet through
  // the lifecycle machine instead of rejecting the Host's plugin apply.
  const progress = { liveWorkStarted: false }
  const initialization = initialize(ctx, lifecycle, paths, config, progress).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    // `markDegraded` now reports through the sink above, so logging here too
    // would duplicate the line for this one path while leaving every contained
    // step unlogged.
    lifecycle.markDegraded(`Pet initialization failed: ${reason}`)
  })
  // A degraded start that ended BEFORE anything could own live work still
  // answers the launcher's safe-stop protocol (otherwise the next restart
  // treats the Host as legacy). Past that point the honest answer is legacy.
  void initialization.then(async () => {
    if (lifecycle.state.phase !== 'degraded' || progress.liveWorkStarted) return
    await publishDegradedStopper(ctx, paths)
  }).catch((error: unknown) => petWarn(`degraded stop discovery unavailable: ${error instanceof Error ? error.message : String(error)}`))
}

/** No-op stop preparation for a degraded Pet that has no intake, dispatch or owned children. */
async function publishDegradedStopper(ctx: Context, paths: PetPaths): Promise<void> {
  const controlPort = ctx.webServer.port
  const profileName = ctx.get('profileContext')?.name
  if (!(typeof controlPort === 'number' && Number.isInteger(controlPort) && controlPort > 0 && typeof profileName === 'string' && typeof ctx.connection.authenticatedUrl === 'function')) return
  const identity = { hostPid: process.pid, bootId: randomUUID() }
  const preparation = new StopPreparation(identity, { freeze: async () => {}, drain: async () => {}, resume: async () => {} })
  ctx.effect(() => () => preparation.dispose(), 'dsh-pet: degraded shutdown preparation')
  const origin = `http://127.0.0.1:${controlPort}`
  await publishStopDescriptor(paths.dshHome, controlPort, {
    v: 1, pid: identity.hostPid, bootId: identity.bootId, profile: profileName,
    origin, authenticatedUrl: ctx.connection.authenticatedUrl(origin),
  })
  ctx.effect(() => () => releaseStopDescriptor(paths.dshHome, controlPort, identity.bootId), 'dsh-pet: release degraded shutdown discovery')
  const route = petRoute(PET_PREPARE_STOP_ROUTE, ({ body }) => preparation.request(body))
  ctx.effect(() => {
    const protectedRoute = withBrowserAuth(route, ctx.connection)
    return ctx.webServer.register({ kind: 'exact', path: protectedRoute.path, handler: protectedRoute.handler })
  }, `dsh-pet: ${route.path}`)
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
  progress: { liveWorkStarted: boolean } = { liveWorkStarted: false },
): Promise<void> {
  const directories = await lifecycle.contain('Pet state directories', async () => {
    await ensurePetDirectories(paths)
    return true
  })
  if (directories === undefined) return

  // Do not open Pet's SQLite file directly from Host initialization. The
  // bundle's dedicated backend is already constructed with
  // `locking_mode = EXCLUSIVE` before this plugin's `apply` runs, so a second
  // connection from this process is guaranteed to fail. Historical schema
  // transitions that require file-level access are explicit offline cutovers;
  // normal startup only opens the CURRENT domain through its owning backend.

  // Ownership before records: routing is by backend NAME, so a foreign
  // composition owning `sqlite` would silently capture Pet's data.
  const ownership = await verifyBackendOwnership(ctx, paths)
  if (!ownership.ok) {
    lifecycle.markDegraded(ownership.diagnostic ?? 'Pet storage backend ownership unproven')
    return
  }

  const domain = await lifecycle.contain('Pet storage domain', () =>
    ctx.storageDomain.open(petDomainSpec),
  )
  if (domain === undefined) return

  // Atomic writes commit through the very unit the domain layer just opened,
  // so the transaction runs on the connection that already holds the exclusive
  // lock — the `dsh-pet-storage` row owns that backend instance and this reads
  // it back from the hub rather than constructing a second one.
  //
  // A backend that is not Pet's own (or a unit that is not open) leaves
  // `supportsTransaction` false, and every store then refuses its writes.
  // That is the correct fail-closed outcome: the ownership proof above already
  // established this is Pet's backend, so reaching here without a unit means
  // something is wrong enough that silently degrading to per-record writes
  // would be worse than refusing.
  const petBackend = ctx.storage.backend.get(PET_BACKEND_NAME) as unknown as {
    unitFor?: (name: string) => Promise<{ applyBatch(writes: readonly never[]): Promise<void> } | undefined>
  }
  withAtomicWrites(domain as never, await petBackend.unitFor?.(PET_DOMAIN_NAME) as never)

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
  const locusRepository = new LocusRepositoryV20(domain, { now: () => Date.now() })
  // ONE allocator of reserved child session ids: the controller, every reset /
  // rotation and the first-creation publication share it (ids are never reused).
  const reserveLocusChildSessionId = (): string => `session-${randomUUID()}`
  // Startup gate (v20 set invariants): a stored set with a topic row lacking its
  // group row, a duplicate sessionId, or more than one default Q&A per M must
  // not become ready. Degrading here registers no routes and opens no intake;
  // the diagnostic names every offending key.
  if (await lifecycle.contain('Locus set invariants', async () => { locusRepository.assertLocusSetValid(); return true }) === undefined) return
  // Startup recovery is deliberately deferred until the exact child runtime,
  // turn observer and operation-owned compensation ports have been composed.
  // Running it here with no options would persist manual debt before the Host
  // has had a chance to prove a live turn or safely compensate owned resources.
  // Shared by scoped locus replies, control receipts, and channel probes. It is
  // fixed to the dsh-pet profile and bot identity by the Lark adapter.
  // Pet's namespaced logger is passed through so fail-soft channel
  // degradations (mention rendering, member reads) are greppable in dsh.log
  // instead of silent.
  const larkClient = createLarkCliClient(undefined, undefined, petLog)
  // Continuation cursors for the caller-bound entrance read. The signing key is
  // per-process on purpose: after a restart an old cursor is refused instead of
  // being honoured against a target binding that no longer exists.
  const locusHistoryCursor = createLocusHistoryCursor()
  // Media is available only through the pinned official CLI writing into Pet's
  // own spool. The spool is swept first: at this moment no download can be in
  // flight, so anything left in it is debris from a crash and must never be
  // read as one.
  const swept = await sweepMediaSpool(paths.mediaSpoolRoot)
  if (swept > 0) petLog(`dsh-pet: swept ${swept} leftover media spool entr${swept === 1 ? 'y' : 'ies'}`)
  let locusMediaDownload: Awaited<ReturnType<typeof resolvePetLarkCliCompat>> | undefined
  try {
    locusMediaDownload = await resolvePetLarkCliCompat({ spoolRoot: paths.mediaSpoolRoot })
  } catch (error) {
    petLog(`dsh-pet: lark media downloader unavailable (${error instanceof Error ? error.message : String(error)})`)
  }
  const locusMedia: LocusMediaPort = createLocusMediaPort({
    attachments: ctx.get('attachments') as never,
    ...(locusMediaDownload === undefined ? {} : { download: locusMediaDownload }),
  })
  let currentLocusTurnProof: (childSessionId: string) =>
    | { readonly executionId: string; readonly turnId: string }
    | undefined = () => undefined
  type CurrentLocusCapabilityProjection = {
    readonly deliveryId: string
    readonly executionId: string
    readonly turnId: string
    readonly source: 'delivery' | 'agent-message'
    readonly locusId?: string
    readonly sessionId?: string
  }
  let currentLocusCapability: (childSessionId: string) => CurrentLocusCapabilityProjection | undefined = () => undefined
  let inspectCurrentLocusCapability: (childSessionId: string) =>
    | { readonly ok: true; readonly capability: CurrentLocusCapabilityProjection }
    | { readonly ok: false; readonly reason: import('./host/locus/turn-observer.js').LocusCurrentCapabilityReason } =
      () => ({ ok: false, reason: 'capability-unavailable' })
  const locusDispatchLanes = new Map<string, Promise<void>>()
  const locusDispatchKey = (correlation: DeliveryCorrelation): string => [
    correlation.locusId,
    correlation.sessionId,
    correlation.endpoint.chatId,
    correlation.endpoint.threadId ?? '',
  ].join('\u0000')
  const withLocusDispatchLane = <T>(correlation: DeliveryCorrelation, operation: () => Promise<T>): Promise<T> => {
    const key = locusDispatchKey(correlation)
    const previous = locusDispatchLanes.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    const tail = next.then(() => undefined, () => undefined)
    locusDispatchLanes.set(key, tail)
    void tail.then(() => {
      if (locusDispatchLanes.get(key) === tail) locusDispatchLanes.delete(key)
    })
    return next
  }
  let finishCurrentDelivery: (input: PetLocusFinishInput) => Promise<PetLocusFinishResult> = async () => {
    throw new PetError('INTERNAL', 'The Host has no durable Delivery finish capability.')
  }
  let waitCurrentDelivery: (input: PetLocusWaitInput) => Promise<PetLocusWaitResult> = async () => {
    throw new PetError('INTERNAL', 'The Host has no durable Delivery wait lease.')
  }
  let scheduleCurrentDelivery: (record: DeliveryRecord) => void = () => undefined
  let locusChannelController: {
    readonly currentFinished?: (input: {
      readonly deliveryId: string
      readonly correlation: DeliveryCorrelation
      readonly outcome?: 'settled' | 'failed'
    }) => void
    readonly dispatchNext?: (correlation: DeliveryCorrelation) => Promise<void>
    readonly freezeForShutdown?: () => Promise<void>
    readonly resumeAfterShutdown?: () => Promise<void>
    readonly runWhileActive?: <T>(operation: () => Promise<T>) => Promise<T>
  } | undefined
  // Nested calls inside an already-admitted mutation must not be refused
  // half-way by a freeze that is itself waiting for that mutation.
  const admittedLocusMutation = new AsyncLocalStorage<true>()
  const runLocusMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (admittedLocusMutation.getStore() === true) return operation()
    try {
      return await (locusChannelController?.runWhileActive === undefined
        ? admittedLocusMutation.run(true, operation)
        : locusChannelController.runWhileActive(() => admittedLocusMutation.run(true, operation)))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'LOCUS_SHUTDOWN_FROZEN') {
        throw new PetError('LOCUS_BUSY', 'Host 正在准备停机，请稍后重试。')
      }
      throw error
    }
  }
  const locusContextRepository = asLocusContextRepository(
    locusRepository,
    childSessionId => currentLocusTurnProof(childSessionId),
  )

  /**
   * Durable shared-fact ledger (`pet-locus-intent-triage`) over the same
   * opened domain. Constructed unconditionally for the same reason as the
   * inquiry ledger above: it proves the atomic-batch capability on every call
   * and rejects without it, so construction itself commits nothing.
   */
  const sharedFactLedgerStore = new SharedFactLedgerStore(domain as never)
  /**
   * The todo storage seam (`TodoBackend`, design D9). Writes go ONLY to the
   * Locus collaboration space (design D6/D10); the legacy store stays as the
   * read-only "旧版" source for todos registered before this change (the
   * management-panel merge is a later task group), and is never written.
   * `locusCollab` / `collabTodoBackend` are created further down, once the
   * locus repository projection exists; this indirection keeps declaration
   * order free.
   */
  /** Read-only "旧版" todos, merged into the owner panel (design D10). Never written. */
  const legacyTodos: TodoBackend = legacyTodoBackend(sharedFactLedgerStore)
  const todoBackend: TodoBackend = {
    registerTodoItem: input => collabTodoBackend.registerTodoItem(input),
    getTodoItem: itemId => collabTodoBackend.getTodoItem(itemId),
    listForParent: parentSessionId => collabTodoBackend.listForParent(parentSessionId),
    advanceStatus: (itemId, to, now) => collabTodoBackend.advanceStatus(itemId, to, now),
  }

  /**
   * Caller-bound intent-triage capability set, shared by BOTH composition
   * paths below (Pet's own executor setup and DSH's native agent load).
   *
   * Built once on purpose: a locus child that could register a todo through
   * one path but not the other is exactly the split surface the scoped
   * assembly pitfalls warn about, and it would be invisible to a unit test
   * that calls `registerPetTools` directly.
   *
   */
  const intentTriageDeps = {
    // The row whose `sessionId` is this child (unique across the table, D12),
    // with the M resolved. An ambiguous index throws; the resolver refuses it.
    loci: { findBySessionId: (id: string) => locusRepository.findBySessionId(id) },
    track: {
      store: todoBackend,
      now: () => Date.now(),
      newItemId: () => `todo-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    },
  }
  /**
   * The caller lookup of the locus tools that carry an ask reference
   * (`locus_ask_parent`, `locus_reply_child`): the same unique-sessionId row
   * lookup plus the durable current-Delivery read the reference is built from.
   */
  const locusAskLoci = {
    ...intentTriageDeps.loci,
    findCurrentSerializedDelivery: (input: { readonly locusId: string; readonly sessionId: string }) =>
      locusRepository.findCurrentSerializedDelivery(input),
  }
  let refusedReplies: ReturnType<typeof createRefusedReplyTracker> | undefined
  let deliveryExecutionProof = (_execution: ToolRunContext): RefusedReplyExecutionProof | undefined => undefined
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

  // From here Tasks may resume and dispatch can exist: a degraded exit after
  // this point must not claim a no-op stop is safe.
  progress.liveWorkStarted = true
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

  // Owner inquiry snapshots are read from the Pet Domain on demand. Refresh
  // subscribed owner clients only after committed changes to their source rows;
  // payloads are intentionally ignored.
  ctx.effect(() => ctx.on('domain/changed', change => {
    if (change.domain !== PET_DOMAIN_NAME) return
    if (!['inquiries', 'inquiry_handoffs', 'inquiry_answers', 'inquiry_results', 'inquiry_works'].includes(change.table)) return
    changes.publish()
  }), 'dsh-pet: publish committed inquiry projection changes')

  // Locus collaboration (`locus-three-tier-structure` D8). dsh-collab is an
  // OPTIONAL peer consumed through a dynamic inject, so Pet loads unchanged
  // without it. The space has exactly two ordinary members (work main and
  // locus main); Pet writes AS the locus main session through `actAs`.
  // Nothing here opens a turn or sends to Feishu.
  const locusMainDirectory = { list: (): readonly LocusMainRef[] => locusRepository.listMains() }
  const locusCollab = new LocusCollab({
    directory: locusMainDirectory,
    log: message => petLog(message),
  })
  const collabTodoBackend = new CollabTodoBackend({ collab: locusCollab, directory: locusMainDirectory })
  const ownerLedger = createOwnerLedger({
    collab: collabTodoBackend,
    legacy: legacyTodos,
    collabAvailable: () => locusCollab.currentHandle() !== undefined,
  })
  /**
   * The official `subagents.sendMessage` as the Locus tools see it. Resolved
   * per call so a service that registers late is still picked up; the sender
   * must be the exact live Agent executing the tool.
   */
  const officialSubagentMessenger = (): SubagentMessenger | undefined => {
    const service = ctx.get('subagents') as {
      sendMessage?: (sender: unknown, target: unknown, content: unknown, options: { signal: AbortSignal }) => Promise<unknown>
    } | undefined
    if (typeof service?.sendMessage !== 'function') return undefined
    return { sendMessage: (sender, target, content, options) => runLocusMutation(() => service.sendMessage!.call(service, sender, target, content, options)) }
  }
  /** Dependencies of the locus MAIN session's own tools (`locus_note`, `locus_reply_child`). */
  const locusMainToolsDeps: LocusMainToolsDeps = {
    loci: {
      findBySessionId: (id: string) => locusRepository.findBySessionId(id),
      findCurrentSerializedDelivery: locusAskLoci.findCurrentSerializedDelivery,
      listEntryEndpointsOfMain: (locusMainSessionId: string) =>
        locusReconcileRows().filter(item => item.locusMainSessionId === locusMainSessionId).map(item => item.row.endpoint),
    },
    collab: locusCollab,
    subagents: officialSubagentMessenger,
    /**
     * `locus_work_history`. The target is never an argument: it is the work
     * session of the caller's ACTIVE `locus_mains` pairing. Status is the
     * two-valued `idle`/`unknown` (a NEW helper: the child helpers above treat
     * "not in memory" as not idle, which is the opposite of what this needs to
     * say about a cold session being unknown rather than busy).
     */
    workHistory: {
      pairedWorkSessionOf: (locusMainSessionId: string) => {
        const main = locusRepository.findMain(locusMainSessionId)
        return main?.status === 'active' ? main.workSessionId : undefined
      },
      readLive: (workSessionId: string) => {
        const session = ctx.sessions.get(workSessionId as never)
        if (session === undefined) return undefined
        type InboxLike = { readonly nextTurn?: unknown; readonly nextStep?: unknown }
        const handle = ctx.agents.get(workSessionId as never) as { agent?: { inbox?: InboxLike }; inbox?: InboxLike } | undefined
        const inbox = ((handle?.agent ?? handle) as { inbox?: InboxLike } | undefined)?.inbox
        // Readable only when BOTH queues are real lists; anything else is "unknown", never "empty".
        const inboxPending = inbox !== undefined && Array.isArray(inbox.nextTurn) && Array.isArray(inbox.nextStep)
          ? inbox.nextTurn.length + inbox.nextStep.length > 0
          : undefined
        return { events: session.snapshotEvents() as readonly WorkHistoryEvent[], inboxPending }
      },
      readCold: async (workSessionId: string) => {
        const inspect = createSessionInspector(ctx.get('sessionQuery') as Parameters<typeof createSessionInspector>[0])
        if (inspect === undefined) throw new Error('sessionQuery.observeSession is unavailable')
        return (await inspect(workSessionId)).events as readonly WorkHistoryEvent[]
      },
    },
  }
  const locusMainScopes = new WeakSet<object>()
  const livePresetFor = (sessionId: string): string | undefined => {
    const session = ctx.sessions.get(sessionId as never)
    if (session === undefined) return undefined
    let preset = agentPresetProjectionDefinition.init(session.header)
    for (const event of session.snapshotEvents()) {
      preset = agentPresetProjectionDefinition.apply(preset, event)
    }
    return typeof preset === 'string' ? preset : undefined
  }
  const installLocusMainScope = (scope: Context, sessionId: string): void => {
    if (locusMainScopes.has(scope)) return
    const tools = scope.get('tools') as {
      restrict?: (filter: { deny: readonly string[] }) => () => void
      guard?: (guard: (exec: { name: string }) => string | undefined) => () => void
    } | undefined
    if (typeof tools?.restrict !== 'function' || typeof tools.guard !== 'function') {
      throw new PetError('INTERNAL', 'Agent-scoped tools.restrict/guard is unavailable')
    }
    // restrict only accepts GLOBAL names; absent or scope-local names are
    // rejected by the runtime. Scoped registrations (Agent Team mounts its
    // tools into every ordinary root) stay visible, so the guard below is what
    // refuses them, together with every other denied name.
    const global = new Set(['bash', 'write', 'edit', ...ctx.tools.schemas().map(tool => tool.name)])
    tools.restrict({ deny: LOCUS_MAIN_DENIED_TOOLS.filter(name => global.has(name)) })
    const denied = new Set(LOCUS_MAIN_DENIED_TOOLS)
    tools.guard(exec => denied.has(exec.name) ? 'Locus 主会话只做协调，不能调用该工具' : undefined)
    registerPetLocusMainTools(scope, locusMainToolsDeps)
    locusMainScopes.add(scope)
  }
  ctx.inject(['dshCollab'], collabCtx => {
    collabCtx.effect(() => {
      const detach = locusCollab.attach((collabCtx as unknown as { dshCollab: CollabService }).dshCollab)
      // Spaces that already exist on disk are recognized, never created here.
      for (const ref of locusMainDirectory.list()) {
        void locusCollab.probe(ref).catch(error => petWarn(`dsh-pet collab: probe failed: ${String(error)}`))
      }
      return () => { detach() }
    }, 'dsh-pet: attach pet-locus to dsh-collab')
  })

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
    petLog('dsh-pet: shellEnv unavailable; DSH_PET_* variables are not injected')
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
      petWarn(
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
  /** In-flight async inject callbacks, deduplicated per fresh Agent scope. */
  const composingAgents = new WeakMap<object, Promise<void>>()
  const scopeComplete = (key: object, includeAllowlist: boolean): boolean =>
    contextToolAgents.has(key) && (!includeAllowlist || allowlistAgents.has(key))

  /**
   * In-session follow-up registrations, published once the coordinator exists.
   *
   * Declared here rather than next to its construction because the scoped
   * `pet_context` surface (installed during Agent composition) waits on it,
   * and that can run before the later wiring completes.
   */
  let followups: FollowupCoordinator | undefined
  /** Resolves when pending Invocation-state projections for a session are durable. */
  let projectionSettled: (sessionId: string) => Promise<void> = () => Promise.resolve()

  /** Install the Pet-owned scoped surface on one live executor Agent.
   *
   * Every Pet Task executor receives `pet_context`. Only the dedicated Pet
   * executor form also receives the allowlist Skill provider; a
   * workspace-resident executor deliberately uses its workspace's Skills.
   * The marker makes repeated installation idempotent without swallowing a
   * duplicate-registration error. The returned promise settles only after
   * every `inject()` fiber has run its callback and the markers are true.
   */
  const installPetScope = (agentCtx: unknown, includeAllowlist: boolean): Promise<void> => {
    const scoped = agentCtx as Context
    const key = scoped as unknown as object
    if (scopeComplete(key, includeAllowlist)) return Promise.resolve()
    const existing = composingAgents.get(key)
    if (existing !== undefined) {
      return existing.then(() => installPetScope(scoped, includeAllowlist))
    }

    const pending: Promise<void>[] = []
    // Agent contexts are fresh fibers and do not inherit this plugin's inject
    // grants. `inject()` schedules its callback asynchronously, so setup must
    // await an explicit callback-owned promise — checking a WeakSet directly
    // after `inject()` is guaranteed to race on the real Cordis runtime.
    if (includeAllowlist && !allowlistAgents.has(key)) {
      pending.push(new Promise<void>((resolve, reject) => {
        scoped.inject(['skills'], skillCtx => {
          try {
            skillCtx.effect(
              () =>
                skillCtx.skills.registerProvider(() => createPetSkillProvider(repository, paths)),
              'dsh-pet: scoped allowlist Skill provider',
            )
            allowlistAgents.add(key)
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      }))
    }

    // `tools.register()` chooses its layer from the CALLING context's scope
    // tag. Calling it on the Host silently publishes globally, which is the
    // original leak this change fixes.
    if (!contextToolAgents.has(key)) {
      pending.push(new Promise<void>((resolve, reject) => {
        scoped.inject(['tools'], toolCtx => {
          try {
            toolCtx.effect(
              () => registerPetTools(toolCtx, {
                repository,
                locusRepository: locusContextRepository,
                intentTriage: intentTriageDeps,
                locusChildTools: { loci: locusAskLoci, collab: locusCollab, subagents: officialSubagentMessenger },
                // A user message typed into this executor registers its
                // Invocation through the durable inbox splice, which can still
                // be landing when the turn's first step asks for context.
                waitForRegistration: executorSessionId =>
                  followups?.waitForRegistration(executorSessionId) ?? Promise.resolve(),
              }),
              'dsh-pet: scoped caller-bound Agent tools',
            )
            contextToolAgents.add(key)
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      }))
    }

    const ready = Promise.race([
      Promise.all(pending).then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new PetError(
          'INTERNAL',
          'Pet scoped surface dependencies did not become available',
        )), 5_000)
        timer.unref?.()
      }),
    ]).then(() => {
      if (!contextToolAgents.has(key) || (includeAllowlist && !allowlistAgents.has(key))) {
        throw new PetError('INTERNAL', 'Pet scoped surface dependencies were not installed')
      }
      composedAgents.add(key)
    }).finally(() => {
      composingAgents.delete(key)
    })
    composingAgents.set(key, ready)
    return ready
  }

  /** Mount the selected preset, then install the Pet-owned scoped surface.
   *
   * `meta.agentPreset` only records a name; actual composition requires
   * `agentPresets.mount` inside setup. Preset mounting must happen before
   * scoped providers are registered (see the integration pitfalls note).
   */
  const executorSetup = async (
    agentCtx: Context,
    _agent: import('@deepseek-ai/dsh-agent').Agent,
    presetId: string | undefined,
    includeAllowlist: boolean,
  ): Promise<void> => {
    await ctx.agentPresets.mount(agentCtx as never, presetId as never)
    await installPetScope(agentCtx, includeAllowlist)
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
    const view = agent as { id?: unknown; ctx?: unknown } | undefined
    const sessionId = view?.id
    if (typeof sessionId !== 'string' || view?.ctx === undefined) return
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
      petWarn(
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
  const firstPrompts = createFirstPromptRegistry({
    bindQueued: async (delivery, inboxMessageId) => {
      const bound = await locusRepository.bindQueued({
        deliveryId: delivery.deliveryId,
        ...delivery.correlation,
        executionId: delivery.executionId,
        inboxMessageId,
      })
      if (!bound.changed) throw new Error('First Delivery inbox binding was rejected')
    },
  })
  ctx.effect(
    () => () => { locusPrepublication.dispose() },
    'dsh-pet: dispose locus pre-publication staging',
  )
  // The lookup is the ONE D15 repository lookup `handleLocusAgentCreated` does;
  // it injects the answered composition per call.
  let locusCompositionPorts!: Omit<LocusCompositionPorts, 'lookup'>
  locusCompositionPorts = {
    // Durable rows serve restores; the one-shot staging fallback serves the
    // fresh `agent/created` emitted before active publication.
    parentPreset: livePresetFor,
    childPreset: livePresetFor,
    // The scoped surface is registered on the CHILD's own scope: resolving
    // `tools` from the Host scope would publish `pet_context` globally.
    surface: {
      install: (agent, composition) => {
        const scope = agent.scope as unknown as Context
        scope.on('tools/pre-execute', async (_exec, next) => {
          await firstPrompts.whenBound(agent.id)
          return next()
        })
        const tools = scope.get('tools') as {
          register(definition: unknown): unknown
          restrict?: (restriction: { allow?: readonly string[]; deny?: readonly string[] }) => () => void
        } | undefined
        if (tools === undefined) {
          throw new PetError('INTERNAL', 'Agent scope exposes no tools service')
        }
        // The inherited-tool ceiling. DSH 0.2.1 ignores a `toolFilter` on the
        // subagent start request, and a preset cannot hide tools that other
        // plugins register globally, so the allow list is applied here, on the
        // child's own scope, on every publication (creation and cold resume
        // both reach this boundary). It is the same primitive the runtime used
        // for the retired request field. A throw — including an allowed name the
        // child's preset does not provide — vetoes publication. The `write`/`edit`
        // half of the ceiling is the child preset itself (`locus-child`).
        applyLocusInheritedToolCeiling(tools)
        const childSession = ctx.sessions.get(agent.id as never)
        const parentSession = ctx.sessions.get(composition.locusMainSessionId as never)
        const sandboxPolicy = ctx.get('sandboxPolicy') as
          | { resolve?: (input: { session: unknown }) => { workspaceRoot?: string } | undefined }
          | undefined
        const childCwd = childSession?.header.cwd
        const parentCwd = parentSession?.header.cwd
        const workspaceRoot = childSession === undefined
          ? undefined
          : sandboxPolicy?.resolve?.({ session: childSession })?.workspaceRoot
        if (
          typeof childCwd !== 'string'
          || typeof parentCwd !== 'string'
          || typeof workspaceRoot !== 'string'
        ) {
          throw new PetError('INTERNAL', 'Exact child project-read roots are unavailable')
        }
        // A topic row stores no workspace: the project is the group row's.
        const entry = locusRepository.getLocus(composition.locusId)
        const groupRow = entry === undefined ? undefined : locusRepository.getRow({ chatId: entry.endpoint.chatId })
        const project = groupRow === undefined || !('workspaceId' in groupRow)
          ? undefined
          : ctx.workspaceRegistry.get(groupRow.workspaceId as never)
        if (project === undefined) throw new PetError('INTERNAL', 'Bound locus project workspace is unavailable')
        installLocusProjectReadGuard(scope, {
          childCwd,
          parentCwd,
          workspaceRoot,
          projectRoot: project.path,
          deniedRoots: locusDeniedRoots(paths),
        })
        registerPetTools(agent.scope as never, {
          repository,
          locusRepository: locusContextRepository,
          locusLifecycle: {
            locusRepository: locusContextRepository,
            lark: larkClient,
            currentCapability: childSessionId => currentLocusCapability(childSessionId),
            inspectCurrentCapability: childSessionId => inspectCurrentLocusCapability(childSessionId),
            inspectCurrentDeliveryAuthorization: input =>
              locusContextRepository.inspectCurrentDeliveryAuthorization?.(input) ??
              { ok: false as const, reason: 'capability-unavailable' as const },
            logAuthorizationRefusal: ({ operation, reason }) =>
              petLog(`dsh-pet locus authorization refused: ${operation}:${reason}`),
            onFinishRefused: execution => {
              const proof = deliveryExecutionProof(execution)
              if (!proof || proof.scope.kind !== 'child') return
              const associated = locusTurnObserver?.deliveryForTurn?.(proof.sessionId, proof.turn)
              if (!associated || associated.correlation.locusId !== proof.scope.locusId || associated.correlation.sessionId !== proof.scope.sessionId) return
              const current = locusRepository.getDelivery(associated.deliveryId)
              if (current?.status !== 'current' || current.sessionId !== proof.sessionId || current.executionId !== associated.executionId || current.locusId !== proof.scope.locusId || current.sessionId !== proof.scope.sessionId) return
              refusedReplies?.refused(current, proof.turn)
            },
            onDeliveryContinued: execution => {
              const proof = deliveryExecutionProof(execution)
              if (proof) refusedReplies?.continued(proof.sessionId, proof.turn)
            },
            // Delegate through mutable Host-owned closures. The scoped Agent
            // may be composed before the channel controller is published; the
            // wrapper must not capture the initial unavailable stub.
            finishCurrentDelivery: input => finishCurrentDelivery(input),
            waitCurrentDelivery: input => waitCurrentDelivery(input),
          },
          intentTriage: {
            ...intentTriageDeps,
            // `pet_locus_track` needs the same "there is exactly one current
            // Delivery" proof `pet_locus_finish` uses — reusing this exact
            // seam rather than a second, weaker resolver is what keeps a todo
            // from ever being attributed to a Delivery that is not current.
            currentCapability: childSessionId => currentLocusCapability(childSessionId),
            inspectCurrentCapability: childSessionId => inspectCurrentLocusCapability(childSessionId),
            inspectCurrentDeliveryAuthorization: input =>
              locusContextRepository.inspectCurrentDeliveryAuthorization?.(input) ??
              { ok: false as const, reason: 'capability-unavailable' as const },
            logAuthorizationRefusal: ({ operation, reason }) =>
              petLog(`dsh-pet locus authorization refused: ${operation}:${reason}`),
          },
          locusChildTools: { loci: locusAskLoci, collab: locusCollab, subagents: officialSubagentMessenger },
          // One read tool per child, by entry kind (D9/D10): a document child
          // gets the doc read and never the group-history read, and an IM child
          // never sees the doc read. Each is published only when the runtime
          // really has the port, so a tool that can never succeed never appears.
          // A fresh child is composed before its locus row exists, so the
          // endpoint comes from the composition first (production E2E,
          // 2026-10-18: the first doc child got the IM tool without this).
          ...(isDocEndpoint(composition.endpoint ?? locusRepository.getLocus(composition.locusId)?.endpoint ?? { chatId: '' })
            ? (larkClient.queryDocComment === undefined || larkClient.fetchDocMarkdown === undefined ? {} : {
              locusDocContext: {
                loci: intentTriageDeps.loci,
                currentMessageId: caller => locusRepository.listDeliveries(caller.locusId)
                  .find(record => record.sessionId === caller.childSessionId &&
                    (record.status === 'current' || record.status === 'finishing') &&
                    record.queueState === 'current')?.messageId,
                client: larkClient,
              },
            })
            : (larkClient.readEntranceHistory === undefined ? {} : {
              locusHistory: {
                loci: intentTriageDeps.loci,
                cursor: locusHistoryCursor,
                read: input => larkClient.readEntranceHistory!(input),
              },
            })),
        })
      },
      // D8: read-only denies the full-access tools; danger-full-access leaves the
      // surface unrestricted. Applied on EVERY assembly; there is no live switch
      // (the child is released before a change, so the next wake re-applies).
      applyAccessMode: (agent, mode) => {
        const scope = agent.scope as unknown as Context
        const tools = scope.get('tools') as {
          restrict?: (restriction: { deny: readonly string[] }) => () => void
        } | undefined
        if (typeof tools?.restrict !== 'function') {
          throw new PetError('INTERNAL', 'Agent-scoped tools.restrict is unavailable')
        }
        if (mode === 'read-only') tools.restrict({ deny: LOCUS_FULL_ACCESS_TOOL_NAMES })
      },
      // This guard is intentionally a mistake-prevention measure only. Shell
      // scripts, HTTP clients, copied binaries, and alternate spellings remain
      // outside its claim; ADR-0008 explicitly accepts that residual risk.
      installOutboundGuard: agent => {
        const scope = agent.scope as unknown as Context
        const tools = scope.get('tools') as {
          guard?: (guard: (exec: { name: string; arguments: unknown }) => string | undefined) => () => void
        } | undefined
        if (typeof tools?.guard !== 'function') {
          throw new PetError('INTERNAL', 'Agent-scoped tools.guard is unavailable')
        }
        scope.effect(
          () => tools.guard!(locusLarkCliOutboundGuard),
          'dsh-pet: locus Lark CLI outbound mistake-prevention guard',
        )
      },
      // The `tier3` composition claims this child cannot reach an execution or delegation
      // route, and only a read of what it can actually call supports that claim:
      // the tool filter restricts the inherited plane, so an own-plane
      // registration like the standard preset's `subagent` survives it.
      //
      // Both services are declared injections, so Pet cannot load without them
      // and the read cannot silently degrade to "no surface" for lack of one.
      //
      // The scope key must be the live Agent. Reading the tools service without
      // it reports the inherited surface only, which would hide exactly the
      // registrations this check exists to find. `agents.get` is safe here
      // because the runtime announces a child only after it is registered.
      visibleTools: agent => {
        const live = ctx.agents.get(agent.id as never)
        if (live === undefined) return undefined
        return ctx.tools.schemas(live).map(schema => schema.name)
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
      // `danger-full-access` is FULL access by explicit owner decision
      // (ADR-0005): a locus child's cwd is its parent's cwd, so
      // `workspace-write` could never cover the sibling worktrees.
      return {
        policy: {
          apply: (sessionId: string, mode: LocusAccessModeV20) => {
            const session = sessions.get?.(sessionId as never)
            if (session === undefined) {
              throw new PetError('INTERNAL', `Session ${sessionId} is not resolvable`)
            }
            // The official write seam is a free function exported by
            // dsh-sandbox-policy; the service itself only resolves policy.
            setSandboxMode(session as never, mode as never)
          },
          resolve: (sessionId: string): LocusAccessModeV20 | undefined => {
            const session = sessions.get?.(sessionId as never)
            if (session === undefined) return undefined
            const resolved = policy.resolve?.({ session })?.mode
            return resolved === 'read-only' || resolved === 'danger-full-access' ? resolved : undefined
          },
        },
      }
    })(),
  }

  ctx.effect(
    () =>
      ctx.on('agent/created', async (payload: { agent?: unknown; source?: string }): Promise<undefined> => {
        const agent = payload?.agent as
          | { id?: unknown; ctx?: unknown }
          | undefined
        const sessionId = agent?.id
        // Call the locus composer exactly ONCE. A durable lookup is reusable,
        // but the fresh-child staging fallback is a one-shot claim; a
        // preliminary "is locus?" probe would consume it and make the real
        // composition fail as a duplicate publication. `composed:false` is
        // the ordinary-session answer and falls through unchanged.
        if (typeof sessionId === 'string' && agent?.ctx !== undefined) {
          const main = locusRepository.findMain(sessionId)
          if (main !== undefined || locusMainScopes.has(agent.ctx as object)) {
            if ((main !== undefined && main.status !== 'active') || livePresetFor(sessionId) !== LOCUS_BASE_PRESET) {
              throw new PetError('INTERNAL', 'Locus main is retired or its preset changed')
            }
            const session = ctx.sessions.get(sessionId as never)
            const live = ctx.agents.get(sessionId as never)
            if (session === undefined || live === undefined) throw new PetError('INTERNAL', 'Locus main is unavailable')
            installLocusMainScope(agent.ctx as Context, sessionId)
            setSandboxMode(session, 'read-only')
            ;(session as { append(type: string, data: unknown): unknown }).append('approval/policy', { policy: 'never' })
            const settings = foldLocusMainSettings(session.snapshotEvents())
            const attestation = attestLocusMainSurface({
              toolNames: ctx.tools.schemas(live).map(tool => tool.name),
              approval: settings.approval,
              sandbox: settings.sandbox,
              guarded: LOCUS_MAIN_DENIED_TOOLS,
            })
            if (!attestation.ok) throw new PetError('INTERNAL', `Locus main lockdown failed: ${attestation.leaks.join(', ')}`)
            return undefined
          }
          const candidate: LocusCandidateAgent = { id: sessionId, scope: agent.ctx as never }
          // One D15 lookup in order, compose once, `recordAccessVerified` BEFORE
          // publication (agent-created.ts). Rethrown deliberately: only a
          // candidate that matched a durable or staged row may veto publication.
          // Logged first because the veto travels out through agent creation and
          // provisioning, which collapse it into one generic `locus-unavailable`.
          let outcome: 'ordinary' | 'composed'
          try {
            outcome = await handleLocusAgentCreated({
              repository: locusRepository,
              agentPreset: livePresetFor,
              staged: id => locusPrepublication.inspect(id)?.composition,
              claimStaged: id => { locusPrepublication.claim(id) },
              compose: (agentCandidate, composition) =>
                composeLocusChild(agentCandidate, {
                  ...locusCompositionPorts,
                  lookup: { find: () => composition },
                }),
              publishClaimed: id => locusPrepublication.publishClaimed(id),
              // Class `main-unavailable`: migrate the whole W; the refused delivery
              // stays in backlog and the dispatcher re-reads the new sessionId.
              migrateMain: async composition => {
                const pairing = locusRepository.findMain(composition.locusMainSessionId)
                if (pairing === undefined || locusProvisioningController === undefined) return
                await locusProvisioningController.migrateWholeW(
                  pairing.workSessionId,
                  composition.endpoint.chatId,
                  composition.endpoint.threadId,
                )
              },
              now: Date.now,
              log: message => petLog(`dsh-pet: ${message}`),
            }, candidate)
          } catch (error) {
            const describe = (value: unknown): string => {
              const parts: string[] = []
              let current: unknown = value
              for (let depth = 0; depth < 4 && current !== undefined; depth++) {
                parts.push(current instanceof Error ? current.message : String(current))
                current = current instanceof Error ? current.cause : undefined
              }
              return parts.join(' <- ')
            }
            petLog(`dsh-pet: locus composition refused ${sessionId} (${describe(error)})`)
            throw error
          }
          if (outcome === 'composed') {
            if (payload.source === 'resume') {
              // Repair missing workspace accounting from an earlier creation.
              void attachSessionToWorkspace(sessionId).catch(error => {
                petLog(`dsh-pet locus child workspace accounting failed: ${String(error)}`)
              })
            }
            composedAgents.add(agent.ctx as object)
            contextToolAgents.add(agent.ctx as object)
            // The circle marker is deliberately NOT set here. `install()` adds
            // it itself, and only after every registration succeeded; setting
            // it from outside would record a surface that may never have been
            // installed at all — for example when no assembly composed — and
            // then permanently suppress the repair paths that would fix it.
            return undefined
          }
        }
        // Cordis event listeners are observe-only here. Await the scoped
        // installation without allowing an async rejection to escape into the
        // event dispatcher; dispatch itself performs a late fail-closed check.
        // DSH 0.2.0 awaits `agent/created` listeners serially and a rejection
        // fails creation; returning undefined (not the promise) keeps the
        // 0.1.5 contract that a foreign executor's composition never vetoes it.
        void composeForeignExecutor(payload?.agent)
        return undefined
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
  const persistedPresetFor = async (sessionId: string): Promise<string> =>
    (await persistedCompositionFor(sessionId)).presetId

  /** Persisted preset plus the model the session should keep running on. */
  const persistedCompositionFor = async (
    sessionId: string,
  ): Promise<{ readonly presetId: string; readonly model: { readonly provider: string; readonly model: string } }> => {
    const query = ctx.get('sessionQuery') as
      | {
          observeSession(
            id: string,
            options: { projectionMode: 'all' },
          ): Promise<{
            header: { agentPreset?: unknown }
            projections?: { values?: { agentPreset?: unknown; modelSelection?: unknown } }
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
      const current = selection()
      return {
        presetId: stored,
        model: resumeModelFor(observation.projections?.values?.modelSelection, { provider: current.providerId, model: current.modelId }),
      }
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
            resumeSessionId: SessionId(executorSessionId),
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
            setup: async (agentCtx, agent) =>
              executorSetup(agentCtx, agent, presetId, task.residentWorkspaceId === undefined),
          })
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
        // are Cordis fibers. Await the real callback completion before the
        // fail-closed decision so an executor never runs half-composed.
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
  /**
   * Whether one executor session still queues client messages it will run.
   *
   * The durable splice log says a message was accepted; only the live inbox
   * says it has not run yet. Dispatching a Pet Invocation behind such a
   * message would make that other Invocation "current" while the model is
   * still answering the user's turn, so the dispatch waits. An unloaded Agent
   * has no queue by definition.
   */
  const hasPendingClientTurn = (executorSessionId: string): boolean => {
    type InboxLike = {
      readonly nextTurn?: readonly unknown[]
      readonly nextStep?: readonly unknown[]
    }
    const handle = ctx.agents.get(executorSessionId as never) as
      | { agent?: { inbox?: InboxLike }; inbox?: InboxLike }
      | undefined
    const agent = handle?.agent ?? handle
    const inbox = (agent as { inbox?: InboxLike } | undefined)?.inbox
    if (inbox === undefined) return false
    const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])]
    return queued.some(message => isClientUserMessage(message))
  }

  async function attachSessionToWorkspace(
    sessionId: string,
    targetWorkspaceId?: string,
  ): Promise<void> {
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
    hasPendingUserTurn: executorSessionId => hasPendingClientTurn(executorSessionId),
    workspaceLocator: workspaceId => {
      const match = ctx.workspaceRegistry
        .list()
        .find((item: { id?: unknown }) => item.id === workspaceId) as { path?: unknown } | undefined
      return typeof match?.path === 'string' ? match.path : undefined
    },
  })

  /**
   * The third Invocation origin: a user message typed into the executor session.
   *
   * Registration is fire-and-forget from the durable event stream, so no
   * failure here can disturb the session loop; the durable message id keeps a
   * splice and a later claim from both registering the same request.
   */
  followups = new FollowupCoordinator({
    resolveTask: executorSessionId => repository.findTaskByExecutor(executorSessionId),
    findByMessage: messageId => repository.findInvocationByFollowupMessage(messageId),
    register: input => coordinator.startFollowupInvocation(input),
    settled: executorSessionId => projectionSettled(executorSessionId),
    isLocusChild: executorSessionId => {
      try {
        return locusContextRepository.findBySessionId(executorSessionId) !== undefined
      } catch {
        // An unreadable locus index is not proof either way; the ordinary Task
        // lookup still gates registration, and a locus child has no Task.
        return false
      }
    },
    onOutcome: ({ executorSessionId, messageId, outcome }) => {
      if (outcome.ok) {
        petLog(
          `dsh-pet: in-session Invocation ${outcome.invocationId} registered on ${executorSessionId}`,
        )
        return
      }
      if (outcome.reason === 'duplicate') return
      petLog(
        `dsh-pet: in-session follow-up on ${executorSessionId} (message ${messageId}) not ` +
          `registered: ${outcome.reason}`,
      )
    },
    onError: error => {
      petLog(
        `dsh-pet: in-session follow-up registration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
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
  const locusChildDelivery = locusChildProbe.available
    ? createLocusChildDelivery({
      // One adapter owns exactly one active child; use a factory so sibling
      // loci under the same main session do not contend for one singleton.
      createAdapter: () => createLocusChildAdapter({
        ...locusChildProbe.ports,
        log: message => petLog(`dsh-pet locus child: ${message}`),
      }),
      parentPreset: persistedPresetFor,
      lazy: {
        creator: createLocusLazyChildCreator({
          staging: locusPrepublication,
          createAdapter: () => createLocusChildAdapter({
            ...locusChildProbe.ports,
            log: message => petLog(`dsh-pet locus child: ${message}`),
          }),
          presetDeclared: () => areLocusPresetsDeclared(ctx.agentPresets),
          afterCreated: (childSessionId, input) => {
            try {
              const session = ctx.sessions.get(childSessionId as never)
              if (session !== undefined) ctx.sessionTitle.rename(session, input.label)
            } catch (error) {
              petLog(`dsh-pet locus child could not be titled: ${String(error)}`)
            }
            // The entry's workspaceId authorizes the source project; the child
            // inherits its locus main's Pet cwd and belongs to the Pet workspace.
            void attachSessionToWorkspace(childSessionId).catch(error => {
              petLog(`dsh-pet locus child workspace accounting failed: ${String(error)}`)
            })
          },
          log: message => petLog(`dsh-pet locus child: ${message}`),
        }),
        publication: createFirstDeliveryPublication({ repository: locusRepository, firstPrompts, reserveChildSessionId: reserveLocusChildSessionId }),
      },
      // Without this port every child-delivery refusal (safe-composition-unproven,
      // child-not-found, parent-unavailable, ...) is discarded: the controller's
      // catch collapses all of them into one `child-unavailable`, which is not
      // actionable. The codes logged here are stable and carry no message body.
      log: reason => petLog(`dsh-pet locus child: ${reason}`),
    })
    : undefined
  if (locusChildDelivery !== undefined) {
    ctx.effect(
      () => () => { locusChildDelivery.dispose() },
      'dsh-pet: dispose per-locus child adapters',
    )
  }

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
  // Rows with the M their group row names (a topic row stores none).
  const locusReconcileRows = (): ReconcileRow[] => locusRepository.listRows().flatMap(row => {
    const group = 'threadId' in row.endpoint ? locusRepository.getRow({ chatId: row.endpoint.chatId }) : row
    return group !== undefined && 'locusMainSessionId' in group
      ? [{ row, locusMainSessionId: group.locusMainSessionId }]
      : []
  })
  const locusReconciled = await lifecycle.contain('Locus child reconciliation', async () => {
    const proof = locusChildProbe.available ? locusChildProbe.ports.proof : undefined
    const report = await reconcileLocusChildren(
      locusReconcileRows(),
      {
        store: {
          // The child is proven gone: mark that ONE row invalid (D7 class A); the
          // next authorized @ rebuilds it in place.
          invalidate: async (fence, reason, at) => { await locusRepository.markInvalid(fence, reason, at) },
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
                  ? { kind: 'unusable', reason: '子会话在运行时中已不存在，下一条授权 @ 将原地重建。' }
                  : { kind: 'usable' }
              },
            },
          }),
        log: code => petLog(`dsh-pet locus reconcile: ${code}`),
      },
      locusReconcileAbort.signal,
    )
    if (report.invalidated.length > 0) {
      petLog(`dsh-pet: locus reconciliation invalidated ${String(report.invalidated.length)}`)
    }
    return report
  })
  // Do not publish/start the channel ahead of its child and busy-fence truth.
  // Lookup uncertainty is represented inside the report and remains fail-closed;
  // a reconciliation infrastructure failure degrades Pet before intake starts.
  if (locusReconciled === undefined) return

  if (!locusChildProbe.available) {
    petLog(`dsh-pet: unified locus child seam unavailable — ${locusChildProbe.diagnostic}`)
  }
  const imLocusLarkPort = createLocusLarkPort()
  // Display-only doc metadata, cached: the management panel refreshes often,
  // and a failed read is retried after a shorter delay than a successful one.
  const docMetaCache = createDisplayCache(async (token: string) => larkClient.inspectDoc?.(token))
  // IM group names: v20 rows no longer store a chat name, so the panel reads it live.
  const chatNameCache = createDisplayCache(async (chatId: string) => larkClient.chatName(chatId))
  // A document has no "post to the root" call. Its control messages (the
  // /bind source-switch warning) follow the business-answer routing: under the
  // anchoring comment for a comment-level entry, or a new full comment that
  // @-mentions the /bind issuer for a whole-doc entry (full comments cannot be
  // replied to). IM ids never reach drive and doc ids never reach IM (D8).
  const docControl = createDocControlMessenger({
    client: larkClient,
    latestDelivery: endpoint => [...locusRepository.listDeliveries()]
      .filter(record =>
        record.endpoint.chatId === endpoint.chatId &&
        (record.endpoint.threadId ?? undefined) === (endpoint.threadId ?? undefined))
      .sort((left, right) => right.sequence - left.sequence)[0],
  })
  const locusLarkPort: typeof imLocusLarkPort = {
    ...imLocusLarkPort,
    sendControlMessage: async input => {
      if (!isDocEndpoint(input.endpoint)) return imLocusLarkPort.sendControlMessage(input)
      await docControl.send(input)
    },
  }
  // DSH 0.2.2 removed `sessionController.inspect`; cold inspection now goes
  // through `sessionQuery.observeSession`, exactly what the old method wrapped.
  const inspectSession = createSessionInspector(
    ctx.get('sessionQuery') as Parameters<typeof createSessionInspector>[0],
  )
  if (inspectSession === undefined) {
    // Without cold inspection neither Locus provisioning nor the Locus list can
    // prove a Session exists, so both stay unavailable (the channel-gap
    // diagnostic below also reports it). Say why once, instead of skipping silently.
    petLog('dsh-pet: Locus provisioning and Session listing unavailable: sessionQuery.observeSession is not provided by this Host')
  }
  const locusProvisioning = (() => {
    // No child is created by provisioning (the first deliverable message
    // creates it), so the idle-child runtime capability is not needed here.
    if (inspectSession === undefined) return undefined
    try {
      const dsh = createProductionLocusDshPort({
        repository,
        locusMainWorkspaceId: workspaceId,
        sessionController: { inspect: inspectSession } as never,
        workspaceRegistry: ctx.workspaceRegistry as never,
        agents: {
          // Delegate explicitly rather than spreading or inheriting from the
          // service: `ctx.agents` is a Cordis service whose `create` relies on
          // its own receiver, so it must keep being called on itself.
          create: async (options: import('@deepseek-ai/dsh-agent').CreateAgentOptions) =>
            (ctx.agents as {
               create(input: import('@deepseek-ai/dsh-agent').CreateAgentOptions):
                 Promise<import('@deepseek-ai/dsh-agent').AgentHandle>
             }).create(options),
          // Same seam the Pet executor uses: a real UserMessage through
          // `followup`, never a raw string, so the briefing rides the path a
          // native client uses. Not awaited — see the port's `brief` doc.
          brief: (agent: unknown, text: string) => {
            ;(agent as { followup(input: unknown): void }).followup(
              createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'user' },
              }),
            )
          },
        } as never,
        agentPresets: ctx.agentPresets as never,
        agentDefaultModel: ctx.agentDefaultModel as never,
        sessions: ctx.sessions as never,
        sessionTitle: ctx.sessionTitle as never,
        // The locus main's lock-down. Each step needs the live runtime, so it
        // is composed here and read back by the port before it hands anything
        // out: a locus main that is not provably locked down is never published.
        locusMainLockdown: {
          restrict: (agentContext, agent) => installLocusMainScope(agentContext, String(agent.id)),
          // The two settings' only stores are log-only session events; these are
          // exactly what `setSandboxMode` / `setApprovalPolicy` append.
          applyPolicy: session => {
            setSandboxMode(session as never, 'read-only' as never)
            ;(session as unknown as { append(type: string, data: unknown): void })
              .append('approval/policy', { policy: 'never' })
          },
          visibleTools: agent => {
            const live = ctx.agents.get(agent.id as never)
            return live === undefined ? [] : ctx.tools.schemas(live).map(schema => schema.name)
          },
          // restrict ran first; only a scope that passed installLocusMainScope
          // carries the execution guard over the denied names.
          guardedTools: agent => {
            const live = ctx.agents.get(agent.id as never)
            return live !== undefined && locusMainScopes.has(live.ctx as object) ? LOCUS_MAIN_DENIED_TOOLS : []
          },
        },
      })
      const controller = createLocusController({
        repository: locusRepository,
        dsh,
        lark: locusLarkPort,
        reserveChildSessionId: reserveLocusChildSessionId,
        // The dsh-collab space of a work/locus-main pair; owned by the collab
        // side, this is only the seam the establishment path calls.
        establishSpace: input => locusCollab.ensureSpace(input),
        // Compensation of an M this operation created: best-effort, logged leak.
        releaseSpace: input => locusCollab.releaseSpace(input),
        log: message => petLog(`dsh-pet locus provisioning: ${message}`),
      })
      return { controller, dsh }
    } catch (error) {
      petLog(
        `dsh-pet: locus provisioning composition failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
      return undefined
    }
  })()
  const locusProvisioningController = locusProvisioning?.controller
  const locusDshPort = locusProvisioning?.dsh

  /**
   * One reader for the owner's archive set, shared by every layer that must
   * agree on it: admission (does this endpoint still answer at all?) and
   * resolution (may this generation serve or be replaced?). Reading it in two
   * places with two implementations is how "archived" would end up meaning two
   * different things depending on which gate asked first.
   */
  const isSessionArchived = (sessionId: string): boolean =>
    ((ctx.workspaceRegistry.archivedSessionIds ?? []) as readonly unknown[])
      .some(id => String(id) === sessionId)

  // Admission reads the exact row in any state and judges it by the W behind its M.
  const locusAuthorization = createDurableLocusAuthorizationResolver(locusRepository, isSessionArchived)
  const locusResolution = createLocusResolution({
    store: locusRepository,
    isSessionArchived,
    mains: {
      find: parentSessionId => {
        const pairing = locusRepository.findMain(parentSessionId)
        return pairing === undefined ? undefined : { workSessionId: pairing.workSessionId, status: pairing.status }
      },
    },
    // The delivery path only: whether the locus main still resolves, is not
    // archived and still runs the neutral preset. Without the Host port nothing
    // can prove it, and an unproven locus main does not serve.
    ...(locusDshPort === undefined
      ? {}
      : {
        verifyMain: async (locusMainSessionId: string) =>
          isUsableLocusMainSession(await locusDshPort.resolveSession(locusMainSessionId), locusMainSessionId, workspaceId),
      }),
    ...(locusProvisioningController === undefined
      ? {}
      : {
        provisioning: {
          ensureForDelivery: async ({ endpoint }) => {
            // Name the new generation after its chat rather than its opaque id.
            // These titles are what the owner reads in Locus management, where
            // `Locus 主会话 · oc_…` says nothing about which group an entry
            // belongs to. Fail-soft: an unresolvable name keeps the id.
            let chatName: string | undefined
            try {
              const docToken = parseDocChatId(endpoint.chatId)
              chatName = docToken === undefined
                ? await larkClient.chatName(endpoint.chatId)
                : (await larkClient.inspectDoc?.(docToken))?.title
            } catch {
              chatName = undefined
            }
            // ONE repair entry point decides what this entry needs: first
            // establishment, moving onto a new
            // locus main, or a new generation for an unusable child. It never
            // creates a child session; the first deliverable message does.
            const ensured = await locusProvisioningController.ensureEntry({
              chatId: endpoint.chatId,
              ...(endpoint.threadId === undefined ? {} : { threadId: endpoint.threadId }),
              ...(chatName === undefined ? {} : { chatName }),
            })
            const record = ensured.locus
            if (record.state !== 'active' && record.state !== 'not-created') {
              throw new Error('Provisioned locus is neither a not-created nor an active entry')
            }
            const group = ensured.group ?? locusRepository.getRow({ chatId: record.endpoint.chatId })
            if (group === undefined || !('locusMainSessionId' in group)) {
              throw new Error('Provisioned locus has no group row')
            }
            const pairing = locusRepository.findMain(group.locusMainSessionId)
            if (pairing === undefined) throw new Error('Provisioned locus has no locus_mains pairing')
            return {
              locusId: record.locusId,
              endpoint: record.endpoint,
              sessionId: record.sessionId,
              state: record.state,
              accessMode: record.accessMode,
              revision: record.revision,
              locusMainSessionId: group.locusMainSessionId,
              workSessionId: pairing.workSessionId,
              workspaceId: group.workspaceId,
            }
          },
        },
      }),
    log: reason => petLog(`dsh-pet locus resolve: ${reason}`),
  })

  // Open turn at the durable boundaries (GUI and inquiry turns included).
  const isLocusChildTurnIdle = (sessionId: string): boolean => {
    const session = ctx.sessions.get(sessionId as never)
    if (session === undefined) return false
    let open: number | undefined
    for (const event of session.snapshotEvents()) {
      if (event.type === 'turn/start') {
        if (open !== undefined) return false
        open = event.data.turn
      } else if (event.type === 'turn/end') {
        if (open === undefined || open !== event.data.turn) return false
        open = undefined
      }
    }
    return open === undefined
  }
  const hasPendingLocusChildInput = (sessionId: string): boolean => {
    type InboxLike = { readonly nextTurn?: readonly unknown[]; readonly nextStep?: readonly unknown[] }
    const handle = ctx.agents.get(sessionId as never) as { agent?: { inbox?: InboxLike }; inbox?: InboxLike } | undefined
    const inbox = ((handle?.agent ?? handle) as { inbox?: InboxLike } | undefined)?.inbox
    return inbox !== undefined && ((inbox.nextTurn?.length ?? 0) + (inbox.nextStep?.length ?? 0)) > 0
  }
  // D8: one operation for `/access` and the management surface. A resident child
  // is released with the real `drainChildren(exactLiveParent, [id])`, never
  // `adapter.dispose`.
  const locusAccessMutation = createLocusAccessMutation({
    repository: locusRepository,
    live: {
      isLive: sessionId => ctx.agents.get(sessionId as never) !== undefined,
      liveParent: locusMainSessionId => ctx.agents.get(locusMainSessionId as never),
      isTurnIdle: isLocusChildTurnIdle,
      hasPendingInput: hasPendingLocusChildInput,
      drainChildren: async (parent, sessionIds) => {
        const subagents = ctx.get('subagents') as
          | { drainChildren?: (parent: unknown, ids: readonly unknown[]) => Promise<void> }
          | undefined
        if (typeof subagents?.drainChildren !== 'function') {
          throw new PetError('INTERNAL', 'The official subagents.drainChildren is unavailable')
        }
        await subagents.drainChildren(parent, sessionIds.map(id => SessionId(id)))
      },
    },
    log: message => petLog(`dsh-pet locus access: ${message}`),
  })

  const locusControlDispatch = locusProvisioningController === undefined || locusDshPort === undefined
    ? undefined
    : createLocusControlDispatcher({
      allowOpenIds: () => repository.getChannelConfig().allowOpenIds,
      listSessions: async (prefix: string) => {
        // Narrow by id BEFORE resolving: resolveSession cold-inspects the full
        // Session log, and resolving every accounted session at once OOM-crashed
        // the Host on a single `/bind`. Resolve the few survivors sequentially.
        const ids = new Set<string>()
        for (const workspace of ctx.workspaceRegistry.list()) {
          for (const id of workspace.sessionIds ?? []) {
            const value = String(id)
            if (locusSessionIdMatchesPrefix(value, prefix)) ids.add(value)
          }
        }
        const resolved: NonNullable<Awaited<ReturnType<typeof locusDshPort.resolveSession>>>[] = []
        for (const id of ids) {
          const session = await locusDshPort.resolveSession(id)
          if (session !== undefined) resolved.push(session)
        }
        return resolved
      },
      bind: {
        bind: ({ endpoint, parentSessionId, chatName, actorId }) => {
          const run = (): Promise<EnsureGroupResult | EnsureTopicResult> => endpoint.threadId === undefined
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
            })
          return isDocEndpoint(endpoint) ? docControl.withIssuer(endpoint, actorId, run) : run()
        },
      },
      exit: {
        unbindCurrent: async ({ endpoint }) => {
          const current = locusRepository.getRow(endpoint)
          if (current === undefined) throw Object.assign(new Error('Current locus does not exist'), { code: 'LOCUS_NOT_FOUND' })
          const stopped = await locusProvisioningController.stopEntry({
            expectedLocusId: current.locusId,
            expectedRevision: current.revision,
          })
          if (stopped.state !== 'stopped') throw new Error('Locus did not reach stopped state')
          return { state: 'stopped' as const }
        },
      },
      access: {
        setAccessMode: async ({ endpoint, actorId, mode }) => {
          const current = locusRepository.getRow(endpoint)
          if (current === undefined) throw Object.assign(new Error('Current locus does not exist'), { code: 'LOCUS_NOT_FOUND' })
          return locusAccessMutation.set({ locusId: current.locusId, mode, actorId })
        },
      },
      // A document's "name" is its title (D14); never call an IM API with a doc id.
      chatName: async chatId => {
        const token = parseDocChatId(chatId)
        if (token === undefined) return larkClient.chatName(chatId)
        return (await larkClient.inspectDoc?.(token).catch(() => undefined))?.title
      },
      // Fallback diagnostics for an unmapped control failure: reason code only.
      log: message => petLog(`dsh-pet: ${message}`),
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
            agent?: { id?: unknown }
            message?: { id?: unknown; source?: { kind?: unknown } }
            turn?: unknown
          }) => {
            const childSessionId = payload?.agent?.id
            const messageId = payload?.message?.id
            if (typeof childSessionId !== 'string' || typeof messageId !== 'string') return
            if (typeof payload.turn !== 'number') return
            // The claim carries the whole UserMessage, so its source is
            // available here. The observer needs it to tell Host-injected
            // context apart from participant traffic; a non-string source stays
            // absent and is therefore treated as participant traffic.
            const sourceKind = payload.message?.source?.kind
            listener({
              childSessionId,
              messageId,
              turn: payload.turn,
              ...(typeof sourceKind === 'string' ? { sourceKind } : {}),
            })
          }) as never),
        onTurnEnd: listener =>
          ctx.on(sessionEvent as never, ((
            session: { id?: unknown },
            event: { type?: unknown; data?: { turn?: unknown; reason?: { kind?: unknown; reason?: { kind?: unknown }; error?: { message?: unknown } } } },
          ) => {
            if (event?.type !== 'turn/end') return
            const childSessionId = session?.id
            const turn = event.data?.turn
            if (typeof childSessionId !== 'string' || typeof turn !== 'number') return
            const kind = event.data?.reason?.kind
            const message = event.data?.reason?.error?.message
            const cause = event.data?.reason?.reason?.kind
            const cancelCause = kind === 'aborted' && (cause === 'user' || cause === 'parent' || cause === 'disposed') ? cause : undefined
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
              ...(cancelCause !== undefined ? { reason: cancelCause } : typeof message === 'string' ? { reason: message } : {}),
            })
            void refusedReplies?.end(childSessionId, turn).catch(error => {
              petLog(`dsh-pet locus refused reply settlement: ${String(error)}`)
            })
          }) as never),
        lookup: {
          find: ({ childSessionId, messageId }) => {
            const record = locusRepository.findDeliveryByInboxMessageId(messageId)
            if (record === undefined) return firstPrompts.resolve({ childSessionId, messageId })
            // Child identity AND an execution binding are both required: a
            // claim for another child, or for a Delivery that was never
            // queued, must not become a settlement proof.
            if (record === undefined || record.sessionId !== childSessionId) return undefined
            if (record.executionId === undefined) return undefined
            return {
              deliveryId: record.deliveryId,
              executionId: record.executionId,
              correlation: {
                endpoint: record.endpoint,
                locusId: record.locusId,
                sessionId: record.sessionId,
              },
            }
          },
        },
        log: code => petLog(`dsh-pet locus turn: ${code}`),
      })
    } catch (error) {
      petLog(
        `dsh-pet: unified locus turn observer unavailable (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
      return undefined
    }
  })()
  if (locusTurnObserver !== undefined) {
    currentLocusTurnProof = childSessionId => locusTurnObserver.currentForChild?.(childSessionId)
    const projectCapability = (capability: import('./host/locus/turn-observer.js').LocusCurrentCapability): CurrentLocusCapabilityProjection => ({
      deliveryId: capability.deliveryId,
      executionId: capability.executionId,
      turnId: capability.turnId,
      source: capability.source,
      locusId: capability.correlation.locusId,
      sessionId: capability.correlation.sessionId,
    })
    currentLocusCapability = childSessionId => {
      const capability = locusTurnObserver.currentCapabilityForChild?.(childSessionId)
      return capability === undefined || locusRepository.hasFirstDeliveryRecoveryDebt(capability.correlation.locusId)
        ? undefined : projectCapability(capability)
    }
    inspectCurrentLocusCapability = childSessionId => {
      const inspection = locusTurnObserver.inspectCurrentCapabilityForChild?.(childSessionId)
      if (inspection === undefined) return { ok: false, reason: 'capability-unavailable' }
      return inspection.ok
        ? { ok: true, capability: projectCapability(inspection.capability) }
        : inspection
    }
  }

  deliveryExecutionProof = createDeliveryExecutionProof({
    currentForChild: childSessionId => locusRepository.listDeliveries().filter(row => row.sessionId === childSessionId),
    findByInboxMessageId: messageId => locusRepository.findDeliveryByInboxMessageId(messageId),
    deliveryForTurn: (childSessionId, turn) => locusTurnObserver?.deliveryForTurn?.(childSessionId, turn),
    isActive: delivery => {
      const row = locusRepository.getLocus(delivery.locusId)
      return row?.state === 'active' && !locusRepository.hasFirstDeliveryRecoveryDebt(row.locusId) && row.sessionId === delivery.sessionId
    },
  })

  const deliveryCorrelation = (input: {
    readonly childSessionId: string
    readonly locus: PetLocusFinishInput['locus'] | PetLocusWaitInput['locus']
    readonly delivery: PetLocusFinishInput['delivery'] | PetLocusWaitInput['delivery']
  }): DeliveryCorrelation => ({
    endpoint: {
      chatId: input.delivery.endpoint.chatId,
      ...(input.delivery.endpoint.threadId === undefined ? {} : { threadId: input.delivery.endpoint.threadId }),
    },
    locusId: input.locus.locus.locusId,
    sessionId: input.childSessionId,
  })

  const loadCurrentDelivery = (correlation: DeliveryCorrelation, deliveryId: string): DeliveryRecord => {
    const record = locusRepository.getDelivery(deliveryId)
    if (
      record === undefined ||
      record.deliveryId !== deliveryId ||
      record.status !== 'current' ||
      record.queueState !== 'current' ||
      record.locusId !== correlation.locusId ||
      record.sessionId !== correlation.sessionId ||
      record.endpoint.chatId !== correlation.endpoint.chatId ||
      (record.endpoint.threadId ?? undefined) !== (correlation.endpoint.threadId ?? undefined)
    ) {
      throw new PetError('INVALID_REQUEST', 'This Delivery is no longer current or caller-authorized.')
    }
    return record
  }

  const finishAndAdvance = async (
    record: DeliveryRecord,
    correlation: DeliveryCorrelation,
    outcome: 'settled' | 'failed',
  ): Promise<void> => {
    locusTurnObserver?.revokeCurrentCapability?.({
      childSessionId: correlation.sessionId,
      deliveryId: record.deliveryId,
    })
    locusChannelController?.currentFinished?.({
      deliveryId: record.deliveryId,
      correlation,
      outcome,
    })
    await locusChannelController?.dispatchNext?.(correlation)
  }

  refusedReplies = createRefusedReplyTracker({
    getDelivery: id => locusRepository.getDelivery(id),
    abandonRefusedDelivery: input => locusRepository.abandonRefusedDelivery(input),
    isActive: record => {
      const found = locusRepository.findBySessionId(record.sessionId)
      const current = locusRepository.listDeliveries(record.locusId).filter(row => row.sessionId === record.sessionId && (row.status === 'current' || row.status === 'finishing'))
      return found?.row.state === 'active' && found.row.locusId === record.locusId && current.length === 1 && current[0]?.deliveryId === record.deliveryId
    },
    withDispatchLane: withLocusDispatchLane,
    finishAndAdvance: async (record, correlation, outcome) => {
      petLog('dsh-pet locus delivery released: reply-refused')
      await finishAndAdvance(record, correlation, outcome)
    },
    now: Date.now,
  })

  // The lease deadline is durable, but only a live timer notices the moment it
  // passes. `createExpiryScheduler` owns that timing behavior so it can be
  // driven directly in tests; expiry itself stays the durable CAS below it.
  const expiryScheduler = createExpiryScheduler({
    repository: locusRepository,
    withDispatchLane: withLocusDispatchLane,
    finishAndAdvance,
  })
  scheduleCurrentDelivery = (record: DeliveryRecord): void => { expiryScheduler.schedule(record) }

  finishCurrentDelivery = async (input: PetLocusFinishInput): Promise<PetLocusFinishResult> => runLocusMutation<PetLocusFinishResult>(async () => {
    const correlation = deliveryCorrelation(input)
    return withLocusDispatchLane(correlation, async () => {
      const current = loadCurrentDelivery(correlation, input.delivery.deliveryId)
      const now = Date.now()
      if (input.outcome === 'no-reply') {
        const completed = await locusRepository.completeCurrentDelivery({
          ...correlation,
          deliveryId: current.deliveryId,
          now,
          outcome: 'no-reply',
          outboundResult: 'none',
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
        })
        if (!completed.changed || completed.record === undefined) {
          throw new PetError('INVALID_REQUEST', 'This Delivery could not be completed because it changed state.')
        }
        await finishAndAdvance(completed.record, correlation, 'settled')
        return { sent: false, outcome: 'no-reply' }
      }

      if (isDocEndpoint(current.endpoint)) {
        // Doc comment (D5/D8): prove → reserve → answer (reply under an anchored
        // comment, or a new full comment mentioning the asker) → record.
        // Unproven association refuses BEFORE `finishing`.
        const doc = await finishDocReply({
          repository: locusRepository as never,
          client: larkClient,
          correlation,
          current,
          text: input.text ?? '',
          now: () => Date.now(),
        })
        if (doc.kind === 'refused') {
          throw new PetError('INVALID_REQUEST', 'Reply target refused: association-unproven')
        }
        await finishAndAdvance(doc.record as DeliveryRecord, correlation, doc.outboundResult === 'success' ? 'settled' : 'failed')
        return { sent: doc.outboundResult === 'success', outcome: 'reply' }
      }
      const finishing = await locusRepository.markDeliveryFinishing({
        ...correlation,
        deliveryId: current.deliveryId,
        now,
        ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
      })
      if (!finishing.changed || finishing.record === undefined) {
        throw new PetError('INVALID_REQUEST', 'This Delivery could not be reserved for reply.')
      }
      const target = current.replyTarget ?? current.feedbackTarget
      let outboundResult: 'success' | 'unknown' = 'unknown'
      if (typeof larkClient.replyToTarget === 'function') {
        try {
          await larkClient.replyToTarget(target, input.text ?? '')
          outboundResult = 'success'
        } catch {
          // The current adapter cannot prove whether a process/envelope failure
          // happened before or after platform acceptance. Never retry it.
          outboundResult = 'unknown'
        }
      }
      const completed = await locusRepository.completeCurrentDelivery({
        ...correlation,
        deliveryId: current.deliveryId,
        now: Date.now(),
        outcome: 'reply',
        outboundResult,
        ...(outboundResult === 'unknown' ? { outboundDiagnostic: 'reply result was not reliably confirmed' } : {}),
        ...(finishing.record.revision === undefined && finishing.record.stateRevision === undefined
          ? {}
          : { expectedRevision: finishing.record.revision ?? finishing.record.stateRevision }),
      })
      if (!completed.changed || completed.record === undefined) {
        throw new PetError('INTERNAL', 'Delivery reply result could not be durably recorded.')
      }
      await finishAndAdvance(completed.record, correlation, outboundResult === 'success' ? 'settled' : 'failed')
      return { sent: outboundResult === 'success', outcome: 'reply' }
    })
  })

  waitCurrentDelivery = async (input: PetLocusWaitInput): Promise<PetLocusWaitResult> => runLocusMutation<PetLocusWaitResult>(async () => {
    const correlation = deliveryCorrelation(input)
    return withLocusDispatchLane(correlation, async () => {
      const current = loadCurrentDelivery(correlation, input.delivery.deliveryId)
      const now = Date.now()
      const waited = await locusRepository.waitCurrentDelivery({
        ...correlation,
        deliveryId: current.deliveryId,
        now,
        waitMinutes: input.waitMinutes,
        ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
      })
      // `deadline-already-sufficient` means the live lease ALREADY covers the
      // requested horizon, so the child may simply keep waiting. Treating that
      // as a refusal was an outright defect: early in a lease every ordinary
      // "wait a bit longer" request lands here, and the resulting error made
      // the child believe its Delivery was unusable and answer `no-reply`
      // instead of the real reply. Report the untouched deadline as accepted.
      const settled = waited.reason === 'deadline-already-sufficient' ? waited.record ?? current : waited.record
      if (settled === undefined || settled.deadlineAt === undefined) {
        throw new PetError('INVALID_REQUEST', 'This Delivery wait lease could not be extended.')
      }
      if (!waited.changed && waited.reason !== 'deadline-already-sufficient') {
        throw new PetError('INVALID_REQUEST', 'This Delivery wait lease could not be extended.')
      }
      scheduleCurrentDelivery(settled)
      const hard = settled.hardDeadlineAt ?? settled.deadlineAt
      return {
        accepted: true,
        deadline: settled.deadlineAt,
        remainingMinutes: Math.ceil(Math.max(0, settled.deadlineAt - Date.now()) / 60_000),
        capped: settled.deadlineAt >= hard,
      }
    })
  })

  /**
   * Finish the ONE durable startup recovery pass only after its authoritative
   * runtime seams exist, and before the channel can accept a new event.
   *
   * A live observer claim is used when available; otherwise the exact
   * continuation-owned Session log must show one open turn that entered this
   * Delivery's inbox UUID. No proof is inferred from child liveness, FIFO order,
   * or text. This Host has no exact-execution termination seam, so queued work
   * without proof remains durable manual debt rather than draining the child.
   * Operation-owned unpublished child resources may still use the independently
   * fenced child compensator. Main-session cleanup has no durable
   * creator handle in this Host, so it deliberately remains manual. Chat cleanup
   * is restricted inside the repository to operation-owned Q&A refs.
   */
  const canCompensateDurableChild = locusChildProbe.available
    && locusChildProbe.ports.proof !== undefined
    && locusChildProbe.ports.compensation !== undefined
  const compensateDurableChild = canCompensateDurableChild && locusChildProbe.available
    ? async (input: {
      readonly parentSessionId: string
      readonly childSessionId: string
      readonly reason: string
    }): Promise<void> => {
      const adapter = createLocusChildAdapter(locusChildProbe.ports)
      try {
        const adopted = await adapter.adoptChild({
          parentSessionId: input.parentSessionId,
          childSessionId: input.childSessionId,
        })
        if (!adopted.ok) throw new Error(`durable child ownership is unproven (${adopted.reason})`)
        const compensated = await adapter.compensateChild({
          identity: adopted.identity,
          reason: input.reason,
        })
        if (!compensated.ok) throw new Error(`durable child compensation failed (${compensated.reason})`)
      } finally {
        adapter.dispose()
      }
    }
    : undefined
  const startupCompensators: StartupCompensatorsV20 = {
    ...(compensateDurableChild === undefined
      ? {}
      : {
        childSession: ({ parentSessionId, childSessionId, operationId }) =>
          compensateDurableChild({
            parentSessionId,
            childSessionId,
            reason: `startup provisioning compensation ${operationId}`,
          }),
      }),
    ...(locusLarkPort.deleteGroup === undefined
      ? {}
      : {
        chat: ({ chatId }) => locusLarkPort.deleteGroup!(chatId),
      }),
    // The main-session compensator was previously absent, so an operation that
    // died after creating its main session could never be compensated: startup
    // had no hook, the operation stayed `needs-recovery`, and its endpoint was
    // blocked by PROVISIONING_CONFLICT forever. Every later message was then
    // refused as `locus-unavailable`. Without this entry that state is
    // unreachable-forever rather than fail-closed, which is a different thing.
    ...(typeof locusDshPort?.releaseSession !== 'function'
      ? {}
      : {
        mainSession: async ({ mainSessionId, operationId }) => {
          console.log(`[dsh-pet] locus startup: compensating orphaned main ${mainSessionId} (${operationId})`)
          await locusDshPort.releaseSession!(mainSessionId)
        },
        // The locus main Pet built for a work session whose establishment never
        // completed. Same restart-safe release as the work session above: it
        // unlists the session and keeps its history.
        locusMainSession: async ({ locusMainSessionId, operationId }) => {
          console.log(`[dsh-pet] locus startup: compensating unused locus main ${locusMainSessionId} (${operationId})`)
          await ctx.workspaceRegistry.archiveSession(locusMainSessionId as never)
          await locusDshPort.releaseSession!(locusMainSessionId)
        },
      }),
  }
  // Live provisioning past its block window is compensated with these same hooks
  // (persistence-v20 beginProvisioning). Without this line the repository kept the
  // empty default and an endpoint whose live failure left a locus main behind stayed
  // LOCUS_CONFLICT until the Host restarted.
  locusRepository.setProvisioningCompensators(startupCompensators)
  const locusStartup = await lifecycle.contain('Locus startup reconciliation', () =>
    recoverLocusStartupV20(locusRepository, {
      deliveryProof: async (delivery: DeliveryRecord) => {
        const observed = locusTurnObserver?.currentForChild?.(delivery.sessionId)
        if (observed !== undefined && observed.executionId === delivery.executionId) {
          return {
            deliveryId: delivery.deliveryId,
            executionId: observed.executionId,
            turnId: observed.turnId,
            state: 'running' as const,
          }
        }
        // Matched by (locusId, sessionId): a replaced session proves nothing.
        const found = locusRepository.findBySessionId(delivery.sessionId)
        if (found === undefined || found.row.locusId !== delivery.locusId) return undefined
        return proveStartupDeliveryFromColdRead({
          delivery,
          parentSessionId: found.locusMainSessionId,
          query: ctx.get('sessionQuery') as LocusSessionQueryLike | undefined,
          log: reason => petLog(`dsh-pet locus recovery: ${reason}`),
        })
      },
      compensators: startupCompensators,
      reserveChildSessionId: reserveLocusChildSessionId,
    }),
  )
  if (locusStartup === undefined) return
  const startupPending = locusStartup.retainedDeliveries.length + locusStartup.replayableDeliveries.length + locusStartup.manualDeliveries.length
  const startupOperations = locusStartup.compensatedOperations.length + locusStartup.manualOperations.length
  if (startupPending > 0 || startupOperations > 0) {
    petLog(
      `dsh-pet locus recovery: ${String(startupPending)} pending Deliveries, ` +
      `${String(startupOperations)} recoverable operations; no side effect replayed`,
    )
  }
  const interruptedSettlements = locusStartup.failedDeliveries.filter(
    delivery => delivery.startupDisposition === 'turn-interrupted',
  )
  if (interruptedSettlements.length > 0) {
    // Said out loud because the alternative was an hour of silence: this
    // settlement is visible in the record, not in the chat.
    petLog(
      `dsh-pet locus recovery: ${String(interruptedSettlements.length)} interrupted Deliveries settled without replay`,
    )
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
  if (!locusRepository.supportsAtomicProvisioning()) {
    // Delivery acceptance, queue proof and settlement are one cross-table
    // lifecycle; without the atomic Domain capability a rollback failure could
    // publish a half mutation recovery cannot infer. Production intake needs it.
    locusChannelGaps.push('atomic locus storage unavailable')
  }
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
  if (typeof locusRepository.claimCurrentDelivery !== 'function') {
    locusChannelGaps.push('durable Delivery dispatcher is not composed')
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
  // The unified channel is only safe when the durable current/backlog claim
  // and lifecycle callbacks are present. The callbacks below are intentionally
  // Host-owned: tools must never send directly or infer a target from model
  // text. A missing seam keeps intake unavailable rather than reverting to the
  // eager legacy queue path.
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
        // The channel's ledger port keeps its `correlation` wrapper; the v20
        // repository is keyed by the flattened {endpoint, locusId, sessionId}.
        bindQueued: async ({ correlation, ...rest }) => {
          const bound = await locusRepository.bindQueued({ ...correlation, ...rest })
          if (!bound.changed) return undefined
          await firstPrompts.whenBound(correlation.sessionId)
          firstPrompts.retire(correlation.sessionId)
          return bound.record
        },
        bindTurn: async ({ correlation, ...rest }) => (await locusRepository.bindTurn({ ...correlation, ...rest })).record,
        settleByTurn: input => locusRepository.settleByTurn({ ...input, turnId: input.correlation.turnId }),
        failBeforeDispatch: input => locusRepository.failBeforeDispatch(input),
        fail: input => locusRepository.fail(input),
      },
      deliveryDispatch: {
        claimCurrent: async ({ correlation, ...rest }) => {
          const claimed = await locusRepository.claimCurrentDelivery({ ...correlation, ...rest })
          return claimed.changed ? claimed.record : undefined
        },
        pendingForLocus: correlation => locusRepository.listDeliveries(correlation.locusId)
          .filter(record => record.sessionId === correlation.sessionId),
        currentFinished: input => locusChannelController?.currentFinished?.(input),
        dispatchNext: input => locusChannelController?.dispatchNext?.(input),
        scheduleCurrent: input => scheduleCurrentDelivery(input),
      },
      child: locusChildDelivery,
      media: locusMedia,
      inspectResidentPolicy: childSessionId => {
        const agent = ctx.agents.get(childSessionId as never)
        if (agent === undefined) return { resident: false }
        const policy = ctx.get('sandboxPolicy') as
          | { resolve?: (input: { session: unknown }) => { mode?: string; workspaceRoot?: string } | undefined }
          | undefined
        const resolved = policy?.resolve?.({ session: agent.session })
        return { resident: true, ...(resolved === undefined ? {} : { policy: resolved }) }
      },
      addressing: {
        listChatBots: chatId => larkClient.listChatBots(chatId),
        // Names the asker in the delivery prompt, so the agent addresses a
        // display name instead of echoing the open id into the chat.
        // Documents have no chat members: name the commenter via contact (D9),
        // fail-soft to the open id.
        resolveMemberName: async (chatId, openId) =>
          isDocEndpoint({ chatId })
            ? await larkClient.contactName?.(openId).catch(() => undefined)
            : await larkClient.resolveMemberName?.(chatId, openId),
      },
      // Disclose ask-scope on a document's FIRST entry only (D7), proven from
      // durable loci of that document root, so no flag is stored.
      docHasEntries: chatId => locusRepository.listRows().some(row => row.endpoint.chatId === chatId),
      docDisclosureText: DOC_DISCLOSURE_TEXT,
      receipts: (() => {
        const inProgressReactions = new Map<string, string>()
        return {
          markAccepted: async (target: { chatId: string; messageId: string }) => {
            if (isDocEndpoint(target)) {
              await reactOnDocTrigger(larkClient, target.messageId, 'accepted')
              return
            }
            const reactionId = await larkClient.addReaction(target.messageId, 'OnIt')
            if (reactionId !== undefined) inProgressReactions.set(target.messageId, reactionId)
          },
          markSettled: async (
            target: { chatId: string; messageId: string },
            outcome: 'settled' | 'failed',
          ) => {
            if (isDocEndpoint(target)) {
              // no-reply only clears Typing; read it from the durable outcome.
              const finished = locusRepository.findDeliveryByMessageId(target.messageId)
              const phase = outcome === 'failed' ? 'failed' : finished?.finishOutcome === 'no-reply' ? 'no-reply' : 'settled'
              await reactOnDocTrigger(larkClient, target.messageId, phase)
              return
            }
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
          sendControl: (target: { chatId: string; threadId?: string; messageId: string }, text: string, senderOpenId?: string) =>
            isDocEndpoint(target)
              ? sendDocControlReceipt(larkClient, { ...target, ...(senderOpenId === undefined ? {} : { senderOpenId }) }, text)
              : larkClient.reply(target.messageId, text),
        }
      })(),
      renderPrompt: async ({ locus, message, signal }) => {
        const locusId = locus.locusId
        // The row, re-read: it must still be this exact (locusId, sessionId).
        const sameEntry = (row: ReturnType<typeof locusRepository.getLocus>): row is NonNullable<typeof row> =>
          row !== undefined && (row.state === 'active' || row.state === 'not-created') && row.sessionId === locus.sessionId
        const record = locusRepository.getLocus(locusId)
        if (!sameEntry(record)) {
          throw new Error('Active locus changed before delivery prompt rendering')
        }
        // Measured before the prompt may claim it, within a bounded deadline and
        // cancellable with the delivery. `larkReady` alone is a transport fact:
        // the incident's child was told it could read the group while the read
        // actually failed, so the read claim now comes from a real attempt.
        // A document has no group history to probe; never send its id to IM.
        const readability = isDocEndpoint(record.endpoint) ? 'unconfirmed' as const : await measureEntranceReadability(
          {
            chatId: record.endpoint.chatId,
            ...('threadId' in record.endpoint ? { threadId: record.endpoint.threadId } : {}),
            signal,
          },
          { probe: entranceReadProbeFor(larkClient) },
        )
        // Re-prove the exact current after the measurement: a locus rebuilt,
        // disabled, or re-bound while the probe was in flight must not get a
        // prompt rendered from the record we just measured.
        const revalidated = locusRepository.getLocus(locusId)
        if (!sameEntry(revalidated)) {
          throw new Error('Active locus changed while measuring entrance readability')
        }
        // Send the routing preamble only while the Host cannot PROVE this child
        // already received one. Proof is a prior Delivery for this exact child
        // whose content was bound into its inbox: acceptance alone is durable
        // admission, not evidence that the prompt reached the model, and a
        // runtime counter would reset across restarts. The Delivery being
        // rendered is excluded, so rendering never consumes the first delivery.
        const current = locusRepository.findDeliveryByMessageId(message.messageId)
        // The project is the GROUP row's workspace (a topic row stores none), and
        // `reboundFrom` (D9) is the group row's too.
        const groupRow = locusRepository.getRow({ chatId: revalidated.endpoint.chatId })
        if (groupRow === undefined || !('workspaceId' in groupRow)) throw new Error('Locus entry has no group row')
        const project = ctx.workspaceRegistry.get(groupRow.workspaceId as never)
        if (project === undefined || await project.status() !== 'ok') throw new Error('Bound locus project workspace is unavailable')
        const prompt = renderLocusDeliveryFor({
          record: {
            locusId: revalidated.locusId,
            endpoint: revalidated.endpoint,
            locusMainSessionId: groupRow.locusMainSessionId,
            sessionId: locus.sessionId,
            workspaceId: groupRow.workspaceId,
            state: revalidated.state,
            accessMode: revalidated.accessMode,
            ...(groupRow.reboundFrom === undefined ? {} : { reboundFrom: groupRow.reboundFrom }),
          },
          readability,
          message: {
            messageId: message.messageId,
            senderOpenId: message.senderOpenId,
            ...(message.senderName === undefined ? {} : { senderName: message.senderName }),
            text: message.text,
            ...(message.addressing === undefined ? {} : { addressing: message.addressing }),
            ...(message.replyToMessageId === undefined
              ? {}
              : { replyToMessageId: message.replyToMessageId }),
            ...(message.replyTarget === undefined ? {} : { replyTarget: message.replyTarget }),
            // Doc facts come from the PERSISTED Delivery only (D5/D12), so first,
            // queued and post-restart dispatch render the same comment facts.
            ...(current?.docComment === undefined ? {} : { docComment: current.docComment }),
            // Recomputed at render against the CURRENT allowlist (D5/D12).
            senderAllowlisted: repository.getChannelConfig().allowOpenIds.includes(message.senderOpenId),
          },
          deliveries: locusRepository.listDeliveries(record.locusId),
          ...(current === undefined ? {} : { currentDeliveryId: current.deliveryId }),
        })
        return `Host 确认的绑定项目根：${JSON.stringify(project.path)}。文件读取与搜索使用该项目的绝对路径；运行 cwd 不代表项目授权，DSH/Pet 状态目录不可读取。\n\n${prompt}`
      },
      turns: locusTurnObserver,
      allowOpenIds: () => repository.getChannelConfig().allowOpenIds,
      ...(locusControlDispatch === undefined ? {} : { controlDispatch: locusControlDispatch }),
      // Admission is supplied by InboundPipeline for every event so its
      // watermark belongs to the currently connected subscription generation.
      log: (code: string) => petLog(`dsh-pet locus channel: ${code}`),
    })
    : unavailableLocusChannelCapability(
      locusChannelGaps.length === 0
        ? 'Unified locus channel dependencies are incomplete.'
        : locusChannelGaps.join('; '),
    )
  if (locusChannel.status === 'available') {
    locusChannelController = locusChannel.controller

    // Reconciliation runs before the controller is composed so it can safely
    // inspect/repair durable rows without opening intake. Once the exact
    // controller exists, rebuild the in-memory deadline timers for retained
    // currents and drain each locus that has backlog but no current. This is
    // deliberately one pass before `channel.start()`; normal finish/expiry
    // uses the same controller dispatcher and per-locus lane.
    await lifecycle.contain('Locus Delivery startup dispatch', async () => {
      const blockedLoci = new Set(locusStartup.manualDeliveries.map(delivery => delivery.locusId))
      const pendingByLocus = new Map<string, DeliveryCorrelation>()
      for (const delivery of locusStartup.retainedDeliveries) {
        if (delivery.status !== 'current' || delivery.queueState !== 'current') continue
        scheduleCurrentDelivery(delivery)
        if (delivery.executionId !== undefined && delivery.turnId !== undefined) {
          locusTurnObserver?.restoreCurrentCapability?.({
            delivery: {
              deliveryId: delivery.deliveryId,
              executionId: delivery.executionId,
              turnId: delivery.turnId,
              correlation: {
                endpoint: { ...delivery.endpoint },
                locusId: delivery.locusId,
                sessionId: delivery.sessionId,
              },
              status: delivery.status,
            },
          })
        }
      }
      // A `current` row the child's log proved it never took is backlog, not an
      // in-flight execution: retaining it only armed a deadline that would
      // expire a message the child never saw. Re-dispatch it through the same
      // claim fence normal finish/expiry uses. The lease is armed first so a
      // dispatch that cannot claim still cannot leave the row unguarded.
      for (const delivery of locusStartup.replayableDeliveries) {
        scheduleCurrentDelivery(delivery)
        await locusChannelController?.dispatchNext?.({
          endpoint: { ...delivery.endpoint },
          locusId: delivery.locusId,
          sessionId: delivery.sessionId,
        })
      }
      for (const delivery of locusRepository.listDeliveries()) {
        if (delivery.status !== 'accepted' && delivery.status !== 'queued') continue
        if (blockedLoci.has(delivery.locusId)) continue
        const correlation: DeliveryCorrelation = {
          endpoint: { ...delivery.endpoint },
          locusId: delivery.locusId,
          sessionId: delivery.sessionId,
        }
        pendingByLocus.set(locusDispatchKey(correlation), correlation)
      }
      for (const correlation of pendingByLocus.values()) {
        // A legacy `queued`/`running` row retained by exact live-turn proof is
        // an already-dispatched-to-child execution too: it must block a
        // startup successor dispatch the same way `claimCurrentDeliveryMutation`
        // now refuses to claim over one.
        const hasInFlight = locusRepository.listDeliveries(correlation.locusId).some(delivery =>
          delivery.status === 'current' || delivery.status === 'finishing' ||
          delivery.status === 'queued' || delivery.status === 'running',
        )
        if (hasInFlight) continue
        await locusChannelController?.dispatchNext?.(correlation)
      }
    })
  }
  if (locusChannel.status === 'unavailable') {
    petLog(
      `dsh-pet: unified Feishu channel stays unavailable — ${locusChannel.diagnostic}`,
    )
  } else {
    ctx.effect(() => () => { locusChannel.controller.dispose() }, 'dsh-pet: locus channel controller')
  }

  if (locusTurnObserver !== undefined) {
    ctx.effect(() => () => { locusTurnObserver.dispose() }, 'dsh-pet: locus turn observer')
    // The controller is the sole turn-correlation consumer when available.
    // A model turn is only execution evidence; it is not the business Delivery
    // boundary, so an unavailable controller must not install a fallback that
    // settles Deliveries from `turn/end`.
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
   *
   * Existence is proven by cold inspection rather than the live registry; see
   * `createLocusSessionDescriber` for why the live answer is the wrong question.
   */
  const describeSession = createLocusSessionDescriber({
    // Fast path: header-only `stat` + DSH's persisted projection cache, the same
    // sources the native session list reads. A full `inspect` decompresses and
    // replays the whole log (measured ~840 MB of zstd output per refresh for 23
    // loci), which is what made the Locus 管理 list take seconds to open.
    peek: (() => {
      const persistence = ctx.get('sessionPersistence') as
        | { stat?: (id: unknown) => Promise<{ readonly header?: { readonly cwd?: unknown } } | undefined> }
        | undefined
      const cache = ctx.get('sessionProjectionCache') as
        | {
            cachedSnapshot?: (header: unknown, keys?: readonly string[]) => { readonly values?: Record<string, unknown> } | undefined
            // Title-only hint for a log whose cache row predates its current
            // format (pre-migration v0 logs); DSH's own list uses the same fallback.
            cachedPredecessorTitle?: (header: unknown) => { readonly values?: Record<string, unknown> } | undefined
          }
        | undefined
      if (typeof persistence?.stat !== 'function') return undefined
      return async (sessionId: string): Promise<LocusSessionPeek | undefined> => {
        // A live session's in-memory snapshot is already cheap and fresher
        // than any cache row; let `inspect` serve it.
        const sessions = ctx.get('sessions') as { get?: (id: never) => unknown } | undefined
        if (sessions?.get?.(sessionId as never) !== undefined) return undefined
        const snapshot = await persistence.stat!.call(persistence, SessionId(sessionId))
        if (snapshot?.header === undefined) return { exists: false }
        let values: Record<string, unknown> | undefined
        try {
          values = cache?.cachedSnapshot?.call(cache, snapshot.header, ['title'])?.values
            ?? cache?.cachedPredecessorTitle?.call(cache, snapshot.header)?.values
        } catch {
          values = undefined
        }
        const { titleKnown, title } = peekTitleFromProjection(values)
        return {
          exists: true,
          cwd: snapshot.header.cwd,
          titleKnown,
          ...(title === undefined ? {} : { title }),
        }
      }
    })(),
    inspect: (() => {
      if (inspectSession === undefined) return undefined
      return async (sessionId: string) =>
        await inspectSession(sessionId) as {
          readonly events?: readonly unknown[]
          // The immutable header carries `cwd` — the session's workspace-write
          // boundary. It must reach the describer, or the owner has no
          // confirmable execution root and a write grant is unreachable.
          readonly meta?: { readonly cwd?: unknown }
        }
    })(),
    archivedSessionIds: () =>
      ((ctx.workspaceRegistry.archivedSessionIds ?? []) as readonly unknown[]).map(String),
    foldTitle: latestSessionTitle,
  })

  /**
   * The narrow DSH capability todo follow-up dispatch needs (design D9).
   *
   * `agents.get` means LOADED, not "exists": DSH unloads idle agents, so an
   * undefined handle must lead to `resume`, never straight to unreachable
   * (the same trap `dispatcher` documents at the Pet executor path).
   *
   * Resume mounts the session's OWN persisted preset, not Pet's executor
   * setup: an execution target may be a `/bind`-bound `standard` session, and
   * the point is to bring it back exactly as it was — neither widened nor
   * narrowed (design D8's consequence ceiling, task 1.3).
   */
  const liveTodoAgent = (sessionId: string): { status?: unknown; followup?: unknown } | undefined => {
    const found = ctx.agents.get(sessionId as never) as
      | { agent?: { status?: unknown; followup?: unknown }; status?: unknown; followup?: unknown }
      | undefined
    if (found === undefined) return undefined
    return found.agent ?? found
  }

  const todoDispatchPort: TodoDispatchPort = {
    // `ctx.agents.get` returns a BARE Agent (`dsh-agent` index.d.ts:139,341),
    // not an AgentHandle — `{ agent, dispose }` is only what `create`/`resume`
    // hand their owner. Reading `.agent` here made every LOADED session look
    // unloaded, which sent it to `resume` and collided with its own active
    // write handle. Tolerate a handle too, matching the executor path.
    resolve: sessionId => {
      try {
        const status = liveTodoAgent(sessionId)?.status
        return status === 'idle' || status === 'running' ? { status } : undefined
      } catch {
        return undefined
      }
    },
    resume: async sessionId => {
      const { presetId, model } = await persistedCompositionFor(sessionId)
      await ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        agentOptions: model,
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, presetId) },
      })
    },
    followup: (sessionId, text) => {
      const agent = liveTodoAgent(sessionId)
      if (agent === undefined) throw new Error(`session ${sessionId} is not loaded`)
      // A real UserMessage through `followup`, exactly as a native client
      // sends one: it queues its own ordinary turn and wakes the driver,
      // without preempting whatever step is running (design D2).
      ;(agent as { followup(input: unknown): void }).followup(
        createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
      )
    },
  }

  /**
   * The collaborators owner accept uses. Accepting is the only path that
   * delivers a follow-up task, and it targets the todo's WORK main session.
   */
  const todoAcceptDeps = (): AcceptTodoDeps => ({
    readTodo: id => todoBackend.getTodoItem(id),
    port: todoDispatchPort,
    advanceStatus: async (id, to) => todoBackend.advanceStatus(id, to, Date.now()),
    log: reason => petWarn(`dsh-pet ledger: ${reason}`),
  })

  const locusManagement = createLocusManagementPort({
    repository: {
      listRows: () => locusRepository.listRows(),
      findMain: id => locusRepository.findMain(id),
      hasNonTerminalDelivery: locusId => locusRepository.hasNonTerminalDelivery(locusId),
      // A current Delivery (queued / running / finishing included) in the entry's chat.
      hasCurrentDelivery: locusId => {
        const row = locusRepository.getLocus(locusId)
        return row !== undefined && locusRepository.hasCurrentDeliveryInChat(row.endpoint.chatId)
      },
    },
    resolvers: {
      session: describeSession,
      // Group rows: live chat name (cached). Document entries: title/url via drive
      // +inspect (cached); a comment's summary is the earliest persisted quote.
      endpoint: async endpoint => {
        const token = parseDocChatId(endpoint.chatId)
        if (token === undefined) {
          // A topic has no name of its own; only the group row shows the chat name.
          if (endpoint.threadId !== undefined) return undefined
          const chatName = await chatNameCache.get(endpoint.chatId)
          return chatName === undefined || chatName.trim() === '' ? undefined : { chatName }
        }
        const meta = await docMetaCache.get(token)
        const quote = endpoint.threadId === undefined
          ? undefined
          : [...locusRepository.listDeliveries()]
            .filter(record => record.endpoint.chatId === endpoint.chatId && record.endpoint.threadId === endpoint.threadId && record.docComment !== undefined)
            .sort((left, right) => left.sequence - right.sequence)[0]?.docComment?.quote
        return {
          ...(endpoint.threadId === undefined && meta?.title !== undefined ? { chatName: meta.title } : {}),
          ...(meta?.url === undefined ? {} : { docUrl: meta.url }),
          ...(quote === undefined ? {} : { quote }),
        }
      },
      workspace: (id) => {
        const workspace = ctx.workspaceRegistry.get(id as never) as
          | { title?: unknown; path?: unknown }
          | undefined
        if (workspace === undefined) return undefined
        return {
          ...(typeof workspace.title === 'string' ? { title: workspace.title } : {}),
          // Display-only. It is never an execution-root authorization.
          ...(typeof workspace.path === 'string' ? { path: workspace.path } : {}),
        }
      },
    },
    ...(locusProvisioningController === undefined
      ? {}
      : {
        actions: {
          // Controller / access-mutation errors are thrown as they are: the
          // management port maps their `.code` itself.
          stop: fence => locusProvisioningController.stopEntry(fence),
          access: ({ locusId, mode, actorId, expectedRevision }) => locusAccessMutation.set({ locusId, mode, actorId, expectedRevision }),
          rebind: request => locusProvisioningController.rebindChat(request),
          defaultQa: async request => {
            const config = repository.getChannelConfig()
            if (config.botAppId === undefined || larkClient.defaultQaOwner === undefined) {
              throw new PetError('BINDING_INVALID', '无法核验当前飞书用户身份，不能创建默认 Q&A 群。')
            }
            const owner = await larkClient.defaultQaOwner(config.botAppId, config.allowOpenIds)
            if (owner.kind !== 'ready') {
              throw new PetError(
                'BINDING_INVALID',
                `无法核验当前飞书用户身份，不能创建默认 Q&A 群：${owner.diagnostic}`,
              )
            }
            const result = await locusProvisioningController.createOrOpenDefaultQa({
              parentSessionId: request.parentSessionId,
              ownerId: owner.ownerId,
              ...(request.groupName === undefined ? {} : { groupName: request.groupName }),
            })
            return { chatId: result.group.endpoint.chatId, created: result.created, reused: result.reused }
          },
        },
      }),
  })

  // Q&A ownership is re-probed from the fixed profile's verified current-user
  // identity at the operation boundary. Browser auth proves only access to this
  // Host, while allowlist configuration alone cannot prove "本人" ownership.
  ctx.effect(
    () =>
      capabilities.registerBuiltin({
        id: QA_GROUP_ACTION_ID,
        label: '答疑群',
        description: '通过统一 locus default-Q&A 创建或打开本会话的答疑入口。',
        probe: () => {
          if (locusProvisioningController === undefined) return '统一 locus 创建能力不可用。'
          const config = repository.getChannelConfig()
          if (config.botAppId === undefined || config.allowOpenIds.length === 0) {
            return '请先绑定 Bot，并在 Pet 设置中配置本人 allowlist。'
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
        // Doc comments enter the SAME controller after their own admission
        // (pet-locus-doc-comments D7); the service owns the retry and stop.
        ...(locusChannel.controller.handleAdmission === undefined
          ? {}
          : {
            docCommentLocus: {
              handleAdmission: (admission: import('./host/channel/locus-controller.js').NormalizedLocusAdmission) =>
                locusChannel.controller.handleAdmission!(admission),
            },
          }),
        locusAuthorization,
        locusAccessMode: endpoint => locusRepository.getRow(endpoint)?.accessMode,
        // Bot-added produces no locus of its own: the whole tree is built on
        // demand by the first qualifying @ message, the same seam a group and
        // a topic both already use. `botLifecycleInitializer` stays
        // deliberately unset — `ChannelService` treats it as optional and
        // never constructs `BotLifecycleIntake` without it, so the bot-added
        // subscription itself is never started. This is not a degraded state:
        // it is the only path, whether or not `locusProvisioningController`
        // exists.
        botLifecycleDiagnostic:
          'Bot-added does not initialize a locus; the first allowlist @ will.',
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
    log: message => petLog(message),
  })

  /**
   * Per-session tail of in-flight Invocation-state projections.
   *
   * `turn/end` is projected without blocking the event bus, which leaves a
   * window where the next turn's message is observed while the previous
   * Invocation still looks current. Follow-up registration awaits this tail so
   * it judges the slot AFTER settlement, never against a stale view.
   */
  const projectionTails = new Map<string, Promise<void>>()
  const trackProjection = (sessionId: string, work: Promise<void>): void => {
    const settledWork = work.then(
      () => undefined,
      () => undefined,
    )
    const previous = projectionTails.get(sessionId) ?? Promise.resolve()
    const tail = Promise.all([previous, settledWork]).then(() => {
      if (projectionTails.get(sessionId) === tail) projectionTails.delete(sessionId)
    })
    projectionTails.set(sessionId, tail)
  }
  projectionSettled = sessionId => projectionTails.get(sessionId) ?? Promise.resolve()

  ctx.effect(
    () =>
      ctx.on('session/event', (session: { id: unknown }, event: { type: string; data?: unknown }) => {
        const executorSessionId = String(session.id)
        if (repository.findTaskByExecutor(executorSessionId) === undefined) return
        const project = (
          next: Parameters<PetCoordinator['onAgentEvent']>[1],
        ): void => {
          trackProjection(executorSessionId, coordinator.onAgentEvent(executorSessionId, next))
        }

        // A message entering the executor session's inbox. The durable splice
        // is appended immediately before the turn it belongs to starts, so a
        // client submission is registered here while the serial slot is free;
        // when it is not, the claim below retries on that message's own turn.
        // Only ever a read of message identity — nothing here authorizes work.
        if (event.type === 'agent/inbox/spliced') {
          const inserted = (event.data as { inserted?: unknown } | undefined)?.inserted
          if (Array.isArray(inserted)) {
            for (const message of inserted) followups?.observe(executorSessionId, message)
          }
          return
        }

        if (event.type === 'turn/start') {
          project({ kind: 'turn-start' })
          return
        }
        // An approval request blocks the turn on the user. Project it so the
        // panel shows `waiting-user` instead of an opaque `running`, and so a
        // queued Invocation is not started behind work that is actually
        // waiting. The decision resumes execution.
        if (event.type === 'approval/asked') {
          project({ kind: 'waiting-user' })
          return
        }
        if (event.type === 'approval/decided') {
          project({ kind: 'turn-start' })
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
            project({ kind: 'turn-complete' })
            if (settling !== undefined) void channel?.settle(settling, 'succeeded')
            return
          case 'aborted':
            project({ kind: 'cancelled' })
            if (settling !== undefined) void channel?.settle(settling, 'failed')
            return
          default:
            // `failed`, `blocked` and any future reason settle as a failure
            // rather than leaving the Invocation running forever.
            project({
              kind: 'turn-error',
              message: reason?.error?.message ?? `turn ended: ${reason?.kind ?? 'unknown'}`,
            })
            if (settling !== undefined) void channel?.settle(settling, 'failed')
        }
      }),
    'dsh-pet: project Invocation state from session events',
  )

  /**
   * Register in-session follow-ups on the turn that actually claims them.
   *
   * The claim reports exactly which message a turn consumes, which is the one
   * point where "this user turn" and "this Invocation" can be tied together
   * without guessing. Splices handle the common case earlier; this covers a
   * message that was spliced while the serial slot was still occupied.
   */
  ctx.effect(
    () =>
      ctx.on('agent/inbox/claimed', ((payload: { agent?: { id?: unknown }; message?: unknown }) => {
        const executorSessionId = payload?.agent?.id
        if (typeof executorSessionId !== 'string') return
        followups?.observe(executorSessionId, payload?.message)
      }) as never),
    'dsh-pet: register in-session follow-up Invocations',
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

  const stopIdentity = { hostPid: process.pid, bootId: randomUUID() }
  const stopPreparation = new StopPreparation(stopIdentity, {
    freeze: async () => {
      if (locusChannelController?.freezeForShutdown === undefined || locusChannelController.resumeAfterShutdown === undefined) {
        throw new PetError('LOCUS_UNAVAILABLE', 'This Host cannot freeze Locus admission.')
      }
      await locusChannelController.freezeForShutdown()
    },
    drain: async () => {
      if (!locusChildProbe.available || locusChildProbe.ports.compensation === undefined || locusChildProbe.ports.proof === undefined) {
        throw new PetError('LOCUS_UNAVAILABLE', 'Owned child drain and catalog proof are unavailable.')
      }
      const ports = locusChildProbe.ports
      const compensation = ports.compensation!
      if (!('drainChildren' in compensation) || typeof compensation.drainChildren !== 'function') {
        throw new PetError('LOCUS_UNAVAILABLE', 'Exact owned-child drain is unavailable.')
      }
      const drainChild = compensation.drainChildren.bind(compensation)
      const tasks: Array<() => Promise<void>> = []
      const interrupted: Array<{ childSessionId: string; parentSessionId: string; deliveryId: string }> = []
      // Include cold catalog records: an activation admitted before freezing
      // may not yet have published an Agent in the live registry.
      for (const row of locusReconcileRows()) {
        // Only an active row has a created child (a `not-created` one has none).
        if (row.row.state !== 'active') continue
        const childSessionId = row.row.sessionId
        const parentSessionId = row.locusMainSessionId
        const liveChild = ctx.agents.get(childSessionId as never)
        const pair = locusRepository.findMain(parentSessionId)
        if (pair?.status !== 'active') {
          if (liveChild !== undefined) throw new PetError('LOCUS_CONFLICT', 'A live Pet child has no current owning generation.')
          continue
        }
        const parent = ports.parent.get(parentSessionId as never)
        if (parent === undefined) {
          if (liveChild !== undefined) throw new PetError('LOCUS_CONFLICT', 'A live Pet child has no live owner.')
          continue
        }
        const proof = await ports.proof!.findChild(parentSessionId, childSessionId, new AbortController().signal)
        if (proof?.parentSessionId !== parentSessionId || proof.childSessionId !== childSessionId) {
          throw new PetError('LOCUS_CONFLICT', 'Owned child catalog identity could not be proven.')
        }
        if (liveChild !== undefined) {
          for (const delivery of locusRepository.listDeliveries(row.row.locusId)) {
            if ((delivery.status === 'current' || delivery.status === 'running') && delivery.sessionId === childSessionId) {
              interrupted.push({ childSessionId, parentSessionId, deliveryId: delivery.deliveryId })
            }
          }
        }
        tasks.push(() => drainChild(parent, [childSessionId]))
      }
      const results = await Promise.allSettled(tasks.map(task => task()))
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (errors.length > 0) throw new AggregateError(errors, 'Owned child drain failed')
      // Native close is durable; now wait for the event observer's Pet commits.
      await locusChannelController!.freezeForShutdown!()
      for (const target of interrupted) {
        const delivery = locusRepository.getDelivery(target.deliveryId)
        if (delivery === undefined || (delivery.status !== 'current' && delivery.status !== 'running')) continue
        const proof = await proveStartupDeliveryFromColdRead({
          delivery, parentSessionId: target.parentSessionId,
          query: ctx.get('sessionQuery') as LocusSessionQueryLike | undefined,
          log: message => petLog(`dsh-pet shutdown evidence: ${message}`),
        })
        if (proof?.state !== 'interrupted' || delivery.inboxMessageId === undefined || delivery.executionId === undefined || delivery.turnId === undefined || delivery.revision === undefined) {
          // Not an interrupted execution (idle awaiting continuation, never
          // started, or unprovable): it stays durable current, exactly as an
          // ordinary restart leaves it for startup recovery or its lease.
          petLog(`dsh-pet shutdown: ${delivery.deliveryId} retained without interruption proof`)
          continue
        }
        const result = await locusRepository.settleByTurn({
          deliveryId: delivery.deliveryId, executionId: delivery.executionId, turnId: delivery.turnId,
          inboxMessageId: delivery.inboxMessageId, expectedRevision: delivery.revision,
          correlation: { endpoint: delivery.endpoint, locusId: delivery.locusId, sessionId: target.childSessionId, turnId: delivery.turnId },
          outcome: 'failed', failureReason: 'turn-interrupted', settledAt: Date.now(),
        })
        if (!result.changed) throw new PetError('LOCUS_CONFLICT', 'Interrupted execution could not be durably settled.')
      }
    },
    resume: async () => { await locusChannelController?.resumeAfterShutdown?.() },
  })
  ctx.effect(() => () => stopPreparation.dispose(), 'dsh-pet: shutdown preparation')
  const controlPort = ctx.webServer.port
  const profileName = ctx.get('profileContext')?.name
  if (typeof controlPort === 'number' && Number.isInteger(controlPort) && controlPort > 0 && typeof profileName === 'string' && typeof ctx.connection.authenticatedUrl === 'function') {
    const origin = `http://127.0.0.1:${controlPort}`
    await lifecycle.contain('Pet shutdown discovery', () => publishStopDescriptor(paths.dshHome, controlPort, {
      v: 1, pid: stopIdentity.hostPid, bootId: stopIdentity.bootId, profile: profileName,
      origin, authenticatedUrl: ctx.connection.authenticatedUrl(origin),
    }))
    // The descriptor carries a credential URL; never leave it behind this boot.
    ctx.effect(() => () => releaseStopDescriptor(paths.dshHome, controlPort, stopIdentity.bootId), 'dsh-pet: release shutdown discovery')
  }

  for (const route of [...createPetRoutes({
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
    archivedSessionIds: () =>
      ((ctx.workspaceRegistry.archivedSessionIds ?? []) as readonly unknown[]).map(id => String(id)),
    // Owner-facing locus view/discovery and durable lifecycle transitions.
    // The identity is Host-derived; routes reject any actor a browser sends.
    locus: locusManagement,
    withLocusMutation: runLocusMutation,
    locusIdentity: () => ({ actorId: 'host:dsh-pet' }),
    // Shared-fact ledger todo surface. Projects the durable record for the
    // owner panel; `generation` rides along as an audit fact only — the
    // panel's session jump resolves the CURRENT generation through the locus
    // view, so a stale instance can never become a jump target (design D6).
    todoLedger: {
      // Legacy todos read-only beside the live ledger; an unavailable
      // collaboration layer is stated, never shown as an empty list (D10).
      list: parentSessionId => ownerLedger.list(parentSessionId),
      // `done` / `drop` stay pure status advances — they settle a record and
      // dispatch nothing. `accept` means "start working on it", so it runs the
      // gate → dispatch → advance orchestration instead (design D5).
      advance: async (itemId, action) => {
        // A legacy todo is read-only: refused before any backend is touched.
        await ownerLedger.guard(itemId, action)
        if (action !== 'accept') {
          const to = action === 'done' ? 'done' : 'dropped'
          return {
            todo: projectTodoForOwner(
              await todoBackend.advanceStatus(itemId, to, Date.now()),
            ),
          }
        }
        // Same collaborators the child tool uses — one chain, two entries.
        const result = await acceptTodo(itemId, todoAcceptDeps())
        if (!result.ok) {
          // An unreachable target is an OUTCOME the owner must see in place
          // (spec: 目标不可达时不置已受理 — 就地说明原因), not a transport
          // error. Only a refusal with no receipt — stale status, unknown
          // id — is a rejected request.
          if (result.dispatch?.outcome !== 'unreachable') {
            throw new PetError('INVALID_REQUEST', result.reason)
          }
          const current = await todoBackend.getTodoItem(itemId)
          if (current === undefined) throw new PetError('INVALID_REQUEST', result.reason)
          return { todo: projectTodoForOwner(current), dispatch: result.dispatch }
        }
        return { todo: projectTodoForOwner(result.record), dispatch: result.dispatch }
      },
      // Derive owning main sessions from the locus records themselves rather
      // than from ledger rows: a main session whose ledger exists but is
      // currently empty must still appear, so the panel shows a real empty
      // state instead of omitting the session entirely.
      parents: () => [...new Set(locusReconcileRows().map(item => item.locusMainSessionId))],
    },
    // One chain per entry (its current sessionId), assembled from durable records only.
    locusDiagnostics: () => locusRepository
      .listRows()
      .filter(row => row.state === 'active' || row.state === 'invalid')
      .map(row => buildLocusDiagnostics(row, locusRepository.listDeliveries(row.locusId))),
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
  }), petRoute(PET_PREPARE_STOP_ROUTE, ({ body }) => stopPreparation.request(body))]) {
    ctx.effect(
      () => {
        const protectedRoute = withBrowserAuth(route, ctx.connection)
        return ctx.webServer.register({
          kind: 'exact',
          path: protectedRoute.path,
          handler: protectedRoute.handler,
        })
      },
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
  // Same sink as the degraded reporter: a readiness line an operator can
  // actually grep is what distinguishes "Pet started and registered its
  // routes" from "Pet never ran at all", which otherwise look identical.
  petLog(`ready — routes registered (state: ${paths.stateRoot})`)
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
 * docs/architecture/dsh-plugin-integration-pitfalls.md §4), where the readable
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
export { PET_DOMAIN_NAME, PET_DOMAIN_VERSION } from './host/spec.js'
export { petDomainSpec } from './host/domain.js'
export { inspectBundle, BUNDLE_LIMITS } from './host/skill-bundle.js'
export {
  rebuildProjection,
  detectProjectionDrift,
  inspectProjectionEntry,
} from './host/projection.js'
export { createPetSkillProvider, currentAllowlist } from './host/skill-provider.js'
