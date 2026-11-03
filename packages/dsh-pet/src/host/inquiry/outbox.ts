/** Read-only historical inquiry result parser. Result creation and continuation are retired. */
import type { InquiryOrigin, InquiryScope } from './ledger.js'

/**
 * Delivery status of ONE result, which is not the inquiry's own status.
 *
 * `delivered` means a continuation segment actually took this result, never
 * that a Feishu body was sent. `refused` is a failed re-verification;
 * `retained` is a late or inert result kept as owner evidence only.
 */
export const INQUIRY_OUTBOX_STATUSES = Object.freeze([
  'pending', 'delivered', 'refused', 'retained',
] as const)

export type InquiryOutboxStatus = (typeof INQUIRY_OUTBOX_STATUSES)[number]

/** Failure outcomes that are DELIVERED to the requester exactly like an answer. */
export const INQUIRY_RESULT_FAILURES = Object.freeze([
  'rejected', 'unavailable', 'cancelled', 'needs-review',
] as const)

export type InquiryResultFailure = (typeof INQUIRY_RESULT_FAILURES)[number]

/**
 * Parser-only compatibility for a result emitted by domain v12. Current v13
 * writers never emit `expired`; legacy rows are accepted only when a storage
 * adapter explicitly normalizes them before calling current transitions.
 */
export type LegacyInquiryResultFailure = InquiryResultFailure | 'expired'

/** Why a result was refused, retained or flagged. Stable codes, never prose. */
export const INQUIRY_OUTBOX_DIAGNOSTIC_CODES = Object.freeze([
  'requester-rebuilt', 'requester-absent', 'work-settled', 'work-mismatch',
  'work-unknown', 'inquiry-mismatch', 'permission-revoked',
  'result-not-pending', 'late-result', 'duplicate-result',
  'delivery-outcome-unknown',
] as const)

export type InquiryOutboxDiagnosticCode = (typeof INQUIRY_OUTBOX_DIAGNOSTIC_CODES)[number]

export const INQUIRY_OUTBOX_LIMITS = Object.freeze({
  identifierLength: 256,
  /** Bounds both the dedup key and any Host-generated segment id. */
  keyLength: 1_024,
  appliedEvents: 32,
  diagnostics: 16,
})
const limits = INQUIRY_OUTBOX_LIMITS

/**
 * The result itself, as a fact about the inquiry rather than a body.
 *
 * An answer variant carries NO text: the body lives in the answer store and is
 * read by the continuation, so an outbox row can be inspected, listed and
 * diagnosed without exposing what was said.
 */
export type InquiryResult =
  | { readonly kind: 'answer'; readonly answeredAt: number }
  | {
      readonly kind: 'failure'
      readonly failure: InquiryResultFailure
      /** Stable machine code; never an operator sentence or message text. */
      readonly reason: string
      readonly failedAt: number
    }

export interface InquiryOutboxDiagnostic {
  readonly code: InquiryOutboxDiagnosticCode
  readonly at: number
  /** Correlates with the discarded event; no body is ever stored here. */
  readonly eventId: string
}

/**
 * One durable result awaiting (or past) hand-back to its requester.
 *
 * `resumeWork` is the origin captured at ACCEPT time, copied from the inquiry:
 * a Feishu delivery identity, local/GUI work, or a parent inquiry. It is fixed
 * forever, which is precisely what makes "do not rebind to the most recent
 * Delivery" enforceable — there is no field to rebind.
 */
export interface InquiryOutboxRecord {
  readonly inquiryId: string
  readonly requester: InquiryScope
  readonly resumeWork: InquiryOrigin
  readonly result: InquiryResult
  /** Derived, not supplied: the same result can only ever be queued once. */
  readonly dedupKey: string
  readonly status: InquiryOutboxStatus
  readonly createdAt: number
  readonly statusAt: number
  /** The ONE continuation segment that took this result; null until delivered. */
  readonly deliveredSegmentId: string | null
  /** Applied event ids, so a redelivered event cannot double-advance. */
  readonly appliedEventIds: readonly string[]
  readonly diagnostics: readonly InquiryOutboxDiagnostic[]
  readonly droppedDiagnostics: number
}

export class InquiryOutboxError extends Error {
  readonly code = 'INVALID_OUTBOX_INPUT'
  constructor() { super('Invalid retained inquiry result.'); this.name = 'InquiryOutboxError' }
}
function invalid(): never { throw new InquiryOutboxError() }

// ---------------------------------------------------------------------------
// Strict runtime input validation. Every helper reads actual runtime data
// properties, refuses unknown keys, never invokes a caller getter, and returns
// a detached value; no caller-owned object is ever mutated or frozen.
// ---------------------------------------------------------------------------

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) invalid()
  const actual = Reflect.ownKeys(input)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) invalid()
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    // Don't invoke getters on caller-controlled objects.
    if (!property || !('value' in property)) invalid()
    result[key] = property.value
  }
  return result
}
function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > max || input.trim() !== input) invalid()
  return input
}
function identifier(input: unknown): string { return text(input, limits.identifierLength) }
function integer(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid()
  return input
}
function flag(input: unknown): boolean {
  if (typeof input !== 'boolean') invalid()
  return input
}
/** Plain dense arrays only: reject holes and hidden extra runtime properties. */
function items(input: unknown, max: number): readonly unknown[] {
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
/** Stable machine code, never an operator sentence or any message content. */
function reasonCode(input: unknown): string {
  const value = text(input, 64)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) invalid()
  return value
}
function discriminant(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const kind = Object.getOwnPropertyDescriptor(input, 'kind')
  if (!kind || !('value' in kind)) invalid()
  return kind.value
}

