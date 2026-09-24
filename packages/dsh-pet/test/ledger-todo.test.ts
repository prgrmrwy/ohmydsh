import { describe, expect, it } from 'vitest'
import {
  TODO_LIMITS,
  advanceTodoStatus,
  isTodoTerminal,
  registerTodo,
  type NewTodoInput,
} from '../src/host/ledger/todo.js'

function validInput(overrides: Partial<NewTodoInput> = {}): NewTodoInput {
  return {
    itemId: 'todo-1',
    parentSessionId: 'main-1',
    locusId: 'locus-1',
    generation: 2,
    endpoint: { chatId: 'oc-project' },
    triggerMessageId: 'om_abc',
    requestedBy: 'ou_requester',
    evidence: { summary: '按钮点击无反应', detail: '定位到 handler 未绑定；建议在 X 文件 Y 行补上事件监听' },
    createdAt: 1_000,
    ...overrides,
  }
}

describe('registerTodo (pure value model)', () => {
  it('accepts a well-formed registration and defaults status to open', () => {
    const result = registerTodo(validInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.status).toBe('open')
    expect(result.record.statusChangedAt).toBe(1_000)
    expect(result.record.kind).toBe('todo')
  })

  it('carries locusId and generation as separate facts — generation is audit-only, not addressing (design D6)', () => {
    const result = registerTodo(validInput({ locusId: 'locus-9', generation: 3 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.locusId).toBe('locus-9')
    expect(result.record.generation).toBe(3)
    // The record type itself has no field that derives addressing from
    // `generation` — this is a structural guarantee, not just a convention:
    // any future addressing code must go through `locusId` + `endpoint`.
  })

  it('preserves threadId when present and omits it when absent (spec: endpoint = (chatId, threadId?))', () => {
    const withThread = registerTodo(validInput({ endpoint: { chatId: 'oc-x', threadId: 'omt-y' } }))
    expect(withThread.ok).toBe(true)
    if (withThread.ok) expect(withThread.record.endpoint).toEqual({ chatId: 'oc-x', threadId: 'omt-y' })

    const withoutThread = registerTodo(validInput({ endpoint: { chatId: 'oc-x' } }))
    expect(withoutThread.ok).toBe(true)
    if (withoutThread.ok) expect(withoutThread.record.endpoint).toEqual({ chatId: 'oc-x' })
  })

  it('trims identifiers rather than rejecting surrounding whitespace', () => {
    const result = registerTodo(validInput({ locusId: '  locus-1  ', requestedBy: '  ou_x  ' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.locusId).toBe('locus-1')
    expect(result.record.requestedBy).toBe('ou_x')
  })

  it.each([
    ['itemId', { itemId: '' }, 'invalid-item-id'],
    ['itemId', { itemId: '   ' }, 'invalid-item-id'],
    ['parentSessionId', { parentSessionId: '' }, 'invalid-parent-session-id'],
    ['locusId', { locusId: '' }, 'invalid-locus-id'],
    ['generation', { generation: 0 }, 'invalid-generation'],
    ['generation', { generation: -1 }, 'invalid-generation'],
    ['generation', { generation: 1.5 }, 'invalid-generation'],
    ['endpoint.chatId', { endpoint: { chatId: '' } }, 'invalid-endpoint'],
    ['endpoint.threadId', { endpoint: { chatId: 'oc-x', threadId: '' } }, 'invalid-endpoint'],
    ['triggerMessageId', { triggerMessageId: '' }, 'invalid-trigger-message-id'],
    ['requestedBy', { requestedBy: '' }, 'invalid-requested-by'],
    ['evidence.summary', { evidence: { summary: '', detail: 'x' } }, 'invalid-evidence-summary'],
  ] as const)('rejects invalid %s with reason %s', (_field, overrides, expectedReason) => {
    const result = registerTodo(validInput(overrides as Partial<NewTodoInput>))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(expectedReason)
  })

  it('rejects an evidence summary over the length bound', () => {
    const result = registerTodo(validInput({
      evidence: { summary: 'x'.repeat(TODO_LIMITS.summaryLength + 1), detail: 'y' },
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-evidence-summary')
  })

  it('rejects an evidence detail over the length bound', () => {
    const result = registerTodo(validInput({
      evidence: { summary: 'ok', detail: 'x'.repeat(TODO_LIMITS.evidenceLength + 1) },
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-evidence-detail')
  })

  it('allows an EMPTY evidence detail (only summary is required to be non-empty)', () => {
    const result = registerTodo(validInput({ evidence: { summary: 'ok', detail: '' } }))
    expect(result.ok).toBe(true)
  })
})

describe('advanceTodoStatus (owner-sourced transitions only — spec: 模型不能改写)', () => {
  const openRecord = () => {
    const result = registerTodo(validInput())
    if (!result.ok) throw new Error('fixture setup failed')
    return result.record
  }

  it('open -> accepted is legal', () => {
    const advance = advanceTodoStatus(openRecord(), 'accepted', 2_000)
    expect(advance.ok).toBe(true)
    if (advance.ok) {
      expect(advance.record.status).toBe('accepted')
      expect(advance.record.statusChangedAt).toBe(2_000)
    }
  })

  it('open -> done is legal (direct completion without an intermediate accepted state)', () => {
    const advance = advanceTodoStatus(openRecord(), 'done', 2_000)
    expect(advance.ok).toBe(true)
    if (advance.ok) expect(advance.record.status).toBe('done')
  })

  it('open -> dropped is legal', () => {
    const advance = advanceTodoStatus(openRecord(), 'dropped', 2_000)
    expect(advance.ok).toBe(true)
  })

  it('accepted -> done is legal', () => {
    const accepted = advanceTodoStatus(openRecord(), 'accepted', 1_500)
    if (!accepted.ok) throw new Error('fixture setup failed')
    const done = advanceTodoStatus(accepted.record, 'done', 2_000)
    expect(done.ok).toBe(true)
  })

  it('terminal states (done, dropped) reject ANY further transition — spec Scenario "模型不能改写待办状态" generalizes to owners too: terminal means terminal', () => {
    const done = advanceTodoStatus(openRecord(), 'done', 2_000)
    if (!done.ok) throw new Error('fixture setup failed')
    for (const to of ['open', 'accepted', 'done', 'dropped'] as const) {
      const attempt = advanceTodoStatus(done.record, to, 3_000)
      expect(attempt.ok).toBe(false)
      if (!attempt.ok) expect(attempt.reason).toBe('already-terminal')
    }
  })

  it('dropped is equally terminal', () => {
    const dropped = advanceTodoStatus(openRecord(), 'dropped', 2_000)
    if (!dropped.ok) throw new Error('fixture setup failed')
    const attempt = advanceTodoStatus(dropped.record, 'done', 3_000)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.reason).toBe('already-terminal')
  })

  it('open -> open is rejected as an invalid transition (not a no-op success)', () => {
    const attempt = advanceTodoStatus(openRecord(), 'open', 2_000)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.reason).toBe('invalid-transition')
  })

  it('isTodoTerminal correctly classifies every status', () => {
    expect(isTodoTerminal('open')).toBe(false)
    expect(isTodoTerminal('accepted')).toBe(false)
    expect(isTodoTerminal('done')).toBe(true)
    expect(isTodoTerminal('dropped')).toBe(true)
  })
})
