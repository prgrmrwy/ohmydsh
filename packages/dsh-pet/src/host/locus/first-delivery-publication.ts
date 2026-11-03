import type { LocusLazyCreationPorts } from './child-delivery.js'
import type { FirstPromptRegistry } from './first-prompt.js'
import type { LocusRepository } from './persistence.js'

/** Host wiring for atomic first-prompt publication and post-publication durable compensation. */
export function createFirstDeliveryPublication(ports: {
  readonly repository: Pick<LocusRepository, 'publishFirstDelivery' | 'revertFirstDelivery' | 'commitFirstDelivery' | 'failFirstDeliveryCreation'>
  readonly firstPrompts: FirstPromptRegistry
  readonly now?: () => number
}): LocusLazyCreationPorts['publication'] {
  return ({ locus, deliveryId, executionId }) => {
    const locusId = locus.id ?? locus.locusId
    if (locusId === undefined || locus.generation === undefined || locus.endpoint === undefined) {
      throw new Error('First Delivery requires an exact generation and endpoint')
    }
    const correlation = { endpoint: locus.endpoint, locusId, generation: locus.generation, childSessionId: locus.childSessionId }
    const identity = { ...correlation, deliveryId, executionId }
    return {
      async publish(childSessionId) {
        if (childSessionId !== locus.childSessionId) throw new Error('First child differs from its reserved identity')
        ports.firstPrompts.expect(childSessionId, { deliveryId, executionId, correlation })
        try {
          await ports.repository.publishFirstDelivery({ ...identity, now: (ports.now ?? Date.now)() })
        } catch (error) {
          ports.firstPrompts.retire(childSessionId)
          throw error
        }
      },
      async recoveryDebt(childSessionId) {
        ports.firstPrompts.retire(childSessionId)
        await ports.repository.revertFirstDelivery({ ...identity, recoveryDebt: true, now: (ports.now ?? Date.now)() })
      },
      async retryText(childSessionId) {
        // A code-shaped error after a real claim is not pre-prompt proof.
        if (ports.firstPrompts.claimedMessageId(childSessionId) !== undefined) {
          ports.firstPrompts.retire(childSessionId)
          await ports.repository.revertFirstDelivery({ ...identity, now: (ports.now ?? Date.now)() })
          throw new Error('A claimed first prompt cannot be retried as text')
        }
        try {
          await ports.repository.revertFirstDelivery({ ...identity, retryText: true, now: (ports.now ?? Date.now)() })
        } catch (error) {
          // Prepublication vetoes have no WAL yet; preserve their uncertain
          // handoff as debt too, without authorizing another physical start.
          try { await ports.repository.revertFirstDelivery({ ...identity, recoveryDebt: true, now: (ports.now ?? Date.now)() }) } catch { /* Original publication remains fail-closed if even debt cannot persist. */ }
          throw error
        } finally {
          ports.firstPrompts.retire(childSessionId)
        }
      },
      async failed() {
        await ports.repository.failFirstDeliveryCreation({ ...identity, now: (ports.now ?? Date.now)() })
      },
      async commit(childSessionId) {
        await ports.firstPrompts.whenBound(childSessionId)
        await ports.repository.commitFirstDelivery({ ...identity, now: (ports.now ?? Date.now)() })
        ports.firstPrompts.retire(childSessionId)
      },
      async unpublish(childSessionId) {
        ports.firstPrompts.retire(childSessionId)
        await ports.repository.revertFirstDelivery({ ...identity, now: (ports.now ?? Date.now)() })
      },
    }
  }
}
