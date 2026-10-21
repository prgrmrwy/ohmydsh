import { describe, expect, it, vi } from 'vitest'
import { createInquiryRuntime, type InquiryAgent, type InquiryPreStep } from '../src/host/inquiry/runtime.js'
import type { InquiryScope } from '../src/host/inquiry/ledger.js'
import type { InquiryHandoff } from '../src/host/inquiry/handoff-store.js'

const scope: InquiryScope = { kind: 'main', sessionId: 's' }
let agentsBySession: Map<string, Agent>
function handoff(messageId: string, id = messageId): InquiryHandoff {
  return { protocolVersion: 1, inquiryId: id, phase: 'target', scope, generation: 0, messageId, work: { kind: 'local', sessionId: 's', workId: 'root' }, parentInquiryId: null, createdAt: 1, claimTurn: null, claimAt: null, state: 'intent' }
}
function inquiry(id: string, createdAt: number) { return { id, requester: scope, target: scope, origin: { kind: 'local' as const }, audience: { kind: 'unknown' as const }, trace: { rootInquiryId: id, depth: 1, visited: [scope] }, createdAt, status: 'queued', statusAt: createdAt, question: `intent-${id}`, appliedEventIds: [], diagnostics: [], droppedDiagnostics: 0 } as never }
class Agent implements InquiryAgent {
  session = { id: 's' }; occupiesRunSlot = false; inbox = { nextTurn: [] as {id:string}[], nextStep: [] as {id:string}[] }
  listeners = new Map<string, Function>(); followups: unknown[] = []
  followup(message: unknown) { this.followups.push(message); this.inbox.nextTurn.push({ id: (message as { id: string }).id }) }
  on(event: 'agent/pre-step'|'agent/turn-end', listener: Function) { this.listeners.set(event, listener) }
  async step(payload: InquiryPreStep, next: () => Promise<unknown>) { return await (this.listeners.get('agent/pre-step') as Function)(payload, next) }
  async end(turn: number) { await (this.listeners.get('agent/turn-end') as Function)({ turn }) }
}
function harness(rows = [inquiry('i1', 1)], liveScope: () => InquiryScope = () => scope) {
  const agent = new Agent(), sent: unknown[] = [], claimed: string[] = [], byMessage = new Map<string, InquiryHandoff>()
  for (const row of rows) byMessage.set(`m-${row.id}`, handoff(`m-${row.id}`, row.id))
  const records = new Map<string, ReturnType<typeof inquiry>>(rows.map(row => [row.id, row]))
  const deps = {
    ledger: { listPending: () => rows, get: (id: string) => records.get(id) }, answers: { get: vi.fn() }, handoffs: { get: (id: string, phase: string) => phase === 'target' ? [...byMessage.values()].find(h => h.inquiryId === id) : undefined,
      findByMessageId: (id: string) => byMessage.get(id), claim: async (_s: InquiryScope, id: string) => { claimed.push(id); return byMessage.get(id)! } },
    outbox: { listPending: () => [] }, works: { get: () => ({ sessionId: 's', workId: 'root', scopeGeneration: 0, rootClaimTurn: 1, state: 'active', openInquiryIds: [], continuationTurn: null }) },
    resolveAgent: async () => agent, currentScope: liveScope, readiness: () => true, now: () => 10, newMessageId: () => 'unused', createMessage: (m: unknown) => { sent.push(m); return m },
  } as never
  return { runtime: createInquiryRuntime(deps), agent, sent, claimed, byMessage, deps }
}

