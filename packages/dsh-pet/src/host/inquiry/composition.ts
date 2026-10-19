import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'pet-inquiry': { kind: 'pet-inquiry' }
    'pet-inquiry-result': { kind: 'pet-inquiry-result' }
  }
}
import { applyInquiryEvent, parseInquiry, type InquiryRecord } from './ledger.js'
import { createInquiryResult, parseInquiryOutboxRecord } from './outbox.js'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import type { InquiryScope } from './ledger.js'
import type { InquiryAcceptFacts } from './ledger-store.js'
import type { InquiryHandoff } from './handoff-store.js'
import type { InquiryWork } from './work-store.js'
import type { InquiryAnswerRecord } from './answer.js'
import type { InquiryOutboxRecord } from './outbox.js'
import { InquiryAnswerStore } from './answer-store.js'
import { InquiryAcceptanceStore } from './acceptance-store.js'
import { InquiryHandoffStore } from './handoff-store.js'
import { InquiryLedgerStore } from './ledger-store.js'
import { InquiryOutboxStore } from './outbox-store.js'
import { InquiryWorkStore } from './work-store.js'
import { createInquiryRuntime, type InquiryAgent, type InquiryPreStep } from './runtime.js'
import { createInquiryAgentAdapter, type InquiryExecutionProof } from './agent-adapter.js'
import { detectIsolatedQueuedTurnClaim } from './capability.js'

type PetDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: { put(table: 'inquiries' | 'inquiry_results', key: string, value: unknown): void }) => void) => Promise<void>
}

/** Production dependencies are owner-owned primitives, never preassembled store/runtime ports. */
export interface ProductionInquiryPorts {
  readonly domain: PetDomain
  readonly currentScope: (sessionId: string) => InquiryScope | undefined
  readonly resolveAgent: (scope: InquiryScope) => Agent | undefined | Promise<Agent | undefined>
  readonly agentLoop: unknown
  readonly probeIsolatedClaim: unknown
  readonly tools: { readonly supportsFinalToolGuardRecheck?: boolean }
  readonly readinessManagedGuard: () => boolean
  readonly log: (message: string, details?: unknown) => void
  readonly onError: (error: unknown) => void
  readonly now: () => number
  readonly newMessageId: () => string
  readonly newInquiryId: () => string
}

const sameScope = (a: InquiryScope, b: InquiryScope) => a.kind === b.kind && a.sessionId === b.sessionId &&
  (a.kind === 'main' || (b.kind === 'child' && a.locusId === b.locusId && a.generation === b.generation))

/**
 * Compose the concrete Pet-owned inquiry stores and actual Agent adapters over one domain.
 * Capabilities stay fail-closed: callers must supply a live isolation probe, guard recheck and exact execution proof.
 */
