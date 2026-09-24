/**
 * Startup reconciliation for the durable inquiry ledger and result outbox
 * (design D8; spec `pet-agent-inquiries`, "询问链可恢复可诊断且防重复防循环").
 *
 * Both durable stores already CLASSIFY their unsettled work — `restartDisposition()`
 * on each — but a dispatched inquiry whose outcome was never proven stays
 * non-terminal across a restart, so the requester's original work waits on a
 * result that will never arrive. This module closes exactly that hole and
 * nothing else.
 *
 * It follows the shape of `../locus/reconcile.ts`, and for the same reasons the
 * cheap alternatives are all wrong:
 *
 *  - DURABLE STATE IS THE ONLY EVIDENCE. There is no runtime probe here on
 *    purpose. "Is that inquiry turn still running?" cannot be answered after a
 *    restart, and a seam that appeared to answer it would be guessing.
 *  - PROVABLY UNDISPATCHED WORK SURVIVES. Every `queued` row is left untouched
 *    and stays dispatchable regardless of age. `createdAt` remains diagnostic
 *    display data, never an expiry clock.
 *  - DISPATCHED-BUT-UNKNOWN IS NEVER RETRIED. An `executing`/`answered` row with
 *    no durable result is settled `needs-review`, which the pure transition table
 *    has no edge out of. This module cannot re-dispatch anything: it never
 *    emits a `dispatch` event and holds no scheduler, inbox or agent seam.
 *  - NOBODY IS STRANDED. Every settlement this pass performs first queues a
 *    correlatable FAILURE result for the requester, so the original work has
 *    something to resume with instead of silently vanishing. Queue-then-settle
 *    is the crash-safe order: a crash in between leaves a result with an
 *    unsettled ledger row, which the next pass completes; the reverse order
 *    would leave a terminal inquiry with no result at all.
 *  - IDEMPOTENT BY CONSTRUCTION. Event ids are derived from the inquiry id, the
 *    result dedup key is derived from the outcome, and both stores refuse a
 *    second differing row. Running this twice applies nothing the second time.
 *  - FAIL CLOSED. An unreadable store or a refused write is REPORTED and stops
 *    the pass. Nothing here deletes or rewrites a row to make reconciliation
 *    succeed, and no row is settled on a half-provable picture.
 *
 * What this module must never do, and structurally cannot: wake a model, start a
 * turn, claim an inbox message, send anything outbound, or create/consume a
 * Feishu delivery. Its ports expose two durable stores and an observation clock. The summary
 * it produces carries counts only — never a question, purpose, answer, chat id
 * or member identity — because it is meant for an operator log line.
 */
import type { InquiryRecord } from './ledger.js'
import type { InquiryOutboxRecord } from './outbox.js'

/** Machine codes this pass writes as the `reason` of a settled inquiry. */
export const INQUIRY_RESTART_REASONS = Object.freeze({
  /** Dispatched before the restart; the Host cannot prove what came of it. */
  dispatchOutcomeUnknown: 'restart-dispatch-outcome-unknown',
} as const)

/**
 * The durable ledger, as this pass consumes it.
 *
 * Deliberately narrow: there is no `accept` and no way to reach a scheduler, so
 * no code path here can create or re-dispatch an inquiry.
 */
export interface InquiryReconcileLedger {
  restartDisposition(): {
    readonly recoverable: readonly InquiryRecord[]
    readonly needsReview: readonly InquiryRecord[]
  }
  applyEvent(inquiryId: string, event: unknown): Promise<InquiryRecord>
}

/** The durable result outbox, as this pass consumes it. */
export interface InquiryReconcileOutbox {
  restartDisposition(): {
    readonly recoverable: readonly InquiryOutboxRecord[]
    readonly needsReview: readonly InquiryOutboxRecord[]
  }
  findByInquiry(inquiryId: string): InquiryOutboxRecord | undefined
  queue(facts: unknown): Promise<InquiryOutboxRecord>
}

export interface InquiryReconcilePorts {
  readonly ledger: InquiryReconcileLedger
  readonly outbox: InquiryReconcileOutbox
  /** Host observation clock used only to date needs-review settlement. */
  readonly now?: () => number
  readonly log?: (code: InquiryReconcileDiagnostic) => void
}

export type InquiryReconcileDiagnostic =
  | 'ledger-unreadable'
  | 'outbox-unreadable'
  | 'outbox-write-failed'
  | 'ledger-write-failed'
  | 'inquiry-needs-review'
  | 'inquiry-inconsistent'

