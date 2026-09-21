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
import { registerPetTools } from './host/tools.js'
import { CollaborationContextStore } from './host/collaboration/context-store.js'
import { createCollaborationHostIdentity } from './host/collaboration/host-identity.js'
import { createCollaborationContextRoutes } from './host/collaboration/routes.js'
import {
  composeCollaborationSurface,
  type CollaborationAssembly,
} from './host/collaboration/assembly.js'
import { InquiryLedgerStore } from './host/inquiry/ledger-store.js'
import { SharedFactLedgerStore } from './host/ledger/store.js'
import { InquiryOutboxStore } from './host/inquiry/outbox-store.js'
import { summarizeInquiryReconciliation } from './host/inquiry/reconcile.js'
import type { InquiryOriginProof } from './host/inquiry/ask.js'
import type {
  PetLocusFinishInput,
  PetLocusFinishResult,
  PetLocusWaitInput,
  PetLocusWaitResult,
} from './host/tools.js'
import {
  LocusRepository,
  type LocusStartupCompensators,
} from './host/locus/persistence.js'
import {
  DEFAULT_DELIVERY_LEASE_MS,
  MAX_DELIVERY_LEASE_MS,
  type DeliveryCorrelation,
  type DeliveryFinishInput,
  type DeliveryRecord,
} from './host/locus/delivery.js'
import { createExpiryScheduler } from './host/locus/expiry-scheduler.js'
import { proveLiveStartupDelivery } from './host/locus/startup-recovery.js'
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
import { createLocusManagementPort, createLocusSessionDescriber } from './host/locus/management.js'
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
import { asLocusContextRepository, type LocusContextRepository } from './host/locus/context-repository.js'
import { renderLocusDeliveryPrompt } from './host/locus/context.js'
import {
  composeLocusChild,
  type LocusChildPermission,
  type LocusCandidateAgent,
  type LocusCompositionPorts,
} from './host/locus/composition.js'
import { installLocusProjectReadGuard, locusDeniedRoots } from './host/locus/project-read-guard.js'
import { currentAllowlist } from './host/skill-provider.js'
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

/**
 * Project one durable todo into its owner-facing wire shape.
 *
 * Flattens `evidence` into `summary`/`detail` because the panel renders them
 * as two distinct fields, and passes `generation` through as an AUDIT fact
 * only — no consumer may use it to address a locus (design D6: a todo
 * references locus identity, never a locus instance).
 */
