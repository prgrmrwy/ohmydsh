/**
 * Pure shared-fact-ledger and todo values and state transitions.
 *
 * Not a store, not a dispatcher, not an authorization boundary — same
 * discipline as `inquiry/ledger.ts`. This module owns only the VALUE MODEL:
 * what a durable ledger and a durable todo item look like, and which status
 * transitions are legal. Everything that touches the world (persistence,
 * caller resolution, tool wiring) lives elsewhere.
 *
 * Spec: `pet-locus-intent-triage`, requirements "共享事实台账按主会话归属并对
 * 同源只读开放" and "待办登记固定来源与回复去向且关联标识而非实例".
 *
 * Design D4/D5/D6/D8:
 * - The ledger only commits to attribution (parentSessionId), authorization
 *   scope (same-source loci) and a `kind` namespace. It does NOT commit to a
 *   uniform revision, lifecycle or write-authorization model across kinds —
 *   this module defines exactly one kind (`todo`) and its own rules; a future
 *   kind is free to define different ones without touching this file.
 * - A todo references locus IDENTITY (`locusId` + `endpoint`), never a locus
 *   INSTANCE (a generation). `generation` is retained ONLY as an audit fact
 *   and MUST NOT be used by any addressing/lookup code path.
 * - Status may only be advanced by an explicit owner-sourced call; this
 *   module's `advanceTodoStatus` takes no "who" parameter on purpose —
 *   callers (the tool/route layer) are responsible for proving the caller is
 *   the owner BEFORE calling it, exactly like `inquiry/ledger.ts` leaves
 *   authorization to its callers.
 */

/** Bounds mirroring `inquiry/ledger.ts`'s INQUIRY_LIMITS discipline. */
export const TODO_LIMITS = Object.freeze({
  summaryLength: 512,
  evidenceLength: 4_096,
  requestedByLength: 256,
  /** Stable machine identifiers; not free text. */
  identifierLength: 256,
})
const limits = TODO_LIMITS

/** A shared-fact ledger's only durable field is its owning main session. */
export interface SharedFactLedgerRecord {
  readonly parentSessionId: string
  readonly createdAt: number
}

/** Item kinds are a namespace, not a sum type payload — `todo` is the only one today. */
export const LEDGER_ITEM_KINDS = Object.freeze(['todo'] as const)
export type LedgerItemKind = (typeof LEDGER_ITEM_KINDS)[number]

/** Ordered from open to the two terminal dispositions an owner may choose. */
export const TODO_STATUSES = Object.freeze(['open', 'accepted', 'done', 'dropped'] as const)
export type TodoStatus = (typeof TODO_STATUSES)[number]

const TODO_TERMINAL_STATUSES: ReadonlySet<TodoStatus> = new Set(['done', 'dropped'])

/** Legal owner-sourced transitions. `open` is entry-only; terminals do not re-open. */
const TODO_STATUS_TRANSITIONS: Readonly<Record<TodoStatus, readonly TodoStatus[]>> = Object.freeze({
  open: ['accepted', 'done', 'dropped'],
  accepted: ['done', 'dropped'],
  done: [],
  dropped: [],
})

/**
 * The endpoint a todo replies to. Distinct from `LocusEndpoint` in
 * `locus/aggregate.ts` — this module intentionally does not import Host locus
 * types, keeping the ledger's value model independently testable and free of
 * a dependency on the locus aggregate's internal shape.
 */
export interface TodoEndpoint {
  readonly chatId: string
  readonly threadId?: string
}

/**
 * The evidence a child already gathered before registering a todo. A snapshot
 * fact as of registration time — spec: "MUST NOT 自动刷新，也 MUST NOT 被呈现
 * 为当前仍然成立的结论".
 */
export interface TodoEvidence {
  readonly summary: string
  /** Free-form: location, cause, suggestion — not a structured breakdown by design (open question). */
  readonly detail: string
}

/** One durable todo item — the only `kind: 'todo'` ledger item this change defines. */
export interface TodoRecord {
  readonly itemId: string
  readonly parentSessionId: string
  readonly kind: 'todo'
  /** Stable source identity. Addressing uses this, never `generation`. */
  readonly locusId: string
  /** Audit-only fact: which generation existed when this was registered. Never used for lookup. */
  readonly generation: number
  readonly endpoint: TodoEndpoint
  readonly triggerMessageId: string
  readonly requestedBy: string
  readonly evidence: TodoEvidence
  readonly status: TodoStatus
  readonly createdAt: number
  readonly statusChangedAt: number
}

