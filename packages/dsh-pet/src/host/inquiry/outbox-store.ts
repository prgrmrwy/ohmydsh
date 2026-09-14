/**
 * Durable single-table storage for the inquiry result outbox.
 *
 * This layer makes the pure value model in `./outbox.ts` survive a restart. It
 * owns exactly three things the pure module cannot own:
 *
 *  1. ATOMICITY. Every mutation rechecks the current durable state INSIDE the
 *     Domain transaction callback and commits in that same batch, so a crash
 *     can never leave a half-applied transition and no compensating write
 *     sequence exists to be interrupted.
 *  2. UNIQUENESS. One inquiry yields exactly ONE deliverable result. The dedup
 *     key is the table key, and a second result for an inquiry that already has
 *     one is refused inside the transaction rather than queued as a second
 *     continuation — which is the durable half of "a redelivered result must
 *     not start a second continuation".
 *  3. RESTART DISPOSITION (design D8). A pending result is provably
 *     undelivered and stays recoverable; a pending result whose continuation
 *     outcome the Host could not prove carries a `delivery-outcome-unknown`
 *     diagnostic and is reported for REVIEW instead — this store offers no path
 *     that re-delivers it, because re-running a continuation that may already
 *     have run is exactly what design D8 forbids.
 *
 * It owns nothing else. It authorizes nobody (the continuation fence is
 * `verifyInquiryContinuation`, re-run by the Host at hand-back time), it
 * schedules nothing, and — like the pure module — it has no answerer, chat,
 * message or feedback field anywhere, so no code path here can create or
 * consume a Feishu delivery for the ANSWERER.
 *
 * Contents policy: this table stores the result's existence, its requester,
 * the work to resume and its delivery status. It never stores an answer body,
 * a message body, a transcript excerpt or a chat identifier.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import {
  createInquiryResult, markInquiryResultDelivered, noteInquiryOutboxDiagnostic,
  parseInquiryOutboxRecord, refuseInquiryResult, retainInquiryResult,
  InquiryOutboxError, type InquiryOutboxRecord,
} from './outbox.js'

/** The one table this store owns. Declared additively at domain v12. */
type Table = 'inquiry_results'

/**
 * Same optional-capability shape the ledger and public-context stores use: the
 * installed storage-domain typing predates atomic batches, so both members are
 * optional and the store proves them at runtime rather than assuming them.
 */
type OutboxDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: { put(table: Table, key: string, value: unknown): void }) => void) => Promise<void>
}

export type InquiryOutboxStoreErrorCode =
  | 'TRANSACTION_UNAVAILABLE'
  | 'RESULT_NOT_FOUND'
  | 'RESULT_EXISTS'
  | 'RESULT_CORRUPT'

export class InquiryOutboxStoreError extends Error {
  constructor(readonly code: InquiryOutboxStoreErrorCode) {
    // Safe diagnostics only: never echo an inquiry id, a delivery id or
    // another circle member's identity back to the caller that tripped this.
    super({
      TRANSACTION_UNAVAILABLE: 'Atomic inquiry result storage is unavailable.',
      RESULT_NOT_FOUND: 'Inquiry result is not recorded.',
      RESULT_EXISTS: 'A different result is already recorded for this inquiry.',
      RESULT_CORRUPT: 'Inquiry result storage could not be verified.',
    }[code])
    this.name = 'InquiryOutboxStoreError'
  }
}
function corrupt(): never { throw new InquiryOutboxStoreError('RESULT_CORRUPT') }

/** What a restart may do with each undelivered result (design D8). */
export interface InquiryOutboxRestartDisposition {
  /** Provably undelivered: still pending, still safe to hand back. */
  readonly recoverable: readonly InquiryOutboxRecord[]
  /** Handed over, outcome unproven: owner review only, never an auto-retry. */
  readonly needsReview: readonly InquiryOutboxRecord[]
}

