/**
 * `TodoBackend` over the Locus collaboration space (design D6, D8, D9).
 *
 * The space is the only truth: Pet keeps no todo rows of its own. A todo is a
 * `request` item authored by the proxy member `pet`, assigned to `main`, with
 * no required acks:
 *  - `body` is canonical JSON `{"summary","detail"}`; but the EVIDENCE is
 *    always read from the `item/created` event, so a later revise by the main
 *    session never changes the registered snapshot.
 *  - `ext.pet` carries the fixed source facts; `ext.pet.locusId` (the stable
 *    entry identity) is merged in by dsh-collab from the caller's stamp.
 *    `TodoRecord.locusId` is `ext.pet.recordId`, the registering generation's
 *    record id — the same meaning the legacy store gives it.
 *  - `createdAt` is the creation commit's `at`; `statusChangedAt` the latest
 *    `request/progressed` commit's `at`. A commit without `at` makes the space
 *    unreadable rather than inventing a time.
 *  - Status maps open/accepted/done/dropped ↔ open/accepted/done/rejected.
 *
 * Registration runs as the registering child itself (`command(exec, …)` with
 * the Host's CURRENT Agent object for that child). If that child is not in the
 * Host, registration fails as "collaboration layer unavailable" — never under
 * another identity.
 *
 * Owner dispositions use the manager command `disposeRequest`, which wakes
 * nobody. The handle returns the full log on every read, so the incremental
 * cursor lives here: each space's folded todos are cached and only records
 * past the cursor are applied.
 */
import { randomUUID } from 'node:crypto'
import type { TodoBackend } from '../ledger/backend.js'
import { LedgerStoreError } from '../ledger/store.js'
import {
  advanceTodoStatus, registerTodo, type NewTodoInput, type TodoRecord, type TodoStatus,
} from '../ledger/todo.js'
import { MAIN_MEMBER, PET_MEMBER, locusSpaceId } from './naming.js'
import type { LocusCollabProxy } from './proxy.js'
import { stampLocusId } from './routing.js'
import { isHandleError, type CollabCommitRecord, type CollabIntegrationHandle } from './types.js'

export interface CollabTodoBackendDeps {
  readonly proxy: LocusCollabProxy
  /** The registering generation's child session for a locus record of that parent, if any. */
  childOf(input: { readonly locusId: string; readonly parentSessionId: string }): string | undefined
  /** The Host's CURRENT live Agent object, or undefined. Never resumes. */
  liveAgent(sessionId: string): unknown
  newAttemptId?(): string
}

const PROGRESS_OF: Readonly<Record<TodoStatus, 'open' | 'accepted' | 'done' | 'rejected'>> = Object.freeze({
  open: 'open', accepted: 'accepted', done: 'done', dropped: 'rejected',
})
const STATUS_OF: Readonly<Record<string, TodoStatus>> = Object.freeze({
  open: 'open', accepted: 'accepted', done: 'done', rejected: 'dropped',
})

/** Title shown in the space: first line of the summary, ≤ 200 characters. Display only. */
export function todoTitle(summary: string): string {
  const first = summary.split('\n')[0]!.trim() || summary.trim()
  const chars = [...first]
  return chars.length <= 200 ? first : `${chars.slice(0, 199).join('')}…`
}

/** Canonical body: fixed key order, lossless JSON. */
export function todoBody(evidence: { readonly summary: string; readonly detail: string }): string {
  return JSON.stringify({ summary: evidence.summary, detail: evidence.detail })
}

interface FoldState {
  cursor: number
  readonly todos: Map<string, TodoRecord>
  readonly order: string[]
}

function unreadable(): never {
  throw new LedgerStoreError('TODO_CORRUPT')
}