/** Input to register a new todo. Host derives every identity fact; nothing here is model-suppliable directly. */
export interface NewTodoInput {
  readonly itemId: string
  readonly parentSessionId: string
  readonly locusId: string
  readonly generation: number
  readonly endpoint: TodoEndpoint
  readonly triggerMessageId: string
  readonly requestedBy: string
  readonly evidence: TodoEvidence
  readonly createdAt: number
}

export type TodoValidationFailure =
  | 'invalid-item-id'
  | 'invalid-parent-session-id'
  | 'invalid-locus-id'
  | 'invalid-generation'
  | 'invalid-endpoint'
  | 'invalid-trigger-message-id'
  | 'invalid-requested-by'
  | 'invalid-evidence-summary'
  | 'invalid-evidence-detail'

export type TodoValidation =
  | { readonly ok: true; readonly record: TodoRecord }
  | { readonly ok: false; readonly reason: TodoValidationFailure }

function nonEmptyBounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max
}

/**
 * Construct and validate a new todo record. Pure: no clock, no id
 * allocation, no storage — every fact is supplied by the caller (the Host),
 * matching `inquiry/ledger.ts`'s discipline that this module never samples
 * a clock or trusts a model claim beyond shape-checking it.
 */
export function registerTodo(input: NewTodoInput): TodoValidation {
  if (!nonEmptyBounded(input.itemId, limits.identifierLength)) return { ok: false, reason: 'invalid-item-id' }
  if (!nonEmptyBounded(input.parentSessionId, limits.identifierLength)) {
    return { ok: false, reason: 'invalid-parent-session-id' }
  }
  if (!nonEmptyBounded(input.locusId, limits.identifierLength)) return { ok: false, reason: 'invalid-locus-id' }
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    return { ok: false, reason: 'invalid-generation' }
  }
  if (typeof input.endpoint?.chatId !== 'string' || input.endpoint.chatId.trim() === '') {
    return { ok: false, reason: 'invalid-endpoint' }
  }
  if (input.endpoint.threadId !== undefined &&
      (typeof input.endpoint.threadId !== 'string' || input.endpoint.threadId.trim() === '')) {
    return { ok: false, reason: 'invalid-endpoint' }
  }
  if (!nonEmptyBounded(input.triggerMessageId, limits.identifierLength)) {
    return { ok: false, reason: 'invalid-trigger-message-id' }
  }
  if (!nonEmptyBounded(input.requestedBy, limits.requestedByLength)) {
    return { ok: false, reason: 'invalid-requested-by' }
  }
  if (!nonEmptyBounded(input.evidence?.summary, limits.summaryLength)) {
    return { ok: false, reason: 'invalid-evidence-summary' }
  }
  if (typeof input.evidence.detail !== 'string' || input.evidence.detail.length > limits.evidenceLength) {
    return { ok: false, reason: 'invalid-evidence-detail' }
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    return { ok: false, reason: 'invalid-parent-session-id' } // clock facts are Host-derived; malformed clock is treated as a Host-derivation failure, not modeled separately.
  }
  return {
    ok: true,
    record: {
      itemId: input.itemId.trim(),
      parentSessionId: input.parentSessionId.trim(),
      kind: 'todo',
      locusId: input.locusId.trim(),
      generation: input.generation,
      endpoint: input.endpoint.threadId === undefined
        ? { chatId: input.endpoint.chatId.trim() }
        : { chatId: input.endpoint.chatId.trim(), threadId: input.endpoint.threadId.trim() },
      triggerMessageId: input.triggerMessageId.trim(),
      requestedBy: input.requestedBy.trim(),
      evidence: { summary: input.evidence.summary.trim(), detail: input.evidence.detail },
      status: 'open',
      createdAt: input.createdAt,
      statusChangedAt: input.createdAt,
    },
  }
}

export type TodoStatusAdvanceFailure = 'already-terminal' | 'invalid-transition'

export type TodoStatusAdvance =
  | { readonly ok: true; readonly record: TodoRecord }
  | { readonly ok: false; readonly reason: TodoStatusAdvanceFailure }