/**
 * Copy exactly the declared keys off a caller-owned object as DATA properties.
 *
 * The pure model refuses to invoke caller getters; rebuilding its argument must
 * not reintroduce that hole. This only detaches — every value is still
 * validated by `createInquiryResult`, which is the sole validator.
 */
function detach(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InquiryOutboxError('INVALID_OUTBOX_INPUT')
  }
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    result[key] = property !== undefined && 'value' in property ? property.value : undefined
  }
  return result
}

const factKeys = ['inquiryId', 'requester', 'resumeWork', 'result', 'createdAt'] as const

/** The fields a queued result fixes forever; a redelivery must match all of them. */
function identity(record: InquiryOutboxRecord): string {
  const { inquiryId, requester, resumeWork, result, dedupKey, createdAt } = record
  return JSON.stringify([inquiryId, requester, resumeWork, result, dedupKey, createdAt])
}

/** A pending row the Host could not prove the outcome of is review-only. */
function outcomeUnknown(record: InquiryOutboxRecord): boolean {
  return record.diagnostics.some(entry => entry.code === 'delivery-outcome-unknown')
}

export class InquiryOutboxStore {
  constructor(private readonly domain: OutboxDomain) {}

  private transaction(body: Parameters<NonNullable<OutboxDomain['transaction']>>[0]): Promise<void> {
    if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') {
      return Promise.reject(new InquiryOutboxStoreError('TRANSACTION_UNAVAILABLE'))
    }
    return this.domain.transaction(body)
  }

  /**
   * One stored result, validated through the pure model.
   *
   * Validating on the way out is what makes a schema field rename fail loud: a
   * row whose keys drifted is rejected as corruption instead of being read as
   * a differently-shaped but acceptable result.
   */
  get(dedupKey: string): InquiryOutboxRecord | undefined {
    const raw = this.domain.table('inquiry_results').get(dedupKey)
    if (raw === undefined) return undefined
    const record = parseInquiryOutboxRecord(raw)
    // The key IS the dedup key; a row filed elsewhere is corruption, not a
    // second identity for the same result.
    if (record.dedupKey !== dedupKey) corrupt()
    return record
  }

  /** Every validated record, in a stable clock-independent order. */
  private all(): readonly InquiryOutboxRecord[] {
    const records: InquiryOutboxRecord[] = []
    for (const [key, raw] of this.domain.table('inquiry_results').entries()) {
      const record = parseInquiryOutboxRecord(raw)
      if (record.dedupKey !== key) corrupt()
      records.push(record)
    }
    return records.sort((a, b) =>
      a.createdAt - b.createdAt || (a.dedupKey < b.dedupKey ? -1 : a.dedupKey > b.dedupKey ? 1 : 0))
  }

  /**
   * The single result recorded for one inquiry, whatever its status.
   *
   * There is deliberately no list form: one inquiry has at most one result, and
   * `queue` enforces that inside its transaction.
   */
  findByInquiry(inquiryId: string): InquiryOutboxRecord | undefined {
    const matches = this.all().filter(record => record.inquiryId === inquiryId)
    if (matches.length > 1) corrupt()
    return matches[0]
  }

  /**
   * Results still owed to one requester session, oldest first.
   *
   * "Pending" excludes a row whose continuation outcome is unproven: handing
   * that back again could run the same continuation twice.
   */
  listPending(requesterSessionId: string): readonly InquiryOutboxRecord[] {
    return Object.freeze(this.all().filter(record =>
      record.requester.sessionId === requesterSessionId &&
      record.status === 'pending' && !outcomeUnknown(record),
    ))
  }

  /**
   * Classify undelivered work for a restart (design D8).
   *
   * A plain `pending` row is provably undelivered and recoverable. A `pending`
   * row carrying `delivery-outcome-unknown` means the Host handed the
   * continuation over and cannot prove what came of it, so it is reported for
   * review; this store offers no path that re-delivers it.
   */
  restartDisposition(): InquiryOutboxRestartDisposition {
    const recoverable: InquiryOutboxRecord[] = []
    const needsReview: InquiryOutboxRecord[] = []
    for (const record of this.all()) {
      if (record.status !== 'pending') continue
      if (outcomeUnknown(record)) needsReview.push(record)
      else recoverable.push(record)
    }
    return Object.freeze({ recoverable: Object.freeze(recoverable), needsReview: Object.freeze(needsReview) })
  }

  /**
   * Persist one result as a pending outbox row.
   *
   * A redelivered result with the SAME proven facts is a no-op returning the
   * stored record — the durable half of "delivered once". A DIFFERENT result
   * under the same dedup key, or any second result for an inquiry that already
   * has one (for example a late failure after an answer), is refused rather
   * than queued: two rows would mean two continuations for one question.
   */
  async queue(facts: unknown): Promise<InquiryOutboxRecord> {
    const supplied = detach(facts, factKeys)
    let result: InquiryOutboxRecord | undefined
    await this.transaction(tx => {
      const candidate = createInquiryResult(supplied)
      const existing = this.get(candidate.dedupKey)
      if (existing !== undefined) {
        if (identity(existing) !== identity(candidate)) throw new InquiryOutboxStoreError('RESULT_EXISTS')
        result = existing
        return
      }
      // One inquiry, one deliverable result — checked against durable rows, so
      // a differently-keyed second outcome cannot slip in beside the first.
      if (this.findByInquiry(candidate.inquiryId) !== undefined) {
        throw new InquiryOutboxStoreError('RESULT_EXISTS')
      }
      result = candidate
      tx.put('inquiry_results', candidate.dedupKey, candidate)
    })
    return result!
  }

  /**
   * Bind this result to the ONE continuation segment that took it.
   *
   * Idempotence is the pure model's: a redelivered event, or a second segment
   * claiming an already-delivered result, returns an equal record and stages NO
   * write, so no second continuation is ever started.
   */
  markDelivered(dedupKey: string, event: unknown): Promise<InquiryOutboxRecord> {
    return this.mutate(dedupKey, current => markInquiryResultDelivered(current, event))
  }

  /** Close this result because the continuation re-verification fence refused it. */
  refuse(dedupKey: string, event: unknown): Promise<InquiryOutboxRecord> {
    return this.mutate(dedupKey, current => refuseInquiryResult(current, event))
  }

  /** Keep this result as inert evidence: the request was already terminal. */
  retain(dedupKey: string, event: unknown): Promise<InquiryOutboxRecord> {
    return this.mutate(dedupKey, current => retainInquiryResult(current, event))
  }

  /**
   * Retain a discarded event as owner-visible evidence.
   *
   * Status, statusAt and the delivered segment are preserved by the pure model,
   * so this can never revive a settled result, trigger a continuation or imply
   * an outbound message. The discarded body is NOT stored — only its event id.
   */
  noteDiagnostic(dedupKey: string, entry: unknown): Promise<InquiryOutboxRecord> {
    return this.mutate(dedupKey, current => noteInquiryOutboxDiagnostic(current, entry))
  }

  /** Shared atomic read-decide-commit; the decision is always the pure model's. */
  private async mutate(
    dedupKey: string,
    decide: (current: InquiryOutboxRecord) => InquiryOutboxRecord,
  ): Promise<InquiryOutboxRecord> {
    // Report a missing row before any transaction is attempted, so a genuine
    // absence is never confused with a medium that cannot commit at all.
    if (this.get(dedupKey) === undefined) throw new InquiryOutboxStoreError('RESULT_NOT_FOUND')
    let result: InquiryOutboxRecord | undefined
    await this.transaction(tx => {
      const current = this.get(dedupKey)
      if (current === undefined) throw new InquiryOutboxStoreError('RESULT_NOT_FOUND')
      const next = decide(current)
      result = next
      // A no-op result is a redelivery: writing it back would be pointless
      // durable churn that also re-emits a change event for nothing.
      if (JSON.stringify(next) !== JSON.stringify(current)) tx.put('inquiry_results', dedupKey, next)
    })
    return result!
  }
}
