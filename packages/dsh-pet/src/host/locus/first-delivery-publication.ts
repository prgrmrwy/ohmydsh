/**
 * Host wiring for the first child's durable publication (design D15, D16).
 *
 * Runs the lazy creator's callbacks against owner A's v20 writes. Every write
 * is fenced on the row identity read before creation — `(locusId, sessionId,
 * revision)` — and on the first Delivery; there is no generation (D3).
 *
 * - `publish`       inside `agent/created`: row → active, Delivery gains executionId.
 * - `commit`        after the first prompt is durably bound.
 * - `unpublish`     creation rejected after publish: one write reverts, rotates the
 *                   reservation and settles this Delivery failed (D16).
 * - `failed`        non-capacity failure before publish: settle + rotate (D16).
 * - `retryText`     the official pre-prompt image veto: rotate and keep THIS
 *                   Delivery for one text retry; refused once a claim happened.
 * - `recoveryDebt`  release unprovable: leave blocking debt (D15 step 0).
 */
import type { FirstPromptRegistry } from './first-prompt.js'
import type { LocusRepositoryPortV20 } from './contract-v20.js'

/** The four first-publication writes of the v20 port. */
export type FirstDeliveryPublicationRepository = Pick<
  LocusRepositoryPortV20,
  'publishFirstDelivery' | 'commitFirstDelivery' | 'revertFirstDelivery' | 'failFirstDeliveryCreation'
>

/** The row identity a first creation is fenced on, read before `startActivation`. */
export interface FirstDeliveryLocus {
  readonly locusId: string
  readonly sessionId: string
  readonly revision: number
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
}

/** Callbacks handed to the lazy child creator for one first Delivery. */
export interface FirstDeliveryPublicationCallbacks {
  publish(childSessionId: string): Promise<void>
  unpublish(childSessionId: string): Promise<void>
  commit(childSessionId: string): Promise<void>
  failed(childSessionId: string): Promise<void>
  retryText(childSessionId: string): Promise<void>
  recoveryDebt(childSessionId: string): Promise<void>
}

export type FirstDeliveryPublicationFactory = (input: {
  readonly locus: FirstDeliveryLocus
  readonly deliveryId: string
  readonly executionId: string
}) => FirstDeliveryPublicationCallbacks

export function createFirstDeliveryPublication(ports: {
  readonly repository: FirstDeliveryPublicationRepository
  readonly firstPrompts: FirstPromptRegistry
  /** The same allocator the controller uses for every reservation (D16). */
  readonly reserveChildSessionId: () => string
  readonly now?: () => number
}): FirstDeliveryPublicationFactory {
  const now = ports.now ?? Date.now
  return ({ locus, deliveryId, executionId }) => {
    const correlation = { endpoint: locus.endpoint, locusId: locus.locusId, sessionId: locus.sessionId }
    const identity = () => ({
      locusId: locus.locusId,
      sessionId: locus.sessionId,
      revision: locus.revision,
      deliveryId,
      now: now(),
    })
    const rotate = { reserveChildSessionId: ports.reserveChildSessionId }
    // The publication operation `first-child:<executionId>` exists only once
    // `publishFirstDelivery` succeeded; a revert before that must not name it.
    let published = false
    const issued = () => (published ? { executionId } : {})
    const requireReserved = (childSessionId: string) => {
      if (childSessionId !== locus.sessionId) throw new Error('First child differs from its reserved sessionId')
    }
    return {
      async publish(childSessionId) {
        requireReserved(childSessionId)
        ports.firstPrompts.expect(childSessionId, { deliveryId, executionId, correlation })
        try {
          await ports.repository.publishFirstDelivery({ ...identity(), executionId })
          published = true
        } catch (error) {
          ports.firstPrompts.retire(childSessionId)
          throw error
        }
      },
      async commit(childSessionId) {
        await ports.firstPrompts.whenBound(childSessionId)
        await ports.repository.commitFirstDelivery({ executionId, now: now() })
        ports.firstPrompts.retire(childSessionId)
      },
      async unpublish(childSessionId) {
        ports.firstPrompts.retire(childSessionId)
        await ports.repository.revertFirstDelivery({ ...identity(), executionId, ...rotate })
      },
      async failed() {
        await ports.repository.failFirstDeliveryCreation({ ...identity(), ...rotate })
      },
      async recoveryDebt(childSessionId) {
        ports.firstPrompts.retire(childSessionId)
        await ports.repository.revertFirstDelivery({ ...identity(), executionId, recoveryDebt: true })
      },
      async retryText(childSessionId) {
        // A refusal after a real claim is not pre-prompt proof (「已接受或认领的图片拒绝不重放」).
        if (ports.firstPrompts.claimedMessageId(childSessionId) !== undefined) {
          ports.firstPrompts.retire(childSessionId)
          await ports.repository.revertFirstDelivery({ ...identity(), executionId, ...rotate })
          throw new Error('A claimed first prompt cannot be retried as text')
        }
        try {
          await ports.repository.revertFirstDelivery({ ...identity(), ...issued(), retryText: true, ...rotate })
        } catch (error) {
          // The handoff is now uncertain: leave debt rather than authorize another start.
          try {
            await ports.repository.revertFirstDelivery({ ...identity(), executionId, recoveryDebt: true })
          } catch { /* Publication stays fail-closed if even the debt cannot persist. */ }
          throw error
        } finally {
          ports.firstPrompts.retire(childSessionId)
        }
      },
    }
  }
}
