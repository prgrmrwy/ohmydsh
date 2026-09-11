import { describe, expect, it, vi } from 'vitest'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
  type LocusTurnCorrelationEvent,
  type LocusTurnEnd,
  type LocusTurnObserverDiagnostic,
  type LocusTurnObserverLimits,
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
  readonly limits?: LocusTurnObserverLimits
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
  }, options.limits)
  observer.subscribe(event => { events.push(event) })

  return {
    observer,
    events,
    diagnostics,
    released,
    claim: (claim: LocusInboxClaim) => { for (const listener of claimListeners) listener(claim) },
    end: (end: LocusTurnEnd) => { for (const listener of endListeners) listener(end) },
    available: (messageId: string, childSessionId = CHILD) => {
      observer.deliveryAvailable?.({ childSessionId, messageId })
    },
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

  it('keeps a Delivery-plus-foreign turn fail-closed while settling the proven Delivery', () => {
    const h = harness()
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 5 })
    expect(h.observer.currentForChild?.(CHILD)).toEqual({
      executionId: 'execution-1',
      turnId: `${CHILD}#5`,
    })

    h.claim({ childSessionId: CHILD, messageId: 'gui-steer', turn: 5 })
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
    h.end({ childSessionId: CHILD, turn: 5, outcome: 'completed' })

    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
    expect(h.events.filter(event => event.phase === 'completed')).toHaveLength(1)
    expect(h.diagnostics).not.toContain('claim-not-a-delivery')
  })

  it('keeps a steer-first turn mixed when a proven Delivery claim follows', () => {
    const h = harness()
    h.claim({ childSessionId: CHILD, messageId: 'parent-steer', turn: 6 })
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 6 })
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()

    h.end({ childSessionId: CHILD, turn: 6, outcome: 'completed' })
    expect(h.events.filter(event => event.phase === 'completed')).toHaveLength(1)
  })

  it('tracks unresolved claims by exact message instead of overwriting by turn', () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {}
    const h = harness({ deliveries })
    h.claim({ childSessionId: CHILD, messageId: 'early-delivery', turn: 8 })
    h.claim({ childSessionId: CHILD, messageId: 'foreign-steer', turn: 8 })
    h.end({ childSessionId: CHILD, turn: 8, outcome: 'completed' })

    deliveries['early-delivery'] = { deliveryId: 'delivery-early', executionId: 'execution-early' }
    h.available('early-delivery')
    expect(h.events).toEqual([
      expect.objectContaining({ phase: 'started', deliveryId: 'delivery-early', turnId: `${CHILD}#8` }),
      expect.objectContaining({ phase: 'completed', deliveryId: 'delivery-early', turnId: `${CHILD}#8` }),
    ])
    // A notification for another message cannot consume the retained steer.
    h.available('foreign-steer', 'other-child')
    expect(h.events).toHaveLength(2)
  })

  it('withholds a turn that claims more than one Delivery message', () => {
    const h = harness({
      deliveries: {
        'om-message-1': { deliveryId: 'delivery-1', executionId: 'execution-1' },
        'om-message-2': { deliveryId: 'delivery-2', executionId: 'execution-2' },
      },
    })
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 9 })
    expect(h.observer.currentForChild?.(CHILD)).toEqual({
      executionId: 'execution-1', turnId: `${CHILD}#9`,
    })

    h.claim({ childSessionId: CHILD, messageId: 'om-message-2', turn: 9 })
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

  it('never consumes a Delivery for initialization, a GUI turn, or a real message', async () => {
    const h = harness()

    h.claim({ childSessionId: CHILD, messageId: 'om-initialization', turn: 1 })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
    await new Promise(resolve => setTimeout(resolve, 280))

    expect(h.events).toEqual([])
    // Time does not guess that an unresolved claim is foreign.
    expect(h.diagnostics).toEqual([])
  })

  it('correlates end-before-bind after a delay beyond the former 200ms window', async () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {}
    const h = harness({ deliveries })

    h.claim({ childSessionId: CHILD, messageId: 'inbox-race', turn: 3 })
    h.end({ childSessionId: CHILD, turn: 3, outcome: 'completed' })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(h.events).toEqual([])

    deliveries['inbox-race'] = { deliveryId: 'delivery-race', executionId: 'execution-race' }
    h.available('inbox-race')

    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
    expect(h.events).toEqual([
      expect.objectContaining({ phase: 'started', deliveryId: 'delivery-race', turnId: `${CHILD}#3` }),
      expect.objectContaining({ phase: 'completed', deliveryId: 'delivery-race', turnId: `${CHILD}#3` }),
    ])
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

  it('bounds retained turns and evicts the oldest correlation fail-closed', () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {}
    const h = harness({ deliveries, limits: { maxObservedTurns: 2 } })
    h.claim({ childSessionId: CHILD, messageId: 'old', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: 'middle', turn: 2 })
    h.claim({ childSessionId: CHILD, messageId: 'new', turn: 3 })
    expect(h.diagnostics).toEqual(['correlation-evicted'])

    deliveries.old = { deliveryId: 'delivery-old', executionId: 'execution-old' }
    h.available('old')
    expect(h.events).toEqual([])
  })

  it('bounds claims per turn without promoting overflow to a Delivery', () => {
    const h = harness({ deliveries: {}, limits: { maxClaimsPerTurn: 2 } })
    h.claim({ childSessionId: CHILD, messageId: 'one', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: 'two', turn: 1 })
    h.claim({ childSessionId: CHILD, messageId: 'three', turn: 1 })
    expect(h.diagnostics).toEqual(['turn-claim-limit'])
  })

  it('releases subscriptions and drops unresolved indexes on dispose', () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {}
    const h = harness({ deliveries })
    h.claim({ childSessionId: CHILD, messageId: 'late', turn: 1 })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    h.observer.dispose()
    h.observer.dispose()
    deliveries.late = { deliveryId: 'delivery-late', executionId: 'execution-late' }
    h.available('late')

    expect(h.released).toEqual(['claimed', 'turn-end'])
    expect(h.events).toEqual([])
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

describe('Host-injected context does not poison reply authority', () => {
  // DSH seeds every session's FIRST step with workspace instructions, a
  // runtime-context snapshot and the skill catalog. They ride the same
  // `agent/inbox/claimed` feed as real traffic, so the observer used to mark
  // the turn mixed and withhold reply authority — which made the FIRST Feishu
  // message of every locus child unanswerable.
  const HOST_KINDS = ['agent-instructions', 'plugin', 'skill-catalog'] as const

  it('keeps reply authority when the real first turn carries Host context', () => {
    const h = harness()

    // Exactly the observed production sequence: one Delivery plus the three
    // injected messages, all claimed into turn 1.
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1, sourceKind: 'user' })
    for (const [index, kind] of HOST_KINDS.entries()) {
      h.claim({ childSessionId: CHILD, messageId: `injected-${String(index)}`, turn: 1, sourceKind: kind })
    }

    expect(h.observer.currentForChild?.(CHILD)).toEqual({
      executionId: 'execution-1',
      turnId: `${CHILD}#1`,
    })
  })

  it.each(HOST_KINDS)('ignores a %s claim instead of retaining it as foreign', (kind) => {
    const h = harness()

    h.claim({ childSessionId: CHILD, messageId: 'injected', turn: 1, sourceKind: kind })

    // Ignored outright: it never creates a turn, so a turn that only ever saw
    // Host context still reports no Delivery.
    expect(h.diagnostics).toContain('claim-host-context')
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('still settles the Delivery normally when Host context shared the turn', () => {
    const h = harness()

    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'injected', turn: 1, sourceKind: 'plugin' })
    h.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

    expect(h.events.map(event => event.phase)).toEqual(['started', 'completed'])
  })

  it('still withholds authority for a user-sourced non-Delivery (GUI or parent steer)', () => {
    const h = harness()

    // The guard must stay fail-closed for traffic that CAN carry another
    // target. Only Host-injected context is exempt.
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'gui-prompt', turn: 1, sourceKind: 'user' })

    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('treats an unreported source as participant traffic', () => {
    const h = harness()

    // An unknown source must not silently gain reply authority.
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'unknown-source', turn: 1 })

    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })
})

