/**
 * Pure Delivery correlation and settlement for unified locus work.
 *
 * A Delivery is the Host's durable-looking (but storage-neutral) association
 * between one accepted platform message and one child turn.  It deliberately
 * does not know about Lark, DSH agents, repositories, feedback clients, or
 * parent sessions.  Callers can persist the returned ledger and perform the
 * actual feedback side effect from the immutable `feedbackTarget` on the
 * settled record.
 *
 * The important boundary is correlation: a child id alone is not enough to
 * identify a request.  Every FIFO lookup is scoped by endpoint, locus id,
 * locus generation, and child session.  Settlement additionally requires a
 * per-turn identity from a host adapter.  A child lifecycle/activation event
 * (for example `subagent/end`) is not a per-delivery settlement and MUST NOT
 * be passed to this module without such a turn proof.  This keeps an old
 * child/generation from settling a newer generation, and keeps unrelated child
 * turns (such as initialization or a GUI turn) out of the feedback queue.
 */

/** The endpoint a Delivery belongs to (a chat, optionally a thread). */
export interface DeliveryEndpoint {
  readonly chatId: string
  readonly threadId?: string
}

/** The immutable execution identity used to match a settlement event. */
export interface DeliveryCorrelation {
  readonly endpoint: DeliveryEndpoint
  readonly locusId: string
  readonly generation: number
  readonly childSessionId: string
}

/**
 * Per-turn identity supplied by a host adapter.
 *
 * A child lifecycle/activation event is not a turn settlement.  The adapter
 * must provide this identity (or an equivalent proof) before calling a
 * settlement function; a child id alone is intentionally insufficient.
 */
export interface DeliveryTurnCorrelation extends DeliveryCorrelation {
  /** Per-turn identity from a host adapter; child activation is not enough. */
  readonly turnId: string
}

/** Exact host proof required before a Delivery can become terminal. */
export interface DeliveryExecutionProof {
  /** Host-generated token armed before queueing the child inbox message. */
  readonly executionId: string
  /** Numeric turn identity established by the trusted per-turn observer. */
  readonly turnId: string
}

/** Terminal outcome represented by the Delivery state machine. */
export type DeliveryOutcome = 'settled' | 'failed'

/** States of one accepted Delivery. */
export type DeliveryStatus =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'settled'
  | 'failed'

/** A target derived from the accepted message, never supplied by settlement. */
export interface DeliveryFeedbackTarget extends DeliveryEndpoint {
  readonly messageId: string
  /** Root message for a trusted topic reply, when the platform supplied one. */
  readonly rootMessageId?: string
}

/** Input used when admitting a new message. */
export interface DeliveryInput extends DeliveryCorrelation {
  readonly messageId: string
  /** Optional caller-provided id; otherwise a deterministic id is allocated. */
  readonly deliveryId?: string
  /** Legacy callers may supply proof, but strict acceptance rejects it. */
  readonly turnId?: string
  readonly executionId?: string
  /** Sender/request facts retained by a durable channel adapter when available. */
  readonly senderOpenId?: string
  readonly senderName?: string
  readonly text?: string
  readonly rootMessageId?: string
  readonly replyTarget?: DeliveryFeedbackTarget
  /** The platform parent reply id, retained separately from canonical root/thread. */
  readonly replyToMessageId?: string
  /** Optional caller-owned clock value. The module never reads the clock. */
  readonly acceptedAt?: number
}

/** One immutable Delivery record. */
export interface DeliveryRecord extends DeliveryCorrelation {
  readonly deliveryId: string
  readonly messageId: string
  /** Root reply context retained as durable request metadata when supplied. */
  readonly rootMessageId?: string
  /** Sender/request metadata, retained when supplied by the channel adapter. */
  readonly senderOpenId?: string
  readonly senderName?: string
  readonly text?: string
  readonly replyTarget?: DeliveryFeedbackTarget
  /** The platform parent reply id, when present in the accepted event. */
  readonly replyToMessageId?: string
  /** Per-turn identity, when the host adapter has assigned one. */
  readonly turnId?: string
  /** Host execution token, when an exact queue binding has been proven. */
  readonly executionId?: string
  /** Monotonic acceptance order, used for FIFO settlement. */
  readonly sequence: number
  readonly status: DeliveryStatus
  readonly feedbackTarget: DeliveryFeedbackTarget
  readonly acceptedAt?: number
  readonly queuedAt?: number
  readonly startedAt?: number
  readonly settledAt?: number
  readonly failedAt?: number
  readonly failureReason?: string
}

