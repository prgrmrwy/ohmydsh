/**
 * An in-memory stand-in for owner A's four first-publication writes
 * (`LocusRepositoryPortV20`), modelling exactly the contract semantics (D15,
 * D16) on one entry row and its Deliveries. Owner C's tests use it until the
 * real `LocusRepositoryV20` lands all four; it is not a second implementation
 * to keep in sync — every rule here is a line of the contract doc comment.
 */
import type { LocusAccessModeV20, LocusStateV20 } from '../../src/host/locus/contract-v20.js'
import type { FirstDeliveryPublicationRepository } from '../../src/host/locus/first-delivery-publication.js'

export interface FakeRow {
  locusId: string
  sessionId: string
  revision: number
  state: LocusStateV20
  accessMode: LocusAccessModeV20
  verifiedAt?: number
}

export interface FakeDelivery {
  sessionId: string
  status: 'current' | 'accepted' | 'failed'
  executionId?: string
  imageRouteRejected?: true
}

function refuse(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

export function firstPublicationRepo(initial: Partial<FakeRow> = {}) {
  const row: FakeRow = { locusId: 'locus-1', sessionId: 'session-reserved-0', revision: 1, state: 'not-created', accessMode: 'read-only', ...initial }
  const deliveries = new Map<string, FakeDelivery>()
  const calls: string[] = []
  let debt = false

  const fence = (input: { locusId: string; sessionId: string; revision: number }) => {
    if (input.locusId !== row.locusId) refuse('LOCUS_NOT_FOUND', 'no such locus')
    if (input.sessionId !== row.sessionId || input.revision !== row.revision) refuse('LOCUS_CONFLICT', 'row moved')
  }
  const rotate = (reserve: (() => string) | undefined) => {
    if (reserve === undefined) refuse('INVALID_REQUEST', 'rotation needs an allocator')
    const next = reserve()
    if (next === row.sessionId) refuse('LOCUS_CONFLICT', 'a rotation must not reuse the failed id')
    row.sessionId = next
    row.revision += 1
    row.state = 'not-created'
    delete row.verifiedAt
    // Uninjected backlog follows the reservation.
    for (const delivery of deliveries.values()) {
      if (delivery.status === 'accepted' && delivery.executionId === undefined) delivery.sessionId = next
    }
    return next
  }

  const repository: FirstDeliveryPublicationRepository = {
    async publishFirstDelivery(input) {
      calls.push('publishFirstDelivery')
      fence(input)
      if (row.state !== 'not-created') refuse('LOCUS_CONFLICT', 'row is not not-created')
      const delivery = deliveries.get(input.deliveryId)
      if (delivery?.status !== 'current' || delivery.executionId !== undefined) refuse('LOCUS_CONFLICT', 'not the unissued current')
      row.state = 'active'
      delivery.executionId = input.executionId
    },
    async commitFirstDelivery() {
      calls.push('commitFirstDelivery')
    },
    async revertFirstDelivery(input) {
      calls.push(input.recoveryDebt ? 'revertFirstDelivery:debt' : input.retryText ? 'revertFirstDelivery:retryText' : 'revertFirstDelivery')
      fence(input)
      if (input.recoveryDebt) { debt = true; return }
      const delivery = deliveries.get(input.deliveryId)
      const next = rotate(input.reserveChildSessionId)
      if (delivery === undefined) return
      if (input.retryText) {
        delivery.sessionId = next
        delete delivery.executionId
        delivery.imageRouteRejected = true
      } else {
        delivery.status = 'failed'
      }
    },
    async failFirstDeliveryCreation(input) {
      calls.push('failFirstDeliveryCreation')
      fence(input)
      const delivery = deliveries.get(input.deliveryId)
      if (delivery !== undefined) delivery.status = 'failed'
      rotate(input.reserveChildSessionId)
    },
  }

  return {
    repository,
    row,
    deliveries,
    calls,
    get debt() { return debt },
    /** Accept a Delivery on the current reservation; `current` when nothing else is. */
    accept(deliveryId: string): FakeDelivery {
      const busy = [...deliveries.values()].some(item => item.status === 'current')
      const delivery: FakeDelivery = { sessionId: row.sessionId, status: busy ? 'accepted' : 'current' }
      deliveries.set(deliveryId, delivery)
      return delivery
    },
  }
}
