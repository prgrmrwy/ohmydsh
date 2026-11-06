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

import type { LocusRowV20 } from './contract-v20.js'
import {
  MAX_DELIVERY_LEASE_MS,
  abandonInterruptedDelivery,
  expireDelivery,
  type DeliveryRecord,
} from './delivery.js'
import type { PetLocusOperation } from '../spec.js'
import type { LocusStartupDeliveryProof } from './startup-recovery.js'

/** What the runtime could prove about one locus child. */
export type ChildLiveness =
  /** The child exists and can take another turn. */
  | { readonly kind: 'usable' }
  /** The child is definitively gone or unusable, with a stable reason. */
  | { readonly kind: 'unusable'; readonly reason: string }
  /** The runtime could not answer; this is not evidence of absence. */
  | { readonly kind: 'unknown'; readonly diagnostic: string }
  /**
   * The runtime is at its activation limit, so the child could not be resumed.
   * Says nothing about the child: it is neither invalidated nor replaced, and
   * the row keeps its sessionId until capacity frees. Treated exactly like
   * `unknown`; named separately so a reader can see capacity is a retry, not a
   * repair.
   */
  | { readonly kind: 'capacity-limited'; readonly diagnostic: string }

/** Probes the live runtime for one locus child. */
export interface ChildLivenessProbe {
  check(input: {
    /** The M the row's group row names (a topic row has none of its own). */
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly signal: AbortSignal
  }): Promise<ChildLiveness>
}

/** A v20 row together with the M its group row names. */
export interface ReconcileRow {
  readonly row: LocusRowV20
  readonly locusMainSessionId: string
}

