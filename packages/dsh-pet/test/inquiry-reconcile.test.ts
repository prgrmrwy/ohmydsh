/**
 * Startup reconciliation for inquiries (design D8).
 *
 * The two durable stores already CLASSIFY unsettled work — `restartDisposition()`
 * on both — but nobody acts on that classification, so a restart currently leaves
 * an expired inquiry queued forever and a dispatched-but-unknown one indefinitely
 * non-terminal. This suite pins the one pass that closes those two holes, and —
 * just as importantly — pins everything it must NOT do.
 *
 * Every store here is an in-memory row map whose every decision is delegated to
 * the REAL pure models (`ledger.ts`, `outbox.ts`), so an invariant that only
 * holds against a hand-written fake cannot pass. The atomic-Domain-backed stores
 * are exercised by their own opt-in suites; what is under test here is the
 * reconciliation policy, which is pure given those two interfaces.
 */
import { describe, expect, it } from 'vitest'
import { composeCollaborationSurface } from '../src/host/collaboration/assembly.js'
import {
  reconcileInquiriesAtStartup,
  summarizeInquiryReconciliation,
  type InquiryReconcilePorts,
} from '../src/host/inquiry/reconcile.js'
import {
  applyInquiryEvent,
  createInquiry,
  isTerminalInquiryStatus,
  INQUIRY_LIMITS as limits,
  type InquiryRecord,
} from '../src/host/inquiry/ledger.js'
import {
  createInquiryResult,
  parseInquiryOutboxRecord,
  type InquiryOutboxRecord,
} from '../src/host/inquiry/outbox.js'

const circle = 'session-main'
const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const t0 = 1_800_000_000_000
const deadline = t0 + limits.absoluteDeadlineMs
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const chat = { kind: 'feishu-chat', chatId: 'oc-example' } as const

/** One accepted, queued inquiry built by the real pure model. */
function queued(over: Record<string, unknown> = {}): InquiryRecord {
  return createInquiry(
    {
      target: childB,
      question: 'Which response shape did you settle on for the status endpoint?',
      purpose: 'Answer a Feishu request about the API contract',
      declaredOrigin: delivery,
    },
    {
      inquiryId: 'inquiry-1',
      requester: childA,
      circleParentSessionId: circle,
      origin: delivery,
      audience: chat,
      createdAt: t0,
      parent: null,
      rootInquiryCount: 0,
      pendingCount: 0,
      ...over,
    },
  )
}

const event = (type: string, at: number, reason: string | null) =>
  ({ type, eventId: `seed-${type}`, at, reason })

/** A dispatched inquiry: the Host handed the work over and it is now executing. */
function executing(): InquiryRecord {
  return applyInquiryEvent(queued(), event('dispatch', t0 + 1_000, null))
}

/** A dispatched inquiry that also produced an accepted answer in the ledger. */
function answered(): InquiryRecord {
  return applyInquiryEvent(executing(), event('answer', t0 + 2_000, null))
}

// ---------------------------------------------------------------------------
// In-memory stores. Every transition is the real pure model's.
// ---------------------------------------------------------------------------

class StoreError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'StoreError'
  }
}

function memoryLedger(initial: readonly InquiryRecord[] = []) {
  const rows = new Map<string, InquiryRecord>(initial.map(record => [record.id, record]))
  const state = { unreadable: undefined as string | undefined, writeFails: undefined as string | undefined }
  return {
    rows,
    state,
    snapshot: () => JSON.stringify([...rows.entries()].sort()),
    restartDisposition() {
      // A corrupt row makes the WHOLE classification unprovable: the real store
      // validates on the way out and throws before returning anything.
      if (state.unreadable !== undefined) throw new StoreError(state.unreadable)
      const recoverable: InquiryRecord[] = []
      const needsReview: InquiryRecord[] = []
      for (const record of [...rows.values()].sort((a, b) => a.createdAt - b.createdAt)) {
        if (record.status === 'queued') recoverable.push(record)
        else if (!isTerminalInquiryStatus(record.status)) needsReview.push(record)
      }
      return { recoverable, needsReview }
    },
    get: (inquiryId: string) => rows.get(inquiryId),
    async applyEvent(inquiryId: string, applied: unknown): Promise<InquiryRecord> {
      if (state.writeFails !== undefined) throw new StoreError(state.writeFails)
      const current = rows.get(inquiryId)
      if (current === undefined) throw new StoreError('INQUIRY_NOT_FOUND')
      const next = applyInquiryEvent(current, applied)
      rows.set(inquiryId, next)
      return next
    },
  }
}

