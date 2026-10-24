/**
 * `TodoBackend` implementations the storage-contract tests run against
 * (`pet-locus-collab-integration` design D9, tasks 5.2).
 *
 * Only `legacy` today; the collab implementation joins this list in a later
 * task group, and every `describe.each(todoBackendCases)` suite then runs
 * against both without touching an assertion.
 */
import { legacyTodoBackend, type TodoBackend } from '../src/host/ledger/backend.js'
import { SharedFactLedgerStore } from '../src/host/ledger/store.js'
import { emptyMedium, openPetHarness } from './harness.js'

export interface OpenedTodoBackend {
  readonly backend: TodoBackend
  close(): Promise<void>
}

export interface TodoBackendCase {
  readonly name: string
  /** A backend over real, atomic storage. */
  open(): Promise<OpenedTodoBackend>
  /** A backend whose storage lacks atomic writes, through the real Domain layer. */
  openWithoutTransaction(): Promise<OpenedTodoBackend>
  /** A backend whose storage lacks atomic writes, needing no runtime at all. */
  nonAtomic(): TodoBackend
}

export const todoBackendCases: readonly TodoBackendCase[] = [
  {
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
  },
]
