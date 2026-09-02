/**
 * Pet repository over the `dsh-pet` storage domain.
 *
 * This module is the single enforcement point for the Pet domain invariants:
 * one unarchived Task per scope, one executor session per Task, one current
 * running/waiting Invocation per Task, immutable snapshots, and archived Tasks
 * rejecting new Invocations. Callers never mutate records in place — every
 * transition goes through the domain write chain.
 */

import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { PetError } from './errors.js'
import { petDomainSpec, revisionKey, type PetGlobalState } from './spec.js'
import {
  occupiesCurrentSlot,
  type PetInvocationRecord,
  type PetInvocationStatus,
  type PetRunRecord,
  type PetScopeKey,
  type PetSkillRevision,
  type PetSkillSelection,
  type PetSourceSnapshot,
  type PetTaskRecord,
  type PetTaskStatus,
  TERMINAL_TASK_STATUSES,
} from '../wire.js'

export type PetDomain = Domain<typeof petDomainSpec>

/** Durable Pet data access with domain invariants enforced on every write. */
export class PetRepository {
  private readonly domain: PetDomain

  /**
   * @param domain - The opened `dsh-pet` domain handle.
   */
  constructor(domain: PetDomain) {
    this.domain = domain
  }

  // -- global ---------------------------------------------------------------

  /** Current Pet global configuration state. */
  get global(): PetGlobalState {
    return this.domain.global.get()
  }

  /**
   * Apply a pure transform to the Pet global state.
   * @param fn - Transform from current to next global state.
   * @returns the stored next state.
   */
  async updateGlobal(fn: (current: PetGlobalState) => PetGlobalState): Promise<PetGlobalState> {
    const next = fn(this.domain.global.get())
    await this.domain.global.set(next)
    return next
  }

  /**
   * Allocate the next epoch for a scope key.
   *
   * Epoch increments after archival so a later Invocation on the same source
   * starts a clean Task instead of reactivating an archived one.
   * @param scopeKey - Canonical source scope key.
   * @returns the newly allocated epoch.
   */
  async allocateEpoch(scopeKey: PetScopeKey): Promise<number> {
    const next = (this.global.scopeEpochs[scopeKey] ?? 0) + 1
    await this.updateGlobal(current => ({
      ...current,
      scopeEpochs: { ...current.scopeEpochs, [scopeKey]: next },
    }))
    return next
  }

  /**
   * Bump the skill-set generation, fencing catalog republication.
   * @returns the new generation.
   */
  async bumpSkillSetGeneration(): Promise<number> {
    const next = this.global.skillSetGeneration + 1
    await this.updateGlobal(current => ({ ...current, skillSetGeneration: next }))
    return next
  }

  // -- tasks ----------------------------------------------------------------

  /**
   * Look up a Task by id.
   * @param taskId - Task id.
   * @returns the record, or `undefined`.
   */
  getTask(taskId: string): PetTaskRecord | undefined {
    return this.domain.table('tasks').get(taskId) as PetTaskRecord | undefined
  }

  /** Every stored Task, unordered. */
  listTasks(): readonly PetTaskRecord[] {
    return [...this.domain.table('tasks').entries()].map(([, value]) => value as PetTaskRecord)
  }

  /**
   * Find the single unarchived Task for a scope key.
   *
   * Active uniqueness is a stored invariant, never inferred from titles. A
   * second unarchived Task for one scope is a corrupted domain and fails loud
   * rather than silently picking one.
   * @param scopeKey - Canonical source scope key.
   * @returns the active Task, or `undefined` when none exists.
   * @throws PetError when the scope holds more than one unarchived Task.
   */
  findActiveTaskByScope(scopeKey: PetScopeKey): PetTaskRecord | undefined {
    const matches = this.listTasks().filter(
      task => task.scopeKey === scopeKey && task.archivedAt === undefined,
    )
    if (matches.length > 1) {
      throw new PetError(
        'INTERNAL',
        `Pet domain invariant violated: scope ${scopeKey} has ${matches.length} unarchived Tasks`,
      )
    }
    return matches[0]
  }

  /**
   * Find the Task owning an executor session.
   *
   * This is the caller-bound lookup behind the trusted context tool: the model
   * cannot supply a selector, so resolution always starts from the real
   * executing session id.
   * @param executorSessionId - Executor DSH session id.
   * @returns the owning Task, or `undefined`.
   */
  findTaskByExecutor(executorSessionId: string): PetTaskRecord | undefined {
    return this.listTasks().find(task => task.executorSessionId === executorSessionId)
  }

