/**
 * Non-steering inquiry scheduler (pure logic).
 *
 * Decides what may run NEXT for one target session. It owns no Agent, no Inbox,
 * no timers and no I/O: every fact arrives through injected structural inputs and
 * an injected clock, so the whole policy is deterministic and replayable.
 *
 * Invariants implemented here (spec `pet-agent-inquiries`, design D5/D7):
 *  - One work segment at a time per session, with a PROVEN single origin. The
 *    possible origins are the original Feishu delivery, an independent inquiry
 *    turn, an inquiry-result continuation, or local/GUI work.
 *  - A queued inquiry is never merged into a busy target's current segment. While
 *    the target is busy the inquiry stays queued, in accepted order.
 *  - Dispatching an INQUIRY requires a PROVEN runtime isolated-claim capability
 *    (`./capability.ts`). Without it the inquiry is refused before anything else,
 *    with its own reason, and stays queued. This is not the same failure as a
 *    mixed claim: refusing a combined claim after the fact would destroy the
 *    user's pending GUI input, which `Inbox.claim` cannot re-deliver.
 *  - A claim that carries foreign traffic is UNUSABLE for an inquiry. The reviewed
 *    runtime can co-claim a pending GUI next-step message together with a next-turn
 *    inquiry (see test/inquiry-runtime-probe.test.ts "BASELINE"), so this module
 *    fails closed EVEN WHEN the capability is present: the inquiry is reported as
 *    not dispatched and still queued rather than executed mixed with GUI input.
 *  - Waiting for an answer does NOT hold the requester's run slot. `occupiesRunSlot`
 *    (may I start a segment now?) and `hasWorkInFlight` (is business work still
 *    unsettled for busy/locking?) are two independent predicates, so two roots that
 *    wait on each other can each keep making progress.
 *  - An answer arriving while the requester is busy is queued, never an interrupt.
 *  - Queues are bounded with deterministic overflow outcomes and stable ordering.
 *
 * This module deliberately defines its own minimal structural input types and does
 * not import the inquiry ledger value model, which is owned elsewhere. Its one
 * import is the capability VERDICT type: the detection itself stays outside.
 */
import {
  ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED,
  type IsolatedQueuedTurnClaimSupport,
} from './capability.js'

/** Provable origin of one execution segment. Never inferred from prompt text. */
export type SegmentOrigin = 'delivery' | 'inquiry' | 'inquiry-result' | 'local'

/**
 * One message the runtime handed over inside a single claim. `ref` is the Host-side
 * anchor the origin is bound to (delivery id / inquiryId); local GUI traffic has none.
 */
export interface ClaimEntry {
  readonly messageId: string
  readonly origin: SegmentOrigin
  readonly ref?: string
}

export type ClaimClassification =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'single-origin'; readonly origin: SegmentOrigin; readonly ref?: string }
  | {
      readonly kind: 'mixed'
      readonly origins: readonly SegmentOrigin[]
      readonly refs: readonly string[]
    }

export interface RunningSegment {
  readonly segmentId: string
  readonly sessionId: string
  readonly origin: SegmentOrigin
  readonly ref?: string
  readonly claimedMessageIds: readonly string[]
  readonly startedAt: number
  /**
   * Present only on an inquiry segment, where it is always `true`: the runtime
   * capability was proven before this claim, so the claim scope was narrowed to
   * the head queued turn and pending GUI input was left pending. Other origins
   * claim no queued inquiry turn and omit it.
   */
  readonly isolatedQueuedTurnClaim?: true
}

export interface InquiryRequest {
  readonly inquiryId: string
  readonly requesterSessionId: string
  readonly targetSessionId: string
  /** Original work anchor (e.g. a Delivery id) this inquiry serves, when there is one. */
  readonly requesterWorkId?: string
}

export type InquiryPhase = 'queued' | 'executing' | 'answered' | 'result-delivered'

export interface PendingInquiry extends InquiryRequest {
  readonly seq: number
  readonly acceptedAt: number
  readonly phase: InquiryPhase
}

export interface PendingResult {
  readonly inquiryId: string
  readonly requesterSessionId: string
  readonly requesterWorkId?: string
  readonly seq: number
  readonly answeredAt: number
}

export type AcceptRejectReason =
  | 'invalid-input'
  | 'self-target'
  | 'duplicate-inquiry'
  | 'queue-overflow'

