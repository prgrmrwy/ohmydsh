/**
 * The one way an entry's `accessMode` changes (design D8).
 *
 * A change only WRITES THE ROW. Nothing is applied to a live child or read
 * back here: the next assembly of the child (cold resume, or the first
 * creation's `agent/created`) applies the row's value and verifies it, and a
 * mismatch refuses publication (`composeLocusChild`, class B). So the steps are:
 *
 * 1. `acquireAccessChange` — inside the repository write queue: no non-terminal
 *    Delivery, not already changing; joins the `accessChanging` set, which
 *    `acceptDelivery`, stop / rebind / migrate / rebuild and the `agent/created`
 *    publish boundary all refuse on.
 * 2. Live idle proof — turn boundary (incl. GUI / inquiry turns) and an empty
 *    inbox, only meaningful while the child is live.
 * 3. A live child is released with `drainChildren(exactLiveParent, [sessionId])`
 *    (never `adapter.dispose`), and its exit is then CONFIRMED: an absent target
 *    makes the drain a successful no-op.
 * 4. CAS on the revision acquisition returned.
 * 5. `finally`: leave the set.
 *
 * Every failure leaves a self-consistent entry and no rollback branch: a
 * failed release leaves the row untouched (the runtime may have released it
 * anyway, so nothing here claims the child still runs); a failed CAS leaves the
 * row untouched with the child released, and the next wake cold-resumes by the
 * old row. No operation record or audit row is written.
 */

import type { PetLocusErrorCodeV20 } from '../../wire.js'
import type { LocusAccessModeV20, LocusRefusalV20, LocusRepositoryPortV20, LocusRowV20 } from './contract-v20.js'
import { LOCUS_WRITE_DISABLED_DIAGNOSTIC, LOCUS_WRITE_ENABLED } from './policy-verification.js'

/** The receipt of every accepted change (spec 「Locus 访问模式」). Never "applied". */
export const LOCUS_ACCESS_CHANGE_RECEIPT = '已更新，下次唤醒时应用并核验；核验失败将拒绝服务'

/**
 * What full access really means, stated wherever it is granted (spec
 * 「完全访问由 allowlist 显式授予且如实说明」). Shared by the Feishu receipt and
 * the management surface; the egress guard is named as NOT a boundary.
 */
export const LOCUS_FULL_ACCESS_DISCLOSURE =
  '完全访问即整机无边界的文件写能力，由入口成员共享；子会话还可以在所有者本机执行命令、使用所有者本机飞书凭据（读取与网络不受限）。' +
  '当前入口转为所有者专用：仅 allowlist 成员的 @ 会被受理。lark-cli 出站 guard 只防误操作，不是安全边界；业务回复请用 pet_locus_finish。'

/** The slice of the v20 repository port (owner A) an access change uses. */
export type LocusAccessRepositoryPort = Pick<
  LocusRepositoryPortV20,
  'getLocus' | 'getRow' | 'acquireAccessChange' | 'releaseAccessChange' | 'isAccessChanging' | 'setAccessMode'
>

/**
 * The live runtime facts (wired in `index.ts`, owner B). `Parent` is the exact
 * live parent Agent object `drainChildren` needs; it is opaque here.
 */
export interface LocusAccessLivePort<Parent> {
  /** Whether a live agent exists for this session (`ctx.agents.get(id) !== undefined`). */
  isLive(sessionId: string): boolean
  /** The exact live Agent of this locus main, or `undefined` when it is not resident. */
  liveParent(locusMainSessionId: string): Parent | undefined
  /** No open turn at the durable turn boundary, GUI and inquiry turns included. */
  isTurnIdle(sessionId: string): boolean
  /** The child's inbox holds input that has not been claimed yet. */
  hasPendingInput(sessionId: string): boolean
  /** `ctx.subagents.drainChildren`: release only the listed resident children of `parent`. */
  drainChildren(parent: Parent, sessionIds: readonly string[]): Promise<void>
}

export interface LocusAccessMutationPorts<Parent> {
  readonly repository: LocusAccessRepositoryPort
  readonly live: LocusAccessLivePort<Parent>
  readonly now?: () => number
  /** Defaults to {@link LOCUS_WRITE_ENABLED}; injectable only for tests. */
  readonly writeEnabled?: boolean
  readonly log?: (message: string) => void
}

export interface LocusAccessChangeRequest {
  readonly locusId: string
  readonly mode: LocusAccessModeV20
  /** Recorded as `grantedBy`: an allowlisted open id, or the management identity. */
  readonly actorId: string
}

export interface LocusAccessChangeResult {
  readonly row: LocusRowV20
  /** Owner-facing receipt: {@link LOCUS_ACCESS_CHANGE_RECEIPT}, plus the disclosure for full access. */
  readonly receipt: string
}

/** A refusal carrying a v20 code and a deterministic, actionable reason. */
export class LocusAccessRefusal extends Error implements LocusRefusalV20 {
  override readonly name = 'LocusAccessRefusal'
  readonly code: PetLocusErrorCodeV20

