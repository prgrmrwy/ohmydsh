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

import { LOCUS_SAFE_CHILD_COMPOSITION, type LocusChildComposition } from './aggregate.js'
import type { LocusChildAdapter, LocusChildIdentity, LocusContentBlock } from './child.js'
import type { LocusReplyTarget } from './context.js'
import type { LocusLazyChildCreator, LocusLazyChildInput } from './lazy-child.js'
import { LOCUS_BASE_PRESET } from './preset.js'

/**
 * The locus facts one delivery is served under.
 *
 * A `not-created` generation has no child yet: `childSessionId` is then the id
 * the generation reserved, which every Delivery already correlates by, and the
 * first Delivery's queue creates the child under exactly that id.
 */
export interface LocusDeliveryTarget {
  readonly id?: string
  readonly locusId?: string
  readonly state?: 'active' | 'not-created'
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly childComposition?: LocusChildComposition
  readonly workspaceId?: string
  readonly generation?: number
  readonly endpoint?: { readonly chatId: string; readonly threadId?: string }
}

/** Creation of a generation's first child (see `lazy-child.ts`). */
export interface LocusLazyCreationPorts {
  readonly creator: LocusLazyChildCreator
  /**
   * The durable publication callbacks for one creation: inside `agent/created`,
   * publish the generation as active (`tier3`) and register the Delivery its
   * first prompt carries; on a later rejection, revert both.
   */
  readonly publication: (input: {
    readonly locus: LocusDeliveryTarget
    readonly deliveryId: string
    readonly executionId: string
  }) => Pick<LocusLazyChildInput, 'publish' | 'unpublish' | 'commit' | 'failed' | 'retryText' | 'recoveryDebt'>
  /** The session title for the new child. */
  readonly label?: (locus: LocusDeliveryTarget) => string | PromiseLike<string>
}

/** Result of queueing one delivery turn. */
export type LocusQueueResult =
  | { readonly accepted: true; readonly executionId: string; readonly inboxMessageId: string }
  | { readonly accepted: false; readonly reason: string }

