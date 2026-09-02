/**
 * Pet Invocation coordinator.
 *
 * Owns create-or-reuse Task behavior, the durable per-Task serial queue, and
 * the projection of Task/Invocation state from DSH Agent events.
 *
 * The single most important rule here: a Task's serial slot switches to the
 * next Invocation ONLY after the current one settles terminally. The trusted
 * context tool resolves "the current Invocation", so an overlapping switch
 * would let an Agent act on the wrong snapshot.
 */

import { randomUUID } from 'node:crypto'
import type { CapabilityRegistry } from './capabilities.js'
import {
  validateCapture,
  type SourceContextRegistry,
  type SourceResolver,
} from './capture.js'
import { renderEnvelope } from './envelope.js'
import { PetError } from './errors.js'
import {
  createTaskWithExecutor,
  titleForTask,
  type AgentRegistryLike,
  type PetModelSelection,
} from './executor.js'
import type { PetRepository } from './repository.js'
import {
  occupiesCurrentSlot,
  type PetInvocationCapture,
  type PetInvocationRecord,
  type PetInvocationStatus,
  type PetRunRecord,
  type PetTaskRecord,
} from '../wire.js'

/** Dispatches a rendered envelope into an executor session. */
export interface PromptDispatcher {
  /**
   * Submit a user message to the executor Agent and flush it.
   * @param executorSessionId - Target executor session.
   * @param text - The rendered envelope.
   */
  dispatch(executorSessionId: string, text: string): Promise<void>
}

/** Everything the coordinator needs from its Host. */
export interface CoordinatorDeps {
  readonly repository: PetRepository
  readonly capabilities: CapabilityRegistry
  readonly agents: AgentRegistryLike
  readonly dispatcher: PromptDispatcher
  readonly resolver: SourceResolver
  readonly contextProviders: SourceContextRegistry
  readonly workspacePath: string
  /** Resolves the validated Pet model selection at dispatch time. */
  readonly selection: () => PetModelSelection
  /**
   * Scoped composition installed on every executor Agent at creation time.
   *
   * This is where the Pet allowlist Skill provider and Pet-owned tools are
   * registered, so a Pet executor can only reach explicitly enabled Skills.
   * Without it an executor would inherit DSH's global Skill discovery, and
   * the isolation boundary would exist only on paper.
   */
  readonly executorSetup?: (agentCtx: unknown) => void | Promise<void>
  /**
   * Apply the generated relationship title to a freshly created executor.
   *
   * Purely a VISIBLE projection: Pet never parses a title back into routing,
   * so a later user rename is always safe.
   */
  readonly renameExecutor?: (executorSessionId: string, title: string) => void | Promise<void>
  /**
   * Prove the Invocation's fixed Skill revision is still resolvable, right
   * before dispatch. Rejecting here is the explicit `/<name>` injection
   * boundary: an uninstalled, disabled or tampered revision must fail closed
   * rather than reaching the Agent as ordinary prose.
   */
  readonly verifySkill?: (skillName: string, digest: string) => Promise<void>
}

/** Result of accepting a user invocation. */
export interface AcceptResult {
  readonly task: PetTaskRecord
  readonly invocation: PetInvocationRecord
  /** Whether the Invocation started immediately or was queued behind current work. */
  readonly started: boolean
}