/** Message-indexed and delivery-id-indexed state suitable for persistence. */
export interface DeliveryLedgerState {
  readonly byMessageId: Readonly<Record<string, DeliveryRecord>>
  readonly byDeliveryId: Readonly<Record<string, DeliveryRecord>>
  readonly nextDeliverySequence: number
}

/** Result of accepting a message. Duplicate acceptance returns the old record. */
export interface DeliveryAcceptance {
  readonly state: DeliveryLedgerState
  readonly record: DeliveryRecord
  /** The message id already had a durable record. */
  readonly duplicate: boolean
  /** Replay supplied a different endpoint/locus generation/child tuple. */
  readonly conflict: boolean
}

/** Why a state transition was not applied. */
export type DeliveryMutationReason =
  | 'unknown-delivery'
  | 'correlation-mismatch'
  | 'already-in-state'
  | 'already-terminal'
  | 'invalid-transition'
  | 'execution-proof-required'
  | 'no-pending-delivery'

/** Result of a progress or settlement operation. */
export interface DeliveryMutation {
  readonly state: DeliveryLedgerState
  readonly record: DeliveryRecord | undefined
  /** Only the first terminal transition returns a feedback target. */
  readonly feedbackTarget?: DeliveryFeedbackTarget
  readonly changed: boolean
  readonly reason: DeliveryMutationReason | undefined
}

/** A settlement event with an optional explicit delivery id. */
export interface DeliverySettlementInput extends DeliveryExecutionProof {
  readonly deliveryId?: string
  readonly outcome: DeliveryOutcome
  /**
   * Required for every settlement. A child lifecycle/activation event is not a
   * turn event; the host adapter must supply this per-turn proof.
   */
  readonly correlation: DeliveryTurnCorrelation
  /** Required caller-owned terminal timestamp. */
  readonly settledAt: number
  readonly failureReason?: string
}

/** Correlation required for FIFO lookup before a per-turn proof is available. */
export type DeliveryQueueCorrelation = DeliveryCorrelation

const TERMINAL_STATUSES = new Set<DeliveryStatus>(['settled', 'failed'])
const PENDING_STATUSES = new Set<DeliveryStatus>(['accepted', 'queued', 'running'])
const EMPTY_INDEX: Readonly<Record<string, DeliveryRecord>> = Object.freeze(
  Object.create(null) as Record<string, DeliveryRecord>,
)

/** Create an empty immutable ledger. */
export function createDeliveryLedger(): DeliveryLedgerState {
  return {
    byMessageId: EMPTY_INDEX,
    byDeliveryId: EMPTY_INDEX,
    nextDeliverySequence: 1,
  }
}

/**
 * Accept one message exactly once.
 *
 * The message id is the idempotency key.  A duplicate returns the original
 * record unchanged, even when a redelivery supplies a different endpoint,
 * generation, child, or requested feedback target.  This prevents a replay
 * from retargeting an already accepted request.
 */
