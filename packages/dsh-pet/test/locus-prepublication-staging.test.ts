import { describe, expect, it, vi } from 'vitest'
import {
  composeLocusChild,
  type LocusChildComposition,
  type LocusCompositionLookup,
} from '../src/host/locus/composition.js'
import {
  createPrepublicationCompositionLookup,
  LocusPrepublicationError,
  LocusPrepublicationStagingRegistry,
} from '../src/host/locus/prepublication-staging.js'

function identity(overrides: Partial<LocusChildComposition> = {}) {
  return {
    parentSessionId: 'session-parent',
    locusId: 'locus-fresh',
    generation: 1,
    permission: 'read' as const,
    ...overrides,
  }
}

function registry(options: {
  now?: () => number
  ttlMs?: number
  capacity?: number
  childIds?: readonly string[]
  reservationIds?: readonly string[]
} = {}) {
  const children = [...(options.childIds ?? ['session-fresh'])]
  const reservations = [...(options.reservationIds ?? ['stage-fresh'])]
  return new LocusPrepublicationStagingRegistry({
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
    createChildSessionId: () => children.shift() ?? 'session-fallback',
    createReservationId: () => reservations.shift() ?? 'stage-fallback',
  })
}

function durableLookup(records = new Map<string, LocusChildComposition>()): LocusCompositionLookup {
  return { find: childSessionId => records.get(childSessionId) }
}

function expectReason(action: () => unknown, reason: LocusPrepublicationError['reason']): void {
  try {
    action()
    expect.unreachable(`expected ${reason}`)
  } catch (error) {
    expect(error).toBeInstanceOf(LocusPrepublicationError)
    expect((error as LocusPrepublicationError).reason).toBe(reason)
  }
}

