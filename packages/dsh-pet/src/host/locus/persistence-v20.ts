/**
 * Durable v20 locus repository (openspec pet-locus-isomorphic-entries D1–D17).
 *
 * Implements {@link LocusRepositoryPortV20} over the Pet domain tables `loci`
 * (one row per entry, keyed by endpointKey), `locus_mains`, `locus_deliveries`
 * and `locus_operations`. Reads are synchronous snapshots of the tables; every
 * write runs as one callback on this repository's queue and commits with
 * `domain.transaction` (atomic on the Host; the test medium shims it).
 *
 * Methods not yet landed reject with `not implemented` and name their task, so
 * the port stays whole while owners migrate callers.
 */
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../domain.js'

/** The write-transaction handle the Host's domain exposes (atomic on the Host). */
interface LocusDomainTransaction {
  put(table: string, key: string, value: unknown): void
  delete(table: string, key: string): void
}

/** The Pet domain handle the v20 repository runs on. */
export type LocusDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: LocusDomainTransaction) => void) => Promise<void>
}
import {
  petLocusGroupRowV20,
  petLocusTopicRowV20,
  type LocusAccessModeV20,
  type LocusChildLookupInputV20,
  type LocusChildLookupResultV20,
  type LocusGroupRowV20,
  type LocusMigrateWholeWInputV20,
  type LocusProvisioningBeginV20,
  type LocusProvisioningResourceV20,
  type LocusCommitProvisioningInputV20,
  type LocusRebindChatInputV20,
  type LocusFirstDeliveryIdentityV20,
  type LocusResetChatOptionsV20,
  type LocusResetChatResultV20,
  type LocusRepositoryPortV20,
  type LocusResolvedRowV20,
  type LocusRotateReservationInputV20,
  type LocusRotateReservationResultV20,
  type LocusRowFenceV20,
  type LocusRowV20,
  type LocusTopicRowV20,
  type LocusWriteTxV20,
} from './contract-v20.js'
import { endpointKeyV20, isTopicRowV20, validateLocusSetForStorage } from './locus-set-v20.js'
import {
  DEFAULT_DELIVERY_LEASE_MS,
  MAX_DELIVERY_LEASE_MS,
  claimCurrentDelivery as pureClaim,
  bindQueued as pureBindQueued,
  bindTurn as pureBindTurn,
  bindDeliveryTurn as pureBindDeliveryTurn,
  settleByTurn as pureSettleByTurn,
  markFinishing as pureMarkFinishing,
  completeDelivery as pureComplete,
  waitDelivery as pureWait,
  abandonRefusedDelivery as pureAbandonRefused,
  abandonInterruptedDelivery as pureAbandonInterrupted,
  expireDelivery as pureExpire,
  type DeliveryCurrentClaimInput,
  type DeliveryRecord,
  type DeliveryFinishInput,
  type DeliveryInput,
  type DeliveryLeaseInput,
  type DeliveryLedgerState,
  type DeliveryMutation,
  type DeliveryQueuedBindingInput,
  type DeliverySettlementInput,
  type DeliveryTurnBindingInput,
  type DeliveryWaitInput,
} from './delivery.js'
import { petLocusDeliveryV20, petLocusRowV20, type LocusDeliveryRowV20 } from './contract-v20.js'
import type { PetLocusErrorCodeV20 } from '../../wire.js'
import { petLocusMainRecord, petLocusOperation, type PetLocusMainRecord, type PetLocusOperation } from '../spec.js'

/** A refusal carries one of the five v20 codes (contract-v20.ts header). */
export class LocusRefusalError extends Error {
  readonly code: PetLocusErrorCodeV20
  constructor(code: PetLocusErrorCodeV20, message: string) {
    super(message)
    this.name = 'LocusRefusalError'
    this.code = code
  }
}

function refuse(code: PetLocusErrorCodeV20, message: string): never {
  throw new LocusRefusalError(code, message)
}

/** Provisioning operations that count as provisioning of an endpoint (not first-child publication). */
const PROVISIONING_KINDS = new Set(['ensure', 'rebind', 'migrate'])
/** A failed provisioning blocks its endpoint for this long, measured from its failure. */
const PROVISIONING_BLOCK_MS = 10 * 60_000
/** Provisioning phases that are still in flight: they always block their endpoint. */
const NON_TERMINAL_PROVISIONING = new Set(['prepared', 'provisioning', 'publishing', 'compensating', 'needs-recovery'])

/** Compensators a failed provisioning is cleaned with. */
export interface ProvisioningCompensatorsV20 {
  readonly mainSession?: (input: { readonly mainSessionId: string; readonly operationId: string }) => Promise<void>
  readonly locusMainSession?: (input: { readonly locusMainSessionId: string; readonly operationId: string }) => Promise<void>
  readonly chat?: (input: { readonly chatId: string; readonly operationId: string }) => Promise<void>
}

/**
 * Compensate one failed provisioning: locus-main first, then (for a chat op
 * only) the auto work session's main session and the chat. Rebind and migrate
 * reclaim the M1 they created and nothing else. Returns the compensated op, or
 * the failed op with lastError and its original updatedAt when a compensator throws.
 */
async function compensateFailedProvisioning(
  op: PetLocusOperation,
  now: number,
  compensators: ProvisioningCompensatorsV20,
  emit: (message: string) => void,
): Promise<PetLocusOperation> {
  const refs = op.resourceRefs ?? {}
  const done: Array<'locus-main-session' | 'main-session' | 'chat'> = []
  try {
    if (refs.locusMainSessionId !== undefined) {
      if (compensators.locusMainSession === undefined) throw new Error('no locus-main compensator is configured')
      await compensators.locusMainSession({ locusMainSessionId: refs.locusMainSessionId, operationId: op.id })
      done.push('locus-main-session')
    }
    if (op.operation === 'chat' && refs.mainSessionId !== undefined) {
      if (compensators.mainSession === undefined) throw new Error('no main-session compensator is configured')
      await compensators.mainSession({ mainSessionId: refs.mainSessionId, operationId: op.id })
      done.push('main-session')
    }
    if (op.operation === 'chat' && refs.chatId !== undefined) {
      if (compensators.chat === undefined) throw new Error('no chat compensator is configured')
      await compensators.chat({ chatId: refs.chatId, operationId: op.id })
      done.push('chat')
    }
    return { ...op, phase: 'compensated', compensatedResources: done, updatedAt: now, completedAt: now }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit(`provisioning ${op.id} compensation failed: ${message}`)
    return { ...op, lastError: message }
  }
}

/** Deliveries that have not reached a terminal status (D8 idle proof). */
/**
 * The zod-validated row types `endpoint.threadId` as an optional key, which
 * exactOptionalPropertyTypes rejects against delivery.ts's DeliveryRecord. The
 * row was parsed against the same schema the ledger writes, so the view is
 * representation-only.
 */
function asDeliveryRecord(row: LocusDeliveryRowV20): DeliveryRecord {
  return row as unknown as DeliveryRecord
}

const NON_TERMINAL_DELIVERY = new Set(['accepted', 'queued', 'running', 'current', 'finishing'])
/** Deliveries already handed to the runtime or in flight (D1 "current"). */
const CURRENT_DELIVERY = new Set(['queued', 'running', 'finishing', 'current'])
/** Operation phases that block the first creation of a child (D15 branch 0). */
const RECOVERABLE_OPERATION_PHASES = new Set(['prepared', 'provisioning', 'publishing', 'failed', 'compensating', 'needs-recovery'])
const RECOVERY_DEBT_PHASES = new Set(['publishing', 'compensating', 'needs-recovery'])

type TableName = 'loci' | 'locus_mains' | 'locus_deliveries' | 'locus_operations'
const DELETED = Symbol('deleted')

/** Read-your-writes overlay used while one write callback runs. */
/** Schema each table's records must satisfy at write time (the Domain only checks them at open). */
const WRITE_SCHEMAS: Partial<Record<TableName, { safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } } }>> = {
  loci: petLocusRowV20,
  locus_deliveries: petLocusDeliveryV20,
  locus_operations: petLocusOperation,
  locus_mains: petLocusMainRecord,
}

class Staged {
  private readonly writes = new Map<TableName, Map<string, unknown>>()
  constructor(private readonly domain: LocusDomain) {}

  private table(name: TableName): KvTable<string, unknown> {
    return this.domain.table(name) as KvTable<string, unknown>
  }

  get<T>(name: TableName, key: string): T | undefined {
    const staged = this.writes.get(name)?.get(key)
    if (staged !== undefined) return staged === DELETED ? undefined : (staged as T)
    return this.table(name).get(key) as T | undefined
  }

