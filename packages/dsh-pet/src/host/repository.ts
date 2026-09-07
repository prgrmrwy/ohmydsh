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
import {
  envKey,
  petDomainSpec,
  revisionKey,
  PET_CHANNEL_CONFIG_KEY,
  PET_CHAT_ID_PATTERN,
  PET_ENV_GLOBAL_SCOPE,
  PET_ENV_KEY_PATTERN,
  PET_OPEN_ID_PATTERN,
  type PetChannelConfig,
  type PetChatBinding,
  type PetEnvEntry,
  type PetGlobalState,
  type PetInvocationChannel,
} from './spec.js'
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
  /** Serializes read-modify-write channel updates to prevent stale row replacement. */
  private channelConfigWrite: Promise<void> = Promise.resolve()

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
      .put(revisionKey(revision.skillName), revision as never)
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

  // -- environment ----------------------------------------------------------

  /**
   * Every stored environment entry across both scopes.
   * @returns the entries, ordered by scope then key.
   */
  listEnvEntries(): readonly PetEnvEntry[] {
    return [...this.domain.table('workspace_env').entries()]
      .map(([, value]) => value as PetEnvEntry)
      .sort(
        (left, right) =>
          left.scope.localeCompare(right.scope) || left.key.localeCompare(right.key),
      )
  }

  /**
   * Entries belonging to one scope.
   * @param scope - `global` or a workspace id.
   * @returns the entries, ordered by key.
   */
  listEnvEntriesByScope(scope: string): readonly PetEnvEntry[] {
    return this.listEnvEntries().filter(entry => entry.scope === scope)
  }

  /**
   * Look up one entry.
   * @param scope - `global` or a workspace id.
   * @param key - Variable name.
   * @returns the entry, or `undefined`.
   */
  getEnvEntry(scope: string, key: string): PetEnvEntry | undefined {
    return this.domain.table('workspace_env').get(envKey(scope, key)) as PetEnvEntry | undefined
  }

  /**
   * Write one entry, replacing any entry with the same scope and key.
   *
   * Rejects a malformed key HERE rather than skipping it at injection time: a
   * key stored in another shape would simply never appear in the child
   * environment, which the user experiences as silent config that does
   * nothing.
   * @param entry - The entry to store.
   * @returns the stored entry.
   * @throws PetError when the key shape or value is invalid.
   */
  async putEnvEntry(entry: PetEnvEntry): Promise<PetEnvEntry> {
    if (!PET_ENV_KEY_PATTERN.test(entry.key)) {
      throw new PetError(
        'BINDING_INVALID',
        `Environment variable name '${entry.key}' must be upper snake case, e.g. CR_GROUP`,
      )
    }
    if (entry.value === '') {
      throw new PetError('BINDING_INVALID', `Environment variable '${entry.key}' needs a value`)
    }
    if (entry.scope === '') {
      throw new PetError('BINDING_INVALID', 'An environment entry needs a scope')
    }
    await this.domain.table('workspace_env').put(envKey(entry.scope, entry.key), entry as never)
    return entry
  }

  /**
   * Remove one entry.
   * @param scope - `global` or a workspace id.
   * @param key - Variable name.
   * @returns whether a row was removed.
   */
  async deleteEnvEntry(scope: string, key: string): Promise<boolean> {
    const table = this.domain.table('workspace_env')
    if (table.get(envKey(scope, key)) === undefined) return false
    await table.delete(envKey(scope, key))
    return true
  }

  /**
   * Resolve the entries that apply to one Invocation source.
   *
   * Global first, then the workspace overriding same-named keys. Returning a
   * flat map keeps the precedence decision in ONE place: callers (including
   * the shell-env contributor) never see two candidate values and cannot pick
   * differently.
   * @param workspaceId - Source workspace id, when the snapshot has one.
   * @returns the effective key/value map.
   */
  resolveEnvFor(workspaceId: string | undefined): Readonly<Record<string, string>> {
    const merged: Record<string, string> = {}
    for (const entry of this.listEnvEntriesByScope(PET_ENV_GLOBAL_SCOPE)) {
      merged[entry.key] = entry.value
    }
    if (workspaceId !== undefined && workspaceId !== '') {
      for (const entry of this.listEnvEntriesByScope(workspaceId)) {
        merged[entry.key] = entry.value
      }
    }
    return merged
  }

  // -- channel configuration ------------------------------------------------

  /**
   * Current Lark channel configuration.
   *
   * Returns a disabled, unbound configuration when nothing was ever written,
   * so callers never branch on "row missing" versus "channel off" — both mean
   * the channel does not run.
   * @returns the stored configuration, or the disabled default.
   */
  getChannelConfig(): PetChannelConfig {
    const stored = this.domain.table('channel_config').get(PET_CHANNEL_CONFIG_KEY) as
      | PetChannelConfig
      | undefined
    return stored ?? { enabled: false, allowOpenIds: [], updatedAt: 0 }
  }

  /**
   * Replace the channel configuration.
   *
   * Identifiers are validated HERE because they are the trust boundary: an
   * allowlist entry that is not a real open_id can never match an inbound
   * sender, so storing one would silently admit nobody while looking
   * configured. Same for the bot's own open_id, without which group mention
   * filtering cannot fail closed.
   * @param config - The configuration to store.
   * @returns the stored configuration.
   * @throws PetError when an identifier is malformed.
   */
  async putChannelConfig(config: PetChannelConfig): Promise<PetChannelConfig> {
    if (config.botOpenId !== undefined && !PET_OPEN_ID_PATTERN.test(config.botOpenId)) {
      throw new PetError('BINDING_INVALID', `Bot open_id '${config.botOpenId}' is not an open id`)
    }
    for (const openId of config.allowOpenIds) {
      if (!PET_OPEN_ID_PATTERN.test(openId)) {
        throw new PetError(
          'BINDING_INVALID',
          `Allowlist entry '${openId}' is not a resolved open id`,
        )
      }
    }
    await this.domain.table('channel_config').put(PET_CHANNEL_CONFIG_KEY, config as never)
    return config
  }

  /** Atomically transform the latest channel row within this Host process. */
  async updateChannelConfig(
    transform: (current: PetChannelConfig) => PetChannelConfig,
  ): Promise<PetChannelConfig> {
    let result: PetChannelConfig | undefined
    const operation = this.channelConfigWrite.then(async () => {
      result = await this.putChannelConfig(transform(this.getChannelConfig()))
    })
    this.channelConfigWrite = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
    if (result === undefined) throw new PetError('INTERNAL', 'Channel configuration update failed.')
    return result
  }

  // -- chat bindings --------------------------------------------------------

  /**
   * Every chat binding.
   * @returns the bindings, ordered by chat id.
   */
  listChatBindings(): readonly PetChatBinding[] {
    return [...this.domain.table('chat_bindings').entries()]
      .map(([, value]) => value as PetChatBinding)
      .sort((left, right) => left.chatId.localeCompare(right.chatId))
  }

  /**
   * Look up one chat's binding.
   * @param chatId - Lark chat id.
   * @returns the binding, or `undefined` when the chat has never been routed.
   */
  getChatBinding(chatId: string): PetChatBinding | undefined {
    return this.domain.table('chat_bindings').get(chatId) as PetChatBinding | undefined
  }

  /**
   * Write one chat binding, replacing any existing row for that chat.
   * @param binding - The binding to store.
   * @returns the stored binding.
   * @throws PetError when the chat id is malformed.
   */
  async putChatBinding(binding: PetChatBinding): Promise<PetChatBinding> {
    if (!PET_CHAT_ID_PATTERN.test(binding.chatId)) {
      throw new PetError('BINDING_INVALID', `Chat id '${binding.chatId}' is not a chat id`)
    }
    // Kind-specific shape, validated on WRITE so a broken row fails at its
    // author instead of poisoning the next domain open (the schema enforces
    // the same rules there).
    if (binding.kind === 'qa') {
      if (binding.qaChildSessionId === undefined || binding.qaChildSessionId === '') {
        throw new PetError('BINDING_INVALID', 'A qa binding needs its child session')
      }
      if (binding.qaParentSessionId === undefined || binding.qaParentSessionId === '') {
        throw new PetError('BINDING_INVALID', 'A qa binding needs its source session')
      }
    } else if (binding.workspaceId === undefined || binding.workspaceId === '') {
      throw new PetError('BINDING_INVALID', 'A chat binding needs a workspace')
    }
    await this.domain.table('chat_bindings').put(binding.chatId, binding as never)
    return binding
  }

  /**
   * Mark a qa binding invalidated, keeping the row and its history pointers.
   *
   * One-way and idempotent: a second call keeps the FIRST timestamp and
   * reason, because that is when messages actually stopped raising work.
   * @param chatId - Lark chat id of the qa binding.
   * @param reason - Human-readable cause shown in Settings and diagnostics.
   * @returns the updated binding, or `undefined` when no qa row exists.
   */
  async invalidateQaBinding(chatId: string, reason: string): Promise<PetChatBinding | undefined> {
    const existing = this.getChatBinding(chatId)
    if (existing === undefined || existing.kind !== 'qa') return undefined
    if (existing.qaInvalidatedAt !== undefined) return existing
    const next: PetChatBinding = {
      ...existing,
      qaInvalidatedAt: Date.now(),
      qaInvalidatedReason: reason,
    }
    await this.domain.table('chat_bindings').put(chatId, next as never)
    return next
  }

  /**
   * Point a chat at the Task now serving it.
   *
   * Separate from {@link putChatBinding} so healing a stale pointer cannot
   * accidentally rewrite the route or the `boundBy` provenance.
   * @param chatId - Lark chat id.
   * @param taskId - Task now serving the chat, or `undefined` to clear.
   * @returns the updated binding, or `undefined` when the chat has no row.
   */
  async setChatActiveTask(
    chatId: string,
    taskId: string | undefined,
  ): Promise<PetChatBinding | undefined> {
    const existing = this.getChatBinding(chatId)
    if (existing === undefined) return undefined
    const next: PetChatBinding = { ...existing }
    if (taskId === undefined) delete (next as { activeTaskId?: string }).activeTaskId
    else next.activeTaskId = taskId
    await this.domain.table('chat_bindings').put(chatId, next as never)
    return next
  }

  /**
   * Remove one chat binding.
   * @param chatId - Lark chat id.
   * @returns whether a row was removed.
   */
  async deleteChatBinding(chatId: string): Promise<boolean> {
    const table = this.domain.table('chat_bindings')
    if (table.get(chatId) === undefined) return false
    await table.delete(chatId)
    return true
  }

  // -- invocation channel bindings ------------------------------------------

  /**
   * Trusted reply target for one Invocation.
   * @param invocationId - Invocation id.
   * @returns the binding, or `undefined` when the Invocation is not
   *   channel-triggered.
   */
  getInvocationChannel(invocationId: string): PetInvocationChannel | undefined {
    return this.domain.table('invocation_channel').get(invocationId) as
      | PetInvocationChannel
      | undefined
  }

  /**
   * Find the Invocation already created for a trigger message.
   *
   * This is the idempotency probe: Lark redelivers unacknowledged events after
   * a reconnect, and creating a second Invocation for the same message would
   * run the user's request twice.
   * @param triggerMessageId - Lark message id that triggered the work.
   * @returns the existing binding, or `undefined`.
   */
  findChannelByTriggerMessage(triggerMessageId: string): PetInvocationChannel | undefined {
    for (const [, value] of this.domain.table('invocation_channel').entries()) {
      const binding = value as PetInvocationChannel
      if (binding.triggerMessageId === triggerMessageId) return binding
    }
    return undefined
  }

  /**
   * The channel-triggered Invocation of one Task still awaiting its terminal
   * feedback.
   *
   * Deliberately NOT `findCurrentInvocation`: that resolves the serial slot
   * for the trusted context tool and only recognizes `running`/`waiting-user`.
   * By the time a `turn/end` arrives the Invocation has usually already been
   * settled to `succeeded`, so asking for the slot returns nothing and the
   * reaction is never cleared — the in-progress and done marks then pile up
   * on the same message.
   *
   * "Awaiting feedback" is defined by the binding itself: a reaction id that
   * has not been cleared yet. That makes the lookup independent of Invocation
   * status ordering entirely.
   * @param taskId - Owning Task id.
   * @returns the binding, or `undefined` when nothing is pending.
   */
  findPendingChannelFeedback(taskId: string): PetInvocationChannel | undefined {
    const owned = new Set(this.listInvocations(taskId).map(invocation => invocation.id))
    let latest: PetInvocationChannel | undefined
    for (const [, value] of this.domain.table('invocation_channel').entries()) {
      const binding = value as PetInvocationChannel
      if (!owned.has(binding.invocationId)) continue
      // Keyed on the explicit marker, NOT on `reactionId`: the reaction is
      // written after dispatch, so a fast turn settles before it lands and
      // "reaction present" would miss exactly the races it needs to catch.
      if (binding.settledAt !== undefined) continue
      // Newest wins: a Task accumulates bindings over its life, and the one
      // just finished is the one this turn belongs to.
      if (latest === undefined || binding.createdAt > latest.createdAt) latest = binding
    }
    return latest
  }

  /**
   * The OLDEST unsettled binding of one chat.
   *
   * The QA counterpart of {@link findPendingChannelFeedback}, and oldest-first
   * rather than newest-first for a structural reason: QA turns are ordered by
   * the child's own FIFO inbox, so the settlement arriving now belongs to the
   * question that has been waiting longest. A Task-scoped lookup does not work
   * there either — QA deliveries hang off a chat, and their turns are driven
   * by the subagent runtime rather than Pet's serial queue.
   * @param chatId - Lark chat id.
   * @returns the binding, or `undefined` when nothing is pending.
   */
  findOldestPendingChannelForChat(chatId: string): PetInvocationChannel | undefined {
    let oldest: PetInvocationChannel | undefined
    for (const [, value] of this.domain.table('invocation_channel').entries()) {
      const binding = value as PetInvocationChannel
      if (binding.chatId !== chatId || binding.settledAt !== undefined) continue
      if (oldest === undefined || binding.createdAt < oldest.createdAt) oldest = binding
    }
    return oldest
  }

  /**
   * How many of one chat's deliveries are still awaiting settlement.
   * @param chatId - Lark chat id.
   * @returns the pending count, for diagnostics.
   */
  countPendingChannelForChat(chatId: string): number {
    let count = 0
    for (const [, value] of this.domain.table('invocation_channel').entries()) {
      const binding = value as PetInvocationChannel
      if (binding.chatId === chatId && binding.settledAt === undefined) count += 1
    }
    return count
  }

  /**
   * Mark a channel binding as having received its terminal feedback.
   * @param invocationId - Invocation id.
   * @returns the updated binding, or `undefined` when no binding exists.
   */
  async markChannelSettled(invocationId: string): Promise<PetInvocationChannel | undefined> {
    const existing = this.getInvocationChannel(invocationId)
    if (existing === undefined) return undefined
    const next: PetInvocationChannel = { ...existing, settledAt: Date.now() }
    await this.domain.table('invocation_channel').put(invocationId, next as never)
    return next
  }

  /**
   * Record the reply target for a channel-triggered Invocation.
   * @param binding - The binding to store.
   * @returns the stored binding.
   * @throws PetError when an identifier is malformed.
   */
  async putInvocationChannel(binding: PetInvocationChannel): Promise<PetInvocationChannel> {
    if (!PET_CHAT_ID_PATTERN.test(binding.chatId)) {
      throw new PetError('BINDING_INVALID', `Chat id '${binding.chatId}' is not a chat id`)
    }
    if (!PET_OPEN_ID_PATTERN.test(binding.senderOpenId)) {
      throw new PetError(
        'BINDING_INVALID',
        `Sender '${binding.senderOpenId}' is not a resolved open id`,
      )
    }
    if (binding.triggerMessageId === '') {
      throw new PetError('BINDING_INVALID', 'A channel binding needs a trigger message')
    }
    await this.domain.table('invocation_channel').put(binding.invocationId, binding as never)
    return binding
  }

  /**
   * Attach the in-progress reaction id to an existing binding.
   *
   * Written separately from the binding itself because the reaction call is
   * fail-soft: the Invocation is already created and running by the time Lark
   * answers, and a failed reaction must not undo that.
   * @param invocationId - Invocation id.
   * @param reactionId - Reaction id returned by Lark, or `undefined` to clear.
   * @returns the updated binding, or `undefined` when no binding exists.
   */
  async setInvocationReaction(
    invocationId: string,
    reactionId: string | undefined,
  ): Promise<PetInvocationChannel | undefined> {
    const existing = this.getInvocationChannel(invocationId)
    if (existing === undefined) return undefined
    const next: PetInvocationChannel = { ...existing }
    if (reactionId === undefined) delete (next as { reactionId?: string }).reactionId
    else next.reactionId = reactionId
    await this.domain.table('invocation_channel').put(invocationId, next as never)
    return next
  }
}
