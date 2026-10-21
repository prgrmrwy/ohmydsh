/**
 * Startup recovery executor for the new inquiry handoff protocol (design D6).
 *
 * The read-only planner (`planInquiryRecovery`) decides WHAT each durable row needs; this module
 * only decides WHO to trigger. It never enqueues a message itself: `pumpTarget` / `pumpResults`
 * already re-check readiness, identity, generation and inbox de-duplication, and cold-resume the
 * member, so the actual enqueue safety stays with them.
 *
 * Fail closed:
 *  - only `enqueue-existing-message` triggers anything, once per session+phase;
 *  - `await-same-message` / `already-claimed` / `done` do nothing (the message is already in an
 *    inbox, claimed, or delivered);
 *  - every other kind (needs-review, retain-disposition, legacy-disposition-required, unavailable,
 *    read-failed, or any unknown kind) is only counted and logged — nothing durable is written;
 *  - every port call is isolated; this function never throws.
 * Logs carry stable codes only: never an inquiry id, session id, message id or content.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import { parseInquiry, type InquiryScope } from './ledger.js'
import { planInquiryRecovery, type InquiryRecoveryInput, type RecoveryAction, type SessionEvidence } from './recovery.js'

export type InquiryStartupRecoveryDiagnostic =
  | 'inquiry-recovery-review'
  | 'inquiry-recovery-plan-failed'
  | 'inquiry-recovery-pump-failed'

export interface InquiryStartupRecoveryPorts {
  /** Read-only plan over every member that has pending protocol rows. */
  plan(): Promise<readonly RecoveryAction[]>
  pumpTarget(sessionId: string): Promise<void>
  pumpResults(sessionId: string): Promise<void>
  log(code: InquiryStartupRecoveryDiagnostic): void
}

export interface InquiryStartupRecoveryReport {
  readonly dispatchedTarget: number
  readonly dispatchedResult: number
  /** Already pending in an inbox, already claimed, or already delivered: nothing to do. */
  readonly awaiting: number
  /** Not provable: reported only, never dispatched, nothing written. */
  readonly review: number
  readonly failed: number
}

export async function runInquiryStartupRecovery(
  ports: InquiryStartupRecoveryPorts,
): Promise<InquiryStartupRecoveryReport> {
  const counts = { dispatchedTarget: 0, dispatchedResult: 0, awaiting: 0, review: 0, failed: 0 }
  const log = (code: InquiryStartupRecoveryDiagnostic): void => {
    try { ports.log(code) } catch { /* a throwing logger must not change recovery */ }
  }
  const finish = (): InquiryStartupRecoveryReport => Object.freeze({ ...counts })

  let actions: readonly RecoveryAction[]
  try {
    actions = await ports.plan()
  } catch {
    counts.failed += 1
    log('inquiry-recovery-plan-failed')
    return finish()
  }
  if (!Array.isArray(actions)) {
    counts.failed += 1
    log('inquiry-recovery-plan-failed')
    return finish()
  }

  const triggered = new Set<string>()
  for (const action of actions) {
    const kind = (action as { kind?: unknown } | null)?.kind
    if (kind === 'await-same-message' || kind === 'already-claimed' || kind === 'done') {
      counts.awaiting += 1
      continue
    }
    if (kind === 'enqueue-existing-message') {
      const phase = action.phase
      const sessionId = action.scope?.sessionId
      if ((phase !== 'target' && phase !== 'result') || typeof sessionId !== 'string' || sessionId.length === 0) {
        counts.review += 1
        log('inquiry-recovery-review')
        continue
      }
      const key = JSON.stringify([sessionId, phase])
      if (triggered.has(key)) continue
      triggered.add(key)
      try {
        if (phase === 'target') await ports.pumpTarget(sessionId)
        else await ports.pumpResults(sessionId)
        if (phase === 'target') counts.dispatchedTarget += 1
        else counts.dispatchedResult += 1
      } catch {
        counts.failed += 1
        log('inquiry-recovery-pump-failed')
      }
      continue
    }
    // needs-review, retain-disposition, legacy-disposition-required, unavailable, read-failed,
    // and any kind this executor does not know: diagnostic only.
    counts.review += 1
    log('inquiry-recovery-review')
  }
  return finish()
}

// ---------------------------------------------------------------------------
// Production adapters. Each one answers "unknown" whenever it cannot PROVE the stronger claim.
// ---------------------------------------------------------------------------
export interface SessionEvidenceDeps {
  /** The live in-memory agent for a session, if any. */
  getLive(sessionId: string): { readonly inbox: { readonly nextTurn: readonly { readonly id: string }[]; readonly nextStep: readonly { readonly id: string }[] } } | undefined
  /** The complete durable event log of a session (cold read), or undefined when unavailable. */
  readEvents(sessionId: string): Promise<readonly unknown[] | undefined>
}