function memoryOutbox(initial: readonly InquiryOutboxRecord[] = []) {
  const rows = new Map<string, InquiryOutboxRecord>(initial.map(record => [record.dedupKey, record]))
  const state = { unreadable: undefined as string | undefined, writeFails: undefined as string | undefined }
  return {
    rows,
    state,
    snapshot: () => JSON.stringify([...rows.entries()].sort()),
    restartDisposition() {
      if (state.unreadable !== undefined) throw new StoreError(state.unreadable)
      const recoverable: InquiryOutboxRecord[] = []
      const needsReview: InquiryOutboxRecord[] = []
      for (const record of [...rows.values()].sort((a, b) => a.createdAt - b.createdAt)) {
        if (record.status !== 'pending') continue
        if (record.diagnostics.some(entry => entry.code === 'delivery-outcome-unknown')) needsReview.push(record)
        else recoverable.push(record)
      }
      return { recoverable, needsReview }
    },
    findByInquiry(inquiryId: string): InquiryOutboxRecord | undefined {
      const matches = [...rows.values()].filter(record => record.inquiryId === inquiryId)
      if (matches.length > 1) throw new StoreError('RESULT_CORRUPT')
      return matches[0]
    },
    async queue(facts: unknown): Promise<InquiryOutboxRecord> {
      if (state.writeFails !== undefined) throw new StoreError(state.writeFails)
      const candidate = createInquiryResult(facts)
      const existing = rows.get(candidate.dedupKey)
      if (existing !== undefined) {
        // The real store compares the fixed identity and refuses a different
        // result under the same key; an equal redelivery is a silent no-op.
        if (JSON.stringify(existing) !== JSON.stringify(candidate)) throw new StoreError('RESULT_EXISTS')
        return existing
      }
      if (this.findByInquiry(candidate.inquiryId) !== undefined) throw new StoreError('RESULT_EXISTS')
      rows.set(candidate.dedupKey, parseInquiryOutboxRecord(candidate))
      return candidate
    },
  }
}

// ---------------------------------------------------------------------------
// Tripwires. Reconciliation is DIAGNOSTICS ONLY: it may read and settle durable
// rows and nothing else. Anything that could wake a model, start a turn, hand a
// message to the runtime or reach Feishu is wired to throw on mere ACCESS.
// ---------------------------------------------------------------------------

const LEDGER_ALLOWED = new Set(['restartDisposition', 'applyEvent', 'get'])
const OUTBOX_ALLOWED = new Set(['restartDisposition', 'findByInquiry', 'queue'])