export function acceptDelivery(
  state: DeliveryLedgerState,
  input: DeliveryInput,
): DeliveryAcceptance {
  // Validate the idempotency key before looking it up, but do not validate or
  // apply the replay's other fields until after the duplicate probe. A replay
  // must never be able to retarget an accepted message (and malformed replay
  // metadata must not turn a harmless redelivery into a second execution).
  assertIdentifier(input.messageId, 'messageId')
  const existing = state.byMessageId[input.messageId]
  if (existing !== undefined) {
    return {
      state,
      record: existing,
      duplicate: true,
      conflict: !correlates(existing, input),
    }
  }
  validateDeliveryInput(input)

  const requestedId = input.deliveryId
  if (requestedId !== undefined) assertIdentifier(requestedId, 'deliveryId')
  const deliveryId = requestedId ?? `delivery-${state.nextDeliverySequence}`
  const conflicting = state.byDeliveryId[deliveryId]
  if (conflicting !== undefined) {
    throw new TypeError(`deliveryId '${deliveryId}' is already used`)
  }

  const sequence = state.nextDeliverySequence
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('nextDeliverySequence must be a positive safe integer')
  }

  const rootMessageId = input.rootMessageId ?? input.replyTarget?.rootMessageId
  const record = freezeRecord({
    deliveryId,
    messageId: input.messageId,
    endpoint: cloneEndpoint(input.endpoint),
    locusId: input.locusId,
    generation: input.generation,
    childSessionId: input.childSessionId,
    ...(rootMessageId !== undefined ? { rootMessageId } : {}),
    ...(input.senderOpenId !== undefined ? { senderOpenId: input.senderOpenId } : {}),
    ...(input.senderName !== undefined ? { senderName: input.senderName } : {}),
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.replyTarget !== undefined ? { replyTarget: Object.freeze({ ...input.replyTarget }) } : {}),
    ...(input.replyToMessageId !== undefined ? { replyToMessageId: input.replyToMessageId } : {}),
    sequence,
    status: 'accepted',
    feedbackTarget: cloneFeedbackTarget(input.endpoint, input.messageId, rootMessageId),
    ...(input.acceptedAt !== undefined ? { acceptedAt: input.acceptedAt } : {}),
  })

  const byMessageId = addToIndex(state.byMessageId, input.messageId, record)
  const byDeliveryId = addToIndex(state.byDeliveryId, deliveryId, record)
  return {
    state: {
      byMessageId,
      byDeliveryId,
      nextDeliverySequence: sequence + 1,
    },
    record,
    duplicate: false,
    conflict: false,
  }
}

/*
 * Legacy progress helpers intentionally remain private to this module's old
 * callers. New channel code must use bindQueued -> bindTurn -> settleByTurn;
 * these wrappers require the exact execution/turn proof and never invent it.
 */
/** @deprecated Use bindQueued with an execution token. */
export function queueDelivery(
  state: DeliveryLedgerState,
  deliveryId: string,
  correlation: DeliveryCorrelation,
  queuedAt?: number,
  executionId?: string,
): DeliveryMutation {
  if (executionId === undefined) return unchanged(state, 'execution-proof-required', state.byDeliveryId[deliveryId])
  return bindQueued(state, { ...correlation, deliveryId, executionId, ...(queuedAt !== undefined ? { queuedAt } : {}) })
}

/** @deprecated Use bindTurn with a queued execution token. */
export function startDelivery(
  state: DeliveryLedgerState,
  deliveryId: string,
  correlation: DeliveryCorrelation,
  startedAt?: number,
  executionId?: string,
  turnId?: string,
): DeliveryMutation {
  if (executionId === undefined || turnId === undefined) {
    return unchanged(state, 'execution-proof-required', state.byDeliveryId[deliveryId])
  }
  return bindTurn(state, {
    ...correlation,
    deliveryId,
    executionId,
    turnId,
    ...(startedAt !== undefined ? { startedAt } : {}),
  })
}

/** Input to the generic progress transition function. */
export interface DeliveryTransitionInput {
  readonly deliveryId: string
  readonly status: 'queued' | 'running' | DeliveryOutcome
  readonly correlation?: DeliveryCorrelation | DeliveryTurnCorrelation
  /** Required for terminal transitions; must match the queued host token. */
  readonly executionId?: string
  /** Required for terminal transitions; must match the trusted started turn. */
  readonly turnId?: string
  readonly at?: number
  readonly failureReason?: string
}

/** Exact execution binding established after child inbox acceptance. */
export interface DeliveryQueuedBindingInput extends DeliveryCorrelation {
  readonly deliveryId: string
  readonly executionId: string
  /** Optional caller-owned timestamp for the queued transition. */
  readonly queuedAt?: number
}

/** Exact binding observed when the child inbox claims one host message. */
export interface DeliveryTurnBindingInput extends DeliveryCorrelation, DeliveryExecutionProof {
  readonly deliveryId: string
  /** Optional caller-owned timestamp for the running transition. */
  readonly startedAt?: number
}

