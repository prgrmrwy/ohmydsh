/** Read-only historical inquiry values and parser. New questions and state transitions are retired. */

/** Ordered from the accepted path to terminal states new code may create. */
export const INQUIRY_STATUSES = Object.freeze([
  'queued', 'executing', 'answered', 'result-delivered',
  'rejected', 'unavailable', 'cancelled', 'needs-review',
] as const)

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]
/** Parser-only compatibility for terminal evidence written by domain v12. */
export type InquiryRecordStatus = InquiryStatus | 'expired'

/** Outcomes retained for the owner only; they never revive a terminal record. */
export const INQUIRY_DIAGNOSTIC_KINDS = Object.freeze([
  'late-answer', 'duplicate-answer', 'late-result', 'unknown-dispatch-outcome',
] as const)

export type InquiryDiagnosticKind = (typeof INQUIRY_DIAGNOSTIC_KINDS)[number]

/**
 * The first testable running budget from design D5. String limits count JS
 * UTF-16 code units; list bounds also bound total record size.
 */
export const INQUIRY_LIMITS = Object.freeze({
  /** At most 3 edges on one chain, i.e. trace depth 1..3. */
  maxChainEdges: 3,
  maxInquiriesPerRoot: 16,
  maxPendingPerSession: 32,
  identifierLength: 256,
  questionLength: 4_096,
  purposeLength: 1_024,
  /** Stable machine codes only, never an operator sentence or message text. */
  reasonLength: 64,
  appliedEvents: 64,
  diagnostics: 32,
})
const limits = INQUIRY_LIMITS

/**
 * Who asked and who is asked, as a durable circle position.
 *
 * A child names its exact locusId AND generation, so a stale reference cannot
 * silently address a rebuilt successor; the resolver, not this module, decides
 * whether that generation is still current.
 */
export type InquiryScope =
  | { readonly kind: 'main'; readonly sessionId: string }
  | { readonly kind: 'child'; readonly sessionId: string; readonly locusId: string; readonly generation: number }

/** Where the requester's work actually came from. Host-derived, never model-chosen. */
export type InquiryOrigin =
  | { readonly kind: 'feishu-delivery'; readonly deliveryId: string }
  | { readonly kind: 'local' }
  | { readonly kind: 'inquiry'; readonly parentInquiryId: string }

/** Who may ultimately read the answer. 'unknown' tightens disclosure, it does not guess. */
export type InquiryAudience =
  | { readonly kind: 'feishu-chat'; readonly chatId: string }
  | { readonly kind: 'local-session'; readonly sessionId: string }
  | { readonly kind: 'unknown' }

export interface InquiryTrace {
  /** The root never moves; an inquiry-origin inquiry cannot mint a fresh root. */
  readonly rootInquiryId: string
  /** Number of edges including this one: 1 for a root inquiry. */
  readonly depth: number
  /** Every member already on this chain, requester first, target last. */
  readonly visited: readonly InquiryScope[]
}

export interface InquiryDiagnostic {
  readonly kind: InquiryDiagnosticKind
  readonly at: number
  /** Correlates with the discarded event; the message body is NOT stored here. */
  readonly eventId: string
}

export interface InquiryRecord {
  readonly id: string
  readonly requester: InquiryScope
  readonly target: InquiryScope
  /** The one fixed circle both ends belong to. */
  readonly circleParentSessionId: string
  readonly question: string
  /** Declared use, an input to disclosure judgement and never an authorization. */
  readonly purpose: string
  readonly origin: InquiryOrigin
  readonly audience: InquiryAudience
  readonly trace: InquiryTrace
  /** Retained for wait-age display and diagnostics; never a refusal clock. */
  readonly createdAt: number
  readonly status: InquiryRecordStatus
  readonly statusAt: number
  /** Stable machine code for a failure status; null for the accepted path. */
  readonly reason: string | null
  /** Applied event ids, so a redelivered event cannot double-advance. */
  readonly appliedEventIds: readonly string[]
  readonly diagnostics: readonly InquiryDiagnostic[]
  readonly droppedDiagnostics: number
}

export class InquiryLedgerError extends Error {
  readonly code = 'INVALID_INQUIRY_INPUT'
  constructor() { super('Invalid retained inquiry record.'); this.name = 'InquiryLedgerError' }
}
function invalid(): never { throw new InquiryLedgerError() }

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
  if (typeof input !== 'string' || input.length === 0 || input.length > max || input.trim().length === 0) invalid()
  return input
}
function identifier(input: unknown): string {
  const value = text(input, limits.identifierLength)
  if (value.trim() !== value) invalid()
  return value
}
function integer(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid()
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
  const value = text(input, limits.reasonLength)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) invalid()
  return value
}
function discriminant(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const kind = Object.getOwnPropertyDescriptor(input, 'kind')
  if (!kind || !('value' in kind)) invalid()
  return kind.value
}

function scope(input: unknown, circleParentSessionId?: string): InquiryScope {
  const kind = discriminant(input)
  if (kind === 'main') {
    const value = object(input, ['kind', 'sessionId'])
    const sessionId = identifier(value.sessionId)
    // The main session IS the circle; any other main id is outside this circle.
    if (circleParentSessionId !== undefined && sessionId !== circleParentSessionId) invalid()
    return Object.freeze({ kind: 'main' as const, sessionId })
  }
  if (kind !== 'child') invalid()
  const value = object(input, ['kind', 'sessionId', 'locusId', 'generation'])
  const sessionId = identifier(value.sessionId)
  const generation = integer(value.generation)
  if (generation < 1) invalid()
  if (circleParentSessionId !== undefined && sessionId === circleParentSessionId) invalid()
  return Object.freeze({ kind: 'child' as const, sessionId, locusId: identifier(value.locusId), generation })
}

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

