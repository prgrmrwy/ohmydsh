/**
 * Durable source-switch notices.
 *
 * When an endpoint's source changes (S0 -> S1), the people in that entry must
 * be told three things before the new source starts answering: that the source
 * changed, that the context therefore changed, and that the old conversation
 * was NOT merged in. Otherwise the next answer looks like the same assistant
 * suddenly forgetting everything it knew.
 *
 * That makes the notice part of the switch, not a side effect of it:
 *
 * - it is recorded durably with the new generation, so a Host restart between
 *   publishing and sending does not lose it;
 * - while it is pending, the new source MUST NOT dispatch ordinary work — a
 *   silent switch is exactly the failure the spec forbids;
 * - sending is retried, and a retry of an already-sent notice must not post a
 *   second copy into the entry.
 *
 * Delivery cannot be exactly-once against an external chat: a crash between
 * "sent" and "recorded as sent" is unavoidable. This module makes that window
 * as small as possible and prefers a duplicate mechanical notice over a silent
 * switch, which is the safer of the two failures. It never claims otherwise.
 */

import type { LocusEndpoint } from './aggregate.js'

/** One notice owed to an endpoint after its source changed. */
export interface SwitchNotice {
  /** The generation this notice belongs to; a later switch supersedes it. */
  readonly locusId: string
  readonly generation: number
  readonly endpoint: LocusEndpoint
  /** The exact text to post; rendered once at switch time. */
  readonly text: string
  readonly createdAt: number
  /** Failed attempts so far, for diagnostics and backoff decisions. */
  readonly attempts: number
  readonly lastError?: string
}

/** Durable storage for pending notices. */
export interface SwitchNoticeStore {
  /** Record a notice as owed. Called in the same commit as the switch. */
  put(notice: SwitchNotice): Promise<void>
  /** The notice still owed for one locus generation, if any. */
  find(locusId: string, generation: number): SwitchNotice | undefined
  /** Every notice still owed, for startup recovery. */
  list(): readonly SwitchNotice[]
  /** Clear a notice that has been delivered. */
  clear(locusId: string, generation: number): Promise<void>
  /** Record a failed attempt without clearing the debt. */
  recordFailure(locusId: string, generation: number, error: string): Promise<void>
}

/** Posts a mechanical control notice into one entry. */
export interface SwitchNoticeSender {
  send(input: { readonly endpoint: LocusEndpoint; readonly text: string }): Promise<void>
}

/**
 * Back a notice store with the durable `locus_switch_notices` table.
 *
 * Keyed by locus generation, so a later switch's debt is a separate row and
 * delivering one generation's notice can never satisfy another's.
 */
export function createDurableSwitchNoticeStore(domain: {
  table(name: 'locus_switch_notices'): {
    get(key: string): SwitchNotice | undefined
    entries(): IterableIterator<[string, SwitchNotice]>
    put(key: string, value: SwitchNotice): Promise<void>
    delete(key: string): Promise<boolean>
  }
}): SwitchNoticeStore {
  const rowKey = (locusId: string, generation: number): string =>
    `${locusId}\u0000${String(generation)}`
  const table = () => domain.table('locus_switch_notices')

  return {
    put: async (notice) => {
      await table().put(rowKey(notice.locusId, notice.generation), notice)
    },
    find: (locusId, generation) => table().get(rowKey(locusId, generation)),
    list: () => [...table().entries()].map(([, value]) => value),
    clear: async (locusId, generation) => {
      await table().delete(rowKey(locusId, generation))
    },
    recordFailure: async (locusId, generation, error) => {
      const key = rowKey(locusId, generation)
      const current = table().get(key)
      // A cleared notice must not be resurrected by a late failure report.
      if (current === undefined) return
      await table().put(key, { ...current, attempts: current.attempts + 1, lastError: error })
    },
  }
}

export interface SwitchNoticePorts {
  readonly store: SwitchNoticeStore
  /** Absent means notices cannot be delivered, so dispatch stays blocked. */
  readonly sender?: SwitchNoticeSender
  readonly now?: () => number
  readonly log?: (code: SwitchNoticeDiagnostic) => void
}

/** Stable diagnostics; never a message body. */
export type SwitchNoticeDiagnostic =
  | 'notice-recorded'
  | 'notice-delivered'
  | 'notice-send-failed'
  | 'notice-sender-unavailable'
  | 'notice-superseded'

/** Whether an endpoint may dispatch ordinary work right now. */
export type DispatchGate =
  | { readonly allowed: true }
  /** A notice is still owed; dispatching would be a silent switch. */
  | { readonly allowed: false; readonly reason: 'switch-notice-pending' }

export function createSwitchNotices(ports: SwitchNoticePorts): {
  /** Record the notice owed by a freshly published generation. */
  record(input: {
    readonly locusId: string
    readonly generation: number
    readonly endpoint: LocusEndpoint
    readonly text: string
  }): Promise<void>
  /** Attempt delivery; safe to call repeatedly. */
  flush(locusId: string, generation: number): Promise<boolean>
  /** Deliver everything still owed, e.g. after a Host restart. */
  flushAll(): Promise<{ readonly delivered: number; readonly pending: number }>
  /** Whether this generation may dispatch ordinary work. */
  gate(locusId: string, generation: number): DispatchGate
} {
  const now = ports.now ?? Date.now

  const deliver = async (notice: SwitchNotice): Promise<boolean> => {
    const sender = ports.sender
    if (sender === undefined) {
      // Without a sender the debt stands: the gate keeps work blocked rather
      // than letting the new source answer unannounced.
      ports.log?.('notice-sender-unavailable')
      return false
    }
    try {
      await sender.send({ endpoint: notice.endpoint, text: notice.text })
    } catch (error) {
      await ports.store.recordFailure(
        notice.locusId,
        notice.generation,
        error instanceof Error ? error.message : String(error),
      ).catch(() => undefined)
      ports.log?.('notice-send-failed')
      return false
    }
    // Clearing AFTER a successful send is what keeps the failure mode a
    // possible duplicate notice rather than a silent switch.
    await ports.store.clear(notice.locusId, notice.generation)
    ports.log?.('notice-delivered')
    return true
  }

  return {
    async record(input) {
      await ports.store.put({
        locusId: input.locusId,
        generation: input.generation,
        endpoint: { ...input.endpoint },
        text: input.text,
        createdAt: now(),
        attempts: 0,
      })
      ports.log?.('notice-recorded')
    },

    async flush(locusId, generation) {
      const notice = ports.store.find(locusId, generation)
      // Nothing owed is success: a retry after delivery must not post again.
      if (notice === undefined) return true
      return deliver(notice)
    },

    async flushAll() {
      let delivered = 0
      let pending = 0
      for (const notice of ports.store.list()) {
        if (await deliver(notice)) delivered += 1
        else pending += 1
      }
      return { delivered, pending }
    },

    gate(locusId, generation) {
      const notice = ports.store.find(locusId, generation)
      if (notice === undefined) return { allowed: true }
      return { allowed: false, reason: 'switch-notice-pending' }
    },
  }
}