describe('queue-before-bind race does not permanently strip reply authority', () => {
  // The structural ordering: `queueChild` wakes the driver the moment the
  // prompt enters the inbox, while `bindQueued` persists the inbox-message
  // binding only after that call returns. The claim therefore usually fires
  // BEFORE the Delivery row is visible. Branding the turn mixed at that
  // instant made every locus Delivery permanently unanswerable — observed in
  // production twice in a row (child session-a12149c6, turns 1 and 2).
  it('restores authority once deliveryAvailable proves the sole claim was this Delivery', () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {}
    const h = harness({ deliveries })

    // Claim arrives first: the durable row is not visible yet.
    h.claim({ childSessionId: CHILD, messageId: 'raced', turn: 1, sourceKind: 'user' })
    // While unresolved, authority is withheld — fail closed.
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()

    // bindQueued commits, then wakes this exact message.
    deliveries['raced'] = { deliveryId: 'delivery-raced', executionId: 'execution-raced' }
    h.available('raced')

    // The turn is mid-flight (no end yet) with exactly one proven Delivery:
    // the reply tool must regain its target.
    expect(h.observer.currentForChild?.(CHILD)).toEqual({
      executionId: 'execution-raced',
      turnId: `${CHILD}#1`,
    })
    expect(h.events).toEqual([
      expect.objectContaining({ phase: 'started', deliveryId: 'delivery-raced' }),
    ])
  })

  it('keeps withholding while the claim is still unresolved', () => {
    const h = harness({ deliveries: {} })

    h.claim({ childSessionId: CHILD, messageId: 'still-pending', turn: 1, sourceKind: 'user' })

    // Not branded mixed, but not authorized either: unresolved withholds.
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('never restores authority for participant traffic that resolves to no Delivery', () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {
      'om-message-1': { deliveryId: 'delivery-1', executionId: 'execution-1' },
    }
    const h = harness({ deliveries })

    // One real Delivery plus one GUI prompt in the same turn. The GUI claim
    // never gains a durable row, so it stays unresolved and keeps the turn
    // withheld even after the real Delivery resolves.
    h.claim({ childSessionId: CHILD, messageId: 'om-message-1', turn: 1, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'gui-prompt', turn: 1, sourceKind: 'user' })
    h.available('om-message-1')

    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('brands the turn once a second Delivery is proven, and never unbrands', () => {
    const deliveries: Record<string, { deliveryId: string; executionId: string }> = {
      'om-a': { deliveryId: 'delivery-a', executionId: 'execution-a' },
      'om-b': { deliveryId: 'delivery-b', executionId: 'execution-b' },
    }
    const h = harness({ deliveries })

    h.claim({ childSessionId: CHILD, messageId: 'om-a', turn: 1, sourceKind: 'user' })
    h.claim({ childSessionId: CHILD, messageId: 'om-b', turn: 1, sourceKind: 'user' })

    // Two proven Deliveries in one turn is real pollution: no reply authority.
    expect(h.observer.currentForChild?.(CHILD)).toBeUndefined()
  })

  it('a lookup failure still brands the turn permanently', () => {
    const h = harness()
    const raced = { deliveryId: 'delivery-raced', executionId: 'execution-raced' }
    const deliveries: Record<string, { deliveryId: string; executionId: string } | undefined> = {}

    const throwing = harness({
      deliveries: new Proxy({}, {
        get: (_t, key: string) => {
          if (key === 'boom') throw new Error('lookup infrastructure failed')
          return deliveries[key]
        },
      }) as never,
    })

    throwing.claim({ childSessionId: CHILD, messageId: 'boom', turn: 1, sourceKind: 'user' })
    // Failure is proven pollution: even a later clean Delivery cannot restore.
    deliveries['om-late'] = raced
    throwing.claim({ childSessionId: CHILD, messageId: 'om-late', turn: 1, sourceKind: 'user' })

    expect(throwing.observer.currentForChild?.(CHILD)).toBeUndefined()
    void h
  })
})
