/**
 * Inquiry-result CONTINUATION binding: opening the requester's NEXT execution
 * segment on its ORIGINAL work (design D7).
 *
 * THE PROBLEM THIS SOLVES
 *
 * `../locus/turn-observer.ts` grants a reply target through `currentForChild()`
 * only when a child has exactly one ACTIVE turn that claimed exactly one Feishu
 * Delivery, with nothing mixed, unresolved, foreign or saturated. That rule is
 * correct and is NOT weakened here. But a continuation segment cannot satisfy
 * it even in principle: the original inbox message was consumed by the FIRST
 * segment, so a continuation turn claims the inquiry-result message instead and
 * legitimately has no Delivery claim of its own. Under today's rules it
 * therefore has no reply authority at all — which is exactly why "the requester
 * asked a question and then finished its turn" currently strands the original
 * Feishu request.
 *
 * THE SHAPE OF THE FIX
 *
 * Reply authority for a continuation segment is derived from a Host-PROVEN
 * ANCHOR rather than from an active turn claim:
 *
 *   outbox record (anchor fixed at ACCEPT time, structurally unrebindable)
 *      + the durable Delivery row that anchor names
 *      + re-verification of every D7 fact at the moment of use
 *      = one segment, carrying exactly that delivery's own feedback target.
 *
 * Three properties make this safe rather than a loophole:
 *
 *  - The anchor is never chosen. `resumeWork` was copied from the inquiry when
 *    it was accepted and there is no field on the record to point elsewhere, so
 *    "do not rebind to the most recent Delivery" is structural, not a check.
 *  - Nothing here comes from model input. The record, the ledger row, the
 *    current-child verdict, the settlement state, the permission verdict and
 *    the Delivery row are all Host-proven INPUTS.
 *  - The Delivery row must independently agree with the record on delivery id,
 *    locus, generation and child, must still be non-terminal, and its feedback
 *    target must derive from its own endpoint and message. A general agent or
 *    parent message can never satisfy that, so it can never be upgraded into a
 *    reply target.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * It performs no I/O, holds no state, reads no clock and sends nothing. It does
 * not re-implement the fence (`verifyInquiryContinuation`), the outbox
 * transitions (`markInquiryResultDelivered` / `refuse` / `retain`), the
 * scheduler, or any Feishu call. Opening a segment is a DECISION plus the two
 * immutable values that decision produces; committing and running it belongs to
 * the caller.
 *
 * TIME IS NOT EVIDENCE
 *
 * Under the approved design there is no business deadline. Elapsed wall time
 * never expires or refuses an inquiry, an answer, or a continuation. This
 * module reads no clock, and `createdAt` is age/display data only.
 *
 * CANCELLATION IS INTERNAL
 *
 * A cancelled branch is Agent-to-Agent state. It produces durable structured
 * evidence and nothing else: no reaction, no message, no delivery, no reply
 * authority, no outbound effect of any kind.
 */
import { isTerminalInquiryStatus, type InquiryOrigin } from './ledger.js'
import {
  OUTBOUND_SEND_STATES,
  continuationDisposition,
  markInquiryResultDelivered,
  noteInquiryOutboxDiagnostic,
  parseInquiryOutboxRecord,
  refuseInquiryResult,
  retainInquiryResult,
  verifyInquiryContinuation,
  type InquiryOutboxRecord,
  type OutboundSendState,
  type RequestDisplay,
} from './outbox.js'

/** Every way a continuation attempt can end. Stable and exhaustive. */
export const CONTINUATION_OUTCOME_KINDS = Object.freeze([
  'opened', 'already-open', 'refused', 'retained',
] as const)

export type ContinuationOutcomeKind = (typeof CONTINUATION_OUTCOME_KINDS)[number]