  constructor(code: PetLocusErrorCodeV20, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

const BUSY_DELIVERY = '入口忙：该入口有未结束的投递或正在变更访问模式，访问模式未修改。'
const BUSY_LIVE = '入口忙：子会话当前有运行中的 turn 或待处理的输入，访问模式未修改。'
const BUSY_RELEASE = '子会话释放未成功，访问模式未修改；运行体可能已部分释放该子会话。'
const BUSY_NOT_EXITED = '无法确认子会话已退出，访问模式未修改。'
const CONFLICT = '入口已变化（并发的停止、改绑、迁移或重建），访问模式未修改；子会话已释放，下次唤醒按原设置恢复。'
const NOT_SERVING = '该入口已停止或失效，不受理访问模式变更；重新启用或重建后入口为只读。'
const NOT_FOUND = '入口不存在。'

const PORT_MESSAGES: Partial<Record<PetLocusErrorCodeV20, string>> = {
  LOCUS_NOT_FOUND: NOT_FOUND,
  LOCUS_BUSY: BUSY_DELIVERY,
  LOCUS_CONFLICT: CONFLICT,
  INVALID_REQUEST: NOT_SERVING,
}

/** Re-throw a repository refusal with this module's deterministic wording. */
function fromPort(error: unknown): LocusAccessRefusal {
  const code = (error as { code?: unknown } | undefined)?.code
  if (typeof code === 'string' && code in PORT_MESSAGES) {
    return new LocusAccessRefusal(code as PetLocusErrorCodeV20, PORT_MESSAGES[code as PetLocusErrorCodeV20]!, { cause: error })
  }
  // An uncoded repository failure is a persistence failure; the row did not move.
  return new LocusAccessRefusal('LOCUS_CONFLICT', '访问模式未能持久化，入口保持原设置。', { cause: error })
}

function isServingState(row: LocusRowV20): boolean {
  return row.state === 'not-created' || row.state === 'active'
}

/**
 * Build the access-change operation.
 * @param ports - repository (owner A) and live runtime facts (owner B wiring).
 * @returns `set`, which resolves with the CAS-written row or rejects with a {@link LocusAccessRefusal}.
 */
export function createLocusAccessMutation<Parent>(ports: LocusAccessMutationPorts<Parent>): {
  set(request: LocusAccessChangeRequest): Promise<LocusAccessChangeResult>
} {
  const { repository, live } = ports
  const now = ports.now ?? Date.now
  const writeEnabled = ports.writeEnabled ?? LOCUS_WRITE_ENABLED

  return {
    async set(request) {
      // Refused at the door: neither step 1 nor a drain happens.
      if (request.mode === 'danger-full-access' && !writeEnabled) {
        throw new LocusAccessRefusal('INVALID_REQUEST', LOCUS_WRITE_DISABLED_DIAGNOSTIC)
      }
      const before = repository.getLocus(request.locusId)
      if (before === undefined) throw new LocusAccessRefusal('LOCUS_NOT_FOUND', NOT_FOUND)
      if (!isServingState(before)) throw new LocusAccessRefusal('INVALID_REQUEST', NOT_SERVING)

      let acquired: { readonly locusId: string; readonly revision: number }
      try {
        acquired = await repository.acquireAccessChange(request.locusId)
      } catch (error) {
        throw fromPort(error)
      }
      try {
        const row = repository.getLocus(request.locusId)
        if (row === undefined) throw new LocusAccessRefusal('LOCUS_NOT_FOUND', NOT_FOUND)
        if (row.revision !== acquired.revision) throw new LocusAccessRefusal('LOCUS_CONFLICT', CONFLICT)

        if (live.isLive(row.sessionId)) {
          if (!live.isTurnIdle(row.sessionId) || live.hasPendingInput(row.sessionId)) {
            throw new LocusAccessRefusal('LOCUS_BUSY', BUSY_LIVE)
          }
          const group = 'threadId' in row.endpoint ? repository.getRow({ chatId: row.endpoint.chatId }) : row
          const locusMainSessionId = group !== undefined && 'locusMainSessionId' in group ? group.locusMainSessionId : undefined
          const parent = locusMainSessionId === undefined ? undefined : live.liveParent(locusMainSessionId)
          if (parent === undefined) throw new LocusAccessRefusal('LOCUS_BUSY', BUSY_RELEASE)
          try {
            await live.drainChildren(parent, [row.sessionId])
          } catch (error) {
            throw new LocusAccessRefusal('LOCUS_BUSY', BUSY_RELEASE, { cause: error })
          }
          if (live.isLive(row.sessionId)) throw new LocusAccessRefusal('LOCUS_BUSY', BUSY_NOT_EXITED)
        }

        let written: LocusRowV20
        try {
          written = await repository.setAccessMode(
            { expectedLocusId: acquired.locusId, expectedRevision: acquired.revision },
            request.mode,
            request.actorId,
            now(),
          )
        } catch (error) {
          throw fromPort(error)
        }
        return {
          row: written,
          receipt: request.mode === 'danger-full-access'
            ? `${LOCUS_ACCESS_CHANGE_RECEIPT}\n${LOCUS_FULL_ACCESS_DISCLOSURE}`
            : LOCUS_ACCESS_CHANGE_RECEIPT,
        }
      } finally {
        repository.releaseAccessChange(request.locusId)
      }
    },
  }
}
