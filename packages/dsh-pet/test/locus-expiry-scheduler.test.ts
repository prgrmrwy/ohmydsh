/**
 * The deadline timer that turns a durable lease into an actual expiry.
 *
 * Every other suite covers what happens AFTER expiry is decided: the pure CAS,
 * the durable CAS, and the queue advancement. None of them proves the step that
 * connects a stored deadline to those calls — arming a timer, re-reading the
 * row when it fires, and only then running the CAS. That step lived inline in
 * the Host closure and was therefore never executed by any test: a timer armed
 * with the wrong delay, a missed re-arm after `wait`, or a lost CAS that still
 * advanced the queue would all have gone unnoticed.
 *
 * These cases drive the real scheduler with injected time, so the timing
 * behavior itself is asserted rather than the 1-hour wall clock.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  createExpiryScheduler,
  effectiveDeliveryDeadline,
} from '../src/host/locus/expiry-scheduler.js'
import { MAX_DELIVERY_LEASE_MS } from '../src/host/locus/delivery.js'
import type { DeliveryCorrelation, DeliveryRecord } from '../src/host/locus/delivery.js'

const ACCEPTED_AT = 1_000_000
const HOUR = 60 * 60 * 1000

const CORRELATION: DeliveryCorrelation = {
  endpoint: { chatId: 'oc_sched' },
  locusId: 'locus-sched',
  generation: 2,
  childSessionId: 'child-sched',
}

/** One current Delivery holding a live lease. */
function currentRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    deliveryId: 'delivery-sched',
    messageId: 'om_sched',
    endpoint: CORRELATION.endpoint,
    locusId: CORRELATION.locusId,
    generation: CORRELATION.generation,
    childSessionId: CORRELATION.childSessionId,
    senderOpenId: 'ou_sender',
    text: 'please answer',
    sequence: 1,
    status: 'current',
    queueState: 'current',
    acceptedAt: ACCEPTED_AT,
    deadlineAt: ACCEPTED_AT + HOUR,
    hardDeadlineAt: ACCEPTED_AT + MAX_DELIVERY_LEASE_MS,
    revision: 1,
    stateRevision: 1,
    outboundResult: 'none',
    feedbackTarget: { chatId: 'oc_sched', messageId: 'om_sched' },
    ...overrides,
  } as DeliveryRecord
}

/**
 * Drive the scheduler with one controllable clock and timer queue.
 *
 * `fire()` advances the clock and runs the timers that became due, which is the
 * only way to observe a deadline being crossed without waiting for it.
 */