describe('inquiry consumer runtime', () => {
  it('pumps only oldest reserved target and singleflights', async () => {
    const h = harness([inquiry('later', 2), inquiry('first', 1)])
    await h.runtime.pumpTarget('s')
    expect(h.sent).toEqual([{ id: 'm-first', content: 'intent-first', source: 'pet-inquiry' }])
    expect(h.agent.followups).toHaveLength(1)
    expect(h.agent.followups).toEqual(h.sent)
  })
  it('does not duplicate an already queued reserved message', async () => {
    const h = harness(); h.agent.inbox.nextTurn.push({ id: 'm-i1' })
    await h.runtime.pumpTarget('s'); expect(h.sent).toHaveLength(0)
  })
  it('awaits durable exact-message claim before downstream model callback', async () => {
    const h = harness(); let release!: () => void
    const delay = new Promise<void>(resolve => { release = resolve })
    const claim = h.deps.handoffs.claim as unknown as (...args: unknown[]) => Promise<unknown>
    ;(h.deps.handoffs as never as { claim: Function }).claim = async (...args: unknown[]) => { await delay; return claim(...args) }
    await h.runtime.pumpTarget('s')
    let advanced = false
    const step = h.agent.step({ messages: [{ id: 'm-i1' }], turn: 3, step: 1 }, async () => { advanced = true })
    await Promise.resolve(); expect(advanced).toBe(false)
    release(); await step; expect(advanced).toBe(true); expect(h.claimed).toEqual(['m-i1'])
  })
  it('does not infer answer from turn end; only calls explicit unanswered hook', async () => {
    const h = harness(); const onUnanswered = vi.fn(async () => {})
    ;(h.deps.ledger as never as { get: (id: string) => unknown }).get = () => ({ ...inquiry('i1', 1), status: 'executing' })
    ;(h.deps as never as {onUnanswered: typeof onUnanswered}).onUnanswered = onUnanswered
    await h.runtime.pumpTarget('s')
    await h.agent.step({ messages: [{ id: 'm-i1' }], turn: 1, step: 1 }, async () => {})
    await h.agent.end(1)
    expect(onUnanswered).toHaveBeenCalledWith('i1', 1)
  })
  it('allows a busy current actor to durably claim its own handoff and exposes the receipt', async () => {
    const h = harness(); await h.runtime.pumpTarget('s'); h.agent.occupiesRunSlot = true
    await h.agent.step({ messages: [{ id: 'm-i1' }], turn: 7, step: 1 }, async () => {})
    expect(h.claimed).toEqual(['m-i1'])
    expect(h.runtime.segmentFor('s', 7)?.messageId).toBe('m-i1')
    await h.agent.end(7)
    expect(h.runtime.segmentFor('s', 7)).toBeUndefined()
  })
  it('answered target turn does not invoke unanswered and wakes requester session', async () => {
    const h = harness(); await h.runtime.pumpTarget('s')
    ;(h.deps.ledger as never as { get: (id: string) => unknown }).get = () => ({ ...inquiry('i1', 1), requester: { kind: 'main', sessionId: 'requester' }, status: 'answered' })
    const unanswered = vi.fn(async () => {}); const requester = new Agent(); requester.session.id = 'requester'
    ;(h.deps as never as { resolveAgent: (requested: InquiryScope) => Promise<Agent> }).resolveAgent = async requested => requested.sessionId === 'requester' ? requester : h.agent
    ;(h.deps as never as { onUnanswered: typeof unanswered }).onUnanswered = unanswered
    const listPending = vi.fn(() => [])
    ;(h.deps as never as { outbox: { listPending: typeof listPending } }).outbox = { listPending }
    ;(h.deps as never as { currentScope: (sessionId: string) => InquiryScope }).currentScope = id => ({ kind: 'main', sessionId: id })
    await h.agent.step({ messages: [{ id: 'm-i1' }], turn: 11, step: 1 }, async () => {})
    await h.agent.end(11)
    expect(unanswered).not.toHaveBeenCalled()
    expect(listPending).toHaveBeenCalledWith('requester')
    expect(requester.followups).toHaveLength(0)
  })
  it('ordinary turn-end wakes a queued target after the agent becomes idle', async () => {
    const h = harness(); h.agent.occupiesRunSlot = true
    await h.runtime.pumpTarget('s')
    expect(h.sent).toHaveLength(0)
    h.runtime.install(h.agent, scope)
    h.agent.occupiesRunSlot = false
    await h.agent.end(99)
    expect(h.agent.followups).toHaveLength(1)
    expect((h.agent.followups[0] as {id:string}).id).toBe('m-i1')
  })
  it('resumes a local result using the original target handoff work, not local origin fields', async () => {
    const h = harness()
    const outboxRow = { inquiryId: 'i1', requester: scope, resumeWork: { kind: 'local' }, result: { kind: 'failure', failure: 'unavailable', reason: 'target-unavailable', failedAt: 9 }, dedupKey: 'd', status: 'pending', createdAt: 1 }
    const resultHandoff: InquiryHandoff = { ...handoff('result-i1', 'i1'), phase: 'result' }
    const targetHandoff: InquiryHandoff = handoff('m-i1', 'i1')
    const work = { sessionId: 's', workId: 'root', scopeGeneration: 0, rootClaimTurn: 1, state: 'active', openInquiryIds: ['i1'], continuationTurn: null }
    ;(h.deps.ledger as never as { get: (id: string) => unknown }).get = id => id === 'i1' ? { ...inquiry('i1', 1), requester: scope } : undefined
    ;(h.deps.works as never as { get: () => unknown }).get = () => work
    ;(h.deps as never as { outbox: { listPending: () => unknown[] } }).outbox = { listPending: () => [outboxRow] }
    let reserved: InquiryHandoff | undefined
    const prepareResult = vi.fn(async () => { reserved = resultHandoff; return reserved })
    ;(h.deps as never as { prepareResult: typeof prepareResult }).prepareResult = prepareResult
    ;(h.deps.handoffs as never as { get: (id: string, phase: string) => unknown }).get = (_id, phase) => phase === 'target' ? targetHandoff : reserved
    ;(h.deps as never as { resultMessage: Function }).resultMessage = (_row: unknown, _answer: unknown, stored: InquiryHandoff) => ({ id: stored.messageId, content: 'failure notice', source: 'pet-inquiry-result' })

    await h.runtime.pumpResults('s')
    expect(h.agent.followups).toEqual([{ id: 'result-i1', content: 'failure notice', source: 'pet-inquiry-result' }])
  })
  it('does not resume a local result when the original root work is settled or foreign', async () => {
    for (const work of [
      { sessionId: 's', workId: 'root', state: 'settled', openInquiryIds: ['i1'] },
      { sessionId: 'foreign', workId: 'root', state: 'active', openInquiryIds: ['i1'] },
    ]) {
      const h = harness()
      const outboxRow = { inquiryId: 'i1', requester: scope, resumeWork: { kind: 'local' }, result: { kind: 'failure', failure: 'unavailable', reason: 'target-unavailable', failedAt: 9 }, dedupKey: 'd', status: 'pending', createdAt: 1 }
      const resultHandoff: InquiryHandoff = { ...handoff('result-i1', 'i1'), phase: 'result' }
      ;(h.deps.ledger as never as { get: (id: string) => unknown }).get = id => id === 'i1' ? { ...inquiry('i1', 1), requester: scope } : undefined
      ;(h.deps.works as never as { get: () => unknown }).get = () => work
      ;(h.deps as never as { outbox: { listPending: () => unknown[] } }).outbox = { listPending: () => [outboxRow] }
      let reserved: InquiryHandoff | undefined
      ;(h.deps as never as { prepareResult: Function }).prepareResult = async () => { reserved = resultHandoff; return reserved }
      ;(h.deps.handoffs as never as { get: (id: string, phase: string) => unknown }).get = (_id, phase) => phase === 'target' ? h.byMessage.get('m-i1') : reserved
      ;(h.deps as never as { resultMessage: Function }).resultMessage = () => ({ id: 'result-i1' })
      await h.runtime.pumpResults('s')
      expect(h.agent.followups).toHaveLength(0)
    }
  })
  it('does not reserve a result while requester agent occupies its run slot', async () => {
    const h = harness(); h.agent.occupiesRunSlot = true
    const prepareResult = vi.fn(async () => undefined)
    ;(h.deps as never as { prepareResult: typeof prepareResult }).prepareResult = prepareResult
    ;(h.deps as never as { resultMessage: Function }).resultMessage = () => ({ id: 'result', content: 'answer', source: 'pet-inquiry' })
    ;(h.deps as never as { outbox: { listPending: () => unknown[] } }).outbox = { listPending: () => [{ inquiryId: 'i1', requester: scope, resumeWork: {kind:'local'}, result: {kind:'answer'}, dedupKey:'d', status:'pending', createdAt:1 }] }
    ;(h.deps.answers as never as { get: () => unknown }).get = () => ({ inquiryId: 'i1' })
    await h.runtime.pumpResults('s')
    expect(prepareResult).not.toHaveBeenCalled()
  })
  it('delivers a failure result without inventing an answer, after exact durable reservation', async () => {
    const h = harness()
    ;(h.deps.ledger as never as { get: (id: string) => unknown }).get = () => ({ ...inquiry('i1', 1), circleParentSessionId: 's', purpose: 'test', reason: 'target-unavailable' })
    const outboxRow = { inquiryId: 'i1', requester: scope, resumeWork: { kind: 'local' }, result: { kind: 'failure', failure: 'unavailable', reason: 'target-unavailable', failedAt: 9 }, dedupKey: 'd', status: 'pending', createdAt: 1, statusAt: 1, deliveredSegmentId: null, appliedEventIds: [], diagnostics: [], droppedDiagnostics: 0 }
    const resultHandoff: InquiryHandoff = { ...handoff('result-i1', 'i1'), phase: 'result', scope: scope }
    ;(h.deps.works as never as { get: () => unknown }).get = () => ({ sessionId: 's', workId: 'root', scopeGeneration: 0, rootClaimTurn: 1, state: 'active', openInquiryIds: ['i1'], continuationTurn: null })
    const targetHandoff: InquiryHandoff = { ...handoff('m-i1', 'i1'), work: { kind: 'local', sessionId: 's', workId: 'root' } }
    ;(h.deps as never as { outbox: { listPending: () => unknown[] } }).outbox = { listPending: () => [outboxRow] }
    const prepareResult = vi.fn(async () => { reserved = resultHandoff; return reserved })
    ;(h.deps as never as { prepareResult: typeof prepareResult }).prepareResult = prepareResult
    let reserved: InquiryHandoff | undefined
    ;(h.deps.handoffs as never as { get: (id: string, phase: string) => unknown }).get = (_id, phase) => phase === 'target' ? targetHandoff : reserved
    const resultMessage = vi.fn((_row: unknown, answer: unknown, stored: InquiryHandoff) => ({ id: stored.messageId, content: answer ? 'fabricated' : 'failure notice', source: 'pet-inquiry-result' }))
    ;(h.deps as never as { resultMessage: typeof resultMessage }).resultMessage = resultMessage
    await h.runtime.pumpResults('s')
    expect(prepareResult).toHaveBeenCalledWith(outboxRow, undefined)
    expect(resultMessage).toHaveBeenCalledWith(outboxRow, undefined, resultHandoff)
    expect(h.agent.followups).toEqual([{ id: 'result-i1', content: 'failure notice', source: 'pet-inquiry-result' }])
  })
  it('retries a result pump requested while the shared session pump is busy', async () => {
    const h = harness()
    const outboxRow = { inquiryId: 'i1', requester: scope, resumeWork: { kind: 'local' }, result: { kind: 'failure', failure: 'unavailable', reason: 'no-answer', failedAt: 9 }, dedupKey: 'd', status: 'pending', createdAt: 1 }
    ;(h.deps.works as never as { get: () => unknown }).get = () => ({ sessionId: 's', workId: 'root', scopeGeneration: 0, rootClaimTurn: 1, state: 'active', openInquiryIds: ['i1'], continuationTurn: null })
    const resultHandoff: InquiryHandoff = { ...handoff('result-i1', 'i1'), phase: 'result' }
    ;(h.deps as never as { outbox: { listPending: () => unknown[] } }).outbox = { listPending: () => [outboxRow] }
    ;(h.deps as never as { prepareResult: Function }).prepareResult = async () => resultHandoff
    ;(h.deps.handoffs as never as { get: (id: string, phase: string) => unknown }).get = (_id, phase) => phase === 'target' ? h.byMessage.get('m-i1') : resultHandoff
    ;(h.deps as never as { resultMessage: Function }).resultMessage = () => ({ id: 'result-i1', content: 'failure', source: 'pet-inquiry' })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const original = (h.deps.resolveAgent as Function)
    ;(h.deps as never as { resolveAgent: Function }).resolveAgent = async (...args: unknown[]) => { await gate; return original(...args) }
    const targetPump = h.runtime.pumpTarget('s')
    await Promise.resolve()
    const resultPump = h.runtime.pumpResults('s')
    release()
    await Promise.all([targetPump, resultPump])
    expect(h.agent.followups).toHaveLength(2)
    expect(h.agent.followups.map((item: any) => item.id)).toContain('result-i1')
  })
  it('does not close the root work for a nested local result owned by another session', async () => {
    const h = harness()
    const other = new Agent(); other.session.id = 'actor-b'
    const actorScope: InquiryScope = { kind: 'main', sessionId: 'actor-b' }
    const nested: InquiryHandoff = { ...handoff('nested-result', 'nested'), phase: 'result', scope: actorScope, work: { kind: 'local', sessionId: 'owner-a', workId: 'root' } }
    const close = vi.fn(async () => {})
    ;(h.deps as never as { onLocalWorkTurnEnd: typeof close }).onLocalWorkTurnEnd = close
    h.runtime.install(other, actorScope)
    ;(h.deps as never as { currentScope: (sessionId: string) => InquiryScope }).currentScope = id => id === 'actor-b' ? actorScope : scope
    ;(h.deps.handoffs as never as { findByMessageId: (id: string) => unknown }).findByMessageId = id => id === 'nested-result' ? nested : h.byMessage.get(id)
    ;(h.deps.handoffs as never as { claim: (scope: InquiryScope, id: string) => Promise<unknown> }).claim = async (_scope, id) => id === 'nested-result' ? { ...nested, state: 'claimed', claimTurn: 22, claimAt: 10 } : h.byMessage.get(id)
    await other.step({ messages: [{ id: 'nested-result' }], turn: 22, step: 1 }, async () => {})
    expect(h.runtime.segmentFor('actor-b', 22)?.inquiryId).toBe('nested')
    await other.end(22)
    expect(close).not.toHaveBeenCalled()
  })
  it('accepts an answer only when its timestamp matches the pending result', async () => {
    const h = harness()
    const outboxRow = { inquiryId: 'i1', requester: scope, resumeWork: { kind: 'local' }, result: { kind: 'answer', answeredAt: 12 }, dedupKey: 'd', status: 'pending', createdAt: 1 }
    const resultHandoff: InquiryHandoff = { ...handoff('result-i1', 'i1'), phase: 'result' }
    ;(h.deps as never as { outbox: { listPending: () => unknown[] } }).outbox = { listPending: () => [outboxRow] }
    ;(h.deps.answers as never as { get: () => unknown }).get = () => ({ inquiryId: 'i1', answeredAt: 11, answer: 'stale' })
    const prepareResult = vi.fn(async () => resultHandoff)
    ;(h.deps as never as { prepareResult: typeof prepareResult }).prepareResult = prepareResult
    ;(h.deps.handoffs as never as { get: (id: string, phase: string) => unknown }).get = (_id, phase) => phase === 'target' ? h.byMessage.get('m-i1') : resultHandoff
    ;(h.deps as never as { resultMessage: Function }).resultMessage = () => ({ id: 'result-i1', content: 'answer', source: 'pet-inquiry' })
    await h.runtime.pumpResults('s')
    expect(prepareResult).not.toHaveBeenCalled()
    expect(h.agent.followups).toHaveLength(0)
  })
  it('routes a nested result to its immediate requester while validating the root work ancestry', async () => {
    const h = harness()
    const actorA: InquiryScope = { kind: 'main', sessionId: 'actor-a' }
    const actorB: InquiryScope = { kind: 'main', sessionId: 'actor-b' }
    const actorC: InquiryScope = { kind: 'main', sessionId: 'actor-c' }
    const work = { kind: 'local' as const, sessionId: 'actor-a', workId: 'root-work' }
    const root = { ...inquiry('root', 1), requester: actorA, target: actorB, origin: { kind: 'local' }, trace: { rootInquiryId: 'root', depth: 1, visited: [actorA, actorB] }, status: 'executing' }
    const middle = { ...inquiry('middle', 2), requester: actorB, target: actorC, origin: { kind: 'inquiry', parentInquiryId: 'root' }, trace: { rootInquiryId: 'root', depth: 2, visited: [actorA, actorB, actorC] }, status: 'executing' }
    const child = { ...inquiry('child', 3), requester: actorB, target: actorC, origin: { kind: 'inquiry', parentInquiryId: 'root' }, trace: { rootInquiryId: 'root', depth: 2, visited: [actorA, actorB, actorC] }, status: 'unavailable' }
    const records = new Map([['root', root], ['middle', middle], ['child', child]])
    const targetRoot: InquiryHandoff = { ...handoff('root-msg', 'root'), scope: actorB, work, state: 'claimed', claimTurn: 1, claimAt: 2 }
    const targetMiddle: InquiryHandoff = { ...handoff('middle-msg', 'middle'), scope: actorC, work, parentInquiryId: 'root', state: 'claimed', claimTurn: 2, claimAt: 3 }
    const targetChild: InquiryHandoff = { ...handoff('child-msg', 'child'), scope: actorC, work, parentInquiryId: 'middle' }
    const result: InquiryHandoff = { ...targetChild, phase: 'result', scope: actorB, messageId: 'child-result', parentInquiryId: 'root' }
    let stored: InquiryHandoff | undefined
    const actor = new Agent(); actor.session.id = 'actor-b'
    const outboxRow = { inquiryId: 'child', requester: actorB, resumeWork: child.origin, result: { kind: 'failure', failure: 'unavailable', reason: 'target-unavailable', failedAt: 9 }, dedupKey: 'nested-result', status: 'pending', createdAt: 3 }
    const deps = h.deps as never as {
      ledger: { get: (id: string) => unknown }; handoffs: { get: (id: string, phase: string) => unknown }
      outbox: { listPending: (id: string) => unknown[] }; works: { get: () => unknown }
      currentScope: (id: string) => InquiryScope; resolveAgent: () => Promise<Agent>
      prepareResult: () => Promise<InquiryHandoff>; resultMessage: (_row: unknown, _answer: unknown, handoff: InquiryHandoff) => unknown
    }
    deps.ledger.get = id => records.get(id)
    deps.handoffs.get = (id, phase) => phase === 'result' ? stored : ({ root: targetRoot, middle: targetMiddle, child: targetChild } as Record<string, InquiryHandoff>)[id]
    deps.outbox.listPending = id => id === 'actor-b' ? [outboxRow] : []
    deps.works.get = () => ({ sessionId: 'actor-a', workId: 'root-work', scopeGeneration: 0, rootClaimTurn: 1, state: 'waiting', openInquiryIds: ['root', 'middle', 'child'], continuationTurn: null })
    deps.currentScope = id => ({ kind: 'main', sessionId: id })
    deps.resolveAgent = async () => actor
    deps.prepareResult = async () => { stored = result; return result }
    deps.resultMessage = (_row, _answer, handoff) => ({ id: handoff.messageId, content: 'nested result' })
    await h.runtime.pumpResults('actor-b')
    expect(actor.followups).toEqual([{ id: 'child-result', content: 'nested result' }])
  })

  it('refuses nested result routing when an ancestor handoff or work proof is corrupt', async () => {
    for (const corrupt of ['parent', 'root-work', 'branch'] as const) {
      const h = harness()
      const actorA: InquiryScope = { kind: 'main', sessionId: 'actor-a' }, actorB: InquiryScope = { kind: 'main', sessionId: 'actor-b' }, actorC: InquiryScope = { kind: 'main', sessionId: 'actor-c' }
      const work = { kind: 'local' as const, sessionId: 'actor-a', workId: 'root-work' }
      const rows = new Map<string, any>([
        ['root', { ...inquiry('root', 1), requester: actorA, target: actorB, origin: { kind: 'local' }, trace: { rootInquiryId: 'root', depth: 1, visited: [actorA, actorB] }, status: 'executing' }],
        ['middle', { ...inquiry('middle', 2), requester: actorB, target: actorC, origin: { kind: 'inquiry', parentInquiryId: 'root' }, trace: { rootInquiryId: 'root', depth: 2, visited: [actorA, actorB, actorC] }, status: 'executing' }],
        ['child', { ...inquiry('child', 3), requester: actorB, target: actorC, origin: { kind: 'inquiry', parentInquiryId: 'middle' }, trace: { rootInquiryId: 'root', depth: 3, visited: [actorA, actorB, actorC] }, status: 'unavailable' }],
      ])
      const handoffs: Record<string, InquiryHandoff> = {
        root: { ...handoff('root-msg', 'root'), scope: actorB, work, state: 'claimed', claimTurn: 1, claimAt: 2 },
        middle: { ...handoff('middle-msg', 'middle'), scope: actorC, work, parentInquiryId: 'root', state: 'claimed', claimTurn: 2, claimAt: 3 },
        child: { ...handoff('child-msg', 'child'), scope: actorC, work, parentInquiryId: 'middle' },
      }
      if (corrupt === 'parent') handoffs.middle = { ...handoffs.middle, parentInquiryId: null }
      const result: InquiryHandoff = { ...handoffs.child, phase: 'result', scope: actorB, messageId: 'child-result', parentInquiryId: 'root' }
      const actor = new Agent(); actor.session.id = 'actor-b'
      const row = { inquiryId: 'child', requester: actorB, resumeWork: rows.get('child')!.origin, result: { kind: 'failure', failure: 'unavailable', reason: 'target-unavailable', failedAt: 9 }, dedupKey: 'nested', status: 'pending', createdAt: 3 }
      let stored: InquiryHandoff | undefined
      const deps = h.deps as never as any
      deps.ledger.get = (id: string) => rows.get(id)
      deps.handoffs.get = (_id: string, phase: string) => phase === 'result' ? stored : handoffs[_id]
      deps.outbox.listPending = (id: string) => id === 'actor-b' ? [row] : []
      deps.works.get = () => ({ sessionId: 'actor-a', workId: 'root-work', scopeGeneration: 0, rootClaimTurn: 1, state: 'waiting', openInquiryIds: corrupt === 'branch' ? ['root'] : ['child'], continuationTurn: null })
      deps.currentScope = (id: string) => ({ kind: 'main', sessionId: id })
      deps.resolveAgent = async () => actor
      deps.prepareResult = async () => { stored = corrupt === 'root-work' ? { ...result, work: { kind: 'local', sessionId: 'actor-z', workId: 'foreign' } } : result; return stored }
      deps.resultMessage = () => ({ id: 'child-result' })
      await h.runtime.pumpResults('actor-b')
      expect(actor.followups).toHaveLength(0)
    }
  })

  it('refuses to claim a handoff when the live scope has changed', async () => {
    const h = harness()
    const targetScope: InquiryScope = { kind: 'child', sessionId: 's', locusId: 'old', generation: 1 }
    h.runtime.install(h.agent, scope)
    ;(h.deps as never as { currentScope: (sessionId: string) => InquiryScope }).currentScope = () => ({ kind: 'child', sessionId: 's', locusId: 'new', generation: 2 })
    await expect(h.agent.step({ messages: [{ id: 'm-i1' }], turn: 1, step: 1 }, async () => {})).rejects.toThrow('Inquiry handoff does not match the active scope')
    expect(h.claimed).toHaveLength(0)
  })
})