export type InquiryReconcileFaultStage =
  | 'ledger-unreadable'
  | 'outbox-unreadable'
  | 'outbox-write-failed'
  | 'ledger-write-failed'

/** A refusal to guess, reported verbatim. The row is left exactly as it was. */
export interface InquiryReconcileFault {
  readonly stage: InquiryReconcileFaultStage
  /** Stable store error code where there is one; otherwise a safe class name. */
  readonly code: string
}

/** Counts per disposition. Suitable for an operator log line; no content. */
export interface InquiryReconcileCounts {
  /** Provably undispatched: untouched and still dispatchable regardless of age. */
  readonly recoverable: number
  /** Dispatched, outcome unproven: settled `needs-review`, never retried. */
  readonly needsReview: number
  /** Dispatched and its result already survived durably: left to the hand-back path. */
  readonly correlated: number
  /** Ledger and outbox disagree in a way this pass will not resolve; reported only. */
  readonly inconsistent: number
}

export interface InquiryResultCounts {
  /** Provably undelivered results, left pending for the normal hand-back. */
  readonly pending: number
  /** Results whose continuation outcome is unproven: review only, never re-delivered. */
  readonly needsReview: number
  /** Failure results this pass created so a settled inquiry is still correlatable. */
  readonly created: number
}

export interface InquiryReconcileReport {
  /** False when any store could not be read or any write was refused. */
  readonly ok: boolean
  readonly inquiries: InquiryReconcileCounts
  readonly results: InquiryResultCounts
  /** Durable mutations actually applied by this pass; 0 on a repeat run. */
  readonly applied: number
  readonly faults: readonly InquiryReconcileFault[]
}

/** Stable code for a store failure, without echoing any stored content. */
function faultCode(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const code = Object.getOwnPropertyDescriptor(error, 'code')
    if (code !== undefined && 'value' in code && typeof code.value === 'string' && code.value.length > 0) {
      return code.value
    }
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && name.length > 0) return name
  }
  return 'UNKNOWN'
}

const empty: InquiryReconcileCounts = Object.freeze({
  recoverable: 0, needsReview: 0, correlated: 0, inconsistent: 0,
})

/**
 * Reconcile the durable inquiry state once at startup.
 *
 * @param ports - the two durable stores plus an optional clock and logger.
 * @returns counts per disposition, what was applied, and any refusal to guess.
 */
