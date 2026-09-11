/**
 * Durable adapter for the unified Pet locus model.
 *
 * This adapter owns only the additive `loci`, `locus_indexes`,
 * `locus_deliveries`, and `locus_operations` tables.  In particular, it never
 * opens, reads, or writes the retired `chat_bindings` or `invocation_channel`
 * tables.  Those rows remain ordinary Pet history and are intentionally not a
 * fallback for the new model.
 *
 * `dsh-storage-domain` serializes writes per domain. Newer backends may also
 * expose an atomic cross-table transaction; controller provisioning requires
 * that capability and refuses before external creation when it is absent.
 * Older ordinary repository mutations retain the operation/WAL compensation
 * path for compatibility, but callers must not mistake that fallback for an
 * atomic provisioning publish.
 */

import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  buildLocusRecord,
  endpointKeyOf,
  endpointFromKey,
  isAutomaticSource,
  isCurrentLocusState,
  normalizeLocusEndpoint,
  transitionLocus,
  withLocusPermission,
  withLocusBusy,
  assertLocusMutationFence,
  type LocusContextAnchor,
  type LocusEndpoint,
  type LocusMutationFence,
  type LocusErrorCode,
  type LocusPermission,
  type LocusPermissionMode,
  type LocusRecord,
  type LocusState,
  type LocusSource,
  type NewLocusInput,
} from './aggregate.js'
import type {
  DeliveryCorrelation,
  DeliveryFeedbackTarget,
  DeliveryInput,
  DeliveryTurnCorrelation,
  DeliveryOutcome,
  DeliveryRecord,
  DeliverySettlementInput,
  DeliveryStatus,
} from './delivery.js'
import { LocusError } from './aggregate.js'
import type { LocusContextAnchorFacts } from './context.js'
import type { LocusCurrentDelivery } from './context-repository.js'
import { extractResourceRefs, operationKindOf } from './persistence-helper.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  petDomainSpec,
  type PetLocusDelivery,
  type PetLocusIndex,
  type PetLocusOperation,
  type PetLocusRecord,
  type PetLocusSwitchNotice,
  type PetLocusPermissionAudit,
} from '../spec.js'

/**
 * One staged write inside a durable locus transaction.
 *
 * Declared here because the Host runtime exposes the capability optionally:
 * a deployment whose storage layer predates it has no `transaction` member,
 * and this adapter must still compile and run against that runtime.
 */
interface LocusDomainTransaction {
  put(table: TableName | 'locus_operations', key: string, value: unknown): void
  delete(table: TableName | 'locus_operations', key: string): void
}

/**
 * Typed handle for the Pet domain's additive locus tables.
 *
 * The optional members mirror the Host storage capability: `transaction`
 * commits several locus records as one atomic unit, and
 * `supportsTransaction` reports whether the routed medium can do it at all.
 * Both are absent on an older runtime, so every use is guarded.
 */
export type LocusDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: LocusDomainTransaction) => void) => Promise<void>
}

type LocusTable = KvTable<string, PetLocusRecord>
type IndexTable = KvTable<string, PetLocusIndex>
type DeliveryTable = KvTable<string, PetLocusDelivery>
type OperationTable = KvTable<string, PetLocusOperation>

type LocusIndexKind = PetLocusIndex['kind']
type StoredLocus = LocusRecord

type TableName =
  | 'loci'
  | 'locus_indexes'
  | 'locus_deliveries'
  | 'locus_switch_notices'
  | 'locus_permission_audit'
type TableChange =
  | { readonly table: 'loci'; readonly key: string; readonly value?: StoredLocus }
  | { readonly table: 'locus_indexes'; readonly key: string; readonly value?: PetLocusIndex }
  | { readonly table: 'locus_deliveries'; readonly key: string; readonly value?: DeliveryRecord }
  | { readonly table: 'locus_switch_notices'; readonly key: string; readonly value?: PetLocusSwitchNotice }
  | { readonly table: 'locus_permission_audit'; readonly key: string; readonly value?: PetLocusPermissionAudit }

type AppliedChange = {
  readonly change: TableChange
  readonly previous: unknown
}

export type LocusProvisioningErrorCode =
  | 'TRANSACTION_UNAVAILABLE'
  | 'PROVISIONING_NOT_FOUND'
  | 'PROVISIONING_CONFLICT'

/** Stable fail-closed error for controller provisioning. */
export class LocusProvisioningError extends Error {
  constructor(
    readonly code: LocusProvisioningErrorCode,
    message: string,
    readonly operation?: string,
  ) {
    super(message)
    this.name = 'LocusProvisioningError'
  }
}

/** Result of idempotently accepting a platform message. */
export interface LocusDeliveryAcceptance {
  readonly record: DeliveryRecord
  readonly duplicate: boolean
  /** True when a duplicate message was replayed with another correlation. */
  readonly conflict: boolean
}

/** Result of a repository settlement operation. */
export interface LocusDeliveryMutation {
  readonly record: DeliveryRecord | undefined
  readonly changed: boolean
  readonly reason:
    | 'unknown-delivery'
    | 'correlation-mismatch'
    | 'already-in-state'
    | 'already-terminal'
    | 'invalid-transition'
    | 'execution-proof-required'
    | 'no-pending-delivery'
    | 'inbox-message-conflict'
}

/** A durable operation snapshot exposed for restart diagnostics. */
export type LocusOperation = PetLocusOperation

/** Controller-owned provisioning intent persisted before external creation. */
export interface DurableProvisioningBegin {
  readonly provisioningId: string
  readonly kind: 'group' | 'topic' | 'qa' | 'replacement' | 'rebuild'
  readonly endpoint: LocusEndpoint
  readonly parentSessionId?: string
  readonly startedAt: number
}

/** External resources created under one provisioning intent. */
export interface DurableProvisioningResources {
  readonly mainSessionId?: string
  readonly childSessionId?: string
  readonly chatId?: string
}

/**
 * One atomic controller publish. `group` is validation-only: chat-level locus
 * remains the sole durable group truth and no second group row is stored.
 */
export interface DurableProvisioningCommit {
  readonly provisioningId: string
  readonly locus: LocusRecord
  readonly group?: {
    readonly chatId: string
    readonly workspaceId: string
    readonly mainSessionId: string
    readonly mainSource: 'auto' | 'explicit' | 'qa-created'
    readonly state: LocusState
    readonly createdAt: number
    readonly updatedAt: number
  }
  readonly defaultQaForParentSessionId?: string
  readonly replace?: {
    readonly oldLocusId: string
    /** Debt committed with the replacement; dispatch remains gated until sent. */
    readonly noticeText: string
  }
  /** Owner-authorized rebuild over an unavailable latest marker. */
  readonly rebuild?: {
    readonly oldLocusId: string
  }
}

/** Proof supplied by the live Host for one interrupted Delivery. */
export interface LocusStartupDeliveryProof {
  readonly deliveryId: string
  readonly executionId: string
  readonly turnId: string
  /** Only a still-live turn may remain pending across startup. */
  readonly state: 'running'
}

/** External resource compensators used only for durable provisioning refs. */
export interface LocusStartupCompensators {
  readonly childSession?: (input: {
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly operationId: string
  }) => Promise<void>
  readonly mainSession?: (input: {
    readonly mainSessionId: string
    readonly operationId: string
  }) => Promise<void>
  readonly chat?: (input: { readonly chatId: string; readonly operationId: string }) => Promise<void>
}

export interface LocusStartupRecoveryOptions {
  readonly now?: number
  /** Absent/undefined proof means the old execution cannot safely continue. */
  readonly deliveryProof?: (delivery: DeliveryRecord) => Promise<LocusStartupDeliveryProof | undefined>
  /** Must stop/drain the exact child so an old inbox item cannot run later. */
  readonly terminateDelivery?: (delivery: DeliveryRecord) => Promise<void>
  readonly compensators?: LocusStartupCompensators
}

/** One deterministic fail-closed decision made during startup. */
export interface LocusStartupRecoveryReport {
  readonly indexStatus: 'unchanged' | 'rebuilt'
  readonly indexChanges: number
  /** Deliveries whose exact live turn was proven and deliberately retained. */
  readonly pendingDeliveries: readonly DeliveryRecord[]
  /** Operations still requiring an explicit owner action; they gate creation. */
  readonly recoverableOperations: readonly LocusOperation[]
  readonly failedDeliveries: readonly DeliveryRecord[]
  readonly retainedDeliveries: readonly DeliveryRecord[]
  /** Still pending/busy because exact termination could not be proven. */
  readonly manualDeliveries: readonly DeliveryRecord[]
  readonly compensatedOperations: readonly LocusOperation[]
  readonly manualOperations: readonly LocusOperation[]
  readonly sideEffectsReplayed: false
}

const TERMINAL_DELIVERY_STATUSES: ReadonlySet<DeliveryStatus> = new Set(['settled', 'failed'])
const PENDING_DELIVERY_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
  'accepted',
  'queued',
  'running',
])
const ACTIVE_BUSY_DELIVERY_STATUSES: ReadonlySet<DeliveryStatus> = PENDING_DELIVERY_STATUSES
const DELIVERY_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  accepted: ['queued'],
  queued: ['running'],
  running: ['settled', 'failed'],
  settled: [],
  failed: [],
}

/** Prefixes used by the materialized index table. */
export const LOCUS_INDEX_PREFIX = Object.freeze({
  endpoint: 'endpoint:',
  parent: 'parent:',
  child: 'child:',
  defaultQa: 'default-qa:',
} as const)

/** Build the key used for one index row. */
export function locusIndexKey(
  kind: LocusIndexKind,
  value: string,
): string {
  if (value.trim() === '') throw new LocusError('INVALID_LOCUS', `${kind} index value is empty`)
  switch (kind) {
    case 'endpoint-current':
      return `${LOCUS_INDEX_PREFIX.endpoint}${value}`
    case 'parent-loci':
      return `${LOCUS_INDEX_PREFIX.parent}${value}`
    case 'child-locus':
      return `${LOCUS_INDEX_PREFIX.child}${value}`
    case 'default-qa':
      return `${LOCUS_INDEX_PREFIX.defaultQa}${value}`
  }
}

/** Stable index key for an endpoint. */
export function endpointIndexKey(endpoint: LocusEndpoint): string {
  return locusIndexKey('endpoint-current', endpointKeyOf(endpoint))
}

/** Stable reverse index key for a parent session. */
export function parentIndexKey(parentSessionId: string): string {
  return locusIndexKey('parent-loci', parentSessionId)
}

/** Stable reverse index key for a child session. */
export function childIndexKey(childSessionId: string): string {
  return locusIndexKey('child-locus', childSessionId)
}

/** Stable default-Q&A pointer key for a parent session. */
export function defaultQaIndexKey(parentSessionId: string): string {
  return locusIndexKey('default-qa', parentSessionId)
}

/**
 * Durable locus repository. All mutations are serialized by this single
 * repository/domain owner; the current storage backend has no cross-open CAS,
 * so production must not compose a second writer for the same Pet domain.
 * Records and indexes are rebuilt from the `loci` table rather than treating a
 * reverse index as a second lifecycle authority.
 */
export class LocusRepository {
  private writeChain: Promise<void> = Promise.resolve()
  private operationSequence = 0

  constructor(private readonly domain: LocusDomain) {
    // A LocusRepository is intentionally a single-writer adapter for one
    // opened Domain. The storage-domain backend provides no cross-process CAS;
    // production composition must therefore publish only one owner for this
    // domain, while fences protect concurrent requests through this adapter.
  }

  /** Whether controller provisioning can be published atomically. */
  supportsAtomicProvisioning(): boolean {
    return this.domain.supportsTransaction === true && this.domain.transaction !== undefined
  }