function audience(input: unknown): InquiryAudience {
  const kind = discriminant(input)
  if (kind === 'unknown') { object(input, ['kind']); return Object.freeze({ kind: 'unknown' as const }) }
  if (kind === 'feishu-chat') {
    const value = object(input, ['kind', 'chatId'])
    return Object.freeze({ kind: 'feishu-chat' as const, chatId: identifier(value.chatId) })
  }
  if (kind !== 'local-session') invalid()
  const value = object(input, ['kind', 'sessionId'])
  return Object.freeze({ kind: 'local-session' as const, sessionId: identifier(value.sessionId) })
}

/**
 * Circle position without generation.
 *
 * Loop prevention works on the seat, not the incarnation: asking the rebuilt
 * successor of a member already on this chain is still the same cycle.
 */
export function inquirySeatKey(input: unknown): string {
  const value = scope(input)
  return value.kind === 'main' ? `main:${value.sessionId}` : `child:${value.locusId}`
}

const recordKeys = [
  'id', 'requester', 'target', 'circleParentSessionId', 'question', 'purpose',
  'origin', 'audience', 'trace', 'createdAt', 'status', 'statusAt',
  'reason', 'appliedEventIds', 'diagnostics', 'droppedDiagnostics',
] as const
const legacyRecordKeys = [...recordKeys, 'deadlineAt'] as const
/** The immutable bound used only to validate, then strip, a v12 row. */
const LEGACY_ABSOLUTE_DEADLINE_MS = 300_000

function diagnostic(input: unknown): InquiryDiagnostic {
  const value = object(input, ['kind', 'at', 'eventId'])
  if (!INQUIRY_DIAGNOSTIC_KINDS.includes(value.kind as InquiryDiagnosticKind)) invalid()
  return Object.freeze({ kind: value.kind as InquiryDiagnosticKind, at: integer(value.at), eventId: identifier(value.eventId) })
}

function uniqueIds(input: unknown, max: number): readonly string[] {
  const values = items(input, max).map(identifier)
  if (new Set(values).size !== values.length) invalid()
  return Object.freeze(values)
}

/** Validate actual runtime values, not just a TypeScript-declared shape. */
export function parseInquiry(input: unknown): InquiryRecord {
  // Domain v13 writes the deadline-free shape. A v12 row is accepted only in
  // its exact old shape, validated under the old bound, and normalized in
  // memory without rewriting or losing the durable historical row.
  const hasLegacyDeadline = input !== null && typeof input === 'object'
    && Object.prototype.hasOwnProperty.call(input, 'deadlineAt')
  const value = object(input, hasLegacyDeadline ? legacyRecordKeys : recordKeys)
  const id = identifier(value.id)
  const circleParentSessionId = identifier(value.circleParentSessionId)
  const requester = scope(value.requester, circleParentSessionId)
  const target = scope(value.target, circleParentSessionId)
  const createdAt = integer(value.createdAt)
  if (hasLegacyDeadline) {
    const deadlineAt = integer(value.deadlineAt)
    if (deadlineAt <= createdAt || deadlineAt > createdAt + LEGACY_ABSOLUTE_DEADLINE_MS) invalid()
  }
  const statusAt = integer(value.statusAt)
  const status = value.status as InquiryRecordStatus
  if (status !== 'expired' && !INQUIRY_STATUSES.includes(status as InquiryStatus)) invalid()
  if (statusAt < createdAt) invalid()
  const recordOrigin = origin(value.origin)
  const recordAudience = audience(value.audience)
  const traceValue = object(value.trace, ['rootInquiryId', 'depth', 'visited'])
  const rootInquiryId = identifier(traceValue.rootInquiryId)
  const depth = integer(traceValue.depth)
  const visited = items(traceValue.visited, limits.maxChainEdges + 1)
    .map(member => scope(member, circleParentSessionId))
  if (depth < 1 || depth > limits.maxChainEdges) invalid()
  // The trace is Host-derived and self-describing: one edge adds one member.
  if (visited.length !== depth + 1) invalid()
  if (new Set(visited.map(inquirySeatKey)).size !== visited.length) invalid()
  if (inquirySeatKey(visited[visited.length - 1]!) !== inquirySeatKey(target)) invalid()
  if (!visited.some(member => inquirySeatKey(member) === inquirySeatKey(requester))) invalid()
  // An inquiry-origin record is never its own root, and a root always is.
  if ((recordOrigin.kind === 'inquiry') !== (depth > 1)) invalid()
  if ((rootInquiryId === id) !== (depth === 1)) invalid()
  const reason = value.reason === null ? null : reasonCode(value.reason)
  // Only a failure carries a reason; the accepted path must not invent one.
  const failed = status !== 'queued' && status !== 'executing' && status !== 'answered' && status !== 'result-delivered'
  if (failed !== (reason !== null)) invalid()
  return Object.freeze({
    id, requester, target, circleParentSessionId,
    question: text(value.question, limits.questionLength),
    purpose: text(value.purpose, limits.purposeLength),
    origin: recordOrigin, audience: recordAudience,
    trace: Object.freeze({ rootInquiryId, depth, visited: Object.freeze(visited) }),
    createdAt, status, statusAt, reason,
    appliedEventIds: uniqueIds(value.appliedEventIds, limits.appliedEvents),
    diagnostics: Object.freeze(items(value.diagnostics, limits.diagnostics).map(diagnostic)),
    droppedDiagnostics: integer(value.droppedDiagnostics),
  })
}
