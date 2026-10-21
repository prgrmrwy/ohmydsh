/**
 * Exhaustive fake-port tests for the pure `proveInquiryResultDelivery`.
 * Every failure branch asserts an explicit `undefined`, not merely "no throw".
 */
import { describe, expect, it } from 'vitest'
import {
  proveInquiryResultDelivery,
  type InquiryResultProofPorts,
  type ProofDelivery,
  type ProofHandoff,
  type ProofInquiry,
  type ProofWork,
} from '../src/host/locus/inquiry-result-proof.js'
import type { DeliveryStatus } from '../src/host/locus/delivery.js'

const CHILD = 'child-1'
const LOCUS = 'locus-1'
const GEN = 2
const MSG = 'inq-result-msg'
const WORK_ID = 'om-root-1'
const NOW = 1_000_000
const input = { childSessionId: CHILD, messageId: MSG }
const scope = { kind: 'child', sessionId: CHILD, locusId: LOCUS, generation: GEN } as const

const baseHandoff: ProofHandoff = {
  inquiryId: 'inq-1', phase: 'result', scope, state: 'intent',
  work: { kind: 'local', sessionId: CHILD, workId: WORK_ID },
}
const baseInquiry: ProofInquiry = { requester: scope, status: 'answered' }
const baseWork: ProofWork = {
  sessionId: CHILD, workId: WORK_ID, scopeGeneration: GEN, state: 'waiting', openInquiryIds: ['inq-1'],
}
const baseDelivery: ProofDelivery = {
  deliveryId: 'delivery-1', executionId: 'execution-1', status: 'current',
  endpoint: { chatId: 'oc-1', threadId: 'omt-1' }, locusId: LOCUS, generation: GEN, childSessionId: CHILD,
  acceptedAt: NOW - 1000, deadlineAt: NOW + 5000, hardDeadlineAt: NOW + 10_000,
}

type Overrides = {
  [K in keyof InquiryResultProofPorts]?: InquiryResultProofPorts[K]
}

function prove(overrides: Overrides = {}) {
  const ports: InquiryResultProofPorts = {
    findResultHandoff: () => baseHandoff,
    getInquiry: () => baseInquiry,
    getWork: () => baseWork,
    findDeliveryByInboxMessageId: () => baseDelivery,
    now: () => NOW,
    currentScopeOf: () => ({ locusId: LOCUS, generation: GEN }),
    ...overrides,
  }
  return proveInquiryResultDelivery(ports)(input)
}