  /**
   * Insert a new Task, proving scope and executor uniqueness first.
   * @param record - The complete new Task record.
   * @returns the stored record.
   * @throws PetError when the scope already has an active Task or the executor
   * session is already owned by another Task.
   */
  async createTask(record: PetTaskRecord): Promise<PetTaskRecord> {
    if (this.findActiveTaskByScope(record.scopeKey) !== undefined) {
      throw new PetError('INTERNAL', `Scope ${record.scopeKey} already has an active Pet Task`)
    }
    const executorOwner = this.findTaskByExecutor(record.executorSessionId)
    if (executorOwner !== undefined) {
      throw new PetError(
        'INTERNAL',
        `Executor session ${record.executorSessionId} is already bound to Task ${executorOwner.id}`,
      )
    }
    await this.domain.table('tasks').put(record.id, record)
    return record
  }

  /**
   * Atomically transition a Task under an optimistic revision fence.
   * @param taskId - Task id.
   * @param expectedRevision - Revision the caller observed, or `undefined` to skip the fence.
   * @param fn - Pure transform producing the next record without `revision`/`updatedAt`.
   * @returns the stored next record.
   * @throws PetError on unknown Task or revision conflict.
   */
  async updateTask(
    taskId: string,
    expectedRevision: number | undefined,
    fn: (current: PetTaskRecord) => PetTaskRecord,
  ): Promise<PetTaskRecord> {
    const table = this.domain.table('tasks')
    if (table.get(taskId) === undefined) {
      throw new PetError('TASK_NOT_FOUND', `Pet Task ${taskId} does not exist`)
    }
    return (await table.update(taskId, current => {
      const record = current as PetTaskRecord
      if (expectedRevision !== undefined && record.revision !== expectedRevision) {
        throw new PetError(
          'REVISION_CONFLICT',
          `Pet Task ${taskId} revision ${record.revision} does not match expected ${expectedRevision}`,
        )
      }
      const next = fn(record)
      return { ...next, revision: record.revision + 1, updatedAt: Date.now() }
    })) as PetTaskRecord
  }

  /**
   * Set a Task's execution status, which is stored separately from archival.
   * @param taskId - Task id.
   * @param status - New execution status.
   * @param diagnostic - Optional diagnostic replacing the current one.
   * @returns the stored record.
   */
  async setTaskStatus(
    taskId: string,
    status: PetTaskStatus,
    diagnostic?: string,
  ): Promise<PetTaskRecord> {
    return this.updateTask(taskId, undefined, current => {
      const next: PetTaskRecord = { ...current, status }
      if (diagnostic === undefined) {
        const { diagnostic: _dropped, ...rest } = next
        return rest as PetTaskRecord
      }
      return { ...next, diagnostic }
    })
  }

  /**
   * Archive a Task idempotently.
   *
   * Archival never deletes records and is refused for a non-terminal Task, so
   * running or waiting work must be explicitly cancelled first.
   * @param taskId - Task id.
   * @param expectedRevision - Optional revision fence guarding archive loops.
   * @returns the stored record; an already-archived Task is returned unchanged.
   * @throws PetError when the Task is not in a terminal status.
   */
  async archiveTask(taskId: string, expectedRevision?: number): Promise<PetTaskRecord> {
    const current = this.getTask(taskId)
    if (current === undefined) {
      throw new PetError('TASK_NOT_FOUND', `Pet Task ${taskId} does not exist`)
    }
    if (current.archivedAt !== undefined) return current
    if (!TERMINAL_TASK_STATUSES.includes(current.status)) {
      throw new PetError(
        'ARCHIVE_BLOCKED',
        `Pet Task ${taskId} is ${current.status}; cancel the current work before archiving`,
      )
    }
    return this.updateTask(taskId, expectedRevision, task => ({ ...task, archivedAt: Date.now() }))
  }

  // -- invocations ----------------------------------------------------------

  /**
   * Look up an Invocation by id.
   * @param invocationId - Invocation id.
   * @returns the record, or `undefined`.
   */
  getInvocation(invocationId: string): PetInvocationRecord | undefined {
    return this.domain.table('invocations').get(invocationId) as PetInvocationRecord | undefined
  }

