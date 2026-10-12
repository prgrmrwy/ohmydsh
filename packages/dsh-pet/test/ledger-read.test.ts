import { describe, expect, it } from 'vitest'
import {
  ledgerReadUnavailableText,
  readSharedLedger,
  readSharedLedgerOutcome,
  type LedgerReadDeps,
} from '../src/host/ledger/ledger-read.js'
import type { LedgerCaller } from '../src/host/ledger/caller.js'
import { registerTodo } from '../src/host/ledger/todo.js'
import type { TodoRecord } from '../src/host/ledger/todo.js'

function caller(overrides: Partial<LedgerCaller> = {}): LedgerCaller {
  return {
    childSessionId: 'child-a',
    parentSessionId: 'main-1',
    locusId: 'locus-a',
    generation: 1,
    endpoint: { chatId: 'oc-a' },
    ...overrides,
  }
}

function todo(overrides: Partial<Parameters<typeof registerTodo>[0]> = {}): TodoRecord {
  const result = registerTodo({
    itemId: 'todo-1',
    parentSessionId: 'main-1',
    locusId: 'locus-a',
    generation: 1,
    endpoint: { chatId: 'oc-a' },
    triggerMessageId: 'om_1',
    requestedBy: 'ou_x',
    evidence: { summary: 'summary text', detail: 'detail text' },
    createdAt: 1_000,
    ...overrides,
  })
  if (!result.ok) throw new Error('fixture setup failed')
  return result.record
}

function deps(byParent: Record<string, readonly TodoRecord[]>): LedgerReadDeps {
  return { listForParent: (parentSessionId: string) => byParent[parentSessionId] ?? [] }
}

describe('readSharedLedger', () => {
  it('returns the projected items for the caller\'s own parentSessionId', () => {
    const items = readSharedLedger(caller(), deps({ 'main-1': [todo()] }))
    expect(items).toEqual([{
      itemId: 'todo-1',
      locusId: 'locus-a',
      summary: 'summary text',
      detail: 'detail text',
      status: 'open',
      requestedBy: 'ou_x',
      createdAt: 1_000,
    }])
  })

  it('spec: 同源子会话读到彼此登记的结论 — item registered by a DIFFERENT locus under the same parent is still visible', () => {
    const itemFromSiblingLocus = todo({ itemId: 'todo-from-b', locusId: 'locus-b' })
    const items = readSharedLedger(caller({ locusId: 'locus-a' }), deps({ 'main-1': [itemFromSiblingLocus] }))
    expect(items.map(i => i.itemId)).toEqual(['todo-from-b'])
  })

  it('never omits or renames the parentSessionId field it deliberately does not project', () => {
    const items = readSharedLedger(caller(), deps({ 'main-1': [todo()] }))
    expect(Object.keys(items[0]!)).not.toContain('parentSessionId')
  })

  it('does not project the raw endpoint or triggerMessageId — this tool surfaces content, not routing facts', () => {
    const items = readSharedLedger(caller(), deps({ 'main-1': [todo()] }))
    expect(Object.keys(items[0]!)).not.toContain('endpoint')
    expect(Object.keys(items[0]!)).not.toContain('triggerMessageId')
  })

  it('an empty ledger and a nonexistent ledger both project to an empty list — existence is not distinguishable', () => {
    expect(readSharedLedger(caller({ parentSessionId: 'main-empty' }), deps({ 'main-empty': [] }))).toEqual([])
    expect(readSharedLedger(caller({ parentSessionId: 'main-never-created' }), deps({}))).toEqual([])
  })

  it('calls listForParent with EXACTLY the resolved parentSessionId, never a model-suppliable value', () => {
    let calledWith: string | undefined
    readSharedLedger(caller({ parentSessionId: 'main-specific' }), {
      listForParent: (parentSessionId: string) => { calledWith = parentSessionId; return [] },
    })
    expect(calledWith).toBe('main-specific')
  })

  it('returns multiple items in the order the store already provides (no re-sorting/hiding)', () => {
    const items = readSharedLedger(caller(), deps({
      'main-1': [todo({ itemId: 'todo-1', createdAt: 1_000 }), todo({ itemId: 'todo-2', createdAt: 2_000 })],
    }))
    expect(items.map(i => i.itemId)).toEqual(['todo-1', 'todo-2'])
  })
})

describe('an unavailable ledger read is not an empty ledger', () => {
  it('ledger dependency failure is not rendered as an empty ledger', () => {
    const outcome = readSharedLedgerOutcome(caller(), {
      listForParent: () => { throw new Error('domain closed') },
    })

    // `[]` would mean "there is no work to duplicate" — the opposite of what
    // an unreadable ledger proves.
    expect(outcome).toEqual({ ok: false, reason: 'store-unreadable' })
    const text = ledgerReadUnavailableText('store-unreadable')
    expect(text).toContain('台账读取不可用')
    expect(text).toContain('store-unreadable')
    expect(text).not.toBe('[]')
    expect(text).toContain('这不代表"没有待办"')
    // Actionable: a retry path and the tool that does not depend on this read.
    expect(text).toContain('重试')
    expect(text).toContain('pet_locus_track')
  })

  it('keeps "available but empty" distinguishable from "unreadable"', () => {
    const empty = readSharedLedgerOutcome(caller(), { listForParent: () => [] })

    expect(empty).toEqual({ ok: true, items: [] })
    // Only the available-and-empty case may be presented as a list.
    expect(JSON.stringify(empty.ok ? empty.items : '')).toBe('[]')
  })

  it('names the missing wiring instead of implying an empty ledger', () => {
    for (const reason of ['caller-unresolvable', 'ledger-unwired'] as const) {
      const text = ledgerReadUnavailableText(reason)
      expect(text).toContain(reason)
      expect(text).toContain('不代表"没有待办"')
    }
  })
})
