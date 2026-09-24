/**
 * Durable single-table-pair storage for the shared-fact ledger and its todo
 * items. Same atomicity discipline as `inquiry/ledger-store.ts`.
 *
 * Two durable tables, kept in the SAME transaction for cross-table writes:
 *  - `shared_fact_ledger`, keyed by `parentSessionId` — one row per main
 *    session, ensured idempotently on first registration (spec: "首次登记幂
 *    等建立").
 *  - `ledger_item`, keyed by `itemId` — currently only ever `kind: 'todo'`
 *    rows; the `kind` field is a namespace partition per design D4, not a
 *    discriminated union this store branches on today.
 *
 * This layer owns:
 *  1. ATOMICITY — ledger-ensure + item-write commit as one batch so a crash
 *     cannot leave an item without its owning ledger row.
 *  2. SAME-SOURCE AUTHORIZATION SCOPE — `listForParent` is the only read this
 *     store exposes for cross-locus consumption, and it takes a
 *     `parentSessionId` the CALLER must already have proven is the caller's
 *     own (this store does not resolve caller identity, matching
 *     `inquiry/ledger-store.ts` leaving authorization to its callers).
 *  3. STATUS-ADVANCE GATING — `advanceStatus` exists on this store precisely
 *     so the tool/route layer has exactly one write path to call for owner
 *     actions, instead of a general `put` that a model-facing tool could also
 *     reach.
 *
 * It owns nothing else: it does not decide what "owner-sourced" means (the
 * caller resolver does), and it never stores a chat/message body beyond the
 * bounded evidence fields the pure model already validated.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import {
  registerTodo, advanceTodoStatus, isTodoTerminal, parseTodoRecord,
  type NewTodoInput, type TodoRecord, type TodoStatus,
} from './todo.js'

type LedgerTable = 'shared_fact_ledger'
type ItemTable = 'ledger_item'

/** Same optional-capability shape `inquiry/ledger-store.ts` uses. */
type StoreDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: { put(table: LedgerTable | ItemTable, key: string, value: unknown): void }) => void) => Promise<void>
}

export type LedgerStoreErrorCode =
  | 'TRANSACTION_UNAVAILABLE'
  | 'TODO_NOT_FOUND'
  | 'TODO_EXISTS'
  | 'TODO_CORRUPT'
  | 'TODO_INVALID'

export class LedgerStoreError extends Error {
  constructor(readonly code: LedgerStoreErrorCode, message?: string) {
    // Safe diagnostics only: never echo evidence, requestedBy or any other
    // bounded-but-still-user-supplied field back to a caller that tripped this.
    super(message ?? {
      TRANSACTION_UNAVAILABLE: 'Atomic shared-fact-ledger storage is unavailable.',
      TODO_NOT_FOUND: 'Todo is not recorded.',
      TODO_EXISTS: 'A different todo is already recorded under this id.',
      TODO_CORRUPT: 'Todo storage could not be verified.',
      TODO_INVALID: 'Todo registration failed validation.',
    }[code])
    this.name = 'LedgerStoreError'
  }
}
function corrupt(): never { throw new LedgerStoreError('TODO_CORRUPT') }

export class SharedFactLedgerStore {
  constructor(private readonly domain: StoreDomain) {}

