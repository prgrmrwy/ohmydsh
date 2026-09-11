/**
 * The message -> locus generation -> child -> execution diagnostic chain.
 *
 * When a Feishu message appears to have gone nowhere, the owner needs to see
 * exactly where it stopped: was it never admitted, admitted but never queued,
 * queued but never claimed by a turn, or claimed and then failed? Each of
 * those has a different fix, and guessing between them is what makes this
 * class of problem expensive.
 *
 * The chain is assembled from durable records only. It deliberately carries
 * NO message text, sender name, credential, or transcript: a diagnostic that
 * leaks the conversation is not usable in a shared setting, and a group-facing
 * receipt must never enumerate other entries. Identifiers that would expose
 * unrelated scope — full session ids, other chats — are reduced to short,
 * non-reversible labels.
 */

import type { DeliveryRecord, DeliveryStatus } from './delivery.js'
import type { LocusRecord } from './aggregate.js'

/** How far one accepted message got. */
export type DeliveryStage =
  /** Durably accepted, not yet bound to a queue slot. */
  | 'accepted'
  /** Bound to an execution token, waiting for a turn to claim it. */
  | 'queued'
  /** A child turn claimed it and is running. */
  | 'running'
  /** The claiming turn finished successfully. */
  | 'settled'
  /** The claiming turn ended without success. */
  | 'failed'

/** One link of the chain, safe to show an owner. */
export interface DeliveryDiagnostic {
  /** Short label for the platform message; never the full id or its text. */
  readonly message: string
  /** The endpoint, reduced to a short chat label plus topic presence. */
  readonly entry: { readonly chat: string; readonly topic: boolean }
  readonly locus: { readonly id: string; readonly generation: number }
  /** Short label for the child session; never the full session id. */
  readonly child: string
  readonly stage: DeliveryStage
  /** Whether an execution token was bound; the token itself is not exposed. */
  readonly executionBound: boolean
  /** Whether a trusted per-turn identity was bound. */
  readonly turnBound: boolean
  readonly acceptedAt?: number
  readonly settledAt?: number
  /** Stable failure reason when the record carries one. */
  readonly failureReason?: string
  /**
   * What to look at next, derived from the stage rather than from prose in the
   * record. This is the part that turns a status into an action.
   */
  readonly nextCheck: string
}

/** Aggregate answer for one endpoint or child. */
export interface LocusDiagnosticReport {
  readonly locus: {
    readonly id: string
    readonly generation: number
    readonly state: string
    readonly busy: boolean
    readonly permission: 'read' | 'write'
    /** Present when the generation is unavailable and says why. */
    readonly invalidReason?: string
  }
  /** Most recent first, so the newest problem is at the top. */
  readonly deliveries: readonly DeliveryDiagnostic[]
  /** Counts per stage, so a pattern is visible without reading every row. */
  readonly stageCounts: Readonly<Record<DeliveryStage, number>>
}

/**
 * Shorten an opaque identifier for display.
 *
 * Keeps only a tail, so two rows remain distinguishable while the full value
 * — which may address a chat or session the reader has no business seeing —
 * stays out of the output.
 */
function shortLabel(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return '(unknown)'
  return trimmed.length <= 8 ? trimmed : `…${trimmed.slice(-8)}`
}

/** Derive the stage from the durable record's own proof fields. */
function stageOf(record: DeliveryRecord): DeliveryStage {
  const status: DeliveryStatus = record.status
  if (status === 'settled' || status === 'failed' || status === 'running') return status
  if (status === 'queued') return 'queued'
  return 'accepted'
}

/** What an owner should look at next for one stage. */
function nextCheckFor(stage: DeliveryStage, locus: LocusRecord): string {
  switch (stage) {
    case 'accepted':
      // Accepted but never queued means the child could not take the work.
      return locus.busy
        ? '该代际正忙；确认当前轮次结束后是否恢复排队。'
        : '已接受但未排队：检查子会话是否可用、宿主是否具备投递能力。'
    case 'queued':
      // Queued but unclaimed means the runtime never started a turn for it.
      return '已排队但没有轮次认领：检查子会话是否在运行，以及逐轮关联观察器是否已订阅。'
    case 'running':
      return '轮次进行中：等待其结束；结算只接受该轮次自身的结果。'
    case 'settled':
      return '已完成。若群内没有回复，说明子会话本轮未发送正文——Host 不代发业务内容。'
    case 'failed':
      return '该轮次失败：查看失败原因，必要时在群内重新提问；旧消息不会自动重试。'
    default:
      stage satisfies never
      return ''
  }
}

/**
 * Build the diagnostic chain for one locus generation.
 * @param locus - the durable locus record.
 * @param deliveries - its durable Delivery records, in any order.
 * @returns the owner-facing report.
 */
export function buildLocusDiagnostics(
  locus: LocusRecord,
  deliveries: readonly DeliveryRecord[],
): LocusDiagnosticReport {
  const stageCounts: Record<DeliveryStage, number> = {
    accepted: 0, queued: 0, running: 0, settled: 0, failed: 0,
  }
  const rows = deliveries
    .filter(record => record.locusId === locus.id && record.generation === locus.generation)
    // Newest first by acceptance order, which is monotonic and does not
    // depend on a wall clock that may have moved.
    .slice()
    .sort((left, right) => right.sequence - left.sequence)
    .map((record): DeliveryDiagnostic => {
      const stage = stageOf(record)
      stageCounts[stage] += 1
      return {
        message: shortLabel(record.messageId),
        entry: {
          chat: shortLabel(record.endpoint.chatId),
          topic: record.endpoint.threadId !== undefined,
        },
        locus: { id: record.locusId, generation: record.generation },
        child: shortLabel(record.childSessionId),
        stage,
        // Presence only: the tokens themselves are settlement proof and are
        // never displayed.
        executionBound: record.executionId !== undefined,
        turnBound: record.turnId !== undefined,
        ...(record.acceptedAt === undefined ? {} : { acceptedAt: record.acceptedAt }),
        ...(record.settledAt ?? record.failedAt) === undefined
          ? {}
          : { settledAt: record.settledAt ?? record.failedAt },
        ...(record.failureReason === undefined ? {} : { failureReason: record.failureReason }),
        nextCheck: nextCheckFor(stage, locus),
      }
    })

  return {
    locus: {
      id: locus.id,
      generation: locus.generation,
      state: locus.state,
      busy: locus.busy,
      permission: locus.permission.effective,
      ...(locus.invalidReason === undefined ? {} : { invalidReason: locus.invalidReason }),
    },
    deliveries: rows,
    stageCounts,
  }
}