/** Coordinates Pet Tasks, their serial queues and Agent dispatch. */
export class PetCoordinator {
  /**
   * Per-scope admission chain.
   *
   * Two simultaneous invocations for one source would both observe "no active
   * Task", both create one, and the second would fail the scope-uniqueness
   * invariant with an opaque `INTERNAL`. Serializing admission per scope makes
   * the second call observe the Task the first created and reuse it, which is
   * what the user asked for. Different scopes never contend.
   */
  private readonly admission = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: CoordinatorDeps) {}

  /**
   * Run `work` exclusively for one scope key.
   * @param scopeKey - Canonical source scope key.
   * @param work - The admission-critical section.
   * @returns the result of `work`.
   */
  private async withScope<T>(scopeKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.admission.get(scopeKey) ?? Promise.resolve()
    // Swallow the predecessor's rejection: one caller's failure must not
    // cascade into the next caller's request.
    const run = previous.then(work, work)
    this.admission.set(
      scopeKey,
      run.catch(() => undefined),
    )
    try {
      return await run
    } finally {
      if (this.admission.get(scopeKey) !== undefined && this.admission.size > 64) {
        // Bound the map: settled chains for idle scopes need not be retained.
        this.admission.delete(scopeKey)
      }
    }
  }

  /**
   * Accept a user-created Invocation.
   *
   * Creates a fresh snapshot, reuses or creates the scope's Task, appends to
   * the durable queue, and dispatches only when the serial slot is free.
   * @param capture - The browser's atomic capture.
   * @returns the accepted Task and Invocation.
   */
  async accept(capture: PetInvocationCapture): Promise<AcceptResult> {
    // Resolve the scope first so admission for one source is serialized: the
    // whole create-or-reuse decision, snapshot write and queue append run
    // exclusively, which is what keeps the one-Task-per-scope invariant true
    // under simultaneous requests.
    const declared = this.deps.capabilities.get(capture.capabilityId)
    if (declared === undefined) {
      throw new PetError('UNKNOWN_CAPABILITY', `Unknown Pet capability '${capture.capabilityId}'`)
    }
    const scopeKey =
      capture.sourceKind === 'session'
        ? `session:${capture.sourceSessionId ?? ''}`
        : capture.sourceKind === 'workspace'
          ? `workspace:${capture.sourceWorkspaceId ?? ''}`
          : 'independent:web:default'
    return this.withScope(scopeKey, () => this.admit(capture))
  }

  /** The admission-critical section, serialized per scope by {@link accept}. */
  private async admit(capture: PetInvocationCapture): Promise<AcceptResult> {
    const { repository, capabilities } = this.deps
    const declaration = capabilities.get(capture.capabilityId)
    if (declaration === undefined) {
      throw new PetError('UNKNOWN_CAPABILITY', `Unknown Pet capability '${capture.capabilityId}'`)
    }

    // Idempotency: a retried create call must not duplicate an Invocation.
    const existing = repository.getInvocation(capture.clientInvocationId)
    if (existing !== undefined) {
      const owner = repository.getTask(existing.taskId)
      if (owner === undefined) throw new PetError('TASK_NOT_FOUND', 'Invocation lost its Task')
      return { task: owner, invocation: existing, started: existing.status !== 'queued' }
    }

    const validated = await validateCapture(
      capture,
      declaration.contextRequirement,
      this.deps.resolver,
      this.deps.contextProviders,
    )

    let skill: { skillName: string; digest: string }
    try {
      skill = capabilities.resolveSkill(repository, capture.capabilityId)
    } catch (error) {
      throw new PetError(
        'CAPABILITY_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      )
    }

    // Create-or-reuse: an archived Task is never reactivated — a new epoch and
    // a fresh executor session are created instead.
    let task = repository.findActiveTaskByScope(validated.scopeKey)
    if (task === undefined) {
      task = await createTaskWithExecutor(repository, this.deps.agents, {
        scopeKey: validated.scopeKey,
        sourceKind: capture.sourceKind,
        ...(capture.sourceSessionId !== undefined ? { sourceId: capture.sourceSessionId } : {}),
        ...(capture.sourceKind === 'workspace' && capture.sourceWorkspaceId !== undefined
          ? { sourceId: capture.sourceWorkspaceId }
          : {}),
        ...(validated.sourceTitle !== undefined ? { sourceTitle: validated.sourceTitle } : {}),
        workspacePath: this.deps.workspacePath,
        selection: this.deps.selection(),
        // Scope the executor before it is published: the allowlist provider
        // and Pet tools must exist before the first prompt is assembled.
        ...(this.deps.executorSetup !== undefined
          ? { setup: this.deps.executorSetup }
          : {}),
      })

      // Name the executor so the user can tell Task epochs and same-named
      // sources apart. A failure here is cosmetic and must not fail the
      // Invocation, since routing never depends on the title.
      if (this.deps.renameExecutor !== undefined) {
        try {
          await this.deps.renameExecutor(task.executorSessionId, titleForTask(task))
        } catch {
          // Title is a projection; stored association remains authoritative.
        }
      }
    }

    const now = Date.now()
    const snapshot = { ...validated.snapshot, invocationId: capture.clientInvocationId }
    await repository.putSnapshot(snapshot)

    const invocation = await repository.appendInvocation({
      id: capture.clientInvocationId,
      taskId: task.id,
      capabilityId: capture.capabilityId,
      skillName: skill.skillName,
      // Fixed now: a later enable/upgrade never rewrites this Invocation.
      skillDigest: skill.digest,
      skillSetGeneration: repository.global.skillSetGeneration,
      snapshotId: snapshot.id,
      ...(capture.request !== undefined ? { request: capture.request } : {}),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      revision: 0,
    })

    const started = await this.pump(task.id)
    const current = repository.getInvocation(invocation.id) ?? invocation
    return {
      task: repository.getTask(task.id) ?? task,
      invocation: current,
      started: started?.id === invocation.id,
    }
  }

  /**
   * Start the next queued Invocation when the serial slot is free.
   *
   * Returns without dispatching while a running or waiting-user Invocation
   * occupies the slot, so waiting work is never implicitly preempted.
   * @param taskId - Task whose queue should advance.
   * @returns the Invocation that started, or `undefined`.
   */
  async pump(taskId: string): Promise<PetInvocationRecord | undefined> {
    const { repository } = this.deps
    if (!repository.isSlotFree(taskId)) return undefined
    const next = repository.nextQueued(taskId)
    if (next === undefined) return undefined

    const task = repository.getTask(taskId)
    if (task === undefined || task.archivedAt !== undefined) return undefined
    const snapshot = repository.getSnapshot(next.snapshotId)
    if (snapshot === undefined) {
      await repository.updateInvocation(next.id, undefined, current => ({
        ...current,
        status: 'failed',
        errorSummary: `Missing snapshot ${next.snapshotId}`,
      }))
      return undefined
    }

    // Fail closed BEFORE any state moves: the digest fixed at acceptance must
    // still resolve, or the envelope's leading `/<name>` token would be sent
    // for a Skill the Agent cannot legitimately load.
    if (this.deps.verifySkill !== undefined) {
      try {
        await this.deps.verifySkill(next.skillName, next.skillDigest)
      } catch (error) {
        await repository.updateInvocation(next.id, undefined, current => ({
          ...current,
          status: 'failed',
          errorSummary: error instanceof Error ? error.message : String(error),
        }))
        await repository.setTaskStatus(taskId, 'idle')
        return undefined
      }
    }

    const isFirst = repository.listInvocations(taskId).every(item => item.id === next.id)
    // Between selecting this Invocation and dispatching it, an event observer
    // may already have settled it (a synchronous `turn/end` from a previous
    // attempt, a cancel, a competing pump). Claiming the slot is therefore a
    // best-effort transition: losing the race means someone else owns the
    // outcome, so stop quietly instead of throwing out of the caller's
    // request — which surfaced as a spurious error on an otherwise
    // successful retry.
    try {
      await repository.setInvocationStatus(next.id, 'dispatching')
    } catch {
      return undefined
    }
    await repository.setTaskStatus(taskId, 'running')
    await repository.putRun({
      id: `run-${randomUUID()}`,
      invocationId: next.id,
      attempt: repository.listRuns(next.id).length + 1,
      status: 'running',
      startedAt: Date.now(),
    })

    const text = renderEnvelope({ task, invocation: next, snapshot, isFirst })
    try {
      await this.deps.dispatcher.dispatch(task.executorSessionId, text)
    } catch (error) {
      // Dispatch outcome is uncertain: mark recovering rather than failed, so
      // reconciliation decides from durable session events.
      await repository.setInvocationStatus(next.id, 'recovering')
      await repository.setTaskStatus(
        taskId,
        'recovering',
        `Prompt dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    }

    // Same race as the slot claim: a synchronous `turn/end` can settle this
    // Invocation while dispatch is still unwinding. Promoting a settled record
    // back to `running` is both wrong and a throw, so report what it actually
    // is instead of failing the caller's request.
    try {
      return await repository.setInvocationStatus(next.id, 'running')
    } catch {
      return repository.getInvocation(next.id)
    }
  }

  /**
   * Project a DSH agent state change onto the current Invocation.
   * @param executorSessionId - Executor session that changed.
   * @param event - The observed lifecycle transition.
   */
  async onAgentEvent(
    executorSessionId: string,
    event:
      | { kind: 'turn-start' }
      | { kind: 'waiting-user' }
      | { kind: 'turn-complete'; summary?: string }
      | { kind: 'turn-error'; message: string }
      | { kind: 'cancelled' },
  ): Promise<void> {
    const { repository } = this.deps
    const task = repository.findTaskByExecutor(executorSessionId)
    if (task === undefined) return
    const invocation = repository
      .listInvocations(task.id)
      .find(item => occupiesCurrentSlot(item.status) && item.status !== 'queued')
    if (invocation === undefined) return

    switch (event.kind) {
      case 'turn-start':
        await repository.setInvocationStatus(invocation.id, 'running')
        await repository.setTaskStatus(task.id, 'running')
        return
      case 'waiting-user':
        await repository.setInvocationStatus(invocation.id, 'waiting-user')
        await repository.setTaskStatus(task.id, 'waiting-user')
        return
      case 'turn-complete':
        await this.settle(invocation.id, 'succeeded', {
          ...(event.summary !== undefined ? { resultSummary: event.summary } : {}),
        })
        break
      case 'turn-error':
        await this.settle(invocation.id, 'failed', { errorSummary: event.message })
        break
      case 'cancelled':
        await this.settle(invocation.id, 'cancelled', {})
        break
    }
    await repository.setTaskStatus(task.id, 'idle')
    // The slot is free only now, so the next Invocation switches atomically.
    await this.pump(task.id)
  }

  private async settle(
    invocationId: string,
    status: PetInvocationStatus,
    detail: { resultSummary?: string; errorSummary?: string },
  ): Promise<void> {
    const { repository } = this.deps
    await repository.updateInvocation(invocationId, undefined, current => ({
      ...current,
      status,
      ...(detail.resultSummary !== undefined ? { resultSummary: detail.resultSummary } : {}),
      ...(detail.errorSummary !== undefined ? { errorSummary: detail.errorSummary } : {}),
    }))
    const runs = repository.listRuns(invocationId)
    const latest = runs[runs.length - 1]
    if (latest !== undefined) {
      await repository.putRun({
        ...latest,
        status,
        ...(detail.errorSummary !== undefined ? { errorSummary: detail.errorSummary } : {}),
        settledAt: Date.now(),
      } satisfies PetRunRecord)
    }
  }

  /**
   * Continue the current waiting Invocation with a user answer.
   *
   * An answer belongs to the CURRENT Invocation; it never starts queued work.
   * @param taskId - Task id.
   * @param answer - The user's reply text.
   */
  async answer(taskId: string, answer: string): Promise<void> {
    const { repository } = this.deps
    const task = repository.getTask(taskId)
    if (task === undefined) throw new PetError('TASK_NOT_FOUND', `Pet Task ${taskId} not found`)
    const invocation = repository.findCurrentInvocation(taskId)
    if (invocation === undefined || invocation.status !== 'waiting-user') {
      throw new PetError(
        'NO_CURRENT_INVOCATION',
        `Pet Task ${taskId} is not waiting for an answer right now.`,
      )
    }
    await this.deps.dispatcher.dispatch(task.executorSessionId, answer)
    await repository.setInvocationStatus(invocation.id, 'running')
    await repository.setTaskStatus(taskId, 'running')
  }

  /**
   * Cancel the current Invocation and advance the queue.
   * @param taskId - Task id.
   */
  async cancel(taskId: string): Promise<void> {
    const { repository } = this.deps
    const invocation = repository.findCurrentInvocation(taskId)
    if (invocation === undefined) {
      throw new PetError('NO_CURRENT_INVOCATION', `Pet Task ${taskId} has no current Invocation`)
    }
    await this.settle(invocation.id, 'cancelled', {})
    await repository.setTaskStatus(taskId, 'idle')
    await this.pump(taskId)
  }

  /**
   * Retry a failed Invocation as a NEW run on the SAME snapshot.
   *
   * A transient retry must not re-target: only a new user gesture creates a
   * new Invocation with a fresh snapshot.
   * @param invocationId - Failed Invocation id.
   */
  async retry(invocationId: string): Promise<PetInvocationRecord> {
    const { repository } = this.deps
    const invocation = repository.getInvocation(invocationId)
    if (invocation === undefined) {
      throw new PetError('INVOCATION_NOT_FOUND', `Pet Invocation ${invocationId} not found`)
    }
    if (invocation.status !== 'failed') {
      throw new PetError('INVALID_REQUEST', `Only a failed Invocation can be retried`)
    }
    const task = repository.getTask(invocation.taskId)
    if (task?.archivedAt !== undefined) {
      throw new PetError('TASK_ARCHIVED', 'Archived Tasks cannot accept new work')
    }
    // Requeue on the SAME snapshotId; no new snapshot is captured. The prior
    // error summary is dropped by omission rather than an unsound cast.
    const requeued = await repository.updateInvocation(invocationId, undefined, current => {
      const { errorSummary: _cleared, ...rest } = current
      return { ...rest, status: 'queued' as const }
    })
    await this.pump(invocation.taskId)
    return repository.getInvocation(invocationId) ?? requeued
  }
}
