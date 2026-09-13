/**
 * Durable single-table storage for the inquiry ledger.
 *
 * This layer makes the pure value model in `./ledger.ts` survive a restart. It
 * owns exactly three things the pure module cannot own:
 *
 *  1. ATOMICITY. Every mutation rechecks the current durable state INSIDE the
 *     Domain transaction callback and commits in that same batch, so a crash
 *     can never leave a half-applied transition and no compensating write
 *     sequence exists to be interrupted.
 *  2. BUDGET COUNTING. The pure model only compares caller-supplied counts to
 *     its ceilings. The counts themselves are durable facts, so they are
 *     recomputed from stored rows inside the transaction; two concurrent
 *     accepts therefore cannot both read `31` and both take the last slot.
 *  3. RESTART DISPOSITION (design D8). A queued record is provably undispatched
 *     and stays recoverable; a dispatched record whose outcome is unknown is
 *     reported for review and is NEVER re-dispatched from here — the ledger's
 *     own transition table has no edge back to `queued`.
 *
 * It owns nothing else. It does not authorize anyone (scope membership is
 * proven by the Host caller resolver before any call here), it does not decide
 * when a target is runnable, and it performs no inbox handoff. Legality of a
 * transition, the shape of a record and the chain rules all come from the pure
 * model: this file never re-derives them.
 *
 * Contents policy: this table stores the QUESTION and its purpose, because the
 * queued request has to survive a restart to be dispatchable at all. It never
 * stores an answer, a message body, a transcript excerpt or any other delivered
 * content — those belong to the answer/result surfaces, not to the ledger.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import {
  createInquiry, parseInquiry, applyInquiryEvent, recordInquiryDiagnostic,
  isTerminalInquiryStatus, InquiryLedgerError, type InquiryRecord,
} from './ledger.js'

/** The one table this store owns. Declared additively at domain v11. */
type Table = 'inquiries'

/**
 * Same optional-capability shape the public-context store uses: the installed
 * storage-domain typing predates atomic batches, so both members are optional
 * and the store proves them at runtime rather than assuming them.
 */
type LedgerDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: { put(table: Table, key: string, value: unknown): void }) => void) => Promise<void>
}

export type InquiryLedgerStoreErrorCode =
  | 'TRANSACTION_UNAVAILABLE'
  | 'INQUIRY_NOT_FOUND'
  | 'INQUIRY_EXISTS'
  | 'INQUIRY_CORRUPT'

export class InquiryLedgerStoreError extends Error {
  constructor(readonly code: InquiryLedgerStoreErrorCode) {
    // Safe diagnostics only: never echo a question, a purpose, a chat id or
    // another circle member's identity back to the caller that tripped this.
    super({
      TRANSACTION_UNAVAILABLE: 'Atomic inquiry ledger storage is unavailable.',
      INQUIRY_NOT_FOUND: 'Inquiry is not recorded.',
      INQUIRY_EXISTS: 'A different inquiry is already recorded under this id.',
      INQUIRY_CORRUPT: 'Inquiry storage could not be verified.',
    }[code])
    this.name = 'InquiryLedgerStoreError'
  }
}
function corrupt(): never { throw new InquiryLedgerStoreError('INQUIRY_CORRUPT') }

/**
 * Host-proven facts for one acceptance, minus everything this store derives.
 *
 * `parent`, `rootInquiryCount` and `pendingCount` are deliberately absent: a
 * caller-supplied ancestor or count would be exactly the snapshot the spec
 * forbids trusting, so the store reads all three from durable state itself.
 */
export interface InquiryAcceptFacts {
  readonly inquiryId: string
  readonly requester: unknown
  readonly circleParentSessionId: string
  readonly origin: unknown
  readonly audience: unknown
  readonly createdAt: number
}

const acceptFactKeys = [
  'inquiryId', 'requester', 'circleParentSessionId', 'origin', 'audience', 'createdAt',
] as const

/** What a restart may do with each unsettled record (design D8). */
export interface InquiryRestartDisposition {
  /** Provably undispatched: still queued, still safe to dispatch. */
  readonly recoverable: readonly InquiryRecord[]
  /** Dispatched, outcome unproven: owner review only, never an auto-retry. */
  readonly needsReview: readonly InquiryRecord[]
}

