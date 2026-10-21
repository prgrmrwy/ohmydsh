import type { InquiryRecord, InquiryScope } from './ledger.js'
import type { InquiryAnswerRecord } from './answer.js'
import type { InquiryHandoff, InquiryHandoffStore } from './handoff-store.js'
import type { InquiryOutboxRecord } from './outbox.js'
import type { InquiryOutboxStore } from './outbox-store.js'
import type { InquiryWork, InquiryWorkStore } from './work-store.js'

/** Minimal actual event surface supplied by the host's Agent instance. */
export interface InquiryAgent {
  readonly session: { readonly id: string }
  readonly occupiesRunSlot: boolean
  readonly inbox: { readonly nextTurn: readonly { readonly id: string }[]; readonly nextStep: readonly { readonly id: string }[] }
  followup(message: unknown): void
  on(event: 'agent/pre-step', listener: (payload: InquiryPreStep, next: () => Promise<unknown>) => Promise<unknown>): void
  on(event: 'agent/turn-end', listener: (payload: { readonly turn: number }) => void | Promise<void>): void
}
export interface InquiryPreStep { readonly messages: readonly { readonly id: string }[]; readonly turn: number; readonly step: number; readonly signal?: AbortSignal }
export interface InquiryMessage { readonly id: string; readonly content: string; readonly source: string }
export interface InquiryRuntimeDeps {
  readonly ledger: { listPending(sessionId: string): readonly InquiryRecord[]; get(id: string): InquiryRecord | undefined }
  readonly answers: { get(inquiryId: string): InquiryAnswerRecord | undefined }
  readonly handoffs: Pick<InquiryHandoffStore, 'get' | 'claim'> & { findByMessageId(messageId: string): InquiryHandoff | undefined }
  readonly outbox: InquiryOutboxStore | { listPending(requesterSessionId: string): readonly InquiryOutboxRecord[] }
  readonly works: InquiryWorkStore
  readonly resolveAgent: (scope: InquiryScope) => Promise<InquiryAgent | undefined>
  readonly currentScope: (sessionId: string) => InquiryScope | undefined
  readonly readiness: () => boolean
  readonly now: () => number
  readonly newMessageId: () => string
  readonly createMessage: (input: InquiryMessage) => unknown
  /** Host-specific final-answer handling is intentionally explicit; never infer from arbitrary assistant text. */
  readonly onUnanswered?: (inquiryId: string, turn: number) => Promise<void>
  /** Reserve the exact durable result handoff before its message can be sent. */
  readonly prepareResult?: (record: InquiryOutboxRecord, answer: InquiryAnswerRecord | undefined) => Promise<InquiryHandoff | undefined>
  /** Build the host message only after runtime validates the durable reservation. */
  readonly resultMessage?: (record: InquiryOutboxRecord, answer: InquiryAnswerRecord | undefined, handoff: InquiryHandoff) => InquiryMessage
  readonly onLocalWorkTurnEnd?: (work: InquiryWork, scope: InquiryScope, turn: number) => Promise<void>
}

