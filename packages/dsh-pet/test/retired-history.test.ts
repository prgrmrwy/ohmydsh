import { describe, expect, it } from 'vitest'
import * as answers from '../src/host/inquiry/answer.js'
import * as handoffs from '../src/host/inquiry/handoff-store.js'
import * as works from '../src/host/inquiry/work-store.js'
import * as collaboration from '../src/host/collaboration/context.js'
import * as ledger from '../src/host/inquiry/ledger.js'
import * as outbox from '../src/host/inquiry/outbox.js'

describe('retired inquiry history', () => {
  it('keeps only value parsers, not executable answer or store write paths', () => {
    expect(Object.keys(answers).filter(key => key.startsWith('submit'))).toEqual([])
    expect('InquiryHandoffStore' in handoffs).toBe(false)
    expect('InquiryWorkStore' in works).toBe(false)
    expect('createInquiry' in ledger).toBe(false)
    expect('applyInquiryEvent' in ledger).toBe(false)
    expect('createInquiryResult' in outbox).toBe(false)
    expect('updateCollaborationContext' in collaboration).toBe(false)
    const context = { parentSessionId: 'main', revision: 0, status: 'unknown', workDescription: null, resourceReferences: null, commonConstraints: null, sources: [], authoredBy: null, authoredAt: null, authoredByLocus: null, sharingScope: null }
    expect(collaboration.parseCollaborationContext(context)).toEqual(context)
    const result = { inquiryId: 'old', requester: { kind: 'main', sessionId: 'main' }, resumeWork: { kind: 'local' }, result: { kind: 'answer', answeredAt: 1 }, dedupKey: '["result","old","answer"]', status: 'pending', createdAt: 1, statusAt: 1, deliveredSegmentId: null, appliedEventIds: [], diagnostics: [], droppedDiagnostics: 0 }
    expect(outbox.parseInquiryOutboxRecord(result)).toEqual(result)
    const answer = { inquiryId: 'old', answeredBy: { kind: 'main', sessionId: 'main' }, answer: 'retained', confidence: 'confirmed', recency: 'current', sources: ['retained source'], answeredAt: 1 }
    const work = { sessionId: 'main', workId: 'work', scopeGeneration: 0, rootClaimTurn: 1, state: 'waiting', openInquiryIds: ['old'], continuationTurn: null }
    const handoff = { protocolVersion: 1, inquiryId: 'old', phase: 'target', scope: answer.answeredBy, generation: 0, messageId: 'message', work: { kind: 'local', sessionId: 'main', workId: 'work' }, parentInquiryId: null, createdAt: 1, claimTurn: null, claimAt: null, state: 'intent' }
    expect(answers.parseInquiryAnswer(answer)).toEqual(answer)
    expect(works.parseInquiryWork(work)).toEqual(work)
    expect(handoffs.parseInquiryHandoff(handoff)).toEqual(handoff)
  })
})
