/**
 * RED-FIRST tests for the pet-inquiry / pet-inquiry-result source kinds in the
 * locus turn observer (change: restore-pet-inquiry-runtime-channel, D4a/D4b and
 * "询问执行和续进不得改变权限或回复归属").
 *
 * EXPECTED API (does not exist yet; this is the design under test):
 *
 *   createLocusTurnObserver({
 *     ...existing ports,
 *     inquiryResult: {
 *       // Synchronous, Host-owned, read-only. Called ONLY for a claim whose
 *       // sourceKind === 'pet-inquiry-result'. Returns the ORIGINAL Delivery
 *       // iff the Host can prove from durable rows that:
 *       //   handoffs.findByMessageId(messageId) is a `result` handoff for an
 *       //   inquiry whose requester is this child at this locus/generation,
 *       //   whose work is local{sessionId: child, workId} and that workId is the
 *       //   inbox message id of exactly one Delivery of this child/locus/
 *       //   generation that is still pending ('current'/'finishing') and not
 *       //   deadline-expired. Anything else => undefined (or throw).
 *       prove(input: { childSessionId: string; messageId: string }): LocusClaimedDelivery | undefined
 *     }
 *   })
 *
 * and a new capability source `'inquiry-result'` (never `'agent-message'`,
 * never `'delivery'`) so the lineage stays auditable and a generic
 * agent-message can not be confused with it.
 *
 * Case A and C/D are SAFETY REGRESSION guards: they pass today (fail-closed via
 * foreign+mixed) and must keep passing after the feature lands. Case B is the
 * only behaviour that is expected to be red until the port exists.
 */
import { describe, expect, it } from 'vitest'
import {
  createLocusTurnObserver,
  type LocusClaimedDelivery,
  type LocusInboxClaim,
  type LocusTurnEnd,
} from '../src/host/locus/turn-observer.js'

const CHILD = 'child-1'
const correlation = {
  endpoint: { chatId: 'oc-project', threadId: 'omt-topic' },
  locusId: 'locus-1',
  generation: 2,
  childSessionId: CHILD,
}
const DELIVERY_MESSAGE = 'om-message-1'
const original: LocusClaimedDelivery = {
  deliveryId: 'delivery-1',
  executionId: 'execution-1',
  correlation,
  status: 'current',
}

interface ProveInput { readonly childSessionId: string; readonly messageId: string }

function harness(options: {
  /** Fake of the NOT-YET-EXISTING `inquiryResult.prove` port. */
  readonly prove?: (input: ProveInput) => LocusClaimedDelivery | undefined
} = {}) {
  const claimListeners: ((claim: LocusInboxClaim) => void)[] = []
  const endListeners: ((end: LocusTurnEnd) => void)[] = []
  const proveCalls: ProveInput[] = []
  const ports = {
    onClaimed: (listener: (claim: LocusInboxClaim) => void) => {
      claimListeners.push(listener)
      return () => undefined
    },
    onTurnEnd: (listener: (end: LocusTurnEnd) => void) => {
      endListeners.push(listener)
      return () => undefined
    },
    lookup: {
      find: ({ childSessionId, messageId }: ProveInput) =>
        childSessionId === CHILD && messageId === DELIVERY_MESSAGE
          ? { deliveryId: original.deliveryId, executionId: original.executionId, correlation }
          : undefined,
    },
    // Extra port is ignored by today's observer (no TypeError), honoured by the future one.
    inquiryResult: {
      prove: (input: ProveInput) => {
        proveCalls.push(input)
        return options.prove?.(input)
      },
    },
  }
  const observer = createLocusTurnObserver(ports as never)
  return {
    observer,
    proveCalls,
    claim: (claim: LocusInboxClaim) => { for (const l of claimListeners) l(claim) },
    end: (end: LocusTurnEnd) => { for (const l of endListeners) l(end) },
  }
}

/** Original Feishu Delivery turn 1 runs and ends; the child then waits for an inquiry answer. */
function runOriginalTurn(h: ReturnType<typeof harness>): void {
  h.claim({ childSessionId: CHILD, messageId: DELIVERY_MESSAGE, turn: 1, sourceKind: 'user' })
  h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
}

describe('A. target inquiry turn never gains reply authority (must stay red-free)', () => {
  it('a Delivery turn that also claims a pet-inquiry message has no capability', () => {
    // Even if a (buggy) proof port would vouch for the message id, pet-inquiry is
    // never a result-proof source.
    const h = harness({ prove: () => original })
    h.claim({ childSessionId: CHILD, messageId: DELIVERY_MESSAGE, turn: 1, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'inq-target-msg', turn: 1, sourceKind: 'pet-inquiry' })
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.proveCalls).toEqual([])
  })

  it('a stand-alone pet-inquiry turn after a Delivery turn has no capability', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-target-msg', turn: 2, sourceKind: 'pet-inquiry' })
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.proveCalls).toEqual([])
  })
})

describe('B. result turn restores the original Delivery capability only with proof (RED until implemented)', () => {
  it('currentCapabilityForChild returns the original Delivery with source inquiry-result', () => {
    const h = harness({ prove: input => input.messageId === 'inq-result-msg' ? original : undefined })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      turnId: `${CHILD}#2`,
      correlation,
      source: 'inquiry-result',
    })
  })

  it('currentForChild exposes the exact execution/turn so the reply authorizer can match it', () => {
    // context-repository.inspectCurrentDeliveryAuthorization compares
    // currentForChild() to the proof's executionId/turnId, so this must follow.
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    expect(h.observer.currentForChild?.(CHILD)).toEqual({ executionId: 'execution-1', turnId: `${CHILD}#2` })
  })

  it('the proof is consulted for the exact child and result message only', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    expect(h.proveCalls).toEqual([{ childSessionId: CHILD, messageId: 'inq-result-msg' }])
  })

  it('durable finish/expiry revokes the result-turn capability', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    // Prove the capability really existed before the revoke, so the final
    // assertion is not vacuously satisfied by a feature that never granted it.
    expect(h.observer.currentCapabilityForChild?.(CHILD)?.source).toBe('inquiry-result')
    expect(h.observer.currentForChild?.(CHILD)).toEqual({ executionId: 'execution-1', turnId: `${CHILD}#2` })
    h.observer.revokeCurrentCapability?.({ childSessionId: CHILD, deliveryId: 'delivery-1' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })
})