export type AcceptResult =
  | { readonly accepted: true; readonly inquiryId: string; readonly queuePosition: number }
  | {
      readonly accepted: false
      readonly inquiryId: string
      readonly reason: AcceptRejectReason
      readonly limit?: number
    }

export type DispatchRejectReason =
  | 'empty-claim'
  | 'invalid-claim'
  | 'mixed-claim'
  /**
   * The runtime cannot prove it will claim ONLY the head queued turn, so no
   * inquiry turn may start. Distinct from `mixed-claim`: nothing was claimed and
   * nothing was lost, and unlike `target-busy` waiting does not help — the
   * runtime has to be rebuilt with the seam.
   */
  | 'isolated-claim-unsupported'
  | 'unidentified-claim'
  | 'not-queued'
  | 'out-of-order'
  | 'target-busy'

export type DispatchResult =
  | { readonly dispatched: true; readonly segment: RunningSegment }
  | {
      readonly dispatched: false
      readonly reason: DispatchRejectReason
      readonly inquiryId?: string
      /** True when the refusal left an accepted inquiry queued and still runnable later. */
      readonly stillQueued?: boolean
    }

export type AnswerRejectReason =
  | 'invalid-input'
  | 'unknown-inquiry'
  | 'inquiry-not-dispatched'
  | 'duplicate-answer'
  | 'queue-overflow'

export type AnswerResult =
  | {
      readonly accepted: true
      readonly inquiryId: string
      /** Queued either way: an answer is a future segment, never an interrupt. */
      readonly queuedBecause: 'requester-busy' | 'requester-idle'
      readonly queuePosition: number
    }
  | {
      readonly accepted: false
      readonly inquiryId: string
      readonly reason: AnswerRejectReason
      readonly limit?: number
    }

export type RunnableNext =
  | { readonly kind: 'inquiry'; readonly inquiryId: string; readonly seq: number }
  | { readonly kind: 'inquiry-result'; readonly inquiryId: string; readonly seq: number }

export type BusyReason =
  | 'running-segment'
  | 'open-work'
  | 'awaiting-inquiry-answer'
  | 'pending-inquiry-result'

export interface BusyVerdict {
  readonly busy: boolean
  readonly reasons: readonly BusyReason[]
}

export interface SchedulerLimits {
  /** Max queued (not yet answered) inquiries per TARGET session. */
  readonly maxQueuedInquiries: number
  /** Max queued inquiry results per REQUESTER session. */
  readonly maxQueuedResults: number
}

export const DEFAULT_SCHEDULER_LIMITS: SchedulerLimits = {
  maxQueuedInquiries: 32,
  maxQueuedResults: 32,
}

export interface SchedulerClock {
  now(): number
}

/** Serializable snapshot. Durable persistence is the caller's responsibility. */
export interface SchedulerState {
  readonly seq: number
  readonly inquiries: readonly PendingInquiry[]
  readonly results: readonly PendingResult[]
  readonly segments: readonly RunningSegment[]
  readonly openWork: readonly { readonly sessionId: string; readonly workId: string }[]
}

export interface SchedulerOptions {
  readonly clock: SchedulerClock
  readonly limits?: Partial<SchedulerLimits>
  readonly state?: SchedulerState
  /**
   * The caller's PROVEN verdict from `detectIsolatedQueuedTurnClaim`. Omitted
   * means not probed, which is unavailable: a caller cannot obtain the
   * capability by forgetting to pass it.
   */
  readonly isolatedQueuedTurnClaim?: IsolatedQueuedTurnClaimSupport
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

const ORIGIN_ORDER: readonly SegmentOrigin[] = ['delivery', 'inquiry', 'inquiry-result', 'local']

function validOrigin(value: unknown): value is SegmentOrigin {
  return ORIGIN_ORDER.includes(value as SegmentOrigin)
}

/**
 * Prove that one claim corresponds to exactly one work segment origin.
 *
 * Anything else — an empty claim, a structurally invalid entry, two origins in one
 * claim, or two different anchors of the same origin — is refused rather than
 * resolved by preference, because the runtime co-claim gap means a "mostly right"
 * claim can silently carry foreign GUI input into an inquiry turn.
 */
export function classifyClaim(entries: readonly ClaimEntry[]): ClaimClassification {
  if (!Array.isArray(entries) || entries.length === 0) return { kind: 'empty' }
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') return { kind: 'invalid' }
    if (!validId(entry.messageId)) return { kind: 'invalid' }
    if (!validOrigin(entry.origin)) return { kind: 'invalid' }
    if (entry.ref !== undefined && !validId(entry.ref)) return { kind: 'invalid' }
  }
  const origins = [...new Set(entries.map(entry => entry.origin))].sort(
    (a, b) => ORIGIN_ORDER.indexOf(a) - ORIGIN_ORDER.indexOf(b),
  )
  const refs = [...new Set(entries.flatMap(entry => (entry.ref === undefined ? [] : [entry.ref])))].sort()
  if (origins.length !== 1 || refs.length > 1) return { kind: 'mixed', origins, refs }
  const origin = origins[0]!
  const ref = refs[0]
  return ref === undefined ? { kind: 'single-origin', origin } : { kind: 'single-origin', origin, ref }
}