describe('locus child pre-publication staging', () => {
  it('lets the first synchronous agent/created composition claim a fresh child', () => {
    const staging = registry()
    const reservation = staging.reserve(identity())
    const lookup = createPrepublicationCompositionLookup({
      durable: durableLookup(),
      staging,
    })
    const applied = new Map<string, 'read' | 'write'>()
    const install = vi.fn()
    const agent = { sessionId: reservation.childSessionId, scope: { get: vi.fn() } }

    const result = composeLocusChild(agent, {
      lookup,
      surface: { install },
      policy: {
        apply: (sessionId, permission) => { applied.set(sessionId, permission) },
        resolve: sessionId => applied.get(sessionId),
      },
    })

    expect(result).toEqual({
      composed: true,
      composition: {
        parentSessionId: 'session-parent',
        childSessionId: 'session-fresh',
        locusId: 'locus-fresh',
        generation: 1,
        permission: 'read',
      },
      effectivePermission: 'read',
    })
    expect(install).toHaveBeenCalledWith(agent)
    expect(staging.inspect(reservation.childSessionId)?.state).toBe('claimed')
  })

  it('hands lookup to durable identity after durable publish then commit', () => {
    const staging = registry()
    const reservation = staging.reserve(identity())
    const durable = new Map<string, LocusChildComposition>()
    const lookup = createPrepublicationCompositionLookup({
      durable: durableLookup(durable),
      staging,
    })

    expect(lookup.find(reservation.childSessionId)).toEqual(reservation.composition)
    // Durable publication is the truth transition; commit only removes the
    // process-local bridge after that write has succeeded.
    durable.set(reservation.childSessionId, reservation.composition)
    staging.commit(reservation)

    expect(staging.activeCount).toBe(0)
    expect(staging.inspect(reservation.childSessionId)).toBeUndefined()
    expect(lookup.find(reservation.childSessionId)).toBe(reservation.composition)
  })

  it('aborts reserved and claimed entries without leaving a lookup hit', () => {
    for (const claimFirst of [false, true]) {
      const staging = registry({
        childIds: [`session-abort-${String(claimFirst)}`],
        reservationIds: [`stage-abort-${String(claimFirst)}`],
      })
      const reservation = staging.reserve(identity())
      if (claimFirst) expect(staging.claim(reservation.childSessionId)).toBe(reservation.composition)

      staging.abort(reservation)

      expect(staging.activeCount).toBe(0)
      expect(staging.inspect(reservation.childSessionId)).toBeUndefined()
      expect(staging.claim(reservation.childSessionId)).toBeUndefined()
    }
  })

  it('fails closed on duplicate claims and invalid lifecycle transitions', () => {
    const staging = registry()
    const reservation = staging.reserve(identity())

    expect(staging.claim(reservation.childSessionId)).toBe(reservation.composition)
    expectReason(() => staging.claim(reservation.childSessionId), 'already-claimed')
    staging.commit(reservation)
    expectReason(() => staging.commit(reservation), 'already-committed')
    expectReason(() => staging.abort(reservation), 'already-committed')

    const unclaimed = registry({ childIds: ['session-unclaimed'], reservationIds: ['stage-unclaimed'] })
    const unclaimedReservation = unclaimed.reserve(identity())
    expectReason(() => unclaimed.commit(unclaimedReservation), 'claim-required')
    unclaimed.abort(unclaimedReservation)
    expectReason(() => unclaimed.abort(unclaimedReservation), 'already-aborted')
  })

  it('never lets ordinary or old unreserved children hit staging', () => {
    const staging = registry()
    staging.reserve(identity())
    const lookup = createPrepublicationCompositionLookup({
      durable: durableLookup(),
      staging,
    })

    expect(lookup.find('session-ordinary')).toBeUndefined()
    expect(lookup.find('session-old-locus-child')).toBeUndefined()
    expect(staging.activeCount).toBe(1)
  })

  it('rejects durable/staging identity conflicts before consuming the claim', () => {
    const staging = registry()
    const reservation = staging.reserve(identity())
    const durable = new Map<string, LocusChildComposition>([
      [reservation.childSessionId, {
        ...reservation.composition,
        locusId: 'locus-old',
        generation: 9,
      }],
    ])
    const lookup = createPrepublicationCompositionLookup({
      durable: durableLookup(durable),
      staging,
    })

    expectReason(() => lookup.find(reservation.childSessionId), 'durable-stage-conflict')
    expect(staging.inspect(reservation.childSessionId)?.state).toBe('reserved')
  })

  it('does not expire a claimed child while its external provisioning is slow', () => {
    let now = 100
    const staging = registry({ now: () => now, ttlMs: 10 })
    const reservation = staging.reserve(identity())
    expect(staging.claim(reservation.childSessionId)).toEqual(reservation.composition)

    now = reservation.expiresAt + 10_000
    expect(staging.sweepExpired()).toBe(0)
    expect(staging.inspect(reservation.childSessionId)?.state).toBe('claimed')
    expect(() => staging.commit(reservation)).not.toThrow()
  })

  it('bounds capacity and expires abandoned reservations without leaks', () => {
    let now = 100
    const staging = registry({
      now: () => now,
      ttlMs: 10,
      capacity: 1,
      childIds: ['session-first', 'session-second'],
      reservationIds: ['stage-first', 'stage-second'],
    })
    const first = staging.reserve(identity())
    expect(staging.activeCount).toBe(1)
    expectReason(() => staging.reserve(identity({ locusId: 'locus-over-capacity' })), 'capacity-exceeded')

    now = first.expiresAt
    expect(staging.sweepExpired()).toBe(1)
    expect(staging.activeCount).toBe(0)
    expect(staging.inspect(first.childSessionId)).toBeUndefined()
    expectReason(() => staging.commit(first), 'reservation-expired')

    const second = staging.reserve(identity({ locusId: 'locus-second' }))
    expect(second.childSessionId).toBe('session-second')
    expect(staging.activeCount).toBe(1)
    staging.abort(second)
    expect(staging.activeCount).toBe(0)
  })

  it('rejects generated id collisions and clears all live entries on dispose', () => {
    const staging = registry({
      capacity: 2,
      childIds: ['session-same', 'session-same'],
      reservationIds: ['stage-one', 'stage-two'],
    })
    staging.reserve(identity())
    expectReason(() => staging.reserve(identity({ locusId: 'locus-other' })), 'child-id-conflict')
    expect(staging.activeCount).toBe(1)

    staging.dispose()
    expect(staging.activeCount).toBe(0)
    expectReason(() => staging.reserve(identity()), 'registry-disposed')
    expectReason(() => staging.claim('session-same'), 'registry-disposed')
  })
})