function harness(initial: DeliveryRecord) {
  let clock = ACCEPTED_AT
  const timers: { id: number; at: number; handler: () => void }[] = []
  let nextId = 1
  let stored: DeliveryRecord | undefined = initial

  const expireCalls: { deliveryId: string; now: number; expectedRevision: number }[] = []
  const advanced: { deliveryId: string; outcome: string }[] = []
  const laneCalls: string[] = []
  let expireResult: { changed: boolean; record?: DeliveryRecord | undefined } | undefined

  const scheduler = createExpiryScheduler({
    repository: {
      getDelivery: (deliveryId) => (stored?.deliveryId === deliveryId ? stored : undefined),
      expireCurrentDelivery: async (input) => {
        expireCalls.push({
          deliveryId: input.deliveryId,
          now: input.now,
          expectedRevision: input.expectedRevision,
        })
        const result = expireResult ?? {
          changed: true,
          record: { ...stored!, status: 'expired', queueState: undefined, revision: 2 } as DeliveryRecord,
        }
        if (result.changed && result.record !== undefined) stored = result.record
        return result
      },
    },
    withDispatchLane: async (correlation, operation) => {
      laneCalls.push(`${correlation.locusId}#${correlation.generation}`)
      return operation()
    },
    finishAndAdvance: async (record, _correlation, outcome) => {
      advanced.push({ deliveryId: record.deliveryId, outcome })
    },
    now: () => clock,
    setTimer: (handler, delayMs) => {
      const id = nextId++
      timers.push({ id, at: clock + delayMs, handler })
      return id
    },
    clearTimer: (timer) => {
      const index = timers.findIndex(entry => entry.id === timer)
      if (index >= 0) timers.splice(index, 1)
    },
  })

  return {
    scheduler,
    expireCalls,
    advanced,
    laneCalls,
    get armedDelays() { return timers.map(entry => entry.at - ACCEPTED_AT) },
    get stored() { return stored },
    setStored(record: DeliveryRecord | undefined) { stored = record },
    setExpireResult(result: { changed: boolean; record?: DeliveryRecord | undefined }) {
      expireResult = result
    },
    /** Advance the clock and run every timer that became due. */
    async fire(toMs: number) {
      clock = toMs
      const due = timers.filter(entry => entry.at <= clock)
      for (const entry of due) {
        const index = timers.indexOf(entry)
        if (index >= 0) timers.splice(index, 1)
        entry.handler()
      }
      await vi.waitFor(() => {})
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('the Delivery deadline scheduler', () => {
  it('arms the timer for the exact lease deadline and expires the row when it passes', async () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord())

    // Armed for the lease, not for the 24-hour hard cap.
    expect(host.armedDelays).toEqual([HOUR])
    expect(host.expireCalls).toEqual([])

    await host.fire(ACCEPTED_AT + HOUR)

    // The CAS is guarded by the revision the scheduler re-read at fire time.
    expect(host.expireCalls).toEqual([
      { deliveryId: 'delivery-sched', now: ACCEPTED_AT + HOUR, expectedRevision: 1 },
    ])
    // Expiry must advance the locus so a waiting backlog Delivery is dispatched.
    expect(host.advanced).toEqual([{ deliveryId: 'delivery-sched', outcome: 'failed' }])
    // The work ran inside the locus dispatch lane, not concurrently with it.
    expect(host.laneCalls).toEqual(['locus-sched#2'])
    expect(host.scheduler.size).toBe(0)
  })

  it('never arms past the hard cap, even when the stored deadline is corrupt', () => {
    // A `deadlineAt` beyond `acceptedAt + 24h` must not push the timer past the
    // hard cap: the cap is the outer bound the lease can never exceed.
    const corrupt = currentRecord({ deadlineAt: ACCEPTED_AT + 100 * HOUR })
    expect(effectiveDeliveryDeadline(corrupt)).toBe(ACCEPTED_AT + MAX_DELIVERY_LEASE_MS)

    const host = harness(corrupt)
    host.scheduler.schedule(corrupt)
    expect(host.armedDelays).toEqual([MAX_DELIVERY_LEASE_MS])
  })

  it('re-arms instead of expiring when a wait extended the lease after arming', async () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord())
    expect(host.armedDelays).toEqual([HOUR])

    // `pet_locus_wait` extended the lease while the timer slept.
    host.setStored(currentRecord({ deadlineAt: ACCEPTED_AT + 2 * HOUR, revision: 2 }))
    await host.fire(ACCEPTED_AT + HOUR)

    // The Delivery is still live, so nothing may expire or advance...
    expect(host.expireCalls).toEqual([])
    expect(host.advanced).toEqual([])
    // ...and the timer must be re-armed for the NEW deadline, otherwise an
    // extended lease would simply never expire.
    expect(host.armedDelays).toEqual([2 * HOUR])
  })

  it('does nothing when the row is no longer the current Delivery', async () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord())

    // A finish won while the timer slept.
    host.setStored(currentRecord({ status: 'replied', queueState: undefined, revision: 3 }))
    await host.fire(ACCEPTED_AT + HOUR)

    expect(host.expireCalls).toEqual([])
    expect(host.advanced).toEqual([])
  })

  it('does not advance the queue when the expiry CAS loses to a concurrent finish', async () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord())
    // The row still read as current, but the CAS was beaten by a finish that
    // committed first. That path owns the advancement; advancing here too would
    // dispatch the next Delivery twice.
    host.setExpireResult({ changed: false, record: undefined })

    await host.fire(ACCEPTED_AT + HOUR)

    expect(host.expireCalls).toHaveLength(1)
    expect(host.advanced).toEqual([])
  })

  it('keeps one timer per Delivery when scheduled repeatedly', () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord())
    host.scheduler.schedule(currentRecord({ deadlineAt: ACCEPTED_AT + 3 * HOUR }))
    host.scheduler.schedule(currentRecord({ deadlineAt: ACCEPTED_AT + 2 * HOUR }))

    // Re-arming replaces rather than accumulates: a stale timer would expire a
    // Delivery whose lease has since moved.
    expect(host.scheduler.size).toBe(1)
    expect(host.armedDelays).toEqual([2 * HOUR])
  })

  it('ignores a row that holds no current lease', () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord({ status: 'accepted', queueState: 'backlog' }))
    host.scheduler.schedule(currentRecord({ status: 'replied', queueState: undefined }))
    expect(host.scheduler.size).toBe(0)
  })

  it('fires immediately when the deadline already passed', async () => {
    const host = harness(currentRecord())
    // Restart recovery re-arms a row whose deadline expired while down; a
    // negative delay must clamp to 0 rather than overflow the timer.
    const late = currentRecord({ deadlineAt: ACCEPTED_AT - HOUR })
    host.setStored(late)
    host.scheduler.schedule(late)
    expect(host.armedDelays).toEqual([0])

    await host.fire(ACCEPTED_AT)
    expect(host.expireCalls).toHaveLength(1)
    expect(host.advanced).toEqual([{ deliveryId: 'delivery-sched', outcome: 'failed' }])
  })

  it('cancels every armed timer on dispose', () => {
    const host = harness(currentRecord())
    host.scheduler.schedule(currentRecord())
    host.scheduler.schedule(currentRecord({ deliveryId: 'delivery-other', messageId: 'om_other' }))
    expect(host.scheduler.size).toBe(2)

    host.scheduler.dispose()

    expect(host.scheduler.size).toBe(0)
    expect(host.armedDelays).toEqual([])
  })
})
