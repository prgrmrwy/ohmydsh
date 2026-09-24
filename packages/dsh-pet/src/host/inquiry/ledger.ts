/**
 * Pure inquiry-ledger values and state transitions. Not a store, not a
 * dispatcher and not an authorization boundary.
 *
 * An inquiry is one bounded, Host-mediated question from one circle member to
 * another. This module owns only the VALUE MODEL: what a durable inquiry row
 * looks like, which status transitions are legal, and which budget predicates a
 * chain must satisfy. Everything that touches the world lives elsewhere — the
 * persistence slice must still write atomically, dedupe against its own applied
 * event log, and reconcile dispatch evidence; the dispatcher slice decides when
 * a target is runnable and performs the inbox handoff.
 *
 * Authorization is caller-derived scope membership, proven by the Host caller
 * resolver BEFORE this module runs and re-proven again at dispatch. The scope
 * identities recorded here are provenance, not proof: a fabricated object has
 * the same shape. Computing a record commits nothing and grants nothing.
 *
 * Host-derived facts (origin, audience, createdAt, the ancestor record) are
 * inputs; this module never samples a clock, reads storage or trusts a model
 * claim beyond checking that the claim matches the Host-derived fact.
 */

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

/** What the requesting model supplies. `declaredOrigin` is checked, not trusted. */
export interface InquiryRequest {
  readonly target: InquiryScope
  readonly question: string
  readonly purpose: string
  readonly declaredOrigin: InquiryOrigin | null
}

/** Facts the Host proved before this module runs. */
export interface InquiryContext {
  readonly inquiryId: string
  readonly requester: InquiryScope
  readonly circleParentSessionId: string
  readonly origin: InquiryOrigin
  readonly audience: InquiryAudience
  readonly createdAt: number
  /** The ancestor record for an inquiry-origin inquiry, else null. */
  readonly parent: InquiryRecord | null
  readonly rootInquiryCount: number
  readonly pendingCount: number
}

export type InquiryEventType =
  | 'dispatch' | 'answer' | 'deliver-result'
  | 'reject' | 'unavailable' | 'cancel' | 'needs-review'

export interface InquiryEvent {
  readonly type: InquiryEventType
  /** Host-owned dedup key; redelivering it must be a no-op, never an advance. */
  readonly eventId: string
  readonly at: number
  readonly reason: string | null
}

export type InquiryLedgerErrorCode =
  | 'INVALID_INQUIRY_INPUT'
  | 'ILLEGAL_TRANSITION'
  | 'ORIGIN_MISMATCH'
  | 'CHAIN_MISMATCH'
  | 'CHAIN_DEPTH_EXCEEDED'
  | 'TARGET_ALREADY_VISITED'
  | 'ROOT_BUDGET_EXCEEDED'
  | 'PENDING_BUDGET_EXCEEDED'

export class InquiryLedgerError extends Error {
  constructor(readonly code: InquiryLedgerErrorCode) {
    // Safe diagnostics: never echo a question, an answer, a purpose, a chat id
    // or any other member's identity back to the caller that tripped the rule.
    super({
      INVALID_INQUIRY_INPUT: 'Invalid inquiry input.',
      ILLEGAL_TRANSITION: 'Inquiry event is not legal for the current inquiry state.',
      ORIGIN_MISMATCH: 'Declared inquiry origin does not match the executing origin.',
      CHAIN_MISMATCH: 'Inquiry does not continue the referenced inquiry chain.',
      CHAIN_DEPTH_EXCEEDED: 'Inquiry chain depth budget is exhausted.',
      TARGET_ALREADY_VISITED: 'Inquiry target is already on this chain.',
      ROOT_BUDGET_EXCEEDED: 'Inquiry budget for this chain root is exhausted.',
      PENDING_BUDGET_EXCEEDED: 'Pending inquiry budget for this session is exhausted.',
    }[code])
    this.name = 'InquiryLedgerError'
  }
}
function fail(code: InquiryLedgerErrorCode): never { throw new InquiryLedgerError(code) }
function invalid(): never { fail('INVALID_INQUIRY_INPUT') }

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

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// Pure keys and budget predicates.
// ---------------------------------------------------------------------------

