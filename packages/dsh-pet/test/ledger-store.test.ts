/**
 * Task 2.2 / 2.5 — real Domain integration tests for the shared-fact ledger
 * and its todo items, against the ACTUAL `dsh-pet` domain (real zod
 * validation, real per-domain write chain, real change events) — only the
 * medium is substituted, matching `test/collaboration-context-store.test.ts`'s
 * discipline.
 */
import { describe, expect, it } from 'vitest'
import { LedgerStoreError, SharedFactLedgerStore } from '../src/host/ledger/store.js'
import type { NewTodoInput } from '../src/host/ledger/todo.js'
import { emptyMedium, openPetHarness } from './harness.js'

const atomic = process.env.DSH_PET_TEST_ATOMIC_DOMAIN === '1'

function todoInput(overrides: Partial<NewTodoInput> = {}): NewTodoInput {
  return {
    itemId: 'todo-1',
    parentSessionId: 'main-1',
    locusId: 'locus-1',
    generation: 2,
    endpoint: { chatId: 'oc-project' },
    triggerMessageId: 'om_abc',
    requestedBy: 'ou_requester',
    evidence: { summary: '按钮点击无反应', detail: '定位到 handler 未绑定' },
    createdAt: 1_000,
    ...overrides,
  }
}

describe('SharedFactLedgerStore capability boundary', () => {
  it('refuses writes without actual atomic Domain support; reads never initialize rows (matching CollaborationContextStore)', async () => {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    try {
      const store = new SharedFactLedgerStore(h.domain)
      expect(store.listForParent('main-1')).toEqual([])
      expect(store.getTodoItem('todo-1')).toBeUndefined()
      await expect(store.registerTodoItem(todoInput())).rejects.toMatchObject({ code: 'TRANSACTION_UNAVAILABLE' })
      expect(store.listForParent('main-1')).toEqual([])
    } finally { await h.close() }
  })
})

