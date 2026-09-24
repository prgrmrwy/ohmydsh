import { describe, expect, it, vi } from 'vitest'
import {
  asRetiredAssociationStore,
  classifyEndpointRetirement,
  renderRetiredEndpointReceipt,
} from '../src/host/locus/retirement.js'

const ENDPOINT = { chatId: 'oc-old' } as const
const TOPIC = { chatId: 'oc-old', threadId: 'omt-old' } as const

describe('retired association classification', () => {
  it('allows establishing a locus for a genuinely unknown endpoint', () => {
    const store = { find: vi.fn(() => undefined) }

    expect(classifyEndpointRetirement(ENDPOINT, store)).toEqual({ kind: 'unknown' })
  })

  it('treats an absent retired store as nothing to take over', () => {
    expect(classifyEndpointRetirement(ENDPOINT, undefined)).toEqual({ kind: 'unknown' })
  })

  it('refuses a retired endpoint and explains what the owner must do', () => {
    const store = { find: () => ({ endpoint: ENDPOINT, form: 'qa' as const }) }

    const state = classifyEndpointRetirement(ENDPOINT, store)

    // Reporting this as `unknown` would silently take over an old group under
    // a brand-new identity; reporting it as a plain error would leave the
    // owner without the one instruction that resolves it.
    expect(state).toMatchObject({ kind: 'retired', form: 'qa' })
    expect(state.kind === 'retired' && state.receipt).toContain('重新建立')
  })

  it('fails closed when the retired store cannot be consulted', () => {
    const store = { find: () => { throw new Error('legacy table unreadable') } }

    const state = classifyEndpointRetirement(ENDPOINT, store)

    // "Cannot prove" must not become "may be taken over".
    expect(state.kind).toBe('unproven')
    expect(state.kind === 'unproven' && state.diagnostic).toContain('legacy table unreadable')
  })

  it('rejects a store answer about a different endpoint', () => {
    const store = { find: () => ({ endpoint: { chatId: 'oc-other' }, form: 'chat' as const }) }

    expect(classifyEndpointRetirement(ENDPOINT, store).kind).toBe('unproven')
  })

  it('keeps the receipt free of any identifier outside this endpoint', () => {
    const receipt = renderRetiredEndpointReceipt()

    // A group receipt must not disclose session ids, workspaces, or other
    // groups. It also has to state that history is preserved, so a breaking
    // upgrade is not mistaken for deletion.
    expect(receipt).not.toMatch(/session|workspace|oc[-_]|ou[-_]/i)
    expect(receipt).toContain('保留')
  })
})

describe('legacy rows are read as history only', () => {
  /** A repository double holding legacy chat bindings. */
  function repository(rows: readonly Record<string, unknown>[]) {
    return { listChatBindings: () => rows as never }
  }

  it('matches a legacy chat binding and reports its coarse form', () => {
    const store = asRetiredAssociationStore(repository([
      { chatId: 'oc-old', kind: 'qa', workspaceId: 'ws-legacy', qaChildSessionId: 'child-legacy' },
    ]))

    const found = store.find(ENDPOINT)

    // Only the endpoint and the form are projected: exposing the legacy
    // workspace or child would let a caller restore an old execution identity.
    expect(found).toEqual({ endpoint: { chatId: 'oc-old' }, form: 'qa' })
    expect(found).not.toHaveProperty('workspaceId')
    expect(found).not.toHaveProperty('qaChildSessionId')
  })

  it('keeps chat-level and topic-level legacy rows distinct', () => {
    const store = asRetiredAssociationStore(repository([
      { chatId: 'oc-old', threadId: 'omt-old', kind: 'chat' },
    ]))

    expect(store.find(TOPIC)).toEqual({ endpoint: TOPIC, form: 'chat' })
    // The chat-level endpoint is a different entry and was never bound.
    expect(store.find(ENDPOINT)).toBeUndefined()
  })

  it('defaults an unrecognised legacy kind to the chat form', () => {
    const store = asRetiredAssociationStore(repository([{ chatId: 'oc-old', kind: 'something-new' }]))

    expect(store.find(ENDPOINT)?.form).toBe('chat')
  })

  it('skips malformed historical rows instead of failing the lookup', () => {
    const store = asRetiredAssociationStore(repository([
      { chatId: '' },
      { chatId: '   ' },
      { threadId: 'omt-orphan' },
      { chatId: 'oc-old', kind: 'qa' },
    ]))

    // A row that cannot describe an endpoint also cannot be taken over, so
    // skipping it is safe; the valid row must still be found.
    expect(store.find(ENDPOINT)).toEqual({ endpoint: { chatId: 'oc-old' }, form: 'qa' })
  })

  it('classifies a real legacy row as retired end to end', () => {
    const store = asRetiredAssociationStore(repository([{ chatId: 'oc-old', kind: 'qa' }]))

    expect(classifyEndpointRetirement(ENDPOINT, store)).toMatchObject({
      kind: 'retired',
      form: 'qa',
    })
  })
})