/**
 * Why a continuation was not opened.
 *
 * The first eight mirror the outbox fence exactly. Two are added here:
 *
 *  - `anchor-unproven` is the UNIFORM fail-closed code for every way the
 *    Delivery row failed to prove the recorded anchor — absent, foreign,
 *    terminal, mismatched, or carrying a feedback target that does not derive
 *    from its own row. Collapsing these is deliberate: distinct codes would let
 *    a caller probe which foreign delivery ids exist.
 *  - `branch-cancelled` marks an internal cancellation, retained as evidence.
 *
 * There is no expiry code: time cannot refuse a continuation.
 */
export const CONTINUATION_REFUSAL_CODES = Object.freeze([
  'result-not-pending', 'inquiry-mismatch', 'requester-absent', 'requester-rebuilt',
  'work-unknown', 'work-mismatch', 'work-settled', 'permission-revoked',
  'anchor-unproven', 'branch-cancelled',
] as const)

export type ContinuationRefusalCode = (typeof CONTINUATION_REFUSAL_CODES)[number]

/** Reply authority for a continuation segment, or `null` for local/GUI work. */
export interface ContinuationReplyTarget {
  readonly chatId: string
  readonly messageId: string
  readonly threadId?: string
  readonly rootMessageId?: string
}

/**
 * The new execution segment, with its PROVEN origin.
 *
 * `origin` is always `inquiry-result`, matching the scheduler's vocabulary: a
 * continuation is a distinct segment, never a resumed or re-entered turn.
 * `replyTarget` is `null` unless a Feishu Delivery row proved this exact
 * anchor, so local and GUI work is structurally incapable of carrying one.
 */
export interface ContinuationSegment {
  readonly segmentId: string
  readonly sessionId: string
  readonly origin: 'inquiry-result'
  readonly ref: string
  readonly resume: InquiryOrigin
  readonly replyTarget: ContinuationReplyTarget | null
}

export type ContinuationOutcome =
  | {
      readonly kind: 'opened'
      readonly segment: ContinuationSegment
      readonly record: InquiryOutboxRecord
    }
  | {
      /** This result already opened its ONE segment; that binding stands. */
      readonly kind: 'already-open'
      readonly segmentId: string
      readonly record: InquiryOutboxRecord
    }
  | {
      readonly kind: 'refused' | 'retained'
      readonly code: ContinuationRefusalCode
      readonly record: InquiryOutboxRecord
    }

export class ContinuationError extends Error {
  constructor(readonly code: 'INVALID_CONTINUATION_INPUT') {
    // Safe diagnostics only: never echo a delivery id, a chat id, a message id
    // or another member's identity back to whatever tripped this.
    super('Invalid inquiry continuation input.')
    this.name = 'ContinuationError'
  }
}
function invalid(): never { throw new ContinuationError('INVALID_CONTINUATION_INPUT') }

// ---------------------------------------------------------------------------
// Strict runtime input validation. Same discipline as ledger.ts / outbox.ts:
// read actual data properties, refuse unknown keys, never invoke a caller
// getter, never mutate or freeze a caller-owned object.
// ---------------------------------------------------------------------------

const IDENTIFIER_LENGTH = 256
const KEY_LENGTH = 1_024

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) invalid()
  const actual = Reflect.ownKeys(input)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) invalid()
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    if (!property || !('value' in property)) invalid()
    result[key] = property.value
  }
  return result
}

function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > max || input.trim() !== input) invalid()
  return input
}
function identifier(input: unknown): string { return text(input, IDENTIFIER_LENGTH) }
function integer(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid()
  return input
}
function list(input: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(input) || input.length > max) invalid()
  if (Reflect.ownKeys(input).length !== input.length + 1) invalid()
  const result: unknown[] = []
  for (let i = 0; i < input.length; i++) {
    const property = Object.getOwnPropertyDescriptor(input, String(i))
    if (!property || !('value' in property)) invalid()
    result.push(property.value)
  }
  return result
}

/** The event that names the ONE segment this result may open. */
interface ContinuationEvent {
  readonly eventId: string
  readonly at: number
  readonly segmentId: string
}