/** Any property outside the read/settle surface is a design violation, not a miss. */
function fenced<T extends object>(store: T, allowed: ReadonlySet<string>, label: string): T {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !allowed.has(property)) {
        throw new Error(`reconciliation touched ${label}.${property}`)
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

/** Seams reconciliation must never so much as look for. */
const FORBIDDEN = [
  'scheduler', 'agent', 'agentLoop', 'inbox', 'dispatch', 'send', 'notify',
  'wake', 'lark', 'feishu', 'delivery', 'deliver', 'reply', 'turn', 'answers',
] as const

function ports(
  ledger: ReturnType<typeof memoryLedger>,
  outbox: ReturnType<typeof memoryOutbox>,
  now: number,
  log?: (code: string) => void,
): InquiryReconcilePorts {
  const touched: string[] = []
  const base: Record<string, unknown> = {
    ledger: fenced(ledger, LEDGER_ALLOWED, 'ledger'),
    outbox: fenced(outbox, OUTBOX_ALLOWED, 'outbox'),
    now: () => now,
    ...(log === undefined ? {} : { log }),
  }
  for (const name of FORBIDDEN) {
    Object.defineProperty(base, name, {
      enumerable: true,
      get() {
        touched.push(name)
        throw new Error(`reconciliation reached for an outbound seam: ${name}`)
      },
    })
  }
  Object.defineProperty(base, '__touched', { enumerable: false, value: touched })
  return base as unknown as InquiryReconcilePorts
}

const touchedOf = (value: InquiryReconcilePorts): readonly string[] =>
  (value as unknown as { __touched: readonly string[] }).__touched

describe('inquiry startup reconciliation classifies durable state and settles nothing else', () => {
  it('leaves a queued inquiry within its deadline untouched and still dispatchable', async () => {
    const ledger = memoryLedger([queued()])
    const outbox = memoryOutbox()
    const before = ledger.snapshot()

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 1_000))

    expect(report.ok).toBe(true)
    expect(report.applied).toBe(0)
    expect(report.inquiries).toMatchObject({ recoverable: 1, expired: 0, needsReview: 0 })
    expect(report.results).toMatchObject({ pending: 0, created: 0 })
    expect(ledger.snapshot()).toBe(before)
    expect(outbox.rows.size).toBe(0)

    // "Recoverable" has to MEAN dispatchable: the row still accepts a dispatch.
    const dispatched = await ledger.applyEvent('inquiry-1', event('dispatch', t0 + 2_000, null))
    expect(dispatched.status).toBe('executing')
  })

  it('marks a dispatched inquiry needs-review, never retries it, and gives the requester a failure result', async () => {
    const ledger = memoryLedger([executing()])
    const outbox = memoryOutbox()
    const p = ports(ledger, outbox, t0 + 3_000)

    const report = await reconcileInquiriesAtStartup(p)

    expect(report.ok).toBe(true)
    expect(report.inquiries).toMatchObject({ recoverable: 0, expired: 0, needsReview: 1, correlated: 0 })
    // `needs-review` is terminal and has NO edge back to queued, so this row can
    // never be picked up and run a second time.
    const row = ledger.rows.get('inquiry-1')!
    expect(row.status).toBe('needs-review')
    expect(isTerminalInquiryStatus(row.status)).toBe(true)
    expect(row.reason).toBe('restart-dispatch-outcome-unknown')
    // The requester is not stranded: a correlatable failure result exists.
    const result = outbox.findByInquiry('inquiry-1')!
    expect(result.status).toBe('pending')
    expect(result.result).toEqual({
      kind: 'failure', failure: 'needs-review',
      reason: 'restart-dispatch-outcome-unknown', failedAt: row.statusAt,
    })
    expect(result.resumeWork).toEqual(delivery)
    expect(result.requester).toEqual(childA)
    // The event id is derived from the ROW, not from the restart clock or a
    // counter. That is what makes a redelivery a no-op in the pure model even
    // if a future pass re-examines an already-settled row, so it is asserted
    // rather than left as an implementation detail.
    expect(row.appliedEventIds).toEqual(['seed-dispatch', 'restart:inquiry-1:needs-review'])
    expect(touchedOf(p)).toEqual([])
  })

  it('settles an inquiry already past its deadline as expired without moving the deadline', async () => {
    const ledger = memoryLedger([queued()])
    const outbox = memoryOutbox()

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, deadline + 60_000))

    expect(report.ok).toBe(true)
    expect(report.inquiries).toMatchObject({ recoverable: 0, expired: 1, needsReview: 0 })
    expect(report.results.created).toBe(1)
    const row = ledger.rows.get('inquiry-1')!
    expect(row.status).toBe('expired')
    expect(row.reason).toBe('restart-deadline-passed')
    // A restart must never extend, reset or re-stamp an absolute deadline, and
    // the settlement is dated at the deadline itself rather than at restart.
    expect(row.createdAt).toBe(t0)
    expect(row.deadlineAt).toBe(deadline)
    expect(row.statusAt).toBe(deadline)

    const result = outbox.findByInquiry('inquiry-1')!
    expect(result.result).toEqual({
      kind: 'failure', failure: 'expired', reason: 'restart-deadline-passed', failedAt: deadline,
    })
    expect(result.createdAt).toBe(deadline)
    expect(result.status).toBe('pending')
    expect(row.appliedEventIds).toEqual(['restart:inquiry-1:expired'])
  })

  it('derives its settlement events from the row, so a replay cannot double-advance', async () => {
    // Belt and braces for the idempotence claim. A settled row leaves
    // `restartDisposition` entirely, so a repeat pass never sees it again — but
    // if a future change ever DOES re-present one, the pure model must still
    // refuse to advance it. That only holds while the event id stays derived
    // from the row rather than from the clock or a counter.
    const ledger = memoryLedger([executing()])
    const outbox = memoryOutbox()
    await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 3_000))
    const settled = ledger.rows.get('inquiry-1')!

    // Replay the exact event this pass emitted, as a redelivery would.
    const replayed = applyInquiryEvent(settled, {
      type: 'needs-review',
      eventId: 'restart:inquiry-1:needs-review',
      at: t0 + 9_999,
      reason: 'restart-dispatch-outcome-unknown',
    })
    expect(replayed).toEqual(settled)
    expect(replayed.statusAt).toBe(settled.statusAt)
    expect(replayed.appliedEventIds).toEqual(settled.appliedEventIds)

    // And the same for a result: one inquiry yields exactly one result row.
    await expect(outbox.queue({
      inquiryId: 'inquiry-1',
      requester: childA,
      resumeWork: delivery,
      result: {
        kind: 'failure', failure: 'needs-review',
        reason: 'restart-dispatch-outcome-unknown', failedAt: settled.statusAt,
      },
      createdAt: settled.statusAt,
    })).resolves.toMatchObject({ status: 'pending' })
    expect(outbox.rows.size).toBe(1)
  })

  it('leaves a pending result pending and never redelivers it', async () => {
    const row = answered()
    const ledger = memoryLedger([row])
    const outbox = memoryOutbox([
      createInquiryResult({
        inquiryId: row.id,
        requester: row.requester,
        resumeWork: row.origin,
        result: { kind: 'answer', answeredAt: t0 + 2_000 },
        createdAt: t0 + 2_000,
      }),
    ])
    const before = { ledger: ledger.snapshot(), outbox: outbox.snapshot() }

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 3_000))

    expect(report.ok).toBe(true)
    expect(report.applied).toBe(0)
    // The outcome IS correlated at the ledger→outbox boundary, so the ledger row
    // is not unknown and must not be converted into a terminal needs-review that
    // would invalidate a perfectly good pending answer.
    expect(report.inquiries).toMatchObject({ needsReview: 0, correlated: 1 })
    expect(report.results).toMatchObject({ pending: 1, needsReview: 0, created: 0 })
    expect(ledger.snapshot()).toBe(before.ledger)
    expect(outbox.snapshot()).toBe(before.outbox)
    expect(outbox.findByInquiry(row.id)!.status).toBe('pending')
    expect(outbox.findByInquiry(row.id)!.deliveredSegmentId).toBeNull()
  })

  it('reports a result whose delivery outcome is unknown and never re-delivers it either', async () => {
    const row = answered()
    const pending = createInquiryResult({
      inquiryId: row.id,
      requester: row.requester,
      resumeWork: row.origin,
      result: { kind: 'answer', answeredAt: t0 + 2_000 },
      createdAt: t0 + 2_000,
    })
    const unknown = parseInquiryOutboxRecord({
      ...pending,
      diagnostics: [{ code: 'delivery-outcome-unknown', at: t0 + 2_500, eventId: 'crash-window' }],
    })
    const ledger = memoryLedger([row])
    const outbox = memoryOutbox([unknown])
    const before = outbox.snapshot()

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 3_000))

    expect(report.ok).toBe(true)
    expect(report.applied).toBe(0)
    expect(report.results).toMatchObject({ pending: 0, needsReview: 1, created: 0 })
    expect(outbox.snapshot()).toBe(before)
  })

  it('is idempotent: a second pass applies nothing and leaves byte-identical durable state', async () => {
    // One of each disposition, so the repeat run has to be a no-op for all of
    // them rather than for the easy one.
    const ledger = memoryLedger([
      // Past its deadline at restart → expired.
      queued(),
      // Accepted 10s later, so still inside its own absolute deadline → survives.
      queued({ inquiryId: 'inquiry-2', createdAt: t0 + 10_000 }),
      // Dispatched, no durable result → needs-review.
      applyInquiryEvent(
        queued({ inquiryId: 'inquiry-3', createdAt: t0 + 20_000 }),
        event('dispatch', t0 + 21_000, null),
      ),
    ])
    const outbox = memoryOutbox()
    const at = deadline + 1

    const first = await reconcileInquiriesAtStartup(ports(ledger, outbox, at))
    expect(first.ok).toBe(true)
    expect(first.inquiries).toMatchObject({ recoverable: 1, expired: 1, needsReview: 1 })
    // Two settlements, each one result plus one ledger event.
    expect(first.applied).toBe(4)
    expect(ledger.rows.get('inquiry-1')!.status).toBe('expired')
    expect(ledger.rows.get('inquiry-2')!.status).toBe('queued')
    expect(ledger.rows.get('inquiry-3')!.status).toBe('needs-review')
    const state = { ledger: ledger.snapshot(), outbox: outbox.snapshot() }

    const second = await reconcileInquiriesAtStartup(ports(ledger, outbox, at))

    expect(second.ok).toBe(true)
    // No double-apply, no double-expire, no second result for one inquiry.
    expect(second.applied).toBe(0)
    expect(second.results.created).toBe(0)
    expect(second.inquiries).toMatchObject({ recoverable: 1, expired: 0, needsReview: 0 })
    expect(ledger.snapshot()).toBe(state.ledger)
    expect(outbox.snapshot()).toBe(state.outbox)
    expect(outbox.rows.size).toBe(2)

    // A third pass at a much LATER clock settles the survivor — whose own
    // absolute deadline has genuinely passed by then — and re-stamps neither of
    // the rows already settled, because their settlement instants come from the
    // rows rather than from whatever clock the restart happened to see.
    const third = await reconcileInquiriesAtStartup(ports(ledger, outbox, at + 600_000))
    expect(third.inquiries).toMatchObject({ recoverable: 0, expired: 1, needsReview: 0 })
    expect(ledger.rows.get('inquiry-1')).toEqual(JSON.parse(state.ledger)
      .find(([key]: [string]) => key === 'inquiry-1')[1])
    expect(ledger.rows.get('inquiry-1')!.statusAt).toBe(deadline)
    expect(ledger.rows.get('inquiry-3')!.statusAt).toBe(at)
    // The survivor expires at ITS OWN stored deadline, not at this clock.
    expect(ledger.rows.get('inquiry-2')!.statusAt).toBe(t0 + 10_000 + limits.absoluteDeadlineMs)
  })

  it('resumes a pass that crashed between queueing the result and settling the ledger', async () => {
    // Queue-then-settle is the crash-safe order: the surviving evidence is a
    // result with a still-unsettled ledger row, which the next pass completes.
    const ledger = memoryLedger([executing()])
    const outbox = memoryOutbox()
    outbox.state.writeFails = undefined
    const first = await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 3_000))
    expect(first.ok).toBe(true)

    // Rewind ONLY the ledger, exactly as a crash after the outbox commit would.
    ledger.rows.set('inquiry-1', executing())

    const second = await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 4_000))

    expect(second.ok).toBe(true)
    expect(ledger.rows.get('inquiry-1')!.status).toBe('needs-review')
    expect(outbox.rows.size).toBe(1)
  })

  it('reports a corrupt ledger row and refuses to guess, deleting or rewriting nothing', async () => {
    const ledger = memoryLedger([queued()])
    const outbox = memoryOutbox()
    ledger.state.unreadable = 'INQUIRY_CORRUPT'
    const before = ledger.snapshot()
    const codes: string[] = []

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, deadline + 1, code => codes.push(code)))

    expect(report.ok).toBe(false)
    expect(report.faults).toEqual([{ stage: 'ledger-unreadable', code: 'INQUIRY_CORRUPT' }])
    expect(report.applied).toBe(0)
    expect(report.inquiries).toEqual({ recoverable: 0, expired: 0, needsReview: 0, correlated: 0, inconsistent: 0 })
    expect(codes).toContain('ledger-unreadable')
    // Never delete or rewrite a row to make reconciliation succeed.
    expect(ledger.rows.size).toBe(1)
    expect(ledger.snapshot()).toBe(before)
  })

  it('reports an unreadable result outbox and settles no inquiry on a half-provable picture', async () => {
    const ledger = memoryLedger([queued()])
    const outbox = memoryOutbox()
    outbox.state.unreadable = 'RESULT_CORRUPT'
    const before = ledger.snapshot()

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, deadline + 1))

    expect(report.ok).toBe(false)
    expect(report.faults).toEqual([{ stage: 'outbox-unreadable', code: 'RESULT_CORRUPT' }])
    expect(report.applied).toBe(0)
    expect(ledger.snapshot()).toBe(before)
  })

  it('fails closed on a refused durable write and does not settle the ledger anyway', async () => {
    const ledger = memoryLedger([queued()])
    const outbox = memoryOutbox()
    outbox.state.writeFails = 'TRANSACTION_UNAVAILABLE'
    const before = ledger.snapshot()

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, deadline + 1))

    expect(report.ok).toBe(false)
    expect(report.faults).toEqual([{ stage: 'outbox-write-failed', code: 'TRANSACTION_UNAVAILABLE' }])
    // The ledger row is NOT expired: a settled inquiry with no result would
    // strand the requester with nothing to correlate.
    expect(ledger.snapshot()).toBe(before)
    expect(ledger.rows.get('inquiry-1')!.status).toBe('queued')
  })

  it('refuses the pass when a required store is missing rather than reconciling half of it', async () => {
    const ledger = memoryLedger([queued()])
    const report = await reconcileInquiriesAtStartup({
      ledger,
      outbox: undefined as never,
      now: () => deadline + 1,
    })

    expect(report.ok).toBe(false)
    expect(report.faults.map(fault => fault.stage)).toContain('outbox-unreadable')
    expect(ledger.rows.get('inquiry-1')!.status).toBe('queued')
  })

  it('is reachable from the composed assembly, wired to the SAME durable stores', async () => {
    // The call-site matters as much as the module: a reconciler wired to a
    // different ledger than the tools use would report a clean restart while
    // the real rows stay stuck. This proves the assembly hands through both.
    const ledger = memoryLedger([executing()])
    const outbox = memoryOutbox()
    const assembly = composeCollaborationSurface({
      atomicStorage: true,
      loci: {
        findByChildSessionId: () => [],
        getLocusByChild: () => undefined,
        listLociByParent: () => [],
        getCurrentLocus: () => undefined,
      },
      identity: { inspect: async () => undefined, isArchived: () => false },
      contextStore: { get: () => undefined, has: () => false, update: () => Promise.reject(new Error('unused')) },
      ledger: { ...ledger, accept: () => Promise.reject(new Error('unused')), recordDiagnostic: () => Promise.reject(new Error('unused')) },
      resultOutbox: outbox,
      describe: () => undefined,
      origin: () => undefined,
      now: () => t0 + 3_000,
      installed: new WeakSet<object>(),
    })
    expect(assembly).toBeDefined()

    const report = await assembly!.reconcileInquiries()

    expect(report.ok).toBe(true)
    expect(report.inquiries.needsReview).toBe(1)
    expect(ledger.rows.get('inquiry-1')!.status).toBe('needs-review')
    expect(outbox.findByInquiry('inquiry-1')!.result).toMatchObject({ failure: 'needs-review' })

    // Composition still succeeds without an outbox — the surface must not go
    // dark over reconciliation — but the pass then REPORTS instead of guessing.
    const noOutbox = composeCollaborationSurface({
      atomicStorage: true,
      loci: {
        findByChildSessionId: () => [],
        getLocusByChild: () => undefined,
        listLociByParent: () => [],
        getCurrentLocus: () => undefined,
      },
      identity: { inspect: async () => undefined, isArchived: () => false },
      contextStore: { get: () => undefined, has: () => false, update: () => Promise.reject(new Error('unused')) },
      ledger: { ...memoryLedger([executing()]), accept: () => Promise.reject(new Error('unused')), recordDiagnostic: () => Promise.reject(new Error('unused')) },
      describe: () => undefined,
      origin: () => undefined,
      installed: new WeakSet<object>(),
    })
    expect(noOutbox).toBeDefined()
    const faulted = await noOutbox!.reconcileInquiries()
    expect(faulted.ok).toBe(false)
    expect(faulted.applied).toBe(0)
  })

  it('summarizes counts only, with no question, purpose, answer or chat identifier', async () => {
    const ledger = memoryLedger([queued(), executing()])
    const outbox = memoryOutbox()

    const report = await reconcileInquiriesAtStartup(ports(ledger, outbox, t0 + 3_000))
    const line = summarizeInquiryReconciliation(report)

    expect(line).toContain('inquiry-reconcile')
    expect(line).toContain('needs-review=1')
    for (const secret of [
      'Which response shape', 'Answer a Feishu request', 'oc-example',
      'delivery-1', 'session-a', 'session-b', 'inquiry-1', 'locus-a',
    ]) expect(line).not.toContain(secret)
    // A single line is what an operator log can actually carry.
    expect(line.split('\n')).toHaveLength(1)
  })
})