/** Durable writes child reconciliation may perform. */
export interface ReconcileStore {
  /** Mark a row invalid (CAS on the fence) with an owner-readable reason. */
  invalidate(fence: { readonly expectedLocusId: string; readonly expectedRevision: number }, reason: string, now: number): Promise<void>
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
  | 'child-capacity-limited'

/** Outcome of one child reconciliation pass. */
export interface ReconcileReport {
  readonly checked: number
  readonly usable: number
  /** Rows marked invalid, with the reason recorded on each. */
  readonly invalidated: readonly { readonly locusId: string; readonly reason: string }[]
  /** Rows the runtime could not answer for; left untouched. */
  readonly unproven: readonly string[]
}

/**
 * Reconcile durable v20 rows against the live runtime (design D7 class A).
 * @param rows - the rows to check, each with its group row's M.
 * @param ports - the runtime probe plus the invalidate write.
 * @param signal - abort for the whole pass.
 * @returns what was checked and what changed.
 */
export async function reconcileLocusChildren(
  rows: readonly ReconcileRow[],
  ports: ReconcilePorts,
  signal: AbortSignal = new AbortController().signal,
): Promise<ReconcileReport> {
  const now = ports.now ?? Date.now
  const invalidated: { locusId: string; reason: string }[] = []
  const unproven: string[] = []
  let usable = 0

  // `not-created` rows have no child to probe; only `active` rows do.
  const candidates = rows.filter(item => item.row.state === 'active')
  if (ports.probe === undefined) {
    if (candidates.length > 0) ports.log?.('probe-unavailable')
    return { checked: 0, usable: 0, invalidated, unproven: candidates.map(item => item.row.locusId) }
  }

  for (const { row, locusMainSessionId } of candidates) {
    if (signal.aborted) break
    let liveness: ChildLiveness
    try {
      liveness = await ports.probe.check({ parentSessionId: locusMainSessionId, childSessionId: row.sessionId, signal })
    } catch (error) {
      liveness = { kind: 'unknown', diagnostic: error instanceof Error ? error.message : String(error) }
    }
    if (liveness.kind === 'unusable') {
      // Recorded, never re-created here: the next authorized @ rebuilds in place (D7).
      await ports.store.invalidate({ expectedLocusId: row.locusId, expectedRevision: row.revision }, liveness.reason, now())
      invalidated.push({ locusId: row.locusId, reason: liveness.reason })
      ports.log?.('child-unusable')
      continue
    }
    if (liveness.kind === 'unknown' || liveness.kind === 'capacity-limited') {
      unproven.push(row.locusId)
      ports.log?.(liveness.kind === 'unknown' ? 'child-unknown' : 'child-capacity-limited')
      continue
    }
    usable += 1
  }
  return { checked: candidates.length, usable, invalidated, unproven }
}

// ── Startup recovery (D7, D15, D16; task 2A.9) ──────────────────────────────

export interface StartupRecoveryPortV20 {
  assertEveryGroupMainPaired(): void
  listRows(): readonly LocusRowV20[]
  listRecoverableOperations(): readonly PetLocusOperation[]
  listPendingDeliveries(): readonly DeliveryRecord[]
  getDelivery(deliveryId: string): DeliveryRecord | undefined
  putDeliveryCas(prev: DeliveryRecord, next: DeliveryRecord): Promise<void>
  putOperation(op: PetLocusOperation): Promise<void>
  /**
   * D16 combined write for a crashed first-child publication, in ONE repository
   * write: row back to `not-created` with a fresh sessionId (`revision + 1`,
   * `accessMode` kept), the trigger Delivery settled `failed` on its old id,
   * uninjected backlog retargeted, the operation marked compensated. Owner A.
   */
  revertFirstDelivery(input: {
    readonly locusId: string
    readonly sessionId: string
    readonly revision: number
    readonly deliveryId: string
    readonly executionId: string
    readonly now: number
    readonly reserveChildSessionId: () => string
  }): Promise<void>
  markInvalid(fence: { readonly expectedLocusId: string; readonly expectedRevision: number }, reason: string, now: number): Promise<LocusRowV20>
}

export interface StartupCompensatorsV20 {
  readonly chat?: (input: { readonly chatId: string; readonly operationId: string }) => Promise<void>
  readonly mainSession?: (input: { readonly mainSessionId: string; readonly operationId: string }) => Promise<void>
  readonly locusMainSession?: (input: { readonly locusMainSessionId: string; readonly operationId: string }) => Promise<void>
  readonly childSession?: (input: { readonly parentSessionId: string; readonly childSessionId: string; readonly operationId: string }) => Promise<void>
}

export interface StartupRecoveryOptionsV20 {
  readonly now?: number
  readonly deliveryProof?: (delivery: DeliveryRecord) => Promise<LocusStartupDeliveryProof | undefined>
  readonly terminateDelivery?: (delivery: DeliveryRecord) => Promise<void>
  readonly compensators?: StartupCompensatorsV20
  /** Allocator of the fresh reservation used when a first-child publication is reverted. */
  readonly reserveChildSessionId?: () => string
}

export interface StartupRecoveryReportV20 {
  readonly failedDeliveries: readonly DeliveryRecord[]
  readonly retainedDeliveries: readonly DeliveryRecord[]
  readonly replayableDeliveries: readonly DeliveryRecord[]
  readonly manualDeliveries: readonly DeliveryRecord[]
  readonly compensatedOperations: readonly PetLocusOperation[]
  readonly manualOperations: readonly PetLocusOperation[]
  readonly sideEffectsReplayed: false
}

/** Startup attempts after which a manual debt is no longer retried (unless the cause was a missing capability). */
export const MANUAL_DEBT_RETRY_BUDGET = 5

const PENDING = new Set(['accepted', 'queued', 'running', 'current', 'finishing'])

const ledgerOf = (d: DeliveryRecord) => ({
  byMessageId: { [d.messageId]: d },
  byDeliveryId: { [d.deliveryId]: d },
  nextDeliverySequence: d.sequence + 1,
})

const withStateRevision = (d: DeliveryRecord): DeliveryRecord =>
  Object.freeze({ ...d, ...(d.revision === undefined ? {} : { stateRevision: d.revision }) })

/**
 * Startup recovery on v20 (task 2A.9). Order: group-row M pairing check (fails
 * startup), Delivery recovery by `(locusId, sessionId)` plus the group row's M,
 * then provisioning compensation. Nothing is re-sent and no session is created.
 * All durable writes go through the port; no index repair exists in v20 (D12).
 */
export async function recoverLocusStartupV20(
  port: StartupRecoveryPortV20,
  options: StartupRecoveryOptionsV20 = {},
): Promise<StartupRecoveryReportV20> {
  port.assertEveryGroupMainPaired()
  const now = options.now ?? Date.now()
  const failedDeliveries: DeliveryRecord[] = []
  const retainedDeliveries: DeliveryRecord[] = []
  const replayableDeliveries: DeliveryRecord[] = []
  const manualDeliveries: DeliveryRecord[] = []
  const compensatedOperations: PetLocusOperation[] = []
  const manualOperations: PetLocusOperation[] = []

  // Read dynamically: a combined recovery write (revertFirstDelivery) rotates a
  // row's sessionId, so a snapshot taken up front would judge retargeted backlog
  // against the old identity.
  const rowOf = (locusId: string) => port.listRows().find(row => row.locusId === locusId)
  const groupOf = (chatId: string) => port.listRows().find(row => row.endpoint.chatId === chatId && !('threadId' in row.endpoint && row.endpoint.threadId !== undefined))

  const invalidateIfActive = async (locusId: string): Promise<void> => {
    const row = rowOf(locusId)
    if (row === undefined || row.state !== 'active') return
    await port.markInvalid(
      { expectedLocusId: row.locusId, expectedRevision: row.revision },
      '启动恢复已终止无法证明可恢复的旧子会话执行；下一条授权 @ 将原地重建。',
      now,
    )
  }
  const write = (prev: DeliveryRecord, next: DeliveryRecord) => port.putDeliveryCas(prev, next)

  // A first-child publication left mid-flight (D16). The Delivery is NOT
  // retargeted: a `publishing` op does not prove the first prompt was never
  // claimed, so it settles failed on its old sessionId (never replayed).
  const blockedLoci = new Set<string>()
  const FIRST_CHILD_PHASES = new Set(['prepared', 'provisioning', 'publishing', 'compensating', 'failed', 'needs-recovery'])
  for (const op of port.listRecoverableOperations()) {
    if (op.operation !== 'first-child-publication' || !FIRST_CHILD_PHASES.has(op.phase)) continue
    const debt = async (reason: string): Promise<void> => {
      const next = { ...op, phase: 'needs-recovery' as const, attempts: op.attempts + 1, manualRecoveryReason: reason.slice(0, 500), lastError: reason.slice(0, 500), updatedAt: Math.max(now, op.updatedAt) }
      await port.putOperation(next)
      manualOperations.push(next)
      if (op.locusId !== undefined) blockedLoci.add(op.locusId)
    }
    const refs = op.resourceRefs ?? {}
    const row = op.locusId === undefined ? undefined : rowOf(op.locusId)
    const trigger = op.deliveryId === undefined ? undefined : port.getDelivery(op.deliveryId)
    const group = row === undefined ? undefined : groupOf(row.endpoint.chatId)
    const exact = row !== undefined && trigger !== undefined && group !== undefined &&
      refs.childSessionId !== undefined && refs.parentSessionId !== undefined &&
      row.sessionId === refs.childSessionId && trigger.sessionId === refs.childSessionId &&
      trigger.locusId === row.locusId && trigger.executionId !== undefined && trigger.status === 'current' &&
      (group as { locusMainSessionId: string }).locusMainSessionId === refs.parentSessionId &&
      op.expectedRevision !== undefined
    if (!exact) { await debt('First child recovery identity could not be proven; manual recovery is required.'); continue }
    const c = options.compensators
    if (c?.childSession === undefined || options.reserveChildSessionId === undefined) { await debt('First child termination capability unavailable'); continue }
    try {
      await c.childSession({ parentSessionId: refs.parentSessionId!, childSessionId: refs.childSessionId!, operationId: op.id })
      await port.revertFirstDelivery({
        locusId: row!.locusId, sessionId: refs.childSessionId!, revision: op.expectedRevision!,
        deliveryId: trigger!.deliveryId, executionId: trigger!.executionId!, now,
        reserveChildSessionId: options.reserveChildSessionId,
      })
      compensatedOperations.push({ ...op, phase: 'compensated', completedAt: now, updatedAt: Math.max(now, op.updatedAt) })
    } catch (error) {
      await debt(error instanceof Error ? error.message : String(error))
    }
  }

  for (const snapshot of port.listPendingDeliveries()) {
    const current = port.getDelivery(snapshot.deliveryId)
    if (current === undefined || !PENDING.has(current.status)) continue
    if (blockedLoci.has(current.locusId)) { manualDeliveries.push(current); continue }

    // The outbound request may have been issued: finishing is an at-most-once
    // unknown terminal on every restart; never inspect proof or send again.
    if (current.status === 'finishing') {
      const { queueState: _q, ...rest } = current
      const revision = (current.revision ?? current.stateRevision ?? 0) + 1
      await write(current, Object.freeze({
        ...rest,
        status: 'unknown-terminal' as const,
        finishOutcome: 'reply' as const,
        outboundResult: 'unknown' as const,
        outboundResultAt: now,
        outboundAttemptedAt: current.outboundAttemptedAt ?? current.finishedAt ?? now,
        finishedAt: current.finishedAt ?? now,
        revision,
        stateRevision: revision,
        outboundDiagnostic: current.outboundDiagnostic ?? 'Host restarted while outbound reply result was unknown.',
      }))
      continue
    }

    // Identity: (locusId, sessionId) on a row of the same endpoint whose group
    // row exists (it carries the M). A not-created row only vouches for an
    // unissued Delivery (no execution / inbox / turn evidence).
    const row = rowOf(current.locusId)
    const unissued = current.executionId === undefined && current.inboxMessageId === undefined && current.turnId === undefined &&
      (current.status === 'accepted' || current.status === 'current')
    const sameEndpoint = row !== undefined &&
      row.endpoint.chatId === current.endpoint.chatId &&
      (row.endpoint as { threadId?: string }).threadId === current.endpoint.threadId
    const identityProven = row !== undefined && sameEndpoint && groupOf(row.endpoint.chatId) !== undefined &&
      row.sessionId === current.sessionId &&
      (row.state === 'active' || (row.state === 'not-created' && unissued))
    if (!identityProven) {
      // An accepted backlog row has no execution evidence to protect, and debt is only
      // valid on an in-flight Delivery (the schema refuses it elsewhere): it stays pending.
      if (current.status === 'accepted') { retainedDeliveries.push(current); continue }
      const debt = Object.freeze({
        ...current,
        startupRecoveryDebt: 'Locus, session, or endpoint identity could not be proven during startup; manual recovery is required.',
      })
      if (current.startupRecoveryDebt !== debt.startupRecoveryDebt) await write(current, debt)
      manualDeliveries.push(debt)
      continue
    }

    const hardDeadline = current.hardDeadlineAt ?? (current.acceptedAt === undefined ? undefined : current.acceptedAt + MAX_DELIVERY_LEASE_MS)
    const currentDeadline = hardDeadline === undefined
      ? current.deadlineAt
      : current.deadlineAt === undefined ? hardDeadline : Math.min(current.deadlineAt, hardDeadline)
    if (
      (current.status === 'current' && currentDeadline !== undefined && now >= currentDeadline) ||
      (current.status !== 'current' && hardDeadline !== undefined && now >= hardDeadline)
    ) {
      const applied = expireDelivery(ledgerOf(current), {
        endpoint: current.endpoint, locusId: current.locusId, sessionId: current.sessionId,
        deliveryId: current.deliveryId, now,
        ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
      })
      if (applied.changed && applied.record !== undefined) {
        const expired = withStateRevision(applied.record)
        await write(current, expired)
        failedDeliveries.push(expired)
      }
      continue
    }

    if (current.status === 'current') {
      if (row.state === 'not-created' && unissued) { replayableDeliveries.push(current); continue }
      let proof: LocusStartupDeliveryProof | undefined
      if (current.executionId !== undefined) {
        try { proof = await options.deliveryProof?.(current) } catch { proof = undefined }
      }
      if (proof?.state === 'unconsumed' && current.turnId === undefined &&
          proof.deliveryId === current.deliveryId && proof.executionId === current.executionId) {
        replayableDeliveries.push(current)
        continue
      }
      if (proof?.state === 'interrupted' && proof.deliveryId === current.deliveryId &&
          proof.executionId === current.executionId && (current.turnId === undefined || proof.turnId === current.turnId)) {
        const abandoned = abandonInterruptedDelivery(ledgerOf(current), {
          endpoint: current.endpoint, locusId: current.locusId, sessionId: current.sessionId,
          deliveryId: current.deliveryId, now,
          ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
        })
        if (abandoned.changed && abandoned.record !== undefined) {
          const settled = withStateRevision(abandoned.record)
          await write(current, settled)
          failedDeliveries.push(settled)
          continue
        }
      }
      retainedDeliveries.push(current)
      continue
    }

    // Accepted rows are durable backlog admission; only the 24h cap expires them here.
    if (current.status === 'accepted') { retainedDeliveries.push(current); continue }

    // queued / running: an issued inbox execution. Retain only with exact proof.
    let proof: LocusStartupDeliveryProof | undefined
    try { proof = await options.deliveryProof?.(current) } catch { proof = undefined }
    if (proof?.state === 'running' && proof.deliveryId === current.deliveryId &&
        proof.executionId === current.executionId && (current.turnId === undefined || proof.turnId === current.turnId)) {
      const retained: DeliveryRecord = current.status === 'running'
        ? current
        : Object.freeze({
          ...current,
          status: 'running' as const,
          turnId: proof.turnId,
          startedAt: Math.max(now, current.queuedAt ?? current.acceptedAt ?? 0),
        })
      if (retained !== current) await write(current, retained)
      retainedDeliveries.push(retained)
      continue
    }
    let terminated = false
    try {
      if (options.terminateDelivery !== undefined) { await options.terminateDelivery(current); terminated = true }
    } catch { terminated = false }
    if (!terminated) {
      const debt = Object.freeze({
        ...current,
        startupRecoveryDebt: 'Exact live-turn proof and safe termination are unavailable; manual recovery is required.',
      })
      if (current.startupRecoveryDebt !== debt.startupRecoveryDebt) await write(current, debt)
      manualDeliveries.push(debt)
      continue
    }
    const { startupRecoveryDebt: _debt, ...withoutDebt } = current
    const failed: DeliveryRecord = Object.freeze({
      ...withoutDebt,
      status: 'failed' as const,
      startupDisposition: 'execution-unrecoverable' as const,
      failureReason: 'Host restarted without exact recoverable turn proof; the old child execution was terminated and work was not replayed.',
      failedAt: Math.max(now, current.startedAt ?? current.queuedAt ?? current.acceptedAt ?? 0),
    })
    await write(current, failed)
    await invalidateIfActive(current.locusId)
    failedDeliveries.push(failed)
  }

  // Provisioning compensation. Resources are exactly what the operation
  // recorded: a rebind/migrate records only the M1 it created, so a chat or
  // work session is never reclaimed by them (D6, D7).
  for (const snapshot of port.listRecoverableOperations()) {
    if (snapshot.operation === 'first-child-publication') continue
    let operation = snapshot
    if (operation.phase === 'needs-recovery' && operation.manualRecoveryReason !== undefined) {
      const capabilityMissing = /\bunavailable\b/.test(operation.manualRecoveryReason)
      if (!capabilityMissing && operation.attempts >= MANUAL_DEBT_RETRY_BUDGET) {
        manualOperations.push(operation)
        continue
      }
    }
    const refs = operation.resourceRefs ?? {}
    const ownsChat = operation.operation === 'chat'
    const required: Array<'chat' | 'locus-main-session' | 'main-session'> = []
    if (ownsChat && refs.chatId !== undefined) required.push('chat')
    if (refs.locusMainSessionId !== undefined) required.push('locus-main-session')
    if (ownsChat && refs.mainSessionId !== undefined) required.push('main-session')
    const completed = new Set(operation.compensatedResources ?? [])
    operation = { ...operation, phase: 'compensating', attempts: operation.attempts + 1, manualRecoveryReason: undefined, updatedAt: Math.max(now, operation.updatedAt) }
    await port.putOperation(operation)
    let manualReason: string | undefined
    const c = options.compensators
    for (const resource of required) {
      if (completed.has(resource)) continue
      try {
        if (resource === 'chat') {
          if (c?.chat === undefined || refs.chatId === undefined) throw new Error('chat compensator unavailable')
          await c.chat({ chatId: refs.chatId, operationId: operation.id })
        } else if (resource === 'locus-main-session') {
          if (c?.locusMainSession === undefined || refs.locusMainSessionId === undefined) throw new Error('locus-main-session compensator unavailable')
          await c.locusMainSession({ locusMainSessionId: refs.locusMainSessionId, operationId: operation.id })
        } else {
          if (c?.mainSession === undefined || refs.mainSessionId === undefined) throw new Error('main-session compensator unavailable')
          await c.mainSession({ mainSessionId: refs.mainSessionId, operationId: operation.id })
        }
        completed.add(resource)
        operation = { ...operation, compensatedResources: [...completed], step: operation.step + 1, updatedAt: Math.max(now, operation.updatedAt) }
        await port.putOperation(operation)
      } catch (error) {
        manualReason = error instanceof Error ? error.message : String(error)
        break
      }
    }
    if (manualReason === undefined) {
      operation = { ...operation, phase: 'compensated', compensatedResources: [...completed], completedAt: Math.max(now, operation.updatedAt), updatedAt: Math.max(now, operation.updatedAt) }
      await port.putOperation(operation)
      compensatedOperations.push(operation)
    } else {
      if (snapshot.phase === 'failed') {
        // A failed provisioning stays retryable (original time kept so the next
        // request retries at once); it is not owner-facing manual debt.
        operation = { ...operation, phase: 'failed', lastError: manualReason.slice(0, 500), updatedAt: snapshot.updatedAt }
        await port.putOperation(operation)
      } else {
        operation = { ...operation, phase: 'needs-recovery', manualRecoveryReason: manualReason.slice(0, 500), lastError: manualReason.slice(0, 500), updatedAt: Math.max(now, operation.updatedAt) }
        await port.putOperation(operation)
        manualOperations.push(operation)
      }
    }
  }

  return { failedDeliveries, retainedDeliveries, replayableDeliveries, manualDeliveries, compensatedOperations, manualOperations, sideEffectsReplayed: false }
}