function continuationEvent(input: unknown): ContinuationEvent {
  const value = object(input, ['eventId', 'at', 'segmentId'])
  return Object.freeze({
    eventId: identifier(value.eventId),
    at: integer(value.at),
    segmentId: text(value.segmentId, KEY_LENGTH),
  })
}

/**
 * The durable Delivery row, validated as ACTUAL stored data.
 *
 * Only the fields that participate in the proof are read. Requiring the exact
 * key set means a hand-built lookalike carrying an extra `replyTarget` or a
 * spoofed `authorized` flag is refused rather than silently accepted with the
 * extra field ignored.
 */
interface ProvenDeliveryRow {
  readonly deliveryId: string
  readonly messageId: string
  readonly status: string
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly locusId: string
  readonly generation: number
  readonly childSessionId: string
  readonly sequence: number
  readonly feedbackTarget: ContinuationReplyTarget
}

const DELIVERY_STATUSES = Object.freeze(['accepted', 'queued', 'running', 'settled', 'failed'])
/** A terminal Delivery can never be reopened, so it can never be an anchor. */
const TERMINAL_DELIVERY_STATUSES = Object.freeze(['settled', 'failed'])

function deliveryRow(input: unknown): ProvenDeliveryRow | null {
  if (input === null) return null
  const value = object(input, [
    'deliveryId', 'messageId', 'status', 'endpoint', 'locusId',
    'generation', 'childSessionId', 'sequence', 'feedbackTarget',
  ])
  const status = value.status
  if (typeof status !== 'string' || !DELIVERY_STATUSES.includes(status)) invalid()
  const endpoint = object(value.endpoint, hasThread(value.endpoint) ? ['chatId', 'threadId'] : ['chatId'])
  const target = object(
    value.feedbackTarget,
    feedbackTargetKeys(value.feedbackTarget),
  )
  const generation = integer(value.generation)
  if (generation < 1) invalid()
  return Object.freeze({
    deliveryId: identifier(value.deliveryId),
    messageId: identifier(value.messageId),
    status,
    endpoint: Object.freeze({
      chatId: identifier(endpoint.chatId),
      ...(endpoint.threadId === undefined ? {} : { threadId: identifier(endpoint.threadId) }),
    }),
    locusId: identifier(value.locusId),
    generation,
    childSessionId: identifier(value.childSessionId),
    sequence: integer(value.sequence),
    feedbackTarget: Object.freeze({
      chatId: identifier(target.chatId),
      messageId: identifier(target.messageId),
      ...(target.threadId === undefined ? {} : { threadId: identifier(target.threadId) }),
      ...(target.rootMessageId === undefined ? {} : { rootMessageId: identifier(target.rootMessageId) }),
    }),
  })
}

function hasThread(input: unknown): boolean {
  return input !== null && typeof input === 'object'
    && Object.prototype.hasOwnProperty.call(input, 'threadId')
}

function feedbackTargetKeys(input: unknown): readonly string[] {
  if (input === null || typeof input !== 'object') invalid()
  const keys = ['chatId', 'messageId']
  if (Object.prototype.hasOwnProperty.call(input, 'threadId')) keys.push('threadId')
  if (Object.prototype.hasOwnProperty.call(input, 'rootMessageId')) keys.push('rootMessageId')
  return keys
}

// ---------------------------------------------------------------------------
// Anchor proof.
// ---------------------------------------------------------------------------

/**
 * Prove that this Delivery row IS the anchor recorded at accept time.
 *
 * Every condition is required, and failing any of them yields the same uniform
 * refusal, so a caller learns only "not proven" and never which foreign row it
 * brushed against:
 *
 *  1. The record's own origin is a Feishu delivery and the requester is a
 *     locus child. A main session owns no Delivery, so it can never reach here.
 *  2. A row was supplied at all.
 *  3. The row is the SAME delivery id the record fixed at accept time.
 *  4. The row belongs to this exact locus, generation and child session. This
 *     is the same generation-exact identity rule the fence applies, re-checked
 *     against the durable Delivery rather than only against the ledger.
 *  5. The row is not terminal. A settled or failed Delivery is never reopened,
 *     even if the caller's separate evidence claimed it was unsettled.
 *  6. The feedback target DERIVES from this row's own endpoint and message. A
 *     target naming another chat, thread, or message is a forgery, not a hint.
 */