describe('C. result turn without a valid original Delivery has no capability (must not be relaxed)', () => {
  const resultTurn = (h: ReturnType<typeof harness>) => {
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
  }

  it('no proof at all (GUI/local origin or unknown work)', () => {
    const h = harness({ prove: () => undefined })
    resultTurn(h)
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('proof port throws', () => {
    const h = harness({ prove: () => { throw new Error('store unreadable') } })
    resultTurn(h)
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('original Delivery is terminal / expired', () => {
    for (const status of ['settled', 'failed', 'replied', 'no-reply', 'expired', 'unknown-terminal'] as const) {
      const h = harness({ prove: () => ({ ...original, status }) })
      resultTurn(h)
      expect(h.observer.currentCapabilityForChild?.(CHILD), status).toBeUndefined()
    }
  })

  it('proof names a Delivery of another child / generation (rebuilt member)', () => {
    const otherChild = harness({ prove: () => ({ ...original, correlation: { ...correlation, childSessionId: 'child-2' } }) })
    resultTurn(otherChild)
    expect(otherChild.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('result arrives after the Delivery lineage was revoked', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.observer.revokeCurrentCapability?.({ childSessionId: CHILD, deliveryId: 'delivery-1' })
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('an agent-message alone is not upgraded into an inquiry-result proof', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'agent-message' })
    const capability = h.observer.currentCapabilityForChild?.(CHILD)
    // Existing behaviour may grant source 'agent-message'; it must never be 'inquiry-result'.
    expect(capability?.source).not.toBe('inquiry-result')
    expect(h.proveCalls).toEqual([])
  })
})

describe('D. result turn mixed with other traffic has no capability (must not be relaxed)', () => {
  it('GUI user message in the same turn (result first)', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    h.claim({ childSessionId: CHILD, messageId: 'gui-steer', turn: 2, sourceKind: 'user' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('GUI user message in the same turn (GUI first)', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'gui-steer', turn: 2, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('a target pet-inquiry message sharing the result turn', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    h.claim({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    h.claim({ childSessionId: CHILD, messageId: 'inq-target-msg', turn: 2, sourceKind: 'pet-inquiry' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })
})

describe('E. observer-side fail-closed checks on a returned proof', () => {
  const resultClaim = (h: ReturnType<typeof harness>, messageId: string, turn = 2) =>
    h.claim({ childSessionId: CHILD, messageId, turn, sourceKind: 'pet-inquiry-result' })

  it('proof naming a different Delivery / execution / generation is refused', () => {
    for (const bad of [
      { ...original, deliveryId: 'delivery-2' },
      { ...original, executionId: 'execution-2' },
      { ...original, correlation: { ...correlation, generation: 3 } },
      { ...original, correlation: { ...correlation, locusId: 'locus-2' } },
    ]) {
      const h = harness({ prove: () => bad })
      runOriginalTurn(h)
      resultClaim(h, 'inq-result-msg')
      expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    }
  })

  it('two proven results in one turn are mixed, not split', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    resultClaim(h, 'inq-result-a')
    resultClaim(h, 'inq-result-b')
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('a result claimed on the original or an earlier turn number is refused', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    resultClaim(h, 'inq-result-msg', 1)
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('without the proof port a result turn stays unauthorised', () => {
    const claimListeners: ((claim: LocusInboxClaim) => void)[] = []
    const endListeners: ((end: LocusTurnEnd) => void)[] = []
    const observer = createLocusTurnObserver({
      onClaimed: l => { claimListeners.push(l); return () => undefined },
      onTurnEnd: l => { endListeners.push(l); return () => undefined },
      lookup: { find: () => ({ deliveryId: 'delivery-1', executionId: 'execution-1', correlation }) },
    })
    for (const l of claimListeners) l({ childSessionId: CHILD, messageId: DELIVERY_MESSAGE, turn: 1, sourceKind: 'user' })
    for (const l of endListeners) l({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
    for (const l of claimListeners) l({ childSessionId: CHILD, messageId: 'inq-result-msg', turn: 2, sourceKind: 'pet-inquiry-result' })
    expect(observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })

  it('a refused result does not poison a later proven result on a new turn', () => {
    let allow = false
    const h = harness({ prove: () => allow ? original : undefined })
    runOriginalTurn(h)
    resultClaim(h, 'inq-result-a', 2)
    h.end({ childSessionId: CHILD, turn: 2, outcome: 'completed' })
    allow = true
    resultClaim(h, 'inq-result-b', 3)
    expect(h.observer.currentCapabilityForChild?.(CHILD)?.source).toBe('inquiry-result')
  })

  it('a user claim arriving after a proven result (same turn) revokes authority', () => {
    const h = harness({ prove: () => original })
    runOriginalTurn(h)
    resultClaim(h, 'inq-result-msg')
    h.claim({ childSessionId: CHILD, messageId: DELIVERY_MESSAGE, turn: 2, sourceKind: 'user' })
    expect(h.observer.currentCapabilityForChild?.(CHILD)).toBeUndefined()
  })
})
