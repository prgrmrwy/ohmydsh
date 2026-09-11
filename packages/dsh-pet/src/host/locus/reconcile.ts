/**
 * Startup reconciliation between durable locus rows and the live runtime.
 *
 * Pet's store says a locus has a child; the runtime is the only thing that
 * knows whether that child can still take a turn. After a restart, an upgrade,
 * or a workspace change those two can disagree, and the disagreement is
 * invisible until someone sends a message that then waits forever.
 *
 * This module compares them once at startup and records the result. The rules
 * it follows exist because the cheap alternatives are all wrong:
 *
 * - a child the runtime cannot produce is marked INVALID with a reason, not
 *   silently re-created: re-creating loses the conversation the entry has been
 *   having, and does it without anyone asking;
 * - "the parent is not resident" is not proof of anything — a parent is
 *   resumable on demand, so only a failed resolution counts as evidence;
 * - a runtime that cannot answer at all (no probe) leaves every row untouched
 *   rather than invalidating the whole set on one missing seam;
 * - nothing here sends a message. Telling a group its entry broke is a
 *   separate, once-only decision made by the caller.
 */

import type { LocusRecord } from './aggregate.js'

/** What the runtime could prove about one locus child. */
export type ChildLiveness =
  /** The child exists and can take another turn. */
  | { readonly kind: 'usable' }
  /** The child is definitively gone or unusable, with a stable reason. */
  | { readonly kind: 'unusable'; readonly reason: string }
  /** The runtime could not answer; this is not evidence of absence. */
  | { readonly kind: 'unknown'; readonly diagnostic: string }

/** Probes the live runtime for one locus child. */
export interface ChildLivenessProbe {
  check(input: {
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly signal: AbortSignal
  }): Promise<ChildLiveness>
}

/** Durable writes reconciliation may perform. */
export interface ReconcileStore {
  /** Mark a generation invalid with an owner-readable reason. */
  invalidate(locusId: string, reason: string, now: number): Promise<void>
  /** Whether durable queued/running Delivery evidence still owns the busy fence. */
  hasPendingDelivery?(locusId: string): boolean | Promise<boolean>
  /** Clear a stale busy fence left by a process that died before durable queueing. */
  clearBusy(locusId: string, now: number): Promise<void>
}

export interface ReconcilePorts {
  readonly store: ReconcileStore
  /** Absent leaves every row untouched rather than guessing. */
  readonly probe?: ChildLivenessProbe
  readonly now?: () => number
  readonly log?: (code: ReconcileDiagnostic) => void
}

export type ReconcileDiagnostic =
  | 'probe-unavailable'
  | 'child-unusable'
  | 'child-unknown'
  | 'stale-busy-cleared'

/** Outcome of one reconciliation pass. */
export interface ReconcileReport {
  readonly checked: number
  readonly usable: number
  /** Generations marked invalid, with the reason recorded on each. */
  readonly invalidated: readonly { readonly locusId: string; readonly reason: string }[]
  /** Generations the runtime could not answer for; left untouched. */
  readonly unproven: readonly string[]
  /** Stale busy fences cleared so the entry is not blocked forever. */
  readonly busyCleared: readonly string[]
}

/**
 * Reconcile durable locus rows against the live runtime.
 * @param loci - the durable rows to check; retired ones should be excluded.
 * @param ports - the runtime probe plus the durable writes.
 * @param signal - abort for the whole pass.
 * @returns what was checked and what changed.
 */
export async function reconcileLocusChildren(
  loci: readonly LocusRecord[],
  ports: ReconcilePorts,
  signal: AbortSignal = new AbortController().signal,
): Promise<ReconcileReport> {
  const now = ports.now ?? Date.now
  const invalidated: { locusId: string; reason: string }[] = []
  const unproven: string[] = []
  const busyCleared: string[] = []
  let usable = 0

  const candidates = loci.filter(record => record.state === 'active')
  if (ports.probe === undefined) {
    // One missing seam must not invalidate every entry the user has.
    if (candidates.length > 0) ports.log?.('probe-unavailable')
    return {
      checked: 0,
      usable: 0,
      invalidated: [],
      unproven: candidates.map(record => record.id),
      busyCleared: [],
    }
  }

  for (const record of candidates) {
    if (signal.aborted) break
    if (record.childSessionId === undefined) {
      // An active generation with no child cannot serve work at all.
      const reason = '该代际没有可用子会话，需要所有者重新建立。'
      await ports.store.invalidate(record.id, reason, now())
      invalidated.push({ locusId: record.id, reason })
      ports.log?.('child-unusable')
      continue
    }

    let liveness: ChildLiveness
    try {
      liveness = await ports.probe.check({
        parentSessionId: record.parentSessionId,
        childSessionId: record.childSessionId,
        signal,
      })
    } catch (error) {
      // A throwing probe proves nothing; treat it as unknown.
      liveness = {
        kind: 'unknown',
        diagnostic: error instanceof Error ? error.message : String(error),
      }
    }

    if (liveness.kind === 'unusable') {
      // Recorded, never re-created: a fresh child would silently discard the
      // conversation this entry has been having.
      await ports.store.invalidate(record.id, liveness.reason, now())
      invalidated.push({ locusId: record.id, reason: liveness.reason })
      ports.log?.('child-unusable')
      continue
    }
    if (liveness.kind === 'unknown') {
      unproven.push(record.id)
      ports.log?.('child-unknown')
      continue
    }

    usable += 1
    // A continuable child can remain usable while its durable inbox turn is
    // being restored. Never clear a fence that a queued/running Delivery still
    // owns; that would admit a second turn during restart recovery.
    if (record.busy) {
      let pending = true
      try {
        pending = ports.store.hasPendingDelivery === undefined
          ? true
          : await ports.store.hasPendingDelivery(record.id)
      } catch {
        pending = true
      }
      if (!pending) {
        await ports.store.clearBusy(record.id, now())
        busyCleared.push(record.id)
        ports.log?.('stale-busy-cleared')
      }
    }
  }

  return {
    checked: candidates.length,
    usable,
    invalidated,
    unproven,
    busyCleared,
  }
}
