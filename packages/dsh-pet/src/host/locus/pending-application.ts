/**
 * Resolution of a change recorded while a child was released.
 *
 * An owner may change a child's tool tier or file permission while the runtime
 * has the child unloaded. Nothing is borrowed or woken for that: the request is
 * recorded as PENDING (`desired` differs from `effective`) and the child keeps
 * serving under `effective`. The next time the runtime publishes the child
 * (`agent/created`, source `resume`), `composeLocusChild` applies the request,
 * reads it back, and reports how it went. This module is what happens next:
 * write the outcome down, then tell the owner — both before the awakening
 * Delivery's first tool runs, because the caller awaits it inside `agent/created`.
 *
 * Outcomes are symmetric. A request that verified becomes `effective`; one that
 * did not is discarded (never kept as `desired`, so it cannot silently re-apply
 * on a later wake) and the owner is told why.
 */

import type { LocusChildComposition, LocusPendingResolution } from './composition.js'

/** The durable write that closes a pending change in one transaction. */
export interface LocusPendingApplicationRepository {
  resolvePendingApplication(input: {
    readonly locusId: string
    readonly generation: number
    readonly childSessionId: string
    /** Durable revision captured before applying either pending request. */
    readonly expectedRevision: number
    readonly permission?: {
      readonly desired: 'read' | 'write'
      readonly effective: 'read' | 'write'
      readonly verifiedAt: number
      readonly grantedBy: string
    }
    readonly toolTier?: {
      readonly desired: 'safe' | 'shell'
      readonly effective: 'safe' | 'shell'
      readonly verifiedAt: number
      readonly grantedBy: string
    }
    readonly now: number
  }): Promise<unknown>
  /** Who granted the change being resolved, kept on the row. */
  getLocus(locusId: string): {
    readonly permission?: { readonly grantedBy?: string }
    readonly toolTier?: { readonly grantedBy?: string }
  } | undefined
}

export interface LocusPendingApplicationPorts {
  readonly repository: LocusPendingApplicationRepository
  /** Tell the owner in the entry; a failure here never changes the recorded outcome. */
  readonly notify: (input: {
    readonly endpoint: { readonly chatId: string; readonly threadId?: string }
    readonly text: string
  }) => void | Promise<void>
  readonly now?: () => number
  readonly log?: (message: string) => void
}

/** Thrown when the outcome could not be written: the child must not be published. */
export class LocusPendingApplicationError extends Error {
  override readonly name = 'LocusPendingApplicationError'
  readonly code = 'pending-resolution-not-persisted' as const

  constructor(options?: ErrorOptions) {
    super('The result of a pending change could not be recorded, so the child is not published', options)
  }
}

function reasonSuffix(reason: string | undefined): string {
  return reason === undefined || reason.trim() === '' ? '' : `原因：${reason.trim().slice(0, 300)}`
}

function permissionLine(outcome: { requested: string; effective: string; applied: boolean; reason?: string }): string {
  return outcome.applied
    ? `文件权限已在子会话唤醒时应用并核验为 ${outcome.effective}。`
    : `文件权限变更（${outcome.requested}）在子会话唤醒时未能核验生效，已按原权限 ${outcome.effective} 服务，待应用变更已清除。${reasonSuffix(outcome.reason)}`
}

function tierLine(outcome: { requested: string; effective: string; applied: boolean; reason?: string }): string {
  return outcome.applied
    ? `工具档位已在子会话唤醒时应用并核验为 ${outcome.effective}。`
    : `工具档位变更（${outcome.requested}）在子会话唤醒时未能核验生效，已按原档位 ${outcome.effective} 服务，待应用变更已清除。${reasonSuffix(outcome.reason)}`
}

/**
 * Persist and announce the outcome of a pending change.
 *
 * Persistence comes first and is required: if it fails the error propagates and
 * the runtime vetoes the child's publication, because serving on a row that
 * still carries a pending marker the child has already acted on would let the
 * record and the tools disagree. The announcement is best-effort.
 *
 * @param ports - the durable write and the owner notification.
 * @param composition - the published child's durable facts.
 * @param pending - what `composeLocusChild` resolved.
 */
export async function resolveLocusPendingApplication(
  ports: LocusPendingApplicationPorts,
  composition: LocusChildComposition,
  pending: LocusPendingResolution,
): Promise<void> {
  const now = (ports.now ?? Date.now)()
  try {
    if (composition.revision === undefined) throw new Error('Pending application has no pre-apply revision')
    const row = ports.repository.getLocus(composition.locusId)
    await ports.repository.resolvePendingApplication({
      locusId: composition.locusId,
      generation: composition.generation,
      childSessionId: composition.childSessionId,
      expectedRevision: composition.revision,
      ...(pending.permission === undefined ? {} : {
        permission: {
          desired: pending.permission.effective,
          effective: pending.permission.effective,
          verifiedAt: now,
          grantedBy: row?.permission?.grantedBy ?? 'owner',
        },
      }),
      ...(pending.toolTier === undefined ? {} : {
        toolTier: {
          desired: pending.toolTier.effective,
          effective: pending.toolTier.effective,
          verifiedAt: now,
          grantedBy: row?.toolTier?.grantedBy ?? 'owner',
        },
      }),
      now,
    })
  } catch (error) {
    ports.log?.(`pending change for ${composition.locusId} was not recorded`)
    throw new LocusPendingApplicationError({ cause: error })
  }

  const lines = [
    ...(pending.permission === undefined ? [] : [permissionLine(pending.permission)]),
    ...(pending.toolTier === undefined ? [] : [tierLine(pending.toolTier)]),
  ]
  if (lines.length === 0 || composition.endpoint === undefined) return
  try {
    await ports.notify({ endpoint: composition.endpoint, text: lines.join('\n') })
  } catch {
    ports.log?.(`pending change for ${composition.locusId} was recorded but the owner could not be told`)
  }
}