  /**
   * Persist one provisioning intent before any external resource is created.
   *
   * This path has no compensated fallback: without a real Domain transaction,
   * the controller must fail before it creates a DSH session or Lark group.
   */
  async beginProvisioning(input: DurableProvisioningBegin): Promise<LocusOperation> {
    const transaction = this.requireProvisioningTransaction('beginProvisioning')
    return this.enqueue(async () => {
      assertProvisioningBegin(input)
      const intentHash = provisioningBeginHash(input)
      const existing = this.getOperation(input.provisioningId)
      if (existing !== undefined) {
        this.assertSameProvisioningIntent(existing, input, intentHash)
        return existing
      }
      const endpointKey = endpointKeyOf(input.endpoint)
      const blocking = this.findBlockingProvisioningOperation(endpointKey, input.parentSessionId)
      if (blocking !== undefined) {
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Endpoint ${endpointKey} has unresolved provisioning ${blocking.id} (${blocking.phase})`,
        )
      }
      const operation: PetLocusOperation = {
        id: input.provisioningId,
        kind: provisioningOperationKind(input.kind),
        phase: 'provisioning',
        operation: `provisioning:${input.kind}`,
        endpointKey: endpointKeyOf(input.endpoint),
        provisioningIntentHash: intentHash,
        ...(input.parentSessionId !== undefined
          ? { resourceRefs: { parentSessionId: input.parentSessionId } }
          : {}),
        step: 0,
        attempts: 0,
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
      }
      await transaction.call(this.domain, tx => {
        tx.put('locus_operations', input.provisioningId, operation)
      })
      return operation
    })
  }

  /** Attach a created external resource to the same provisioning operation. */
  async recordProvisioningResource(
    provisioningId: string,
    resource: DurableProvisioningResources,
  ): Promise<LocusOperation> {
    const transaction = this.requireProvisioningTransaction('recordProvisioningResource')
    return this.enqueue(async () => {
      assertIdentifier(provisioningId, 'provisioningId')
      assertProvisioningResources(resource)
      const operation = this.getRequiredProvisioningOperation(provisioningId)
      if (operation.phase !== 'provisioning') {
        const refs = mergeProvisioningResources(operation.resourceRefs, resource)
        if (recordsEqual(refs, operation.resourceRefs ?? {})) return operation
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Provisioning ${provisioningId} is already ${operation.phase}`,
        )
      }
      const resourceRefs = mergeProvisioningResources(operation.resourceRefs, resource)
      if (recordsEqual(resourceRefs, operation.resourceRefs ?? {})) return operation
      const next: PetLocusOperation = {
        ...operation,
        resourceRefs,
        step: operation.step + 1,
        updatedAt: Math.max(Date.now(), operation.updatedAt),
      }
      await transaction.call(this.domain, tx => {
        tx.put('locus_operations', provisioningId, next)
      })
      return next
    })
  }

  /**
   * Atomically publish one prepared controller locus and its materialized rows.
   * Group data is validated against the chat-level locus and is never stored as
   * a second lifecycle truth.
   */
  async commitProvisioning(input: DurableProvisioningCommit): Promise<LocusRecord> {
    const transaction = this.requireProvisioningTransaction('commitProvisioning')
    return this.enqueue(async () => {
      assertIdentifier(input.provisioningId, 'provisioningId')
      const operation = this.getRequiredProvisioningOperation(input.provisioningId)
      const normalized = normalizeRecord(input.locus)
      const commitHash = provisioningCommitHash(input, normalized)
      if (operation.phase === 'committed') {
        if (operation.commitIntentHash !== commitHash) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Provisioning ${input.provisioningId} was committed with another intent`,
          )
        }
        const existing = this.getLocus(normalized.id)
        if (existing === undefined || !recordsEqual(existing, normalized)) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Provisioning ${input.provisioningId} committed record is missing or different`,
          )
        }
        return existing
      }
      if (operation.phase !== 'provisioning') {
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Provisioning ${input.provisioningId} cannot commit from ${operation.phase}`,
        )
      }
      assertProvisioningCommitMatchesBegin(operation, input, normalized)
      assertProvisioningCommitForm(operation, input, normalized)
      assertGroupProjection(input.group, normalized)
      assertProvisioningResourcesMatch(operation, normalized, input.group)

      const before = this.collectLoci()
      assertNewTopicParent(before, normalized)
      const after = new Map(before)
      if (after.has(normalized.id)) {
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Locus ${normalized.id} already belongs to another provisioning operation`,
        )
      }
      const latest = latestLocusForEndpoint(before, normalized.endpoint)
      const extra: TableChange[] = []
      if (input.replace !== undefined && input.rebuild !== undefined) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'A commit cannot replace and rebuild simultaneously')
      }
      if (input.rebuild !== undefined) {
        const previous = before.get(input.rebuild.oldLocusId)
        if (previous === undefined || latest?.id !== previous.id) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Rebuild predecessor ${input.rebuild.oldLocusId} is not the latest endpoint generation`,
          )
        }
        if (previous.state !== 'stopped' && previous.state !== 'invalid' && previous.state !== 'retired') {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Rebuild predecessor ${previous.id} is not unavailable`,
          )
        }
        if (previous.busy || this.hasPendingDelivery(previous.id, previous.generation)) {
          throw new LocusProvisioningError('PROVISIONING_CONFLICT', `Rebuild predecessor ${previous.id} is busy`)
        }
        if (normalized.generation !== previous.generation + 1 || normalized.replacesLocusId !== previous.id) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            'Rebuild generation or replacesLocusId does not match its predecessor',
          )
        }
      } else if (input.replace === undefined) {
        if (latest !== undefined) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Endpoint ${endpointKeyOf(normalized.endpoint)} already has locus ${latest.id}`,
          )
        }
        if (normalized.generation !== 1 || normalized.replacesLocusId !== undefined) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            'A first provisioning commit must publish generation 1 without replacesLocusId',
          )
        }
      } else {
        const previous = before.get(input.replace.oldLocusId)
        if (previous === undefined || latest?.id !== previous.id) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Replacement predecessor ${input.replace.oldLocusId} is not the latest endpoint generation`,
          )
        }
        if (!isAutomaticSource(previous.source) || previous.state !== 'active') {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Replacement predecessor ${previous.id} is not an active automatic locus`,
          )
        }
        if (previous.busy || this.hasPendingDelivery(previous.id, previous.generation)) {
          throw new LocusProvisioningError('PROVISIONING_CONFLICT', `Replacement predecessor ${previous.id} is busy`)
        }
        if (normalized.generation !== previous.generation + 1 || normalized.replacesLocusId !== previous.id) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            'Replacement generation or replacesLocusId does not match its predecessor',
          )
        }
        assertIdentifier(input.replace.noticeText, 'replace.noticeText')
        after.set(previous.id, transitionLocus(previous, 'retired', normalized.createdAt, { busy: false }))
        extra.push({
          table: 'locus_switch_notices',
          key: switchNoticeKey(normalized.id, normalized.generation),
          value: {
            locusId: normalized.id,
            generation: normalized.generation,
            endpoint: normalized.endpoint,
            text: input.replace.noticeText,
            createdAt: normalized.createdAt,
            attempts: 0,
          },
        })
      }
      after.set(normalized.id, normalized)
      assertLocusSet(after)

      const defaults = this.collectDefaultPointers()
      if (input.defaultQaForParentSessionId !== undefined) {
        assertIdentifier(input.defaultQaForParentSessionId, 'defaultQaForParentSessionId')
        if (
          normalized.parentSessionId !== input.defaultQaForParentSessionId ||
          normalized.source !== 'qa-created' ||
          normalized.parentLocusId !== undefined
        ) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            'Default Q&A pointer must identify this chat-level qa-created locus',
          )
        }
        const existingDefault = defaults.get(input.defaultQaForParentSessionId)
        if (
          existingDefault !== undefined &&
          existingDefault !== normalized.id &&
          existingDefault !== input.rebuild?.oldLocusId
        ) {
          throw new LocusProvisioningError(
            'PROVISIONING_CONFLICT',
            `Parent ${input.defaultQaForParentSessionId} already has default Q&A ${existingDefault}`,
          )
        }
        defaults.set(input.defaultQaForParentSessionId, normalized.id)
      }

      const changes: TableChange[] = [
        ...diffLocusTable(before, after),
        ...diffIndexTable(this.collectIndexes(), this.deriveIndexes(after, defaults, normalized.createdAt)),
        ...extra,
      ]
      const completedAt = Math.max(Date.now(), operation.updatedAt, normalized.createdAt)
      const committed: PetLocusOperation = {
        ...operation,
        phase: 'committed',
        locusId: normalized.id,
        ...(input.replace !== undefined
          ? { oldLocusId: input.replace.oldLocusId }
          : input.rebuild !== undefined
            ? { oldLocusId: input.rebuild.oldLocusId }
            : {}),
        newLocusId: normalized.id,
        commitIntentHash: commitHash,
        endpointKey: endpointKeyOf(normalized.endpoint),
        resourceRefs: mergeProvisioningResources(operation.resourceRefs, {
          chatId: normalized.endpoint.chatId,
          ...(normalized.childSessionId !== undefined
            ? { childSessionId: normalized.childSessionId }
            : {}),
        }),
        step: operation.step + 1,
        attempts: operation.attempts + 1,
        completedAt,
        updatedAt: completedAt,
      }
      const effective = changes.filter(change => this.changesState(change))
      await transaction.call(this.domain, tx => {
        for (const change of effective) {
          if (change.value === undefined) tx.delete(change.table, change.key)
          else tx.put(change.table, change.key, change.value)
        }
        tx.put('locus_operations', input.provisioningId, committed)
      })
      return normalized
    })
  }

  /** Commit already records the terminal phase; completion is an idempotent check. */
  async completeProvisioning(provisioningId: string): Promise<void> {
    this.requireProvisioningTransaction('completeProvisioning')
    await this.enqueue(async () => {
      const operation = this.getRequiredProvisioningOperation(provisioningId)
      if (operation.phase !== 'committed') {
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Provisioning ${provisioningId} is ${operation.phase}, not committed`,
        )
      }
    })
  }

  /** Mark an uncommitted provisioning operation failed, atomically and idempotently. */
  async failProvisioning(provisioningId: string, reason: string): Promise<void> {
    const transaction = this.requireProvisioningTransaction('failProvisioning')
    await this.enqueue(async () => {
      const safeReason = reason.trim() === '' ? 'provisioning failed' : reason.slice(0, 500)
      const operation = this.getRequiredProvisioningOperation(provisioningId)
      if (operation.phase === 'failed') {
        if (operation.lastError === safeReason) return
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Provisioning ${provisioningId} already failed for another reason`,
        )
      }
      if (operation.phase !== 'provisioning') {
        throw new LocusProvisioningError(
          'PROVISIONING_CONFLICT',
          `Provisioning ${provisioningId} cannot fail from ${operation.phase}`,
        )
      }
      const now = Math.max(Date.now(), operation.updatedAt)
      const failed: PetLocusOperation = {
        ...operation,
        phase: 'failed',
        attempts: operation.attempts + 1,
        lastError: safeReason,
        updatedAt: now,
      }
      await transaction.call(this.domain, tx => {
        tx.put('locus_operations', provisioningId, failed)
      })
    })
  }

  /** Return one still-owed source-switch notice without mutating it. */
  getSwitchNotice(locusId: string, generation: number): PetLocusSwitchNotice | undefined {
    assertIdentifier(locusId, 'locusId')
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'generation must be positive')
    }
    const notice = this.domain.table('locus_switch_notices').get(switchNoticeKey(locusId, generation))
    if (notice === undefined) return undefined
    const locus = this.getLocus(locusId)
    if (
      notice.locusId !== locusId ||
      notice.generation !== generation ||
      locus === undefined ||
      locus.generation !== generation ||
      endpointKeyOf(notice.endpoint.threadId === undefined
        ? { chatId: notice.endpoint.chatId }
        : { chatId: notice.endpoint.chatId, threadId: notice.endpoint.threadId }) !== endpointKeyOf(locus.endpoint)
    ) {
      throw new LocusProvisioningError(
        'PROVISIONING_CONFLICT',
        `Switch notice ${locusId}/${String(generation)} does not match its locus`,
      )
    }
    return notice
  }

  /** Clear the notice debt only after its external send succeeded. */
  async acknowledgeSwitchNotice(locusId: string, generation: number): Promise<void> {
    const transaction = this.requireProvisioningTransaction('acknowledgeSwitchNotice')
    await this.enqueue(async () => {
      assertIdentifier(locusId, 'locusId')
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'generation must be positive')
      }
      const key = switchNoticeKey(locusId, generation)
      if (this.getSwitchNotice(locusId, generation) === undefined) return
      await transaction.call(this.domain, tx => {
        tx.delete('locus_switch_notices', key)
      })
    })
  }

  // -- locus records --------------------------------------------------------

  /** Get one locus generation by its durable id. */
  getLocus(locusId: string): LocusRecord | undefined {
    return this.loci().get(locusId) as LocusRecord | undefined
  }

  /** Alias used by controller code that calls the record a locus. */
  get = this.getLocus.bind(this)

  /** List every generation, including retired/invalid/stopped history. */
  listLoci(): readonly LocusRecord[] {
    return [...this.loci().entries()]
      .map(([, value]) => value as LocusRecord)
      .sort((left, right) => {
        const byCreated = left.createdAt - right.createdAt
        return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id)
      })
  }

  /**
   * Find the current endpoint generation through the endpoint index.
   * Retired history is not current; stopped/invalid rows remain indexed so a
   * caller cannot mistake an explicit stop for a never-created endpoint.
   */
  getCurrentLocus(endpoint: LocusEndpoint): LocusRecord | undefined {
    const normalized = normalizeLocusEndpoint(endpoint).endpoint
    const key = endpointIndexKey(normalized)
    const index = this.indexes().get(key)
    if (index === undefined) {
      // A missing materialized row is not proof that this endpoint never had a
      // locus. Callers must run startup reconciliation before routing again.
      return undefined
    }
    if (index.kind !== 'endpoint-current' || index.key !== key || index.locusIds.length !== 1) {
      throw new LocusError('INVALID_LOCUS', `Endpoint index ${key} is malformed or ambiguous`)
    }
    const locusId = index.locusIds[0]
    const record = locusId === undefined ? undefined : this.getLocus(locusId)
    if (record === undefined || endpointKeyOf(record.endpoint) !== endpointKeyOf(normalized)) {
      throw new LocusError('INVALID_LOCUS', `Endpoint index ${key} points to an invalid locus`)
    }
    if (!isEndpointMarkerState(record.state)) return undefined
    // A replacement remains deliberately unservable until its durable warning
    // debt is acknowledged. Keep the aggregate active for same-target bind
    // retries, but project switching to ordinary resolution consumers.
    if (
      record.state === 'active' &&
      this.domain.table('locus_switch_notices').get(switchNoticeKey(record.id, record.generation)) !== undefined
    ) {
      return Object.freeze({ ...record, state: 'switching' })
    }
    return record
  }

  /**
   * Return the highest durable generation for an endpoint, including a retired
   * tombstone. Controller discovery uses this instead of the serviceable index
   * so an explicit stop/retirement can never look like a never-created entry.
   */
  getLatestLocusByEndpoint(endpoint: LocusEndpoint): LocusRecord | undefined {
    const normalized = normalizeLocusEndpoint(endpoint).endpoint
    const loci = this.collectLoci()
    assertLocusSet(loci)
    return latestLocusForEndpoint(loci, normalized)
  }

  /** Endpoint lookup aliases kept small for controller integrations. */
  findCurrentLocus(endpoint: LocusEndpoint): LocusRecord | undefined {
    return this.getCurrentLocus(endpoint)
  }

  getLocusByEndpoint(endpoint: LocusEndpoint): LocusRecord | undefined {
    return this.getCurrentLocus(endpoint)
  }

  /** List all generations associated with one parent session. */
  listLociByParent(parentSessionId: string): readonly LocusRecord[] {
    assertIdentifier(parentSessionId, 'parentSessionId')
    const key = parentIndexKey(parentSessionId)
    const index = this.indexes().get(key)
    if (index === undefined) return []
    if (index.kind !== 'parent-loci' || index.key !== key || index.locusIds.length === 0) {
      throw new LocusError('INVALID_LOCUS', `Parent index ${key} is malformed or ambiguous`)
    }
    const indexed = index.locusIds.map(id => {
      const record = this.getLocus(id)
      if (record === undefined || record.parentSessionId !== parentSessionId) {
        throw new LocusError('INVALID_LOCUS', `Parent index ${key} points to an invalid locus`)
      }
      return record
    })
    return sortLoci(indexed)
  }

  listByParentSession(parentSessionId: string): readonly LocusRecord[] {
    return this.listLociByParent(parentSessionId)
  }

  listLociForParent(parentSessionId: string): readonly LocusRecord[] {
    return this.listLociByParent(parentSessionId)
  }

  /** Find the unique locus that owns a child session. */
  getLocusByChild(childSessionId: string): LocusRecord | undefined {
    assertIdentifier(childSessionId, 'childSessionId')
    const key = childIndexKey(childSessionId)
    const index = this.indexes().get(key)
    if (index === undefined) return undefined
    if (index.kind !== 'child-locus' || index.key !== key || index.locusIds.length !== 1) {
      throw new LocusError('INVALID_LOCUS', `Child index ${key} is malformed or ambiguous`)
    }
    const locusId = index.locusIds[0]
    const indexed = locusId === undefined ? undefined : this.getLocus(locusId)
    if (indexed === undefined || indexed.childSessionId !== childSessionId) {
      throw new LocusError('INVALID_LOCUS', `Child index ${key} points to an invalid locus`)
    }
    return indexed
  }

  /**
   * Caller-bound child lookup used by the context integration seam.
   *
   * Return every durable generation instead of selecting an active row. The
   * caller-bound context tool must distinguish an ordinary child from an
   * unavailable or ambiguous association and fail closed. The scan also makes
   * a stale materialized index visible rather than hiding history.
   */
  findByChildSession(childSessionId: string): LocusRecord | undefined {
    const records = this.findByChildSessionId(childSessionId)
    return records.length === 1 ? records[0] : undefined
  }

  findAllByChildSession(childSessionId: string): readonly LocusRecord[] {
    return this.findByChildSessionId(childSessionId)
  }

  findContextAnchor(input: {
    readonly childSessionId: string
    readonly locusId: string
    readonly generation: number
  }): LocusContextAnchorFacts | undefined {
    const record = this.getLocus(input.locusId)
    if (record === undefined || record.childSessionId !== input.childSessionId || record.generation !== input.generation) {
      return undefined
    }
    const anchor = record.contextAnchor
    return anchor === undefined ? undefined : {
      status: anchor.status,
      ...(anchor.existence !== undefined ? { existence: anchor.existence } : {}),
      ...(anchor.authorization !== undefined ? { authorization: anchor.authorization } : {}),
      ...(anchor.executionRoot !== undefined ? { executionRoot: anchor.executionRoot } : {}),
      ...(anchor.projectResources !== undefined ? { projectResources: [...anchor.projectResources] } : {}),
      ...(anchor.constraints !== undefined ? { constraints: [...anchor.constraints] } : {}),
      ...(anchor.provenance !== undefined ? { provenance: anchor.provenance } : {}),
      ...(anchor.confirmedAt !== undefined ? { confirmedAt: anchor.confirmedAt } : {}),
    }
  }

  findByChildSessionId(childSessionId: string): readonly LocusRecord[] {
    assertIdentifier(childSessionId, 'childSessionId')
    return this.listLoci().filter(record => record.childSessionId === childSessionId)
  }

  findLocusByChild(childSessionId: string): LocusRecord | undefined {
    return this.getLocusByChild(childSessionId)
  }

  getByChildSession(childSessionId: string): LocusRecord | undefined {
    return this.getLocusByChild(childSessionId)
  }

  /** Return the parent session's independent default Q&A locus pointer. */
  getDefaultQaLocus(parentSessionId: string): LocusRecord | undefined {
    assertIdentifier(parentSessionId, 'parentSessionId')
    const key = defaultQaIndexKey(parentSessionId)
    const index = this.indexes().get(key)
    if (index === undefined) return undefined
    if (index.kind !== 'default-qa' || index.key !== key || index.locusIds.length !== 1) {
      throw new LocusError('INVALID_LOCUS', `Default Q&A index ${key} is malformed or ambiguous`)
    }
    const locusId = index.locusIds[0]
    const record = locusId === undefined ? undefined : this.getLocus(locusId)
    if (record === undefined || record.parentSessionId !== parentSessionId || record.source !== 'qa-created' || record.parentLocusId !== undefined) {
      throw new LocusError('INVALID_LOCUS', `Default Q&A index ${key} points to an invalid locus`)
    }
    // Retired/stopped/invalid defaults remain discoverable as an explicit
    // unavailable entry. Callers must surface that state and require rebuild;
    // a missing pointer would incorrectly look like a never-created Q&A group.
    return record
  }

  getDefaultQa(parentSessionId: string): LocusRecord | undefined {
    return this.getDefaultQaLocus(parentSessionId)
  }

  /**
   * Insert one complete locus generation and materialize all affected indexes.
   * The default permission is read, and active records must already have a
   * dedicated child session (provisioning records may omit it).
   */
  async putLocus(record: LocusRecord): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const normalized = normalizeRecord(record)
      const before = this.collectLoci()
      assertNewTopicParent(before, normalized)
      const existing = before.get(normalized.id)
      if (existing !== undefined) {
        if (recordsEqual(existing, normalized)) return existing
        throw new LocusError(
          'INVALID_LOCUS',
          `Locus ${normalized.id} already exists; use an explicit transition or replacement`,
        )
      }
      const after = new Map(before)
      after.set(normalized.id, normalized)
      assertLocusSet(after)
      await this.persistLocusSet('locus-create', before, after, {
        locusId: normalized.id,
      })
      return normalized
    })
  }

  /** Build and insert a locus from the pure aggregate input shape. */
  async createLocus(input: NewLocusInput): Promise<LocusRecord> {
    return this.putLocus(buildLocusRecord(input))
  }

  /**
   * Transition one locus while retaining its generation and identity.  This is
   * intentionally separate from replacement: a retired locus can never be
   * silently reactivated.
   */
  async transitionLocus(
    locusId: string,
    state: LocusState,
    now = Date.now(),
    patch: Parameters<typeof transitionLocus>[3] = {},
    fence?: LocusMutationFence,
    options: {
      /** See `invalidateLocus`: only for a proven-unusable generation. */
      readonly evenWhenBusy?: boolean
    } = {},
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      assertLocusMutationFence(current, fence)
      if (current.busy && state !== current.state && options.evenWhenBusy !== true) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
      }
      const next = transitionLocus(current, state, now, patch)
      const after = new Map(before)
      after.set(locusId, next)
      assertLocusSet(after)
      const operationKind = state === 'stopped' ? 'stop' : state === 'invalid' ? 'invalidate' : state === 'retired' ? 'retire' : 'locus-transition'
      await this.persistLocusSet(operationKind, before, after, { locusId })
      return next
    })
  }

  /** Mark a locus retired, preserving all records and session history. */
  async retireLocus(locusId: string, now = Date.now(), fence?: LocusMutationFence): Promise<LocusRecord> {
    const existing = this.getLocus(locusId)
    if (existing?.state === 'retired') {
      assertLocusMutationFence(existing, fence)
      return existing
    }
    if (existing !== undefined && this.hasPendingDeliveries(existing.id)) {
      throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
    }
    return this.transitionLocus(locusId, 'retired', now, {}, fence)
  }

  async stopLocus(locusId: string, now = Date.now(), fence?: LocusMutationFence): Promise<LocusRecord> {
    const existing = this.getRequiredLocus(locusId)
    assertLocusMutationFence(existing, fence)
    if (this.hasPendingDeliveries(existing.id)) {
      throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
    }
    return this.transitionLocus(locusId, 'stopped', now, {}, fence)
  }

  async invalidateLocus(
    locusId: string,
    reason: string,
    now = Date.now(),
    fence?: LocusMutationFence,
    options: {
      /**
       * Mark invalid even with pending Deliveries.
       *
       * Required by startup reconciliation. The pending-work guard protects a
       * HEALTHY generation from being retired mid-flight, but when the child
       * is proven gone those Deliveries can never complete — refusing then
       * turns the guard into a deadlock: the entry cannot be invalidated
       * because of work that will never finish, and the owner sees a
       * permanently stuck endpoint with no diagnosis. Callers must have real
       * evidence the child is unusable before passing this.
       */
      readonly evenWithPendingWork?: boolean
    } = {},
  ): Promise<LocusRecord> {
    const existing = this.getRequiredLocus(locusId)
    if (options.evenWithPendingWork !== true && this.hasPendingDeliveries(existing.id)) {
      throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
    }
    assertIdentifier(reason, 'reason')
    if (options.evenWithPendingWork === true && existing.busy) {
      // Clear the fence first. It is stale by definition here: the caller has
      // proven the child is gone, so the turn it was guarding can never end.
      // The aggregate keeps refusing busy transitions, which is the invariant
      // that protects a healthy generation.
      await this.setLocusBusyUnchecked(locusId, now)
    }
    return this.transitionLocus(locusId, 'invalid', now, { invalidReason: reason }, fence,
      { evenWhenBusy: options.evenWithPendingWork === true })
  }

  /**
   * Drop a stale busy fence without the pending-Delivery check.
   *
   * Only for a generation whose child has been proven unusable: those
   * Deliveries can never settle, so the ordinary guard would deadlock.
   */
  private async setLocusBusyUnchecked(locusId: string, now: number): Promise<void> {
    await this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined || !current.busy) return
      const after = new Map(before).set(locusId, withLocusBusy(current, false, now))
      assertLocusSet(after)
      await this.persistLocusSet('locus-busy', before, after, { locusId, stale: true })
    })
  }

  /** Set the busy control fence used by source-switch callers. */
  async setLocusBusy(locusId: string, busy: boolean, now = Date.now(), fence?: LocusMutationFence): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const current = this.getRequiredLocus(locusId)
      assertLocusMutationFence(current, fence)
      if (!busy && this.hasPendingDelivery(current.id, current.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} still has pending Delivery work`)
      }
      const before = this.collectLoci()
      const next = withLocusBusy(current, busy, now)
      const after = new Map(before).set(locusId, next)
      assertLocusSet(after)
      await this.persistLocusSet('locus-busy', before, after, {
        locusId,
        endpointKey: endpointKeyOf(current.endpoint),
        expectedRevision: current.revision ?? current.updatedAt,
      })
      return next
    })
  }

  /** True when an accepted, queued, or running Delivery fences lifecycle changes. */
  hasPendingDeliveries(locusId: string): boolean {
    const locus = this.getRequiredLocus(locusId)
    return locus.busy || this.hasPendingDelivery(locus.id, locus.generation)
  }

  /** Replace the current automatic/inherited generation with a fresh locus. */
  async rebuildLocus(
    replacement: NewLocusInput,
    now = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const endpoint = normalizeLocusEndpoint(replacement.endpoint).endpoint
      const histories = [...before.values()].filter(record => endpointKeyOf(record.endpoint) === endpointKeyOf(endpoint))
      const current = histories.sort((left, right) => right.generation - left.generation)[0]
      if (current !== undefined) assertLocusMutationFence(current, fence)
      if (current !== undefined && isCurrentLocusState(current.state)) {
        throw new LocusError('ENDPOINT_OCCUPIED', `Endpoint ${endpointKeyOf(endpoint)} still has an available locus`)
      }
      const rebuilt = buildLocusRecord({
        ...replacement,
        endpoint,
        generation: (current?.generation ?? 0) + 1,
        permission: { desired: 'read', effective: 'read' },
        state: 'active',
        createdAt: replacement.createdAt ?? now,
        updatedAt: replacement.updatedAt ?? now,
        ...(current === undefined ? {} : { replacesLocusId: current.id }),
      })
      assertNewTopicParent(before, rebuilt)
      const after = new Map(before).set(rebuilt.id, rebuilt)
      assertLocusSet(after)
      await this.persistLocusSet('rebuild', before, after, {
        locusId: rebuilt.id,
        oldLocusId: current?.id,
        ...(current === undefined ? {} : { expectedRevision: current.revision ?? current.updatedAt }),
      })
      return rebuilt
    })
  }

  async replaceLocus(
    locusId: string,
    replacement: NewLocusInput,
    now = Date.now(),
    /**
     * The source-switch notice this replacement owes its endpoint.
     *
     * Committed in the SAME transaction as the new generation. Recording it
     * afterwards would leave a window where a crash publishes the switch but
     * loses the debt, and the new source would then answer the entry without
     * ever saying the source changed — the silent switch the spec forbids.
     */
    notice?: { readonly text: string },
  ): Promise<{ readonly previous: LocusRecord; readonly current: LocusRecord }> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const previous = before.get(locusId)
      if (previous === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      if (!isAutomaticSource(previous.source)) {
        throw new LocusError(
          'EXPLICIT_SOURCE_LOCKED',
          `Locus ${locusId} has explicit source ${previous.source} and cannot be replaced directly`,
        )
      }
      if (previous.busy || this.hasPendingDelivery(previous.id, previous.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} is busy`)
      }
      if (!isCurrentLocusState(previous.state) || previous.state !== 'active') {
        throw new LocusError('REPLACEMENT_REQUIRED', `Locus ${locusId} is not an active replaceable generation`)
      }

      const normalizedEndpoint = normalizeLocusEndpoint(replacement.endpoint).endpoint
      if (endpointKeyOf(normalizedEndpoint) !== endpointKeyOf(previous.endpoint)) {
        throw new LocusError('INVALID_ENDPOINT', 'A locus replacement must keep the endpoint fixed')
      }
      const current = buildLocusRecord({
        ...replacement,
        id: replacement.id ?? `${previous.id}-g${previous.generation + 1}`,
        generation: previous.generation + 1,
        endpoint: normalizedEndpoint,
        parentSessionId: replacement.parentSessionId,
        workspaceId: replacement.workspaceId,
        source: replacement.source,
        state: 'active',
        // Every new generation starts read, regardless of the old generation
        // or a caller's stale write permission object.
        permission: { desired: 'read', effective: 'read' },
        createdAt: replacement.createdAt ?? now,
        updatedAt: replacement.updatedAt ?? now,
        replacesLocusId: previous.id,
      })

      assertNewTopicParent(before, current)
      const after = new Map(before)
      after.set(previous.id, transitionLocus(previous, 'retired', now, { busy: false }))
      if (after.has(current.id)) {
        throw new LocusError('INVALID_LOCUS', `Replacement locus id ${current.id} already exists`)
      }
      after.set(current.id, current)
      assertLocusSet(after)
      await this.persistLocusSet('locus-replace', before, after, {
        locusId: current.id,
        replacesLocusId: previous.id,
      }, notice === undefined ? [] : [{
        table: 'locus_switch_notices',
        key: `${current.id}\u0000${String(current.generation)}`,
        value: {
          locusId: current.id,
          generation: current.generation,
          endpoint: current.endpoint,
          text: notice.text,
          createdAt: now,
          attempts: 0,
        },
      }])
      return { previous: after.get(previous.id) as LocusRecord, current }
    })
  }

  /** Alias matching controller terminology. */
  switchLocus(
    locusId: string,
    replacement: NewLocusInput,
    now = Date.now(),
  ): Promise<{ readonly previous: LocusRecord; readonly current: LocusRecord }> {
    return this.replaceLocus(locusId, replacement, now)
  }

  /**
   * Change desired/effective permission only after the caller has verified the
   * actual Host policy.  The repository never turns a desired write into an
   * effective write by itself.
   */
  async setLocusPermission(
    locusId: string,
    permission: LocusPermission,
    now = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      assertLocusMutationFence(current, fence)
      if (current.busy || this.hasPendingDelivery(current.id, current.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
      }
      const next = withLocusPermission(current, permission, now)
      const after = new Map(before)
      after.set(locusId, next)
      assertLocusSet(after)
      // Append the audit row in the SAME commit as the permission itself.
      // Written separately it could be lost to a crash, leaving a locus that
      // shares a work root with no record of who granted that.
      await this.persistLocusSet(
        'locus-permission',
        before,
        after,
        { locusId },
        this.permissionAuditChanges(next, permission, now),
      )
      return next
    })
  }

  /** Persist active → switching before any live Host policy mutation. */
  async beginPermissionMutation(
    locusId: string,
    now = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      assertLocusMutationFence(current, fence)
      if (current.state !== 'active' || current.busy || this.hasPendingDelivery(current.id, current.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} cannot enter permission mutation`)
      }
      const next = transitionLocus(current, 'switching', now)
      const after = new Map(before).set(locusId, next)
      assertLocusSet(after)
      await this.persistLocusSet('permission-mutation-begin', before, after, { locusId })
      return next
    })
  }

  /** Restore switching → active only after the prior Host policy is verified. */
  async abortPermissionMutation(
    locusId: string,
    now = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      assertLocusMutationFence(current, fence)
      if (current.state !== 'switching' || current.busy || this.hasPendingDelivery(current.id, current.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} cannot abort permission mutation`)
      }
      const next = transitionLocus(current, 'active', now)
      const after = new Map(before).set(locusId, next)
      assertLocusSet(after)
      await this.persistLocusSet('permission-mutation-abort', before, after, { locusId })
      return next
    })
  }

  /** Atomically persist verified permission and move switching → active. */
  async commitPermissionMutation(
    locusId: string,
    permission: LocusPermission,
    now = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      assertLocusMutationFence(current, fence)
      if (current.state !== 'switching' || current.busy || this.hasPendingDelivery(current.id, current.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} does not hold an exclusive permission mutation`)
      }
      const permitted = withLocusPermission(current, permission, now, { allowSwitching: true })
      const next = transitionLocus(permitted, 'active', now)
      const after = new Map(before).set(locusId, next)
      assertLocusSet(after)
      await this.persistLocusSet(
        'locus-permission',
        before,
        after,
        { locusId, controlFenceReleased: true },
        this.permissionAuditChanges(next, permission, now),
      )
      return next
    })
  }

  /**
   * Build the append-only audit row for one accepted permission change.
   *
   * A refused escalation is recorded too: "asked for write, got read" is the
   * fact an owner needs, and omitting it would make a refusal invisible.
   * The sequence is derived from existing rows of this exact generation, so
   * ordering never depends on a clock and a replaced generation starts fresh.
   */
  private permissionAuditChanges(
    record: LocusRecord,
    requested: LocusPermission,
    now: number,
  ): readonly TableChange[] {
    const grantedBy = requested.grantedBy ?? record.permission.grantedBy
    // Without a Host-derived operator there is nothing auditable to record;
    // the permission change itself has already been fenced by its caller.
    if (grantedBy === undefined || grantedBy.trim() === '') return []
    const prefix = `${record.id}\u0000${String(record.generation)}\u0000`
    let sequence = 1
    for (const [key] of this.domain.table('locus_permission_audit').entries()) {
      if (!key.startsWith(prefix)) continue
      const parsed = Number(key.slice(prefix.length))
      if (Number.isSafeInteger(parsed) && parsed >= sequence) sequence = parsed + 1
    }
    const refused = requested.desired !== record.permission.effective
    return [{
      table: 'locus_permission_audit',
      key: `${prefix}${String(sequence)}`,
      value: {
        id: `${prefix}${String(sequence)}`,
        locusId: record.id,
        generation: record.generation,
        sequence,
        desired: requested.desired,
        effective: record.permission.effective,
        grantedBy,
        verifiedAt: record.permission.verifiedAt ?? now,
        ...(refused
          ? { refusedReason: `requested ${requested.desired}, host verified ${record.permission.effective}` }
          : {}),
      },
    }]
  }

  /** Read the append-only permission history of one locus generation. */
  listPermissionAudit(locusId: string, generation: number): readonly PetLocusPermissionAudit[] {
    const prefix = `${locusId}\u0000${String(generation)}\u0000`
    return [...this.domain.table('locus_permission_audit').entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value)
      .sort((left, right) => left.sequence - right.sequence)
  }

  /**
   * Persist owner-confirmed context facts for the exact current generation.
   *
   * The owner-facing adapter binds `locusId` and endpoint before calling this
   * method. No value here changes endpoint, parent, workspace or permission;
   * in particular a path string is never promoted into authorization.
   */
  async confirmContextAnchor(
    locusId: string,
    anchor: Omit<LocusContextAnchor, 'authorization' | 'provenance' | 'confirmedAt'>,
    confirmedBy: string,
    now = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    return this.enqueue(async () => {
      const before = this.collectLoci()
      const current = before.get(locusId)
      if (current === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      assertLocusMutationFence(current, fence)
      if (current.state !== 'active') throw new LocusError('LOCUS_INVALID', `Locus ${locusId} is not active`)
      if (current.busy || this.hasPendingDelivery(current.id, current.generation)) {
        throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
      }
      assertIdentifier(confirmedBy, 'confirmedBy')
      const contextAnchor = {
        ...anchor,
        // Explicit owner confirmation records provenance, but deliberately
        // cannot grant filesystem authority. Policy verification is separate.
        authorization: 'unknown' as const,
        provenance: `owner:${confirmedBy}`,
        confirmedAt: now,
      }
      const next = buildLocusRecord({
        ...current,
        revision: (current.revision ?? 0) + 1,
        contextAnchor,
        updatedAt: now,
      })
      const after = new Map(before).set(locusId, next)
      assertLocusSet(after)
      await this.persistLocusSet('locus-context-anchor', before, after, { locusId })
      return next
    })
  }

  /** Desired/effective mode convenience wrapper. */
  async setLocusMode(
    locusId: string,
    mode: LocusPermissionMode,
    grantedBy?: string,
    verifiedAt = Date.now(),
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> {
    const current = this.getRequiredLocus(locusId)
    if (current.busy || this.hasPendingDelivery(current.id, current.generation)) {
      throw new LocusError('LOCUS_BUSY', `Locus ${locusId} has pending Delivery work`)
    }
    const permission: LocusPermission = {
      desired: mode,
      effective: mode,
      verifiedAt,
      ...(grantedBy !== undefined ? { grantedBy } : {}),
    }
    return this.setLocusPermission(current.id, permission, verifiedAt, fence)
  }

  /**
   * Set the independent default-Q&A pointer. A second different pointer is a
   * conflict; repeating the same pointer is idempotent.
   */
  async setDefaultQaLocus(parentSessionId: string, locusId: string): Promise<LocusRecord> {
    return this.enqueue(async () => {
      assertIdentifier(parentSessionId, 'parentSessionId')
      assertIdentifier(locusId, 'locusId')
      const beforeLoci = this.collectLoci()
      const locus = beforeLoci.get(locusId)
      if (locus === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
      if (locus.parentSessionId !== parentSessionId) {
        throw new LocusError('PARENT_WORKSPACE_CONFLICT', 'Default Q&A locus belongs to another parent session')
      }
      if (locus.source !== 'qa-created' || locus.parentLocusId !== undefined) {
        throw new LocusError('INVALID_LOCUS', 'Only a chat-level qa-created locus can be the default Q&A entry')
      }
      if (!isCurrentLocusState(locus.state)) {
        throw new LocusError('LOCUS_INVALID', 'A retired locus cannot be the default Q&A entry')
      }
      const defaults = this.collectDefaultPointers()
      const previous = defaults.get(parentSessionId)
      if (previous !== undefined && previous !== locusId) {
        throw new LocusError('DEFAULT_QA_CONFLICT', `Parent ${parentSessionId} already has default Q&A ${previous}`)
      }
      defaults.set(parentSessionId, locusId)
      const indexesBefore = this.deriveIndexes(beforeLoci, this.collectDefaultPointers())
      const indexesAfter = this.deriveIndexes(beforeLoci, defaults)
      await this.persistIndexSet('locus-default-qa', indexesBefore, indexesAfter, {
        locusId,
        endpointKey: endpointKeyOf(locus.endpoint),
        parentSessionId,
        workspaceId: locus.workspaceId,
        ...(locus.childSessionId !== undefined ? { childSessionId: locus.childSessionId } : {}),
      })
      return locus
    })
  }

  setDefaultQa(parentSessionId: string, locusId: string): Promise<LocusRecord> {
    return this.setDefaultQaLocus(parentSessionId, locusId)
  }

  /** Clear a default pointer without touching the locus itself. */
  async clearDefaultQaLocus(parentSessionId: string, locusId?: string): Promise<boolean> {
    return this.enqueue(async () => {
      const defaults = this.collectDefaultPointers()
      const current = defaults.get(parentSessionId)
      if (current === undefined) return false
      if (locusId !== undefined && locusId !== current) return false
      const before = this.deriveIndexes(this.collectLoci(), defaults)
      defaults.delete(parentSessionId)
      const after = this.deriveIndexes(this.collectLoci(), defaults)
      await this.persistIndexSet('locus-default-qa-clear', before, after, {
        oldLocusId: current,
        parentSessionId,
      })
      return true
    })
  }

  // -- Delivery records -----------------------------------------------------

  /** Get a durable Delivery by id. */
  getDelivery(deliveryId: string): DeliveryRecord | undefined {
    return this.deliveries().get(deliveryId) as unknown as DeliveryRecord | undefined
  }

  /**
   * Find a Delivery by its exact DSH inbox message identity.
   *
   * A historical duplicate is durable corruption: returning an arbitrary first
   * match would bind a trusted inbox claim to the wrong platform message.
   */
  findDeliveryByInboxMessageId(inboxMessageId: string): DeliveryRecord | undefined {
    assertIdentifier(inboxMessageId, 'inboxMessageId')
    const matches = this.listDeliveries().filter(record => record.inboxMessageId === inboxMessageId)
    if (matches.length > 1) {
      throw new LocusError('INVALID_LOCUS', `Inbox message ${inboxMessageId} is attached to multiple Deliveries`)
    }
    return matches[0]
  }

  /** Find a Delivery by the platform message idempotency key. */
  findDeliveryByMessage(messageId: string): DeliveryRecord | undefined {
    assertIdentifier(messageId, 'messageId')
    for (const [, value] of this.deliveries().entries()) {
      const record = value as unknown as DeliveryRecord
      if (record.messageId === messageId) return record
    }
    return undefined
  }

  findDeliveryByMessageId(messageId: string): DeliveryRecord | undefined {
    return this.findDeliveryByMessage(messageId)
  }

  /** List deliveries in acceptance order. */
  listDeliveries(locusId?: string): readonly DeliveryRecord[] {
    const records = [...this.deliveries().entries()]
      .map(([, value]) => value as unknown as DeliveryRecord)
      .filter(record => locusId === undefined || record.locusId === locusId)
    return records.sort((left, right) => left.sequence - right.sequence)
  }

  /**
   * Accept one message exactly once. Initialization, GUI turns, and parent
   * clarification must not call this method: they have no locus Delivery.
   */
  async acceptDelivery(input: DeliveryInput): Promise<LocusDeliveryAcceptance> {
    return this.enqueue(async () => {
      assertDeliveryInput(input)
      const duplicate = this.findDeliveryByMessage(input.messageId)
      if (duplicate !== undefined) {
        const conflict = !deliveryCorrelates(duplicate, input)
        return { record: duplicate, duplicate: true, conflict }
      }
      const locus = this.getLocus(input.locusId)
      if (locus === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${input.locusId} does not exist`)
      if (!isCurrentLocusState(locus.state) || locus.state !== 'active') {
        throw new LocusError('LOCUS_INVALID', `Locus ${input.locusId} is not active`)
      }
      if (this.getSwitchNotice(locus.id, locus.generation) !== undefined) {
        throw new LocusError('LOCUS_INVALID', `Locus ${input.locusId} has a pending source-switch notice`)
      }
      if (locus.childSessionId !== input.childSessionId) {
        throw new LocusError('CHILD_OCCUPIED', 'Delivery child does not match the locus child')
       }
       if (endpointKeyOf(locus.endpoint) !== endpointKeyOf(input.endpoint)) {
         throw new LocusError('INVALID_ENDPOINT', 'Delivery endpoint does not match the active locus')
       }
       if (locus.generation !== input.generation) {
         throw new LocusError('LOCUS_INVALID', 'Delivery generation does not match the active locus')
      }
      const normalizedEndpoint = normalizeLocusEndpoint(input.endpoint).endpoint
       const sequence = this.nextDeliverySequence()
       const rootMessageId = input.rootMessageId ?? input.replyTarget?.rootMessageId
      const feedbackTarget: DeliveryFeedbackTarget = Object.freeze({
        chatId: normalizedEndpoint.chatId,
        ...(normalizedEndpoint.threadId !== undefined ? { threadId: normalizedEndpoint.threadId } : {}),
        messageId: input.messageId,
         ...(rootMessageId !== undefined ? { rootMessageId } : {}),
      })
      const record: DeliveryRecord = Object.freeze({
        deliveryId: input.deliveryId ?? `delivery-${sequence}`,
        messageId: input.messageId,
         ...(rootMessageId !== undefined ? { rootMessageId } : {}),
        endpoint: Object.freeze(normalizedEndpoint),
        locusId: input.locusId,
        generation: input.generation,
        childSessionId: input.childSessionId,
        // Schema requires senderOpenId for every accepted platform Delivery.
        // The controller always supplies the verified admission sender; reject
        // direct adapters that would otherwise create an unreadable row.
        ...(input.senderOpenId !== undefined ? { senderOpenId: input.senderOpenId } : {}),
        ...(input.senderName !== undefined ? { senderName: input.senderName } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.replyTarget !== undefined ? { replyTarget: Object.freeze({ ...input.replyTarget }) } : {}),
        ...(input.replyToMessageId !== undefined ? { replyToMessageId: input.replyToMessageId } : {}),
        sequence,
        status: 'accepted',
        feedbackTarget,
        ...(input.acceptedAt !== undefined ? { acceptedAt: input.acceptedAt } : {}),
      })
      if (this.getDelivery(record.deliveryId) !== undefined) {
        throw new LocusError('INVALID_LOCUS', `Delivery id ${record.deliveryId} already exists`)
      }
      const busyAt = Math.max(input.acceptedAt ?? Date.now(), locus.updatedAt)
      const busyLocus = locus.busy ? undefined : withLocusBusy(locus, true, busyAt)
      await this.persistDeliveryMutation('delivery-accept', undefined, record, {
        deliveryId: record.deliveryId,
        locusId: record.locusId,
        endpointKey: endpointKeyOf(record.endpoint),
        newLocusId: locus.id,
        expectedRevision: locus.revision ?? locus.updatedAt,
        parentSessionId: locus.parentSessionId,
        ...(locus.childSessionId !== undefined ? { childSessionId: locus.childSessionId } : {}),
        workspaceId: locus.workspaceId,
        chatId: record.endpoint.chatId,
        ...(record.endpoint.threadId !== undefined ? { threadId: record.endpoint.threadId } : {}),
      }, locus, busyLocus)
      return { record, duplicate: false, conflict: false }
    })
  }

  /** Alias for callers that use create terminology. */
  createDelivery(input: DeliveryInput): Promise<LocusDeliveryAcceptance> {
    return this.acceptDelivery(input)
  }

  /**
   * Restore one accepted, proof-free Delivery after startup reconciliation.
   * This is not a public admission path: queued/running/terminal execution
   * records must be recreated through the trusted queue/turn seams so message
   * and turn proofs cannot be forged.
   */
  async putDelivery(record: DeliveryRecord): Promise<DeliveryRecord> {
    return this.enqueue(async () => {
      assertDeliveryRecord(record)
      if (record.status !== 'accepted') {
        throw new LocusError('INVALID_LOCUS', 'Direct Delivery restoration only accepts proof-free accepted records')
      }
      if (record.executionId !== undefined || record.turnId !== undefined) {
        throw new LocusError('INVALID_LOCUS', 'Direct Delivery restoration cannot contain execution proof')
      }
      const locus = this.getLocus(record.locusId)
      if (locus === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${record.locusId} does not exist`)
      if (locus.state !== 'active' || !isCurrentLocusState(locus.state)) {
        throw new LocusError('LOCUS_INVALID', `Locus ${record.locusId} is not active`)
      }
      if (locus.generation !== record.generation || locus.childSessionId !== record.childSessionId) {
        throw new LocusError('CHILD_OCCUPIED', 'Delivery does not match the active locus generation/child')
      }
      if (endpointKeyOf(locus.endpoint) !== endpointKeyOf(record.endpoint)) {
        throw new LocusError('INVALID_ENDPOINT', 'Delivery endpoint does not match the active locus')
      }
      const existingByMessage = this.findDeliveryByMessage(record.messageId)
      if (existingByMessage !== undefined && existingByMessage.deliveryId !== record.deliveryId) {
        if (deliveryCorrelates(existingByMessage, record)) return existingByMessage
        throw new LocusError('INVALID_LOCUS', `Message ${record.messageId} is already attached to another delivery`)
      }
      const existing = this.getDelivery(record.deliveryId)
      if (existing !== undefined && !recordsEqual(existing, record)) {
        throw new LocusError('INVALID_LOCUS', `Delivery ${record.deliveryId} already exists`)
      }
      if (existing !== undefined) return existing
      const pending = ACTIVE_BUSY_DELIVERY_STATUSES.has(record.status)
      const busyAt = Math.max(record.acceptedAt ?? Date.now(), locus.updatedAt)
      const busyLocus = pending && !locus.busy ? withLocusBusy(locus, true, busyAt) : undefined
      await this.persistDeliveryMutation('delivery-create', undefined, record, {
        operation: 'create-delivery',
        deliveryId: record.deliveryId,
        locusId: record.locusId,
        endpointKey: endpointKeyOf(record.endpoint),
        newLocusId: locus.id,
        expectedRevision: locus.revision ?? locus.updatedAt,
        parentSessionId: locus.parentSessionId,
        ...(locus.childSessionId !== undefined ? { childSessionId: locus.childSessionId } : {}),
        workspaceId: locus.workspaceId,
        chatId: record.endpoint.chatId,
        ...(record.endpoint.threadId !== undefined ? { threadId: record.endpoint.threadId } : {}),
      }, locus, busyLocus)
      return record
    })
  }

  /** Apply one legal progress or terminal Delivery transition. */
  async transitionDelivery(
    deliveryId: string,
    status: DeliveryStatus,
    options: {
      readonly correlation?: DeliveryCorrelation
      readonly at?: number
      readonly failureReason?: string
      readonly executionId?: string
      readonly turnId?: string
    } = {},
  ): Promise<LocusDeliveryMutation> {
    return this.enqueue(async () => {
      const current = this.getDelivery(deliveryId)
      if (current === undefined) return mutation(undefined, false, 'unknown-delivery')
      if (options.correlation !== undefined && !deliveryCorrelates(current, options.correlation)) {
        return mutation(current, false, 'correlation-mismatch')
      }
      if (current.status === status) return mutation(current, false, 'already-in-state')
      if (TERMINAL_DELIVERY_STATUSES.has(current.status)) {
        return mutation(current, false, 'already-terminal')
      }
      if (TERMINAL_DELIVERY_STATUSES.has(status)) {
         if (options.executionId === undefined || options.turnId === undefined) {
           return mutation(current, false, 'execution-proof-required')
         }
         if (
           current.executionId !== options.executionId ||
           current.turnId !== options.turnId ||
           options.correlation === undefined ||
           !('turnId' in options.correlation) ||
           options.correlation.turnId !== options.turnId
         ) {
           return mutation(current, false, 'correlation-mismatch')
         }
       }
       if (!DELIVERY_TRANSITIONS[current.status].includes(status)) {
        return mutation(current, false, 'invalid-transition')
      }
      const next: DeliveryRecord = Object.freeze({
        ...current,
        status,
        ...(options.executionId !== undefined ? { executionId: options.executionId } : {}),
        ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
        ...(status === 'queued' && options.at !== undefined ? { queuedAt: options.at } : {}),
        ...(status === 'running' && options.at !== undefined ? { startedAt: options.at } : {}),
        ...(status === 'settled' && options.at !== undefined ? { settledAt: options.at } : {}),
        ...(status === 'failed' && options.at !== undefined ? { failedAt: options.at } : {}),
        ...(status === 'failed' && options.failureReason !== undefined
          ? { failureReason: options.failureReason }
          : {}),
      })
      await this.persistDeliveryMutation(`delivery-${status}`, current, next, {
        operation: `delivery-${status}`,
        deliveryId,
        locusId: current.locusId,
        endpointKey: endpointKeyOf(current.endpoint),
      })
      return mutation(next, true)
    })
  }

  /** Strict terminal settlement: delivery, execution and turn must all match. */
  async settleByTurn(input: {
    readonly deliveryId: string
    readonly executionId: string
    readonly correlation: DeliveryTurnCorrelation
    readonly outcome: DeliveryOutcome
    readonly settledAt: number
    readonly failureReason?: string
  }): Promise<LocusDeliveryMutation> {
    return this.enqueue(async () => {
      assertIdentifier(input.deliveryId, 'deliveryId')
      assertIdentifier(input.executionId, 'executionId')
      assertCorrelation(input.correlation)
      assertIdentifier(input.correlation.turnId, 'turnId')
      if (input.outcome !== 'settled' && input.outcome !== 'failed') {
        throw new LocusError('INVALID_LOCUS', `Unknown Delivery outcome ${String(input.outcome)}`)
      }
      assertTimestamp(input.settledAt, 'settledAt')
      const current = this.getDelivery(input.deliveryId)
      if (current === undefined) return mutation(undefined, false, 'unknown-delivery')
      if (!deliveryCorrelates(current, input.correlation) || current.executionId !== input.executionId || current.turnId !== input.correlation.turnId) {
        return mutation(current, false, 'correlation-mismatch')
      }
      if (current.status === input.outcome) return mutation(current, false, 'already-in-state')
      if (TERMINAL_DELIVERY_STATUSES.has(current.status)) return mutation(current, false, 'already-terminal')
      if (current.status !== 'running') return mutation(current, false, 'invalid-transition')
      if (input.settledAt < (current.startedAt ?? current.queuedAt ?? current.acceptedAt ?? 0)) {
        throw new LocusError('INVALID_LOCUS', 'settledAt must not precede prior Delivery timestamps')
      }
      const next: DeliveryRecord = Object.freeze({
        ...current,
        status: input.outcome,
        executionId: input.executionId,
        turnId: input.correlation.turnId,
        ...(input.outcome === 'settled' ? { settledAt: input.settledAt } : { failedAt: input.settledAt }),
        ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
      })
      const locus = this.getLocus(current.locusId)
      const afterLocus = locus !== undefined && locus.busy && !this.hasPendingDelivery(current.locusId, current.generation, current.deliveryId)
        ? withLocusBusy(locus, false, Math.max(input.settledAt, locus.updatedAt))
        : undefined
      await this.persistDeliveryMutation(`delivery-${input.outcome}`, current, next, {
        operation: `delivery-${input.outcome}`,
        deliveryId: input.deliveryId,
        locusId: current.locusId,
        endpointKey: endpointKeyOf(current.endpoint),
      }, locus, afterLocus)
      return mutation(next, true)
    })
  }

  /** Bind the trusted child turn identity before terminal settlement. */
  async bindTurn(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly turnId: string
    readonly startedAt?: number
  }): Promise<DeliveryRecord | undefined> {
    return this.enqueue(async () => {
      assertIdentifier(input.executionId, 'executionId')
      assertIdentifier(input.turnId, 'turnId')
      assertCorrelation(input.correlation)
      const current = this.getDelivery(input.deliveryId)
      if (current === undefined || !deliveryCorrelates(current, input.correlation)) return undefined
      if (current.executionId !== input.executionId) return undefined
      if (current.turnId !== undefined && current.turnId !== input.turnId) return undefined
      if (TERMINAL_DELIVERY_STATUSES.has(current.status)) return current
      if (current.status === 'running' && current.turnId === input.turnId) return current
      if (input.startedAt !== undefined && current.queuedAt !== undefined && input.startedAt < current.queuedAt) {
        throw new LocusError('INVALID_LOCUS', 'startedAt must not precede queuedAt')
      }
      if (current.status !== 'queued') return undefined
      const next: DeliveryRecord = Object.freeze({
        ...current,
        executionId: input.executionId,
        turnId: input.turnId,
        status: 'running',
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      })
      if (recordsEqual(current, next)) return current
      await this.persistDeliveryMutation('delivery-running', current, next, {
        deliveryId: input.deliveryId,
        locusId: current.locusId,
        endpointKey: endpointKeyOf(current.endpoint),
      })
      return next
    })
  }

  /** Strict settlement requires an explicit Delivery id and turn proof. */
  async settleDelivery(
    input: DeliverySettlementInput & { readonly deliveryId: string },
  ): Promise<LocusDeliveryMutation> {
    if (input.settledAt === undefined) throw new LocusError('INVALID_LOCUS', 'settledAt is required for terminal settlement')
    return this.settleByTurn({ ...input, settledAt: input.settledAt })
  }

  /** Bind a queued child turn to its exact execution token. */
  async bindQueued(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly inboxMessageId: string
    readonly queuedAt?: number
  }): Promise<DeliveryRecord | undefined> {
    return this.enqueue(async () => {
      assertIdentifier(input.executionId, 'executionId')
      assertIdentifier(input.inboxMessageId, 'inboxMessageId')
      assertCorrelation(input.correlation)
      const current = this.getDelivery(input.deliveryId)
      if (current === undefined || !deliveryCorrelates(current, input.correlation)) return undefined
      if (
        current.status === 'queued' &&
        current.executionId === input.executionId &&
        current.inboxMessageId === input.inboxMessageId
      ) return current
      if (input.queuedAt !== undefined && current.acceptedAt !== undefined && input.queuedAt < current.acceptedAt) {
        throw new LocusError('INVALID_LOCUS', 'queuedAt must not precede acceptedAt')
      }
      if (current.status !== 'accepted' || current.executionId !== undefined) return undefined
      const inboxMatches = this.listDeliveries().filter(record =>
        record.deliveryId !== current.deliveryId && record.inboxMessageId === input.inboxMessageId,
      )
      if (inboxMatches.length > 0) {
        throw new LocusError('INVALID_LOCUS', `Inbox message ${input.inboxMessageId} is already attached to another Delivery`)
      }
      const next: DeliveryRecord = Object.freeze({
        ...current,
        executionId: input.executionId,
        inboxMessageId: input.inboxMessageId,
        status: 'queued',
        queuedAt: input.queuedAt ?? Date.now(),
      })
      await this.persistDeliveryMutation('delivery-queued', current, next, {
        deliveryId: input.deliveryId,
        locusId: current.locusId,
        endpointKey: endpointKeyOf(current.endpoint),
      })
      return next
    })
  }

  async markQueued(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly inboxMessageId: string
    readonly queuedAt?: number
  }): Promise<DeliveryRecord | undefined> {
    return this.bindQueued(input)
  }

  /**
   * Persist a definitive Host refusal before a child turn starts.
   *
   * The exact Delivery id/correlation and, for queued rows, execution token are
   * required. This is terminal dispatch evidence; it deliberately records no
   * turn id and never promotes an ambiguous/unknown queue outcome to failed.
   */
  async failBeforeDispatch(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly reason: string
    readonly executionId?: string
    readonly failedAt?: number
  }): Promise<boolean> {
    return this.enqueue(async () => {
      assertIdentifier(input.deliveryId, 'deliveryId')
      assertCorrelation(input.correlation)
      assertIdentifier(input.reason, 'reason')
      if (input.executionId !== undefined) assertIdentifier(input.executionId, 'executionId')
      if (input.failedAt !== undefined) assertTimestamp(input.failedAt, 'failedAt')
      const current = this.getDelivery(input.deliveryId)
      if (current === undefined || !deliveryCorrelates(current, input.correlation)) return false
      if (current.status === 'failed' && current.dispatchFailure !== undefined) return true
      if (current.status !== 'accepted' && current.status !== 'queued') return false
      if (current.status === 'queued') {
        if (input.executionId === undefined || current.executionId !== input.executionId) return false
      } else if (current.executionId !== undefined || current.inboxMessageId !== undefined) {
        return false
      }
      const failedAt = Math.max(
        input.failedAt ?? Date.now(),
        current.queuedAt ?? current.acceptedAt ?? 0,
      )
      const next: DeliveryRecord = Object.freeze({
        ...current,
        status: 'failed',
        dispatchFailure: current.status === 'queued' ? 'queued-not-started' : 'not-queued',
        failedAt,
        failureReason: input.reason,
      })
      const locus = this.getLocus(current.locusId)
      const afterLocus = locus !== undefined && locus.busy &&
          !this.hasPendingDelivery(current.locusId, current.generation, current.deliveryId)
        ? withLocusBusy(locus, false, Math.max(failedAt, locus.updatedAt))
        : undefined
      await this.persistDeliveryMutation('delivery-dispatch-failed', current, next, {
        operation: 'delivery-dispatch-failed',
        deliveryId: current.deliveryId,
        locusId: current.locusId,
        endpointKey: endpointKeyOf(current.endpoint),
      }, locus, afterLocus)
      return true
    })
  }

  async fail(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly reason: string
    readonly executionId?: string
  }): Promise<boolean> {
    return this.failBeforeDispatch(input)
  }

  /** Settle one uniquely matching running Delivery in an exact proof scope. */
  async settleNextDelivery(
    input: DeliveryTurnCorrelation & {
      readonly outcome: DeliveryOutcome
      readonly settledAt: number
      readonly failureReason?: string
      readonly executionId: string
      readonly turnId: string
    },
  ): Promise<LocusDeliveryMutation> {
    assertIdentifier(input.executionId, 'executionId')
    assertIdentifier(input.turnId, 'turnId')
    assertCorrelation(input)
    const matches = this.listDeliveries().filter(record =>
      record.status === 'running' &&
      deliveryCorrelates(record, input) &&
      record.executionId === input.executionId &&
      record.turnId === input.turnId,
    )
    if (matches.length !== 1) {
      return mutation(undefined, false, matches.length === 0 ? 'no-pending-delivery' : 'correlation-mismatch')
    }
    return this.settleByTurn({
      deliveryId: matches[0]!.deliveryId,
      executionId: input.executionId,
      correlation: input,
      outcome: input.outcome,
      settledAt: input.settledAt,
      ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
    })
  }

  /**
   * Resolve the one current pending Delivery for a caller-bound child.
   *
   * A child/locus/generation tuple is the minimum safe scope. If more than one
   * pending row matches, do not pick an arbitrary FIFO row: the caller-bound
   * context surface must omit the Delivery until a Host turn proof disambiguates
   * it. Terminal rows are deliberately excluded.
   */
  findCurrentDelivery(input: {
    readonly childSessionId: string
    readonly locusId: string
    readonly generation: number
    readonly executionId?: string
    readonly turnId?: string
  }): LocusCurrentDelivery | undefined {
    assertIdentifier(input.childSessionId, 'childSessionId')
    assertIdentifier(input.locusId, 'locusId')
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
      throw new LocusError('INVALID_LOCUS', 'generation must be a positive safe integer')
    }
    if (input.executionId === undefined || input.turnId === undefined) return undefined
    assertIdentifier(input.executionId, 'executionId')
    assertIdentifier(input.turnId, 'turnId')
    const matches = this.listDeliveries().filter(record =>
      PENDING_DELIVERY_STATUSES.has(record.status) &&
      record.childSessionId === input.childSessionId &&
      record.locusId === input.locusId &&
      record.generation === input.generation &&
      record.executionId === input.executionId &&
      record.turnId === input.turnId,
    )
    if (matches.length !== 1) return undefined
    const record = matches[0]!
    return {
      deliveryId: record.deliveryId,
      messageId: record.messageId,
      endpoint: { ...record.endpoint },
      locusId: record.locusId,
      generation: record.generation,
      childSessionId: record.childSessionId,
      status: record.status,
      ...(record.senderOpenId !== undefined ? { senderOpenId: record.senderOpenId } : {}),
      ...(record.senderName !== undefined ? { senderName: record.senderName } : {}),
      ...(record.text !== undefined ? { text: record.text } : {}),
      ...(record.replyToMessageId !== undefined
        ? { replyToMessageId: record.replyToMessageId }
        : {}),
      ...(record.replyTarget !== undefined ? { replyTarget: { ...record.replyTarget } } : {}),
    }
  }

  /** Find the oldest unsettled Delivery for one exact correlation tuple. */
  findOldestPendingDelivery(correlation: DeliveryCorrelation): DeliveryRecord | undefined {
    assertCorrelation(correlation)
    let oldest: DeliveryRecord | undefined
    for (const record of this.listDeliveries()) {
      if (!PENDING_DELIVERY_STATUSES.has(record.status)) continue
      if (!deliveryCorrelates(record, correlation)) continue
      if (oldest === undefined || record.sequence < oldest.sequence) oldest = record
    }
    return oldest
  }

  // -- operation records ----------------------------------------------------

  getOperation(operationId: string): LocusOperation | undefined {
    return this.operations().get(operationId)
  }

  listOperations(): readonly LocusOperation[] {
    return [...this.operations().entries()]
      .map(([, value]) => value)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /** Incomplete/manual operation rows are visible for recovery. */
  listRecoverableOperations(): readonly LocusOperation[] {
    return this.listOperations().filter(operation =>
      operation.phase === 'prepared' ||
      operation.phase === 'provisioning' ||
      operation.phase === 'publishing' ||
      operation.phase === 'compensating' ||
      operation.phase === 'failed' ||
      operation.phase === 'needs-recovery',
    )
  }

  /** Explicit endpoint creation debts exposed to controllers and diagnostics. */
  listBlockingProvisioningOperations(): readonly LocusOperation[] {
    return this.listOperations().filter(operation =>
      operation.provisioningIntentHash !== undefined &&
      operation.phase !== 'committed' &&
      operation.phase !== 'compensated',
    )
  }

  /**
   * Deliveries which were accepted but did not reach a terminal state.
   *
   * These are evidence for the Host's restart policy, not permission to resume
   * a child or replay a message. The original correlation and feedback target
   * remain intact so an outer coordinator can make an explicit decision.
   */
  listPendingDeliveries(locusId?: string): readonly DeliveryRecord[] {
    return this.listDeliveries(locusId).filter(record => PENDING_DELIVERY_STATUSES.has(record.status))
  }

  /** Explicit recovery spelling for callers building a startup report. */
  listRecoverableDeliveries(locusId?: string): readonly DeliveryRecord[] {
    return this.listPendingDeliveries(locusId)
  }

  /**
   * Deterministically dispose interrupted work before channel intake starts.
   *
   * This method never queues a prompt, recreates a resource, or sends business
   * output. Accepted-but-unqueued work is failed immediately. Queued/running
   * work is retained only with exact live-turn proof; otherwise the Host must
   * first terminate the old child execution. If termination cannot be proven,
   * the Delivery remains pending/busy with explicit durable manual debt.
   *
   * Unpublished provisioning resources are compensated only from durable
   * operation-owned refs. Missing ownership/capability or cleanup failure is
   * persisted as `needs-recovery`, which also blocks a new provisioning begin
   * for the endpoint.
   */
  async reconcileStartup(options: LocusStartupRecoveryOptions = {}): Promise<LocusStartupRecoveryReport> {
    return this.enqueue(async () => {
      const requireTransaction = (): NonNullable<LocusDomain['transaction']> =>
        this.requireProvisioningTransaction('reconcileStartup')
      const now = options.now ?? Date.now()
      const failedDeliveries: DeliveryRecord[] = []
      const retainedDeliveries: DeliveryRecord[] = []
      const manualDeliveries: DeliveryRecord[] = []
      const compensatedOperations: LocusOperation[] = []
      const manualOperations: LocusOperation[] = []
      const initialLoci = this.collectLoci()
      assertLocusSet(initialLoci)
      const initialIndexes = this.collectIndexes()
      const initialExpectedIndexes = preserveEquivalentIndexTimestamps(
        initialIndexes,
        deriveIndexes(initialLoci, this.collectDefaultPointers(initialIndexes), now),
      )
      const initialIndexChanges = diffIndexTable(initialIndexes, initialExpectedIndexes)
      if (initialIndexChanges.length > 0) {
        const transaction = requireTransaction()
        await transaction.call(this.domain, tx => {
          for (const change of initialIndexChanges) {
            if (change.value === undefined) tx.delete(change.table, change.key)
            else tx.put(change.table, change.key, change.value)
          }
        })
      }

      const writeDelivery = async (
        current: DeliveryRecord,
        next: DeliveryRecord,
        invalidateLocus: boolean,
      ): Promise<void> => {
        const loci = this.collectLoci()
        const locus = loci.get(current.locusId)
        const remaining = this.listPendingDeliveries(current.locusId).some(item =>
          item.deliveryId !== current.deliveryId && item.generation === current.generation,
        )
        let nextLocus: LocusRecord | undefined
        if (locus !== undefined && locus.generation === current.generation) {
          if (invalidateLocus && locus.state === 'active') {
            const idle = locus.busy
              ? withLocusBusy(locus, false, Math.max(now, locus.updatedAt))
              : locus
            nextLocus = transitionLocus(idle, 'invalid', Math.max(now, idle.updatedAt), {
              invalidReason: '启动恢复已终止无法证明可恢复的旧子会话执行；需要所有者显式重建。',
            })
          } else if (!remaining && locus.busy && !PENDING_DELIVERY_STATUSES.has(next.status)) {
            nextLocus = withLocusBusy(locus, false, Math.max(now, locus.updatedAt))
          }
        }
        const changes: TableChange[] = [{ table: 'locus_deliveries', key: next.deliveryId, value: next }]
        if (nextLocus !== undefined) {
          const after = new Map(loci).set(nextLocus.id, nextLocus)
          changes.push(
            ...diffLocusTable(loci, after),
            ...diffIndexTable(this.collectIndexes(), this.deriveIndexes(after, this.collectDefaultPointers(), now)),
          )
        }
        const transaction = requireTransaction()
        await transaction.call(this.domain, tx => {
          for (const change of changes.filter(change => this.changesState(change))) {
            if (change.value === undefined) tx.delete(change.table, change.key)
            else tx.put(change.table, change.key, change.value)
          }
        })
      }

      for (const snapshot of this.listPendingDeliveries()) {
        const current = this.getDelivery(snapshot.deliveryId)
        if (current === undefined || !PENDING_DELIVERY_STATUSES.has(current.status)) continue
        if (current.status === 'accepted') {
          const failedAt = Math.max(now, current.acceptedAt ?? 0)
          const failed: DeliveryRecord = Object.freeze({
            ...current,
            status: 'failed',
            startupDisposition: 'unqueued',
            failureReason: 'Host restarted before the accepted Delivery was durably queued; work was not replayed.',
            failedAt,
          })
          await writeDelivery(current, failed, false)
          failedDeliveries.push(failed)
          continue
        }

        let proof: LocusStartupDeliveryProof | undefined
        try {
          proof = await options.deliveryProof?.(current)
        } catch {
          proof = undefined
        }
        const matchingProof = proof !== undefined &&
          proof.deliveryId === current.deliveryId &&
          proof.executionId === current.executionId &&
          (current.turnId === undefined || proof.turnId === current.turnId)
          ? proof
          : undefined
        if (matchingProof !== undefined) {
          let retained: DeliveryRecord = current
          if (current.status === 'queued') {
            const { startupRecoveryDebt: _debt, ...rest } = current
            retained = Object.freeze({
              ...rest,
              status: 'running',
              turnId: matchingProof.turnId,
              startedAt: Math.max(now, current.queuedAt ?? 0),
            })
            await writeDelivery(current, retained, false)
          }
          retainedDeliveries.push(retained)
          continue
        }

        let terminated = false
        try {
          if (options.terminateDelivery !== undefined) {
            await options.terminateDelivery(current)
            terminated = true
          }
        } catch {
          terminated = false
        }
        if (!terminated) {
          const debt = Object.freeze({
            ...current,
            startupRecoveryDebt: 'Exact live-turn proof and safe termination are unavailable; manual recovery is required.',
          })
          if (!recordsEqual(current, debt)) await writeDelivery(current, debt, false)
          manualDeliveries.push(debt)
          continue
        }
        const failedAt = Math.max(now, current.startedAt ?? current.queuedAt ?? current.acceptedAt ?? 0)
        const { startupRecoveryDebt: _debt, ...withoutDebt } = current
        const failed: DeliveryRecord = Object.freeze({
          ...withoutDebt,
          status: 'failed',
          startupDisposition: 'execution-unrecoverable',
          failureReason: 'Host restarted without exact recoverable turn proof; the old child execution was terminated and work was not replayed.',
          failedAt,
        })
        await writeDelivery(current, failed, true)
        failedDeliveries.push(failed)
      }

      const saveOperation = async (operation: PetLocusOperation): Promise<void> => {
        const transaction = requireTransaction()
        await transaction.call(this.domain, tx => { tx.put('locus_operations', operation.id, operation) })
      }
      for (const snapshot of this.listRecoverableOperations()) {
        let operation = this.getOperation(snapshot.id)
        if (operation === undefined || operation.provisioningIntentHash === undefined) {
          if (operation !== undefined) manualOperations.push(operation)
          continue
        }
        if (operation.phase === 'needs-recovery' && operation.manualRecoveryReason !== undefined) {
          manualOperations.push(operation)
          continue
        }
        const refs = operation.resourceRefs ?? {}
        const required: Array<'chat' | 'child-session' | 'main-session'> = []
        // Only Q&A provisioning owns a created chat. Group/topic endpoint chats
        // pre-exist and must never be deleted as compensation.
        if (operation.operation === 'provisioning:qa' && refs.chatId !== undefined) required.push('chat')
        if (refs.childSessionId !== undefined) required.push('child-session')
        if (refs.mainSessionId !== undefined) required.push('main-session')
        const completed = new Set(operation.compensatedResources ?? [])
        operation = {
          ...operation,
          phase: 'compensating',
          attempts: operation.attempts + 1,
          manualRecoveryReason: undefined,
          updatedAt: Math.max(now, operation.updatedAt),
        }
        await saveOperation(operation)
        let manualReason: string | undefined
        for (const resource of required) {
          if (completed.has(resource)) continue
          try {
            if (resource === 'chat') {
              if (options.compensators?.chat === undefined || refs.chatId === undefined) throw new Error('chat compensator unavailable')
              await options.compensators.chat({ chatId: refs.chatId, operationId: operation.id })
            } else if (resource === 'child-session') {
              const parentSessionId = refs.parentSessionId ?? refs.mainSessionId
              if (options.compensators?.childSession === undefined || refs.childSessionId === undefined || parentSessionId === undefined) {
                throw new Error('child-session ownership or compensator unavailable')
              }
              await options.compensators.childSession({
                parentSessionId,
                childSessionId: refs.childSessionId,
                operationId: operation.id,
              })
            } else {
              if (options.compensators?.mainSession === undefined || refs.mainSessionId === undefined) throw new Error('main-session compensator unavailable')
              await options.compensators.mainSession({ mainSessionId: refs.mainSessionId, operationId: operation.id })
            }
            completed.add(resource)
            operation = {
              ...operation,
              compensatedResources: [...completed],
              step: operation.step + 1,
              updatedAt: Math.max(now, operation.updatedAt),
            }
            await saveOperation(operation)
          } catch (error) {
            manualReason = error instanceof Error ? error.message : String(error)
            break
          }
        }
        if (manualReason === undefined) {
          operation = {
            ...operation,
            phase: 'compensated',
            compensatedResources: [...completed],
            completedAt: Math.max(now, operation.updatedAt),
            updatedAt: Math.max(now, operation.updatedAt),
          }
          await saveOperation(operation)
          compensatedOperations.push(operation)
        } else {
          operation = {
            ...operation,
            phase: 'needs-recovery',
            manualRecoveryReason: manualReason.slice(0, 500),
            lastError: manualReason.slice(0, 500),
            updatedAt: Math.max(now, operation.updatedAt),
          }
          await saveOperation(operation)
          manualOperations.push(operation)
        }
      }

      const beforeLoci = this.collectLoci()
      assertLocusSet(beforeLoci)
      const existingIndexes = this.collectIndexes()
      const expectedIndexes = preserveEquivalentIndexTimestamps(
        existingIndexes,
        deriveIndexes(beforeLoci, this.collectDefaultPointers(existingIndexes), now),
      )
      const changes = diffIndexTable(existingIndexes, expectedIndexes)
      if (changes.length > 0) {
        const transaction = requireTransaction()
        await transaction.call(this.domain, tx => {
          for (const change of changes) {
            if (change.value === undefined) tx.delete(change.table, change.key)
            else tx.put(change.table, change.key, change.value)
          }
        })
      }
      const pendingDeliveries = this.listPendingDeliveries()
      const recoverableOperations = this.listRecoverableOperations()
      const indexChanges = initialIndexChanges.length + changes.length
      return {
        indexStatus: indexChanges === 0 ? 'unchanged' : 'rebuilt',
        indexChanges,
        pendingDeliveries,
        recoverableOperations,
        failedDeliveries,
        retainedDeliveries,
        manualDeliveries,
        compensatedOperations,
        manualOperations,
        sideEffectsReplayed: false,
      }
    })
  }

  /** Alias for startup callers that prefer recovery terminology. */
  startupRecovery(options: LocusStartupRecoveryOptions = {}): Promise<LocusStartupRecoveryReport> {
    return this.reconcileStartup(options)
  }

  // -- domain table helpers -------------------------------------------------

  private loci(): LocusTable {
    return this.domain.table('loci')
  }

  private indexes(): IndexTable {
    return this.domain.table('locus_indexes')
  }

  private deliveries(): DeliveryTable {
    return this.domain.table('locus_deliveries')
  }

  private operations(): OperationTable {
    return this.domain.table('locus_operations')
  }

  private collectLoci(): Map<string, StoredLocus> {
    const records = new Map<string, StoredLocus>()
    for (const [key, value] of this.loci().entries()) {
      const record = value as StoredLocus
      if (key !== record.id) throw new LocusError('INVALID_LOCUS', `Locus table key ${key} does not match ${record.id}`)
      records.set(key, record)
    }
    return records
  }

  private collectIndexes(): Map<string, PetLocusIndex> {
    const indexes = new Map<string, PetLocusIndex>()
    for (const [key, value] of this.indexes().entries()) {
      if (key !== value.key) {
        throw new LocusError('INVALID_LOCUS', `Locus index table key ${key} does not match ${value.key}`)
      }
      indexes.set(key, value)
    }
    return indexes
  }

  private collectDefaultPointers(
    indexes: ReadonlyMap<string, PetLocusIndex> = this.collectIndexes(),
  ): Map<string, string> {
    const defaults = new Map<string, string>()
    for (const [key, value] of indexes) {
      if (value.kind !== 'default-qa') continue
      const parentSessionId = key.startsWith(LOCUS_INDEX_PREFIX.defaultQa)
        ? key.slice(LOCUS_INDEX_PREFIX.defaultQa.length)
        : key
      const locusId = value.locusIds[0]
      if (locusId !== undefined) defaults.set(parentSessionId, locusId)
    }
    return defaults
  }

  private deriveIndexes(
    loci: ReadonlyMap<string, StoredLocus>,
    defaults: ReadonlyMap<string, string>,
    now = Date.now(),
  ): Map<string, PetLocusIndex> {
    return deriveIndexes(loci, defaults, now)
  }

  private hasPendingDelivery(locusId: string, generation: number, excludingDeliveryId?: string): boolean {
    return this.listDeliveries().some(record =>
      record.deliveryId !== excludingDeliveryId &&
      record.locusId === locusId &&
      record.generation === generation &&
      ACTIVE_BUSY_DELIVERY_STATUSES.has(record.status),
    )
  }

  private nextDeliverySequence(): number {
    let next = 1
    for (const [, value] of this.deliveries().entries()) {
      const sequence = (value as unknown as DeliveryRecord).sequence
      if (Number.isSafeInteger(sequence) && sequence >= next) next = sequence + 1
    }
    return next
  }

  private getRequiredLocus(locusId: string): LocusRecord {
    const locus = this.getLocus(locusId)
    if (locus === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus ${locusId} does not exist`)
    return locus
  }

  private async persistLocusSet(
    kind: string,
    before: ReadonlyMap<string, StoredLocus>,
    after: ReadonlyMap<string, StoredLocus>,
    metadata: Record<string, unknown>,
    /** Extra rows that must land in the SAME commit as the locus change. */
    extra: readonly TableChange[] = [],
  ): Promise<void> {
    const defaults = this.collectDefaultPointers()
    const actualIndexes = this.collectIndexes()
    const beforeIndexes = this.deriveIndexes(before, defaults)
    const afterIndexes = this.deriveIndexes(after, defaults)
    const changes = [
      ...diffLocusTable(before, after),
      // Diff the actual durable index table, not an idealized projection. This
      // heals unrelated stale/missing pointers in the same durable mutation.
      ...diffIndexTable(actualIndexes, afterIndexes),
      ...extra,
    ]
    await this.persistChanges(kind, changes, metadata)
  }

  private async persistIndexSet(
    kind: string,
    before: ReadonlyMap<string, PetLocusIndex>,
    after: ReadonlyMap<string, PetLocusIndex>,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.persistChanges(kind, diffIndexTable(before, after), metadata)
  }

  private async persistChanges(
    kind: string,
    changes: readonly TableChange[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    // Preferred path: the locus records that must agree with each other land
    // in ONE transaction, so an interrupted process can never leave a group
    // stopped without its replacement, or an endpoint pointing at a locus
    // that was rolled back. The operation row commits with them, which is
    // also why it needs no separate "committed" write afterwards.
    const transaction = this.domain.supportsTransaction === true ? this.domain.transaction : undefined
    if (transaction !== undefined) {
      const operation = this.newOperation(kind, metadata)
      const now = Date.now()
      const effective = changes.filter(change => this.changesState(change))
      await transaction.call(this.domain, (tx) => {
        for (const change of effective) {
          if (change.value === undefined) tx.delete(change.table, change.key)
          else tx.put(change.table, change.key, change.value)
        }
        tx.put('locus_operations', operation.id, {
          ...operation,
          phase: 'committed',
          attempts: 1,
          completedAt: now,
          updatedAt: now,
        })
      })
      return
    }

    // Fallback for a medium without transactions: record the intent, apply in
    // order, and leave a recoverable operation row behind. This is NOT
    // equivalent — an interrupted process can leave a partial set — so the
    // unified locus capability requires the transactional path above.
    const operation = this.newOperation(kind, metadata)
    await this.operations().put(operation.id, operation)
    try {
      await this.applyChanges(changes)
      const committed: PetLocusOperation = {
        ...operation,
        phase: 'committed',
        attempts: operation.attempts + 1,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }
      await this.operations().put(operation.id, committed)
    } catch (error) {
      const failed: PetLocusOperation = {
        ...operation,
        phase: 'needs-recovery',
        attempts: operation.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      }
      // If the medium is failing globally this write may fail too. The original
      // mutation error remains the useful result for the caller.
      try {
        await this.operations().put(operation.id, failed)
      } catch {
        // Deliberately contained; a failed operation may be absent only when the
        // operation table itself rejected both the intent and the diagnostic.
      }
      throw error
    }
  }

  private async persistDeliveryMutation(
    kind: string,
    before: DeliveryRecord | undefined,
    after: DeliveryRecord,
    metadata: Record<string, unknown>,
    beforeLocus?: LocusRecord,
    afterLocus?: LocusRecord,
  ): Promise<void> {
    const beforeLoci = beforeLocus === undefined ? undefined : this.collectLoci()
    const afterLoci = beforeLoci === undefined || afterLocus === undefined
      ? undefined
      : new Map(beforeLoci).set(afterLocus.id, afterLocus)
    const changes: TableChange[] = [
      {
        table: 'locus_deliveries',
        key: after.deliveryId,
        value: after,
      },
    ]
    if (beforeLoci !== undefined && afterLoci !== undefined) {
      const defaults = this.collectDefaultPointers()
      changes.push(
        ...diffLocusTable(beforeLoci, afterLoci),
        ...diffIndexTable(this.collectIndexes(), this.deriveIndexes(afterLoci, defaults)),
      )
    }
    await this.persistChanges('delivery', changes, {
      ...metadata,
      operation: kind,
      oldDeliveryId: before?.deliveryId,
      newDeliveryId: after.deliveryId,
      oldLocusId: beforeLocus?.id,
      newLocusId: afterLocus?.id,
      expectedRevision: before?.sequence,
    })
  }

  /** Whether one planned change actually differs from the stored state. */
  private changesState(change: TableChange): boolean {
    const previous = this.tableFor(change.table).get(change.key)
    if (change.value === undefined) return previous !== undefined
    return previous === undefined || !recordsEqual(previous, change.value)
  }

  private async applyChanges(changes: readonly TableChange[]): Promise<void> {
    const applied: AppliedChange[] = []
    try {
      for (const change of changes) {
        const table = this.tableFor(change.table)
        const previous = table.get(change.key)
        if (change.value === undefined) {
          if (previous === undefined) continue
          await table.delete(change.key)
        } else {
          if (previous !== undefined && recordsEqual(previous, change.value)) continue
          await table.put(change.key, change.value)
        }
        applied.push({ change, previous })
      }
    } catch (error) {
      for (let index = applied.length - 1; index >= 0; index -= 1) {
        const { change, previous } = applied[index] as AppliedChange
        try {
          const table = this.tableFor(change.table)
          if (previous === undefined) await table.delete(change.key)
          else await table.put(change.key, previous)
        } catch {
          // Best effort only: Domain has no cross-table transaction. The
          // operation row remains failed for an explicit recovery pass.
        }
      }
      throw error
    }
  }

  private tableFor(table: TableName): KvTable<string, unknown> {
    if (table === 'loci') return this.loci() as unknown as KvTable<string, unknown>
    if (table === 'locus_indexes') return this.indexes() as unknown as KvTable<string, unknown>
    if (table === 'locus_switch_notices') {
      return this.domain.table('locus_switch_notices') as unknown as KvTable<string, unknown>
    }
    if (table === 'locus_permission_audit') {
      return this.domain.table('locus_permission_audit') as unknown as KvTable<string, unknown>
    }
    return this.deliveries() as unknown as KvTable<string, unknown>
  }

  private newOperation(kind: string, metadata: Record<string, unknown>): PetLocusOperation {
    const operationKind = operationKindOf(kind)
    const now = Date.now()
    this.operationSequence += 1
    const id = `locus-op-${now}-${this.operationSequence}-${randomUUID()}`
    const resourceRefs = extractResourceRefs(metadata)
    return {
      id,
      kind: operationKind,
      phase: 'prepared',
      ...(metadata['locusId'] !== undefined ? { locusId: String(metadata['locusId']) } : {}),
      ...(metadata['oldLocusId'] !== undefined
        ? { oldLocusId: String(metadata['oldLocusId']) }
        : metadata['replacesLocusId'] !== undefined
          ? { oldLocusId: String(metadata['replacesLocusId']) }
          : {}),
      ...(metadata['newLocusId'] !== undefined ? { newLocusId: String(metadata['newLocusId']) } : {}),
      ...(metadata['endpointKey'] !== undefined ? { endpointKey: String(metadata['endpointKey']) } : {}),
      ...(metadata['expectedRevision'] !== undefined && Number.isSafeInteger(metadata['expectedRevision'])
        ? { expectedRevision: Number(metadata['expectedRevision']) }
        : {}),
      ...(metadata['operation'] !== undefined ? { operation: String(metadata['operation']) } : {}),
      ...(metadata['deliveryId'] !== undefined ? { deliveryId: String(metadata['deliveryId']) } : {}),
      ...(metadata['oldDeliveryId'] !== undefined ? { oldDeliveryId: String(metadata['oldDeliveryId']) } : {}),
      ...(metadata['newDeliveryId'] !== undefined ? { newDeliveryId: String(metadata['newDeliveryId']) } : {}),
      ...(resourceRefs !== undefined ? { resourceRefs } : {}),
      step: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }
  }

  private requireProvisioningTransaction(
    operation: string,
  ): NonNullable<LocusDomain['transaction']> {
    if (this.domain.supportsTransaction !== true || this.domain.transaction === undefined) {
      throw new LocusProvisioningError(
        'TRANSACTION_UNAVAILABLE',
        `Atomic locus provisioning is unavailable; refusing ${operation}`,
        operation,
      )
    }
    return this.domain.transaction
  }

  private getRequiredProvisioningOperation(provisioningId: string): PetLocusOperation {
    assertIdentifier(provisioningId, 'provisioningId')
    const operation = this.getOperation(provisioningId)
    if (operation === undefined || operation.provisioningIntentHash === undefined) {
      throw new LocusProvisioningError(
        'PROVISIONING_NOT_FOUND',
        `Provisioning ${provisioningId} was not begun by the controller`,
      )
    }
    return operation
  }

  private findBlockingProvisioningOperation(
    endpointKey: string,
    parentSessionId?: string,
  ): PetLocusOperation | undefined {
    return this.listOperations().find(operation => {
      if (
        operation.provisioningIntentHash === undefined ||
        operation.phase === 'committed' ||
        operation.phase === 'compensated'
      ) return false
      if (operation.endpointKey === endpointKey) return true
      // Q&A begins against a deterministic pending endpoint before Feishu
      // allocates chatId. Parent identity is therefore its stable uniqueness
      // fence across restart/manual debt.
      return operation.operation === 'provisioning:qa' &&
        parentSessionId !== undefined &&
        operation.resourceRefs?.parentSessionId === parentSessionId
    })
  }

  private assertSameProvisioningIntent(
    operation: PetLocusOperation,
    input: DurableProvisioningBegin,
    intentHash: string,
  ): void {
    if (
      operation.provisioningIntentHash !== intentHash ||
      operation.kind !== provisioningOperationKind(input.kind)
    ) {
      throw new LocusProvisioningError(
        'PROVISIONING_CONFLICT',
        `Provisioning id ${input.provisioningId} is already bound to another intent`,
      )
    }
    if (operation.phase !== 'provisioning' && operation.phase !== 'committed') {
      throw new LocusProvisioningError(
        'PROVISIONING_CONFLICT',
        `Provisioning ${input.provisioningId} is already ${operation.phase}`,
      )
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.writeChain.then(fn)
    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
}

function provisioningOperationKind(
  kind: DurableProvisioningBegin['kind'],
): PetLocusOperation['kind'] {
  if (kind === 'qa') return 'ensure-default-qa'
  if (kind === 'replacement') return 'replace'
  return 'ensure'
}

function assertProvisioningBegin(input: DurableProvisioningBegin): void {
  assertIdentifier(input.provisioningId, 'provisioningId')
  normalizeLocusEndpoint(input.endpoint)
  if (input.parentSessionId !== undefined) assertIdentifier(input.parentSessionId, 'parentSessionId')
  if (input.kind !== 'group' && input.parentSessionId === undefined) {
    throw new LocusProvisioningError(
      'PROVISIONING_CONFLICT',
      `${input.kind} provisioning requires parentSessionId`,
    )
  }
  assertTimestamp(input.startedAt, 'startedAt')
}

function assertProvisioningResources(resource: DurableProvisioningResources): void {
  if (
    resource.mainSessionId === undefined &&
    resource.childSessionId === undefined &&
    resource.chatId === undefined
  ) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Provisioning resource update is empty')
  }
  if (resource.mainSessionId !== undefined) assertIdentifier(resource.mainSessionId, 'mainSessionId')
  if (resource.childSessionId !== undefined) assertIdentifier(resource.childSessionId, 'childSessionId')
  if (resource.chatId !== undefined) assertIdentifier(resource.chatId, 'chatId')
}

function mergeProvisioningResources(
  current: PetLocusOperation['resourceRefs'],
  update: DurableProvisioningResources,
): NonNullable<PetLocusOperation['resourceRefs']> {
  const next: NonNullable<PetLocusOperation['resourceRefs']> = {
    ...(current ?? {}),
  }
  for (const field of ['mainSessionId', 'childSessionId', 'chatId'] as const) {
    const value = update[field]
    if (value === undefined) continue
    const previous = next[field]
    if (previous !== undefined && previous !== value) {
      throw new LocusProvisioningError(
        'PROVISIONING_CONFLICT',
        `Provisioning resource ${field} is already ${previous}, not ${value}`,
      )
    }
    next[field] = value
  }
  return next
}

function assertProvisioningCommitMatchesBegin(
  operation: PetLocusOperation,
  input: DurableProvisioningCommit,
  record: LocusRecord,
): void {
  const expectedEndpoint = operation.endpointKey
  const actualEndpoint = endpointKeyOf(record.endpoint)
  if (expectedEndpoint !== actualEndpoint) {
    // Q&A begins before Lark allocates the real chat id. Its begin endpoint is
    // an explicit pending marker; the recorded created chat is the proof used
    // below to authorize the final endpoint.
    const isQa = operation.operation === 'provisioning:qa'
    const recordedChat = operation.resourceRefs?.chatId
    if (!isQa || recordedChat !== record.endpoint.chatId || record.endpoint.threadId !== undefined) {
      throw new LocusProvisioningError(
        'PROVISIONING_CONFLICT',
        `Provisioning ${input.provisioningId} endpoint changed from ${String(expectedEndpoint)} to ${actualEndpoint}`,
      )
    }
  }
  const begunParent = operation.resourceRefs?.parentSessionId
  if (begunParent !== undefined && begunParent !== record.parentSessionId) {
    throw new LocusProvisioningError(
      'PROVISIONING_CONFLICT',
      `Provisioning ${input.provisioningId} parent changed`,
    )
  }
  const replacement = operation.operation === 'provisioning:replacement'
  if (replacement !== (input.replace !== undefined)) {
    throw new LocusProvisioningError(
      'PROVISIONING_CONFLICT',
      `Provisioning ${input.provisioningId} replacement intent changed`,
    )
  }
  const rebuild = operation.operation === 'provisioning:rebuild'
  if (rebuild !== (input.rebuild !== undefined)) {
    throw new LocusProvisioningError(
      'PROVISIONING_CONFLICT',
      `Provisioning ${input.provisioningId} rebuild intent changed`,
    )
  }
}

function assertProvisioningCommitForm(
  operation: PetLocusOperation,
  input: DurableProvisioningCommit,
  record: LocusRecord,
): void {
  switch (operation.operation) {
    case 'provisioning:group':
      if (
        input.group === undefined ||
        input.defaultQaForParentSessionId !== undefined ||
        input.replace !== undefined ||
        input.rebuild !== undefined ||
        record.parentLocusId !== undefined ||
        record.endpoint.threadId !== undefined ||
        (record.source !== 'auto' && record.source !== 'explicit')
      ) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Group commit does not match its begin intent')
      }
      return
    case 'provisioning:topic':
      if (
        input.group !== undefined ||
        input.defaultQaForParentSessionId !== undefined ||
        input.replace !== undefined ||
        input.rebuild !== undefined ||
        record.endpoint.threadId === undefined ||
        record.parentLocusId === undefined
      ) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Topic commit requires one parentLocusId and no group/default projection')
      }
      return
    case 'provisioning:qa':
      if (
        input.group === undefined ||
        input.defaultQaForParentSessionId === undefined ||
        input.replace !== undefined ||
        input.rebuild !== undefined ||
        record.endpoint.threadId !== undefined ||
        record.parentLocusId !== undefined ||
        record.source !== 'qa-created'
      ) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Default Q&A commit does not match its begin intent')
      }
      return
    case 'provisioning:replacement': {
      const topicReplacement = record.endpoint.threadId !== undefined
      if (
        input.defaultQaForParentSessionId !== undefined ||
        input.replace === undefined ||
        input.rebuild !== undefined ||
        record.source !== 'explicit' ||
        (topicReplacement
          ? input.group !== undefined || record.parentLocusId === undefined
          : input.group === undefined || record.parentLocusId !== undefined)
      ) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Replacement commit does not match its begin intent')
      }
      return
    }
    case 'provisioning:rebuild':
      if (
        input.rebuild === undefined ||
        input.replace !== undefined ||
        (record.source !== 'explicit' && record.source !== 'qa-created') ||
        (record.source === 'qa-created') !== (input.defaultQaForParentSessionId !== undefined) ||
        (record.endpoint.threadId === undefined) !== (record.parentLocusId === undefined) ||
        (input.defaultQaForParentSessionId !== undefined && input.group === undefined)
      ) {
        throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Rebuild commit does not match its begin intent')
      }
      return
    default:
      throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Unknown provisioning begin intent')
  }
}

function assertGroupProjection(
  group: DurableProvisioningCommit['group'],
  record: LocusRecord,
): void {
  if (group === undefined) {
    if (record.endpoint.threadId === undefined) {
      throw new LocusProvisioningError(
        'PROVISIONING_CONFLICT',
        'A chat-level locus commit requires its validation-only group projection',
      )
    }
    return
  }
  if (
    record.endpoint.threadId !== undefined ||
    group.chatId !== record.endpoint.chatId ||
    group.workspaceId !== record.workspaceId ||
    group.mainSessionId !== record.parentSessionId ||
    group.mainSource !== record.source ||
    group.state !== record.state ||
    group.createdAt !== record.createdAt ||
    group.updatedAt !== record.updatedAt
  ) {
    throw new LocusProvisioningError(
      'PROVISIONING_CONFLICT',
      'Group projection does not exactly match its chat-level locus',
    )
  }
}

function assertNewTopicParent(
  loci: ReadonlyMap<string, StoredLocus>,
  record: LocusRecord,
): void {
  if (record.endpoint.threadId === undefined) return
  if (record.parentLocusId === undefined) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Topic commit requires parentLocusId')
  }
  const parent = loci.get(record.parentLocusId)
  if (
    parent === undefined ||
    parent.endpoint.threadId !== undefined ||
    parent.endpoint.chatId !== record.endpoint.chatId ||
    parent.state !== 'active' ||
    latestLocusForEndpoint(loci, parent.endpoint)?.id !== parent.id
  ) {
    throw new LocusProvisioningError(
      'PROVISIONING_CONFLICT',
      'New topic parent must be the current active chat-level locus',
    )
  }
}

function assertProvisioningResourcesMatch(
  operation: PetLocusOperation,
  record: LocusRecord,
  group: DurableProvisioningCommit['group'],
): void {
  const refs = operation.resourceRefs
  if (refs?.childSessionId !== undefined && refs.childSessionId !== record.childSessionId) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Recorded childSessionId does not match commit')
  }
  if (record.childSessionId === undefined || refs?.childSessionId !== record.childSessionId) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Committed childSessionId was not durably recorded')
  }
  if (refs.mainSessionId !== undefined && refs.mainSessionId !== record.parentSessionId) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Recorded mainSessionId does not match commit')
  }
  if (group?.mainSource === 'auto' && refs.mainSessionId !== record.parentSessionId) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Automatic mainSessionId was not durably recorded')
  }
  if (operation.operation === 'provisioning:group' && refs.mainSessionId !== undefined && group === undefined) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Recorded main requires a chat-level group commit')
  }
  if (operation.operation === 'provisioning:qa' && refs.chatId !== record.endpoint.chatId) {
    throw new LocusProvisioningError('PROVISIONING_CONFLICT', 'Created Q&A chatId was not durably recorded')
  }
}

function latestLocusForEndpoint(
  loci: ReadonlyMap<string, StoredLocus>,
  endpoint: LocusEndpoint,
): StoredLocus | undefined {
  const key = endpointKeyOf(endpoint)
  let latest: StoredLocus | undefined
  for (const record of loci.values()) {
    if (endpointKeyOf(record.endpoint) !== key) continue
    if (
      latest === undefined ||
      record.generation > latest.generation ||
      (record.generation === latest.generation && record.id.localeCompare(latest.id) > 0)
    ) {
      latest = record
    }
  }
  return latest
}

function switchNoticeKey(locusId: string, generation: number): string {
  return `${locusId}\u0000${String(generation)}`
}

function provisioningBeginHash(input: DurableProvisioningBegin): string {
  return stableHash({
    kind: input.kind,
    endpoint: normalizeLocusEndpoint(input.endpoint).endpoint,
    ...(input.parentSessionId !== undefined ? { parentSessionId: input.parentSessionId } : {}),
  })
}

function provisioningCommitHash(
  input: DurableProvisioningCommit,
  normalized: LocusRecord,
): string {
  return stableHash({
    locus: normalized,
    ...(input.group !== undefined ? { group: input.group } : {}),
    ...(input.defaultQaForParentSessionId !== undefined
      ? { defaultQaForParentSessionId: input.defaultQaForParentSessionId }
      : {}),
    ...(input.replace !== undefined ? { replace: input.replace } : {}),
    ...(input.rebuild !== undefined ? { rebuild: input.rebuild } : {}),
  })
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
}

/** Normalize and semantically validate one record before persistence. */
function normalizeRecord(record: LocusRecord): LocusRecord {
  const endpoint = normalizeLocusEndpoint(record.endpoint).endpoint
  const contextAnchor = record.contextAnchor === undefined ? undefined : {
    status: record.contextAnchor.status,
    ...(record.contextAnchor.existence !== undefined ? { existence: record.contextAnchor.existence } : {}),
    ...(record.contextAnchor.authorization !== undefined ? { authorization: record.contextAnchor.authorization } : {}),
    ...(record.contextAnchor.executionRoot !== undefined ? { executionRoot: record.contextAnchor.executionRoot } : {}),
    ...(record.contextAnchor.projectResources !== undefined ? { projectResources: [...record.contextAnchor.projectResources] } : {}),
    ...(record.contextAnchor.constraints !== undefined ? { constraints: [...record.contextAnchor.constraints] } : {}),
    ...(record.contextAnchor.provenance !== undefined ? { provenance: record.contextAnchor.provenance } : {}),
    ...(record.contextAnchor.confirmedAt !== undefined ? { confirmedAt: record.contextAnchor.confirmedAt } : {}),
  }
  if (record.endpoint.chatId !== endpoint.chatId ||
      (record.endpoint.threadId ?? undefined) !== (endpoint.threadId ?? undefined)) {
    throw new LocusError('INVALID_ENDPOINT', 'Locus endpoint is not normalized')
  }
  if (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0 ||
      !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.createdAt) {
    throw new LocusError('INVALID_LOCUS', 'Locus timestamps must be non-negative ordered safe integers')
  }
  if (record.stoppedAt !== undefined && (record.stoppedAt < record.createdAt || record.stoppedAt > record.updatedAt)) {
    throw new LocusError('INVALID_LOCUS', 'stoppedAt must be within locus lifetime')
  }
  if (record.retiredAt !== undefined && (record.retiredAt < record.createdAt || record.retiredAt > record.updatedAt)) {
    throw new LocusError('INVALID_LOCUS', 'retiredAt must be within locus lifetime')
  }
  if (record.permission.effective === 'write' && record.permission.desired !== 'write') {
    throw new LocusError('INVALID_PERMISSION', 'Effective write requires desired write permission')
  }
  if (record.permission.effective === 'write' && record.permission.verifiedAt === undefined) {
    throw new LocusError('INVALID_PERMISSION', 'Effective write requires a verification timestamp')
  }
  if (record.state === 'active' && record.childSessionId === undefined) {
    throw new LocusError('INVALID_LOCUS', 'An active locus requires a childSessionId')
  }
  if (endpoint.threadId !== undefined && record.parentLocusId === undefined) {
    throw new LocusError('INVALID_LOCUS', 'A topic locus requires parentLocusId')
  }
  if (endpoint.threadId === undefined && record.parentLocusId !== undefined) {
    throw new LocusError('INVALID_LOCUS', 'A chat-level locus cannot carry parentLocusId')
  }
  if (endpointKeyOf(endpoint) !== endpointKeyOf(record.endpoint)) {
    throw new LocusError('INVALID_ENDPOINT', 'Locus endpoint changed during normalization')
  }
  return Object.freeze({
    ...record,
    endpoint: Object.freeze(endpoint),
    ...(contextAnchor !== undefined ? {
      contextAnchor: Object.freeze({
        ...contextAnchor,
        ...(contextAnchor.projectResources !== undefined
          ? { projectResources: Object.freeze([...contextAnchor.projectResources]) }
          : {}),
        ...(contextAnchor.constraints !== undefined ? { constraints: Object.freeze([...contextAnchor.constraints]) } : {}),
      }),
    } : {}),
  })
}

/** Validate aggregate-level uniqueness and source/workspace invariants. */
function assertLocusSet(loci: ReadonlyMap<string, StoredLocus>): void {
  const endpointOwners = new Map<string, string>()
  const endpointGenerations = new Map<string, number[]>()
  const childOwners = new Map<string, string>()
  const parentWorkspaces = new Map<string, string>()

  for (const record of loci.values()) {
    normalizeRecord(record)
    const endpointKey = endpointKeyOf(record.endpoint)
    const generations = endpointGenerations.get(endpointKey) ?? []
    generations.push(record.generation)
    endpointGenerations.set(endpointKey, generations)
    if (record.parentLocusId !== undefined) {
      const parent = loci.get(record.parentLocusId)
      if (parent === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Parent locus ${record.parentLocusId} does not exist`)
      if (parent.parentLocusId !== undefined) throw new LocusError('INVALID_LOCUS', 'A topic locus cannot own another topic')
      if (parent.endpoint.threadId !== undefined) throw new LocusError('INVALID_LOCUS', 'A topic parent must be chat-level')
      if (parent.endpoint.chatId !== record.endpoint.chatId) throw new LocusError('INVALID_ENDPOINT', 'Topic and parent locus must share chatId')
    }
    const parentWorkspace = parentWorkspaces.get(record.parentSessionId)
    if (parentWorkspace !== undefined && parentWorkspace !== record.workspaceId) {
      throw new LocusError(
        'PARENT_WORKSPACE_CONFLICT',
        `Parent ${record.parentSessionId} is associated with workspaces ${parentWorkspace} and ${record.workspaceId}`,
      )
    }
    parentWorkspaces.set(record.parentSessionId, record.workspaceId)

    if (record.childSessionId !== undefined) {
      const childOwner = childOwners.get(record.childSessionId)
      if (childOwner !== undefined && childOwner !== record.id) {
        throw new LocusError(
          'CHILD_OCCUPIED',
          `Child session ${record.childSessionId} already belongs to locus ${childOwner}`,
        )
      }
      childOwners.set(record.childSessionId, record.id)
    }

    if (isCurrentLocusState(record.state)) {
      const endpoint = endpointKeyOf(record.endpoint)
      const endpointOwner = endpointOwners.get(endpoint)
      if (endpointOwner !== undefined && endpointOwner !== record.id) {
        throw new LocusError('ENDPOINT_OCCUPIED', `Endpoint ${endpoint} already belongs to locus ${endpointOwner}`)
      }
      endpointOwners.set(endpoint, record.id)
    }
  }
  for (const [endpoint, generations] of endpointGenerations) {
    const sorted = [...generations].sort((left, right) => left - right)
    if (new Set(sorted).size !== sorted.length) throw new LocusError('INVALID_LOCUS', `Duplicate locus generation for endpoint ${endpoint}`)
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] !== sorted[index - 1]! + 1 && sorted[index - 1] !== undefined) {
        throw new LocusError('INVALID_LOCUS', `Locus generations for endpoint ${endpoint} must advance contiguously`)
      }
    }
  }
}

