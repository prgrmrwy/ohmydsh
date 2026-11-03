/**
 * Creation of a locus child on its first message.
 *
 * An entry starts `not-created`. The first deliverable message creates the
 * child with the official `startContinuable`, carrying that message as the
 * child's first prompt, so there is no idle child, no initialization turn and
 * no second hand-off for the same message.
 *
 * Order matters and was measured on the official runtime
 * (`openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md`):
 * `agent/created` fires first, the first prompt is claimed next, and
 * `startContinuable` returns only after that claim. Everything the first turn
 * depends on — the durable child/marker/current association — is therefore
 * published INSIDE `agent/created` against an identity reserved beforehand, and
 * never from the return value. If creation is rejected after that publication
 * ran, the creator reverts it; nothing servable is left behind.
 *
 * The creator owns sequencing and compensation only. The durable writes are the
 * caller's `publish`/`unpublish` callbacks, so this module stays storage-neutral.
 */

import type { LocusChildAdapter, LocusContentBlock } from './child.js'
import type { LocusChildComposition } from './composition.js'
import type { LocusPrepublicationStagingRegistry } from './prepublication-staging.js'

/** One creation request: the entry's first message and the facts to publish it under. */
export interface LocusLazyChildInput {
  /**
   * The child id the generation reserved durably before its first Delivery was
   * accepted. Absent, a fresh id is allocated (only sensible when nothing
   * correlates to the child before creation).
   */
  readonly childSessionId?: string
  /** The locus main (the child's parent). */
  readonly parentSessionId: string
  readonly workspaceId: string
  readonly locusId: string
  readonly generation: number
  readonly label: string
  /** The entry the child serves; decides its read tool before publication. */
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly permission: 'read'
  /** The first Delivery's rendered prompt. */
  readonly prompt: readonly LocusContentBlock[]
  /**
   * Runs inside `agent/created`, after the child is claimed and composed and
   * before its first turn: durably publish the generation as active with the
   * `tier3` marker and the first Delivery as current. Atomic — a throw must
   * leave nothing published, and it vetoes creation.
   */
  readonly publish: (childSessionId: string, composition: LocusChildComposition) => void | Promise<void>
  /** Undo a completed `publish` when creation is rejected afterwards. */
  readonly unpublish: (childSessionId: string, composition: LocusChildComposition) => void | Promise<void>
  /** Finalize durable creation ownership only after the runtime accepted creation. */
  readonly commit?: (childSessionId: string, composition: LocusChildComposition) => void | Promise<void>
  /** Settle a non-capacity failure before publication and retire its possibly persisted id. */
  readonly failed?: (childSessionId: string) => void | Promise<void>
  /** Only an official pre-prompt image veto may retain this Delivery for one text retry. */
  readonly retryText?: (childSessionId: string) => void | Promise<void>
  /** Revoke live publication and retain WAL debt when old-child release is uncertain. */
  readonly recoveryDebt?: (childSessionId: string) => void | Promise<void>
  readonly signal?: AbortSignal
}

/** Why a creation did not happen. */
export type LocusLazyChildFailureReason =
  /** The runtime's active-child limit is full. Nothing happened; retry the same request. */
  | 'capacity'
  /** The default provider cannot be proven to start a child with independent context. */
  | 'independent-context-unproven'
  /** The model route cannot take the typed-image prompt; retry once with the text fallback. */
  | 'image-route-unsupported'
  /** The `locus-base` preset is not declared, so no locus session can be composed. */
  | 'preset-missing'
  /** Creation was refused or failed before or after publication; the revert (if any) completed. */
  | 'create-failed'
  /** The child was created but never reached composition and publication. */
  | 'created-without-composition'
  /** A revert or a compensation failed; durable state may need reconciliation. */
  | 'rollback-failed'
  | 'aborted'

export type LocusLazyChildResult =
  | {
    readonly ok: true
    readonly childSessionId: string
    /** The first prompt's inbox message id, known only after the runtime returns. */
    readonly messageId: string
  }
  | {
    readonly ok: false
    readonly reason: LocusLazyChildFailureReason
    /** True only for `capacity`: the request is whole and may be retried unchanged. */
    readonly retryable: boolean
    readonly detail?: string
  }

/** The controller-facing creation port. */
export interface LocusLazyChildCreator {
  create(input: LocusLazyChildInput): Promise<LocusLazyChildResult>
}

