/**
 * Executor session creation and crash-recoverable reconciliation.
 *
 * Task creation spans two systems with no shared transaction: Pet storage and
 * DSH session/agent persistence. Instead of pretending otherwise, Pet
 * preallocates stable ids, persists an explicit `creating-executor` record
 * BEFORE calling DSH, and proves each side on restart before advancing.
 */

import { randomUUID } from 'node:crypto'
import { PetError } from './errors.js'
import type { PetRepository } from './repository.js'
import { executorTitle, shortIdOf } from './workspace.js'
import { STANDARD_PRESET, type PetScopeKey, type PetSourceKind, type PetTaskRecord } from '../wire.js'

/** Validated Pet model routing, resolved from Pet settings. */
export interface PetModelSelection {
  readonly providerId: string
  readonly modelId: string
  readonly agentPreset?: string
}

/** The subset of the DSH agent registry Pet uses. */
export interface AgentRegistryLike {
  create(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string }
    /** Mirrors DSH's flat `AgentOptions`; a nested shape silently drops both. */
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: unknown) => void | Promise<void>
  }): Promise<{ session: { id: string } }>
  get(sessionId: string): unknown
}

/**
 * The subset of the DSH LLM registry Pet uses to validate routing.
 *
 * `LlmProviderInfo` carries only `id`/`name`, so validation is
 * provider-level. `models` is honored when a caller can supply it (tests, a
 * future richer directory); an unknown model otherwise surfaces at generation
 * time rather than being silently accepted as routable.
 */
export interface LlmRegistryLike {
  /** Providers currently routable in this Host. */
  listProviders(): readonly { id: string; models?: readonly string[] }[]
}

/**
 * Validate that the configured provider/model can actually be routed.
 *
 * Pet never falls back to another model: a different model could produce
 * different side effects, so an unroutable selection must surface as a
 * diagnostic configuration error before any Invocation starts.
 * @param registry - Host LLM registry.
 * @param selection - Configured selection.
 * @throws PetError when the selection is unavailable.
 */
export function validateModelSelection(
  registry: LlmRegistryLike,
  selection: PetModelSelection | undefined,
): PetModelSelection {
  if (selection === undefined) {
    throw new PetError(
      'MODEL_UNAVAILABLE',
      'Pet has no configured provider/model. Choose one in Pet Settings → General.',
    )
  }
  const providers = registry.listProviders()
  const provider = providers.find(item => item.id === selection.providerId)
  if (provider === undefined) {
    throw new PetError(
      'MODEL_UNAVAILABLE',
      `Pet provider '${selection.providerId}' is not routable in this DSH Host ` +
        `(available: ${providers.map(item => item.id).join(', ') || 'none'}).`,
    )
  }
  if (provider.models !== undefined && !provider.models.includes(selection.modelId)) {
    throw new PetError(
      'MODEL_UNAVAILABLE',
      `Pet model '${selection.modelId}' is not offered by provider '${selection.providerId}'.`,
    )
  }
  return selection
}

/** Identity preallocated before any cross-system write. */
export interface PreallocatedTask {
  readonly taskId: string
  readonly executorSessionId: string
  readonly epoch: number
}

/**
 * Preallocate stable ids and the next epoch for a new Task.
 * @param repository - Pet repository.
 * @param scopeKey - Canonical source scope key.
 * @returns the preallocated identity.
 */
export async function preallocateTask(
  repository: PetRepository,
  scopeKey: PetScopeKey,
): Promise<PreallocatedTask> {
  return {
    taskId: `task-${randomUUID()}`,
    executorSessionId: `session-${randomUUID()}`,
    epoch: await repository.allocateEpoch(scopeKey),
  }
}