/** Derive all materialized indexes from locus records and default pointers. */
function isEndpointMarkerState(state: LocusState): boolean {
  return state !== 'retired'
}

function deriveIndexes(
  loci: ReadonlyMap<string, StoredLocus>,
  defaults: ReadonlyMap<string, string>,
  now = Date.now(),
): Map<string, PetLocusIndex> {
  assertLocusSet(loci)
  const endpoint = new Map<string, string>()
  const parents = new Map<string, string[]>()
  const children = new Map<string, string>()
  for (const record of loci.values()) {
    if (isEndpointMarkerState(record.state)) {
      const previous = endpoint.get(endpointKeyOf(record.endpoint))
      const existing = previous === undefined ? undefined : loci.get(previous)
      if (existing === undefined || record.generation > existing.generation) {
        endpoint.set(endpointKeyOf(record.endpoint), record.id)
      }
    }
    const parent = parents.get(record.parentSessionId) ?? []
    parent.push(record.id)
    parents.set(record.parentSessionId, parent)
    if (record.childSessionId !== undefined) children.set(record.childSessionId, record.id)
  }

  const indexes = new Map<string, PetLocusIndex>()
  for (const [endpointValue, locusId] of endpoint) {
    const key = endpointIndexKey(endpointFromKey(endpointValue))
    indexes.set(key, {
      kind: 'endpoint-current',
      key,
      locusIds: [locusId],
      updatedAt: now,
    })
  }
  for (const [parentSessionId, locusIds] of parents) {
    locusIds.sort((left, right) => {
      const a = loci.get(left)
      const b = loci.get(right)
      if (a === undefined || b === undefined) return left.localeCompare(right)
      const byGeneration = a.generation - b.generation
      return byGeneration !== 0 ? byGeneration : left.localeCompare(right)
    })
    const key = parentIndexKey(parentSessionId)
    indexes.set(key, {
      kind: 'parent-loci',
      key,
      locusIds,
      updatedAt: now,
    })
  }
  for (const [childSessionId, locusId] of children) {
    const key = childIndexKey(childSessionId)
    indexes.set(key, {
      kind: 'child-locus',
      key,
      locusIds: [locusId],
      updatedAt: now,
    })
  }
  for (const [parentSessionId, locusId] of defaults) {
    const locus = loci.get(locusId)
    if (locus === undefined || locus.parentSessionId !== parentSessionId || locus.source !== 'qa-created' || locus.parentLocusId !== undefined) {
      continue
    }
    const key = defaultQaIndexKey(parentSessionId)
    indexes.set(key, {
      kind: 'default-qa',
      key,
      locusIds: [locusId],
      updatedAt: now,
    })
  }
  return indexes
}