/** Rebuild one todo from its `item/created` event; anything not shaped like a Pet todo is skipped. */
function todoFromCreation(parentSessionId: string, item: Record<string, any>, at: number | undefined): TodoRecord | undefined {
  if (item.kind !== 'request' || item.author !== PET_MEMBER || item.assignee !== MAIN_MEMBER) return undefined
  const pet = item.ext?.pet
  if (typeof pet !== 'object' || pet === null || pet.kind !== 'todo') return undefined
  // The stamp (stable entry identity) must be present; the record's `locusId`
  // keeps its legacy meaning — the REGISTERING generation's record id — so
  // every existing consumer (`getLocus(todo.locusId)`) behaves as before.
  if (stampLocusId(item.ext) === undefined) return undefined
  const locusId = pet.recordId
  if (typeof locusId !== 'string' || locusId === '') return undefined
  if (at === undefined || !Number.isSafeInteger(at)) unreadable()
  let evidence: { summary?: unknown; detail?: unknown }
  try { evidence = JSON.parse(item.body) } catch { return unreadable() }
  if (typeof evidence?.summary !== 'string' || typeof evidence.detail !== 'string') unreadable()
  return Object.freeze({
    itemId: item.id,
    parentSessionId,
    kind: 'todo',
    locusId,
    generation: pet.generation,
    endpoint: pet.endpoint?.threadId === undefined ? { chatId: pet.endpoint?.chatId } : { chatId: pet.endpoint.chatId, threadId: pet.endpoint.threadId },
    triggerMessageId: pet.triggerMessageId,
    requestedBy: pet.requestedBy,
    evidence: { summary: evidence.summary as string, detail: evidence.detail as string },
    status: 'open',
    createdAt: at,
    statusChangedAt: at,
  }) as TodoRecord
}

export class CollabTodoBackend implements TodoBackend {
  private readonly folds = new Map<string, FoldState>()
  private readonly owners = new Map<string, string>()
  private foldedHandle: CollabIntegrationHandle | undefined

  constructor(private readonly deps: CollabTodoBackendDeps) {}

  private handle(): CollabIntegrationHandle {
    const handle = this.deps.proxy.currentHandle()
    if (handle === undefined) throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    if (handle !== this.foldedHandle) {
      // A new attachment reads from scratch: nothing cached survives a detach.
      this.folds.clear()
      this.owners.clear()
      this.foldedHandle = handle
    }
    return handle
  }

  /** Apply every record past the cursor; returns the folded todos of one parent's space. */
  private async fold(parentSessionId: string): Promise<FoldState | undefined> {
    const handle = this.handle()
    const spaceId = locusSpaceId(parentSessionId)
    const records = await handle.readManaged(spaceId)
    if (isHandleError(records)) {
      if (records.error.code === 'COLLAB_SPACE_UNAVAILABLE') return undefined
      throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    }
    let state = this.folds.get(spaceId)
    const last = records.at(-1)?.seq ?? 0
    if (state === undefined || last < state.cursor) {
      state = { cursor: 0, todos: new Map(), order: [] }
      this.folds.set(spaceId, state)
    }
    for (const record of records as readonly CollabCommitRecord[]) {
      if (record.seq <= state.cursor) continue
      for (const event of record.events as readonly Record<string, any>[]) {
        if (event.type === 'item/created') {
          const todo = todoFromCreation(parentSessionId, event.item, record.at)
          if (todo === undefined) continue
          state.todos.set(todo.itemId, todo)
          state.order.push(todo.itemId)
          this.owners.set(todo.itemId, parentSessionId)
        } else if (event.type === 'request/progressed') {
          const current = state.todos.get(event.itemId)
          const status = STATUS_OF[event.progress]
          if (current === undefined || status === undefined) continue
          if (record.at === undefined || !Number.isSafeInteger(record.at)) unreadable()
          state.todos.set(event.itemId, Object.freeze({ ...current, status, statusChangedAt: record.at }))
        }
      }
      state.cursor = record.seq
    }
    return state
  }

