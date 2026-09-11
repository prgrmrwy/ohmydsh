/**
 * Bridge between the unified channel controller and the generic child adapter.
 *
 * The controller asks for two things per delivery: the exact child that serves
 * a locus, and the queueing of one host-authored turn into that child. The
 * child adapter already owns the DSH mechanics (resolving a live parent,
 * creating or adopting a continuable child, putting a prompt in its inbox);
 * this module only translates between the two vocabularies.
 *
 * It adds one guarantee of its own: the child it queues into must be the child
 * the locus record names. A queue that landed in another child would execute a
 * group's message in an unrelated conversation, and no later settlement check
 * could undo that.
 */

import type { LocusChildAdapter, LocusChildIdentity } from './child.js'
import type { LocusReplyTarget } from './context.js'

/** The locus facts one delivery is served under. */
export interface LocusDeliveryTarget {
  readonly id?: string
  readonly locusId?: string
  readonly parentSessionId: string
  readonly childSessionId: string
}

/** Result of queueing one delivery turn. */
export type LocusQueueResult =
  | { readonly accepted: true; readonly executionId: string; readonly inboxMessageId: string }
  | { readonly accepted: false; readonly reason: string }

type LocusDeliveryAdapter = Pick<
  LocusChildAdapter,
  'createChild' | 'adoptChild' | 'queuePrompt' | 'withChildSession' | 'activeChild' | 'dispose'
>

export interface LocusChildDeliveryPorts {
  /** Backward-compatible single-adapter seam for isolated tests. */
  readonly adapter?: LocusDeliveryAdapter
  /**
   * Production seam: one adapter per durable child identity.
   *
   * A `LocusChildAdapter` intentionally owns exactly one active child. Sharing
   * one instance across every locus makes the second sibling fail with
   * `active-child-conflict`, so production must provide a factory.
   */
  readonly createAdapter?: () => LocusDeliveryAdapter
  /** Stable diagnostics; never a message body. */
  readonly log?: (reason: string) => void
}

/**
 * Create the controller-facing child delivery port.
 * @param ports - the generic child adapter plus optional diagnostics.
 * @returns `ensureChild` / `queueChild` in the controller's vocabulary.
 */
export function createLocusChildDelivery(ports: LocusChildDeliveryPorts): {
  ensureChild(locus: LocusDeliveryTarget, signal: AbortSignal): Promise<LocusChildIdentity>
  queueChild(input: {
    readonly locus: LocusDeliveryTarget
    readonly child: LocusChildIdentity
    readonly deliveryId: string
    readonly executionId: string
    readonly prompt: string
    /** Immutable Host-resolved target carried only in the rendered prompt. */
    readonly replyTarget: LocusReplyTarget
    readonly signal: AbortSignal
  }): Promise<LocusQueueResult>
  withChildSession<T>(input: {
    readonly identity: LocusChildIdentity
    readonly operation: (session: unknown) => T | Promise<T>
    readonly signal?: AbortSignal
  }): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }>
  dispose(): void
} {
  if ((ports.adapter === undefined) === (ports.createAdapter === undefined)) {
    throw new Error('Locus child delivery requires exactly one adapter or adapter factory')
  }
  const adapters = new Map<string, LocusDeliveryAdapter>()
  const adapterFor = (childSessionId: string): { adapter: LocusDeliveryAdapter; fresh: boolean } => {
    const existing = adapters.get(childSessionId)
    if (existing !== undefined) return { adapter: existing, fresh: false }
    const created = ports.createAdapter?.() ?? ports.adapter!
    adapters.set(childSessionId, created)
    return { adapter: created, fresh: true }
  }

  return {
    async ensureChild(locus, signal) {
      const expected: LocusChildIdentity = {
        parentSessionId: locus.parentSessionId,
        childSessionId: locus.childSessionId,
      }
      // The locus already names its child, so this is an ADOPTION of a durable
      // identity, never a fresh creation: creating one here would mint a second
      // child for a locus that already has one.
      const selected = adapterFor(expected.childSessionId)
      const adopted = await selected.adapter.adoptChild({ ...expected, signal })
      if (adopted.ok) {
        if (
          adopted.identity.childSessionId !== expected.childSessionId ||
          adopted.identity.parentSessionId !== expected.parentSessionId
        ) {
          ports.log?.('child-identity-mismatch')
          throw new Error('Adopted child identity does not match the locus record')
        }
        return adopted.identity
      }
      if (selected.fresh) {
        adapters.delete(expected.childSessionId)
        selected.adapter.dispose()
      }
      ports.log?.(adopted.reason)
      throw new Error(`Locus child is unavailable (${adopted.reason})`)
    },

    async queueChild(input) {
      if (
        input.child.childSessionId !== input.locus.childSessionId ||
        input.child.parentSessionId !== input.locus.parentSessionId
      ) {
        // Refuse before touching the inbox: a mismatch here would run a
        // group's message inside an unrelated conversation.
        ports.log?.('child-identity-mismatch')
        return { accepted: false, reason: 'child-identity-mismatch' }
      }
      const adapter = adapters.get(input.child.childSessionId)
      if (adapter === undefined) {
        ports.log?.('child-not-adopted')
        return { accepted: false, reason: 'child-not-adopted' }
      }
      const queued = await adapter.queuePrompt({
        text: input.prompt,
        identity: input.child,
        signal: input.signal,
      })
      if (!queued.ok) {
        ports.log?.(queued.reason)
        return { accepted: false, reason: queued.reason }
      }
      // Keep both identities: executionId is controller-generated, while this
      // queue-assigned messageId is what `agent/inbox/claimed` later emits.
      return {
        accepted: true,
        executionId: input.executionId,
        inboxMessageId: queued.messageId,
      }
    },

    async withChildSession(input) {
      const adapter = adapters.get(input.identity.childSessionId)
      if (adapter === undefined) return { ok: false, reason: 'child-not-adopted' }
      const result = await adapter.withChildSession(input)
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, reason: result.reason }
    },

    dispose() {
      const unique = new Set(adapters.values())
      adapters.clear()
      for (const adapter of unique) adapter.dispose()
    },
  }
}