/** Exact identity including generation: a rebuilt child is a different member. */
export function inquiryMemberKey(input: unknown): string {
  const value = scope(input)
  return value.kind === 'main'
    ? `main:${value.sessionId}`
    : `child:${value.locusId}:${value.generation}:${value.sessionId}`
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

export function inquiryRootHasCapacity(existing: unknown): boolean {
  return integer(existing) < limits.maxInquiriesPerRoot
}

export function inquirySessionHasCapacity(pending: unknown): boolean {
  return integer(pending) < limits.maxPendingPerSession
}

export function inquiryTargetIsUnvisited(visited: unknown, target: unknown): boolean {
  const seats = items(visited, limits.maxChainEdges + 1).map(inquirySeatKey)
  return !seats.includes(inquirySeatKey(target))
}

export function isTerminalInquiryStatus(status: unknown): boolean {
  // `expired` remains terminal solely as historical v12 evidence. No transition
  // in the current machine can create it.
  return status === 'expired' || (status !== 'queued' && status !== 'executing' && status !== 'answered'
    && INQUIRY_STATUSES.includes(status as InquiryStatus))
}

// ---------------------------------------------------------------------------
// Records.
// ---------------------------------------------------------------------------

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

/** Audience may narrow to unknown, never widen past the origin it is bound to. */
function checkAudience(value: InquiryAudience, bound: InquiryOrigin, parent: InquiryRecord | null): void {
  if (value.kind === 'unknown') return
  if (bound.kind === 'feishu-delivery' && value.kind !== 'feishu-chat') invalid()
  if (bound.kind === 'local' && value.kind !== 'local-session') invalid()
  if (bound.kind === 'inquiry' && !same(value, parent?.audience)) invalid()
}

/**
 * Calculate one immutable queued inquiry from a model request plus Host facts.
 *
 * Both arguments are validated as actual runtime input. The trace is derived
 * from the Host-supplied ancestor, never from the request: an inquiry-origin
 * inquiry cannot mint a new root to escape the accumulated budget, and a member
 * already on the chain cannot be asked again. Throws InquiryLedgerError; never
 * mutates caller-owned objects. The caller MUST still persist this record and
 * enforce the counts it passed in atomically — the counts are a snapshot, and
 * only the store decides which concurrent candidate actually takes a slot.
 */
export function createInquiry(request: unknown, context: unknown): InquiryRecord {
  const asked = object(request, ['target', 'question', 'purpose', 'declaredOrigin'])
  const facts = object(context, [
    'inquiryId', 'requester', 'circleParentSessionId', 'origin', 'audience',
    'createdAt', 'parent', 'rootInquiryCount', 'pendingCount',
  ])
  const circleParentSessionId = identifier(facts.circleParentSessionId)
  const id = identifier(facts.inquiryId)
  const requester = scope(facts.requester, circleParentSessionId)
  const target = scope(asked.target, circleParentSessionId)
  const question = text(asked.question, limits.questionLength)
  const purpose = text(asked.purpose, limits.purposeLength)
  const createdAt = integer(facts.createdAt)
  const boundOrigin = origin(facts.origin)
  const boundAudience = audience(facts.audience)
  const rootInquiryCount = integer(facts.rootInquiryCount)
  const pendingCount = integer(facts.pendingCount)
  const parent = facts.parent === null ? null : parseInquiry(facts.parent)

  // A requester may restate its origin, but only truthfully. Feishu work cannot
  // be relabelled as private local work to widen what an answer may contain.
  if (asked.declaredOrigin !== null && !same(origin(asked.declaredOrigin), boundOrigin)) fail('ORIGIN_MISMATCH')

  if ((boundOrigin.kind === 'inquiry') !== (parent !== null)) fail('CHAIN_MISMATCH')
  if (parent !== null) {
    if (boundOrigin.kind !== 'inquiry' || boundOrigin.parentInquiryId !== parent.id) fail('CHAIN_MISMATCH')
    if (parent.circleParentSessionId !== circleParentSessionId) fail('CHAIN_MISMATCH')
    // Only a dispatched ancestor can branch: its target may ask onward, and its
    // requester may continue the chain once an answer came back. A queued or
    // failed ancestor is not an edge anyone is standing on.
    if (parent.status !== 'executing' && parent.status !== 'answered' && parent.status !== 'result-delivered') fail('CHAIN_MISMATCH')
    const seat = inquirySeatKey(requester)
    if (seat !== inquirySeatKey(parent.target) && seat !== inquirySeatKey(parent.requester)) fail('CHAIN_MISMATCH')
  }
  checkAudience(boundAudience, boundOrigin, parent)

  const rootInquiryId = parent === null ? id : parent.trace.rootInquiryId
  const depth = parent === null ? 1 : parent.trace.depth + 1
  if (depth > limits.maxChainEdges) fail('CHAIN_DEPTH_EXCEEDED')

  const inherited = parent === null ? [requester] : [...parent.trace.visited]
  if (!inquiryTargetIsUnvisited(inherited, target)) fail('TARGET_ALREADY_VISITED')
  const visited = Object.freeze([...inherited, target])

  if (!inquiryRootHasCapacity(rootInquiryCount)) fail('ROOT_BUDGET_EXCEEDED')
  if (!inquirySessionHasCapacity(pendingCount)) fail('PENDING_BUDGET_EXCEEDED')

  return Object.freeze({
    id, requester, target, circleParentSessionId, question, purpose,
    origin: boundOrigin, audience: boundAudience,
    trace: Object.freeze({ rootInquiryId, depth, visited }),
    createdAt,
    // Accepted only means accepted; it never means answered.
    status: 'queued' as const, statusAt: createdAt, reason: null,
    appliedEventIds: Object.freeze([]), diagnostics: Object.freeze([]), droppedDiagnostics: 0,
  })
}

// ---------------------------------------------------------------------------
// Transitions.
// ---------------------------------------------------------------------------

/**
 * The whole machine. 'needs-review' is reachable only from a state that was
 * actually dispatched, and nothing leads out of it: a dispatched-but-unknown
 * outcome can never be converted into a success by replaying events.
 */
const transitions: Readonly<Record<InquiryEventType, { readonly from: readonly InquiryStatus[]; readonly to: InquiryStatus }>> = Object.freeze({
  dispatch: { from: ['queued'], to: 'executing' },
  answer: { from: ['executing'], to: 'answered' },
  'deliver-result': { from: ['answered'], to: 'result-delivered' },
  reject: { from: ['queued', 'executing'], to: 'rejected' },
  unavailable: { from: ['queued', 'executing'], to: 'unavailable' },
  cancel: { from: ['queued', 'executing', 'answered'], to: 'cancelled' },
  'needs-review': { from: ['executing', 'answered'], to: 'needs-review' },
})
/** These three are the reason-free progress events. */
const progressEvents: readonly InquiryEventType[] = Object.freeze(['dispatch', 'answer', 'deliver-result'])

function parseEvent(input: unknown): InquiryEvent {
  const value = object(input, ['type', 'eventId', 'at', 'reason'])
  const type = value.type as InquiryEventType
  if (!Object.prototype.hasOwnProperty.call(transitions, type) || typeof type !== 'string') invalid()
  const reason = value.reason === null ? null : reasonCode(value.reason)
  // A failure must say why in a stable code; a success must not carry a reason.
  if (progressEvents.includes(type) === (reason !== null)) invalid()
  return Object.freeze({ type, eventId: identifier(value.eventId), at: integer(value.at), reason })
}

/**
 * Apply one Host event to an inquiry, returning a new frozen record.
 *
 * Re-applying an event that already reached the current status is a no-op that
 * returns an equal record: a redelivered dispatch, answer or failure cannot
 * double-advance the machine or overwrite the first recorded outcome. An
 * illegal transition — including any attempt to leave a terminal status or to
 * move time backwards — throws ILLEGAL_TRANSITION. Elapsed wall time is never
 * a transition condition. This module decides legality only; the store must still
 * commit the result together with its own dedup log.
 */
export function applyInquiryEvent(record: unknown, event: unknown): InquiryRecord {
  const current = parseInquiry(record)
  const applied = parseEvent(event)
  const { from, to } = transitions[applied.type]

  // Idempotence first: the same outcome, however it is redelivered, changes nothing.
  if (to === current.status) return current
  if (current.appliedEventIds.includes(applied.eventId)) fail('ILLEGAL_TRANSITION')
  if (!from.includes(current.status as InquiryStatus)) fail('ILLEGAL_TRANSITION')
  if (applied.at < current.statusAt) fail('ILLEGAL_TRANSITION')
  if (current.appliedEventIds.length >= limits.appliedEvents) invalid()

  return Object.freeze({
    ...current,
    status: to, statusAt: applied.at, reason: applied.reason,
    appliedEventIds: Object.freeze([...current.appliedEventIds, applied.eventId]),
  })
}

/**
 * Retain a discarded event as an owner-visible diagnostic.
 *
 * A late or duplicate answer is evidence, not a state change: the status,
 * statusAt and reason are preserved exactly, so a terminal inquiry is never
 * revived, no continuation is triggered and no outbound message is implied.
 * Retention is bounded and the overflow is counted rather than silently lost.
 */
export function recordInquiryDiagnostic(record: unknown, entry: unknown): InquiryRecord {
  const current = parseInquiry(record)
  const note = diagnostic(entry)
  if (current.diagnostics.some(existing => existing.eventId === note.eventId)) return current
  if (current.diagnostics.length >= limits.diagnostics) {
    // Keep the earliest evidence; a flood cannot push the first fact out.
    return Object.freeze({ ...current, droppedDiagnostics: current.droppedDiagnostics + 1 })
  }
  return Object.freeze({ ...current, diagnostics: Object.freeze([...current.diagnostics, note]) })
}
