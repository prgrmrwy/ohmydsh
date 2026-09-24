/**
 * In-memory deadline scheduler for the current Delivery of each locus.
 *
 * A Delivery lease is a durable fact, but nothing re-reads it on a timer: the
 * durable row only records WHEN the lease ends, so some live component has to
 * notice that moment and run the expiry CAS. This scheduler is that component.
 *
 * It owns no state beyond its timer table: expiry itself is the durable CAS in
 * the repository, and advancing the queue is the controller's `dispatchNext`.
 * Both are injected so the timing behavior can be driven directly, without a
 * Host, a runtime, or a real clock.
 */

import type { DeliveryCorrelation, DeliveryRecord } from './delivery.js'
import { MAX_DELIVERY_LEASE_MS } from './delivery.js'

/** Durable expiry seam: the exact CAS that terminates one current Delivery. */
export interface ExpirySchedulerRepository {
  /** Read the row as currently stored, or `undefined` when it is gone. */
  getDelivery(deliveryId: string): DeliveryRecord | undefined
  /** Terminate the exact current row, guarded by its revision. */
  expireCurrentDelivery(input: DeliveryCorrelation & {
    readonly deliveryId: string
    readonly now: number
    readonly expectedRevision: number
  }): Promise<{ readonly changed: boolean; readonly record?: DeliveryRecord | undefined }>
}

/** Everything the scheduler needs from its Host. */
export interface ExpirySchedulerDeps {
  readonly repository: ExpirySchedulerRepository
  /**
   * Serialize this work against the locus's other dispatch operations, so an
   * expiry can never interleave with a concurrent finish on the same locus.
   */
  readonly withDispatchLane: <T>(
    correlation: DeliveryCorrelation,
    operation: () => Promise<T>,
  ) => Promise<T>
  /** Release the finished Delivery and claim/queue the locus's next one. */
  readonly finishAndAdvance: (
    record: DeliveryRecord,
    correlation: DeliveryCorrelation,
    outcome: 'settled' | 'failed',
  ) => Promise<void>
  /** Injected for tests; defaults to the real clock. */
  readonly now?: () => number
  /** Injected for tests; defaults to the real timer. */
  readonly setTimer?: (handler: () => void, delayMs: number) => unknown
  /** Injected for tests; defaults to the real timer. */
  readonly clearTimer?: (timer: unknown) => void
}

/** Arms and re-arms the per-Delivery expiry timers for one Host. */
export interface ExpiryScheduler {
  /**
   * Arm (or re-arm) the timer for one current Delivery.
   *
   * Non-current rows and rows without a resolvable deadline are ignored: only
   * a current row holds the lease this scheduler exists to enforce.
   */
  schedule(record: DeliveryRecord): void
  /** Cancel every armed timer, for Host teardown. */
  dispose(): void
  /** Number of armed timers; lets teardown and re-arm be asserted directly. */
  readonly size: number
}

/**
 * A current row's effective deadline is never later than its own hard cap.
 *
 * A corrupt or stale `deadlineAt` beyond `acceptedAt + 24h` must not delay the
 * timer past the hard cap either. Mirrors the same normalization in the pure
 * and durable expiry CAS.
 * @param record - the Delivery to read.
 * @returns the effective deadline, or `undefined` when none is resolvable.
 */
export function effectiveDeliveryDeadline(record: DeliveryRecord): number | undefined {
  const hard = record.hardDeadlineAt
    ?? (record.acceptedAt === undefined ? undefined : record.acceptedAt + MAX_DELIVERY_LEASE_MS)
  if (hard === undefined) return record.deadlineAt
  return record.deadlineAt === undefined ? hard : Math.min(record.deadlineAt, hard)
}

/**
 * Create the expiry scheduler.
 * @param deps - durable expiry seam, lane, advancement, and clock/timer hooks.
 * @returns the scheduler.
 */
export function createExpiryScheduler(deps: ExpirySchedulerDeps): ExpiryScheduler {
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? ((handler, delay) => {
    const timer = setTimeout(handler, delay)
    // A pending expiry must never hold the process open on its own.
    ;(timer as { unref?: () => void }).unref?.()
    return timer
  })
  const clearTimer = deps.clearTimer ?? ((timer) => { clearTimeout(timer as ReturnType<typeof setTimeout>) })
  const timers = new Map<string, unknown>()

  const scheduler: ExpiryScheduler = {
    get size() { return timers.size },

    schedule(record: DeliveryRecord): void {
      const deadline = effectiveDeliveryDeadline(record)
      if (record.status !== 'current' || deadline === undefined) return
      const correlation: DeliveryCorrelation = {
        endpoint: { ...record.endpoint },
        locusId: record.locusId,
        generation: record.generation,
        childSessionId: record.childSessionId,
      }
      // Keyed by generation as well: a rebuilt locus reuses delivery ids from
      // its own sequence, and a stale generation's timer must never terminate
      // the new generation's row.
      const key = `${record.deliveryId}\u0000${record.generation}`
      const previous = timers.get(key)
      if (previous !== undefined) clearTimer(previous)
      // `setTimeout` silently fires immediately past the 32-bit delay ceiling,
      // which for a 24-hour cap would otherwise expire the lease at once.
      const delay = Math.max(0, Math.min(deadline - now(), 2_147_483_647))
      const timer = setTimer(() => {
        void deps.withDispatchLane(correlation, async () => {
          // Re-read rather than trusting the captured record: a finish, an
          // expiry, or a wait may have moved this row while the timer slept.
          const current = deps.repository.getDelivery(record.deliveryId)
          if (
            current === undefined ||
            current.status !== 'current' ||
            current.queueState !== 'current' ||
            current.revision === undefined
          ) return
          const firedAt = now()
          const currentDeadline = effectiveDeliveryDeadline(current)
          // A `wait` extended the lease after this timer was armed: re-arm for
          // the new deadline instead of expiring a Delivery that is still live.
          if (currentDeadline !== undefined && firedAt < currentDeadline) {
            scheduler.schedule(current)
            return
          }
          const expired = await deps.repository.expireCurrentDelivery({
            ...correlation,
            deliveryId: current.deliveryId,
            now: firedAt,
            expectedRevision: current.revision,
          })
          // A lost CAS means a concurrent finish won the race; that path owns
          // the advancement, so this timer must not advance the queue again.
          if (!expired.changed || expired.record === undefined) return
          await deps.finishAndAdvance(expired.record, correlation, 'failed')
        }).finally(() => {
          if (timers.get(key) === timer) timers.delete(key)
        })
      }, delay)
      timers.set(key, timer)
    },

    dispose(): void {
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
    },
  }
  return scheduler
}