export async function reconcileInquiriesAtStartup(
  ports: InquiryReconcilePorts,
): Promise<InquiryReconcileReport> {
  const faults: InquiryReconcileFault[] = []
  const log = (code: InquiryReconcileDiagnostic): void => {
    try {
      ports.log?.(code)
    } catch {
      // A throwing logger must not change what reconciliation decides.
    }
  }
  const fail = (stage: InquiryReconcileFaultStage, error: unknown): void => {
    faults.push({ stage, code: faultCode(error) })
    log(stage)
  }
  const done = (
    inquiries: InquiryReconcileCounts,
    results: InquiryResultCounts,
    applied: number,
  ): InquiryReconcileReport => Object.freeze({
    ok: faults.length === 0,
    inquiries: Object.freeze(inquiries),
    results: Object.freeze(results),
    applied,
    faults: Object.freeze(faults),
  })
  const noResults: InquiryResultCounts = { pending: 0, needsReview: 0, created: 0 }

  // ---- Read both stores BEFORE touching anything. -------------------------
  // A settlement decided from a half-provable picture is exactly the guess this
  // pass exists to refuse: the outbox is what proves whether a dispatched
  // inquiry's outcome actually survived.
  let ledgerState: ReturnType<InquiryReconcileLedger['restartDisposition']>
  try {
    ledgerState = ports.ledger.restartDisposition()
  } catch (error) {
    fail('ledger-unreadable', error)
    return done(empty, noResults, 0)
  }

  let outboxState: ReturnType<InquiryReconcileOutbox['restartDisposition']>
  try {
    outboxState = ports.outbox.restartDisposition()
  } catch (error) {
    fail('outbox-unreadable', error)
    return done(empty, noResults, 0)
  }

  const now = (ports.now ?? Date.now)()
  const counts = {
    recoverable: 0, needsReview: 0, correlated: 0, inconsistent: 0,
  }
  const results = {
    // Pending results are read-only facts here: a provably undelivered result
    // stays pending for the normal hand-back path, and an unproven one is
    // review-only. This pass re-delivers neither.
    pending: outboxState.recoverable.length,
    needsReview: outboxState.needsReview.length,
    created: 0,
  }
  let applied = 0

  /** The one existing result for an inquiry, or a fault we refuse to guess past. */
  const existingResult = (inquiryId: string): { ok: true; row: InquiryOutboxRecord | undefined } | { ok: false } => {
    try {
      return { ok: true, row: ports.outbox.findByInquiry(inquiryId) }
    } catch (error) {
      fail('outbox-unreadable', error)
      return { ok: false }
    }
  }

  /**
   * Settle ONE dispatched-unknown inquiry: queue its correlatable failure
   * result first, then move the ledger row to its terminal status. The event id
   * is deterministic, so a redelivery is a no-op rather than a second advance.
   */
  const settle = async (
    record: InquiryRecord,
    type: 'needs-review',
    failure: 'needs-review',
    reason: string,
    at: number,
    existing: InquiryOutboxRecord | undefined,
  ): Promise<boolean> => {
    if (existing === undefined) {
      try {
        await ports.outbox.queue({
          inquiryId: record.id,
          requester: record.requester,
          // Fixed at accept time and copied verbatim: there is no rebinding to
          // a newer Delivery here because there is no field to rebind.
          resumeWork: record.origin,
          result: { kind: 'failure', failure, reason, failedAt: at },
          createdAt: at,
        })
      } catch (error) {
        // Never settle the ledger anyway: a terminal inquiry with no result
        // would strand the original work with nothing to correlate.
        fail('outbox-write-failed', error)
        return false
      }
      results.created += 1
      applied += 1
    }
    try {
      await ports.ledger.applyEvent(record.id, {
        type,
        eventId: `restart:${record.id}:${failure}`,
        at,
        reason,
      })
    } catch (error) {
      fail('ledger-write-failed', error)
      return false
    }
    applied += 1
    return true
  }

  // Every provably undispatched row survives, regardless of wait age. No
  // result lookup or durable write is needed because elapsed time is not an
  // inconsistency and cannot manufacture an outcome.
  counts.recoverable = ledgerState.recoverable.length

  // ---- Dispatched work whose outcome the Host cannot prove. ---------------
  for (const record of ledgerState.needsReview) {
    const found = existingResult(record.id)
    if (!found.ok) return done(counts, results, applied)
    const existing = found.row
    if (existing !== undefined && existing.status !== 'pending') {
      counts.inconsistent += 1
      log('inquiry-inconsistent')
      continue
    }
    if (existing !== undefined && existing.result.kind === 'answer') {
      // The answer DID survive the restart durably, so this outcome is not
      // unknown at all. Settling it needs-review would destroy a good pending
      // result; the normal hand-back path owns this one.
      counts.correlated += 1
      continue
    }
    if (!await settle(
      record, 'needs-review', 'needs-review', INQUIRY_RESTART_REASONS.dispatchOutcomeUnknown,
      // Observed now, but never before the row's own last transition.
      Math.max(now, record.statusAt), existing,
    )) return done(counts, results, applied)
    counts.needsReview += 1
    log('inquiry-needs-review')
  }

  return done(counts, results, applied)
}

/**
 * One operator log line for a reconciliation pass.
 *
 * Counts and stable fault codes only: no inquiry id, no question, no purpose,
 * no answer, no chat id and no member identity ever reaches a log sink through
 * here. Always a single line, so it cannot break a line-oriented log.
 * @param report - the report to summarize.
 * @returns the log line.
 */
export function summarizeInquiryReconciliation(report: InquiryReconcileReport): string {
  const { inquiries, results } = report
  const parts = [
    `inquiry-reconcile ${report.ok ? 'ok' : 'faulted'}`,
    `recoverable=${String(inquiries.recoverable)}`,
    `needs-review=${String(inquiries.needsReview)}`,
    `correlated=${String(inquiries.correlated)}`,
    `inconsistent=${String(inquiries.inconsistent)}`,
    `results-pending=${String(results.pending)}`,
    `results-needs-review=${String(results.needsReview)}`,
    `results-created=${String(results.created)}`,
    `applied=${String(report.applied)}`,
  ]
  if (report.faults.length > 0) {
    parts.push(`faults=${report.faults.map(fault => `${fault.stage}/${fault.code}`).join(',')}`)
  }
  return parts.join(' ').replace(/\s+/g, ' ')
}
