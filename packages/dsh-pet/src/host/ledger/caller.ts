/**
 * Caller-bound identity resolution shared by the three intent-triage tools
 * (read-only parent lookup, ledger read, `pet_locus_track`).
 *
 * This is a DELIBERATELY INDEPENDENT implementation, not a reuse of
 * `collaboration/caller.ts` from the (possibly-discarded)
 * `pet-locus-independent-agent-inquiries` change — see design.md Context:
 * "明确不依赖: pet-locus-independent-agent-inquiries 的代码、规范与归档顺序".
 *
 * Registers no tools and grants no execution authority. Every input comes
 * from a Host-owned lookup; a caller of this module must resolve again
 * before performing any durable write, matching the discipline the sibling
 * module documents ("callers must resolve again before dispatch, never
 * retain this as a capability").
 *
 * Spec: `pet-locus-intent-triage`, requirements "caller-bound 只读父会话查阅
 * 不唤醒主会话", "共享事实台账按主会话归属并对同源只读开放", "待办登记固定来
 * 源与回复去向且关联标识而非实例".
 */
import type { LocusEndpoint, LocusRecord } from '../locus/aggregate.js'

/** Structural subset this module actually needs from the durable locus repository. */
export interface LedgerCallerLocusLookup {
  /** Every durable generation for a child session id — never collapsed before the ambiguity check runs. */
  findByChildSessionId(childSessionId: string): readonly LocusRecord[]
}

/** The resolved identity of an ACTIVE locus child calling one of the three tools. */
export interface LedgerCaller {
  readonly childSessionId: string
  readonly parentSessionId: string
  readonly locusId: string
  readonly generation: number
  readonly endpoint: LocusEndpoint
}

/**
 * Uniform refusal for every "not a valid, unambiguous, active locus child"
 * case. Spec: "跨源、已失效关联与临时 subagent 一律统一拒绝，且 MUST NOT 泄
 * 露台账或条目是否存在" — a single error shape is what keeps a refusal from
 * leaking WHICH of those cases actually happened.
 */
export class LedgerCallerUnavailableError extends Error {
  readonly code = 'LEDGER_CALLER_UNAVAILABLE'
  constructor() {
    // Never include a locus id, a parent session id, a generation number or
    // any other durable identity — those are exactly what a foreign or
    // ambiguous caller must not be able to infer from the refusal shape.
    super('No current locus association is available for this caller.')
    this.name = 'LedgerCallerUnavailableError'
  }
}

function reject(): never { throw new LedgerCallerUnavailableError() }

function validId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.trim() === id
}

/**
 * Resolve the ACTUAL executing session to its unique active locus.
 *
 * Ambiguity (more than one matching row — e.g. a corrupted index producing
 * duplicate generations for the same child) is refused, not resolved by
 * picking one: `persistence.ts#findByChildSession` already established this
 * exact discipline ("Return every durable generation ... distinguish an
 * ordinary child from an unavailable or ambiguous association and fail
 * closed"), and this resolver preserves it independently rather than relying
 * on that call site's behavior.
 *
 * @param childSessionId - the id from `callerSessionId(exec)`, NEVER a
 *   model-supplied argument. There is no parameter for a caller to name a
 *   different session; a caller of this function that has one anyway must
 *   derive it from the actual executing tool call, exactly like
 *   `tools.ts#callerSessionId` does.
 */
export function resolveLedgerCaller(
  childSessionId: string,
  loci: LedgerCallerLocusLookup,
): LedgerCaller {
  if (!validId(childSessionId)) reject()
  const matches = loci.findByChildSessionId(childSessionId)
  if (matches.length !== 1) reject()
  const row = matches[0]!
  if (row.state !== 'active') reject()
  if (!validId(row.parentSessionId)) reject()
  if (row.childSessionId !== childSessionId) reject()
  if (!validId(row.id)) reject()
  if (!Number.isSafeInteger(row.generation) || row.generation < 1) reject()
  if (typeof row.endpoint?.chatId !== 'string' || row.endpoint.chatId.trim() === '') reject()
  return Object.freeze({
    childSessionId,
    parentSessionId: row.parentSessionId,
    locusId: row.id,
    generation: row.generation,
    endpoint: row.endpoint.threadId === undefined
      ? { chatId: row.endpoint.chatId }
      : { chatId: row.endpoint.chatId, threadId: row.endpoint.threadId },
  })
}

/**
 * Cross-await re-verification for a WRITE path (registering a todo).
 *
 * Spec: "解析后到实际读写之间若关联被撤销或代际变化，操作失败而非沿用旧解析
 * 结果". A todo-registration call is async (it goes through a real Domain
 * transaction, see `ledger/store.ts`), so the caller identity resolved before
 * that await is not automatically still true when the write actually commits
 * — the locus could switch source, retire, or the child could be replaced by
 * a new generation in the gap.
 *
 * This function re-resolves and compares against the FIRST resolution's
 * identity-defining fields. It does not compare `endpoint` — the endpoint is
 * a platform-addressing fact recorded once at registration time and is not
 * re-derived here — but it DOES compare `parentSessionId`/`locusId`/
 * `generation`, because any of those changing means the write would be
 * attributed to a locus association that no longer exists as resolved.
 *
 * Call this AFTER the write's caller-identity-dependent facts have been
 * captured but BEFORE the durable write actually commits, inside the same
 * async flow — not inside the Domain transaction callback itself (that
 * callback must stay synchronous per `ledger/store.ts`'s discipline).
 */
export function reverifyLedgerCaller(
  childSessionId: string,
  loci: LedgerCallerLocusLookup,
  first: LedgerCaller,
): LedgerCaller {
  const second = resolveLedgerCaller(childSessionId, loci)
  if (
    second.parentSessionId !== first.parentSessionId ||
    second.locusId !== first.locusId ||
    second.generation !== first.generation
  ) {
    reject()
  }
  return second
}
