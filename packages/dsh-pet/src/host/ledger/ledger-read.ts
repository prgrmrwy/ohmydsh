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