  private transaction(body: Parameters<NonNullable<StoreDomain['transaction']>>[0]): Promise<void> {
    if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') {
      return Promise.reject(new LedgerStoreError('TRANSACTION_UNAVAILABLE'))
    }
    return this.domain.transaction(body)
  }

  /**
   * One stored todo, validated through the pure model's exact-shape parser.
   *
   * Validating on the way out (not just trusting the stored shape) is what
   * makes a schema field rename fail loud instead of being silently
   * reinterpreted — same discipline as `inquiry/ledger-store.ts#get`.
   */
  private getTodoRaw(itemId: string): TodoRecord | undefined {
    const raw = this.domain.table('ledger_item').get(itemId)
    if (raw === undefined) return undefined
    let record: TodoRecord
    try {
      record = parseTodoRecord(raw)
    } catch {
      corrupt()
    }
    // The key IS the id; a row filed elsewhere is corruption, not a second identity.
    if (record.itemId !== itemId) corrupt()
    return record
  }

  /** Every todo item, in a stable clock-independent order. */
  private allTodos(): readonly TodoRecord[] {
    const records: TodoRecord[] = []
    for (const [key, raw] of this.domain.table('ledger_item').entries()) {
      const candidate = raw as { kind?: unknown }
      if (candidate?.kind !== 'todo') continue // future kinds are a superset this store does not branch on
      let record: TodoRecord
      try {
        record = parseTodoRecord(raw)
      } catch {
        corrupt()
      }
      if (record.itemId !== key) corrupt()
      records.push(record)
    }
    return records.sort((a, b) => a.createdAt - b.createdAt || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
  }

  /**
   * Register one todo, idempotently ensuring its owning ledger row exists
   * first — in the SAME transaction, so a crash between the two is
   * impossible (spec: "首次登记幂等建立").
   *
   * A redelivered registration under the same itemId is a no-op returning the
   * stored record; a DIFFERENT todo under a used id is refused rather than
   * silently overwriting the first one (same discipline as
   * `inquiry/ledger-store.ts#accept`).
   */
  async registerTodoItem(input: NewTodoInput): Promise<TodoRecord> {
    const built = registerTodo(input)
    if (!built.ok) throw new LedgerStoreError('TODO_INVALID', `Todo registration rejected: ${built.reason}`)
    const candidate = built.record

    let result: TodoRecord | undefined
    await this.transaction(tx => {
      const existing = this.getTodoRaw(candidate.itemId)
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
          throw new LedgerStoreError('TODO_EXISTS')
        }
        result = existing
        return
      }
      // Idempotent ledger ensure: only write the ledger row if this parent
      // session has none yet. "Last item removed keeps the ledger" (spec) is
      // automatically satisfied because nothing here ever deletes this row.
      if (this.domain.table('shared_fact_ledger').get(candidate.parentSessionId) === undefined) {
        tx.put('shared_fact_ledger', candidate.parentSessionId, {
          parentSessionId: candidate.parentSessionId,
          createdAt: candidate.createdAt,
        })
      }
      tx.put('ledger_item', candidate.itemId, candidate)
      result = candidate
    })
    return result!
  }

  /**
   * All todo items owned by one parent session's ledger.
   *
   * This is the SAME-SOURCE read path (spec: "该主会话及其当前有效 locus 子会
   * 话可读"). The caller (tool/route layer) is responsible for having already
   * proven the requesting locus shares this exact `parentSessionId` — this
   * store performs no cross-session authorization itself, matching
   * `inquiry/ledger-store.ts` leaving scope-membership proof to its callers.
   * A ledger with zero items (or no ledger at all) returns an empty list
   * rather than a distinguishable "not found", so a caller cannot use this
   * read to probe for the EXISTENCE of a foreign parentSessionId's ledger.
   */
  listForParent(parentSessionId: string): readonly TodoRecord[] {
    return Object.freeze(this.allTodos().filter(record => record.parentSessionId === parentSessionId))
  }

  /** One todo by id, for the owner-facing management view's per-row lookups (jump targets, disposition). */
  getTodoItem(itemId: string): TodoRecord | undefined {
    return this.getTodoRaw(itemId)
  }

  /** Every todo sourced from one locus identity, regardless of which generation registered it (design D6). */
  listByLocusId(locusId: string): readonly TodoRecord[] {
    return Object.freeze(this.allTodos().filter(record => record.locusId === locusId))
  }

  /**
   * Advance one todo's status. The CALLER must already have proven this
   * request is owner-sourced (spec: "MUST NOT 由模型自行改写") — this store
   * performs no identity check, only the pure state-machine legality check via
   * `advanceTodoStatus`. Re-read inside the transaction so the decision is
   * against the state actually current at commit time.
   */
  async advanceStatus(itemId: string, to: TodoStatus, now: number): Promise<TodoRecord> {
    let result: TodoRecord | undefined
    await this.transaction(tx => {
      const current = this.getTodoRaw(itemId)
      if (current === undefined) throw new LedgerStoreError('TODO_NOT_FOUND')
      const advance = advanceTodoStatus(current, to, now)
      if (!advance.ok) {
        throw new LedgerStoreError(
          'TODO_INVALID',
          advance.reason === 'already-terminal'
            ? 'Todo is already in a terminal status and cannot be advanced further.'
            : `Illegal status transition: ${current.status} -> ${to}.`,
        )
      }
      result = advance.record
      // A no-op result (e.g. redelivered identical transition attempt that
      // the pure model happened to compute as equal) is a pointless durable
      // churn; only write when the record actually changed.
      if (JSON.stringify(advance.record) !== JSON.stringify(current)) {
        tx.put('ledger_item', itemId, advance.record)
      }
    })
    return result!
  }

  /** Whether a stored todo is already in a terminal disposition — exposed for route-layer UI gating without re-deriving the rule. */
  isTerminal(record: TodoRecord): boolean {
    return isTodoTerminal(record.status)
  }
}