function diffLocusTable(
  before: ReadonlyMap<string, StoredLocus>,
  after: ReadonlyMap<string, StoredLocus>,
): TableChange[] {
  const keys = new Set([...before.keys(), ...after.keys()])
  const changes: TableChange[] = []
  for (const key of keys) {
    const oldValue = before.get(key)
    const nextValue = after.get(key)
    if (nextValue === undefined) {
      if (oldValue !== undefined) changes.push({ table: 'loci', key })
    } else if (oldValue === undefined || !recordsEqual(oldValue, nextValue)) {
      changes.push({ table: 'loci', key, value: nextValue })
    }
  }
  return changes
}

function preserveEquivalentIndexTimestamps(
  before: ReadonlyMap<string, PetLocusIndex>,
  after: ReadonlyMap<string, PetLocusIndex>,
): Map<string, PetLocusIndex> {
  const preserved = new Map<string, PetLocusIndex>()
  for (const [key, next] of after) {
    const previous = before.get(key)
    preserved.set(
      key,
      previous !== undefined && previous.kind === next.kind && recordsEqual(
        { ...previous, updatedAt: 0 },
        { ...next, updatedAt: 0 },
      )
        ? previous
        : next,
    )
  }
  return preserved
}

function diffIndexTable(
  before: ReadonlyMap<string, PetLocusIndex>,
  after: ReadonlyMap<string, PetLocusIndex>,
): TableChange[] {
  const keys = new Set([...before.keys(), ...after.keys()])
  const changes: TableChange[] = []
  for (const key of keys) {
    const oldValue = before.get(key)
    const nextValue = after.get(key)
    if (nextValue === undefined) {
      if (oldValue !== undefined) changes.push({ table: 'locus_indexes', key })
    } else if (oldValue === undefined || !recordsEqual(oldValue, nextValue)) {
      changes.push({ table: 'locus_indexes', key, value: nextValue })
    }
  }
  return changes
}

