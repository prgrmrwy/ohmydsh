/**
 * Replay of a real production failure (session-15859f3d…, 2026-10-20): a locus
 * child serving Feishu Delivery `delivery-74` asked its main session through
 * `pet_inquire`, received the answer as a `pet-inquiry-result` turn, and every
 * `pet_locus_finish` reply was refused as unauthorized. Identifiers, turn
 * numbers and timestamps below are copied from that session's record; durable
 * rows the session did not expose are reconstructed exactly as the inquiry
 * stores write them (work id = root `user` message id of the asking turn).
 */
import { describe, expect, it } from 'vitest'
import { createLocusTurnObserver, type LocusInboxClaim, type LocusTurnEnd } from '../src/host/locus/turn-observer.js'
import { proveInquiryResultDelivery } from '../src/host/locus/inquiry-result-proof.js'

const CHILD = 'session-15859f3d-9fe4-48fc-b521-6687f2d8b550'
const LOCUS = 'locus-runtime-1792479747853-a6a53b32f3ce18'
const CHAT = 'oc_eed9ab61ff0f4a3f485cc0270a48a307'
const ASK_ROOT_MESSAGE = 'c96d9077-8c4c-4ce9-996e-6c0a3460112c'
const RESULT_MESSAGE = '9dd8f498-9679-4831-b046-afa723760c28'
const INQUIRY = 'inquiry-96i6rmplyd8'
const EXECUTION = 'cf05a882-daac-49e3-b798-484ff7180f5b'
const ANSWERED_AT = 1792481222069
const childScope = { kind: 'child' as const, sessionId: CHILD, locusId: LOCUS, generation: 1 }
const delivery74 = {
  deliveryId: 'delivery-74', executionId: EXECUTION, status: 'current' as const,
  endpoint: { chatId: CHAT }, locusId: LOCUS, generation: 1, childSessionId: CHILD,
  acceptedAt: 1792480803636, deadlineAt: 1792484403636, hardDeadlineAt: 1792567203636,
}

function replay(overrides: { now?: number; deliveryStatus?: string; generation?: number } = {}) {
  const claims: ((claim: LocusInboxClaim) => void)[] = []
  const ends: ((end: LocusTurnEnd) => void)[] = []
  const prove = proveInquiryResultDelivery({
    findResultHandoff: id => id === RESULT_MESSAGE
      ? { inquiryId: INQUIRY, phase: 'result', scope: childScope, state: 'intent', work: { kind: 'local', sessionId: CHILD, workId: ASK_ROOT_MESSAGE } }
      : undefined,
    getInquiry: id => id === INQUIRY ? { requester: childScope, status: 'answered' } : undefined,
    getWork: (session, work) => session === CHILD && work === ASK_ROOT_MESSAGE
      ? { sessionId: CHILD, workId: ASK_ROOT_MESSAGE, scopeGeneration: 1, state: 'active', openInquiryIds: [INQUIRY] }
      : undefined,
    findDeliveryByInboxMessageId: id => id === ASK_ROOT_MESSAGE ? { ...delivery74, status: (overrides.deliveryStatus ?? 'current') as never } : undefined,
    now: () => overrides.now ?? ANSWERED_AT,
    currentScopeOf: id => id === CHILD ? { locusId: LOCUS, generation: overrides.generation ?? 1 } : undefined,
  })
  const observer = createLocusTurnObserver({
    onClaimed: listener => { claims.push(listener); return () => undefined },
    onTurnEnd: listener => { ends.push(listener); return () => undefined },
    lookup: {
      find: ({ childSessionId, messageId }) => childSessionId === CHILD && messageId === ASK_ROOT_MESSAGE
        ? { deliveryId: 'delivery-74', executionId: EXECUTION, correlation: { endpoint: { chatId: CHAT }, locusId: LOCUS, generation: 1, childSessionId: CHILD }, status: 'current' }
        : undefined,
    },
    inquiryResult: { prove },
  })
  const claim = (messageId: string, turn: number, sourceKind: string) => { for (const l of claims) l({ childSessionId: CHILD, messageId, turn, sourceKind }) }
  // Turn 4 exactly as recorded: memex reminder, the Delivery prompt (user), a time snapshot.
  claim('0ea790b3-6497-4456-a0d3-3526a5ac092f', 4, 'plugin:dsh-memex')
  claim(ASK_ROOT_MESSAGE, 4, 'user')
  claim('6dc575ff-4f32-498f-9067-53984db53e00', 4, 'time-context')
  for (const l of ends) l({ childSessionId: CHILD, turn: 4, outcome: 'completed' })
  // Turn 5: the answer arrives as the only claimed message.
  claim(RESULT_MESSAGE, 5, 'pet-inquiry-result')
  return observer
}

describe('replay: delivery-74 inquiry result turn (session-15859f3d)', () => {
  it('restores reply authority for the original Delivery on the result turn', () => {
    expect(replay().currentCapabilityForChild?.(CHILD)).toMatchObject({
      deliveryId: 'delivery-74', executionId: EXECUTION, turnId: `${CHILD}#5`, source: 'inquiry-result',
    })
  })

  it('still refuses once the Delivery deadline has passed', () => {
    expect(replay({ now: delivery74.deadlineAt + 1 }).currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('still refuses when the Delivery is no longer pending', () => {
    expect(replay({ deliveryStatus: 'completed' }).currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('still refuses when the child was rebuilt into a new generation', () => {
    expect(replay({ generation: 2 }).currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })
})