describe('proveInquiryResultDelivery', () => {
  it('succeeds for an intent handoff (answered inquiry, branch still open)', () => {
    expect(prove()).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      correlation: { endpoint: { chatId: 'oc-1', threadId: 'omt-1' }, locusId: LOCUS, generation: GEN, childSessionId: CHILD },
      status: 'current',
    })
  })

  it('succeeds for a claimed handoff (result-delivered, branch removed)', () => {
    expect(prove({
      findResultHandoff: () => ({ ...baseHandoff, state: 'claimed' }),
      getInquiry: () => ({ ...baseInquiry, status: 'result-delivered' }),
      getWork: () => ({ ...baseWork, state: 'active', openInquiryIds: [] }),
    })).toMatchObject({ deliveryId: 'delivery-1', executionId: 'execution-1' })
  })

  it('succeeds for a failure result (unavailable inquiry)', () => {
    expect(prove({ getInquiry: () => ({ ...baseInquiry, status: 'unavailable' }) })).toBeDefined()
  })

  it('queries the ports with the exact ids and never by locus alone', () => {
    const calls: string[] = []
    prove({
      findResultHandoff: id => { calls.push(`handoff:${id}`); return baseHandoff },
      getInquiry: id => { calls.push(`inquiry:${id}`); return baseInquiry },
      getWork: (s, w) => { calls.push(`work:${s}:${w}`); return baseWork },
      findDeliveryByInboxMessageId: id => { calls.push(`delivery:${id}`); return baseDelivery },
    })
    expect(calls).toEqual([`handoff:${MSG}`, 'inquiry:inq-1', `work:${CHILD}:${WORK_ID}`, `delivery:${WORK_ID}`])
  })

  it('handoff missing', () => {
    expect(prove({ findResultHandoff: () => undefined })).toBeUndefined()
  })
  it('handoff phase is target', () => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, phase: 'target' }) })).toBeUndefined()
  })
  it.each(['closed', 'needs-review', 'other'])('handoff state %s', state => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, state }) })).toBeUndefined()
  })
  it('handoff scope is main', () => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, scope: { kind: 'main', sessionId: CHILD } }) })).toBeUndefined()
  })
  it('handoff scope sessionId differs', () => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, scope: { ...scope, sessionId: 'child-2' } }) })).toBeUndefined()
  })
  it('handoff scope locusId differs', () => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, scope: { ...scope, locusId: 'locus-9' } }) })).toBeUndefined()
  })
  it('handoff scope generation differs', () => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, scope: { ...scope, generation: GEN - 1 } }) })).toBeUndefined()
  })
  it('child was rebuilt: current generation moved on', () => {
    expect(prove({ currentScopeOf: () => ({ locusId: LOCUS, generation: GEN + 1 }) })).toBeUndefined()
  })
  it('child has no active locus', () => {
    expect(prove({ currentScopeOf: () => undefined })).toBeUndefined()
  })

  it('inquiry missing', () => {
    expect(prove({ getInquiry: () => undefined })).toBeUndefined()
  })
  it('inquiry requester is another member', () => {
    expect(prove({ getInquiry: () => ({ ...baseInquiry, requester: { ...scope, sessionId: 'child-2' } }) })).toBeUndefined()
    expect(prove({ getInquiry: () => ({ ...baseInquiry, requester: { ...scope, generation: GEN - 1 } }) })).toBeUndefined()
    expect(prove({ getInquiry: () => ({ ...baseInquiry, requester: { ...scope, locusId: 'locus-9' } }) })).toBeUndefined()
    expect(prove({ getInquiry: () => ({ ...baseInquiry, requester: { kind: 'main', sessionId: CHILD } }) })).toBeUndefined()
  })
  it.each(['queued', 'executing', 'rejected', 'cancelled', 'needs-review', 'expired'])('inquiry status %s', status => {
    expect(prove({ getInquiry: () => ({ ...baseInquiry, status }) })).toBeUndefined()
  })

  it('work.kind is not local', () => {
    expect(prove({ findResultHandoff: () => ({ ...baseHandoff, work: { kind: 'delivery', id: 'delivery-1' } }) })).toBeUndefined()
  })
  it('handoff work belongs to another session', () => {
    expect(prove({
      findResultHandoff: () => ({ ...baseHandoff, work: { kind: 'local', sessionId: 'child-2', workId: WORK_ID } }),
    })).toBeUndefined()
  })
  it('work row missing', () => {
    expect(prove({ getWork: () => undefined })).toBeUndefined()
  })
  it('work row is for a different id/session', () => {
    expect(prove({ getWork: () => ({ ...baseWork, workId: 'other' }) })).toBeUndefined()
    expect(prove({ getWork: () => ({ ...baseWork, sessionId: 'child-2' }) })).toBeUndefined()
  })
  it('work is settled', () => {
    expect(prove({ getWork: () => ({ ...baseWork, state: 'settled', openInquiryIds: [] }) })).toBeUndefined()
  })
  it('work scopeGeneration differs', () => {
    expect(prove({ getWork: () => ({ ...baseWork, scopeGeneration: GEN - 1 }) })).toBeUndefined()
  })

  it('Delivery not found (e.g. a GUI request work id)', () => {
    expect(prove({ findDeliveryByInboxMessageId: () => undefined })).toBeUndefined()
  })
  it('Delivery belongs to another child / locus / generation', () => {
    expect(prove({ findDeliveryByInboxMessageId: () => ({ ...baseDelivery, childSessionId: 'child-2' }) })).toBeUndefined()
    expect(prove({ findDeliveryByInboxMessageId: () => ({ ...baseDelivery, locusId: 'locus-9' }) })).toBeUndefined()
    expect(prove({ findDeliveryByInboxMessageId: () => ({ ...baseDelivery, generation: GEN + 1 }) })).toBeUndefined()
  })
  it('Delivery has no execution binding', () => {
    const { executionId: _omit, ...unbound } = baseDelivery
    expect(prove({ findDeliveryByInboxMessageId: () => unbound })).toBeUndefined()
  })
  it.each(['settled', 'failed', 'replied', 'no-reply', 'expired', 'unknown-terminal'] as DeliveryStatus[])(
    'Delivery is terminal: %s',
    status => {
      expect(prove({ findDeliveryByInboxMessageId: () => ({ ...baseDelivery, status }) })).toBeUndefined()
    },
  )
  it.each(['accepted', 'queued', 'running', 'current', 'finishing'] as DeliveryStatus[])(
    'Delivery pending status %s is accepted',
    status => {
      expect(prove({ findDeliveryByInboxMessageId: () => ({ ...baseDelivery, status }) })).toMatchObject({ status })
    },
  )
  it('Delivery passed deadlineAt (inclusive boundary)', () => {
    expect(prove({ now: () => NOW + 5000 })).toBeUndefined()
    expect(prove({ now: () => NOW + 5001 })).toBeUndefined()
    expect(prove({ now: () => NOW + 4999 })).toBeDefined()
  })
  it('Delivery passed hardDeadlineAt even with a later deadlineAt', () => {
    const lateSoft = { ...baseDelivery, deadlineAt: NOW + 50_000 }
    expect(prove({ findDeliveryByInboxMessageId: () => lateSoft, now: () => NOW + 10_000 })).toBeUndefined()
    expect(prove({ findDeliveryByInboxMessageId: () => lateSoft, now: () => NOW + 9999 })).toBeDefined()
  })
  it('implicit 24h hard cap from acceptedAt applies when no hardDeadlineAt', () => {
    const { hardDeadlineAt: _omit, ...noHard } = baseDelivery
    const open = { ...noHard, acceptedAt: 0, deadlineAt: undefined }
    expect(prove({ findDeliveryByInboxMessageId: () => open, now: () => 24 * 60 * 60 * 1000 })).toBeUndefined()
    expect(prove({ findDeliveryByInboxMessageId: () => open, now: () => 24 * 60 * 60 * 1000 - 1 })).toBeDefined()
  })
  it('clock returns a non-integer', () => {
    expect(prove({ now: () => Number.NaN })).toBeUndefined()
  })

  it.each([
    'findResultHandoff', 'getInquiry', 'getWork', 'findDeliveryByInboxMessageId', 'now', 'currentScopeOf',
  ] as const)('port %s throws', port => {
    expect(prove({ [port]: () => { throw new Error('boom') } } as Overrides)).toBeUndefined()
  })

  it('malformed input', () => {
    const fn = proveInquiryResultDelivery({
      findResultHandoff: () => baseHandoff, getInquiry: () => baseInquiry, getWork: () => baseWork,
      findDeliveryByInboxMessageId: () => baseDelivery, now: () => NOW,
      currentScopeOf: () => ({ locusId: LOCUS, generation: GEN }),
    })
    expect(fn({ childSessionId: '', messageId: MSG })).toBeUndefined()
    expect(fn({ childSessionId: CHILD, messageId: '' })).toBeUndefined()
    expect(fn(null as never)).toBeUndefined()
  })
})
