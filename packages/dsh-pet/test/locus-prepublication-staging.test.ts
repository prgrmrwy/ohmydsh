import { describe, expect, it, vi } from 'vitest'
import {
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_FULL_ACCESS_TOOL_NAMES,
  LOCUS_SAFE_TOOL_NAMES,
  type LocusChildComposition,
  type LocusCompositionLookup,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'
import type { LocusAccessModeV20 } from '../src/host/locus/contract-v20.js'
import {
  createPrepublicationCompositionLookup,
  LocusPrepublicationError,
  LocusPrepublicationStagingRegistry,
} from '../src/host/locus/prepublication-staging.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'

function identity(overrides: Partial<LocusChildComposition> = {}) {
  return {
    locusMainSessionId: 'session-parent',
    locusId: 'locus-fresh',
    revision: 1,
    accessMode: 'read-only' as LocusAccessModeV20,
    endpoint: { chatId: 'oc-fresh' },
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

/** Compose ports whose restriction layer really narrows the visible surface. */
function composePorts(lookup: LocusCompositionLookup, overrides: Partial<NonNullable<LocusCompositionPorts['surface']>> = {}) {
  const visible = new Set([...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_FULL_ACCESS_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS])
  const applied = new Map<string, LocusAccessModeV20>()
  const applyAccessMode = vi.fn((_agent: unknown, mode: LocusAccessModeV20) => {
    if (mode === 'read-only') for (const name of LOCUS_FULL_ACCESS_TOOL_NAMES) visible.delete(name)
  })
  const ports: LocusCompositionPorts = {
    lookup,
    parentPreset: () => LOCUS_BASE_PRESET,
    childPreset: () => 'locus-child',
    writeEnabled: true,
    surface: { install: vi.fn(), applyAccessMode, installOutboundGuard: vi.fn(), visibleTools: () => [...visible], ...overrides },
    policy: { apply: (id, mode) => { applied.set(id, mode) }, resolve: id => applied.get(id) },
  }
  return { ports, visible, applyAccessMode }
}

describe('locus child pre-publication staging', () => {
  it.each(['read-only', 'danger-full-access'] as const)('composes a fresh staged child with the row accessMode %s', mode => {
    const staging = registry()
    const reservation = staging.reserve(identity({ accessMode: mode }))
    const lookup = createPrepublicationCompositionLookup({ durable: durableLookup(), staging })
    const { ports, visible, applyAccessMode } = composePorts(lookup)

    const result = composeLocusChild({ id: reservation.childSessionId, scope: { get: vi.fn() } }, ports)

    expect(result).toMatchObject({ composed: true, accessMode: mode, composition: { accessMode: mode } })
    expect(applyAccessMode).toHaveBeenCalledWith(expect.anything(), mode)
    expect([...visible].filter(name => LOCUS_FULL_ACCESS_TOOL_NAMES.includes(name))).toEqual(
      mode === 'read-only' ? [] : [...LOCUS_FULL_ACCESS_TOOL_NAMES],
    )
  })

  it.each(['durable', 'staged'] as const)('fails closed when the %s restriction layer cannot be installed', source => {
    const staging = registry()
    let id = 'session-durable-fail'
    const durable = new Map<string, LocusChildComposition>()
    if (source === 'durable') durable.set(id, { ...identity(), sessionId: id })
    else id = staging.reserve(identity()).childSessionId
    const lookup = createPrepublicationCompositionLookup({ durable: durableLookup(durable), staging })
    const { ports } = composePorts(lookup, { applyAccessMode: () => { throw new Error('restrict failed') } })
    expect(() => composeLocusChild({ id, scope: { get: vi.fn() } }, ports)).toThrow(/read-only restriction layer/)
  })

  it('lets the first synchronous agent/created composition claim a fresh child', () => {
    const staging = registry()
    const reservation = staging.reserve(identity())
    const lookup = createPrepublicationCompositionLookup({ durable: durableLookup(), staging })
    const { ports } = composePorts(lookup)
    const agent = { id: reservation.childSessionId, scope: { get: vi.fn() } }

    const result = composeLocusChild(agent, ports)

    expect(result).toEqual({
      composed: true,
      composition: {
        locusMainSessionId: 'session-parent',
        sessionId: 'session-fresh',
        locusId: 'locus-fresh',
        revision: 1,
        accessMode: 'read-only',
        endpoint: { chatId: 'oc-fresh' },
      },
      accessMode: 'read-only',
    })
    expect(ports.surface?.install).toHaveBeenCalledWith(agent, reservation.composition)
    expect(staging.inspect(reservation.childSessionId)?.state).toBe('claimed')
  })

  it('stages the reserved sessionId the durable row already carries (D16), never inventing another', () => {
    const staging = registry()
    const reservation = staging.reserve({ ...identity(), sessionId: 'session-reserved' })
    expect(reservation.childSessionId).toBe('session-reserved')
    expect(reservation.composition.sessionId).toBe('session-reserved')
  })

  it('carries the endpoint into the fresh composition, so a doc child is recognisable before its locus row exists', () => {
    const staging = registry()
    const reservation = staging.reserve({ ...identity(), endpoint: { chatId: 'doc:docx:Dx1', threadId: '77' } })

    expect(reservation.composition.endpoint).toEqual({ chatId: 'doc:docx:Dx1', threadId: '77' })
  })

  it.each(['read-only', 'danger-full-access'] as const)('composes a durable child with the row accessMode %s', mode => {
    const id = 'session-durable'
    const lookup = createPrepublicationCompositionLookup({
      durable: durableLookup(new Map([[id, { ...identity({ accessMode: mode }), sessionId: id }]])),
      staging: registry(),
    })
    const { ports, applyAccessMode } = composePorts(lookup)
    expect(composeLocusChild({ id, scope: { get: vi.fn() } }, ports)).toMatchObject({ composed: true, accessMode: mode })
    expect(applyAccessMode).toHaveBeenCalledOnce()
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
        revision: 9,
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

describe('pre-publication publication callbacks', () => {
  const callbacks = () => ({
    publish: vi.fn(async () => undefined),
    unpublish: vi.fn(async () => undefined),
  })

  it('publishes and commits the reservation before the first claim', async () => {
    const staging = registry()
    const publication = callbacks()
    const reservation = staging.reserve(identity(), publication)

    // Not claimed yet: publishing would run before composition was proven.
    await expect(staging.publishClaimed(reservation.childSessionId)).rejects.toMatchObject({ reason: 'claim-required' })
    expect(staging.claim(reservation.childSessionId)).toBe(reservation.composition)
    expect(staging.inspect(reservation.childSessionId)?.published).toBe(false)

    await staging.publishClaimed(reservation.childSessionId)

    expect(publication.publish).toHaveBeenCalledWith(reservation.childSessionId, reservation.composition)
    expect(staging.inspect(reservation.childSessionId)).toBeUndefined()
    expect(staging.activeCount).toBe(0)
    await staging.publishClaimed(reservation.childSessionId)
    expect(publication.publish).toHaveBeenCalledTimes(1)
  })

  it('leaves a child without a callback alone, and does not mark a failed publication as published', async () => {
    const plain = registry()
    const plainReservation = plain.reserve(identity())
    plain.claim(plainReservation.childSessionId)
    await expect(plain.publishClaimed(plainReservation.childSessionId)).resolves.toBeUndefined()
    await expect(plain.publishClaimed('session-unknown')).resolves.toBeUndefined()

    const staging = registry()
    const reservation = staging.reserve(identity(), {
      publish: async () => { throw new Error('store unavailable') },
      unpublish: vi.fn(async () => undefined),
    })
    staging.claim(reservation.childSessionId)
    await expect(staging.publishClaimed(reservation.childSessionId)).rejects.toThrow('store unavailable')
    expect(staging.inspect(reservation.childSessionId)?.published).toBe(false)
  })

  it('does not confuse a committed reservation with durable compensation', async () => {
    const staging = registry()
    const publication = callbacks()
    const reservation = staging.reserve(identity(), publication)
    staging.claim(reservation.childSessionId)

    await expect(staging.revertPublication(reservation.childSessionId)).resolves.toBe(false)
    expect(publication.unpublish).not.toHaveBeenCalled()

    await staging.publishClaimed(reservation.childSessionId)
    await expect(staging.revertPublication(reservation.childSessionId)).resolves.toBe(false)
    expect(publication.unpublish).not.toHaveBeenCalled()
    expect(staging.inspect(reservation.childSessionId)).toBeUndefined()
  })
})