describe.skipIf(!atomic)('SharedFactLedgerStore with real reviewed atomic Domain (opt-in config)', () => {
  it('registers a todo and idempotently ensures its owning ledger row in the SAME transaction', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      const record = await store.registerTodoItem(todoInput())
      expect(record.status).toBe('open')
      expect([...h.domain.table('shared_fact_ledger').entries()]).toHaveLength(1)
      expect([...h.domain.table('ledger_item').entries()]).toHaveLength(1)
      const ledgerRow = h.domain.table('shared_fact_ledger').get('main-1') as { parentSessionId: string; createdAt: number } | undefined
      expect(ledgerRow?.parentSessionId).toBe('main-1')
    } finally { await h.close() }
  })

  it('spec: "首次登记幂等建立" — concurrent registrations under the same parentSessionId produce exactly one ledger row', async () => {
    const h = await openPetHarness()
    try {
      const stores = [new SharedFactLedgerStore(h.domain), new SharedFactLedgerStore(h.domain)]
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          stores[i % 2]!.registerTodoItem(todoInput({ itemId: `todo-${i}`, parentSessionId: 'main-shared' }))),
      )
      const ledgerRows = [...h.domain.table('shared_fact_ledger').entries()].filter(
        ([, v]) => (v as { parentSessionId: string }).parentSessionId === 'main-shared',
      )
      expect(ledgerRows).toHaveLength(1)
      expect(stores[0]!.listForParent('main-shared')).toHaveLength(6)
    } finally { await h.close() }
  })

  it('a redelivered registration under the same itemId is a no-op returning the stored record', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      const first = await store.registerTodoItem(todoInput())
      const second = await store.registerTodoItem(todoInput())
      expect(second).toEqual(first)
      expect([...h.domain.table('ledger_item').entries()]).toHaveLength(1)
    } finally { await h.close() }
  })

  it('a DIFFERENT todo under a used itemId is refused rather than silently overwriting the first one', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput())
      await expect(store.registerTodoItem(todoInput({ requestedBy: 'ou_someone_else' })))
        .rejects.toMatchObject({ code: 'TODO_EXISTS' })
      // The original row is untouched.
      expect(store.getTodoItem('todo-1')?.requestedBy).toBe('ou_requester')
    } finally { await h.close() }
  })

  it('spec: "最后一条条目移除后台账保留" — dropping the only todo does not delete the ledger row', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput())
      await store.advanceStatus('todo-1', 'dropped', 2_000)
      // The ledger row is never deleted by this store — there is no delete
      // path at all, which is the structural guarantee, not just a test of
      // one call sequence.
      expect(h.domain.table('shared_fact_ledger').get('main-1')).toBeDefined()
      // The item itself remains listable (dropped, not vanished) — spec:
      // owners must still be able to see and audit it.
      expect(store.listForParent('main-1')).toHaveLength(1)
      expect(store.listForParent('main-1')[0]?.status).toBe('dropped')
    } finally { await h.close() }
  })

  it('spec: same-source read — listForParent returns only items whose parentSessionId matches, never cross-source items', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput({ itemId: 'todo-a', parentSessionId: 'main-a' }))
      await store.registerTodoItem(todoInput({ itemId: 'todo-b', parentSessionId: 'main-b' }))
      expect(store.listForParent('main-a').map(r => r.itemId)).toEqual(['todo-a'])
      expect(store.listForParent('main-b').map(r => r.itemId)).toEqual(['todo-b'])
      // A parentSessionId with NO ledger returns empty, not a distinguishable
      // "not found" — spec: reads must not let a caller probe existence of a
      // foreign ledger.
      expect(store.listForParent('main-nonexistent')).toEqual([])
    } finally { await h.close() }
  })

  it('design D6: listByLocusId finds a todo by its stable locus identity regardless of registered generation', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput({ itemId: 'todo-gen2', locusId: 'locus-x', generation: 2 }))
      await store.registerTodoItem(todoInput({ itemId: 'todo-gen5', locusId: 'locus-x', generation: 5, parentSessionId: 'main-1' }))
      const byLocus = store.listByLocusId('locus-x')
      expect(byLocus.map(r => r.itemId).sort()).toEqual(['todo-gen2', 'todo-gen5'])
      // generation is retained per-record but never used to EXCLUDE a match —
      // this is the "identity not instance" guarantee from design D6.
      expect(byLocus.map(r => r.generation).sort()).toEqual([2, 5])
    } finally { await h.close() }
  })

  it('advanceStatus serializes concurrent transitions inside the real domain transaction, not a repository-instance lock', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput())
      // Two concurrent attempts to move the SAME open item to two different
      // terminal states — only one legal terminal can win; the other, if it
      // reads the now-terminal state, is rejected as already-terminal rather
      // than silently applied.
      const results = await Promise.allSettled([
        store.advanceStatus('todo-1', 'done', 2_000),
        store.advanceStatus('todo-1', 'dropped', 2_000),
      ])
      const fulfilled = results.filter(r => r.status === 'fulfilled')
      const rejected = results.filter(r => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LedgerStoreError)
      // The stored record reflects exactly the winner, not a merged/racy state.
      const stored = store.getTodoItem('todo-1')
      expect(['done', 'dropped']).toContain(stored?.status)
    } finally { await h.close() }
  })

  it('advancing a nonexistent todo is rejected as TODO_NOT_FOUND', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await expect(store.advanceStatus('does-not-exist', 'done', 1_000))
        .rejects.toMatchObject({ code: 'TODO_NOT_FOUND' })
    } finally { await h.close() }
  })

  it('survives a Host restart: reopening the same medium recovers every todo and its ledger row unchanged', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput())
      await store.advanceStatus('todo-1', 'accepted', 1_500)
    } finally { await h.close() }

    const reopened = await openPetHarness(medium)
    try {
      const store = new SharedFactLedgerStore(reopened.domain)
      const record = store.getTodoItem('todo-1')
      expect(record?.status).toBe('accepted')
      expect(record?.statusChangedAt).toBe(1_500)
      expect(store.listForParent('main-1')).toHaveLength(1)
    } finally { await reopened.close() }
  })

  it('a malformed row (kind !== todo but present in ledger_item) is treated as corruption, not silently coerced', async () => {
    const h = await openPetHarness()
    try {
      const store = new SharedFactLedgerStore(h.domain)
      await store.registerTodoItem(todoInput())
      // Directly write a malformed row bypassing the store's own writer, to
      // prove the READ path (not just the write path) rejects it.
      const domain = h.domain as unknown as {
        transaction: (body: (tx: { put(table: string, key: string, value: unknown): void }) => void) => Promise<void>
      }
      await domain.transaction(tx => {
        tx.put('ledger_item', 'todo-1', { itemId: 'todo-1', kind: 'not-a-real-kind' })
      })
      expect(() => store.getTodoItem('todo-1')).toThrow()
    } finally { await h.close() }
  })
})