export function composeProductionInquiry(ports: ProductionInquiryPorts) {
  const ledger = new InquiryLedgerStore(ports.domain as never)
  const answers = new InquiryAnswerStore(ports.domain as never)
  const acceptances = new InquiryAcceptanceStore(ports.domain as never)
  const handoffs = new InquiryHandoffStore(ports.domain as never)
  const outbox = new InquiryOutboxStore(ports.domain as never)
  const works = new InquiryWorkStore(ports.domain as never)
  type Adapter = InquiryAgent & { executionProof(execution: ToolExecution): InquiryExecutionProof | undefined }
  const adapters = new Map<string, Adapter>()
  const probe = detectIsolatedQueuedTurnClaim({ agentLoop: ports.agentLoop, probeIsolatedClaim: ports.probeIsolatedClaim })
  const readiness = () => ports.domain.supportsTransaction === true && typeof ports.domain.transaction === 'function'
    && ports.tools?.supportsFinalToolGuardRecheck === true && probe.available && ports.readinessManagedGuard() === true
    && typeof ports.log === 'function' && typeof ports.onError === 'function'
  const runtime = createInquiryRuntime({
    ledger, answers, handoffs, outbox, works,
    resolveAgent: async scope => {
      if (!readiness() || !sameScope(ports.currentScope(scope.sessionId) ?? ({ kind: 'main', sessionId: '' } as InquiryScope), scope)) return undefined
      const agent = await ports.resolveAgent(scope)
      if (!agent || agent.id !== scope.sessionId) return undefined
      return install(agent)
    },
    currentScope: ports.currentScope,
    readiness,
    now: ports.now,
    newMessageId: ports.newMessageId,
    createMessage: input => {
      if (input.source === 'pet-inquiry-result') {
        return { ...createUserMessage({ content: [{ type: 'text', text: input.content }], source: { kind: 'pet-inquiry-result' } }), id: MessageId(input.id) }
      }
      const handoff = handoffs.findByMessageId(input.id)
      if (!handoff || handoff.phase !== 'target') throw new Error('Inquiry handoff unavailable')
      const row = ledger.get(handoff.inquiryId)
      if (!row) throw new Error('Inquiry record unavailable')
      const text = JSON.stringify({ inquiryId: row.id, question: row.question, purpose: row.purpose, audience: row.audience, trace: row.trace, instruction: 'Answer this inquiry explicitly using only the bounded question; do not rely on conversation history.' })
      return { ...createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'pet-inquiry' } }), id: MessageId(input.id) }
    },
    prepareResult: async (row, answer) => {
      if (!readiness()) return undefined
      const target = handoffs.get(row.inquiryId, 'target')
      if (!target) return undefined
      const existing = handoffs.get(row.inquiryId, 'result')
      if (existing) return existing
      const messageId = ports.newMessageId()
      return handoffs.reserve({ inquiryId: row.inquiryId, phase: 'result', scope: row.requester, messageId, work: target.work, parentInquiryId: target.parentInquiryId, createdAt: ports.now() })
    },
    resultMessage: (row, answer, handoff) => ({ id: handoff.messageId, source: 'pet-inquiry-result', content: JSON.stringify({ inquiryId: row.inquiryId, purpose: 'inquiry-result', audience: row.requester, result: row.result, answer: answer?.answer ?? null }) }),
    onUnanswered: async (inquiryId, turn) => {
      const domain = ports.domain
      if (domain.supportsTransaction !== true || typeof domain.transaction !== 'function') return
      const at = ports.now()
      const eventId = `${inquiryId}:turn:${turn}:no-answer`
      await domain.transaction(tx => {
        const raw = domain.table('inquiries').get(inquiryId)
        if (raw === undefined) return
        const record = parseInquiry(raw)
        if (record.id !== inquiryId || record.status !== 'executing') return
        const pendingBranch = [...domain.table('inquiries').entries()].some(([key, value]) => {
          const child = parseInquiry(value)
          if (child.id !== key || child.origin.kind !== 'inquiry' || child.origin.parentInquiryId !== inquiryId) return false
          return !['rejected', 'unavailable', 'cancelled', 'needs-review', 'result-delivered', 'expired'].includes(child.status)
        })
        if (pendingBranch) return
        const next = applyInquiryEvent(record, { type: 'unavailable', eventId, at, reason: 'inquiry-no-explicit-answer' })
        const outboxRecord = createInquiryResult({ inquiryId, requester: record.requester, resumeWork: record.origin,
          result: { kind: 'failure', failure: 'unavailable', reason: 'inquiry-no-explicit-answer', failedAt: at }, createdAt: at })
        const resultTable = domain.table('inquiry_results')
        let existing: ReturnType<typeof parseInquiryOutboxRecord> | undefined
        for (const [key, value] of resultTable.entries()) {
          const candidate = parseInquiryOutboxRecord(value)
          if (key !== candidate.dedupKey) throw new Error('Inquiry result key mismatch')
          if (candidate.inquiryId === inquiryId) {
            if (existing) throw new Error('Duplicate inquiry result')
            existing = candidate
          }
        }
        if (existing && (existing.dedupKey !== outboxRecord.dedupKey || JSON.stringify(existing.requester) !== JSON.stringify(outboxRecord.requester) || JSON.stringify(existing.resumeWork) !== JSON.stringify(outboxRecord.resumeWork) || JSON.stringify(existing.result) !== JSON.stringify(outboxRecord.result))) throw new Error('Inquiry result conflict')
        if (!existing) tx.put('inquiry_results', outboxRecord.dedupKey, outboxRecord)
        tx.put('inquiries', inquiryId, next)
      })
    },
    onLocalWorkTurnEnd: async (work, scope, turn) => { const current = ports.currentScope(scope.sessionId); if (current && work.state !== 'settled' && sameScope(current, scope)) await works.endTurn(scope, work.workId, turn) },
  })

  function install(agent: Agent): Adapter {
    const existing = adapters.get(agent.id)
    if (existing) {
      if (agent.session !== existing.session || !ports.currentScope(agent.id)) throw new Error('Inquiry agent instance changed')
      return existing
    }
    if (agent.id.length === 0 || ports.currentScope(agent.id)?.sessionId !== agent.id) throw new Error('Invalid Pet inquiry agent')
    const adapter = createInquiryAgentAdapter(agent, { currentScope: ports.currentScope, works, runtime, now: ports.now }) as Adapter
    adapters.set(agent.id, adapter)
    return adapter
  }
  const origin = (callerSessionId: string, execution?: ToolExecution) => {
    if (!execution) return undefined
    const proof = adapters.get(callerSessionId)?.executionProof(execution)
    if (!proof) return undefined
    const current = ports.currentScope(callerSessionId)
    if (!current) return undefined
    const durableAudience = (id: string) => ledger.get(id)?.audience
    return originFromProof(proof, callerSessionId, current, ledger, durableAudience, handoffs, outbox)
  }
  return Object.freeze({
    answerStore: answers,
    runtime,
    get ready() { return readiness() },
    install,
    release: (agent: Agent) => { if (adapters.get(agent.id)?.session === agent.session) adapters.delete(agent.id) },
    origin,
    forExecution: (execution: ToolExecution) => Object.freeze({
      origin: (callerSessionId: string) => origin(callerSessionId, execution),
      accept: async (request: unknown, facts: unknown) => {
        if (!readiness()) throw new Error('Inquiry runtime unavailable')
        const caller = (facts as { requester?: InquiryScope } | null)?.requester
        if (!caller) throw new Error('Inquiry execution proof unavailable')
        const proof = adapters.get(caller.sessionId)?.executionProof(execution)
        if (!proof || !proof.active || proof.signal.aborted || proof.sessionId !== caller.sessionId || !sameScope(proof.scope, caller) || !ports.currentScope(caller.sessionId) || !sameScope(ports.currentScope(caller.sessionId)!, caller)) throw new Error('Inquiry execution proof unavailable')
        const provenance = originFromProof(proof, caller.sessionId, ports.currentScope(caller.sessionId), ledger, id => ledger.get(id)?.audience, handoffs, outbox)
        if (!provenance || JSON.stringify(provenance.origin) !== JSON.stringify((facts as { origin?: unknown }).origin)) throw new Error('Inquiry origin unavailable')
        const originalParent = provenance.origin.kind === 'inquiry' ? ledger.get(provenance.origin.parentInquiryId) : undefined
        const inheritedAudience = originalParent?.audience
        if (inheritedAudience && JSON.stringify((facts as { audience?: unknown }).audience) !== JSON.stringify(inheritedAudience)) throw new Error('Inquiry inherited audience mismatch')
        const target = (request as { target?: InquiryScope } | null)?.target
        const targetCurrent = target && ports.currentScope(target.sessionId)
        if (!target || !targetCurrent || !sameScope(targetCurrent, target)) throw new Error('Inquiry target unavailable')
        const work = proof.inquirySegment ? proof.inquirySegment.work.kind === 'local' && proof.inquirySegment.work : proof.rootWork && { kind: 'local' as const, sessionId: proof.rootWork.sessionId, workId: proof.rootWork.workId }
        if (!work || work.kind !== 'local') throw new Error('Inquiry local work unavailable')
        const messageId = ports.newMessageId()
        const accepted = await acceptances.accept({ request, facts: facts as InquiryAcceptFacts, work, messageId })
        queueMicrotask(() => { void runtime.pumpTarget(accepted.target.sessionId).catch(ports.onError) })
        return accepted
      },
    }),
    afterAnswer: async (inquiryId: string) => {
      if (!readiness()) return
      const record = ledger.get(inquiryId)
      if (record) queueMicrotask(() => { void runtime.pumpResults(record.requester.sessionId).catch(ports.onError) })
    },
    answerBinding: (callerSessionId: string, inquiryId: string, execution: ToolExecution) => {
      if (!readiness()) return false
      const proof = adapters.get(callerSessionId)?.executionProof(execution)
      const current = ports.currentScope(callerSessionId)
      if (!proof || !proof.active || proof.signal.aborted || proof.sessionId !== callerSessionId || !current || !sameScope(current, proof.scope)) return false
      const segment = proof.inquirySegment
      if (!segment || segment.inquiryId !== inquiryId || segment.phase !== 'target' || segment.claimTurn !== proof.turn) return false
      const row = ledger.get(inquiryId)
      const claim = handoffs.get(inquiryId, 'target')
      return !!row && !!claim && (row.status === 'executing' || row.status === 'answered') && claim.state === 'claimed' && claim.claimTurn === proof.turn && claim.messageId === segment.messageId && sameScope(claim.scope, proof.scope)
    },
  })
}

