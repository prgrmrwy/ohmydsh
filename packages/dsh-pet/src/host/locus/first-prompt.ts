/**
 * Claim resolution for a child's FIRST prompt.
 *
 * A child created by `startActivation` takes its first turn before the call
 * returns, so the inbox message id of that prompt is not known to the Host when
 * the turn claims it — it is returned only afterwards. Everything else that
 * claims a Delivery resolves it by `(child, inbox message id)` from the durable
 * binding, which cannot exist yet. This registry bridges exactly that gap:
 * publication (inside `agent/created`) registers which Delivery the child's
 * first prompt carries, and the claim lookup consults it when the durable
 * lookup finds nothing.
 *
 * It is deliberately narrow and process-local, never a second durable truth:
 * - one expectation per child, one message id ever bound to it;
 * - the expectation is retired once the durable `bindQueued` has committed, so
 *   from then on only the durable binding answers;
 * - an expectation can only be consumed by a claim of the child it names.
 */

/** The Delivery facts a claim resolves to. */
export interface FirstPromptDelivery {
  readonly deliveryId: string
  readonly executionId: string
  readonly correlation: {
    readonly endpoint: { readonly chatId: string; readonly threadId?: string }
    readonly locusId: string
    readonly generation: number
    readonly childSessionId: string
  }
}

interface Expectation {
  readonly delivery: FirstPromptDelivery
  /** Set by the first claim; later claims must carry the same message id. */
  messageId?: string
  binding?: Promise<void>
}

export interface FirstPromptRegistry {
  /** Register the Delivery a child's first prompt carries. Replaces nothing silently. */
  expect(childSessionId: string, delivery: FirstPromptDelivery): void
  /**
   * Resolve a claim by the expectation, binding its message id on first use.
   * Returns undefined for an unexpected child or a message id that differs from
   * the one already bound (a second user message is not the first prompt).
   */
  resolve(input: { readonly childSessionId: string; readonly messageId: string }): FirstPromptDelivery | undefined
  /** The message id the first claim bound, once there is one. */
  claimedMessageId(childSessionId: string): string | undefined
  /** Await durable inbox binding before a caller-bound first-turn tool executes. */
  whenBound(childSessionId: string): Promise<void>
  /** Retire the expectation (durable binding committed, or creation rolled back). */
  retire(childSessionId: string): void
  readonly size: number
}

/** Create an empty registry. */
export function createFirstPromptRegistry(ports?: {
  bindQueued(delivery: FirstPromptDelivery, messageId: string): Promise<void>
}): FirstPromptRegistry {
  const expectations = new Map<string, Expectation>()
  return {
    expect(childSessionId, delivery) {
      if (childSessionId.trim() === '' || delivery.deliveryId.trim() === '' || delivery.executionId.trim() === '') {
        throw new Error('First prompt identity must be non-empty')
      }
      if (expectations.has(childSessionId)) {
        throw new Error(`Child ${childSessionId} already has a first-prompt expectation`)
      }
      if (delivery.correlation.childSessionId !== childSessionId) {
        throw new Error('A first-prompt expectation must name its own child')
      }
      expectations.set(childSessionId, { delivery })
    },
    resolve({ childSessionId, messageId }) {
      if (childSessionId.trim() === '' || messageId.trim() === '') return undefined
      const entry = expectations.get(childSessionId)
      if (entry === undefined) return undefined
      if (entry.messageId === undefined) {
        entry.messageId = messageId
        if (ports !== undefined) {
          entry.binding = Promise.resolve().then(() => ports.bindQueued(entry.delivery, messageId))
          // The tool wrapper awaits the original rejection; never leak an unhandled rejection.
          void entry.binding.catch(() => undefined)
        }
        return entry.delivery
      }
      return entry.messageId === messageId ? entry.delivery : undefined
    },
    claimedMessageId(childSessionId) {
      return expectations.get(childSessionId)?.messageId
    },
    async whenBound(childSessionId) {
      const entry = expectations.get(childSessionId)
      if (entry === undefined) return
      if (entry.messageId === undefined) throw new Error('First prompt has not been claimed')
      await entry.binding
    },
    retire(childSessionId) {
      expectations.delete(childSessionId)
    },
    get size() { return expectations.size },
  }
}