/** Consumer-side event/pump module. Storage writes remain in their atomic store APIs. */
export function createInquiryRuntime(deps: InquiryRuntimeDeps) {
  const pumping = new Map<string, Promise<void>>()
  const pendingPump = new Map<string, Set<'target' | 'results'>>()
  const installed = new WeakSet<object>()
  const activeTurns = new WeakMap<object, Map<number, InquiryHandoff>>()
  const claimedTurns = new Map<string, InquiryHandoff>()
  const turnKey = (sessionId: string, turn: number) => `${sessionId}\u0000${turn}`

  async function pumpTarget(sessionId: string): Promise<void> {
    if (pumping.has(sessionId)) { requestPump(sessionId, 'target'); return pumping.get(sessionId) }
    if (!deps.readiness()) return
    const task = (async () => {
      for (const row of [...deps.ledger.listPending(sessionId)].filter(item => item.status === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
        const handoff = deps.handoffs.get(row.id, 'target')
        // Legacy accepted rows have no reserved handoff and must never auto-pump.
        if (!handoff || handoff.state !== 'intent' || handoff.scope.sessionId !== sessionId) continue
        const scope = deps.currentScope(sessionId)
        if (!scope || !sameScope(scope, row.target) || !sameScope(scope, handoff.scope)) continue
        const agent = await deps.resolveAgent(scope)
        if (!agent || agent.occupiesRunSlot || agent.session.id !== sessionId) continue
        install(agent, scope)
        if ([...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => message.id === handoff.messageId)) continue
        agent.followup(deps.createMessage({ id: handoff.messageId, content: row.question, source: 'pet-inquiry' }))
        break
      }
    })()
    pumping.set(sessionId, task)
    try { await task } finally {
      if (pumping.get(sessionId) === task) pumping.delete(sessionId)
      const pending = pendingPump.get(sessionId)
      if (pending?.size) {
        pendingPump.delete(sessionId)
        if (pending.has('results')) await pumpResults(sessionId)
        else if (pending.has('target')) await pumpTarget(sessionId)
      }
    }
  }

  function requestPump(sessionId: string, lane: 'target' | 'results'): void {
    const pending = pendingPump.get(sessionId) ?? new Set<'target' | 'results'>()
    pending.add(lane); pendingPump.set(sessionId, pending)
  }

  function install(agent: InquiryAgent, capturedScope: InquiryScope): void {
    if (installed.has(agent as object)) return
    installed.add(agent as object)
    agent.on('agent/pre-step', async (payload, next) => {
      const scope = deps.currentScope(agent.session.id)
      if (!scope || !sameScope(scope, capturedScope)) {
        const staleRecognized = payload.messages.map(message => deps.handoffs.findByMessageId(message.id)).filter((h): h is InquiryHandoff => !!h)
        if (staleRecognized.length) throw new Error('Inquiry handoff does not match the active scope')
        return next()
      }
      const recognized = payload.messages.map(message => deps.handoffs.findByMessageId(message.id)).filter((h): h is InquiryHandoff => !!h)
      const handoff = recognized.find(h => h.phase === 'target' || h.phase === 'result')
      if (!handoff) return next()
      if (recognized.length !== 1 || handoff.state !== 'intent' || !sameScope(handoff.scope, scope)) {
        throw new Error('Inquiry handoff does not match the active scope')
      }
      const claimAt = deps.now()
      // Await the durable claim before allowing the model step to proceed.
      const claimed = await deps.handoffs.claim(scope, handoff.messageId, payload.turn, claimAt)
      const turns = activeTurns.get(agent as object) ?? new Map<number, InquiryHandoff>()
      turns.set(payload.turn, claimed)
      activeTurns.set(agent as object, turns)
      claimedTurns.set(turnKey(agent.session.id, payload.turn), claimed)
      return next()
    })
    agent.on('agent/turn-end', async payload => {
      const handoff = activeTurns.get(agent as object)?.get(payload.turn)
      if (handoff) {
        activeTurns.get(agent as object)?.delete(payload.turn)
        claimedTurns.delete(turnKey(agent.session.id, payload.turn))
        const record = deps.ledger.get(handoff.inquiryId)
        if (handoff.phase === 'target' && record?.status === 'executing' && deps.onUnanswered) {
          await deps.onUnanswered(handoff.inquiryId, payload.turn)
        }
        if (handoff.phase === 'result' && handoff.work.kind === 'local' && handoff.work.sessionId === agent.session.id && deps.onLocalWorkTurnEnd) {
          const work = deps.works.get(handoff.work.sessionId, handoff.work.workId)
          if (work) await deps.onLocalWorkTurnEnd(work, handoff.scope, payload.turn)
        }
      }
      // Turn-end always frees this session's queue, including ordinary turns.
      await pumpResults(agent.session.id, agent)
      await pumpTarget(agent.session.id)
      // A target answer/failure may have made a result available to its requester.
      if (handoff?.phase === 'target') {
        const record = deps.ledger.get(handoff.inquiryId)
        if (record) await pumpResults(record.requester.sessionId)
      }
    })
  }

  async function pumpResults(sessionId: string, agent?: InquiryAgent): Promise<void> {
    if (pumping.has(sessionId)) { requestPump(sessionId, 'results'); return pumping.get(sessionId) }
    if (!deps.readiness()) return
    const task = (async () => {
      const scope = deps.currentScope(sessionId)
      if (!scope) return
      const target = agent ?? await deps.resolveAgent(scope)
      if (!target || target.occupiesRunSlot || target.session.id !== sessionId) return
      const rows = deps.outbox.listPending(sessionId).slice().sort((a, b) => a.createdAt - b.createdAt || a.dedupKey.localeCompare(b.dedupKey))
      for (const row of rows) {
        if (!deps.prepareResult || !deps.resultMessage) return
        const answer = row.result.kind === 'answer' ? deps.answers.get(row.inquiryId) : undefined
        if (row.result.kind === 'answer' && (!answer || answer.inquiryId !== row.inquiryId || answer.answeredAt !== row.result.answeredAt)) continue
        let handoff = deps.handoffs.get(row.inquiryId, 'result')
        if (!handoff) handoff = await deps.prepareResult(row, answer)
        const stored = deps.handoffs.get(row.inquiryId, 'result')
        if (!handoff || !stored || handoff.state !== 'intent' || stored.state !== 'intent' ||
          handoff.phase !== 'result' || stored.phase !== 'result' || handoff.inquiryId !== row.inquiryId ||
          stored.inquiryId !== row.inquiryId || handoff.messageId !== stored.messageId ||
          !sameScope(handoff.scope, scope) || !sameScope(stored.scope, scope) ||
          JSON.stringify(handoff.work) !== JSON.stringify(stored.work) || handoff.parentInquiryId !== stored.parentInquiryId) continue
        if ([...target.inbox.nextTurn, ...target.inbox.nextStep].some(message => message.id === stored.messageId)) continue
        const inquiry = deps.ledger.get(row.inquiryId)
        const targetHandoff = deps.handoffs.get(row.inquiryId, 'target')
        if (!inquiry || inquiry.id !== row.inquiryId || inquiry.requester.sessionId !== sessionId ||
          !sameScope(inquiry.requester, row.requester) || !targetHandoff || targetHandoff.phase !== 'target' ||
          targetHandoff.inquiryId !== row.inquiryId || JSON.stringify(inquiry.origin) !== JSON.stringify(row.resumeWork) ||
          targetHandoff.work.kind !== 'local' || JSON.stringify(targetHandoff.work) !== JSON.stringify(stored.work)) continue
        // Follow the immediate-parent chain to prove that the shared local work belongs
        // to the root requester, while keeping the result handoff's own parent identity
        // anchored by the durable store's reservation proof.
        let cursor = inquiry
        if (targetHandoff.work.kind !== 'local') continue
        let expectedWork = targetHandoff.work
        const seen = new Set<string>()
        let depth = 0
        let valid = true
        while (cursor.origin.kind === 'inquiry') {
          if (++depth > 3 || seen.has(cursor.id) || cursor.origin.parentInquiryId === cursor.id) { valid = false; break }
          seen.add(cursor.id)
          const parent = deps.ledger.get(cursor.origin.parentInquiryId)
          const parentTarget = parent && deps.handoffs.get(parent.id, 'target')
          if (!parent || parent.id !== cursor.origin.parentInquiryId || parent.trace.rootInquiryId !== cursor.trace.rootInquiryId ||
            parent.trace.depth + 1 !== cursor.trace.depth || !sameScope(parent.target, cursor.requester) ||
            parent.status !== 'executing' || !parentTarget || parentTarget.phase !== 'target' || parentTarget.state !== 'claimed' ||
            parentTarget.inquiryId !== parent.id || !sameScope(parentTarget.scope, parent.target) ||
            parentTarget.work.kind !== 'local' || JSON.stringify(parentTarget.work) !== JSON.stringify(expectedWork)) { valid = false; break }
          cursor = parent
          expectedWork = parentTarget.work
        }
        if (!valid || cursor.origin.kind !== 'local' || cursor.trace.rootInquiryId !== cursor.id ||
          cursor.requester.sessionId !== expectedWork.sessionId || JSON.stringify(expectedWork) !== JSON.stringify(stored.work)) continue
        const root = deps.works.get(expectedWork.sessionId, expectedWork.workId)
        if (!root || root.state === 'settled' || root.sessionId !== expectedWork.sessionId || root.workId !== expectedWork.workId ||
          root.scopeGeneration !== (cursor.requester.kind === 'child' ? cursor.requester.generation : 0) ||
          !root.openInquiryIds.includes(row.inquiryId)) continue
        install(target, scope)
        target.followup(deps.createMessage(deps.resultMessage(row, answer, stored)))
        break
      }
    })()
    pumping.set(sessionId, task)
    try { await task } finally {
      if (pumping.get(sessionId) === task) pumping.delete(sessionId)
      const pending = pendingPump.get(sessionId)
      if (pending?.size) {
        pendingPump.delete(sessionId)
        if (pending.has('results')) await pumpResults(sessionId)
        else if (pending.has('target')) await pumpTarget(sessionId)
      }
    }
  }

  return Object.freeze({ pumpTarget, pumpResults, install, segmentFor: (sessionId: string, turn: number) => claimedTurns.get(turnKey(sessionId, turn)) })
}

function sameScope(a: InquiryScope, b: InquiryScope): boolean {
  return a.kind === b.kind && a.sessionId === b.sessionId && (a.kind === 'main' || (b.kind === 'child' && a.locusId === b.locusId && a.generation === b.generation))
}