function projectTodoForOwner(record: TodoRecord): PetTodoView {
  return {
    itemId: record.itemId,
    locusId: record.locusId,
    generation: record.generation,
    endpoint: record.endpoint,
    triggerMessageId: record.triggerMessageId,
    requestedBy: record.requestedBy,
    summary: record.evidence.summary,
    detail: record.evidence.detail,
    status: record.status,
    createdAt: record.createdAt,
    statusChangedAt: record.statusChangedAt,
  }
}

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
  void initialize(ctx, lifecycle, paths, config).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    // `markDegraded` now reports through the sink above, so logging here too
    // would duplicate the line for this one path while leaving every contained
    // step unlogged.
    lifecycle.markDegraded(`Pet initialization failed: ${reason}`)
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
  const collaborationContextStore = new CollaborationContextStore(domain as never)
  const collaborationHostIdentity = createCollaborationHostIdentity({
    sessionController: ctx.get('sessionController') as never,
    workspaceRegistry: ctx.workspaceRegistry as never,
  })
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
    readonly generation?: number
  }
  let currentLocusCapability: (childSessionId: string) => CurrentLocusCapabilityProjection | undefined = () => undefined
  let inspectCurrentLocusCapability: (childSessionId: string) =>
    | { readonly ok: true; readonly capability: CurrentLocusCapabilityProjection }
    | { readonly ok: false; readonly reason: import('./host/locus/turn-observer.js').LocusCurrentCapabilityReason } =
      () => ({ ok: false, reason: 'capability-unavailable' })
  const locusDispatchLanes = new Map<string, Promise<void>>()
  const locusDispatchKey = (correlation: DeliveryCorrelation): string => [
    correlation.locusId,
    String(correlation.generation),
    correlation.childSessionId,
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
  } | undefined
  const locusContextRepository = asLocusContextRepository(
    locusRepository,
    childSessionId => currentLocusTurnProof(childSessionId),
  )

  /**
   * Agent scopes already carrying the scoped collaboration + inquiry surface.
   *
   * A fourth marker alongside `composedAgents`/`allowlistAgents`/
   * `contextToolAgents` below, following the same discipline for the same
   * reason: the SAME agent can be offered this surface from more than one
   * entry point (the synchronous locus-child boundary, the `agent/created`
   * fall-through, the live-parent repair after a first locus is published),
   * and a second registration of the same tool name throws
   * `tool "..." is already registered in this scope`. An explicit weak marker
   * is the deduplication; swallowing a duplicate-registration error is exactly
   * how the `shellEnv` incident cost the executor its `bash` tool.
   *
   * Declared here rather than beside the others because the assembly that
   * consumes it is composed before them.
   */
  const collaborationAgents = new WeakSet<object>()

  /**
   * Durable inquiry ledger over the same opened domain.
   *
   * Constructed unconditionally: it proves the atomic-batch capability itself
   * on every call and rejects without it, and the assembly below refuses to
   * publish anything when that capability is absent.
   */
  const inquiryLedgerStore = new InquiryLedgerStore(domain as never)

  /**
   * Durable shared-fact ledger (`pet-locus-intent-triage`) over the same
   * opened domain. Constructed unconditionally for the same reason as the
   * inquiry ledger above: it proves the atomic-batch capability on every call
   * and rejects without it, so construction itself commits nothing.
   */
  const sharedFactLedgerStore = new SharedFactLedgerStore(domain as never)

  /**
   * Caller-bound intent-triage capability set, shared by BOTH composition
   * paths below (Pet's own executor setup and DSH's native agent load).
   *
   * Built once on purpose: a locus child that could register a todo through
   * one path but not the other is exactly the split surface the scoped
   * assembly pitfalls warn about, and it would be invisible to a unit test
   * that calls `registerPetTools` directly.
   *
   * `inspect` is PROBED rather than injected — a Host without cold-read keeps
   * every other tool working while the parent-lookup tool reports itself
   * unavailable (spec: 缺少冷读能力时如实降级，不猜测、不降级为提问).
   */
  const intentTriageDeps = (() => {
    const controller = ctx.get('sessionController') as
      | { inspect?: (id: unknown, signal?: AbortSignal) => Promise<unknown> }
      | undefined
    const inspect = controller?.inspect
    return {
      // Returns EVERY durable generation for the child identity; rejecting
      // ambiguity is the caller's job — exactly `resolveLedgerCaller`'s contract.
      loci: { findByChildSessionId: (id: string) => locusRepository.findByChildSessionId(id) },
      ledgerRead: { listForParent: (id: string) => sharedFactLedgerStore.listForParent(id) },
      track: {
        store: sharedFactLedgerStore,
        now: () => Date.now(),
        newItemId: () => `todo-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      },
      ...(typeof inspect !== 'function' ? {} : {
        parentLookup: {
          // Keep the receiver: `inspect` is a service method that uses `this`.
          inspect: async (sessionId: string) =>
            await inspect.call(controller, sessionId) as { readonly events?: readonly unknown[] },
        },
      }),
    }
  })()
  // The result outbox is the other half of restart reconciliation: without it
  // the pass can classify inquiries but cannot see whether a result already
  // exists, so it would report a fault instead of reconciling on a guess.
  const inquiryOutboxStore = new InquiryOutboxStore(domain as never)

  /**
   * Synchronous, cheap durable description of one circle member.
   *
   * The roster contract forbids reading or summarizing a member's history, and
   * requires a SYNCHRONOUS answer, so the owner-facing
   * `createLocusSessionDescriber` (an async cold log read used for the
   * management view) is deliberately not reused here. `sessions.get` means
   * LOADED, not "exists" — which is precisely the distinction the roster wants:
   * a durable member DSH has unloaded is `unloaded`, i.e. `needs-restore`, not
   * missing. Archived members never reach this function; the caller resolver
   * excludes them from the circle first.
   */
  const describeCollaborator = (sessionId: string): { title?: string; availability?: 'available' | 'unloaded' } => {
    const session = ctx.sessions.get(sessionId as never)
    if (session === undefined) return { availability: 'unloaded' }
    // Titles are log-only `session/title` events, never header fields.
    const snapshot = ctx.sessionTitle.get(session as never) as { title?: unknown } | undefined
    const title = typeof snapshot?.title === 'string' && snapshot.title.trim() !== ''
      ? snapshot.title
      : undefined
    return { availability: 'available', ...(title === undefined ? {} : { title }) }
  }

  /**
   * Host-proven origin and audience of the work one caller is serving.
   *
   * Derived from the executing session's durable facts, never from an argument:
   * a child serving a Feishu Delivery cannot relabel that work as private local
   * work to widen what an answer may contain. A locus child whose current
   * Delivery cannot be proven gets `local` origin with an `unknown` audience —
   * honest rather than a claim of privacy — and a main session gets a genuinely
   * local origin, because a main session has no Feishu outbound at all.
   */
  const resolveInquiryOrigin = (callerSessionId: string): InquiryOriginProof | undefined => {
    try {
      const owned = locusRepository.findByChildSessionId(callerSessionId)
      if (owned.length > 1) return undefined
      const row = owned[0]
      if (row === undefined) {
        // Not a locus child: a main session's work is local to its own session.
        if (locusRepository.getLocusByChild(callerSessionId) !== undefined) return undefined
        return {
          origin: { kind: 'local' },
          audience: { kind: 'local-session', sessionId: callerSessionId },
        }
      }
      if (row.state !== 'active' || row.childSessionId !== callerSessionId) return undefined
      const proof = currentLocusTurnProof(callerSessionId)
      const delivery = proof === undefined
        ? undefined
        : locusRepository
          .listPendingDeliveries(row.id)
          .find(record =>
            record.childSessionId === callerSessionId
            && record.executionId === proof.executionId)
      if (delivery === undefined) {
        // No provable Feishu request behind this segment. `unknown` tightens
        // disclosure instead of asserting a private local audience.
        return { origin: { kind: 'local' }, audience: { kind: 'unknown' } }
      }
      return {
        origin: { kind: 'feishu-delivery', deliveryId: delivery.deliveryId },
        audience: { kind: 'feishu-chat', chatId: delivery.endpoint.chatId },
      }
    } catch {
      // An unreadable index proves nothing; refusing is the only safe answer.
      return undefined
    }
  }

  /**
   * The scoped collaboration + inquiry surface, or nothing.
   *
   * `undefined` here means a required seam is missing and Pet keeps behaving
   * exactly as before — no tool is published and no diagnostic path changes.
   *
   * Inquiry DISPATCH stays unavailable on this Host by construction: the real
   * detector reads the isolated queued-turn claim marker off the agent driver,
   * and the pinned runtime carries no such marker (the seam exists only as a
   * tracked compatibility patch that this Host does not load). No probe is
   * supplied either, because a probe built from a `dsh-agent` copy other than
   * the one the Host actually loaded proves nothing — the capability audit
   * records exactly that failure. The verdict is therefore passed to the
   * scheduler as-is; nothing here fakes it available.
   */
  const collaborationSurface: CollaborationAssembly | undefined = composeCollaborationSurface({
    atomicStorage: locusRepository.supportsAtomicProvisioning(),
    loci: locusRepository,
    identity: collaborationHostIdentity,
    contextStore: collaborationContextStore,
    ledger: inquiryLedgerStore,
    resultOutbox: inquiryOutboxStore,
    describe: describeCollaborator,
    origin: resolveInquiryOrigin,
    // `ctx.get` rather than property access: `agentLoop` is not in this
    // plugin's `inject`, and cordis throws on undeclared property access.
    agentLoop: ctx.get('agentLoop'),
    installed: collaborationAgents,
  })
  if (collaborationSurface === undefined) {
    petLog('dsh-pet: scoped collaboration/inquiry surface unavailable — required seams are missing')
  } else if (!collaborationSurface.inquiryDispatch.available) {
    petLog(
      'dsh-pet: inquiry dispatch stays unavailable '
      + `(${collaborationSurface.inquiryDispatch.reason}); members are reported as not inquirable`,
    )
  }

  /**
   * Settle durable inquiry work left behind by the previous process.
   *
   * Runs BEFORE the channel starts so a recovered request is never raced by new
   * intake. It only classifies and settles from durable rows: provably
   * undispatched work stays dispatchable, dispatched-but-unknown work becomes
   * needs-review and is never auto-retried. Long-waiting queued work remains
   * recoverable regardless of downtime; only explicit cancellation or a
   * Host-proven unknown dispatch changes its disposition. It wakes no model,
   * starts no turn and sends nothing outbound, so a
   * failure here degrades diagnostics — not intake.
   */
  if (collaborationSurface !== undefined) {
    const reconciled = await lifecycle.contain('Pet inquiry reconciliation', () =>
      collaborationSurface.reconcileInquiries())
    if (reconciled !== undefined) {
      petLog(`dsh-pet: ${summarizeInquiryReconciliation(reconciled)}`)
    }
  }

  /**
   * Install the collaboration surface on ONE live agent scope, if it belongs.
   *
   * Eligibility is a durable hint used to decide whether to install at all;
   * every tool body still re-derives the caller and re-authorizes, so a revoked
   * child cannot use a tool that merely remains visible to it. Returns whether
   * anything was installed, and THROWS on a real installation failure so the
   * synchronous locus boundary can veto publication; asynchronous callers
   * contain it themselves.
   * @param agentCtx - the agent's own scope; never the Host context.
   * @param sessionId - the agent's session id.
   * @returns whether the surface is now present on that scope.
   */
  const installCollaborationScope = (agentCtx: unknown, sessionId: string): boolean => {
    if (collaborationSurface === undefined) return false
    if (agentCtx === null || typeof agentCtx !== 'object') return false
    if (collaborationSurface.isInstalled(agentCtx)) return true
    if (!collaborationSurface.eligible(sessionId)) return false
    collaborationSurface.install(agentCtx)
    return true
  }

  /** Same installation, contained: for paths that repair a PUBLISHED agent. */
  const repairCollaborationScope = (agentCtx: unknown, sessionId: string): void => {
    try {
      installCollaborationScope(agentCtx, sessionId)
    } catch (error) {
      petWarn(
        `dsh-pet: could not install the collaboration surface on ${sessionId} (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }
  }

  /** The live agent's own scope for one session, when DSH has it loaded. */
  const liveAgentScope = (sessionId: string): unknown => {
    try {
      const handle = ctx.agents.get(sessionId as never) as
        | { ctx?: unknown; agent?: { ctx?: unknown } }
        | undefined
      return handle?.ctx ?? handle?.agent?.ctx
    } catch {
      return undefined
    }
  }

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

  // This is intentionally a separate Host owner proof from locusIdentity
  // (`host:dsh-pet` is a plugin identity, not a browser principal). Until the
  // Connection service exposes a target-parent local-owner verdict, the route
  // stays unmounted rather than upgrading an allowlist or agent label.
  const collaborationOwnerIdentity = (): undefined => undefined

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
    // A Pet executor session can also be the MAIN session of a circle — an
    // owner may bind a Feishu entry to it like any other session. Eligibility
    // decides; an ordinary executor with no locus and no shared record gets
    // nothing, which is the "do not change existing behaviour" case.
    //
    // Separately contained from the Pet scope above: losing the circle surface
    // must never cost an executor `pet_context`, and a failure here must not
    // make the fail-closed dispatch check below reject a usable Invocation.
    repairCollaborationScope(view.ctx, String(sessionId))
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
      install: (agent, composition) => {
        const scope = agent.scope as unknown as Context
        const tools = scope.get('tools') as { register(definition: unknown): unknown } | undefined
        if (tools === undefined) {
          throw new PetError('INTERNAL', 'Agent scope exposes no tools service')
        }
        const childSession = ctx.sessions.get(agent.id as never)
        const parentSession = ctx.sessions.get(composition.parentSessionId as never)
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
        installLocusProjectReadGuard(scope, {
          childCwd,
          parentCwd,
          workspaceRoot,
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
        })
        // The circle surface rides the SAME synchronous boundary, so a locus
        // child never starts its first turn able to read shared facts but not
        // to list its collaborators, or the reverse. Installed unconditionally
        // rather than through the durable eligibility hint: the composer has
        // already proven this exact session is a current locus child, and for a
        // FRESH child the durable row is not active yet, so the hint would say
        // no precisely when the surface matters most.
        //
        // A throw here vetoes publication, which is the same guarantee the
        // caller-bound surface above already has. An absent assembly is not a
        // failure: the whole surface is simply not published and the child
        // behaves exactly as it did before this existed.
        collaborationSurface?.install(agent.scope)
      },
      // `safe-v1` claims this child cannot reach an execution or delegation
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
      // `write` means FULL access by explicit owner decision (ADR-0005): a
      // locus child's cwd is its parent's cwd, so `workspace-write` could never
      // cover the sibling worktrees the owner actually works in.
      const modeOf = (permission: LocusChildPermission): string =>
        permission === 'write' ? 'danger-full-access' : 'read-only'
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
            return resolved === 'danger-full-access' ? 'write' : undefined
          },
        },
      }
    })(),
  }

  ctx.effect(
    () =>
      ctx.on('agent/created', (payload: { agent?: unknown }) => {
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
          const candidate: LocusCandidateAgent = { id: sessionId, scope: agent.ctx as never }
          // Rethrown deliberately: only a candidate that matched durable or
          // staged locus identity may veto publication. Logged first because the
          // veto travels out through agent creation and provisioning, which
          // collapse it into one generic `locus-unavailable` refusal — without
          // this line an operator cannot tell a leaked tool from an unverified
          // policy or an unreadable surface, and the child simply stops being
          // published.
          let result: ReturnType<typeof composeLocusChild>
          try {
            result = composeLocusChild(candidate, locusCompositionPorts)
          } catch (error) {
            petLog(
              `dsh-pet: locus composition refused ${sessionId} (${
                error instanceof Error ? error.message : String(error)
              })`,
            )
            throw error
          }
          if (result.composed) {
            composedAgents.add(agent.ctx as object)
            contextToolAgents.add(agent.ctx as object)
            // The circle marker is deliberately NOT set here. `install()` adds
            // it itself, and only after every registration succeeded; setting
            // it from outside would record a surface that may never have been
            // installed at all — for example when no assembly composed — and
            // then permanently suppress the repair paths that would fix it.
            return
          }
          // This is the COLD RESTORE and NATIVE GUI LOAD entry point for a main
          // session, and for a locus child whose durable row was already active
          // when DSH republished it. Neither is a Pet Task executor, so the
          // foreign-executor path below leaves both untouched.
          //
          // Contained rather than rethrown: unlike a fresh locus child, this
          // agent is an ordinary user session that DSH is publishing for its own
          // reasons. Vetoing that publication because Pet could not add its
          // circle tools would take the user's session away over an additive
          // capability. The surface is simply absent and every tool body would
          // have refused anyway.
          repairCollaborationScope(agent.ctx, sessionId)
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
  const locusChildDelivery = locusChildProbe.available
    ? createLocusChildDelivery({
      // One adapter owns exactly one active child; use a factory so sibling
      // loci under the same main session do not contend for one singleton.
      createAdapter: () => createLocusChildAdapter(locusChildProbe.ports),
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
        log: code => petLog(`dsh-pet locus reconcile: ${code}`),
      },
      locusReconcileAbort.signal,
    )
    if (report.invalidated.length > 0 || report.busyCleared.length > 0) {
      petLog(
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
    petLog(`dsh-pet: unified locus child seam unavailable — ${locusChildProbe.diagnostic}`)
  }
  const idleChildProvisioning = locusChildProbe.available
    && locusChildProbe.ports.subagent.supportsSettlementNotice === true
    && locusChildProbe.ports.subagent.supportsIdleContinuableCreate === true
    && locusChildProbe.ports.subagent.supportsIndependentContinuableCreate === true
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

          // Give the child its own durable title, exactly as the main creation
          // path does. The subagent descriptor already carries this label, but
          // a descriptor is not a Session title: leaving the title unset lets
          // DSH's fallback generator derive one from the first user message —
          // which is the long caller-bound delivery header — so every locus
          // child showed up as "## 当前 unified locus 投递（caller-" and was
          // indistinguishable in the sidebar and the management view.
          //
          // Best-effort by design: the child is already durably created and its
          // locus identity lives in Pet's own records, so a naming failure must
          // not roll back a usable child. It is logged, not swallowed silently.
          const childSession = ctx.sessions.get(reservation.childSessionId as never)
          if (childSession !== undefined) {
            try {
              ctx.sessionTitle.rename(childSession, input.label)
            } catch (error) {
              petLog(
                `dsh-pet: locus child ${reservation.childSessionId} could not be titled (${
                  error instanceof Error ? error.message : String(error)
                })`,
              )
            }
          }

          let finalized = false
          return {
            childSessionId: reservation.childSessionId,
            commit: () => {
              if (finalized) return
              locusPrepublication.commit(reservation)
              finalized = true
              adapter.dispose()
              // The controller calls this only AFTER the active locus row is
              // durably committed, so this is the first instant the main
              // session is provably a circle parent. Install its circle
              // surface now, while it is loaded, so the tools are present in
              // its NEXT tool snapshot rather than after a failed call.
              //
              // Deliberately does NOT start a turn, send a message, mount a
              // preset or touch the main session's existing composition: the
              // spec forbids waking the parent model to announce a membership
              // change. An unloaded parent is simply repaired by the
              // `agent/created` path when DSH next publishes it.
              const parentScope = liveAgentScope(input.parentSessionId)
              if (parentScope !== undefined) {
                repairCollaborationScope(parentScope, input.parentSessionId)
              }
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

  const locusLarkPort = createLocusLarkPort()
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
        idleChildren: idleChildProvisioning,
      })
      const controller = createLocusController({
        repository: new ControllerLocusRepositoryAdapter(locusRepository),
        dsh,
        lark: locusLarkPort,
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
            // Name the new generation after its chat rather than its opaque id.
            // These titles are what the owner reads in Locus management, where
            // `Locus 主会话 · oc_…` says nothing about which group an entry
            // belongs to. Fail-soft: an unresolvable name keeps the id.
            let chatName: string | undefined
            try {
              chatName = await larkClient.chatName(endpoint.chatId)
            } catch {
              chatName = undefined
            }
            const named = chatName === undefined ? {} : { chatName }
            const ensured = endpoint.threadId === undefined
              ? await locusProvisioningController.ensureGroup({ chatId: endpoint.chatId, ...named })
              : await locusProvisioningController.ensureTopic({
                chatId: endpoint.chatId,
                threadId: endpoint.threadId,
                ...named,
              })
            const record = ensured.locus
            if (record.state !== 'active' || record.childComposition !== 'safe-v1') {
              throw new Error(`Provisioned locus is not an active safe-v1 generation`)
            }
            return {
              id: record.locusId,
              endpoint: record.endpoint,
              generation: record.generation,
              parentSessionId: record.parentSessionId,
              childSessionId: record.childSessionId,
              childComposition: record.childComposition,
              workspaceId: record.workspaceId,
              state: 'active' as const,
              permission: {
                desired: record.permission,
                effective: record.permission,
                // Controller generations are published only after Host policy
                // verification; write still needs a separate authorized root.
                verifiedAt: Date.now(),
              },
            }
          },
        },
      }),
    log: reason => petLog(`dsh-pet locus resolve: ${reason}`),
  })

  const locusPermissionMutation = (() => {
    const policy = ctx.get('sandboxPolicy') as
      | { resolve?: (input: { session: unknown }) => { mode?: string; workspaceRoot?: string } | undefined }
      | undefined
    if (policy?.resolve === undefined || locusChildDelivery === undefined) return undefined
    return createLocusPermissionMutation({
      repository: locusRepository,
      sessions: {
        resolve: async (childSessionId) => {
          const locus = locusRepository.getLocusByChild(childSessionId)
          if (
            locus === undefined
            || (locus.state !== 'active' && locus.state !== 'switching')
            || locus.childSessionId !== childSessionId
          ) return undefined
          const identity = {
            parentSessionId: locus.parentSessionId,
            childSessionId,
          }
          try {
            const adopted = await locusChildDelivery.ensureChild({
              id: locus.id,
              parentSessionId: locus.parentSessionId,
              childSessionId,
              ...(locus.childComposition === undefined ? {} : { childComposition: locus.childComposition }),
            }, new AbortController().signal)
            if (
              adopted.parentSessionId !== identity.parentSessionId
              || adopted.childSessionId !== identity.childSessionId
            ) return undefined
          } catch {
            return undefined
          }
          return { id: childSessionId, handle: identity }
        },
      },
      policy: {
        apply: async (resolved, mode) => {
          const identity = resolved.handle as
            | { parentSessionId?: unknown; childSessionId?: unknown }
            | undefined
          if (
            identity?.parentSessionId === undefined
            || identity.childSessionId !== resolved.id
          ) throw new Error('Resolved child identity is incomplete')
          const result = await locusChildDelivery.withChildSession({
            identity: {
              parentSessionId: String(identity.parentSessionId),
              childSessionId: resolved.id,
            },
            operation: session => { setSandboxMode(session as never, mode as never) },
          })
          if (!result.ok) throw new Error(`Continuation owner rejected child Session (${result.reason})`)
        },
        resolve: async (resolved) => {
          const identity = resolved.handle as
            | { parentSessionId?: unknown; childSessionId?: unknown }
            | undefined
          if (
            identity?.parentSessionId === undefined
            || identity.childSessionId !== resolved.id
          ) return undefined
          const result = await locusChildDelivery.withChildSession({
            identity: {
              parentSessionId: String(identity.parentSessionId),
              childSessionId: resolved.id,
            },
            operation: session => policy.resolve!({ session }),
          })
          return result.ok ? result.value : undefined
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
            const record = locusRepository.findDeliveryByInboxMessageId(messageId)
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
      generation: capability.correlation.generation,
    })
    currentLocusCapability = childSessionId => {
      const capability = locusTurnObserver.currentCapabilityForChild?.(childSessionId)
      return capability === undefined ? undefined : projectCapability(capability)
    }
    inspectCurrentLocusCapability = childSessionId => {
      const inspection = locusTurnObserver.inspectCurrentCapabilityForChild?.(childSessionId)
      if (inspection === undefined) return { ok: false, reason: 'capability-unavailable' }
      return inspection.ok
        ? { ok: true, capability: projectCapability(inspection.capability) }
        : inspection
    }
  }

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
    generation: input.locus.locus.generation,
    childSessionId: input.childSessionId,
  })

  const loadCurrentDelivery = (correlation: DeliveryCorrelation, deliveryId: string): DeliveryRecord => {
    const record = locusRepository.getDelivery(deliveryId)
    if (
      record === undefined ||
      record.deliveryId !== deliveryId ||
      record.status !== 'current' ||
      record.queueState !== 'current' ||
      record.locusId !== correlation.locusId ||
      record.generation !== correlation.generation ||
      record.childSessionId !== correlation.childSessionId ||
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
      childSessionId: correlation.childSessionId,
      deliveryId: record.deliveryId,
    })
    locusChannelController?.currentFinished?.({
      deliveryId: record.deliveryId,
      correlation,
      outcome,
    })
    await locusChannelController?.dispatchNext?.(correlation)
  }

  // The lease deadline is durable, but only a live timer notices the moment it
  // passes. `createExpiryScheduler` owns that timing behavior so it can be
  // driven directly in tests; expiry itself stays the durable CAS below it.
  const expiryScheduler = createExpiryScheduler({
    repository: locusRepository,
    withDispatchLane: withLocusDispatchLane,
    finishAndAdvance,
  })
  scheduleCurrentDelivery = (record: DeliveryRecord): void => { expiryScheduler.schedule(record) }

  finishCurrentDelivery = async (input: PetLocusFinishInput): Promise<PetLocusFinishResult> => {
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
  }

  waitCurrentDelivery = async (input: PetLocusWaitInput): Promise<PetLocusWaitResult> => {
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
  }

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
  const startupCompensators: LocusStartupCompensators = {
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
  }
  const locusStartup = await lifecycle.contain('Locus startup reconciliation', () =>
    locusRepository.reconcileStartup({
      deliveryProof: async (delivery: DeliveryRecord) => {
        const observed = locusTurnObserver?.currentForChild?.(delivery.childSessionId)
        if (observed !== undefined && observed.executionId === delivery.executionId) {
          return {
            deliveryId: delivery.deliveryId,
            executionId: observed.executionId,
            turnId: observed.turnId,
            state: 'running' as const,
          }
        }
        if (!locusChildProbe.available || locusChildDelivery === undefined) return undefined
        const locus = locusRepository.getLocus(delivery.locusId)
        if (
          locus === undefined ||
          locus.generation !== delivery.generation ||
          locus.parentSessionId.trim() === '' ||
          locus.childSessionId !== delivery.childSessionId
        ) return undefined
        const identity = { parentSessionId: locus.parentSessionId, childSessionId: delivery.childSessionId }
        try {
          const adopted = await locusChildDelivery.ensureChild({
            id: locus.id,
            parentSessionId: identity.parentSessionId,
            childSessionId: identity.childSessionId,
            ...(locus.childComposition === undefined ? {} : { childComposition: locus.childComposition }),
          }, new AbortController().signal)
          if (
            adopted.parentSessionId !== identity.parentSessionId ||
            adopted.childSessionId !== identity.childSessionId
          ) return undefined
          const result = await locusChildDelivery.withChildSession({
            identity,
            operation: session => proveLiveStartupDelivery(delivery, session),
          })
          return result.ok ? result.value : undefined
        } catch {
          return undefined
        }
      },
      compensators: startupCompensators,
    }),
  )
  if (locusStartup === undefined) return
  if (locusStartup.pendingDeliveries.length > 0 || locusStartup.recoverableOperations.length > 0) {
    petLog(
      `dsh-pet locus recovery: ${String(locusStartup.pendingDeliveries.length)} pending Deliveries, ` +
      `${String(locusStartup.recoverableOperations.length)} recoverable operations; no side effect replayed`,
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
    // Delivery acceptance, queue proof, settlement, and the locus busy fence
    // are one cross-table lifecycle. The compatibility fallback is useful for
    // offline inspection, but a rollback failure could otherwise publish a
    // half mutation that startup recovery cannot safely infer. Production
    // intake therefore requires the same atomic Domain capability as locus
    // provisioning rather than exposing a weaker Delivery-only path.
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
  if (locusChildProbe.available
    && locusChildProbe.ports.subagent.supportsLiveContinuableChildSession !== true) {
    // Generic Session routing rejects subagent-owned children. Scope mutation
    // therefore needs the continuation owner to expose the exact live Session
    // after validating both parent and child identities.
    locusChannelGaps.push('runtime cannot authorize a live continuable child Session')
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
        bindQueued: input => locusRepository.bindQueued(input),
        bindTurn: input => locusRepository.bindTurn(input),
        settleByTurn: input => locusRepository.settleByTurn(input),
        fail: input => locusRepository.fail(input),
      },
      deliveryDispatch: {
         claimCurrent: input => locusRepository.claimCurrentDelivery(input),
         currentFinished: input => locusChannelController?.currentFinished?.(input),
         dispatchNext: input => locusChannelController?.dispatchNext?.(input),
         scheduleCurrent: input => scheduleCurrentDelivery(input),
       },
      child: locusChildDelivery,
      media: locusMedia,
      resolveLivePolicy: session => {
        const policy = ctx.get('sandboxPolicy') as
          | { resolve?: (input: { session: unknown }) => { mode?: string; workspaceRoot?: string } | undefined }
          | undefined
        return policy?.resolve?.({ session })
      },
      invalidatePolicyDrift: async ({ locus, reason }) => {
        const current = locusRepository.getLocus(locus.id ?? locus.locusId ?? '')
        if (
          current === undefined || current.state !== 'active' ||
          current.generation !== locus.generation ||
          current.childSessionId !== locus.childSessionId
        ) return
        await locusRepository.invalidateLocus(
          current.id,
          reason,
          Date.now(),
          {
            expectedLocusId: current.id,
            expectedGeneration: current.generation,
            expectedUpdatedAt: current.updatedAt,
            ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
          },
        )
      },
      addressing: {
        listChatBots: chatId => larkClient.listChatBots(chatId),
        // Names the asker in the delivery prompt, so the agent addresses a
        // display name instead of echoing the open id into the chat.
        resolveMemberName: async (chatId, openId) =>
          await larkClient.resolveMemberName?.(chatId, openId),
      },
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
        // Send the routing preamble only on a child's FIRST delivery. The
        // position is derived from durable Delivery history for this exact
        // child, not from a runtime counter: after a Host restart a counter
        // would reset and re-send the preamble mid-conversation, and a child
        // that genuinely has no history must still receive it. Any settled or
        // in-flight prior Delivery proves the preamble was already delivered.
        const priorDeliveries = locusRepository
          .listDeliveries(record.id)
          .filter(delivery => delivery.childSessionId === record.childSessionId)
        const position = priorDeliveries.length > 0 ? 'subsequent' : 'first'
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
            ...(message.addressing === undefined ? {} : { addressing: message.addressing }),
            ...(message.replyToMessageId === undefined
              ? {}
              : { replyToMessageId: message.replyToMessageId }),
            replyTarget: message.replyTarget,
          },
        }, { position })
      },
      turns: locusTurnObserver,
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
                generation: delivery.generation,
                childSessionId: delivery.childSessionId,
              },
              status: delivery.status,
            },
          })
        }
      }
      for (const delivery of locusRepository.listDeliveries()) {
        if (delivery.status !== 'accepted' && delivery.status !== 'queued') continue
        if (blockedLoci.has(delivery.locusId)) continue
        const correlation: DeliveryCorrelation = {
          endpoint: { ...delivery.endpoint },
          locusId: delivery.locusId,
          generation: delivery.generation,
          childSessionId: delivery.childSessionId,
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
    inspect: (() => {
      const controller = ctx.get('sessionController') as
        | { inspect?: (id: unknown, signal?: AbortSignal) => Promise<unknown> }
        | undefined
      const inspect = controller?.inspect
      if (typeof inspect !== 'function') return undefined
      // Keep the receiver: `inspect` is a service method that uses `this`.
      return async (sessionId: string) =>
        await inspect.call(controller, sessionId) as {
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
    // surface. Q&A resource ownership is resolved separately from verified
    // lark-cli user auth and never from the browser or an allowlist position.
    identity: () => ({ actorId: 'host:dsh-pet' }),
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
        locusAuthorization,
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

  const collaborationRoutes = collaborationOwnerIdentity() === undefined
    ? []
    : createCollaborationContextRoutes({
        store: collaborationContextStore,
        browserAuth: ctx.connection,
        ownerIdentity: collaborationOwnerIdentity,
        now: Date.now,
      })

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
    locusIdentity: () => ({ actorId: 'host:dsh-pet' }),
    // Shared-fact ledger todo surface. Projects the durable record for the
    // owner panel; `generation` rides along as an audit fact only — the
    // panel's session jump resolves the CURRENT generation through the locus
    // view, so a stale instance can never become a jump target (design D6).
    todoLedger: {
      list: parentSessionId => sharedFactLedgerStore
        .listForParent(parentSessionId)
        .map(projectTodoForOwner),
      advance: async (itemId, action) => {
        const to = action === 'accept' ? 'accepted' : action === 'done' ? 'done' : 'dropped'
        return projectTodoForOwner(await sharedFactLedgerStore.advanceStatus(itemId, to, Date.now()))
      },
      // Derive owning main sessions from the locus records themselves rather
      // than from ledger rows: a main session whose ledger exists but is
      // currently empty must still appear, so the panel shows a real empty
      // state instead of omitting the session entirely.
      parents: () => [...new Set(locusRepository.listLoci().map(record => record.parentSessionId))],
    },
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
  }), ...collaborationRoutes]) {
    ctx.effect(
      () => {
        // Collaboration routes are already fenced by their factory; applying
        // the standard fence twice is harmless but would obscure the explicit
        // owner-proof boundary in tests and diagnostics.
        const protectedRoute = collaborationRoutes.includes(route)
          ? route
          : withBrowserAuth(route, ctx.connection)
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