type LocusDeliveryAdapter = Pick<
  LocusChildAdapter,
  'createChild' | 'adoptChild' | 'queuePrompt' | 'activeChild' | 'dispose'
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
  /**
   * The preset the locus main (the child's parent) is persisted with.
   *
   * A child cold-resumes from its parent's CURRENT preset, so the pinned
   * composition holds only while that preset stays `locus-base`. Read before
   * every adoption and every queue: absent, unreadable or different means the
   * composition is not proven and nothing is dispatched.
   */
  readonly parentPreset?: (parentSessionId: string) => string | undefined | PromiseLike<string | undefined>
  /** Absent means a `not-created` generation cannot get its first child. */
  readonly lazy?: LocusLazyCreationPorts
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
    readonly content: readonly LocusContentBlock[]
    /** Controller-owned exact-current proof checked at the final child queue seam. */
    readonly fenceBeforeQueue?: () => boolean | PromiseLike<boolean>
    /** Immutable Host-resolved target carried only in the rendered prompt. */
    readonly replyTarget: LocusReplyTarget
    readonly signal: AbortSignal
  }): Promise<LocusQueueResult>
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

  /**
   * Whether the locus main still runs the pinned preset.
   * @returns undefined when proven, otherwise the stable refusal reason.
   */
  const checkParentPreset = async (parentSessionId: string): Promise<string | undefined> => {
    if (ports.parentPreset === undefined) return 'locus-main-preset-unverified'
    let preset: string | undefined
    try {
      preset = await ports.parentPreset(parentSessionId)
    } catch {
      return 'locus-main-preset-unverified'
    }
    if (preset === undefined) return 'locus-main-preset-unverified'
    return preset === LOCUS_BASE_PRESET ? undefined : 'locus-main-preset-mismatch'
  }

  /** Create the generation's child with this Delivery as its first prompt. */
  const createFirstChild = async (input: Parameters<ReturnType<typeof createLocusChildDelivery>['queueChild']>[0]): Promise<LocusQueueResult> => {
    const { locus } = input
    const lazy = ports.lazy
    if (
      lazy === undefined
      || locus.workspaceId === undefined
      || locus.generation === undefined
      || locus.endpoint === undefined
      || (locus.id ?? locus.locusId) === undefined
    ) {
      ports.log?.('child-creation-unavailable')
      return { accepted: false, reason: 'child-creation-unavailable' }
    }
    const presetRefusal = await checkParentPreset(locus.parentSessionId)
    if (presetRefusal !== undefined) {
      ports.log?.(presetRefusal)
      return { accepted: false, reason: presetRefusal }
    }
    // Exact-current fence immediately before the child is brought into being:
    // nothing can be taken back once it has taken the prompt.
    let current = false
    try { current = (await input.fenceBeforeQueue?.()) !== false } catch { current = false }
    if (!current) return { accepted: false, reason: 'stale-delivery' }
    const label = lazy.label === undefined ? `Locus · ${locus.endpoint.chatId}` : await lazy.label(locus)
    const publication = lazy.publication({ locus, deliveryId: input.deliveryId, executionId: input.executionId })
    const created = await lazy.creator.create({
      childSessionId: locus.childSessionId,
      parentSessionId: locus.parentSessionId,
      workspaceId: locus.workspaceId,
      locusId: (locus.id ?? locus.locusId)!,
      generation: locus.generation,
      label,
      endpoint: locus.endpoint,
      permission: 'read',
      prompt: input.content,
      ...publication,
      signal: input.signal,
    })
    if (!created.ok) {
      const reason = created.reason === 'capacity'
        ? 'child-capacity-exhausted'
        : created.reason === 'image-route-unsupported' ? created.reason : `child-${created.reason}`
      ports.log?.(reason)
      return { accepted: false, reason }
    }
    return { accepted: true, executionId: input.executionId, inboxMessageId: created.messageId }
  }

  return {
    async ensureChild(locus, signal) {
      if (locus.state === 'not-created') {
        // Nothing to adopt: the child does not exist yet. Only the identity it
        // will be created under is returned, after the same preset proof an
        // existing child needs.
        const refusal = await checkParentPreset(locus.parentSessionId)
        if (refusal !== undefined) {
          ports.log?.(refusal)
          throw new Error(`Locus child is unavailable (${refusal})`)
        }
        return { parentSessionId: locus.parentSessionId, childSessionId: locus.childSessionId }
      }
      // Refuse before adapter allocation, parent resolution, proof, or cold
      // resume. Only a row Host-attested as the current composition serves:
      // rows with an older marker (or none) belong to the retired model.
      if (locus.childComposition !== LOCUS_SAFE_CHILD_COMPOSITION) {
        ports.log?.('safe-composition-unproven')
        throw new Error('Locus child is unavailable (safe-composition-unproven)')
      }
      const presetRefusal = await checkParentPreset(locus.parentSessionId)
      if (presetRefusal !== undefined) {
        ports.log?.(presetRefusal)
        throw new Error(`Locus child is unavailable (${presetRefusal})`)
      }
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
      if (input.locus.state === 'not-created') return createFirstChild(input)
      const adapter = adapters.get(input.child.childSessionId)
      if (adapter === undefined) {
        ports.log?.('child-not-adopted')
        return { accepted: false, reason: 'child-not-adopted' }
      }
      // The parent's preset can change while the child is alive; the child
      // would then serve (or cold-resume) under a composition nobody reviewed.
      const presetRefusal = await checkParentPreset(input.locus.parentSessionId)
      if (presetRefusal !== undefined) {
        ports.log?.(presetRefusal)
        return { accepted: false, reason: presetRefusal }
      }
      const queued = await adapter.queuePrompt({
        content: input.content,
        identity: input.child,
        signal: input.signal,
        ...(input.fenceBeforeQueue === undefined ? {} : { fenceBeforeQueue: input.fenceBeforeQueue }),
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

    dispose() {
      const unique = new Set(adapters.values())
      adapters.clear()
      for (const adapter of unique) adapter.dispose()
    },
  }
}