function proveAnchor(
  record: InquiryOutboxRecord,
  row: ProvenDeliveryRow | null,
): ContinuationReplyTarget | 'unproven' {
  if (record.resumeWork.kind !== 'feishu-delivery') return 'unproven'
  if (record.requester.kind !== 'child') return 'unproven'
  if (row === null) return 'unproven'
  if (row.deliveryId !== record.resumeWork.deliveryId) return 'unproven'
  if (
    row.locusId !== record.requester.locusId ||
    row.generation !== record.requester.generation ||
    row.childSessionId !== record.requester.sessionId
  ) return 'unproven'
  if (TERMINAL_DELIVERY_STATUSES.includes(row.status)) return 'unproven'
  const target = row.feedbackTarget
  if (
    target.chatId !== row.endpoint.chatId ||
    (target.threadId ?? undefined) !== (row.endpoint.threadId ?? undefined) ||
    target.messageId !== row.messageId
  ) return 'unproven'
  // A fresh copy, so the caller cannot reach the stored row through it.
  return Object.freeze({
    chatId: target.chatId,
    messageId: target.messageId,
    ...(target.threadId === undefined ? {} : { threadId: target.threadId }),
    ...(target.rootMessageId === undefined ? {} : { rootMessageId: target.rootMessageId }),
  })
}

/** The session that will run the continuation. Identity, never a free choice. */
function requesterSessionId(record: InquiryOutboxRecord): string {
  return record.requester.sessionId
}

// ---------------------------------------------------------------------------
// The decision.
// ---------------------------------------------------------------------------

/**
 * Decide whether this delivered result may open a NEW execution segment on the
 * requester's ORIGINAL work, and what that segment's proven origin is.
 *
 * Order matters and is fail-closed throughout:
 *
 *  1. Structural validation of all four inputs. Malformed input throws rather
 *     than degrading into a refusal, so a caller cannot turn a bug into a
 *     silent "no continuation today".
 *  2. Idempotence. A result already bound to a segment returns `already-open`
 *     with the FIRST segment id, whatever the redelivery claims. This is the
 *     "the same delivered result must not open two continuation segments" rule,
 *     and it is checked before anything else could produce a second binding.
 *  3. An internally cancelled branch is retained as evidence and stops here. It
 *     yields no segment, no reply authority and no outbound effect.
 *  4. The full D7 fence (`verifyInquiryContinuation`): result still pending,
 *     ledger row matching this inquiry and requester with a status that could
 *     have produced this result, requester still the current child at the same
 *     generation, the original work proven, identical and unsettled, and
 *     permission still valid. Refusals are dispositioned by the outbox's own
 *     rule and never rebound to another delivery.
 *  5. Only then, the anchor proof — and only for Feishu-origin work. Local and
 *     GUI work skips it entirely and opens with `replyTarget: null`, which is
 *     how "local origin yields NO Feishu authority" is enforced structurally
 *     rather than by a flag.
 *
 * Returns the outcome plus the updated outbox record. Nothing is persisted and
 * nothing is sent: committing the record and running the segment is the
 * caller's responsibility, and doing so is what makes the binding durable.
 */
