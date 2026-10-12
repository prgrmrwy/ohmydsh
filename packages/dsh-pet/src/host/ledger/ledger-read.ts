/**
 * Caller-bound READ-ONLY shared-fact-ledger lookup — the "台账读取" tool's
 * execution logic.
 *
 * Spec: `pet-locus-intent-triage`, requirement "共享事实台账按主会话归属并对
 * 同源只读开放". This tool is intentionally narrower than a general ledger
 * browser: it returns ONLY the structured `todo` items belonging to the
 * caller's own same-source ledger — never a sibling's conversation history,
 * never an endpoint/entry enumeration.
 */
import type { LedgerCaller } from './caller.js'
import type { TodoRecord } from './todo.js'

/** The narrow read this tool needs from the ledger store. */
export interface LedgerReadDeps {
  /** Same-source read: every todo item whose ledger is owned by this parentSessionId. */
  listForParent(parentSessionId: string): readonly TodoRecord[]
}

/**
 * What the tool actually surfaces to the model — a projection, not the raw
 * durable record. `parentSessionId` is intentionally OMITTED from the
 * projection: the caller already knows it is reading its own same-source
 * ledger, and echoing it back would be the first step toward a tool that
 * could be misread as accepting a target.
 */
export interface LedgerReadItem {
  readonly itemId: string
  readonly locusId: string
  readonly summary: string
  readonly detail: string
  readonly status: TodoRecord['status']
  readonly requestedBy: string
  readonly createdAt: number
}

function project(record: TodoRecord): LedgerReadItem {
  return {
    itemId: record.itemId,
    locusId: record.locusId,
    summary: record.evidence.summary,
    detail: record.evidence.detail,
    status: record.status,
    requestedBy: record.requestedBy,
    createdAt: record.createdAt,
  }
}

/**
 * List every todo item in the caller's own same-source shared-fact ledger.
 *
 * Takes NO target parameter beyond the already-resolved `LedgerCaller` —
 * matching the zero-selector discipline of `pet_context`/`pet_locus_finish`
 * and this change's other two tools. An empty ledger and a ledger that has
 * never been created both project to an empty list — this function does not
 * expose "does a ledger exist" as a distinguishable fact, matching spec's
 * "MUST NOT 泄露台账或条目是否存在" applied to the read side too.
 */
export function readSharedLedger(
  caller: LedgerCaller,
  deps: LedgerReadDeps,
): readonly LedgerReadItem[] {
  return Object.freeze(deps.listForParent(caller.parentSessionId).map(project))
}

/**
 * Why a ledger read could not produce a list.
 *
 * Deliberately NOT an empty list: "the ledger is empty" and "the ledger could
 * not be read" lead a model to opposite conclusions, and rendering the second
 * as `[]` makes it report "no todos" for work it never saw.
 */
export type LedgerReadUnavailableReason = 'caller-unresolvable' | 'ledger-unwired' | 'store-unreadable'

/** The outcome of one ledger read. */
export type LedgerReadOutcome =
  | { readonly ok: true; readonly items: readonly LedgerReadItem[] }
  | { readonly ok: false; readonly reason: LedgerReadUnavailableReason }

/**
 * Read the caller's own same-source ledger, distinguishing empty from unreadable.
 * @param caller - Resolved caller; its parent session is the whole read scope.
 * @param deps - The narrow same-source read.
 * @returns the projected items, or a reason that is NOT an empty ledger.
 */
export function readSharedLedgerOutcome(
  caller: LedgerCaller,
  deps: LedgerReadDeps,
): LedgerReadOutcome {
  try {
    return { ok: true, items: readSharedLedger(caller, deps) }
  } catch {
    // A dependency fault is never "there is nothing to do".
    return { ok: false, reason: 'store-unreadable' }
  }
}

/**
 * The model-facing text for an unavailable ledger read.
 *
 * Actionable on purpose: it names the one thing the model cannot conclude
 * (`[]` would mean "no todos"), and the two paths that remain open to it.
 * @param reason - Why the read failed.
 * @returns guidance for the model, without any other id.
 */
export function ledgerReadUnavailableText(reason: LedgerReadUnavailableReason): string {
  const why = reason === 'caller-unresolvable'
    ? '当前调用方无法解析到唯一的 locus 归属'
    : reason === 'ledger-unwired'
      ? '本 Host 未装配台账读取能力'
      : '台账存储读取失败'
  return [
    `台账读取不可用（${reason}）：${why}。`,
    '这不代表"没有待办"——本次无法判断台账内容，不要把结果当作空台账。',
    '可稍后重试；若要登记本次工作请求，直接调用 `pet_locus_track` 即可，不依赖本次读取。',
  ].join('')
}
