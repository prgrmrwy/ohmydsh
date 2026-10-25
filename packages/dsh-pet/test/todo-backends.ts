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
import { LocusCollabProxy, type ProxyLocusRecord } from '../src/host/collab/proxy.js'
import { CollabTodoBackend } from '../src/host/collab/todo-backend.js'
import { emptyMedium, openPetHarness } from './harness.js'
import { SUBAGENT_HEADER, openCollabWorld } from './support/collab-host.js'

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
    const loci: ProxyLocusRecord[] = []
    const proxy = new LocusCollabProxy({ listLoci: () => loci, liveAgent: id => world.live.get(id) })
    proxy.attach(world.service)
    const inner = new CollabTodoBackend({
      proxy,
      childOf: ({ locusId, parentSessionId }) => loci.find(record => record.id === locusId && record.parentSessionId === parentSessionId)?.childSessionId,
      liveAgent: id => world.live.get(id),
    })
    const provision = async (input: NewTodoInput) => {
      if (loci.some(record => record.id === input.locusId && record.parentSessionId === input.parentSessionId)) return
      const child = `child-${input.parentSessionId}-${input.locusId}`
      loci.push({
        id: input.locusId, generation: input.generation, endpoint: input.endpoint,
        parentSessionId: input.parentSessionId, childSessionId: child, state: 'active',
      })
      world.session(child, SUBAGENT_HEADER(input.parentSessionId))
      if (!world.live.has(input.parentSessionId)) world.session(input.parentSessionId)
      proxy.refresh()
      const ensured = await proxy.ensureSpace(input.parentSessionId)
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