/** Bind an accepted Delivery to the exact host execution token. */
export function bindQueued(
  state: DeliveryLedgerState,
  input: DeliveryQueuedBindingInput,
): DeliveryMutation {
  assertIdentifier(input.deliveryId, 'deliveryId')
  validateCorrelation(input)
  assertIdentifier(input.executionId, 'executionId')
  validateAt(input.queuedAt, 'queuedAt')

  const current = state.byDeliveryId[input.deliveryId]
  if (current === undefined) return unchanged(state, 'unknown-delivery')
  if (!correlates(current, input)) return unchanged(state, 'correlation-mismatch', current)
  if (current.executionId !== undefined && current.executionId !== input.executionId) {
    return unchanged(state, 'correlation-mismatch', current)
  }
  if (TERMINAL_STATUSES.has(current.status)) return unchanged(state, 'already-terminal', current)
  if (current.status === 'queued' && current.executionId === input.executionId) {
    return unchanged(state, 'already-in-state', current)
  }
  if (input.queuedAt !== undefined && current.acceptedAt !== undefined && input.queuedAt < current.acceptedAt) {
    throw new TypeError('queuedAt must not precede acceptedAt')
  }
  if (current.status !== 'accepted') return unchanged(state, 'invalid-transition', current)

  return changed(state, freezeRecord({
    ...current,
    executionId: input.executionId,
    status: 'queued',
    ...(input.queuedAt !== undefined ? { queuedAt: input.queuedAt } : {}),
  }))
}

/** Bind a queued Delivery to the trusted per-turn identity. */
export function bindTurn(
  state: DeliveryLedgerState,
  input: DeliveryTurnBindingInput,
): DeliveryMutation {
  assertIdentifier(input.deliveryId, 'deliveryId')
  validateCorrelation(input)
  assertIdentifier(input.executionId, 'executionId')
  assertIdentifier(input.turnId, 'turnId')
  validateAt(input.startedAt, 'startedAt')

  const current = state.byDeliveryId[input.deliveryId]
  if (current === undefined) return unchanged(state, 'unknown-delivery')
  if (!correlates(current, input)) return unchanged(state, 'correlation-mismatch', current)
  if (current.executionId !== input.executionId) return unchanged(state, 'correlation-mismatch', current)
  if (current.turnId !== undefined && current.turnId !== input.turnId) {
    return unchanged(state, 'correlation-mismatch', current)
  }
  if (current.status === 'running' && current.turnId === input.turnId) {
    return unchanged(state, 'already-in-state', current)
  }
  if (TERMINAL_STATUSES.has(current.status)) return unchanged(state, 'already-terminal', current)
  if (input.startedAt !== undefined && current.queuedAt !== undefined && input.startedAt < current.queuedAt) {
    throw new TypeError('startedAt must not precede queuedAt')
  }
  if (current.status !== 'queued') return unchanged(state, 'invalid-transition', current)

  return changed(state, freezeRecord({
    ...current,
    turnId: input.turnId,
    status: 'running',
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
  }))
}

/**
 * Compatibility shim for callers that already have both proofs. It still
 * performs the two strict transitions in order; it never bypasses `queued`.
 */
export function bindDeliveryTurn(
  state: DeliveryLedgerState,
  input: DeliveryTurnBindingInput,
): DeliveryMutation {
  const queued = bindQueued(state, {
    deliveryId: input.deliveryId,
    endpoint: input.endpoint,
    locusId: input.locusId,
    generation: input.generation,
    childSessionId: input.childSessionId,
    executionId: input.executionId,
  })
  if (queued.changed || queued.reason === 'already-in-state') {
    return bindTurn(queued.state, input)
  }
  return queued
}

/**
 * Apply one legal state transition without performing any side effect.
 *
 * Terminal transitions are allowed from any accepted/queued/running state:
 * a host can observe a very fast child settle before its queue/start callback
 * has returned.  Repeating the same transition is idempotent.
 */