/** Everything needed to create one Task and its executor. */
export interface CreateExecutorOptions {
  readonly scopeKey: PetScopeKey
  readonly sourceKind: PetSourceKind
  readonly sourceId?: string
  readonly sourceTitle?: string
  readonly workspacePath: string
  /**
   * Workspace id when the executor is to live INSIDE a target workspace.
   *
   * Presence flips the Task to the workspace-resident form: `workspacePath`
   * is then the target workspace itself rather than the dedicated Pet
   * workspace, and Pet performs NO workspace preparation there (see
   * `ensureWorkspace`).
   */
  readonly residentWorkspaceId?: string
  /**
   * Repairs the Workspace files an executor depends on, returning what could
   * not be fixed. Preparation runs once at boot, so a file deleted or left
   * stale afterwards must be caught here — at the moment a session actually
   * needs it — rather than silently producing an executor with no identity
   * briefing.
   *
   * SKIPPED for a workspace-resident Task even when supplied: repair writes
   * Pet's own `AGENTS.md` and skill projection into the workspace it is given,
   * and the target of a resident Task is the user's own repository. Pet must
   * never write there, so a resident executor takes that workspace exactly as
   * it is — which is also why Pet does not promise its Skill-allowlist
   * boundary for this form.
   */
  readonly ensureWorkspace?: () => Promise<readonly string[]>
  /**
   * Accounts the new executor session to a workspace.
   *
   * Creating the session with the right `cwd` is not enough: DSH accounts a
   * session to a workspace explicitly, so without this the executor exists but
   * shows up unfiled in the sidebar.
   *
   * Receives the TARGET workspace id, which differs by Task form: ordinary
   * Tasks are filed under the Pet workspace, a resident Task under the
   * workspace it actually runs in.
   */
  readonly attachToWorkspace?: (sessionId: string, workspaceId?: string) => Promise<void>
  readonly selection: PetModelSelection
  /**
   * Scoped composition installed on the executor Agent.
   *
   * Receives the preset id to compose: naming a preset in `meta` only records
   * it on the session header, so the composition itself must be mounted here.
   */
  readonly setup?: (agentCtx: unknown, presetId?: string) => void | Promise<void>
}

/**
 * Create a Task and its ordinary DSH executor session, recoverably.
 *
 * Order matters: the `creating-executor` record is durable BEFORE DSH is
 * called, so a crash between the two leaves an explicit, reconcilable state
 * rather than an orphaned session or a Task with no executor.
 * @param repository - Pet repository.
 * @param agents - DSH agent registry.
 * @param options - Creation inputs.
 * @returns the committed Task record.
 */