/** Origins whose segment must be bound to a queued Host-side anchor. */
const ANCHORED: readonly SegmentOrigin[] = ['inquiry', 'inquiry-result']

export class InquiryScheduler {
  readonly #clock: SchedulerClock
  readonly #limits: SchedulerLimits
  /** Fixed at construction: a scheduler never re-probes or upgrades itself. */
  readonly #isolatedClaim: IsolatedQueuedTurnClaimSupport
  #seq: number
  /** Accepted-order insertion is preserved by Map iteration order. */
  readonly #inquiries = new Map<string, PendingInquiry>()
  readonly #results = new Map<string, PendingResult>()
  readonly #segments = new Map<string, RunningSegment>()
  readonly #running = new Map<string, string>()
  readonly #openWork = new Map<string, Set<string>>()

  constructor(options: SchedulerOptions) {
    if (!options || typeof options.clock?.now !== 'function') {
      throw new TypeError('InquiryScheduler requires an injected clock')
    }
    this.#clock = options.clock
    this.#limits = { ...DEFAULT_SCHEDULER_LIMITS, ...(options.limits ?? {}) }
    // Only an explicit, well-formed `available: true` verdict counts. Anything
    // else — omitted, malformed, or an unavailable verdict — stays closed.
    const support = options.isolatedQueuedTurnClaim
    this.#isolatedClaim = support?.available === true
      ? { available: true }
      : support?.available === false
        ? { available: false, reason: support.reason }
        : ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED
    this.#seq = 0
    const state = options.state
    if (state) {
      this.#seq = Number.isSafeInteger(state.seq) && state.seq >= 0 ? state.seq : 0
      for (const row of [...state.inquiries].sort((a, b) => a.seq - b.seq)) {
        this.#inquiries.set(row.inquiryId, row)
      }
      for (const row of [...state.results].sort((a, b) => a.seq - b.seq)) {
        this.#results.set(row.inquiryId, row)
      }
      for (const segment of state.segments) {
        this.#segments.set(segment.segmentId, segment)
        this.#running.set(segment.sessionId, segment.segmentId)
      }
      for (const row of state.openWork) this.#openWorkOf(row.sessionId).add(row.workId)
    }
  }

  // ---------------------------------------------------------------- work anchors