/**
 * Advance a todo's status. Pure state-machine check only — the CALLER must
 * have already proven the request is owner-sourced (spec: "MUST NOT 由模型
 * 自行改写"); this function has no notion of "who" on purpose, exactly like
 * `inquiry/ledger.ts`'s transition helpers leave authorization to callers.
 */
export function advanceTodoStatus(
  record: TodoRecord,
  to: TodoStatus,
  now: number,
): TodoStatusAdvance {
  if (TODO_TERMINAL_STATUSES.has(record.status)) return { ok: false, reason: 'already-terminal' }
  const legal = TODO_STATUS_TRANSITIONS[record.status]
  if (!legal.includes(to)) return { ok: false, reason: 'invalid-transition' }
  return { ok: true, record: { ...record, status: to, statusChangedAt: now } }
}

/** Whether a todo is in a terminal disposition (done or dropped). */
export function isTodoTerminal(status: TodoStatus): boolean {
  return TODO_TERMINAL_STATUSES.has(status)
}

/** Thrown by {@link parseTodoRecord} for a durable row that fails exact-shape validation. */
export class TodoParseError extends Error {
  constructor() {
    // Never echo the malformed input: it may contain evidence, requestedBy or
    // another user-supplied field this module must not leak in a thrown message.
    super('Invalid todo record.')
    this.name = 'TodoParseError'
  }
}

function invalid(): never { throw new TodoParseError() }

function str(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') invalid()
  return value as string
}

function int(value: unknown): number {
  if (!Number.isSafeInteger(value)) invalid()
  return value as number
}

/**
 * Validate an already-durable, exact-shape todo record — the storage-boundary
 * counterpart to {@link registerTodo}, which only ever CONSTRUCTS a new one.
 *
 * This is what `spec.ts` delegates to (mirroring `parseInquiry`): a stored row
 * must match this record's fields exactly, so a field rename or truncation is
 * rejected as corruption rather than silently reinterpreted. Unlike
 * `registerTodo`, this accepts any of the four statuses (a stored row may
 * already be `accepted`/`done`/`dropped`) and does not re-derive `status` —
 * it validates the value actually stored.
 */
export function parseTodoRecord(input: unknown): TodoRecord {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const value = input as Record<string, unknown>
  if (value.kind !== 'todo') invalid()

  const itemId = str(value.itemId)
  const parentSessionId = str(value.parentSessionId)
  const locusId = str(value.locusId)
  const generation = int(value.generation)
  if (generation < 1) invalid()

  const endpointValue = value.endpoint
  if (endpointValue === null || typeof endpointValue !== 'object' || Array.isArray(endpointValue)) invalid()
  const chatId = str((endpointValue as Record<string, unknown>).chatId)
  const threadIdRaw = (endpointValue as Record<string, unknown>).threadId
  if (threadIdRaw !== undefined && (typeof threadIdRaw !== 'string' || threadIdRaw.trim() === '')) invalid()

  const triggerMessageId = str(value.triggerMessageId)
  const requestedBy = str(value.requestedBy)

  const evidenceValue = value.evidence
  if (evidenceValue === null || typeof evidenceValue !== 'object' || Array.isArray(evidenceValue)) invalid()
  const summary = str((evidenceValue as Record<string, unknown>).summary)
  const detail = (evidenceValue as Record<string, unknown>).detail
  if (typeof detail !== 'string') invalid()

  const status = value.status
  if (!TODO_STATUSES.includes(status as TodoStatus)) invalid()

  const createdAt = int(value.createdAt)
  const statusChangedAt = int(value.statusChangedAt)
  if (statusChangedAt < createdAt) invalid()
  if (itemId !== itemId.trim() || locusId !== locusId.trim() || requestedBy !== requestedBy.trim()) {
    // Stored rows come only from this module's own writers, which already
    // trim; a row with untrimmed identifiers did not come from `registerTodo`.
    invalid()
  }

  return {
    itemId,
    parentSessionId,
    kind: 'todo',
    locusId,
    generation,
    endpoint: threadIdRaw === undefined
      ? { chatId }
      : { chatId, threadId: threadIdRaw as string },
    triggerMessageId,
    requestedBy,
    evidence: { summary, detail },
    status: status as TodoStatus,
    createdAt,
    statusChangedAt,
  }
}