export async function createTaskWithExecutor(
  repository: PetRepository,
  agents: AgentRegistryLike,
  options: CreateExecutorOptions,
): Promise<PetTaskRecord> {
  const identity = await preallocateTask(repository, options.scopeKey)
  const now = Date.now()

  const pending: PetTaskRecord = {
    id: identity.taskId,
    scopeKey: options.scopeKey,
    epoch: identity.epoch,
    sourceKind: options.sourceKind,
    ...(options.sourceId !== undefined ? { sourceId: options.sourceId } : {}),
    ...(options.sourceTitle !== undefined ? { sourceTitle: options.sourceTitle } : {}),
    sourceAvailability: 'available',
    executorSessionId: identity.executorSessionId,
    ...(options.residentWorkspaceId !== undefined
      ? { residentWorkspaceId: options.residentWorkspaceId }
      : {}),
    status: 'creating-executor',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }
  await repository.createTask(pending)

  // Self-heal before the session exists. A remaining problem is reported
  // rather than silently accepted: an executor without its standing
  // instructions does not know it is a Pet Task Agent.
  //
  // Resident Tasks skip this entirely: repair would write Pet's files into
  // the USER'S repository, which the spec forbids outright.
  if (options.residentWorkspaceId === undefined) {
    const unresolved = (await options.ensureWorkspace?.()) ?? []
    if (unresolved.length > 0) {
      throw new PetError(
        'WORKSPACE_UNHEALTHY',
        `Pet Workspace is not usable: ${unresolved.join('; ')}`,
      )
    }
  }

  // A resident executor runs the ordinary preset: the Pet one exists to
  // exclude local Skill discovery, which is the opposite of what this form
  // wants. Both the header record and the actual mount use this one value, so
  // what the session claims and what it runs cannot drift apart.
  const effectivePreset =
    options.residentWorkspaceId !== undefined ? STANDARD_PRESET : options.selection.agentPreset

  try {
    await agents.create({
      sessionId: identity.executorSessionId,
      meta: {
        // Ordinarily the Pet Workspace, never the source repository: one Task
        // may outlive or move across source snapshots, and source access is
        // granted through trusted context instead.
        //
        // A workspace-resident Task deliberately inverts this: the caller
        // passes the routed target workspace, so the executor works directly
        // inside the repository the chat is bound to.
        cwd: options.workspacePath,
        // The Pet executor preset exists to EXCLUDE local Skill discovery so
        // the Skill surface is exactly Pet's allowlist. A resident Task wants
        // the opposite by definition — the target workspace's own Skills and
        // instructions — so it runs the ordinary `standard` preset instead.
        //
        // Named explicitly rather than omitted: an unset preset is not
        // recorded on the session header, leaving the session with no visible
        // mode at all.
        ...(effectivePreset !== undefined ? { agentPreset: effectivePreset } : {}),
      },
      // `AgentOptions` is FLAT (`{ provider, model }`), not nested under a
      // `model` object. The nested shape type-checked only because the local
      // `AgentRegistryLike` face declared it that way, so both fields arrived
      // undefined and every Invocation failed with "has no provider/model".
      agentOptions: {
        provider: options.selection.providerId,
        model: options.selection.modelId,
      },
      ...(options.setup !== undefined
        ? { setup: (agentCtx: unknown) => options.setup?.(agentCtx, effectivePreset) }
        : {}),
    })
    // Account the session AFTER creation succeeds. A failure here is not fatal
    // to the Task — the executor works, it is only mis-filed in the sidebar —
    // so it must not roll back a usable session.
    await options
      .attachToWorkspace?.(identity.executorSessionId, options.residentWorkspaceId)
      .catch(() => undefined)
  } catch (error) {
    await repository.setTaskStatus(
      identity.taskId,
      'failed',
      `Executor session creation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }

  return repository.setTaskStatus(identity.taskId, 'idle')
}

/** What restart reconciliation decided about one uncertain Task. */
export type ReconcileOutcome =
  | { readonly kind: 'committed'; readonly task: PetTaskRecord }
  | { readonly kind: 'failed'; readonly task: PetTaskRecord; readonly reason: string }

/**
 * Reconcile Tasks stuck in `creating-executor` after a Host restart.
 *
 * Proof-based: a Task advances only when its preallocated session really
 * exists. Uncertain work is marked failed with a diagnostic rather than
 * reported as successful.
 * @param repository - Pet repository.
 * @param sessionExists - Proves whether a session id is durable.
 * @returns one outcome per reconciled Task.
 */
export async function reconcileCreatingExecutors(
  repository: PetRepository,
  sessionExists: (sessionId: string) => boolean,
): Promise<readonly ReconcileOutcome[]> {
  const outcomes: ReconcileOutcome[] = []
  for (const task of repository.listTasks()) {
    if (task.archivedAt !== undefined) continue

    // Work that was mid-flight when the Host stopped cannot be proven to have
    // continued: no Agent is driving it any more. Marking it `recovering`
    // keeps it visible and diagnosable instead of reporting a run that is not
    // actually happening.
    // A Task left `recovering` by an EARLIER restart is only stuck if nobody
    // clears it: `recovering` occupies the Invocation slot, so every later
    // capability queues behind it forever. When the executor session is still
    // alive the work can simply be re-dispatched, so fail the stalled
    // Invocation and let the queue drain rather than stranding the Task.
    if (task.status === 'recovering') {
      // Either way the stalled Invocation must release the slot, or every
      // later capability queues behind it forever. `sessions.get` only finds a
      // LIVE session, so an archived executor reads as missing — and that is
      // precisely the case that can never resume on its own.
      const resumable = sessionExists(task.executorSessionId)
      for (const invocation of repository.listInvocations(task.id)) {
        if (invocation.status === 'recovering') {
          await repository.setInvocationStatus(invocation.id, 'failed')
        }
      }
      outcomes.push({
        kind: 'committed',
        task: await repository.setTaskStatus(
          task.id,
          resumable ? 'idle' : 'failed',
          resumable
            ? undefined
            : `Executor session ${task.executorSessionId} is gone, so this Task cannot resume.`,
        ),
      })
      continue
    }

    if (task.status === 'running' || task.status === 'waiting-user') {
      const reason =
        'The Host stopped while this Invocation was in flight, so its outcome is unknown. ' +
        'Open the executor session to inspect it, then cancel or retry.'
      for (const invocation of repository.listInvocations(task.id)) {
        if (invocation.status === 'running' || invocation.status === 'dispatching') {
          await repository.setInvocationStatus(invocation.id, 'recovering')
        }
      }
      outcomes.push({
        kind: 'failed',
        task: await repository.setTaskStatus(task.id, 'recovering', reason),
        reason,
      })
      continue
    }

    if (task.status !== 'creating-executor') continue
    if (sessionExists(task.executorSessionId)) {
      outcomes.push({ kind: 'committed', task: await repository.setTaskStatus(task.id, 'idle') })
      continue
    }
    const reason =
      'Executor session was never created before the Host stopped; ' +
      'start a new Invocation to create a fresh Task epoch.'
    outcomes.push({
      kind: 'failed',
      task: await repository.setTaskStatus(task.id, 'failed', reason),
      reason,
    })
  }
  return outcomes
}

/**
 * Build the visible executor title for a Task.
 * @param task - The Task record.
 * @returns the bounded relationship title.
 */
export function titleForTask(task: PetTaskRecord): string {
  return executorTitle({
    sourceKind: task.sourceKind,
    ...(task.sourceTitle !== undefined ? { sourceTitle: task.sourceTitle } : {}),
    shortId: shortIdOf(task.sourceId ?? task.id),
    epoch: task.epoch,
  })
}