export function transitionDelivery(
  state: DeliveryLedgerState,
  input: DeliveryTransitionInput,
): DeliveryMutation {
  assertIdentifier(input.deliveryId, 'deliveryId')
  validateAt(input.at, 'at')
  const current = state.byDeliveryId[input.deliveryId]
  if (current === undefined) return unchanged(state, 'unknown-delivery')
  if (input.correlation !== undefined && !correlates(current, input.correlation)) {
    return unchanged(state, 'correlation-mismatch', current)
  }
  if (input.status === 'queued') {
    if (input.executionId === undefined) return unchanged(state, 'execution-proof-required', current)
    return bindQueued(state, {
      deliveryId: input.deliveryId,
      ...(input.correlation as DeliveryCorrelation),
      executionId: input.executionId,
      ...(input.at !== undefined ? { queuedAt: input.at } : {}),
    })
  }
  if (input.status === 'running') {
    if (input.executionId === undefined || input.turnId === undefined || !isTurnCorrelation(input.correlation)) {
      return unchanged(state, 'execution-proof-required', current)
    }
    return bindTurn(state, {
      deliveryId: input.deliveryId,
      ...(input.correlation as DeliveryTurnCorrelation),
      executionId: input.executionId,
      turnId: input.turnId,
      ...(input.at !== undefined ? { startedAt: input.at } : {}),
    })
  }
  // Terminal progress is only legal through the explicit-id, running-only
  // proof path below. This generic API cannot select a FIFO row or promote an
  // accepted/queued record. A terminal timestamp is mandatory at this layer.
  if (input.executionId === undefined || input.turnId === undefined || input.at === undefined || !isTurnCorrelation(input.correlation)) {
    return unchanged(state, 'execution-proof-required', current)
  }
  return settleByTurn(state, {
    deliveryId: input.deliveryId,
    executionId: input.executionId,
    turnId: input.turnId,
    correlation: input.correlation,
    outcome: input.status,
    settledAt: input.at,
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
  })
}

/** Settle one Delivery only by its explicit id and exact turn proof. */
export function settleDelivery(
  state: DeliveryLedgerState,
  input: DeliverySettlementInput & { readonly deliveryId: string },
): DeliveryMutation {
  if (input.settledAt === undefined) return unchanged(state, 'execution-proof-required', state.byDeliveryId[input.deliveryId])
  return settleByTurn(state, input)
}

/** A FIFO settlement event scoped to one exact endpoint/locus/child. */
export interface FifoSettlementInput extends DeliveryCorrelation, DeliveryExecutionProof {
  readonly outcome: DeliveryOutcome
  readonly settledAt: number
  readonly failureReason?: string
}

/**
 * Settle the oldest pending Delivery for one exact correlation.
 *
 * The correlation includes generation intentionally.  A late event from an
 * old child/generation therefore either settles its own old Delivery or is a
 * no-op; it can never consume a pending Delivery from the replacement locus.
 */
export function settleNextDelivery(
  state: DeliveryLedgerState,
  input: FifoSettlementInput,
): DeliveryMutation {
  validateCorrelation(input)
  validateAt(input.settledAt, 'settledAt')
  // FIFO is retained only as a fail-closed compatibility surface: proof lookup
  // must identify exactly one row, otherwise no Delivery is touched.
  const matches = Object.values(state.byDeliveryId).filter(record =>
    record.status === 'running' && correlates(record, input) &&
    record.executionId === input.executionId && record.turnId === input.turnId,
  )
  if (matches.length !== 1) return unchanged(state, matches.length === 0 ? 'no-pending-delivery' : 'correlation-mismatch')
  const [record] = matches
  return settleByTurn(state, {
    deliveryId: record!.deliveryId,
    executionId: input.executionId,
    turnId: input.turnId,
    correlation: input,
    outcome: input.outcome,
    settledAt: input.settledAt,
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
  })
}

/** Strict terminal settlement by explicit id and exact running-turn proof. */
export function settleByTurn(
  state: DeliveryLedgerState,
  input: DeliverySettlementInput & { readonly deliveryId: string },
): DeliveryMutation {
  assertIdentifier(input.deliveryId, 'deliveryId')
  validateCorrelation(input.correlation)
  assertIdentifier(input.executionId, 'executionId')
  assertIdentifier(input.turnId, 'turnId')
  validateAt(input.settledAt, 'settledAt')

  const current = state.byDeliveryId[input.deliveryId]
  if (current === undefined) return unchanged(state, 'unknown-delivery')
  if (!correlates(current, input.correlation)) return unchanged(state, 'correlation-mismatch', current)
  if (current.executionId !== input.executionId || current.turnId !== input.turnId) {
    return unchanged(state, 'correlation-mismatch', current)
  }
  if (current.status === input.outcome) return unchanged(state, 'already-in-state', current)
  if (TERMINAL_STATUSES.has(current.status)) return unchanged(state, 'already-terminal', current)
  if (current.status !== 'running') return unchanged(state, 'invalid-transition', current)
  if (input.settledAt < (current.startedAt ?? current.queuedAt ?? current.acceptedAt ?? 0)) {
    throw new TypeError('settledAt must not precede prior Delivery timestamps')
  }
  if (input.settledAt !== undefined && current.startedAt !== undefined && input.settledAt < current.startedAt) {
    throw new TypeError('settledAt must not precede startedAt')
  }

  const next = freezeRecord({
    ...current,
    status: input.outcome,
    ...(input.settledAt !== undefined ? {
      ...(input.outcome === 'settled' ? { settledAt: input.settledAt } : { failedAt: input.settledAt }),
    } : {}),
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
  })
  return changed(state, next)
}