  /**
   * Every Invocation of a Task in durable queue order.
   * @param taskId - Owning Task id.
   * @returns invocations ordered by queue position.
   */
  listInvocations(taskId: string): readonly PetInvocationRecord[] {
    return [...this.domain.table('invocations').entries()]
      .map(([, value]) => value as PetInvocationRecord)
      .filter(invocation => invocation.taskId === taskId)
      .sort((left, right) => left.queuePosition - right.queuePosition)
  }

  /**
   * Resolve the single Invocation occupying a Task's serial slot.
   *
   * The trusted context tool depends on this being unambiguous: more than one
   * non-settled Invocation is a corrupted queue and fails closed.
   * @param taskId - Owning Task id.
   * @returns the current Invocation, or `undefined` when the Task is idle.
   * @throws PetError when several Invocations claim the slot.
   */
  findCurrentInvocation(taskId: string): PetInvocationRecord | undefined {
    const active = this.listInvocations(taskId).filter(
      invocation => invocation.status === 'running' || invocation.status === 'waiting-user',
    )
    if (active.length > 1) {
      throw new PetError(
        'AMBIGUOUS_CURRENT_INVOCATION',
        `Pet Task ${taskId} has ${active.length} concurrent Invocations`,
      )
    }
    return active[0]
  }

  /**
   * Whether the Task's serial slot is free for immediate dispatch.
   * @param taskId - Owning Task id.
   * @returns whether no Invocation is dispatching, running or waiting.
   */
  isSlotFree(taskId: string): boolean {
    return !this.listInvocations(taskId).some(
      invocation =>
        occupiesCurrentSlot(invocation.status) && invocation.status !== 'queued',
    )
  }

  /**
   * Next queued Invocation eligible to start.
   * @param taskId - Owning Task id.
   * @returns the head of the queue, or `undefined`.
   */
  nextQueued(taskId: string): PetInvocationRecord | undefined {
    return this.listInvocations(taskId).find(invocation => invocation.status === 'queued')
  }

  /**
   * Append an Invocation to a Task's durable queue.
   *
   * An archived Task rejects new Invocations: archival is a one-way close.
   * @param record - New Invocation without its queue position.
   * @returns the stored record with its allocated position.
   * @throws PetError when the Task is missing or archived.
   */
  async appendInvocation(
    record: Omit<PetInvocationRecord, 'queuePosition'>,
  ): Promise<PetInvocationRecord> {
    const task = this.getTask(record.taskId)
    if (task === undefined) {
      throw new PetError('TASK_NOT_FOUND', `Pet Task ${record.taskId} does not exist`)
    }
    if (task.archivedAt !== undefined) {
      throw new PetError(
        'TASK_ARCHIVED',
        `Pet Task ${record.taskId} is archived and cannot accept new Invocations`,
      )
    }
    const existing = this.listInvocations(record.taskId)
    const queuePosition = existing.reduce((max, item) => Math.max(max, item.queuePosition), -1) + 1
    const stored: PetInvocationRecord = { ...record, queuePosition }
    await this.domain.table('invocations').put(stored.id, stored)
    return stored
  }

  /**
   * Atomically transition an Invocation under an optional revision fence.
   * @param invocationId - Invocation id.
   * @param expectedRevision - Revision the caller observed, or `undefined`.
   * @param fn - Pure transform producing the next record.
   * @returns the stored next record.
   * @throws PetError on unknown Invocation or revision conflict.
   */
  async updateInvocation(
    invocationId: string,
    expectedRevision: number | undefined,
    fn: (current: PetInvocationRecord) => PetInvocationRecord,
  ): Promise<PetInvocationRecord> {
    const table = this.domain.table('invocations')
    if (table.get(invocationId) === undefined) {
      throw new PetError('INVOCATION_NOT_FOUND', `Pet Invocation ${invocationId} does not exist`)
    }
    return (await table.update(invocationId, current => {
      const record = current as PetInvocationRecord
      if (expectedRevision !== undefined && record.revision !== expectedRevision) {
        throw new PetError(
          'REVISION_CONFLICT',
          `Pet Invocation ${invocationId} revision ${record.revision} does not match expected ${expectedRevision}`,
        )
      }
      const next = fn(record)
      return { ...next, revision: record.revision + 1, updatedAt: Date.now() }
    })) as PetInvocationRecord
  }

