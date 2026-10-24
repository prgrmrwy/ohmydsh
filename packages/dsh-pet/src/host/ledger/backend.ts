/**
 * `TodoBackend` — the storage seam every todo consumer depends on
 * (`pet-locus-collab-integration` design D9, tasks 5.1).
 *
 * It covers EXACTLY what today's callers use from the shared-fact ledger:
 * register, get by id, list by parent session, advance status. Nothing else is
 * part of the contract — in particular not the store's `listByLocusId` /
 * `isTerminal`, which no caller reaches.
 *
 * Every method is async on purpose: the next implementation reads and writes a
 * collaboration space (`readManaged` / `disposeRequest`), which is inherently
 * asynchronous, and consumers must already await the gate read (design D8:
 * "read state → check open → dispatch → advance").
 *
 * Contract every implementation keeps, because callers branch on it:
 *  - failures a caller should surface as a structured refusal are
 *    `LedgerStoreError` (`trackTodo` maps exactly that class to `store-error`);
 *  - `listForParent` of an unknown parent resolves to `[]`, never a
 *    distinguishable "not found";
 *  - `advanceStatus` performs no identity check — callers prove ownership.
 *
 * The retiring `pet_locus_ledger_read` tool keeps its synchronous read straight
 * from the legacy store and is deliberately NOT part of this seam.
 */
import type { SharedFactLedgerStore } from './store.js'
import type { NewTodoInput, TodoRecord, TodoStatus } from './todo.js'

export interface TodoBackend {
  /** Register one todo; idempotent for an identical redelivery, `TODO_EXISTS` for a different one. */
  registerTodoItem(input: NewTodoInput): Promise<TodoRecord>
  /** The current record, or `undefined` when no todo has this id. */
  getTodoItem(itemId: string): Promise<TodoRecord | undefined>
  /** Every todo owned by one main session, in stable creation order. */
  listForParent(parentSessionId: string): Promise<readonly TodoRecord[]>
  /** Advance one todo's status; illegal transitions reject with `TODO_INVALID`, unknown ids with `TODO_NOT_FOUND`. */
  advanceStatus(itemId: string, to: TodoStatus, now: number): Promise<TodoRecord>
}

/**
 * The legacy backend: the durable Pet-domain tables behind `SharedFactLedgerStore`.
 *
 * A thin async wrapper — every call delegates unchanged, and a synchronous
 * store throw becomes a rejection of the returned promise.
 */
export function legacyTodoBackend(store: SharedFactLedgerStore): TodoBackend {
  return {
    registerTodoItem: async input => store.registerTodoItem(input),
    getTodoItem: async itemId => store.getTodoItem(itemId),
    listForParent: async parentSessionId => store.listForParent(parentSessionId),
    advanceStatus: async (itemId, to, now) => store.advanceStatus(itemId, to, now),
  }
}