export interface LocusLazyChildDeps {
  readonly staging: LocusPrepublicationStagingRegistry
  /** One adapter per creation; the creator disposes it. */
  readonly createAdapter: () => Pick<LocusChildAdapter, 'createChild' | 'compensateChild' | 'dispose'>
  /** Whether the effective configuration declares the locus preset. Absent means "not proven". */
  readonly presetDeclared: () => boolean | PromiseLike<boolean>
  /** Best-effort follow-up after a fully published child (for example naming its session). */
  readonly afterCreated?: (childSessionId: string, input: LocusLazyChildInput) => void
  readonly log?: (message: string) => void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the creator.
 * @param deps - the staging registry, adapter factory and preset proof.
 * @returns the port the first-message dispatch path calls.
 */
export function createLocusLazyChildCreator(deps: LocusLazyChildDeps): LocusLazyChildCreator {
  const log = (message: string): void => {
    try { deps.log?.(message) } catch { /* a diagnostic sink never changes the outcome */ }
  }

  return {
    async create(input) {
      if (input.signal?.aborted === true) return { ok: false, reason: 'aborted', retryable: false }
      // Refuse before reserving anything: a missing preset is a deployment
      // fact, and a reservation made for it would only have to be undone.
      let declared = false
      try { declared = await deps.presetDeclared() } catch { declared = false }
      if (!declared) return { ok: false, reason: 'preset-missing', retryable: false }

      // Keep the completed publication independently of staging: publication
      // commits (and removes) its reservation inside agent/created.
      let published = false
      const reservation = deps.staging.reserve({
        ...(input.childSessionId === undefined ? {} : { childSessionId: input.childSessionId }),
        parentSessionId: input.parentSessionId,
        locusId: input.locusId,
        generation: input.generation,
        permission: input.permission,
        childComposition: 'tier3',
        toolTier: { desired: 'safe', effective: 'safe' },
        endpoint: input.endpoint,
      }, {
        publish: async (id, composition) => {
          await input.publish(id, composition)
          published = true
        },
        unpublish: input.unpublish,
      })
      const childSessionId = reservation.childSessionId
      const adapter = deps.createAdapter()

      /** Undo whatever creation left, in the only safe order: revert publication, then drop the reservation. */
      const unwind = async (compensateChild: boolean, retryText = false): Promise<boolean> => {
        let clean = true
        try {
          if (retryText) {
            await input.retryText!(childSessionId)
            published = false
          } else if (published) {
            await input.unpublish(childSessionId, reservation.composition)
            published = false
          }
        } catch (error) {
          clean = false
          log(`locus lazy child ${childSessionId}: publication revert failed (${describe(error)})`)
        }
        if (compensateChild) {
          const released = await adapter.compensateChild({ reason: 'locus lazy creation rollback' })
          if (!released.ok) {
            clean = false
            log(`locus lazy child ${childSessionId}: compensation failed (${released.reason})`)
          }
        }
        if (deps.staging.inspect(childSessionId) !== undefined) {
          try { deps.staging.abort(reservation) } catch { /* already gone */ }
        }
        adapter.dispose()
        return clean
      }

      let created: Awaited<ReturnType<typeof adapter.createChild>>
      try {
        created = await adapter.createChild({
          parentSessionId: input.parentSessionId,
          childId: childSessionId,
          label: input.label,
          prompt: input.prompt,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
      } catch (error) {
        created = { ok: false, reason: 'child-create-failed', detail: describe(error) }
      }

      if (!created.ok) {
        if (created.reason === 'image-route-cleanup-unproven') {
          try { await input.recoveryDebt?.(childSessionId) } catch (error) {
            log(`locus lazy child ${childSessionId}: recovery debt failed (${describe(error)})`)
          }
          adapter.dispose()
          deps.staging.abort(reservation)
          return { ok: false, reason: 'rollback-failed', retryable: false }
        }
        const retryText = created.reason === 'image-route-unsupported' && input.retryText !== undefined
        const clean = await unwind(false, retryText)
        if (!clean) return { ok: false, reason: 'rollback-failed', retryable: false }
        if (created.reason !== 'child-capacity-exhausted' && !retryText) {
          try { await input.failed?.(childSessionId) } catch (error) {
            log(`locus lazy child ${childSessionId}: failed-create disposition failed (${describe(error)})`)
            return { ok: false, reason: 'rollback-failed', retryable: false }
          }
        }
        const detail = created.detail === undefined ? { detail: created.reason } : { detail: created.detail }
        switch (created.reason) {
          case 'child-capacity-exhausted':
            return { ok: false, reason: 'capacity', retryable: true, ...detail }
          case 'independent-context-unproven':
            return { ok: false, reason: 'independent-context-unproven', retryable: false }
          case 'aborted':
            return { ok: false, reason: 'aborted', retryable: false }
          case 'image-route-unsupported':
            return { ok: false, reason: retryText ? 'image-route-unsupported' : 'create-failed', retryable: false, ...detail }
          default:
            return { ok: false, reason: 'create-failed', retryable: false, ...detail }
        }
      }

      // Creation succeeded, so `agent/created` must have claimed and published
      // this exact reservation. If it did not, the child is running without the
      // composition and association it needs: take it back down.
      if (!published || deps.staging.inspect(childSessionId) !== undefined) {
        log(`locus lazy child ${childSessionId}: created without synchronous composition`)
        let clean = await unwind(true)
        if (clean) {
          try { await input.failed?.(childSessionId) } catch { clean = false }
        }
        return {
          ok: false,
          reason: clean ? 'created-without-composition' : 'rollback-failed',
          retryable: false,
        }
      }
      try {
        await input.commit?.(childSessionId, reservation.composition)
      } catch (error) {
        log(`locus lazy child ${childSessionId}: creation commit failed (${describe(error)})`)
        const clean = await unwind(true)
        return { ok: false, reason: clean ? 'create-failed' : 'rollback-failed', retryable: false }
      }
      adapter.dispose()
      try { deps.afterCreated?.(childSessionId, input) } catch (error) {
        log(`locus lazy child ${childSessionId}: follow-up failed (${describe(error)})`)
      }
      return { ok: true, childSessionId, messageId: String(created.messageId ?? '') }
    },
  }
}