export function openInquiryContinuation(input: unknown): ContinuationOutcome {
  const value = object(input, ['record', 'evidence', 'delivery', 'event'])
  const record = parseInquiryOutboxRecord(value.record)
  const applied = continuationEvent(value.event)
  const row = deliveryRow(value.delivery)

  // Idempotence first. The first binding is durable and is never migrated onto
  // a newer segment or a newer delivery, so a redelivered result — a replayed
  // event, or a second segment claiming it after a crash window — changes
  // nothing at all.
  if (record.status === 'delivered' && record.deliveredSegmentId !== null) {
    return Object.freeze({
      kind: 'already-open' as const,
      segmentId: record.deliveredSegmentId,
      record,
    })
  }

  // Already refused or retained: this result had its single decision. Report it
  // WITHOUT attempting another transition — the outbox rightly rejects leaving
  // a settled state, and a settled result must not accumulate a diagnostic per
  // redelivery either. The record is returned exactly as stored.
  if (record.status !== 'pending') {
    return Object.freeze({
      kind: 'retained' as const,
      code: 'result-not-pending' as const,
      record,
    })
  }

  // An internally cancelled branch: durable structured evidence only. The
  // requester decided the original request without this answer, so a late
  // result must not wake it, must not append anything, and must not acquire
  // reply authority on the way past.
  if (record.status === 'pending' && isCancelledBranch(record, value.evidence)) {
    return Object.freeze({
      kind: 'retained' as const,
      code: 'branch-cancelled' as const,
      record: retainInquiryResult(record, {
        eventId: applied.eventId, at: applied.at, code: 'late-result',
      }),
    })
  }

  const verdict = verifyInquiryContinuation(record, value.evidence)
  if (verdict.ok !== true) {
    const disposition = continuationDisposition(verdict)
    const settled = disposition === 'retain'
      ? retainInquiryResult(record, { eventId: applied.eventId, at: applied.at, code: verdict.code })
      : refuseInquiryResult(record, { eventId: applied.eventId, at: applied.at, code: verdict.code })
    return Object.freeze({
      kind: disposition === 'retain' ? ('retained' as const) : ('refused' as const),
      code: verdict.code,
      record: settled,
    })
  }

  // Local / GUI work: resumed, with no Feishu authority and no Feishu row. A
  // Delivery row offered here is a contradiction, not an upgrade — accepting it
  // would be precisely the "general message becomes a reply target" failure.
  if (verdict.resume.kind !== 'feishu-delivery') {
    if (row !== null) return anchorRefusal(record, applied)
    return opened(record, applied, verdict.resume, null)
  }

  const target = proveAnchor(record, row)
  if (target === 'unproven') return anchorRefusal(record, applied)
  return opened(record, applied, verdict.resume, target)
}

/**
 * Whether this result belongs to a branch the requester already cancelled.
 *
 * Read from the durable ledger status, not from the result kind alone: a
 * `cancelled` failure result and a `cancelled` ledger row are the same internal
 * fact seen from two sides, and either one alone could be stale.
 */
function isCancelledBranch(record: InquiryOutboxRecord, evidence: unknown): boolean {
  if (record.result.kind === 'failure' && record.result.failure === 'cancelled') return true
  if (evidence === null || typeof evidence !== 'object') return false
  const inquiry = Object.getOwnPropertyDescriptor(evidence, 'inquiry')
  if (!inquiry || !('value' in inquiry) || inquiry.value === null || typeof inquiry.value !== 'object') return false
  const status = Object.getOwnPropertyDescriptor(inquiry.value, 'status')
  return !!status && 'value' in status && status.value === 'cancelled'
}

/**
 * One uniform fail-closed refusal for every anchor proof failure.
 *
 * The diagnostic code is the generic `work-unknown`, never a per-cause code:
 * an owner learns the continuation could not be proven, and nothing in the
 * record or the outcome names a foreign delivery, chat or message.
 */
function anchorRefusal(record: InquiryOutboxRecord, applied: ContinuationEvent): ContinuationOutcome {
  return Object.freeze({
    kind: 'refused' as const,
    code: 'anchor-unproven' as const,
    record: refuseInquiryResult(record, {
      eventId: applied.eventId, at: applied.at, code: 'work-unknown',
    }),
  })
}