  /** Merged snapshot of a table: durable rows overlaid with staged writes. */
  all<T>(name: TableName): Map<string, T> {
    const out = new Map<string, T>()
    for (const [key, value] of this.table(name).entries()) out.set(key, value as T)
    for (const [key, value] of this.writes.get(name) ?? []) {
      if (value === DELETED) out.delete(key)
      else out.set(key, value as T)
    }
    return out
  }

  put(name: TableName, key: string, value: unknown): void {
    // Every write is checked against its table schema before it is staged, so no
    // record the Domain would reject at its next open can be committed.
    const schema = WRITE_SCHEMAS[name]
    if (schema !== undefined && value !== DELETED) {
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        refuse('INVALID_REQUEST', `${name} ${key} does not match its schema: ${(parsed.error?.issues ?? []).map(issue => issue.message).join('; ')}`)
      }
    }
    const map = this.writes.get(name) ?? new Map<string, unknown>()
    map.set(key, value)
    this.writes.set(name, map)
  }

  /** Commit every staged write as one transaction; refuse when the medium cannot. */
  async flush(domain: LocusDomain): Promise<void> {
    if (this.writes.size === 0) return
    if (domain.supportsTransaction !== true || typeof domain.transaction !== 'function') {
      refuse('INVALID_REQUEST', 'atomic locus transactions are unavailable on this storage medium')
    }
    const writes = this.writes
    await domain.transaction!(tx => {
      for (const [name, map] of writes) {
        for (const [key, value] of map) {
          if (value === DELETED) tx.delete(name, key)
          else tx.put(name, key, value)
        }
      }
    })
  }
}

export interface LocusRepositoryV20Options {
  readonly now?: () => number
}

/** The durable v20 implementation of {@link LocusRepositoryPortV20}. */
export class LocusRepositoryV20 implements LocusRepositoryPortV20 {
  /** Entries with an access change in flight (D8 `accessChanging`). */
  private readonly accessChanging = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => number

  constructor(private readonly domain: LocusDomain, options: LocusRepositoryV20Options = {}) {
    this.now = options.now ?? (() => 0)
  }

  /** True when the storage medium can commit a multi-table locus write atomically (provisioning requires it). */
  supportsAtomicProvisioning(): boolean {
    return this.domain.supportsTransaction === true && typeof this.domain.transaction === 'function'
  }

