/**
 * `TodoBackend` implementations the storage-contract tests run against
 * (`pet-locus-collab-integration` design D9, tasks 5.2 / 7.5).
 *
 * `todoBackendCases` lists every implementation; each `describe.each` suite
 * runs against all of them without touching an assertion. Medium-specific
 * fixtures (a domain without atomic transactions) exist only for `legacy` and
 * live in `legacyTodoBackendCase`.
 */
import { legacyTodoBackend, type TodoBackend } from '../src/host/ledger/backend.js'
import { SharedFactLedgerStore } from '../src/host/ledger/store.js'
import type { NewTodoInput, TodoRecord } from '../src/host/ledger/todo.js'
import { LocusCollab, type LocusMainRef } from '../src/host/collab/locus-collab.js'
import { CollabTodoBackend } from '../src/host/collab/todo-backend.js'
import { emptyMedium, openPetHarness } from './harness.js'
import { openCollabWorld } from './support/collab-host.js'

export interface OpenedTodoBackend {
  readonly backend: TodoBackend
  close(): Promise<void>
}

export interface TodoBackendCase {
  readonly name: string
  /** A backend over real storage, ready to register todos for any parent/locus. */
  open(): Promise<OpenedTodoBackend>
}

export interface LegacyTodoBackendCase extends TodoBackendCase {
  /** A backend whose storage lacks atomic writes, through the real Domain layer. */
  openWithoutTransaction(): Promise<OpenedTodoBackend>
  /** A backend whose storage lacks atomic writes, needing no runtime at all. */
  nonAtomic(): TodoBackend
}

export const legacyTodoBackendCase: LegacyTodoBackendCase = {
  name: 'legacy',
  async open() {
    const h = await openPetHarness()
    return { backend: legacyTodoBackend(new SharedFactLedgerStore(h.domain)), close: () => h.close() }
  },
  async openWithoutTransaction() {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    return { backend: legacyTodoBackend(new SharedFactLedgerStore(h.domain)), close: () => h.close() }
  },
  nonAtomic() {
    const domain = { supportsTransaction: false } as unknown as ConstructorParameters<typeof SharedFactLedgerStore>[0]
    return legacyTodoBackend(new SharedFactLedgerStore(domain))
  },
}

/**
 * The collab backend over the REAL dsh-collab plugin. Registering for a
 * parent/locus not seen before first provisions it the way the Host would:
 * a live main session, a live child for that locus record, and an
 * established space. Everything else is the real implementation.
 */
export const collabTodoBackendCase: TodoBackendCase = {
  name: 'collab',
  async open() {
    const world = await openCollabWorld()
    const mains: LocusMainRef[] = []
    const collab = new LocusCollab({ directory: { list: () => mains } })
    collab.attach(world.service)
    const inner = new CollabTodoBackend({ collab, directory: { list: () => mains } })
    // `parentSessionId` of a registration is the locus main session; each gets a work main session.
    const provision = async (input: NewTodoInput) => {
      if (mains.some(ref => ref.locusMainSessionId === input.parentSessionId)) return
      const ref: LocusMainRef = { locusMainSessionId: input.parentSessionId, workSessionId: `work-of-${input.parentSessionId}` }
      mains.push(ref)
      world.session(ref.locusMainSessionId)
      world.session(ref.workSessionId)
      const ensured = await collab.ensureSpace(ref)
      if (!ensured.ok) throw new Error(`collab fixture could not establish a space: ${JSON.stringify(ensured)}`)
    }
    const backend: TodoBackend = {
      registerTodoItem: async (input: NewTodoInput): Promise<TodoRecord> => { await provision(input); return inner.registerTodoItem(input) },
      getTodoItem: id => inner.getTodoItem(id),
      listForParent: id => inner.listForParent(id),
      advanceStatus: (id, to, now) => inner.advanceStatus(id, to, now),
    }
    return { backend, close: () => world.stop() }
  },
}

export const todoBackendCases: readonly TodoBackendCase[] = [legacyTodoBackendCase, collabTodoBackendCase]