/**
 * Copy exactly the declared keys off a caller-owned object as DATA properties.
 *
 * The pure model refuses to invoke caller getters; rebuilding its context
 * argument must not reintroduce that hole. This only detaches — every value is
 * still validated by `createInquiry`, which is the sole validator.
 */
function detach(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InquiryLedgerError('INVALID_INQUIRY_INPUT')
  }
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    result[key] = property !== undefined && 'value' in property ? property.value : undefined
  }
  return result
}

/** The fields an acceptance fixes forever; a redelivery must match all of them. */
function identity(record: InquiryRecord): string {
  const { id, requester, target, circleParentSessionId, question, purpose,
    origin, audience, trace, createdAt, deadlineAt } = record
  return JSON.stringify([id, requester, target, circleParentSessionId, question,
    purpose, origin, audience, trace, createdAt, deadlineAt])
}

export class InquiryLedgerStore {
  constructor(private readonly domain: LedgerDomain) {}

  private transaction(body: Parameters<NonNullable<LedgerDomain['transaction']>>[0]): Promise<void> {
    if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') {
      return Promise.reject(new InquiryLedgerStoreError('TRANSACTION_UNAVAILABLE'))
    }
    return this.domain.transaction(body)
  }

  /**
   * One stored record, validated through the pure model.
   *
   * Validating on the way out is what makes a schema field rename fail loud:
   * a row whose keys drifted is rejected as corruption instead of being read
   * as a differently-shaped but acceptable inquiry.
   */
  get(inquiryId: string): InquiryRecord | undefined {
    const raw = this.domain.table('inquiries').get(inquiryId)
    if (raw === undefined) return undefined
    const record = parseInquiry(raw)
    // The key IS the id; a row filed elsewhere is corruption, not a second identity.
    if (record.id !== inquiryId) corrupt()
    return record
  }

  /** Every validated record, in a stable clock-independent order. */
  private all(): readonly InquiryRecord[] {
    const records: InquiryRecord[] = []
    for (const [key, raw] of this.domain.table('inquiries').entries()) {
      const record = parseInquiry(raw)
      if (record.id !== key) corrupt()
      records.push(record)
    }
    return records.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /**
   * Records still owed to one target session, oldest first.
   *
   * "Pending" is the non-terminal set — queued, executing or answered — which
   * is exactly what the per-session ceiling bounds: a settled record is
   * history and must not keep occupying a slot.
   */
  listPending(targetSessionId: string): readonly InquiryRecord[] {
    return Object.freeze(this.all().filter(
      record => record.target.sessionId === targetSessionId && !isTerminalInquiryStatus(record.status),
    ))
  }

  /**
   * Classify unsettled work for a restart (design D8).
   *
   * Only `queued` is provably undispatched. `executing`/`answered` mean the
   * Host already handed the work over and cannot prove what came of it, so
   * they are reported for review; this store offers no path that puts them
   * back on the queue, and the pure transition table has none either.
   */
  restartDisposition(): InquiryRestartDisposition {
    const recoverable: InquiryRecord[] = []
    const needsReview: InquiryRecord[] = []
    for (const record of this.all()) {
      if (record.status === 'queued') recoverable.push(record)
      else if (!isTerminalInquiryStatus(record.status)) needsReview.push(record)
    }
    return Object.freeze({ recoverable: Object.freeze(recoverable), needsReview: Object.freeze(needsReview) })
  }

  /**
   * Persist one accepted inquiry as a queued record.
   *
   * Everything that decides the outcome happens inside the Domain callback:
   * the ancestor is read from durable state (never taken from the caller), the
   * two budgets are counted from durable state, and the pure model computes
   * the record from those actual facts. A redelivered acceptance of the SAME
   * inquiry is a no-op returning the stored record; a different inquiry under
   * a used id is refused rather than overwriting the first one.
   */
  async accept(request: unknown, facts: InquiryAcceptFacts | unknown): Promise<InquiryRecord> {
    const supplied = detach(facts, acceptFactKeys)
    let result: InquiryRecord | undefined
    await this.transaction(tx => {
      // The ancestor is a durable fact. An inquiry-origin call whose ancestor
      // is absent gets the pure model's CHAIN_MISMATCH, not an invented root.
      const parentId = this.declaredParentId(supplied.origin)
      const parent = parentId === undefined ? null : (this.get(parentId) ?? null)
      const context = (rootInquiryCount: number, pendingCount: number) =>
        ({ ...supplied, parent, rootInquiryCount, pendingCount })

      // Run the model once with empty counts purely to obtain the VALIDATED
      // id/root/target the durable counts are keyed by. It commits nothing and
      // is not the decision; the authoritative call below re-runs every rule
      // against the counts actually read from storage.
      const probe = createInquiry(request, context(0, 0))

      const existing = this.get(probe.id)
      if (existing !== undefined) {
        if (identity(existing) !== identity(probe)) throw new InquiryLedgerStoreError('INQUIRY_EXISTS')
        result = existing
        return
      }

      // Count from durable rows, excluding this id so a redelivery that raced
      // its own commit is measured exactly like the original acceptance.
      let rootInquiryCount = 0
      let pendingCount = 0
      for (const record of this.all()) {
        if (record.id === probe.id) continue
        if (record.trace.rootInquiryId === probe.trace.rootInquiryId) rootInquiryCount += 1
        if (record.target.sessionId === probe.target.sessionId && !isTerminalInquiryStatus(record.status)) {
          pendingCount += 1
        }
      }

      const candidate = createInquiry(request, context(rootInquiryCount, pendingCount))
      if (identity(candidate) !== identity(probe)) corrupt()
      result = candidate
      tx.put('inquiries', candidate.id, candidate)
    })
    return result!
  }

  /**
   * Apply one Host event atomically.
   *
   * The record is re-read inside the callback, so the transition is decided
   * against the state that is actually current at commit time. Idempotence is
   * the pure model's: a redelivered event that already produced the current
   * status returns an equal record and stages NO write, while reusing an
   * applied eventId for a different transition fails ILLEGAL_TRANSITION.
   */
  async applyEvent(inquiryId: string, event: unknown): Promise<InquiryRecord> {
    if (this.get(inquiryId) === undefined) throw new InquiryLedgerStoreError('INQUIRY_NOT_FOUND')
    return this.mutate(inquiryId, current => applyInquiryEvent(current, event))
  }

  /**
   * Retain a discarded event as owner-visible evidence.
   *
   * Status, statusAt and reason are preserved by the pure model, so this can
   * never revive a terminal inquiry, trigger a continuation or imply an
   * outbound message. The discarded body is NOT stored — only its event id.
   */
  async recordDiagnostic(inquiryId: string, entry: unknown): Promise<InquiryRecord> {
    if (this.get(inquiryId) === undefined) throw new InquiryLedgerStoreError('INQUIRY_NOT_FOUND')
    return this.mutate(inquiryId, current => recordInquiryDiagnostic(current, entry))
  }

  /** Shared atomic read-decide-commit; the decision is always the pure model's. */
  private async mutate(inquiryId: string, decide: (current: InquiryRecord) => InquiryRecord): Promise<InquiryRecord> {
    let result: InquiryRecord | undefined
    await this.transaction(tx => {
      const current = this.get(inquiryId)
      if (current === undefined) throw new InquiryLedgerStoreError('INQUIRY_NOT_FOUND')
      const next = decide(current)
      result = next
      // A no-op result is a redelivery: writing it back would be a pointless
      // durable churn that also re-emits a change event for nothing.
      if (JSON.stringify(next) !== JSON.stringify(current)) tx.put('inquiries', inquiryId, next)
    })
    return result!
  }

  /** Ancestor id declared by the Host-derived origin, without invoking getters. */
  private declaredParentId(origin: unknown): string | undefined {
    if (origin === null || typeof origin !== 'object' || Array.isArray(origin)) return undefined
    const kind = Object.getOwnPropertyDescriptor(origin, 'kind')
    if (kind === undefined || !('value' in kind) || kind.value !== 'inquiry') return undefined
    const parent = Object.getOwnPropertyDescriptor(origin, 'parentInquiryId')
    if (parent === undefined || !('value' in parent) || typeof parent.value !== 'string') return undefined
    return parent.value
  }
}
