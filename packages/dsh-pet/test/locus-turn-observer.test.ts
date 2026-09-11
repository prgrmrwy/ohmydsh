import { describe, expect, it, vi } from 'vitest'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
  type LocusTurnCorrelationEvent,
  type LocusTurnEnd,
  type LocusTurnObserverDiagnostic,
} from '../src/host/locus/turn-observer.js'

const CHILD = 'child-1'

const correlation = {
  endpoint: { chatId: 'oc-project', threadId: 'omt-topic' },
  locusId: 'locus-1',
  generation: 2,
  childSessionId: CHILD,
}

/** Wire the observer to controllable runtime subscriptions. */
function harness(options: {
  readonly deliveries?: Record<string, { deliveryId: string; executionId: string }>
} = {}) {
  const claimListeners: ((claim: LocusInboxClaim) => void)[] = []
  const endListeners: ((end: LocusTurnEnd) => void)[] = []
  const released: string[] = []
  const diagnostics: LocusTurnObserverDiagnostic[] = []
  const events: LocusTurnCorrelationEvent[] = []
  const deliveries = options.deliveries ?? {
    'om-message-1': { deliveryId: 'delivery-1', executionId: 'execution-1' },
  }

  const observer = createLocusTurnObserver({
    onClaimed: (listener) => {
      claimListeners.push(listener)
      return () => { released.push('claimed') }
    },
    onTurnEnd: (listener) => {
      endListeners.push(listener)
      return () => { released.push('turn-end') }
    },
    lookup: {
      find: ({ childSessionId, messageId }) => {
        const match = deliveries[messageId]
        if (match === undefined || childSessionId !== CHILD) return undefined
        return { ...match, correlation }
      },
    },
    log: (code) => { diagnostics.push(code) },
  })
  observer.subscribe(event => { events.push(event) })

  return {
    observer,
    events,
    diagnostics,
    released,
    claim: (claim: LocusInboxClaim) => { for (const listener of claimListeners) listener(claim) },
    end: (end: LocusTurnEnd) => { for (const listener of endListeners) listener(end) },
  }
}

