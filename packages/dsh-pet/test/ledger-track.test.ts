import { describe, expect, it, vi } from 'vitest'
import { trackTodo, type TrackDeps } from '../src/host/ledger/track.js'
import { LedgerStoreError } from '../src/host/ledger/store.js'
import type { LocusContextRecord } from '../src/host/locus/context-repository.js'

function authorized(overrides: Partial<LocusContextRecord> = {}): LocusContextRecord {
  return {
    endpoint: { chatId: 'oc-project' },
    locus: { locusId: 'locus-1', generation: 2, state: 'active' },
    main: { sessionId: 'main-1' },
    child: { sessionId: 'child-1' },
    workspace: { workspaceId: 'workspace-1' },
    permission: { effective: 'read', desired: 'read' },
    contextAnchor: { status: 'unknown' },
    currentDelivery: {
      deliveryId: 'delivery-1',
      messageId: 'om_trigger',
      endpoint: { chatId: 'oc-project' },
      locusId: 'locus-1',
      generation: 2,
      childSessionId: 'child-1',
      status: 'current',
      senderOpenId: 'ou_requester',
    },
    ...overrides,
  }
}

function deps(overrides: Partial<TrackDeps> = {}): TrackDeps {
  return {
    store: { registerTodoItem: vi.fn(async input => ({ ...input, kind: 'todo', status: 'open', statusChangedAt: input.createdAt })) },
    now: () => 1_000,
    newItemId: () => 'todo-new',
    ...overrides,
  }
}

describe('trackTodo', () => {
  it('registers a todo using facts fixed from the authorized delivery — not from any model-supplied argument', async () => {
    const registerTodoItem = vi.fn(async (input: unknown) => ({ ...(input as object), kind: 'todo', status: 'open', statusChangedAt: 1_000 }))
    const result = await trackTodo(authorized(), { summary: 'button broken', detail: 'trace here' }, deps({ store: { registerTodoItem } }))
    expect(result.ok).toBe(true)
    expect(registerTodoItem).toHaveBeenCalledWith({
      itemId: 'todo-new',
      parentSessionId: 'main-1',
      locusId: 'locus-1',
      generation: 2,
      endpoint: { chatId: 'oc-project' },
      triggerMessageId: 'om_trigger',
      requestedBy: 'ou_requester',
      evidence: { summary: 'button broken', detail: 'trace here' },
      createdAt: 1_000,
    })
  })

  it('spec: 无唯一 current 时拒绝登记 — no currentDelivery on the authorized record refuses registration', async () => {
    const registerTodoItem = vi.fn()
    const result = await trackTodo(
      authorized({ currentDelivery: undefined }),
      { summary: 'x', detail: 'y' },
      deps({ store: { registerTodoItem } }),
    )
    expect(result).toEqual({ ok: false, reason: 'no-current-delivery' })
    expect(registerTodoItem).not.toHaveBeenCalled()
  })

  it('preserves threadId when the current Delivery endpoint has one', async () => {
    const registerTodoItem = vi.fn(async (input: unknown) => ({ ...(input as object), kind: 'todo', status: 'open', statusChangedAt: 1_000 }))
    await trackTodo(
      authorized({ currentDelivery: { ...authorized().currentDelivery!, endpoint: { chatId: 'oc-x', threadId: 'omt-y' } } }),
      { summary: 'x', detail: 'y' },
      deps({ store: { registerTodoItem } }),
    )
    expect(registerTodoItem).toHaveBeenCalledWith(expect.objectContaining({ endpoint: { chatId: 'oc-x', threadId: 'omt-y' } }))
  })

  it('falls back to "unknown" requestedBy when senderOpenId is absent, rather than throwing or guessing an identity', async () => {
    const registerTodoItem = vi.fn(async (input: unknown) => ({ ...(input as object), kind: 'todo', status: 'open', statusChangedAt: 1_000 }))
    await trackTodo(
      authorized({ currentDelivery: { ...authorized().currentDelivery!, senderOpenId: undefined } }),
      { summary: 'x', detail: 'y' },
      deps({ store: { registerTodoItem } }),
    )
    expect(registerTodoItem).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: 'unknown' }))
  })

  it('rejects an empty summary before ever calling the store', async () => {
    const registerTodoItem = vi.fn()
    const result = await trackTodo(authorized(), { summary: '', detail: 'y' }, deps({ store: { registerTodoItem } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-evidence')
    expect(registerTodoItem).not.toHaveBeenCalled()
  })

  it('rejects a non-string detail before ever calling the store', async () => {
    const registerTodoItem = vi.fn()
    const result = await trackTodo(authorized(), { summary: 'ok', detail: 123 as unknown as string }, deps({ store: { registerTodoItem } }))
    expect(result.ok).toBe(false)
    expect(registerTodoItem).not.toHaveBeenCalled()
  })

  it('surfaces a store-layer LedgerStoreError as a structured failure rather than throwing past the tool boundary', async () => {
    const registerTodoItem = vi.fn(async () => { throw new LedgerStoreError('TODO_EXISTS') })
    const result = await trackTodo(authorized(), { summary: 'x', detail: 'y' }, deps({ store: { registerTodoItem } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('store-error')
  })

  it('re-throws a non-LedgerStoreError from the store rather than silently swallowing an unexpected failure', async () => {
    const registerTodoItem = vi.fn(async () => { throw new Error('unexpected') })
    await expect(trackTodo(authorized(), { summary: 'x', detail: 'y' }, deps({ store: { registerTodoItem } })))
      .rejects.toThrow('unexpected')
  })

  it('takes no target/locus/chat selector parameter in its own signature — TrackInput has only summary/detail', () => {
    // Structural guarantee, not a runtime probe: `TrackInput`'s only fields
    // are `summary`/`detail`; there is no `locusId`/`chatId`/`messageId`
    // parameter position for a model argument to occupy. This is checked at
    // compile time by TrackInput's own type — this test documents the
    // invariant rather than re-deriving it at runtime.
    const input: import('../src/host/ledger/track.js').TrackInput = { summary: 'x', detail: 'y' }
    expect(Object.keys(input).sort()).toEqual(['detail', 'summary'])
  })
})
