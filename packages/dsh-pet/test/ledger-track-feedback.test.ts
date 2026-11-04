/**
 * `pet-locus-intent-triage` — 待办登记后的回复如实且登记失败反馈可执行.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { INTENT_TRIAGE_GUIDANCE } from '../src/host/ledger/prompt.js'
import { LedgerStoreError } from '../src/host/ledger/store.js'
import { trackFailureText, type TrackFailureReason } from '../src/host/ledger/track.js'
import { LOCUS_CONTEXT_TOOL, PET_LOCUS_TRACK_TOOL, registerPetTools } from '../src/host/tools.js'
import { authorizedFor, openTodoWorld, type TestLocusRow, type TodoWorld } from './support/collab-todo.js'

const M = 'locus-main-f'
const W = 'work-f'
const row: TestLocusRow = {
  id: 'rec-f', generation: 1, endpoint: { chatId: 'oc-feedback' }, locusMainSessionId: M, childSessionId: 'child-f', state: 'active',
}

let todo: TodoWorld | undefined
afterEach(async () => { await todo?.world.stop(); todo = undefined })

const REASONS: readonly TrackFailureReason[] = [
  'no-current-delivery', 'invalid-evidence', 'collab-unavailable', 'space-not-ready', 'store-error', 'track-unwired',
]

describe('待办登记后的回复如实且登记失败反馈可执行', () => {
  it('登记后回复与待办状态一致', () => {
    // The child's contract: the reply follows the todo's DURABLE state, never "started".
    for (const phrase of [
      'must match that todo\'s DURABLE state',
      'NOT STARTED',
      'Never say the work has begun, is in progress, or will finish soon',
      'never claim it is done',
    ]) expect(INTENT_TRIAGE_GUIDANCE).toContain(phrase)
    // The retired request-execution path can no longer be offered as a way to start the work.
    expect(INTENT_TRIAGE_GUIDANCE).not.toContain('pet_locus_request_execution')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('only the owner or the work main session can start')
  })

  it('未确认路径不作为事实', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('present it as a guess and ask the requester or owner to confirm it')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('never state an unconfirmed location as the place the work will happen')
  })

  it('登记失败给出操作特定指引', async () => {
    const texts = REASONS.map(trackFailureText)
    expect(new Set(texts).size).toBe(REASONS.length)
    for (const text of texts) {
      expect(text).toMatch(/重试|先|如实|不要/)
      expect(text).not.toMatch(/todo-|locus-[0-9a-f]{8}|rec-|session/)
    }
    // Through the real tool: a store failure surfaces as that reason, rendered with its own guidance.
    const registered = new Map<string, any>()
    registerPetTools({ tools: { register: (definition: any) => { registered.set(definition.name, definition); return () => {} } } } as never, {
      repository: {} as never,
      intentTriage: {
        loci: { findByChildSessionId: () => [] },
        inspectCurrentCapability: () => ({ ok: true, capability: { deliveryId: 'delivery-om-rec-f', executionId: 'x', turnId: 't', source: 'delivery' } }),
        inspectCurrentDeliveryAuthorization: async () => ({ ok: true, locus: authorizedFor(row) }),
        track: {
          store: { registerTodoItem: async () => { throw new LedgerStoreError('SPACE_NOT_READY') } } as never,
          now: () => 1, newItemId: () => 'todo-x',
        },
      },
    } as never)
    const tool = registered.get(PET_LOCUS_TRACK_TOOL)
    const output = await tool.execute({ summary: 's', detail: 'd' }, { agent: { id: row.childSessionId } })
    expect(output).toEqual({ ok: false, reason: 'space-not-ready' })
    expect(tool.output.render({}, output)[0].text).toBe(trackFailureText('space-not-ready'))
  })

  it('待办进度不可读与没有待办可区分', async () => {
    todo = await openTodoWorld()
    await todo.addMain({ locusMainSessionId: M, workSessionId: W })
    todo.addLocus(row)
    const t = todo
    const registered = new Map<string, any>()
    registerPetTools({ tools: { register: (definition: any) => { registered.set(definition.name, definition); return () => {} } } } as never, {
      repository: {} as never,
      locusChildTools: {
        loci: { findByChildSessionId: id => t.loci.filter(item => item.childSessionId === id).map(item => ({ ...item, parentSessionId: item.locusMainSessionId, workspaceId: 'ws' })) as never },
        collab: t.collab,
        subagents: () => undefined,
      },
    } as never)
    const tool = registered.get(LOCUS_CONTEXT_TOOL)
    const exec = { agent: { id: row.childSessionId } }

    const none = await tool.execute({}, exec)
    expect(none).toMatchObject({ ok: true, todos: [] })

    t.collab.currentHandle()!.dispose()
    const unreadable = await tool.execute({}, exec)
    expect(unreadable).toEqual({ ok: false, reason: 'collab-unavailable' })

    const noneText = tool.output.render({}, none)[0].text as string
    const unreadableText = tool.output.render({}, unreadable)[0].text as string
    expect(noneText).toContain('（没有）')
    expect(unreadableText).not.toContain('（没有）')
    expect(unreadableText).toMatch(/不可用/)
    expect(unreadableText).toMatch(/这不是"没有/)
  })
})