  /**
   * Set an Invocation status, refusing to promote a settled Invocation.
   * @param invocationId - Invocation id.
   * @param status - New status.
   * @returns the stored record.
   */
  async setInvocationStatus(
    invocationId: string,
    status: PetInvocationStatus,
  ): Promise<PetInvocationRecord> {
    return this.updateInvocation(invocationId, undefined, current => {
      if (!occupiesCurrentSlot(current.status) && occupiesCurrentSlot(status)) {
        throw new PetError(
          'INVALID_REQUEST',
          `Pet Invocation ${invocationId} already settled as ${current.status}`,
        )
      }
      return { ...current, status }
    })
  }

  // -- snapshots ------------------------------------------------------------

  /**
   * Persist an immutable source snapshot.
   *
   * Snapshots are write-once: rewriting one would retroactively change what an
   * already-accepted Invocation targeted.
   * @param snapshot - The captured snapshot.
   * @returns the stored snapshot.
   * @throws PetError when the snapshot id already exists.
   */
  async putSnapshot(snapshot: PetSourceSnapshot): Promise<PetSourceSnapshot> {
    const table = this.domain.table('snapshots')
    if (table.get(snapshot.id) !== undefined) {
      throw new PetError('INTERNAL', `Pet snapshot ${snapshot.id} is immutable and already exists`)
    }
    await table.put(snapshot.id, snapshot)
    return snapshot
  }

  /**
   * Read a snapshot by id.
   * @param snapshotId - Snapshot id.
   * @returns the snapshot, or `undefined`.
   */
  getSnapshot(snapshotId: string): PetSourceSnapshot | undefined {
    return this.domain.table('snapshots').get(snapshotId) as PetSourceSnapshot | undefined
  }

  // -- runs -----------------------------------------------------------------

  /**
   * Record a new execution attempt. Retries reuse the Invocation snapshot.
   * @param run - The run record.
   * @returns the stored run.
   */
  async putRun(run: PetRunRecord): Promise<PetRunRecord> {
    await this.domain.table('runs').put(run.id, run)
    return run
  }

  /**
   * Every attempt of an Invocation in attempt order.
   * @param invocationId - Owning Invocation id.
   * @returns the ordered runs.
   */
  listRuns(invocationId: string): readonly PetRunRecord[] {
    return [...this.domain.table('runs').entries()]
      .map(([, value]) => value as PetRunRecord)
      .filter(run => run.invocationId === invocationId)
      .sort((left, right) => left.attempt - right.attempt)
  }

  // -- skills ---------------------------------------------------------------

  /**
   * Store an immutable skill revision.
   * @param revision - The installed revision.
   * @returns the stored revision.
   */
  async putSkillRevision(revision: PetSkillRevision): Promise<PetSkillRevision> {
    await this.domain
      .table('skill_revisions')
      .put(revisionKey(revision.skillName), revision)
    return revision
  }

  /** Every installed skill revision. */
  listSkillRevisions(): readonly PetSkillRevision[] {
    return [...this.domain.table('skill_revisions').entries()].map(
      ([, value]) => value as PetSkillRevision,
    )
  }

  /**
   * Look up one registered Skill by name.
   * @param skillName - Kebab-case skill name.
   * @returns the revision, or `undefined`.
   */
  getSkillRevision(skillName: string): PetSkillRevision | undefined {
    return this.domain.table('skill_revisions').get(revisionKey(skillName)) as
      | PetSkillRevision
      | undefined
  }

  /**
   * Remove a physical revision row. Callers MUST first prove no unarchived
   * Task or non-terminal Invocation still references the digest.
   * @param skillName - Skill name.
   * @returns whether a row was removed.
   */
  async deleteSkillRevision(skillName: string): Promise<boolean> {
    return this.domain.table('skill_revisions').delete(revisionKey(skillName))
  }

  /** Current per-skill selection state. */
  listSkillSelections(): readonly PetSkillSelection[] {
    return [...this.domain.table('skill_selections').entries()].map(
      ([, value]) => value as PetSkillSelection,
    )
  }

  /**
   * Read one skill's selection state.
   * @param skillName - Skill name.
   * @returns the selection, or `undefined` when the skill was never installed.
   */
  getSkillSelection(skillName: string): PetSkillSelection | undefined {
    return this.domain.table('skill_selections').get(skillName) as PetSkillSelection | undefined
  }

  /**
   * Replace one skill's selection state and bump the skill-set generation.
   * @param selection - The complete new selection row.
   * @returns the new skill-set generation.
   */
  async putSkillSelection(selection: PetSkillSelection): Promise<number> {
    await this.domain.table('skill_selections').put(selection.skillName, selection)
    return this.bumpSkillSetGeneration()
  }

  // -- bindings -------------------------------------------------------------



}