describe('per-turn Delivery correlation', () => {
  it('binds a claimed message to its exact turn and settles that turn', () => {
    const h = harness()

    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    expect(h.events).toEqual([
      {
        phase: 'started',
        deliveryId: 'delivery-1',
        executionId: 'execution-1',
        turnId: `${CHILD}#1`,
        correlation,
      },
      {
        phase: 'completed',
        deliveryId: 'delivery-1',
        executionId: 'execution-1',
        turnId: `${CHILD}#1`,
        correlation,
      },
    ])
    // A completed turn carries no failure reason.
    expect(h.events[1]).not.toHaveProperty('reason')
  })

  it('exposes an exact current-turn proof only while one Delivery is active', () => {
    const h = harness()
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()

    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 4 })
    expect(h.observer.currentForChild?.(CHILD)).toEqual({
      executionId: 'execution-1',
      turnId: `${CHILD}#4`,
    })

    h.end({ childSessionId: CHILD, turn: 4, outcome: 'completed' })
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('withholds current-turn proof when one child has ambiguous overlapping claims', () => {
    const h = harness({
      deliveries: {
        'om-message-1': { deliveryId: 'delivery-1', executionId: 'execution-1' },
        'om-message-2': { deliveryId: 'delivery-2', executionId: 'execution-2' },
      },
    })
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: 'om-message-2', turn: 2 })
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('reports a non-completed turn as failed with its runtime reason', () => {
    for (const [outcome, reason] of [
      ['aborted', 'user cancelled'],
      ['failed', undefined],
      ['blocked', undefined],
    ] as const) {
      const h = harness()
      h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })
      h.end({ childSessionId: CHILD, turn: 1, outcome, ...(reason === undefined ? {} : { reason }) })

      expect(h.events.at(-1)).toMatchObject({
        phase: 'failed',
        deliveryId: 'delivery-1',
        // Falls back to the outcome so a diagnosis is never empty.
        reason: reason ?? outcome,
      })
    }
  })

  it('settles each Delivery against its own turn when several are queued', () => {
    const h = harness({
      deliveries: {
        'om-first': { deliveryId: 'delivery-first', executionId: 'execution-first' },
        'om-second': { deliveryId: 'delivery-second', executionId: 'execution-second' },
      },
    })

    h.claim({ childSessionId: CHILD, messageId: 'om-first', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: 'om-second', turn: 2 })
    // Ends arrive out of order: correlation is by turn, never by FIFO order.
    h.end({ childSessionId: CHILD, turn: 2, outcome: 'completed' })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'failed' })

    expect(h.events.filter(event => event.phase !== 'started')).toEqual([
      {
        phase: 'completed',
        deliveryId: 'delivery-second',
        executionId: 'execution-second',
        turnId: `${CHILD}#2`,
        correlation,
      },
      {
        phase: 'failed',
        deliveryId: 'delivery-first',
        executionId: 'execution-first',
        turnId: `${CHILD}#1`,
        correlation,
        reason: 'failed',
      },
    ])
  })

  it('never consumes a Delivery for initialization, a GUI turn, or a real message', () => {
    const h = harness()

    // A claimed message the lookup does not recognize as a Delivery.
    h.claim({ childSessionId: CHILD, messageId: 'om-initialization', turn: 1 })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    expect(h.events).toEqual([])
    expect(h.diagnostics).toEqual(['claim-not-a-delivery', 'turn-without-delivery'])
  })

  it('does not settle a turn that never claimed a Delivery', () => {
    const h = harness()

    h.end({ childSessionId: CHILD, turn: 7, outcome: 'completed' })

    expect(h.events).toEqual([])
    expect(h.diagnostics).toEqual(['turn-without-delivery'])
  })

  it('settles one turn exactly once even if its end is reported twice', () => {
    const h = harness()
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })

    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'failed' })

    // A late duplicate must not overwrite a settled Delivery's outcome.
    expect(h.events.filter(event => event.phase !== 'started')).toHaveLength(1)
    expect(h.diagnostics).toEqual(['turn-already-ended'])
  })

  it('keeps turns of different children apart', () => {
    const h = harness()
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })

    // Same turn NUMBER on another child: turn ids are per session.
    h.end({ childSessionId: 'child-other', turn: 1, outcome: 'completed' })

    expect(h.events.filter(event => event.phase !== 'started')).toEqual([])
    expect(h.diagnostics).toEqual(['turn-without-delivery'])
  })

  it('refuses malformed claims and turn ends instead of guessing', () => {
    const h = harness()

    h.claim({ childSessionId: '', messageId: 'om-message-1', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: '', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 0 })
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1.5 })
    h.end({ childSessionId: CHILD, turn: 0, outcome: 'completed' })
    h.end({ childSessionId: '', turn: 1, outcome: 'completed' })

    expect(h.events).toEqual([])
    expect(h.diagnostics).toEqual([
      'claim-invalid', 'claim-invalid', 'claim-invalid', 'claim-invalid',
      'turn-invalid', 'turn-invalid',
    ])
  })

  it('treats an unusable lookup as unproven rather than binding a guess', () => {
    const claimListeners: ((claim: LocusInboxClaim) => void)[] = []
    const diagnostics: LocusTurnObserverDiagnostic[] = []
    const events: LocusTurnCorrelationEvent[] = []
    const observer = createLocusTurnObserver({
      onClaimed: (listener) => { claimListeners.push(listener); return () => {} },
      onTurnEnd: () => () => {},
      lookup: { find: () => { throw new Error('store unavailable') } },
      log: (code) => { diagnostics.push(code) },
    })
    observer.subscribe(event => { events.push(event) })

    for (const listener of claimListeners) {
      listener({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })
    }

    expect(events).toEqual([])
    expect(diagnostics).toEqual(['claim-invalid'])
  })

  it('contains a failing consumer so other Deliveries still settle', () => {
    const h = harness({
      deliveries: {
        'om-first': { deliveryId: 'delivery-first', executionId: 'execution-first' },
      },
    })
    const seen: string[] = []
    h.observer.subscribe(() => { throw new Error('consumer failed') })
    h.observer.subscribe(event => { seen.push(event.phase) })

    h.claim({ childSessionId: CHILD, messageId: 'om-first', turn: 1 })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    expect(seen).toEqual(['started', 'completed'])
  })

  it('releases both runtime subscriptions on dispose and stops emitting', () => {
    const h = harness()
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })

    h.observer.dispose()
    h.observer.dispose()
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    expect(h.released).toEqual(['claimed', 'turn-end'])
    expect(h.events.filter(event => event.phase !== 'started')).toEqual([])
  })

  it('declares itself as a per-turn observer', () => {
    // The locus controller refuses an activation-only observer, so this flag
    // is the capability gate rather than a cosmetic marker.
    expect(harness().observer.perTurnCorrelation).toBe(true)
  })

  it('stops delivering to an unsubscribed consumer', () => {
    const h = harness()
    const seen: string[] = []
    const release = h.observer.subscribe(event => { seen.push(event.phase) })

    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1 })
    release()
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    expect(seen).toEqual(['started'])
  })
})

describe('observer subscription order', () => {
  it('subscribes to the runtime before any Delivery can be claimed', () => {
    const order: string[] = []
    const observer = createLocusTurnObserver({
      onClaimed: () => { order.push('claimed'); return () => {} },
      onTurnEnd: () => { order.push('turn-end'); return () => {} },
      lookup: { find: vi.fn(() => undefined) },
    })

    // Both subscriptions are attached during construction: a claim reported
    // before the queueing call returns would otherwise be missed, leaving that
    // Delivery permanently unable to settle.
    expect(order).toEqual(['claimed', 'turn-end'])
    observer.dispose()
  })
})