function sortLoci(records: readonly LocusRecord[]): readonly LocusRecord[] {
  return [...records].sort((left, right) => {
    const byGeneration = left.generation - right.generation
    return byGeneration !== 0 ? byGeneration : left.id.localeCompare(right.id)
  })
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LocusError('INVALID_LOCUS', `${field} must be a non-empty string`)
  }
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LocusError('INVALID_LOCUS', `${field} must be a non-negative safe integer`)
  }
}

function assertCorrelation(correlation: DeliveryCorrelation): void {
  assertIdentifier(correlation.endpoint.chatId, 'endpoint.chatId')
  if (correlation.endpoint.threadId !== undefined) assertIdentifier(correlation.endpoint.threadId, 'endpoint.threadId')
  assertIdentifier(correlation.locusId, 'locusId')
  assertIdentifier(correlation.childSessionId, 'childSessionId')
  if (!Number.isSafeInteger(correlation.generation) || correlation.generation < 1) {
    throw new LocusError('INVALID_LOCUS', 'generation must be a positive safe integer')
  }
}

function assertDeliveryInput(input: DeliveryInput): void {
  assertIdentifier(input.messageId, 'messageId')
  assertCorrelation(input)
  assertIdentifier(input.senderOpenId ?? '', 'senderOpenId')
  if (input.senderName !== undefined) assertIdentifier(input.senderName, 'senderName')
  if (input.text !== undefined && input.text.trim() === '') {
    throw new LocusError('INVALID_LOCUS', 'text must be non-empty when supplied')
  }
  if (input.replyToMessageId !== undefined) assertIdentifier(input.replyToMessageId, 'replyToMessageId')
  if (input.deliveryId !== undefined) assertIdentifier(input.deliveryId, 'deliveryId')
  if (input.turnId !== undefined || input.executionId !== undefined) {
    throw new LocusError('INVALID_LOCUS', 'Accepted Delivery cannot contain execution/turn proof')
  }
  if (input.replyTarget !== undefined) {
    assertIdentifier(input.replyTarget.chatId, 'replyTarget.chatId')
    assertIdentifier(input.replyTarget.messageId, 'replyTarget.messageId')
    if (input.replyTarget.threadId !== undefined) assertIdentifier(input.replyTarget.threadId, 'replyTarget.threadId')
    if (input.replyTarget.rootMessageId !== undefined) assertIdentifier(input.replyTarget.rootMessageId, 'replyTarget.rootMessageId')
    if (input.replyTarget.chatId !== input.endpoint.chatId ||
        (input.replyTarget.threadId ?? undefined) !== (input.endpoint.threadId ?? undefined) ||
        input.replyTarget.messageId !== input.messageId) {
      throw new LocusError('INVALID_LOCUS', 'Delivery reply target must derive from accepted endpoint/message')
    }
  }
  if (input.rootMessageId !== undefined && input.replyTarget?.rootMessageId !== undefined &&
      input.rootMessageId !== input.replyTarget.rootMessageId) {
    throw new LocusError('INVALID_LOCUS', 'Delivery rootMessageId conflicts with replyTarget')
  }
  if (input.acceptedAt !== undefined && (!Number.isSafeInteger(input.acceptedAt) || input.acceptedAt < 0)) {
    throw new LocusError('INVALID_LOCUS', 'acceptedAt must be a non-negative safe integer')
  }
}