/**
 * Evidence about one handoff message in one session.
 *  - live inbox holds it                          -> pending
 *  - durable log readable and NEVER mentions it   -> absent (it was never spliced into an inbox)
 *  - anything else (log mentions it, unreadable,
 *    unavailable, agent not live and no log read) -> unknown, which the planner turns into needs-review
 * `claimed` is never reported: a restart cannot prove that a turn is still active.
 */
export function createInquirySessionEvidence(
  deps: SessionEvidenceDeps,
): (sessionId: string, messageId: string) => Promise<SessionEvidence> {
  return async (sessionId, messageId) => {
    try {
      const live = deps.getLive(sessionId)
      if (live !== undefined && [...live.inbox.nextTurn, ...live.inbox.nextStep].some(message => message.id === messageId)) {
        return { kind: 'pending' }
      }
      const events = await deps.readEvents(sessionId)
      if (!Array.isArray(events)) return { kind: 'unknown' }
      // Conservative substring match over each event: a false positive only yields "unknown".
      for (const event of events) if (JSON.stringify(event)?.includes(messageId)) return { kind: 'unknown' }
      return { kind: 'absent' }
    } catch {
      return { kind: 'unknown' }
    }
  }
}

/** Local work row present, unsettled and of the same generation -> valid; settled -> terminal; else unknown. */
export function createInquiryWorkEvidence(
  getWork: (sessionId: string, workId: string) => { readonly state: string; readonly scopeGeneration: number } | undefined,
): InquiryRecoveryInput['workEvidence'] {
  return (work, inquiry) => {
    try {
      if (work.kind !== 'local') return 'unknown'
      const row = getWork(work.sessionId, work.workId)
      if (row === undefined) return 'unknown'
      if (row.state === 'settled') return 'terminal'
      const generation = inquiry.requester.kind === 'child' ? inquiry.requester.generation : 0
      return row.scopeGeneration === generation ? 'valid' : 'unknown'
    } catch {
      return 'unknown'
    }
  }
}

type PlanDomain = Domain<typeof petDomainSpec>

/**
 * Run the single-member planner once per member that owns pending rows, and keep from each call
 * only the actions the member OWNS (target phase: the target; result phase: the requester). Other
 * members' calls would otherwise report their rows as scope-inconsistent noise.
 * A member whose current scope cannot be resolved is skipped and surfaced as one review action.
 */
export async function planInquiryRecoveryForMembers(
  input: Omit<InquiryRecoveryInput, 'currentScope'> & { readonly currentScope: (sessionId: string) => InquiryScope | undefined },
): Promise<readonly RecoveryAction[]> {
  const domain = input.domain as PlanDomain
  const owners = new Map<string, { target: string; requester: string }>()
  const sessions = new Set<string>()
  try {
    for (const [key, value] of domain.table('inquiries').entries()) {
      const row = parseInquiry(value)
      if (row.id !== key) throw new Error('key-mismatch')
      owners.set(row.id, { target: row.target.sessionId, requester: row.requester.sessionId })
      if (row.status === 'queued' || row.status === 'executing') sessions.add(row.target.sessionId)
      if (row.status !== 'result-delivered' && row.status !== 'expired') sessions.add(row.requester.sessionId)
    }
  } catch {
    // Unreadable ledger: the planner itself reports read-failed whatever the scope is.
    return planInquiryRecovery({ ...input, currentScope: { kind: 'main', sessionId: 'unreadable' } })
  }
  const out: RecoveryAction[] = []
  const seen = new Set<string>()
  const push = (action: RecoveryAction): void => {
    const key = JSON.stringify([action.kind, action.inquiryId, action.phase, action.messageId ?? null, action.reason])
    if (!seen.has(key)) { seen.add(key); out.push(action) }
  }
  for (const sessionId of [...sessions].sort()) {
    const scope = input.currentScope(sessionId)
    if (scope === undefined) {
      push({ kind: 'needs-review', inquiryId: '', phase: 'legacy', reason: 'member-scope-unresolved' })
      continue
    }
    for (const action of await planInquiryRecovery({ ...input, currentScope: scope })) {
      const owner = owners.get(action.inquiryId)
      if (owner === undefined || (action.phase === 'result' ? owner.requester : owner.target) === sessionId) push(action)
    }
  }
  return Object.freeze(out)
}