function originFromProof(proof: InquiryExecutionProof, callerSessionId: string, current: InquiryScope | undefined, ledger: InquiryLedgerStore, audienceFor: (id: string) => import('./ledger.js').InquiryAudience | undefined, handoffs: InquiryHandoffStore, outbox: InquiryOutboxStore) {
  if (!proof.active || proof.signal.aborted || proof.sessionId !== callerSessionId || !current || !sameScope(current, proof.scope)) return undefined
  if (proof.inquirySegment) {
    const segment = proof.inquirySegment
    if ((segment.phase !== 'target' && segment.phase !== 'result') || segment.claimTurn !== proof.turn || segment.scope.sessionId !== callerSessionId || !sameScope(segment.scope, proof.scope)) return undefined
    const parent = ledger.get(segment.inquiryId)
    const audience = parent && audienceFor(parent.id)
    const handoff = handoffs.findByMessageId(segment.messageId)
    const expectedState = segment.phase === 'target'
      ? parent?.status === 'executing' && parent.target.sessionId === callerSessionId
      : parent?.status === 'result-delivered' && parent.requester.sessionId === callerSessionId
    if (!parent || !audience || !expectedState || !handoff || handoff.inquiryId !== segment.inquiryId
      || handoff.phase !== segment.phase || handoff.state !== 'claimed' || handoff.claimTurn !== proof.turn
      || handoff.messageId !== segment.messageId || !sameScope(handoff.scope, proof.scope)) return undefined
    if (segment.phase === 'result') {
      const delivered = outbox.findByInquiry(parent.id)
      const segmentId = JSON.stringify([{ sessionId: callerSessionId, turn: proof.turn }])
      if (!delivered || delivered.status !== 'delivered' || delivered.deliveredSegmentId !== segmentId
        || JSON.stringify(delivered.requester) !== JSON.stringify(parent.requester)
        || JSON.stringify(delivered.resumeWork) !== JSON.stringify(parent.origin)) return undefined
      const targetClaim = handoffs.get(parent.id, 'target')
      if (!targetClaim || targetClaim.state !== 'claimed' || targetClaim.parentInquiryId !== (parent.origin.kind === 'inquiry' ? parent.origin.parentInquiryId : null)
        || JSON.stringify(targetClaim.work) !== JSON.stringify(handoff.work)) return undefined
    }
    return { origin: { kind: 'inquiry' as const, parentInquiryId: segment.inquiryId }, audience }
  }
  if (!proof.rootWork || proof.rootWork.state === 'settled' || proof.rootWork.rootClaimTurn !== proof.turn) return undefined
  return current.kind === 'child'
    ? { origin: { kind: 'local' as const }, audience: { kind: 'unknown' as const } }
    : { origin: { kind: 'local' as const }, audience: { kind: 'local-session' as const, sessionId: callerSessionId } }
}

export type ProductionInquiryAgent = InquiryAgent
export type ProductionInquiryResult = InquiryOutboxRecord
