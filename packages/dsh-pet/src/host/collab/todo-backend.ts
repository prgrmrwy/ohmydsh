/**
 * `TodoBackend` over the Locus collaboration space
 * (`locus-three-tier-structure` design D8; spec `pet-locus-intent-triage`
 * "待办由 Host 以 locus 主会话身份代写").
 *
 * The space is the only truth: Pet keeps no todo rows of its own. A todo is a
 * `request` item authored by the locus main session (`locus`), assigned to the
 * work main session (`work`), with no required acks:
 *  - `body` is canonical JSON `{"summary","detail"}`; but the EVIDENCE is
 *    always read from the `item/created` event, so a later revise by the work
 *    session never changes the registered snapshot.
 *  - `ext.pet` carries the fixed source facts
 *    `{entry, generation, endpoint, messageId, requester}`; `entry` is the
 *    stable entry identity, `generation` is an audit fact only.
 *  - `createdAt` is the creation commit's `at`; `statusChangedAt` the latest
 *    `request/progressed` commit's `at`. A commit without `at` makes the space
 *    unreadable rather than inventing a time.
 *  - Status maps open/accepted/done/dropped ↔ open/accepted/done/rejected.
 *
 * Registration runs as the locus main session through `actAs`, never as the
 * registering child. Owner dispositions use the manager command
 * `disposeRequest`, which wakes nobody, and still work for todos registered by
 * a locus main session that has since been replaced or archived.
 *
 * The handle returns the full log on every read, so the incremental cursor
 * lives here: each space's fold is cached and only records past the cursor
 * are applied.
 */
import { randomUUID } from 'node:crypto'
import type { TodoBackend } from '../ledger/backend.js'
import { LedgerStoreError } from '../ledger/store.js'
import {
  advanceTodoStatus, registerTodo, type NewTodoInput, type TodoRecord, type TodoStatus,
} from '../ledger/todo.js'
import type { LocusCollab, LocusMainDirectory, LocusMainRef } from './locus-collab.js'
import { LOCUS_MEMBER, WORK_MEMBER, locusSpaceId } from './naming.js'
import { applyRecord, emptySpace, type FoldedSpace } from './space-fold.js'
import { isHandleError, type CollabCommitRecord, type CollabIntegrationHandle } from './types.js'

export interface CollabTodoBackendDeps {
  readonly collab: LocusCollab
  /** Every locus main session Pet ever created, history included. */
  readonly directory: LocusMainDirectory
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

function unreadable(): never {
  throw new LedgerStoreError('TODO_CORRUPT')
}

/** Rebuild one todo from its folded item; anything not shaped like a Pet todo is skipped. */
function todoFromItem(ref: LocusMainRef, space: FoldedSpace, itemId: string): TodoRecord | undefined {
  const current = space.items.get(itemId) as Record<string, any> | undefined
  const created = space.itemCreated.get(itemId)
  if (current === undefined || created === undefined) return undefined
  // Everything but the progress comes from the creation event: a later revise
  // by the work session never changes the registered snapshot.
  const item = created.item as Record<string, any>
  if (item.kind !== 'request' || item.author !== LOCUS_MEMBER || item.assignee !== WORK_MEMBER) return undefined
  const pet = item.ext?.pet
  if (typeof pet !== 'object' || pet === null || typeof pet.entry !== 'string' || pet.entry === '') return undefined
  if (created.at === undefined || !Number.isSafeInteger(created.at)) unreadable()
  let evidence: { summary?: unknown; detail?: unknown }
  try { evidence = JSON.parse(item.body) } catch { return unreadable() }
  if (typeof evidence?.summary !== 'string' || typeof evidence.detail !== 'string') unreadable()
  const progressed = space.itemProgressed.get(itemId)
  const status = progressed === undefined ? 'open' : STATUS_OF[current.progress]
  if (status === undefined) return undefined
  if (progressed !== undefined && (progressed.at === undefined || !Number.isSafeInteger(progressed.at))) unreadable()
  return Object.freeze({
    itemId,
    parentSessionId: ref.locusMainSessionId,
    workSessionId: ref.workSessionId,
    kind: 'todo',
    locusId: pet.entry,
    generation: pet.generation,
    endpoint: pet.endpoint?.threadId === undefined ? { chatId: pet.endpoint?.chatId } : { chatId: pet.endpoint.chatId, threadId: pet.endpoint.threadId },
    triggerMessageId: pet.messageId,
    requestedBy: pet.requester,
    evidence: { summary: evidence.summary as string, detail: evidence.detail as string },
    status,
    createdAt: created.at,
    statusChangedAt: progressed?.at ?? created.at,
  }) as TodoRecord
}

export class CollabTodoBackend implements TodoBackend {
  private readonly folds = new Map<string, FoldedSpace>()
  private foldedHandle: CollabIntegrationHandle | undefined

  constructor(private readonly deps: CollabTodoBackendDeps) {}

  private handle(): CollabIntegrationHandle {
    const handle = this.deps.collab.currentHandle()
    if (handle === undefined) throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    if (handle !== this.foldedHandle) {
      // A new attachment reads from scratch: nothing cached survives a detach.
      this.folds.clear()
      this.foldedHandle = handle
    }
    return handle
  }