function opened(
  record: InquiryOutboxRecord,
  applied: ContinuationEvent,
  resume: InquiryOrigin,
  replyTarget: ContinuationReplyTarget | null,
): ContinuationOutcome {
  return Object.freeze({
    kind: 'opened' as const,
    segment: Object.freeze({
      segmentId: applied.segmentId,
      sessionId: requesterSessionId(record),
      origin: 'inquiry-result' as const,
      ref: record.inquiryId,
      resume,
      replyTarget,
    }),
    record: markInquiryResultDelivered(record, {
      eventId: applied.eventId, at: applied.at, segmentId: applied.segmentId,
    }),
  })
}

// ---------------------------------------------------------------------------
// The three separated facts (design D7), over real association rows.
// ---------------------------------------------------------------------------

export interface ContinuationProgress {
  /** Fact 1: the execution segment finished. NOT "the request is done". */
  readonly segmentEnded: boolean
  /** Fact 2: an inquiry branch or a queued result still owes this request. */
  readonly unresolvedAssociation: boolean
  /** Fact 3: what the platform actually said about the outbound body. */
  readonly outbound: OutboundSendState
  readonly display: RequestDisplay
  readonly completed: boolean
  readonly openInquiries: number
  readonly openResults: number
}

const PROGRESS_LIST_LIMIT = 1_024

/**
 * Report a request's state without collapsing the three D7 facts.
 *
 * This takes the actual association ROWS rather than pre-counted numbers, so
 * the caller cannot accidentally report a completed request by counting wrong:
 * "still owed" is decided here, from durable status.
 *
 *  - An inquiry is open while its status is non-terminal. `answered` counts as
 *    OPEN: the answer exists but has not resumed the work yet, and treating it
 *    as closed is exactly how a pending branch would masquerade as completed.
 *  - An outbox result is open while it is still `pending`.
 *
 * A first segment that ended with a pending inquiry therefore reads
 * `in-progress`, never `completed`. The mapping is mechanical and never
 * inspects any message body:
 *
 *   running, or anything unresolved  → in-progress
 *   settled, nothing unresolved, sent    → completed
 *   settled, nothing unresolved, none    → unanswered (a diagnostic)
 *   settled, nothing unresolved, failed  → failed
 *   settled, nothing unresolved, unknown → needs-review (never success)
 */
export function describeContinuationProgress(input: unknown): ContinuationProgress {
  const value = object(input, ['segmentEnded', 'inquiries', 'results', 'outbound'])
  if (typeof value.segmentEnded !== 'boolean') invalid()
  const segmentEnded = value.segmentEnded
  const outbound = value.outbound as OutboundSendState
  if (!OUTBOUND_SEND_STATES.includes(outbound)) invalid()

  const openInquiries = list(value.inquiries, PROGRESS_LIST_LIMIT)
    .filter(row => !isTerminalInquiryStatus(statusOf(row))).length
  const openResults = list(value.results, PROGRESS_LIST_LIMIT)
    .filter(row => statusOf(row) === 'pending').length

  const unresolvedAssociation = openInquiries > 0 || openResults > 0
  const display: RequestDisplay = !segmentEnded || unresolvedAssociation
    ? 'in-progress'
    : outbound === 'sent' ? 'completed'
      : outbound === 'failed' ? 'failed'
        : outbound === 'unknown' ? 'needs-review' : 'unanswered'

  return Object.freeze({
    segmentEnded, unresolvedAssociation, outbound, display,
    completed: display === 'completed',
    openInquiries, openResults,
  })
}

/** Read a durable row's status without invoking a caller getter. */
function statusOf(row: unknown): unknown {
  if (row === null || typeof row !== 'object') invalid()
  const status = Object.getOwnPropertyDescriptor(row, 'status')
  if (!status || !('value' in status)) invalid()
  return status.value
}

/** Re-exported so a caller need not import two modules for one decision. */
export type { InquiryOutboxRecord, OutboundSendState, RequestDisplay }