/** Mark one Delivery failed, retaining a diagnostic reason when provided. */
export function failDelivery(
  state: DeliveryLedgerState,
  input: Omit<DeliverySettlementInput, 'outcome'> & { readonly deliveryId: string },
): DeliveryMutation {
  return settleByTurn(state, { ...input, outcome: 'failed' })
}

/** Return a Delivery by its generated or caller-supplied id. */
export function getDelivery(
  state: DeliveryLedgerState,
  deliveryId: string,
): DeliveryRecord | undefined {
  return state.byDeliveryId[deliveryId]
}

/** Return a Delivery by the platform message id idempotency key. */
export function getDeliveryByMessageId(
  state: DeliveryLedgerState,
  messageId: string,
): DeliveryRecord | undefined {
  return state.byMessageId[messageId]
}

/** Return all records in acceptance order. */
export function listDeliveries(state: DeliveryLedgerState): readonly DeliveryRecord[] {
  return Object.values(state.byDeliveryId).sort((left, right) => left.sequence - right.sequence)
}

/** Return the oldest unsettled record in one exact correlation scope. */
export function findOldestPendingDelivery(
  state: DeliveryLedgerState,
  correlation: DeliveryCorrelation,
): DeliveryRecord | undefined {
  validateCorrelation(correlation)
  let oldest: DeliveryRecord | undefined
  for (const record of Object.values(state.byDeliveryId)) {
    if (!PENDING_STATUSES.has(record.status) || !correlates(record, correlation)) continue
    if (oldest === undefined || record.sequence < oldest.sequence) oldest = record
  }
  return oldest
}

function findPendingDeliveryByProof(
  state: DeliveryLedgerState,
  input: FifoSettlementInput,
): DeliveryRecord | undefined {
  validateCorrelation(input)
  let oldest: DeliveryRecord | undefined
  for (const record of Object.values(state.byDeliveryId)) {
    if (!PENDING_STATUSES.has(record.status) || !correlates(record, input)) continue
    if (record.executionId !== input.executionId || record.turnId !== input.turnId) continue
    if (oldest === undefined || record.sequence < oldest.sequence) oldest = record
  }
  return oldest
}

/** Return a defensive copy of the trusted feedback target for one Delivery. */
export function feedbackTargetForDelivery(
  state: DeliveryLedgerState,
  deliveryId: string,
): DeliveryFeedbackTarget | undefined {
  const record = getDelivery(state, deliveryId)
  return record === undefined
    ? undefined
    : cloneFeedbackTarget(record.endpoint, record.messageId, record.feedbackTarget.rootMessageId)
}

/** Compare endpoint/locus generation/child identity exactly. */
export function correlates(
  record: DeliveryRecord,
  correlation: DeliveryCorrelation,
): boolean {
  return (
    record.locusId === correlation.locusId &&
    record.generation === correlation.generation &&
    record.childSessionId === correlation.childSessionId &&
    sameEndpoint(record.endpoint, correlation.endpoint)
  )
}

function changed(state: DeliveryLedgerState, record: DeliveryRecord): DeliveryMutation {
  const byMessageId = addToIndex(state.byMessageId, record.messageId, record)
  const byDeliveryId = addToIndex(state.byDeliveryId, record.deliveryId, record)
  return {
    state: { ...state, byMessageId, byDeliveryId },
    record,
    changed: true,
    reason: undefined,
  }
}

function unchanged(
  state: DeliveryLedgerState,
  reason: DeliveryMutationReason,
  record?: DeliveryRecord,
): DeliveryMutation {
  return {
    state,
    ...(record !== undefined ? { record } : { record: undefined }),
    changed: false,
    reason,
  }
}