  #openWorkOf(sessionId: string): Set<string> {
    let set = this.#openWork.get(sessionId)
    if (!set) {
      set = new Set<string>()
      this.#openWork.set(sessionId, set)
    }
    return set
  }

  /** Record that a session has business work (a Delivery / local request) in flight. */
  openWork(sessionId: string, workId: string): boolean {
    if (!validId(sessionId) || !validId(workId)) return false
    const set = this.#openWorkOf(sessionId)
    if (set.has(workId)) return false
    set.add(workId)
    return true
  }

  /** Settle business work. Idempotent; unknown work is inert. */
  settleWork(workId: string): boolean {
    if (!validId(workId)) return false
    let removed = false
    for (const [sessionId, set] of this.#openWork) {
      if (set.delete(workId)) {
        removed = true
        if (set.size === 0) this.#openWork.delete(sessionId)
      }
    }
    return removed
  }

  // ---------------------------------------------------------------- acceptance

  acceptInquiry(request: InquiryRequest): AcceptResult {
    const id = request?.inquiryId
    const reject = (reason: AcceptRejectReason, limit?: number): AcceptResult =>
      limit === undefined
        ? { accepted: false, inquiryId: validId(id) ? id : '', reason }
        : { accepted: false, inquiryId: validId(id) ? id : '', reason, limit }
    if (!request || typeof request !== 'object') return reject('invalid-input')
    if (!validId(id) || !validId(request.requesterSessionId) || !validId(request.targetSessionId)) {
      return reject('invalid-input')
    }
    if (request.requesterWorkId !== undefined && !validId(request.requesterWorkId)) {
      return reject('invalid-input')
    }
    if (request.requesterSessionId === request.targetSessionId) return reject('self-target')
    if (this.#inquiries.has(id)) return reject('duplicate-inquiry')

    const queued = this.pendingInquiries(request.targetSessionId)
    if (queued.length >= this.#limits.maxQueuedInquiries) {
      // Deterministic overflow: the NEWEST submission is refused; the existing
      // accepted order is never reshuffled or evicted.
      return reject('queue-overflow', this.#limits.maxQueuedInquiries)
    }

    const seq = (this.#seq += 1)
    const base = {
      inquiryId: id,
      requesterSessionId: request.requesterSessionId,
      targetSessionId: request.targetSessionId,
      seq,
      acceptedAt: this.#clock.now(),
      phase: 'queued' as const,
    }
    this.#inquiries.set(
      id,
      request.requesterWorkId === undefined ? base : { ...base, requesterWorkId: request.requesterWorkId },
    )
    return { accepted: true, inquiryId: id, queuePosition: queued.length }
  }

  /** Terminate an inquiry branch. Returns false when nothing live matched. */
  cancelInquiry(inquiryId: string): boolean {
    if (!validId(inquiryId)) return false
    const row = this.#inquiries.get(inquiryId)
    if (!row) return false
    this.#inquiries.delete(inquiryId)
    this.#results.delete(inquiryId)
    return true
  }

  // ---------------------------------------------------------------- queries

  pendingInquiries(targetSessionId: string): readonly PendingInquiry[] {
    if (!validId(targetSessionId)) return []
    return [...this.#inquiries.values()]
      .filter(row => row.targetSessionId === targetSessionId && row.phase === 'queued')
      .sort((a, b) => a.seq - b.seq)
  }

  pendingResults(requesterSessionId: string): readonly PendingResult[] {
    if (!validId(requesterSessionId)) return []
    return [...this.#results.values()]
      .filter(row => row.requesterSessionId === requesterSessionId)
      .sort((a, b) => a.seq - b.seq)
  }

  /** Inquiries this session issued that have not produced a delivered result yet. */
  outstandingInquiries(requesterSessionId: string): readonly PendingInquiry[] {
    if (!validId(requesterSessionId)) return []
    return [...this.#inquiries.values()]
      .filter(row => row.requesterSessionId === requesterSessionId && row.phase !== 'result-delivered')
      .sort((a, b) => a.seq - b.seq)
  }

  /**
   * The capability verdict this scheduler was built with. Exposed so a caller
   * can explain WHY inquiries are unavailable (e.g. mark a roster member
   * not-inquirable) without re-running detection or guessing a reason.
   */
  isolatedQueuedTurnClaimSupport(): IsolatedQueuedTurnClaimSupport {
    return this.#isolatedClaim
  }

  runningSegment(sessionId: string): RunningSegment | undefined {
    if (!validId(sessionId)) return undefined
    const segmentId = this.#running.get(sessionId)
    return segmentId === undefined ? undefined : this.#segments.get(segmentId)
  }

  /**
   * Predicate 1: does this session currently hold its single run slot?
   * Waiting for an answer NEVER contributes to this.
   */
  occupiesRunSlot(sessionId: string): boolean {
    return this.runningSegment(sessionId) !== undefined
  }

  /**
   * Predicate 2: does this session still have unsettled business work?
   * Used for busy / rebind / retirement locking. Independent of the run slot.
   */
  hasWorkInFlight(sessionId: string): boolean {
    if (!validId(sessionId)) return false
    if ((this.#openWork.get(sessionId)?.size ?? 0) > 0) return true
    if (this.outstandingInquiries(sessionId).length > 0) return true
    return this.pendingResults(sessionId).length > 0
  }

  /** Explains the two predicates separately so owners can act on the real reason. */
  busyForLocking(sessionId: string): BusyVerdict {
    const reasons: BusyReason[] = []
    if (this.occupiesRunSlot(sessionId)) reasons.push('running-segment')
    if ((this.#openWork.get(sessionId)?.size ?? 0) > 0) reasons.push('open-work')
    if (this.outstandingInquiries(sessionId).length > 0) reasons.push('awaiting-inquiry-answer')
    if (this.pendingResults(sessionId).length > 0) reasons.push('pending-inquiry-result')
    return { busy: reasons.length > 0, reasons }
  }

  /**
   * The single next Host-anchored segment this session may start. Deterministic:
   * strictly the lowest accepted sequence among its queued inquiries and pending
   * results. Returns undefined while the run slot is held — queued work waits, it
   * never merges into the running segment.
   */
  runnableNext(sessionId: string): RunnableNext | undefined {
    if (!validId(sessionId)) return undefined
    if (this.occupiesRunSlot(sessionId)) return undefined
    const inquiry = this.pendingInquiries(sessionId)[0]
    const result = this.pendingResults(sessionId)[0]
    if (inquiry && (!result || inquiry.seq <= result.seq)) {
      return { kind: 'inquiry', inquiryId: inquiry.inquiryId, seq: inquiry.seq }
    }
    if (result) return { kind: 'inquiry-result', inquiryId: result.inquiryId, seq: result.seq }
    return undefined
  }

  // ---------------------------------------------------------------- dispatch

  /**
   * Decide whether the runtime's claim may become this session's next segment.
   *
   * Ordering matters and is fail-closed:
   *  1. The claim must prove a single origin. A mixed claim is refused before any
   *     busy check, because the co-claim gap means a mixed claim is unusable for
   *     an inquiry even on a completely idle target.
   *  2. An inquiry then requires the proven runtime capability, checked before the
   *     queue and busy checks. Those would report a transient-sounding reason
   *     (`target-busy`, `out-of-order`) for a condition that no amount of waiting
   *     resolves, and the caller needs the actionable one.
   *
   * Non-inquiry origins are untouched by step 2: a delivery, a local turn and an
   * inquiry-result continuation claim no queued inquiry turn, so the seam that
   * protects pending GUI input is not involved in admitting them.
   */
  dispatch(sessionId: string, claim: readonly ClaimEntry[]): DispatchResult {
    if (!validId(sessionId)) return { dispatched: false, reason: 'invalid-claim' }
    const classification = classifyClaim(claim)
    if (classification.kind === 'empty') return { dispatched: false, reason: 'empty-claim' }
    if (classification.kind === 'invalid') return { dispatched: false, reason: 'invalid-claim' }
    if (classification.kind === 'mixed') {
      // Foreign traffic in the claim: refuse and keep any anchored item queued.
      const anchored = claim.find(entry => ANCHORED.includes(entry.origin) && validId(entry.ref))
      const inquiryId = anchored?.ref
      if (inquiryId !== undefined && this.#inquiries.has(inquiryId)) {
        return { dispatched: false, reason: 'mixed-claim', inquiryId, stillQueued: true }
      }
      return inquiryId === undefined
        ? { dispatched: false, reason: 'mixed-claim' }
        : { dispatched: false, reason: 'mixed-claim', inquiryId }
    }

    const { origin } = classification
    const ref = classification.ref

    if (ANCHORED.includes(origin)) {
      if (ref === undefined) return { dispatched: false, reason: 'unidentified-claim' }
      if (origin === 'inquiry' && !this.#isolatedClaim.available) {
        // Deterministic refusal with nothing consumed: no segment, no phase
        // change, no queue mutation. The inquiry remains exactly where it was,
        // so a rebuilt runtime can dispatch it later without re-accepting it.
        const pending = this.#inquiries.get(ref)
        return {
          dispatched: false,
          reason: 'isolated-claim-unsupported',
          inquiryId: ref,
          stillQueued: pending?.phase === 'queued',
        }
      }
      const row = this.#inquiries.get(ref)
      if (!row) return { dispatched: false, reason: 'not-queued', inquiryId: ref }
      if (origin === 'inquiry') {
        if (row.phase !== 'queued' || row.targetSessionId !== sessionId) {
          return { dispatched: false, reason: 'not-queued', inquiryId: ref, stillQueued: row.phase === 'queued' }
        }
      } else if (row.phase !== 'answered' || row.requesterSessionId !== sessionId) {
        return { dispatched: false, reason: 'not-queued', inquiryId: ref, stillQueued: row.phase === 'queued' }
      }
      if (this.occupiesRunSlot(sessionId)) {
        // Busy target: stay queued in accepted order; never steer the live segment.
        return { dispatched: false, reason: 'target-busy', inquiryId: ref, stillQueued: true }
      }
      const next = this.runnableNext(sessionId)
      if (!next || next.inquiryId !== ref) {
        return { dispatched: false, reason: 'out-of-order', inquiryId: ref, stillQueued: true }
      }
    } else if (this.occupiesRunSlot(sessionId)) {
      return { dispatched: false, reason: 'target-busy' }
    }

    const segment = this.#start(sessionId, origin, ref, claim)
    if (origin === 'inquiry' && ref !== undefined) {
      const row = this.#inquiries.get(ref)
      if (row) this.#inquiries.set(ref, { ...row, phase: 'executing' })
    }
    if (origin === 'inquiry-result' && ref !== undefined) {
      this.#results.delete(ref)
      const row = this.#inquiries.get(ref)
      if (row) this.#inquiries.set(ref, { ...row, phase: 'result-delivered' })
    }
    return { dispatched: true, segment }
  }

  #start(
    sessionId: string,
    origin: SegmentOrigin,
    ref: string | undefined,
    claim: readonly ClaimEntry[],
  ): RunningSegment {
    const seq = (this.#seq += 1)
    const base = {
      segmentId: `seg-${seq}`,
      sessionId,
      origin,
      claimedMessageIds: claim.map(entry => entry.messageId),
      startedAt: this.#clock.now(),
      // Recorded, not asserted: reaching here as an inquiry means the capability
      // gate above passed, so this segment's claim scope was the isolated one.
      ...(origin === 'inquiry' ? { isolatedQueuedTurnClaim: true as const } : {}),
    }
    const segment: RunningSegment = ref === undefined ? base : { ...base, ref }
    this.#segments.set(segment.segmentId, segment)
    this.#running.set(sessionId, segment.segmentId)
    return segment
  }

  /** End a segment and release the session's run slot. Idempotent. */
  completeSegment(segmentId: string): { completed: boolean; reason?: 'unknown-segment' } {
    if (!validId(segmentId)) return { completed: false, reason: 'unknown-segment' }
    const segment = this.#segments.get(segmentId)
    if (!segment) return { completed: false, reason: 'unknown-segment' }
    this.#segments.delete(segmentId)
    if (this.#running.get(segment.sessionId) === segmentId) this.#running.delete(segment.sessionId)
    return { completed: true }
  }

  // ---------------------------------------------------------------- answers

  /**
   * Record an answer for a dispatched inquiry. The result is ALWAYS queued as a
   * future continuation segment for the requester — busy or idle, it is never an
   * interrupt and never merges into a running segment.
   */
  deliverAnswer(answer: { readonly inquiryId: string }): AnswerResult {
    const id = answer?.inquiryId
    const reject = (reason: AnswerRejectReason, limit?: number): AnswerResult =>
      limit === undefined
        ? { accepted: false, inquiryId: validId(id) ? id : '', reason }
        : { accepted: false, inquiryId: validId(id) ? id : '', reason, limit }
    if (!answer || typeof answer !== 'object' || !validId(id)) return reject('invalid-input')
    const row = this.#inquiries.get(id)
    if (!row) return reject('unknown-inquiry')
    if (row.phase === 'queued') return reject('inquiry-not-dispatched')
    if (row.phase !== 'executing') return reject('duplicate-answer')

    const queued = this.pendingResults(row.requesterSessionId)
    if (queued.length >= this.#limits.maxQueuedResults) {
      return reject('queue-overflow', this.#limits.maxQueuedResults)
    }

    const seq = (this.#seq += 1)
    const base = {
      inquiryId: id,
      requesterSessionId: row.requesterSessionId,
      seq,
      answeredAt: this.#clock.now(),
    }
    this.#results.set(
      id,
      row.requesterWorkId === undefined ? base : { ...base, requesterWorkId: row.requesterWorkId },
    )
    this.#inquiries.set(id, { ...row, phase: 'answered' })
    return {
      accepted: true,
      inquiryId: id,
      queuedBecause: this.occupiesRunSlot(row.requesterSessionId) ? 'requester-busy' : 'requester-idle',
      queuePosition: queued.length,
    }
  }

  // ---------------------------------------------------------------- snapshot

  toState(): SchedulerState {
    return {
      seq: this.#seq,
      inquiries: [...this.#inquiries.values()].sort((a, b) => a.seq - b.seq),
      results: [...this.#results.values()].sort((a, b) => a.seq - b.seq),
      segments: [...this.#segments.values()].sort((a, b) => a.startedAt - b.startedAt),
      openWork: [...this.#openWork].flatMap(([sessionId, set]) =>
        [...set].map(workId => ({ sessionId, workId })),
      ),
    }
  }
}