/** Same shape the ledger records; a child names its locus AND generation. */
function scope(input: unknown): InquiryScope {
  const kind = discriminant(input)
  if (kind === 'main') {
    const value = object(input, ['kind', 'sessionId'])
    return Object.freeze({ kind: 'main' as const, sessionId: identifier(value.sessionId) })
  }
  if (kind !== 'child') invalid()
  const value = object(input, ['kind', 'sessionId', 'locusId', 'generation'])
  const generation = integer(value.generation)
  if (generation < 1) invalid()
  return Object.freeze({
    kind: 'child' as const, sessionId: identifier(value.sessionId),
    locusId: identifier(value.locusId), generation,
  })
}

/** The work this result must resume; copied from the inquiry, never chosen. */
function origin(input: unknown): InquiryOrigin {
  const kind = discriminant(input)
  if (kind === 'local') { object(input, ['kind']); return Object.freeze({ kind: 'local' as const }) }
  if (kind === 'feishu-delivery') {
    const value = object(input, ['kind', 'deliveryId'])
    return Object.freeze({ kind: 'feishu-delivery' as const, deliveryId: identifier(value.deliveryId) })
  }
  if (kind !== 'inquiry') invalid()
  const value = object(input, ['kind', 'parentInquiryId'])
  return Object.freeze({ kind: 'inquiry' as const, parentInquiryId: identifier(value.parentInquiryId) })
}

function result(input: unknown): InquiryResult {
  const kind = discriminant(input)
  if (kind === 'answer') {
    const value = object(input, ['kind', 'answeredAt'])
    return Object.freeze({ kind: 'answer' as const, answeredAt: integer(value.answeredAt) })
  }
  if (kind !== 'failure') invalid()
  const value = object(input, ['kind', 'failure', 'reason', 'failedAt'])
  if (!INQUIRY_RESULT_FAILURES.includes(value.failure as InquiryResultFailure)) invalid()
  return Object.freeze({
    kind: 'failure' as const, failure: value.failure as InquiryResultFailure,
    reason: reasonCode(value.reason), failedAt: integer(value.failedAt),
  })
}

function diagnostic(input: unknown): InquiryOutboxDiagnostic {
  const value = object(input, ['code', 'at', 'eventId'])
  if (!INQUIRY_OUTBOX_DIAGNOSTIC_CODES.includes(value.code as InquiryOutboxDiagnosticCode)) invalid()
  return Object.freeze({
    code: value.code as InquiryOutboxDiagnosticCode,
    at: integer(value.at), eventId: identifier(value.eventId),
  })
}

function uniqueIds(input: unknown, max: number): readonly string[] {
  const values = items(input, max).map(identifier)
  if (new Set(values).size !== values.length) invalid()
  return Object.freeze(values)
}

// ---------------------------------------------------------------------------
// Dedup key and records.
// ---------------------------------------------------------------------------

/**
 * The idempotency key for ONE result.
 *
 * It binds the inquiry to the exact outcome, so an answer and a later failure
 * for the same inquiry are distinguishable keys — which is what lets the store
 * refuse the second one loudly instead of quietly queueing a second
 * continuation. Deterministic: a redelivered result recomputes the same key.
 */
export function inquiryResultDedupKey(inquiryId: unknown, outcome: unknown): string {
  const id = identifier(inquiryId)
  const value = result(outcome)
  return value.kind === 'answer'
    ? JSON.stringify(['result', id, 'answer'])
    : JSON.stringify(['result', id, 'failure', value.failure])
}

const recordKeys = [
  'inquiryId', 'requester', 'resumeWork', 'result', 'dedupKey', 'status',
  'createdAt', 'statusAt', 'deliveredSegmentId', 'appliedEventIds',
  'diagnostics', 'droppedDiagnostics',
] as const

/**
 * Validate an actual stored row, not just a TypeScript-declared shape.
 *
 * Validating on the way out of storage is what makes a schema drift fail loud:
 * a renamed field is corruption, never a differently-shaped acceptable result.
 */
export function parseInquiryOutboxRecord(input: unknown): InquiryOutboxRecord {
  const value = object(input, recordKeys)
  const inquiryId = identifier(value.inquiryId)
  const outcome = result(value.result)
  const status = value.status as InquiryOutboxStatus
  if (!INQUIRY_OUTBOX_STATUSES.includes(status)) invalid()
  const createdAt = integer(value.createdAt)
  const statusAt = integer(value.statusAt)
  if (statusAt < createdAt) invalid()
  // The key is derived, so a stored key that disagrees is a forged or drifted
  // row: accepting it would let one result occupy two dedup slots.
  const dedupKey = text(value.dedupKey, limits.keyLength)
  if (dedupKey !== inquiryResultDedupKey(inquiryId, outcome)) invalid()
  // Only a delivered result names a segment, and a delivered one must.
  const deliveredSegmentId = value.deliveredSegmentId === null ? null : text(value.deliveredSegmentId, limits.keyLength)
  if ((deliveredSegmentId !== null) !== (status === 'delivered')) invalid()
  return Object.freeze({
    inquiryId,
    requester: scope(value.requester),
    resumeWork: origin(value.resumeWork),
    result: outcome,
    dedupKey, status, createdAt, statusAt, deliveredSegmentId,
    appliedEventIds: uniqueIds(value.appliedEventIds, limits.appliedEvents),
    diagnostics: Object.freeze(items(value.diagnostics, limits.diagnostics).map(diagnostic)),
    droppedDiagnostics: integer(value.droppedDiagnostics),
  })
}