function addToIndex(
  index: Readonly<Record<string, DeliveryRecord>>,
  key: string,
  value: DeliveryRecord,
): Readonly<Record<string, DeliveryRecord>> {
  const next = Object.assign(Object.create(null) as Record<string, DeliveryRecord>, index, {
    [key]: value,
  })
  return Object.freeze(next)
}

function freezeRecord(record: DeliveryRecord): DeliveryRecord {
  return Object.freeze({
    ...record,
    endpoint: cloneEndpoint(record.endpoint),
    feedbackTarget: Object.freeze({ ...record.feedbackTarget }),
    ...(record.replyTarget !== undefined ? { replyTarget: Object.freeze({ ...record.replyTarget }) } : {}),
  })
}

function cloneEndpoint(endpoint: DeliveryEndpoint): DeliveryEndpoint {
  return Object.freeze({
    chatId: endpoint.chatId,
    ...(endpoint.threadId !== undefined ? { threadId: endpoint.threadId } : {}),
  })
}

function cloneFeedbackTarget(
  endpoint: DeliveryEndpoint,
  messageId: string,
  rootMessageId?: string,
): DeliveryFeedbackTarget {
  return Object.freeze({
    chatId: endpoint.chatId,
    ...(endpoint.threadId !== undefined ? { threadId: endpoint.threadId } : {}),
    messageId,
    ...(rootMessageId !== undefined ? { rootMessageId } : {}),
  })
}

function sameEndpoint(left: DeliveryEndpoint, right: DeliveryEndpoint): boolean {
  return left.chatId === right.chatId && (left.threadId ?? undefined) === (right.threadId ?? undefined)
}

function isTurnCorrelation(
  correlation: DeliveryCorrelation | DeliveryTurnCorrelation | undefined,
): correlation is DeliveryTurnCorrelation {
  return correlation !== undefined && typeof (correlation as Partial<DeliveryTurnCorrelation>).turnId === 'string' &&
    (correlation as Partial<DeliveryTurnCorrelation>).turnId!.trim() !== ''
}

function validateDeliveryInput(input: DeliveryInput): void {
  assertIdentifier(input.messageId, 'messageId')
  validateCorrelation(input)
  if (input.turnId !== undefined || input.executionId !== undefined) {
    throw new TypeError('accepted Delivery cannot include execution or turn proof')
  }
  if (input.senderOpenId !== undefined) assertIdentifier(input.senderOpenId, 'senderOpenId')
  if (input.rootMessageId !== undefined) assertIdentifier(input.rootMessageId, 'rootMessageId')
  if (input.replyToMessageId !== undefined) assertIdentifier(input.replyToMessageId, 'replyToMessageId')
  if (input.replyTarget !== undefined) {
    assertIdentifier(input.replyTarget.chatId, 'replyTarget.chatId')
    assertIdentifier(input.replyTarget.messageId, 'replyTarget.messageId')
    if (input.replyTarget.threadId !== undefined) assertIdentifier(input.replyTarget.threadId, 'replyTarget.threadId')
    if (input.replyTarget.rootMessageId !== undefined) assertIdentifier(input.replyTarget.rootMessageId, 'replyTarget.rootMessageId')
    if (!sameEndpoint(input.endpoint, input.replyTarget)) throw new TypeError('replyTarget endpoint mismatch')
    if (input.replyTarget.messageId !== input.messageId) throw new TypeError('replyTarget message mismatch')
  }
  validateAt(input.acceptedAt, 'acceptedAt')
}

function validateCorrelation(correlation: DeliveryCorrelation): void {
  if (correlation.endpoint === undefined || correlation.endpoint === null) {
    throw new TypeError('endpoint is required')
  }
  assertIdentifier(correlation.endpoint.chatId, 'endpoint.chatId')
  if (correlation.endpoint.threadId !== undefined) {
    assertIdentifier(correlation.endpoint.threadId, 'endpoint.threadId')
  }
  assertIdentifier(correlation.locusId, 'locusId')
  assertIdentifier(correlation.childSessionId, 'childSessionId')
  if (!Number.isSafeInteger(correlation.generation) || correlation.generation < 1) {
    throw new TypeError('generation must be a positive safe integer')
  }
}

function validateAt(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }
}

function assertIdentifier(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`)
  }
}