function assertDeliveryRecord(record: DeliveryRecord): void {
  assertDeliveryInput({
    endpoint: record.endpoint,
    locusId: record.locusId,
    generation: record.generation,
    childSessionId: record.childSessionId,
    messageId: record.messageId,
    deliveryId: record.deliveryId,
    ...(record.senderOpenId !== undefined ? { senderOpenId: record.senderOpenId } : {}),
    ...(record.senderName !== undefined ? { senderName: record.senderName } : {}),
    ...(record.text !== undefined ? { text: record.text } : {}),
    ...(record.replyTarget !== undefined ? { replyTarget: record.replyTarget } : {}),
    ...(record.rootMessageId !== undefined ? { rootMessageId: record.rootMessageId } : {}),
    ...(record.replyToMessageId !== undefined ? { replyToMessageId: record.replyToMessageId } : {}),
    ...(record.executionId !== undefined && record.status !== 'accepted' ? { executionId: record.executionId } : {}),
    ...(record.turnId !== undefined && record.status !== 'accepted' ? { turnId: record.turnId } : {}),
    ...(record.acceptedAt !== undefined ? { acceptedAt: record.acceptedAt } : {}),
  })
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1) {
    throw new LocusError('INVALID_LOCUS', 'Delivery sequence must be a positive safe integer')
  }
  if (record.feedbackTarget.chatId !== record.endpoint.chatId || record.feedbackTarget.messageId !== record.messageId) {
    throw new LocusError('INVALID_LOCUS', 'Delivery feedback target must derive from the accepted endpoint/message')
  }
  if (record.status === 'accepted' &&
      (record.executionId !== undefined || record.inboxMessageId !== undefined || record.turnId !== undefined)) {
    throw new LocusError('INVALID_LOCUS', 'Accepted Delivery cannot contain inbox/execution/turn proof')
  }
  if (record.status === 'queued' &&
      (record.executionId === undefined || record.inboxMessageId === undefined ||
       record.turnId !== undefined || record.queuedAt === undefined)) {
    throw new LocusError('INVALID_LOCUS', 'Queued Delivery requires inbox/execution proof and no turn proof')
  }
  if ((record.status === 'running' || record.status === 'settled') &&
      (record.executionId === undefined || record.inboxMessageId === undefined || record.turnId === undefined)) {
    throw new LocusError('INVALID_LOCUS', 'Running/settled Delivery requires inbox, execution and turn proof')
  }
  if (record.status === 'failed') {
    if (record.startupDisposition === 'unqueued') {
      if (record.executionId !== undefined || record.inboxMessageId !== undefined || record.turnId !== undefined) {
        throw new LocusError('INVALID_LOCUS', 'Unqueued startup failure cannot contain inbox/execution/turn proof')
      }
    } else if (record.startupDisposition === 'execution-unrecoverable') {
      if (record.executionId === undefined || record.inboxMessageId === undefined) {
        throw new LocusError('INVALID_LOCUS', 'Execution-unrecoverable startup failure requires prior inbox/execution proof')
      }
    } else if (record.dispatchFailure === 'not-queued') {
      if (record.executionId !== undefined || record.inboxMessageId !== undefined || record.turnId !== undefined || record.startedAt !== undefined) {
        throw new LocusError('INVALID_LOCUS', 'Not-queued dispatch failure cannot contain inbox/execution/turn proof')
      }
    } else if (record.dispatchFailure === 'queued-not-started') {
      if (record.executionId === undefined || record.inboxMessageId === undefined || record.turnId !== undefined || record.queuedAt === undefined || record.startedAt !== undefined) {
        throw new LocusError('INVALID_LOCUS', 'Queued dispatch failure requires inbox/execution proof and no turn proof')
      }
    } else if (record.executionId === undefined || record.inboxMessageId === undefined || record.turnId === undefined) {
      throw new LocusError('INVALID_LOCUS', 'Ordinary failed Delivery requires inbox, execution and turn proof')
    }
  }
  if ((record.feedbackTarget.rootMessageId ?? undefined) !== (record.rootMessageId ?? undefined)) {
    throw new LocusError('INVALID_LOCUS', 'Delivery feedback root must match rootMessageId')
  }
  if ((record.replyTarget?.rootMessageId ?? undefined) !== (record.rootMessageId ?? undefined)) {
    throw new LocusError('INVALID_LOCUS', 'Delivery reply root must match rootMessageId')
  }
  if ((record.feedbackTarget.threadId ?? undefined) !== (record.endpoint.threadId ?? undefined)) {
    throw new LocusError('INVALID_LOCUS', 'Delivery feedback target thread must derive from the accepted endpoint')
  }
  if (record.replyTarget !== undefined) {
    if (record.replyTarget.chatId !== record.endpoint.chatId || record.replyTarget.messageId !== record.messageId) {
      throw new LocusError('INVALID_LOCUS', 'Delivery reply target must derive from the accepted endpoint/message')
    }
    if ((record.replyTarget.threadId ?? undefined) !== (record.endpoint.threadId ?? undefined)) {
      throw new LocusError('INVALID_LOCUS', 'Delivery reply target thread must derive from the accepted endpoint')
    }
  }
}

function deliveryCorrelates(
  record: DeliveryRecord,
  correlation: DeliveryCorrelation | DeliveryRecord,
): boolean {
  return (
    record.locusId === correlation.locusId &&
    record.generation === correlation.generation &&
    record.childSessionId === correlation.childSessionId &&
    record.endpoint.chatId === correlation.endpoint.chatId &&
    (record.endpoint.threadId ?? undefined) === (correlation.endpoint.threadId ?? undefined)
  )
}

function mutation(
  record: DeliveryRecord | undefined,
  changed: boolean,
  reason?: LocusDeliveryMutation['reason'],
): LocusDeliveryMutation {
  return {
    record,
    changed,
    reason: reason ?? 'already-in-state',
  }
}