  async registerTodoItem(input: NewTodoInput): Promise<TodoRecord> {
    const built = registerTodo(input)
    if (!built.ok) throw new LedgerStoreError('TODO_INVALID', `Todo registration rejected: ${built.reason}`)
    const candidate = built.record
    const handle = this.handle()
    const parent = candidate.parentSessionId
    if (!this.deps.proxy.isEstablished(parent)) throw new LedgerStoreError('SPACE_NOT_READY')
    const child = this.deps.childOf({ locusId: candidate.locusId, parentSessionId: parent })
    const agent = child === undefined ? undefined : this.deps.liveAgent(child)
    if (agent === undefined) throw new LedgerStoreError('COLLAB_UNAVAILABLE')

    const created = await handle.command({ agent }, locusSpaceId(parent), `track-${candidate.itemId}`, {
      op: 'createItem',
      input: {
        itemId: candidate.itemId,
        kind: 'request',
        assignee: MAIN_MEMBER,
        requiredAcks: [],
        title: todoTitle(candidate.evidence.summary),
        body: todoBody(candidate.evidence),
        ext: {
          pet: {
            kind: 'todo',
            recordId: candidate.locusId,
            generation: candidate.generation,
            endpoint: candidate.endpoint,
            triggerMessageId: candidate.triggerMessageId,
            requestedBy: candidate.requestedBy,
          },
        },
      },
    })
    if (isHandleError(created)) {
      const code = created.error.code
      if (code === 'COLLAB_CALLER_UNAVAILABLE') {
        throw new LedgerStoreError(this.deps.proxy.isEstablished(parent) ? 'COLLAB_UNAVAILABLE' : 'SPACE_NOT_READY')
      }
      if (code === 'COLLAB_BAD_ITEM' || code === 'COLLAB_CMD_CONFLICT') throw new LedgerStoreError('TODO_EXISTS')
      throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    }
    const stored = (await this.fold(parent))?.todos.get(candidate.itemId)
    if (stored === undefined) throw new LedgerStoreError('TODO_CORRUPT')
    return stored
  }

  async getTodoItem(itemId: string): Promise<TodoRecord | undefined> {
    const known = this.owners.get(itemId)
    if (known !== undefined) {
      const hit = (await this.fold(known))?.todos.get(itemId)
      if (hit !== undefined) return hit
    }
    for (const parent of this.deps.proxy.knownParents()) {
      if (parent === known) continue
      const hit = (await this.fold(parent))?.todos.get(itemId)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  async listForParent(parentSessionId: string): Promise<readonly TodoRecord[]> {
    const state = await this.fold(parentSessionId)
    if (state === undefined) return Object.freeze([])
    return Object.freeze(state.order.map(id => state.todos.get(id)!))
  }

  async advanceStatus(itemId: string, to: TodoStatus, _now: number): Promise<TodoRecord> {
    const current = await this.getTodoItem(itemId)
    if (current === undefined) throw new LedgerStoreError('TODO_NOT_FOUND')
    const legal = advanceTodoStatus(current, to, current.statusChangedAt)
    if (!legal.ok) {
      throw new LedgerStoreError(
        'TODO_INVALID',
        legal.reason === 'already-terminal'
          ? 'Todo is already in a terminal status and cannot be advanced further.'
          : `Illegal status transition: ${current.status} -> ${to}.`,
      )
    }
    const attempt = this.deps.newAttemptId?.() ?? randomUUID().slice(0, 8)
    const op = to === 'accepted' ? 'accept' : to === 'done' ? 'done' : 'drop'
    const handle = this.handle()
    const disposed = await handle.disposeRequest(locusSpaceId(current.parentSessionId), `${op}-${itemId}-${attempt}`, {
      itemId, progress: PROGRESS_OF[to],
    })
    if (isHandleError(disposed)) {
      const code = disposed.error.code
      if (code === 'COLLAB_BAD_TRANSITION') {
        // Moved underneath us (e.g. the main session advanced it): report against the fresh state.
        const fresh = await this.getTodoItem(itemId)
        throw new LedgerStoreError('TODO_INVALID', fresh !== undefined && fresh.status !== current.status
          ? 'Todo is already in a terminal status and cannot be advanced further.'
          : `Illegal status transition: ${current.status} -> ${to}.`)
      }
      if (code === 'COLLAB_ITEM_NOT_FOUND') throw new LedgerStoreError('TODO_NOT_FOUND')
      throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    }
    const after = (await this.fold(current.parentSessionId))?.todos.get(itemId)
    if (after === undefined) throw new LedgerStoreError('TODO_CORRUPT')
    return after
  }
}
