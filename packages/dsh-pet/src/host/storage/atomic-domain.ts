/**
 * Give the official `Domain` the transactional surface Pet's stores probe for.
 *
 * Pet's four store classes each guard their writes with the same check:
 *
 * ```ts
 * if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') {
 *   return Promise.reject(new …StoreError('TRANSACTION_UNAVAILABLE'))
 * }
 * ```
 *
 * That probe used to be answered by a patched upstream `Domain`. It is
 * answered here instead, and the commit is executed by Pet's own backend unit
 * (`applyBatch`) — the same connection the records are written through, which
 * is what makes the transaction and the exclusive lock one thing rather than
 * two contending handles.
 *
 * WHY THE DOMAIN VIEW IS REFRESHED SEPARATELY
 *
 * The official Domain keeps an in-memory view and writes through the unit one
 * record at a time; it has no notion of a batch. So a Pet transaction commits
 * to the medium first (atomically, via `applyBatch`), then replays the same
 * writes through the Domain handles so the in-memory view, schema validation
 * and `domain/changed` emission still happen exactly as for ordinary writes.
 *
 * Table handles are resolved BEFORE the medium commit, so an undeclared table
 * rejects the whole transaction instead of being discovered once the bytes are
 * already durable.
 *
 * The probe itself is deliberately preserved rather than removed: it is the
 * last line of defence when the medium is missing or owned by another
 * process, and a store that skipped it would fall through to per-record
 * writes — the exact non-atomic behaviour the design forbids.
 *
 * @module dsh-pet/host/storage/atomic-domain
 */
import type { StagedWrite } from './backend.js'

/** The staging surface a transaction body writes into. */
export interface DomainTransactionStaging {
  put(table: string, key: string, value: unknown): void
  delete(table: string, key: string): void
  setGlobal(value: unknown): void
}

/** The official Domain members this wrapper delegates to. */
interface WritableDomain {
  table(name: string): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }
  readonly global?: { get(): unknown; set(value: unknown): Promise<void> }
}

/** The medium-side commit this wrapper drives. */
export interface BatchCommitter {
  applyBatch(writes: readonly StagedWrite[]): Promise<void>
}

/** Raised when a staged write cannot be committed atomically. */
export class AtomicDomainError extends Error {
  constructor(readonly code: 'medium-unavailable' | 'commit-failed', message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AtomicDomainError'
  }
}

/**
 * Stage `body`'s writes, commit them as one medium transaction, then refresh
 * the Domain's in-memory view.
 *
 * Nothing is applied until the body returns: a body that throws leaves both
 * the medium and the Domain untouched, which is what lets callers use an
 * exception as a veto (`outbox-store` refuses a duplicate result this way).
 */
export async function runAtomicDomain(
  domain: WritableDomain,
  unit: BatchCommitter | undefined,
  body: (tx: DomainTransactionStaging) => void,
): Promise<void> {
  if (unit === undefined) {
    throw new AtomicDomainError('medium-unavailable', 'Pet storage unit is unavailable; refusing a non-atomic write')
  }
  const staged: StagedWrite[] = []
  const staging: DomainTransactionStaging = {
    put(table, key, value) { staged.push({ kind: 'put', table, key, value }) },
    delete(table, key) { staged.push({ kind: 'delete', table, key }) },
    setGlobal(value) { staged.push({ kind: 'global', value }) },
  }
  body(staging)
  if (staged.length === 0) return

  for (const write of staged) {
    if (write.kind === 'global') {
      if (domain.global === undefined) {
        throw new AtomicDomainError('commit-failed', 'domain declares no global singleton')
      }
      continue
    }
    domain.table(write.table)
  }

  await unit.applyBatch(staged)

  for (const write of staged) {
    if (write.kind === 'global') {
      await domain.global!.set(write.value)
      continue
    }
    const table = domain.table(write.table)
    if (write.kind === 'put') await table.put(write.key, write.value)
    else await table.delete(write.key)
  }
}

/**
 * Augment a Domain in place so `transaction()` commits atomically.
 *
 * Augmented in place rather than proxied: the Domain instance is handed to the
 * location proof, to `close()` on shutdown and to the stores themselves, and a
 * proxy would make those identities diverge.
 *
 * @param domain - the official Domain opened for the `dsh_pet` spec.
 * @param unit - Pet's backend unit, or undefined when it could not be resolved.
 * @returns the same domain, now advertising transactional support.
 */
export function withAtomicWrites<T extends WritableDomain>(domain: T, unit: BatchCommitter | undefined): T {
  const augmented = domain as T & {
    supportsTransaction?: boolean
    transaction?: (body: (tx: DomainTransactionStaging) => void) => Promise<void>
  }
  // Tracks the medium, not this module's presence: without a unit the stores'
  // existing guard fires and refuses the write, which is correct.
  Object.defineProperty(augmented, 'supportsTransaction', {
    value: unit !== undefined, configurable: true, enumerable: false,
  })
  Object.defineProperty(augmented, 'transaction', {
    value: (body: (tx: DomainTransactionStaging) => void) => runAtomicDomain(domain, unit, body),
    configurable: true, enumerable: false,
  })
  return augmented
}