  /** Serialize one callback on this repository's write queue. */
  private enqueue<T>(body: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(body, body) as Promise<T>
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Run `body` against a staged overlay and commit it all or nothing. */
  private mutate<T>(body: (staged: Staged) => T): Promise<T> {
    return this.enqueue(async () => {
      const staged = new Staged(this.domain)
      const result = body(staged)
      await staged.flush(this.domain)
      return result
    })
  }

  // ---- snapshots ------------------------------------------------------------

  private loci(staged?: Staged): Map<string, LocusRowV20> {
    return staged ? staged.all<LocusRowV20>('loci') : this.snapshot<LocusRowV20>('loci')
  }

  private mains(staged?: Staged): Map<string, PetLocusMainRecord> {
    return staged ? staged.all<PetLocusMainRecord>('locus_mains') : this.snapshot<PetLocusMainRecord>('locus_mains')
  }

  private deliveries(staged?: Staged): Map<string, LocusDeliveryRowV20> {
    return staged ? staged.all<LocusDeliveryRowV20>('locus_deliveries') : this.snapshot<LocusDeliveryRowV20>('locus_deliveries')
  }

  private operations(staged?: Staged): Map<string, PetLocusOperation> {
    return staged ? staged.all<PetLocusOperation>('locus_operations') : this.snapshot<PetLocusOperation>('locus_operations')
  }

  private snapshot<T>(name: TableName): Map<string, T> {
    return new Map(this.domain.table(name).entries() as Iterable<[string, T]>)
  }

  /** The group row of a chat within a snapshot, if any. */
  private groupOf(loci: Map<string, LocusRowV20>, chatId: string): LocusGroupRowV20 | undefined {
    const row = loci.get(chatId)
    return row !== undefined && !isTopicRowV20(row) ? row : undefined
  }

  private resolve(loci: Map<string, LocusRowV20>, row: LocusRowV20): LocusResolvedRowV20 | undefined {
    const group = this.groupOf(loci, row.endpoint.chatId)
    if (group === undefined) return undefined
    return { row, locusMainSessionId: group.locusMainSessionId, workspaceId: group.workspaceId }
  }

  // ---- reads ----------------------------------------------------------------

  getLocus(locusId: string): LocusRowV20 | undefined {
    for (const row of this.loci().values()) if (row.locusId === locusId) return row
    return undefined
  }

  getRow(endpoint: { readonly chatId: string; readonly threadId?: string }): LocusRowV20 | undefined {
    return this.domain.table('loci').get(endpointKeyV20(endpoint)) as LocusRowV20 | undefined
  }

  listRowsOfChat(chatId: string): readonly LocusRowV20[] {
    const rows = [...this.loci().values()].filter(row => row.endpoint.chatId === chatId)
    return rows.sort((a, b) => Number(isTopicRowV20(a)) - Number(isTopicRowV20(b)))
  }

  listGroupRowsOfMain(locusMainSessionId: string): readonly LocusGroupRowV20[] {
    return [...this.loci().values()].filter(
      (row): row is LocusGroupRowV20 => !isTopicRowV20(row) && row.locusMainSessionId === locusMainSessionId,
    )
  }

  findBySessionId(sessionId: string): LocusResolvedRowV20 | undefined {
    const loci = this.loci()
    for (const row of loci.values()) if (row.sessionId === sessionId) return this.resolve(loci, row)
    return undefined
  }

  findDefaultQa(workSessionId: string): LocusGroupRowV20 | undefined {
    const active = this.findActiveMain(workSessionId)
    if (active === undefined) return undefined
    return this.listGroupRowsOfMain(active.locusMainSessionId).find(row => row.defaultQa === true)
  }

  findMain(locusMainSessionId: string): PetLocusMainRecord | undefined {
    return this.domain.table('locus_mains').get(locusMainSessionId) as PetLocusMainRecord | undefined
  }

  findActiveMain(workSessionId: string): PetLocusMainRecord | undefined {
    return this.listPairingsOfWork(workSessionId).find(main => main.status === 'active')
  }

  /** Every locus_mains pairing, active and retired (the collab directory's `owns` check). */
  listMains(): readonly PetLocusMainRecord[] {
    return [...this.mains().values()]
  }

  listPairingsOfWork(workSessionId: string): readonly PetLocusMainRecord[] {
    return [...this.mains().values()].filter(main => main.workSessionId === workSessionId)
  }

  hasCurrentDeliveryInChat(chatId: string): boolean {
    for (const delivery of this.deliveries().values()) {
      if (delivery.endpoint.chatId === chatId && CURRENT_DELIVERY.has(delivery.status)) return true
    }
    return false
  }

  hasNonTerminalDelivery(locusId: string): boolean {
    for (const delivery of this.deliveries().values()) {
      if (delivery.locusId === locusId && NON_TERMINAL_DELIVERY.has(delivery.status)) return true
    }
    return false
  }

  hasFirstDeliveryRecoveryDebt(locusId: string): boolean {
    for (const operation of this.operations().values()) {
      if (operation.locusId === locusId && RECOVERY_DEBT_PHASES.has(operation.phase)) return true
    }
    return false
  }

  // ---- provisioning ---------------------------------------------------------

  /** Compensators a failed provisioning is cleaned with (startup recovery uses the same set). */
  private compensators: ProvisioningCompensatorsV20 = {}
  private diagnosticSink: (message: string) => void = () => undefined

  setProvisioningCompensators(compensators: ProvisioningCompensatorsV20): void {
    this.compensators = compensators
  }

  setDiagnosticSink(sink: (message: string) => void): void {
    this.diagnosticSink = sink
  }

  /**
   * Open a provisioning operation for an endpoint. Any non-terminal provisioning
   * of that endpoint refuses (LOCUS_CONFLICT). A failed one blocks for 10 minutes
   * from its failure; after that it is compensated first, and only a successful
   * compensation lets this operation proceed. A failed compensation keeps the
   * failed operation (lastError, original updatedAt), emits a diagnostic, and refuses.
   */
  async beginProvisioning(input: LocusProvisioningBeginV20): Promise<void> {
    const endpointKey = endpointKeyV20({ chatId: input.chatId, ...(input.threadId === undefined ? {} : { threadId: input.threadId }) })
    await this.enqueue(async () => {
      const staged = new Staged(this.domain)
      if (staged.get('locus_operations', input.provisioningId) !== undefined) {
        refuse('LOCUS_CONFLICT', `provisioning ${input.provisioningId} already exists`)
      }
      const earlier = [...this.operations(staged).values()]
        .filter(op => op.endpointKey === endpointKey && PROVISIONING_KINDS.has(op.kind))
      for (const op of earlier) {
        if (NON_TERMINAL_PROVISIONING.has(op.phase)) {
          refuse('LOCUS_CONFLICT', `provisioning ${op.id} is still ${op.phase} for this endpoint`)
        }
        // The window only protects compensation of created resources: a failed
        // operation with nothing to reclaim must not hold the endpoint.
        const hasRefs = Object.values(op.resourceRefs ?? {}).some(value => value !== undefined)
        if (op.phase === 'failed' && hasRefs && input.startedAt - op.updatedAt < PROVISIONING_BLOCK_MS) {
          refuse('LOCUS_CONFLICT', `provisioning ${op.id} failed recently; retry after the block window`)
        }
      }
      for (const op of earlier.filter(candidate => candidate.phase === 'failed')) {
        const outcome = await compensateFailedProvisioning(op, input.startedAt, this.compensators, this.diagnosticSink)
        staged.put('locus_operations', op.id, outcome)
        if (outcome.phase !== 'compensated') {
          await staged.flush(this.domain)
          refuse('LOCUS_CONFLICT', `provisioning ${op.id} compensation failed; the next request retries it`)
        }
      }
      const operation: PetLocusOperation = {
        id: input.provisioningId,
        kind: input.kind === 'chat' ? 'ensure' : input.kind,
        phase: 'provisioning',
        operation: input.kind,
        // The endpoint is recorded by key only: resourceRefs.chatId means a Lark
        // chat THIS operation created (compensation deletes it), which is not
        // the case for rebind, migrate, or a topic on an existing chat.
        endpointKey,
        resourceRefs: {},
        step: 0,
        attempts: 0,
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
      }
      staged.put('locus_operations', input.provisioningId, operation)
      await staged.flush(this.domain)
    })
  }

  async recordProvisioningResource(provisioningId: string, resource: LocusProvisioningResourceV20): Promise<void> {
    await this.mutate(staged => {
      const operation = requireOperation(staged, provisioningId)
      staged.put('locus_operations', provisioningId, {
        ...operation,
        resourceRefs: { ...operation.resourceRefs, ...resource },
        updatedAt: this.now(),
      })
    })
  }

  async completeProvisioning(provisioningId: string): Promise<void> {
    await this.mutate(staged => this.setOperationPhase(staged, provisioningId, 'committed'))
  }

  async failProvisioning(provisioningId: string, reason: string, options?: { readonly reclaimed?: true }): Promise<void> {
    await this.mutate(staged => this.setOperationPhase(
      staged,
      provisioningId,
      options?.reclaimed === true ? 'compensated' : 'failed',
      reason,
    ))
  }

  private setOperationPhase(staged: Staged, id: string, phase: PetLocusOperation['phase'], lastError?: string): void {
    const operation = requireOperation(staged, id)
    const now = this.now()
    const terminal = phase === 'committed' || phase === 'failed'
    staged.put('locus_operations', id, {
      ...operation,
      phase,
      updatedAt: now,
      ...(terminal ? { completedAt: now } : {}),
      ...(lastError === undefined ? {} : { lastError }),
    })
  }

  /** D4: group row, optional topic row, optional new M, and the operation committed, as one transaction. */
  commitProvisioning(input: LocusCommitProvisioningInputV20): Promise<readonly LocusRowV20[]> {
    return this.mutate(staged => {
      const operation = staged.get<PetLocusOperation>('locus_operations', input.provisioningId)
      if (operation === undefined || operation.phase !== 'provisioning') {
        refuse('LOCUS_CONFLICT', `provisioning ${input.provisioningId} is not open`)
      }
      const [group, topic] = input.rows
      if (!petLocusGroupRowV20.safeParse(group).success) refuse('INVALID_REQUEST', 'group row does not match the v20 schema')
      if (topic !== undefined) {
        if (!petLocusTopicRowV20.safeParse(topic).success) refuse('INVALID_REQUEST', 'topic row does not match the v20 schema')
        if (topic.endpoint.chatId !== group.endpoint.chatId) refuse('INVALID_REQUEST', 'topic chatId differs from its group row')
      }

      const loci = this.loci(staged)
      const mains = this.mains(staged)
      const newRows: Array<[string, LocusRowV20]> = [[endpointKeyV20(group.endpoint), group]]
      if (topic !== undefined) newRows.push([endpointKeyV20(topic.endpoint), topic])
      for (const [key] of newRows) {
        if (loci.has(key)) refuse('LOCUS_CONFLICT', `an entry row already exists for ${key}`)
      }
      const main = input.main
      if (main !== undefined) {
        if (mains.has(main.locusMainSessionId)) refuse('LOCUS_CONFLICT', 'locusMainSessionId is already paired')
        if (main.status !== 'active') refuse('INVALID_REQUEST', 'a new pairing must be active')
        if ([...mains.values()].some(m => m.workSessionId === main.workSessionId && m.status === 'active')) {
          refuse('INVALID_REQUEST', 'the work session already has an active pairing')
        }
        mains.set(main.locusMainSessionId, main)
      }

      const next = new Map(loci)
      for (const [key, row] of newRows) next.set(key, row)
      const violations = validateLocusSetForStorage(next, new Set(mains.keys()))
      if (violations.length > 0) refuse('INVALID_REQUEST', violations[0]!.message)

      for (const [key, row] of newRows) staged.put('loci', key, row)
      if (main !== undefined) staged.put('locus_mains', main.locusMainSessionId, main)
      this.setOperationPhase(staged, input.provisioningId, 'committed')
      return newRows.map(([, row]) => row)
    })
  }

  /** D4 "group exists" branch: append a topic row under an existing group row; no operation. */
  addTopicRow(row: LocusTopicRowV20): Promise<LocusTopicRowV20> {
    return this.mutate(staged => {
      if (!petLocusTopicRowV20.safeParse(row).success) refuse('INVALID_REQUEST', 'topic row does not match the v20 schema')
      const loci = this.loci(staged)
      if (this.groupOf(loci, row.endpoint.chatId) === undefined) {
        refuse('LOCUS_NOT_FOUND', `no group row for chat ${row.endpoint.chatId}`)
      }
      const key = endpointKeyV20(row.endpoint)
      if (loci.has(key)) refuse('LOCUS_CONFLICT', `topic row ${key} already exists`)
      const next = new Map(loci)
      next.set(key, row)
      const violations = validateLocusSetForStorage(next, new Set(this.mains(staged).keys()))
      if (violations.length > 0) refuse('INVALID_REQUEST', violations[0]!.message)
      staged.put('loci', key, row)
      return row
    })
  }

  // ---- startup reconcile and recovery ports (A3 owns reconcile.ts) ----------

  /**
   * Startup gate for the whole loci set (spec: a topic row without its group row
   * keeps Pet from becoming ready). Runs the same set rules as the migration and
   * every write, and names every offending key.
   */
  assertLocusSetValid(): void {
    const violations = validateLocusSetForStorage(this.snapshot<unknown>('loci'), new Set(this.mains().keys()))
    if (violations.length > 0) {
      refuse('INVALID_REQUEST', `loci set is invalid: ${violations.map(violation => `${violation.key} (${violation.code}: ${violation.message})`).join('; ')}`)
    }
  }

  /** Startup gate: every group row's M must have a locus_mains pairing. */
  assertEveryGroupMainPaired(): void {
    const mains = this.mains()
    const orphaned = [...this.loci().values()]
      .filter((row): row is LocusGroupRowV20 => !isTopicRowV20(row) && !mains.has(row.locusMainSessionId))
      .map(row => endpointKeyV20(row.endpoint))
    if (orphaned.length > 0) {
      refuse('INVALID_REQUEST', `group rows without a locus_mains pairing: ${orphaned.join(', ')}`)
    }
  }

  listRows(): readonly LocusRowV20[] {
    return [...this.loci().values()]
  }

  listRecoverableOperations(): readonly PetLocusOperation[] {
    return [...this.operations().values()].filter(op => RECOVERABLE_OPERATION_PHASES.has(op.phase))
  }

  getOperation(id: string): PetLocusOperation | undefined {
    return this.domain.table('locus_operations').get(id) as PetLocusOperation | undefined
  }

  listPendingDeliveries(): readonly DeliveryRecord[] {
    return [...this.deliveries().values()].filter(delivery => NON_TERMINAL_DELIVERY.has(delivery.status)).map(asDeliveryRecord)
  }

  getDelivery(id: string): DeliveryRecord | undefined {
    const row = this.domain.table('locus_deliveries').get(id) as LocusDeliveryRowV20 | undefined
    return row === undefined ? undefined : asDeliveryRecord(row)
  }

  /** CAS on the Delivery revision: refuses LOCUS_CONFLICT when `prev` is stale. Writes revision + 1. */
  putDeliveryCas(prev: DeliveryRecord, next: DeliveryRecord): Promise<void> {
    return this.mutate(staged => {
      const current = staged.get<LocusDeliveryRowV20>('locus_deliveries', prev.deliveryId)
      if (current === undefined) refuse('LOCUS_NOT_FOUND', `delivery ${prev.deliveryId} is unknown`)
      if ((current.revision ?? 0) !== (prev.revision ?? 0)) refuse('LOCUS_CONFLICT', 'the delivery revision moved')
      // revision and stateRevision move together: the schema requires them equal, and the Domain rejects a row where they differ at the next open.
      const revision = (prev.revision ?? 0) + 1
      staged.put('locus_deliveries', next.deliveryId, { ...next, revision, stateRevision: revision })
    })
  }

  putOperation(op: PetLocusOperation): Promise<void> {
    return this.mutate(staged => {
      staged.put('locus_operations', op.id, op)
    })
  }

  // ---- Delivery acceptance (D3, D8; one queue with acquireAccessChange) -----

  listDeliveries(locusId?: string): readonly DeliveryRecord[] {
    const all = [...this.deliveries().values()]
    return (locusId === undefined ? all : all.filter(delivery => delivery.locusId === locusId)).map(asDeliveryRecord)
  }

  /**
   * Settle a Delivery that the runtime refused before any turn: accepted or
   * queued (with the matching executionId) becomes failed with
   * dispatchFailure `not-queued` / `queued-not-started`. The exact correlation
   * must match; a second call on an already dispatch-failed row is a no-op true.
   */
  failBeforeDispatch(input: {
    readonly deliveryId: string
    readonly correlation: { readonly endpoint: { readonly chatId: string; readonly threadId?: string | undefined }; readonly locusId: string; readonly sessionId: string }
    readonly reason: string
    readonly executionId?: string
    readonly failedAt?: number
  }): Promise<boolean> {
    return this.mutate(staged => {
      const current = staged.get<LocusDeliveryRowV20>('locus_deliveries', input.deliveryId)
      if (current === undefined) return false
      const { endpoint, locusId, sessionId } = input.correlation
      if (current.locusId !== locusId || current.sessionId !== sessionId || endpointKeyV20(current.endpoint) !== endpointKeyV20(endpoint)) return false
      if (current.status === 'failed' && current.dispatchFailure !== undefined) return true
      if (current.status !== 'accepted' && current.status !== 'queued' && current.status !== 'current') return false
      if (current.status === 'queued') {
        if (input.executionId === undefined || current.executionId !== input.executionId) return false
      } else if (current.executionId !== undefined || current.inboxMessageId !== undefined) {
        return false
      }
      const failedAt = Math.max(input.failedAt ?? this.now(), current.queuedAt ?? current.acceptedAt ?? 0)
      const { queueState: _queueState, ...withoutQueueState } = current
      const next = {
        ...withoutQueueState,
        status: 'failed',
        dispatchFailure: current.status === 'queued' ? 'queued-not-started' : 'not-queued',
        failedAt,
        failureReason: input.reason,
      }
      const parsed = petLocusDeliveryV20.safeParse(next)
      if (!parsed.success) refuse('INVALID_REQUEST', `the dispatch failure does not match the v20 schema: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
      staged.put('locus_deliveries', next.deliveryId, next as LocusDeliveryRowV20)
      return true
    })
  }

  /** The one current or finishing Delivery of an entry, by exact (locusId, sessionId). */
  findCurrentSerializedDelivery(input: { readonly locusId: string; readonly sessionId: string }): DeliveryRecord | undefined {
    const matches = [...this.deliveries().values()].filter(delivery =>
      (delivery.status === 'current' || delivery.status === 'finishing') && delivery.queueState === 'current'
      && delivery.locusId === input.locusId && delivery.sessionId === input.sessionId,
    )
    return matches.length === 1 ? asDeliveryRecord(matches[0]!) : undefined
  }

  /**
   * The one pending Delivery of an entry with an exact execution and turn proof.
   * Without both proofs there is no answer (v19 contract). A current or finishing
   * row matches on any turn once it has one.
   */
  findCurrentDelivery(input: {
    readonly locusId: string
    readonly sessionId: string
    readonly executionId?: string
    readonly turnId?: string
  }): DeliveryRecord | undefined {
    if (input.executionId === undefined || input.turnId === undefined) return undefined
    const executionId = input.executionId
    const turnId = input.turnId
    const matches = [...this.deliveries().values()].filter(delivery =>
      NON_TERMINAL_DELIVERY.has(delivery.status)
      && delivery.locusId === input.locusId && delivery.sessionId === input.sessionId
      && delivery.executionId === executionId
      && (delivery.turnId === turnId
        || ((delivery.status === 'current' || delivery.status === 'finishing') && delivery.turnId !== undefined)),
    )
    return matches.length === 1 ? asDeliveryRecord(matches[0]!) : undefined
  }

  /** v19 callers' name for a pre-turn refusal; same semantics as failBeforeDispatch. */
  fail(input: {
    readonly deliveryId: string
    readonly correlation: { readonly endpoint: { readonly chatId: string; readonly threadId?: string | undefined }; readonly locusId: string; readonly sessionId: string }
    readonly reason: string
    readonly executionId?: string
  }): Promise<boolean> {
    return this.failBeforeDispatch(input)
  }

  findDeliveryByInboxMessageId(inboxMessageId: string): DeliveryRecord | undefined {
    const row = [...this.deliveries().values()].find(delivery => delivery.inboxMessageId === inboxMessageId)
    return row === undefined ? undefined : asDeliveryRecord(row)
  }

  /** v19 callers' name for "the entry has a pending delivery": in v20, any non-terminal one. */
  hasPendingDeliveries(locusId: string): boolean {
    return this.hasNonTerminalDelivery(locusId)
  }

  findDeliveryByMessageId(messageId: string): DeliveryRecord | undefined {
    const row = [...this.deliveries().values()].find(delivery => delivery.messageId === messageId)
    return row === undefined ? undefined : asDeliveryRecord(row)
  }

  /**
   * D3/D8. Accept one platform message for an entry, inside the write queue:
   * a duplicate messageId returns the original record; otherwise the entry must
   * exist, not be changing access, be not-created or active, reserve exactly this
   * sessionId, and match the endpoint. The Delivery starts `accepted` in the
   * backlog with no execution, inbox, or turn proof.
   */
  acceptDelivery(input: DeliveryInput): Promise<{ readonly record: DeliveryRecord; readonly duplicate: boolean; readonly conflict: boolean }> {
    return this.mutate(staged => {
      const duplicate = [...this.deliveries(staged).values()].find(delivery => delivery.messageId === input.messageId)
      if (duplicate !== undefined) {
        const conflict = duplicate.locusId !== input.locusId || duplicate.sessionId !== input.sessionId
          || endpointKeyV20(duplicate.endpoint) !== endpointKeyV20(input.endpoint)
        return { record: asDeliveryRecord(duplicate), duplicate: true, conflict }
      }
      const row = [...this.loci(staged).values()].find(candidate => candidate.locusId === input.locusId)
      if (row === undefined) refuse('LOCUS_NOT_FOUND', `locus ${input.locusId} is unknown`)
      if (this.accessChanging.has(input.locusId)) refuse('LOCUS_BUSY', 'the entry is changing access')
      if (row.state === 'stopped' || row.state === 'invalid') refuse('INVALID_REQUEST', `the entry is ${row.state}`)
      if (row.sessionId !== input.sessionId) refuse('LOCUS_CONFLICT', 'the delivery sessionId is not the entry reservation')
      if (endpointKeyV20(row.endpoint) !== endpointKeyV20(input.endpoint)) refuse('INVALID_REQUEST', 'the endpoint does not match the entry')

      const sequence = Math.max(0, ...[...this.deliveries(staged).values()].map(delivery => delivery.sequence)) + 1
      const acceptedAt = input.acceptedAt ?? this.now()
      const rootMessageId = input.rootMessageId ?? input.replyTarget?.rootMessageId
      const record = {
        deliveryId: input.deliveryId ?? `delivery-${sequence}`,
        messageId: input.messageId,
        ...(rootMessageId !== undefined ? { rootMessageId } : {}),
        endpoint: { ...input.endpoint },
        locusId: input.locusId,
        sessionId: input.sessionId,
        ...(input.senderOpenId !== undefined ? { senderOpenId: input.senderOpenId } : {}),
        ...(input.senderName !== undefined ? { senderName: input.senderName } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.addressing !== undefined ? { addressing: input.addressing } : {}),
        ...(input.docComment !== undefined ? { docComment: input.docComment } : {}),
        ...(input.replyTarget !== undefined ? { replyTarget: input.replyTarget } : {}),
        ...(input.replyToMessageId !== undefined ? { replyToMessageId: input.replyToMessageId } : {}),
        sequence,
        status: 'accepted',
        queueState: 'backlog',
        acceptedAt,
        deadlineAt: acceptedAt + DEFAULT_DELIVERY_LEASE_MS,
        hardDeadlineAt: acceptedAt + MAX_DELIVERY_LEASE_MS,
        revision: 0,
        stateRevision: 0,
        outboundResult: 'none',
        feedbackTarget: {
          chatId: input.endpoint.chatId,
          ...(input.endpoint.threadId !== undefined ? { threadId: input.endpoint.threadId } : {}),
          messageId: input.messageId,
          ...(rootMessageId !== undefined ? { rootMessageId } : {}),
        },
      }
      if (!petLocusDeliveryV20.safeParse(record).success) refuse('INVALID_REQUEST', 'the accepted delivery does not match the v20 schema')
      staged.put('locus_deliveries', record.deliveryId, record)
      return { record: asDeliveryRecord(record as LocusDeliveryRowV20), duplicate: false, conflict: false }
    })
  }

  // ---- first-child publication and compensation (D15, D16) -----------------

  /** The row named by the first-creation identity: sessionId and revision must both still match. */
  private firstIdentityRow(staged: Staged, identity: { readonly locusId: string; readonly sessionId: string; readonly revision: number }): LocusRowV20 {
    const row = [...this.loci(staged).values()].find(candidate => candidate.locusId === identity.locusId)
    if (row === undefined) refuse('LOCUS_NOT_FOUND', `locus ${identity.locusId} is unknown`)
    if (row.sessionId !== identity.sessionId) refuse('LOCUS_CONFLICT', 'the entry reservation moved')
    if (row.revision !== identity.revision) refuse('LOCUS_CONFLICT', 'the entry revision moved')
    return row
  }

  /**
   * D16 rotation of the first-child reservation: revision + 1, a fresh sessionId,
   * state not-created, accessMode and grantedBy kept, verifiedAt cleared. Retargets
   * uninjected backlog, but never the trigger Delivery (`exceptDeliveryId`).
   */
  private rotateFirstChild(
    staged: Staged,
    row: LocusRowV20,
    exceptDeliveryId: string,
    reserveChildSessionId: () => string,
    now: number,
  ): string {
    const { verifiedAt: _verifiedAt, stoppedAt: _stoppedAt, invalidReason: _invalidReason, ...kept } = row
    const sessionId = reserveChildSessionId()
    const next = { ...kept, state: 'not-created', sessionId, revision: row.revision + 1, updatedAt: now } as LocusRowV20
    staged.put('loci', endpointKeyV20(next.endpoint), next)
    for (const delivery of this.deliveries(staged).values()) {
      if (delivery.locusId !== row.locusId || delivery.deliveryId === exceptDeliveryId || !isUninjected(delivery)) continue
      staged.put('locus_deliveries', delivery.deliveryId, { ...delivery, sessionId })
    }
    return sessionId
  }

  /** Settle the trigger Delivery failed on its CURRENT (old) sessionId. */
  private settleTriggerFailed(staged: Staged, deliveryId: string, reason: string, now: number): void {
    const trigger = staged.get<LocusDeliveryRowV20>('locus_deliveries', deliveryId)
    if (trigger === undefined) return
    // A terminal record carries no queue position: queueState current requires an in-flight status.
    const { queueState: _queueState, ...terminal } = trigger
    const failed = { ...terminal, status: 'failed', failedAt: now, failureReason: reason }
    const parsed = petLocusDeliveryV20.safeParse(failed)
    if (!parsed.success) refuse('INVALID_REQUEST', `the failed trigger delivery does not match the v20 schema: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
    staged.put('locus_deliveries', deliveryId, failed)
  }

  /**
   * D15. The first prompt is about to be published: the not-created row becomes
   * active at the SAME revision (accessMode and grant kept); the trigger
   * Delivery is stamped with the executionId; the publishing operation is
   * written fenced on the row revision. One write.
   */
  publishFirstDelivery(input: LocusFirstDeliveryIdentityV20 & { readonly executionId: string }): Promise<void> {
    return this.mutate(staged => {
      const row = this.firstIdentityRow(staged, input)
      if (this.accessChanging.has(input.locusId)) refuse('LOCUS_BUSY', 'the entry is changing access')
      if (row.state !== 'not-created') refuse('LOCUS_CONFLICT', `the entry is ${row.state}, not not-created`)
      const group = this.groupOf(this.loci(staged), row.endpoint.chatId)
      if (group === undefined) refuse('LOCUS_NOT_FOUND', `no group row for chat ${row.endpoint.chatId}`)
      const trigger = staged.get<LocusDeliveryRowV20>('locus_deliveries', input.deliveryId)
      if (trigger === undefined || trigger.sessionId !== input.sessionId || trigger.status !== 'current') {
        refuse('LOCUS_CONFLICT', 'the trigger delivery is not the current delivery of this reservation')
      }
      const operationId = `first-child:${input.executionId}`
      if (staged.get('locus_operations', operationId) !== undefined) refuse('LOCUS_CONFLICT', `operation ${operationId} already exists`)
      staged.put('locus_operations', operationId, {
        id: operationId,
        kind: 'delivery',
        operation: 'first-child-publication',
        phase: 'publishing',
        locusId: input.locusId,
        deliveryId: input.deliveryId,
        endpointKey: endpointKeyV20(row.endpoint),
        expectedRevision: input.revision,
        resourceRefs: { parentSessionId: group.locusMainSessionId, childSessionId: input.sessionId },
        step: 0,
        attempts: 0,
        createdAt: input.now,
        updatedAt: input.now,
      })
      staged.put('loci', endpointKeyV20(row.endpoint), { ...row, state: 'active', updatedAt: input.now })
      const stamped = { ...trigger, executionId: input.executionId }
      if (!petLocusDeliveryV20.safeParse(stamped).success) refuse('INVALID_REQUEST', 'the stamped trigger delivery does not match the v20 schema')
      staged.put('locus_deliveries', input.deliveryId, stamped)
    })
  }

  /** Close the publishing operation after the first prompt is bound. */
  commitFirstDelivery(input: { readonly executionId: string; readonly now: number }): Promise<void> {
    return this.mutate(staged => {
      const operationId = `first-child:${input.executionId}`
      const operation = requireOperation(staged, operationId)
      if (operation.phase !== 'publishing') refuse('LOCUS_CONFLICT', `operation ${operationId} is ${operation.phase}, not publishing`)
      staged.put('locus_operations', operationId, { ...operation, phase: 'committed', updatedAt: input.now, completedAt: input.now })
    })
  }

  /**
   * D16, before publication: settle the trigger failed on the old sessionId,
   * then rotate exactly as rotateReservation (state, accessMode and grant kept).
   */
  failFirstDeliveryCreation(input: LocusFirstDeliveryIdentityV20 & { readonly reserveChildSessionId: () => string }): Promise<void> {
    return this.mutate(staged => {
      const row = this.firstIdentityRow(staged, input)
      const trigger = staged.get<LocusDeliveryRowV20>('locus_deliveries', input.deliveryId)
      if (trigger === undefined || trigger.sessionId !== input.sessionId) refuse('LOCUS_CONFLICT', 'the trigger delivery is not on this reservation')
      this.settleTriggerFailed(staged, input.deliveryId, 'first child creation failed', input.now)
      this.rotateFirstChild(staged, row, input.deliveryId, input.reserveChildSessionId, input.now)
    })
  }

  /**
   * D16 / startup compensation. Three forms, one write each:
   * - default: rotate; the trigger Delivery settles failed on its OLD sessionId;
   *   operation compensated.
   * - retryText: rotate; THIS Delivery is retargeted to the new sessionId,
   *   unsettled, marked imageRouteRejected.
   * - recoveryDebt: no rotation; the publication operation is left needs-recovery,
   *   which hasFirstDeliveryRecoveryDebt reports.
   */
  revertFirstDelivery(input: LocusFirstDeliveryIdentityV20 & {
    readonly executionId?: string
    readonly retryText?: true
    readonly recoveryDebt?: true
    readonly reserveChildSessionId?: () => string
  }): Promise<void> {
    return this.mutate(staged => {
      const row = this.firstIdentityRow(staged, input)
      if (input.recoveryDebt === true) {
        const operationId = input.executionId === undefined ? `first-child-debt:${input.deliveryId}` : `first-child:${input.executionId}`
        const existing = staged.get<PetLocusOperation>('locus_operations', operationId)
        staged.put('locus_operations', operationId, existing === undefined
          ? {
            id: operationId, kind: 'delivery', operation: 'first-child-publication', phase: 'needs-recovery',
            locusId: input.locusId, deliveryId: input.deliveryId, endpointKey: endpointKeyV20(row.endpoint),
            expectedRevision: input.revision, step: 0, attempts: 0, createdAt: input.now, updatedAt: input.now,
          }
          : { ...existing, phase: 'needs-recovery', updatedAt: input.now })
        return
      }
      if (input.reserveChildSessionId === undefined) refuse('INVALID_REQUEST', 'reserveChildSessionId is required unless recoveryDebt')
      const sessionId = this.rotateFirstChild(staged, row, input.deliveryId, input.reserveChildSessionId, input.now)
      if (input.retryText === true) {
        const trigger = staged.get<LocusDeliveryRowV20>('locus_deliveries', input.deliveryId)
        if (trigger !== undefined) {
          // Unissued again: the text retry is a fresh first prompt, so no execution, inbox or turn proof survives.
          const { executionId: _executionId, inboxMessageId: _inboxMessageId, turnId: _turnId, ...rest } = trigger
          const retargeted = { ...rest, sessionId, imageRouteRejected: true }
          if (!petLocusDeliveryV20.safeParse(retargeted).success) refuse('INVALID_REQUEST', 'the retargeted trigger delivery does not match the v20 schema')
          staged.put('locus_deliveries', input.deliveryId, retargeted)
        }
      } else {
        this.settleTriggerFailed(staged, input.deliveryId, 'first child publication reverted', input.now)
      }
      if (input.executionId !== undefined) {
        const operationId = `first-child:${input.executionId}`
        const operation = requireOperation(staged, operationId)
        staged.put('locus_operations', operationId, { ...operation, phase: 'compensated', updatedAt: input.now, completedAt: input.now })
      }
    })
  }

  // ---- Delivery lifecycle (D3): pure transitions over the staged rows ------

  /** The pure ledger view of the staged Delivery rows, keyed both ways. */
  private ledgerState(staged: Staged): DeliveryLedgerState {
    const rows = [...this.deliveries(staged).values()]
    return {
      byMessageId: Object.fromEntries(rows.map(row => [row.messageId, row])) as unknown as DeliveryLedgerState['byMessageId'],
      byDeliveryId: Object.fromEntries(rows.map(row => [row.deliveryId, row])) as unknown as DeliveryLedgerState['byDeliveryId'],
      nextDeliverySequence: Math.max(0, ...rows.map(row => row.sequence)) + 1,
    }
  }

  /**
   * Apply one pure transition; persist its record only when it changed the
   * ledger. The stored record keeps stateRevision equal to revision (schema
   * invariant), as the v19 wrappers did.
   */
  private applyDelivery(staged: Staged, apply: (state: DeliveryLedgerState) => DeliveryMutation): DeliveryMutation {
    const result = apply(this.ledgerState(staged))
    if (!result.changed || result.record === undefined) return result
    const record = result.record.revision === undefined ? result.record : { ...result.record, stateRevision: result.record.revision }
    const parsed = petLocusDeliveryV20.safeParse(record)
    if (!parsed.success) refuse('INVALID_REQUEST', `the Delivery transition does not match the v20 schema: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
    staged.put('locus_deliveries', record.deliveryId, record)
    return { ...result, record }
  }

  claimCurrentDelivery(input: DeliveryCurrentClaimInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureClaim(state, input)))
  }

  bindQueued(input: DeliveryQueuedBindingInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureBindQueued(state, input)))
  }

  bindTurn(input: DeliveryTurnBindingInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureBindTurn(state, input)))
  }

  bindDeliveryTurn(input: DeliveryTurnBindingInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureBindDeliveryTurn(state, input)))
  }

  markDeliveryFinishing(input: DeliveryLeaseInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureMarkFinishing(state, input)))
  }

  completeCurrentDelivery(input: DeliveryFinishInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureComplete(state, input)))
  }

  waitCurrentDelivery(input: DeliveryWaitInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureWait(state, input)))
  }

  abandonRefusedDelivery(input: DeliveryLeaseInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureAbandonRefused(state, input)))
  }

  abandonInterruptedDelivery(input: DeliveryLeaseInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureAbandonInterrupted(state, input)))
  }

  expireCurrentDelivery(input: DeliveryLeaseInput): Promise<DeliveryMutation> {
    return this.mutate(staged => this.applyDelivery(staged, state => pureExpire(state, input)))
  }

  /**
   * Terminal settlement by an exact turn proof. A `current` Delivery interrupted
   * before its turn ran (failureReason turn-interrupted) is abandoned instead, and
   * that path needs the inbox id, the revision, and an active entry with the same
   * sessionId (v19 contract). Every other status goes through the pure transition.
   */
  settleByTurn(input: DeliverySettlementInput & {
    readonly deliveryId: string
    readonly inboxMessageId?: string
    readonly expectedRevision?: number
  }): Promise<DeliveryMutation> {
    return this.mutate(staged => {
      const current = staged.get<LocusDeliveryRowV20>('locus_deliveries', input.deliveryId)
      const interruptedCurrent = current !== undefined && current.status === 'current'
        && input.outcome === 'failed' && input.failureReason === 'turn-interrupted'
      if (!interruptedCurrent) return this.applyDelivery(staged, state => pureSettleByTurn(state, input))
      const state = this.ledgerState(staged)
      const refused = (reason: DeliveryMutation['reason']): DeliveryMutation => ({ state, record: current as never, changed: false, reason })
      if (current.executionId !== input.executionId || current.turnId !== input.correlation.turnId) return refused('correlation-mismatch')
      if (input.inboxMessageId === undefined || current.inboxMessageId !== input.inboxMessageId) return refused('correlation-mismatch')
      const expectedRevision = input.expectedRevision
      if (expectedRevision === undefined || current.revision !== expectedRevision) return refused('revision-mismatch')
      const row = [...this.loci(staged).values()].find(candidate => candidate.locusId === current.locusId)
      if (row === undefined || row.state !== 'active' || row.sessionId !== current.sessionId) return refused('correlation-mismatch')
      return this.applyDelivery(staged, state => pureAbandonInterrupted(state, {
        endpoint: input.correlation.endpoint,
        locusId: input.correlation.locusId,
        sessionId: input.correlation.sessionId,
        deliveryId: input.deliveryId,
        expectedRevision,
        now: input.settledAt,
      }))
    })
  }

  // ---- access change fence (D8) ---------------------------------------------

  /** D8 step 1: a short check-and-add inside the queue; never held across external work. */
  acquireAccessChange(locusId: string, expectedRevision?: number): Promise<{ readonly locusId: string; readonly revision: number }> {
    return this.enqueue(() => {
      const row = this.getLocus(locusId)
      if (row === undefined) refuse('LOCUS_NOT_FOUND', `locus ${locusId} is unknown`)
      // The client fence is checked here, after every commit queued before it.
      if (expectedRevision !== undefined && row.revision !== expectedRevision) refuse('LOCUS_CONFLICT', 'the entry revision moved')
      if (row.state === 'stopped' || row.state === 'invalid') {
        refuse('INVALID_REQUEST', `access changes need a not-created or active entry, not ${row.state}`)
      }
      if (this.accessChanging.has(locusId)) refuse('LOCUS_BUSY', 'an access change is already in progress')
      if (this.hasNonTerminalDelivery(locusId)) refuse('LOCUS_BUSY', 'the entry has a non-terminal delivery')
      this.accessChanging.add(locusId)
      return { locusId, revision: row.revision }
    })
  }

  releaseAccessChange(locusId: string): void {
    this.accessChanging.delete(locusId)
  }

  isAccessChanging(locusId: string): boolean {
    return this.accessChanging.has(locusId)
  }

  // ---- first creation (D16) --------------------------------------------------

  /**
   * D16. Reserve a new `sessionId` after a creation failure: `revision + 1`,
   * `accessMode` and `state` kept. Retargets uninjected backlog and the
   * pre-prompt trigger Delivery; the failed Delivery keeps its old association.
   */
  rotateReservation(input: LocusRotateReservationInputV20): Promise<LocusRotateReservationResultV20> {
    return this.mutate(staged => {
      const found = [...this.loci(staged).values()].find(row => row.locusId === input.locusId)
      if (found === undefined) refuse('LOCUS_NOT_FOUND', `locus ${input.locusId} is unknown`)
      if (found.revision !== input.expectedRevision) refuse('LOCUS_CONFLICT', 'the entry revision moved')
      if (found.sessionId !== input.failedSessionId) refuse('LOCUS_CONFLICT', 'the failed sessionId is no longer the reservation')

      const { verifiedAt: _verifiedAt, ...kept } = found
      const row = { ...kept, sessionId: input.reserveChildSessionId(), revision: found.revision + 1, updatedAt: input.now } as LocusRowV20
      staged.put('loci', endpointKeyV20(row.endpoint), row)

      const retargetedDeliveryIds: string[] = []
      for (const delivery of this.deliveries(staged).values()) {
        if (delivery.locusId !== input.locusId) continue
        const uninjected = delivery.status === 'accepted' && delivery.queueState === 'backlog'
          && delivery.executionId === undefined && delivery.inboxMessageId === undefined && delivery.turnId === undefined
        if (!uninjected && delivery.deliveryId !== input.retargetDeliveryId) continue
        staged.put('locus_deliveries', delivery.deliveryId, { ...delivery, sessionId: row.sessionId })
        retargetedDeliveryIds.push(delivery.deliveryId)
      }
      return { row, retargetedDeliveryIds }
    })
  }

  // ---- not yet landed (2A.5, 2A.6, 2A.8) ------------------------------------

  /** D17 host: `body` runs as one write callback; a throw rolls the whole callback back. */
  write<T>(body: (tx: LocusWriteTxV20) => T): Promise<T> {
    return this.mutate(staged => body({
      resetChat: (chatId, options) => this.resetChatIn(staged, chatId, options),
    }))
  }

  /** D17: one chat's reset, inside the caller's staged callback. */
  private resetChatIn(staged: Staged, chatId: string, options: LocusResetChatOptionsV20): LocusResetChatResultV20 {
    const loci = this.loci(staged)
    const group = loci.get(chatId)
    if (group === undefined || isTopicRowV20(group)) refuse('LOCUS_NOT_FOUND', `no group row for chat ${chatId}`)
    const chatEntries = [...loci.entries()].filter(([, row]) => row.endpoint.chatId === chatId)
    for (const delivery of this.deliveries(staged).values()) {
      if (delivery.endpoint.chatId === chatId && CURRENT_DELIVERY.has(delivery.status)) {
        refuse('LOCUS_BUSY', `chat ${chatId} has a current delivery`)
      }
    }
    for (const [, row] of chatEntries) {
      if (this.accessChanging.has(row.locusId)) refuse('LOCUS_BUSY', `entry ${row.locusId} is changing access`)
    }
    for (const [key, expected] of Object.entries(options.expectedRevisions ?? {})) {
      const row = loci.get(key)
      if (row === undefined) continue
      if (row.revision !== expected) refuse('LOCUS_CONFLICT', `entry ${key} revision moved`)
    }

    const next = new Map(loci)
    const newSessionByLocus = new Map<string, string>()
    const written: LocusRowV20[] = []
    for (const [key, row] of chatEntries) {
      let base: Record<string, unknown> = { ...row }
      if (key === chatId) {
        base = { ...base, locusMainSessionId: options.toM }
        if (options.workspaceId !== undefined) base.workspaceId = options.workspaceId
        if (options.reboundFrom !== undefined) base.reboundFrom = options.reboundFrom
        if (options.clearDefaultQa === true) delete base.defaultQa
      }
      const fresh = resetLifecycle(base, options.now, options.reserveChildSessionId)
      if (fresh.state === 'not-created') newSessionByLocus.set(row.locusId, fresh.sessionId as string)
      next.set(key, fresh as LocusRowV20)
      written.push(fresh as LocusRowV20)
    }

    const mains = this.mains(staged)
    const violations = validateLocusSetForStorage(next, new Set(mains.keys()))
    if (violations.length > 0) refuse('INVALID_REQUEST', violations[0]!.message)
    for (const row of written) staged.put('loci', endpointKeyV20(row.endpoint), row)

    const retargetedDeliveryIds: string[] = []
    for (const delivery of this.deliveries(staged).values()) {
      if (delivery.endpoint.chatId !== chatId || !isUninjected(delivery)) continue
      const sessionId = newSessionByLocus.get(delivery.locusId)
      if (sessionId === undefined) continue
      staged.put('locus_deliveries', delivery.deliveryId, { ...delivery, sessionId })
      retargetedDeliveryIds.push(delivery.deliveryId)
    }
    return { rows: written.filter(row => row.endpoint.chatId === chatId).sort((a, b) => Number(isTopicRowV20(a)) - Number(isTopicRowV20(b))), retargetedDeliveryIds }
  }

  /** D7: idle-only stop of one row; its topic rows are not touched. */
  stopRow(fence: LocusRowFenceV20, now: number): Promise<LocusRowV20> {
    return this.mutate(staged => {
      const row = fencedRow(this.loci(staged), fence)
      this.assertIdle(staged, row)
      const next = { ...withoutLifecycleGrant(row), state: 'stopped', stoppedAt: now, revision: row.revision + 1, updatedAt: now } as LocusRowV20
      staged.put('loci', endpointKeyV20(next.endpoint), next)
      return next
    })
  }

  /** D7: same-W /bind of a stopped row restarts only that row, with a fresh reservation. */
  reenableRow(fence: LocusRowFenceV20, now: number, reserveChildSessionId: () => string): Promise<LocusRowV20> {
    return this.mutate(staged => {
      const row = fencedRow(this.loci(staged), fence)
      if (row.state !== 'stopped') refuse('INVALID_REQUEST', `only a stopped entry can be re-enabled, not ${row.state}`)
      const { stoppedAt: _stoppedAt, ...live } = withoutLifecycleGrant(row)
      const next = { ...live, state: 'not-created', sessionId: reserveChildSessionId(), accessMode: 'read-only', revision: row.revision + 1, updatedAt: now } as LocusRowV20
      staged.put('loci', endpointKeyV20(next.endpoint), next)
      return next
    })
  }

  /** D7 class A: mark the row invalid with a reason; the next authorized @ rebuilds it. */
  markInvalid(fence: LocusRowFenceV20, reason: string, now: number): Promise<LocusRowV20> {
    return this.mutate(staged => {
      const row = fencedRow(this.loci(staged), fence)
      const { stoppedAt: _stoppedAt, ...kept } = row
      const next = { ...kept, state: 'invalid', invalidReason: reason, revision: row.revision + 1, updatedAt: now } as LocusRowV20
      staged.put('loci', endpointKeyV20(next.endpoint), next)
      return next
    })
  }

  /** D7: in-place rebuild of an invalid row (same locusId) with a fresh reservation. */
  rebuildRowInPlace(fence: LocusRowFenceV20, now: number, reserveChildSessionId: () => string): Promise<LocusRowV20> {
    return this.mutate(staged => {
      const row = fencedRow(this.loci(staged), fence)
      if (row.state !== 'invalid') refuse('INVALID_REQUEST', `only an invalid entry rebuilds in place, not ${row.state}`)
      this.assertRebuildable(staged, row)
      const next = resetLifecycle({ ...row }, now, reserveChildSessionId) as LocusRowV20
      staged.put('loci', endpointKeyV20(next.endpoint), next)
      for (const delivery of this.deliveries(staged).values()) {
        if (delivery.locusId !== row.locusId || !isUninjected(delivery)) continue
        staged.put('locus_deliveries', delivery.deliveryId, { ...delivery, sessionId: next.sessionId })
      }
      return next
    })
  }

  /**
   * Rebuild refuses only what is in flight (an access change, or a Delivery the
   * runtime has issued). An uninjected accepted backlog has no execution evidence and
   * is retargeted to the new reservation by the caller, so it does not block the rebuild.
   */
  private assertRebuildable(staged: Staged, row: LocusRowV20): void {
    if (this.accessChanging.has(row.locusId)) refuse('LOCUS_BUSY', 'the entry is changing access')
    for (const delivery of this.deliveries(staged).values()) {
      if (delivery.locusId === row.locusId && NON_TERMINAL_DELIVERY.has(delivery.status) && !isUninjected(delivery)) {
        refuse('LOCUS_BUSY', 'the entry has an in-flight delivery')
      }
    }
  }

  /** D7/D8: lifecycle changes wait for an idle entry: no current delivery, not changing access. */
  private assertIdle(staged: Staged, row: LocusRowV20): void {
    if (this.accessChanging.has(row.locusId)) refuse('LOCUS_BUSY', 'the entry is changing access')
    for (const delivery of this.deliveries(staged).values()) {
      if (delivery.locusId === row.locusId && NON_TERMINAL_DELIVERY.has(delivery.status)) {
        refuse('LOCUS_BUSY', 'the entry has a non-terminal delivery')
      }
    }
  }

  /**
   * D6, repository half: optional M1 pairing, the chat reset (group row fence
   * checked by resetChat's CAS on the group row), operation committed. One
   * transaction; any refusal rolls it all back.
   */
  rebindChat(input: LocusRebindChatInputV20): Promise<LocusResetChatResultV20> {
    return this.mutate(staged => {
      const operation = staged.get<PetLocusOperation>('locus_operations', input.provisioningId)
      if (operation === undefined || operation.phase !== 'provisioning') {
        refuse('LOCUS_CONFLICT', `provisioning ${input.provisioningId} is not open`)
      }
      fencedRow(this.loci(staged), { expectedLocusId: input.expectedLocusId, expectedRevision: input.expectedRevision })
      if (input.main !== undefined) addPairing(staged, input.main)
      const result = this.resetChatIn(staged, input.chatId, {
        toM: input.toM,
        workspaceId: input.workspaceId,
        reboundFrom: input.reboundFrom,
        clearDefaultQa: true,
        expectedRevisions: { [input.chatId]: input.expectedRevision },
        now: input.now,
        reserveChildSessionId: input.reserveChildSessionId,
      })
      this.setOperationPhase(staged, input.provisioningId, 'committed')
      return result
    })
  }

  /**
   * D7, whole-W migrate commit: retire the W's active pairing (if given), add
   * the new M1 pairing, reset every listed chat onto it, all in one transaction.
   */
  commitWholeWMigration(input: LocusMigrateWholeWInputV20): Promise<readonly LocusResetChatResultV20[]> {
    return this.mutate(staged => {
      const operation = staged.get<PetLocusOperation>('locus_operations', input.provisioningId)
      if (operation === undefined || operation.phase !== 'provisioning') {
        refuse('LOCUS_CONFLICT', `provisioning ${input.provisioningId} is not open`)
      }
      const newMain = input.newMain
      if (newMain.status !== 'active' || newMain.workSessionId !== input.workSessionId) {
        refuse('INVALID_REQUEST', 'the migrated pairing must be a new active pairing of this work session')
      }
      if (input.retireMain !== undefined) {
        const current = this.mains(staged).get(input.retireMain.locusMainSessionId)
        if (current === undefined || current.status !== 'active' || current.workSessionId !== input.workSessionId) {
          refuse('LOCUS_CONFLICT', 'the work session has no such active pairing to retire')
        }
        staged.put('locus_mains', current.locusMainSessionId, {
          ...current,
          status: 'retired',
          retiredAt: input.now,
          retiredReason: input.retireMain.reason,
          updatedAt: input.now,
        })
      }
      addPairing(staged, newMain)
      const results: LocusResetChatResultV20[] = []
      for (const chat of input.chats) {
        const group = this.loci(staged).get(chat.chatId)
        if (chat.expectedMain !== undefined && (group === undefined || isTopicRowV20(group) || group.locusMainSessionId !== chat.expectedMain)) {
          refuse('LOCUS_CONFLICT', `chat ${chat.chatId} moved to another locus main since it was read`)
        }
        results.push(this.resetChatIn(staged, chat.chatId, {
          toM: newMain.locusMainSessionId,
          expectedRevisions: chat.expectedRevisions,
          now: input.now,
          reserveChildSessionId: input.reserveChildSessionId,
        }))
      }
      this.setOperationPhase(staged, input.provisioningId, 'committed')
      return results
    })
  }

  /**
   * D8 step 4. CAS write of the mode. Does NOT check the access-changing set:
   * the caller holds the acquisition. A row whose state is stopped or invalid
   * is refused with INVALID_REQUEST.
   */
  setAccessMode(fence: LocusRowFenceV20, mode: LocusAccessModeV20, grantedBy: string, now: number): Promise<LocusRowV20> {
    return this.mutate(staged => {
      const row = fencedRow(this.loci(staged), fence)
      if (row.state === 'stopped' || row.state === 'invalid') {
        refuse('INVALID_REQUEST', `access changes need a not-created or active entry, not ${row.state}`)
      }
      const { verifiedAt: _verifiedAt, ...kept } = row
      const next = { ...kept, accessMode: mode, grantedBy, revision: row.revision + 1, updatedAt: now } as LocusRowV20
      staged.put('loci', endpointKeyV20(next.endpoint), next)
      return next
    })
  }

  /**
   * Write `verifiedAt` after the agent's access was read back (D8). Keeps the
   * revision: verification is not a change. Fenced on the revision AND on the
   * verified `accessMode`, so a row changed since the readback is refused.
   * Accepts `not-created` (first creation verifies before activation).
   */
  recordAccessVerified(fence: LocusRowFenceV20, accessMode: LocusAccessModeV20, now: number): Promise<LocusRowV20> {
    return this.mutate(staged => {
      const row = fencedRow(this.loci(staged), fence)
      if (row.accessMode !== accessMode) refuse('LOCUS_CONFLICT', 'the entry accessMode differs from the verified mode')
      const next = { ...row, verifiedAt: now, updatedAt: now } as LocusRowV20
      staged.put('loci', endpointKeyV20(next.endpoint), next)
      return next
    })
  }
  /**
   * D15, one lookup in order: 0 blocked (access change or recovery debt) →
   * 1 active row with this sessionId → 2 staged not-created row matching the
   * reservation exactly → 3 retired (locus-child preset, no match) → 4 ordinary.
   */
  lookupChildForAgentCreated(input: LocusChildLookupInputV20): LocusChildLookupResultV20 {
    const found = this.findBySessionId(input.sessionId)
    if (found !== undefined) {
      const locusId = found.row.locusId
      if (this.accessChanging.has(locusId)) return { kind: 'blocked', reason: 'access-changing', locusId }
      if (this.hasFirstDeliveryRecoveryDebt(locusId)) return { kind: 'blocked', reason: 'recovery-debt', locusId }
      if (found.row.state === 'active') return { kind: 'active', row: found }
    }
    const staged = input.staged
    if (
      staged !== undefined && found !== undefined && found.row.state === 'not-created'
      && found.row.sessionId === staged.sessionId && found.locusMainSessionId === staged.locusMainSessionId
      && found.row.revision === staged.revision
    ) {
      return { kind: 'staged', row: found }
    }
    if (input.agentPreset === 'locus-child') return { kind: 'retired' }
    return { kind: 'ordinary' }
  }
}

/** The row named by a fence: LOCUS_NOT_FOUND if absent, LOCUS_CONFLICT if the locusId or revision moved. */
function fencedRow(loci: Map<string, LocusRowV20>, fence: LocusRowFenceV20): LocusRowV20 {
  const row = [...loci.values()].find(candidate => candidate.locusId === fence.expectedLocusId)
  if (row === undefined) refuse('LOCUS_NOT_FOUND', `locus ${fence.expectedLocusId} is unknown`)
  if (row.revision !== fence.expectedRevision) refuse('LOCUS_CONFLICT', 'the entry revision moved')
  return row
}

/** Adds a new pairing; refuses a duplicate locusMainSessionId or a second active pairing of the work session. */
function addPairing(staged: Staged, main: PetLocusMainRecord): void {
  if (staged.get('locus_mains', main.locusMainSessionId) !== undefined) refuse('LOCUS_CONFLICT', 'locusMainSessionId is already paired')
  if (main.status !== 'active') refuse('INVALID_REQUEST', 'a new pairing must be active')
  staged.put('locus_mains', main.locusMainSessionId, main)
}

/** A backlog delivery nobody has injected yet: accepted, with no execution / inbox / turn evidence. */
function isUninjected(delivery: LocusDeliveryRowV20): boolean {
  return delivery.status === 'accepted' && delivery.queueState !== 'current'
    && delivery.executionId === undefined && delivery.inboxMessageId === undefined && delivery.turnId === undefined
}

/** Drops the access grant fields (verifiedAt, grantedBy) and invalidReason; keeps everything else. */
function withoutLifecycleGrant(row: LocusRowV20): Record<string, unknown> {
  const { verifiedAt: _verifiedAt, grantedBy: _grantedBy, invalidReason: _invalidReason, ...kept } = row
  return kept
}

/**
 * D17 lifecycle reset of one row: a stopped row keeps `stopped` with
 * accessMode read-only and revision + 1; any other row gets a fresh reservation,
 * `not-created`, read-only and revision + 1.
 */
function resetLifecycle(row: Record<string, unknown>, now: number, reserveChildSessionId: () => string): Record<string, unknown> {
  const kept = withoutLifecycleGrant(row as unknown as LocusRowV20)
  const revision = (row.revision as number) + 1
  if (row.state === 'stopped') {
    return { ...kept, accessMode: 'read-only', revision, updatedAt: now }
  }
  const { stoppedAt: _stoppedAt, ...live } = kept
  return { ...live, state: 'not-created', sessionId: reserveChildSessionId(), accessMode: 'read-only', revision, updatedAt: now }
}

function requireOperation(staged: Staged, id: string): PetLocusOperation {
  const operation = staged.get<PetLocusOperation>('locus_operations', id)
  if (operation === undefined) refuse('LOCUS_CONFLICT', `provisioning ${id} is unknown`)
  return operation
}