  private refOf(locusMainSessionId: string): LocusMainRef | undefined {
    return this.deps.directory.list().find(ref => ref.locusMainSessionId === locusMainSessionId)
  }

  /** Apply every record past the cursor; returns the folded space, or undefined when unreadable as absent. */
  private async fold(ref: LocusMainRef): Promise<FoldedSpace | undefined> {
    const handle = this.handle()
    const spaceId = locusSpaceId(ref.locusMainSessionId)
    const records = await handle.readManaged(spaceId)
    if (isHandleError(records)) {
      if (records.error.code === 'COLLAB_SPACE_UNAVAILABLE') return undefined
      throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    }
    let state = this.folds.get(spaceId)
    const last = records.at(-1)?.seq ?? 0
    if (state === undefined || last < state.cursor) {
      state = emptySpace()
      this.folds.set(spaceId, state)
    }
    for (const record of records as readonly CollabCommitRecord[]) {
      if (record.seq <= state.cursor) continue
      applyRecord(state, record)
    }
    return state
  }

  /** Every todo of one space, oldest first. */
  private todosOf(ref: LocusMainRef, space: FoldedSpace): TodoRecord[] {
    const todos: TodoRecord[] = []
    for (const itemId of space.items.keys()) {
      const todo = todoFromItem(ref, space, itemId)
      if (todo !== undefined) todos.push(todo)
    }
    return todos.sort((a, b) => a.createdAt - b.createdAt)
  }

  async registerTodoItem(input: NewTodoInput): Promise<TodoRecord> {
    const built = registerTodo(input)
    if (!built.ok) throw new LedgerStoreError('TODO_INVALID', `Todo registration rejected: ${built.reason}`)
    const candidate = built.record
    this.handle()
    const main = candidate.parentSessionId
    const ref = this.refOf(main)
    if (ref === undefined) throw new LedgerStoreError('SPACE_NOT_READY')
    if (!(await this.deps.collab.isReady(main))) {
      throw new LedgerStoreError(this.deps.collab.currentHandle() === undefined ? 'COLLAB_UNAVAILABLE' : 'SPACE_NOT_READY')
    }

    const created = await this.deps.collab.actAs(main, `track-${candidate.itemId}`, {
      op: 'createItem',
      input: {
        itemId: candidate.itemId,
        kind: 'request',
        assignee: WORK_MEMBER,
        requiredAcks: [],
        title: todoTitle(candidate.evidence.summary),
        body: todoBody(candidate.evidence),
        ext: {
          pet: {
            entry: candidate.locusId,
            generation: candidate.generation,
            endpoint: candidate.endpoint,
            messageId: candidate.triggerMessageId,
            requester: candidate.requestedBy,
          },
        },
      },
    })
    if (!created.ok) {
      const code = created.code
      if (code === 'COLLAB_BAD_ITEM' || code === 'COLLAB_CMD_CONFLICT') throw new LedgerStoreError('TODO_EXISTS')
      throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    }
    const space = await this.fold(ref)
    const stored = space === undefined ? undefined : todoFromItem(ref, space, candidate.itemId)
    if (stored === undefined) throw new LedgerStoreError('TODO_CORRUPT')
    return stored
  }

  async getTodoItem(itemId: string): Promise<TodoRecord | undefined> {
    for (const ref of this.deps.directory.list()) {
      const space = await this.fold(ref)
      if (space === undefined) continue
      const todo = todoFromItem(ref, space, itemId)
      if (todo !== undefined) return todo
    }
    return undefined
  }

  /**
   * Every todo of one session's spaces. `sessionId` is a locus main session
   * (its own space) or a work main session (every space ever built for it,
   * historical ones included); anything else resolves to `[]`.
   */
  async listForParent(sessionId: string): Promise<readonly TodoRecord[]> {
    const refs = this.deps.directory.list().filter(ref => ref.locusMainSessionId === sessionId || ref.workSessionId === sessionId)
    const todos: TodoRecord[] = []
    for (const ref of refs) {
      const space = await this.fold(ref)
      if (space !== undefined) todos.push(...this.todosOf(ref, space))
    }
    return Object.freeze(todos)
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
        // Moved underneath us (e.g. the work session advanced it): report against the fresh state.
        const fresh = await this.getTodoItem(itemId)
        throw new LedgerStoreError('TODO_INVALID', fresh !== undefined && fresh.status !== current.status
          ? 'Todo is already in a terminal status and cannot be advanced further.'
          : `Illegal status transition: ${current.status} -> ${to}.`)
      }
      if (code === 'COLLAB_ITEM_NOT_FOUND') throw new LedgerStoreError('TODO_NOT_FOUND')
      throw new LedgerStoreError('COLLAB_UNAVAILABLE')
    }
    const ref = this.refOf(current.parentSessionId)
    const space = ref === undefined ? undefined : await this.fold(ref)
    const after = ref === undefined || space === undefined ? undefined : todoFromItem(ref, space, itemId)
    if (after === undefined) throw new LedgerStoreError('TODO_CORRUPT')
    return after
  }
}
