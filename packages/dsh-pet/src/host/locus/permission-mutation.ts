/**
 * Single Host boundary for changing one locus child file policy.
 *
 * A database label is never permission.  This adapter resolves the exact
 * durable child session, applies the narrow DSH sandbox mode, reads the policy
 * back from the Host, and only then persists permission plus its audit row.
 * It deliberately knows no unrestricted/danger mode.
 */

import type { LocusMutationFence, LocusPermissionMode, LocusRecord } from './aggregate.js'
import { verifyLocusLivePolicy, type LocusLiveSandboxPolicy } from './policy-verification.js'

export type LocusSandboxMode = 'read-only' | 'workspace-write'

export type LocusPermissionMutationErrorCode =
  | 'LOCUS_NOT_FOUND'
  | 'LOCUS_NOT_CURRENT'
  | 'LOCUS_INVALID'
  | 'LOCUS_BUSY'
  | 'CHILD_SESSION_UNAVAILABLE'
  | 'POLICY_APPLY_FAILED'
  | 'POLICY_VERIFY_FAILED'
  | 'WRITE_UNSUPPORTED'
  | 'PERSISTENCE_FAILED'
  | 'POLICY_ROLLBACK_FAILED'

export class LocusPermissionMutationError extends Error {
  readonly code: LocusPermissionMutationErrorCode
  readonly cause?: unknown

  constructor(code: LocusPermissionMutationErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'LocusPermissionMutationError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

export interface LocusPermissionMutationRepository {
  getLocus(locusId: string): LocusRecord | undefined
  getCurrentLocus(endpoint: LocusRecord['endpoint']): LocusRecord | undefined
  getLocusByChild(childSessionId: string): LocusRecord | undefined
  hasPendingDeliveries?(locusId: string): boolean
  /** Move active → switching before any Host policy I/O. */
  beginPermissionMutation(
    locusId: string,
    now?: number,
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> | LocusRecord
  /** Restore switching → active after a failed, fully rolled-back mutation. */
  abortPermissionMutation(
    locusId: string,
    now?: number,
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> | LocusRecord
  /** Atomically persist verified permission and move switching → active. */
  commitPermissionMutation(
    locusId: string,
    permission: {
      readonly desired: LocusPermissionMode
      readonly effective: LocusPermissionMode
      readonly verifiedAt: number
      readonly grantedBy: string
    },
    now?: number,
    fence?: LocusMutationFence,
  ): Promise<LocusRecord> | LocusRecord
}

export interface LocusPermissionSession {
  readonly id: string
  /** Opaque live DSH session handle consumed only by the Host policy adapter. */
  readonly handle?: unknown
}

export interface LocusPermissionSessionPort {
  /** Resolve or cold-resume exactly this durable child session. */
  resolve(childSessionId: string): Promise<LocusPermissionSession | undefined> | LocusPermissionSession | undefined
}

export interface LocusPermissionPolicyPort {
  /** Apply only `read-only` or `workspace-write`; no wider mode is representable. */
  apply(session: LocusPermissionSession, mode: LocusSandboxMode): Promise<void> | void
  /** Return the complete effective Host policy for this exact live session. */
  resolve(session: LocusPermissionSession): Promise<LocusLiveSandboxPolicy | undefined> | LocusLiveSandboxPolicy | undefined
}

export interface LocusPermissionMutationRequest {
  readonly locusId: string
  readonly actorId: string
  readonly mode: LocusPermissionMode
  readonly fence?: LocusMutationFence
}

export interface LocusPermissionMutationPort {
  mutate(request: LocusPermissionMutationRequest): Promise<LocusRecord>
}

function modeFor(permission: LocusPermissionMode): LocusSandboxMode {
  return permission === 'write' ? 'workspace-write' : 'read-only'
}

function exactCurrent(
  repository: LocusPermissionMutationRepository,
  locusId: string,
): LocusRecord {
  const locus = repository.getLocus(locusId)
  if (locus === undefined) {
    throw new LocusPermissionMutationError('LOCUS_NOT_FOUND', '当前 locus 不存在。')
  }
  const current = repository.getCurrentLocus(locus.endpoint)
  if (current?.id !== locus.id || current.generation !== locus.generation) {
    throw new LocusPermissionMutationError('LOCUS_NOT_CURRENT', 'locus 已不是入口的当前代际，请刷新后重试。')
  }
  if (locus.state !== 'active' || locus.childSessionId === undefined) {
    throw new LocusPermissionMutationError('LOCUS_INVALID', '当前 locus 不可服务或缺少专属子会话。')
  }
  if (repository.getLocusByChild(locus.childSessionId)?.id !== locus.id) {
    throw new LocusPermissionMutationError('LOCUS_INVALID', '专属子会话反向索引与当前 locus 不一致。')
  }
  if (locus.busy || repository.hasPendingDeliveries?.(locus.id) === true) {
    throw new LocusPermissionMutationError('LOCUS_BUSY', 'locus 仍有已接受或运行中的 Delivery，请稍后重试。')
  }
  return locus
}

async function restorePolicy(
  policy: LocusPermissionPolicyPort,
  session: LocusPermissionSession,
  locus: LocusRecord,
  cause: unknown,
  releaseFence: () => Promise<void>,
): Promise<never> {
  const previous = locus.permission.effective
  try {
    await policy.apply(session, modeFor(previous))
    const restored = verifyLocusLivePolicy(locus, await policy.resolve(session))
    if (!restored.ok) throw new Error(`Host 回读未恢复：${restored.reason}`)
  } catch (rollbackError) {
    // Keep the durable fence closed when the effective sandbox is unknown.
    throw new LocusPermissionMutationError(
      'POLICY_ROLLBACK_FAILED',
      '权限变更失败且无法恢复原 sandbox；该 locus 保持暂停，必须人工核验。',
      { cause, rollbackError },
    )
  }
  try {
    await releaseFence()
  } catch (fenceError) {
    throw new LocusPermissionMutationError(
      'POLICY_ROLLBACK_FAILED',
      '原 sandbox 已恢复但无法解除 Delivery 栅栏；该 locus 保持暂停，必须人工核验。',
      { cause, fenceError },
    )
  }
  throw cause
}

/** Build the one permission mutation seam shared by Web management and Lark controls. */
export function createLocusPermissionMutation(options: {
  readonly repository: LocusPermissionMutationRepository
  readonly sessions: LocusPermissionSessionPort
  readonly policy: LocusPermissionPolicyPort
  readonly now?: () => number
}): LocusPermissionMutationPort {
  const { repository, sessions, policy, now = Date.now } = options
  const chains = new Map<string, Promise<void>>()

  const serialize = async <T>(key: string, body: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.catch(() => undefined).then(() => current)
    chains.set(key, tail)
    await previous.catch(() => undefined)
    try {
      return await body()
    } finally {
      release()
      if (chains.get(key) === tail) chains.delete(key)
    }
  }

  return {
    mutate: request => serialize(request.locusId, async () => {
      const actorId = request.actorId.trim()
      if (actorId === '') {
        throw new LocusPermissionMutationError('LOCUS_INVALID', '缺少可信操作者，不能修改权限。')
      }
      const previous = exactCurrent(repository, request.locusId)
      const childSessionId = previous.childSessionId!
      const initialFence: LocusMutationFence = {
        expectedGeneration: previous.generation,
        expectedUpdatedAt: previous.updatedAt,
        ...(previous.revision !== undefined ? { expectedRevision: previous.revision } : {}),
      }
      let fenced: LocusRecord
      try {
        // This durable busy bit is the same predicate checked by Delivery
        // acceptance. Acquire it before resolving/applying the live policy so
        // no turn can start under an uncommitted sandbox mode.
        fenced = await repository.beginPermissionMutation(previous.id, now(), initialFence)
      } catch (error) {
        throw new LocusPermissionMutationError('LOCUS_BUSY', '无法暂停新 Delivery，权限未修改。', error)
      }
      const releaseFence = async (): Promise<void> => {
        const current = repository.getLocus(previous.id)
        if (current === undefined || current.state !== 'switching') return
        await repository.abortPermissionMutation(previous.id, now(), {
          expectedGeneration: current.generation,
          expectedUpdatedAt: current.updatedAt,
          ...(current.revision !== undefined ? { expectedRevision: current.revision } : {}),
        })
      }
      const childSession = async (): Promise<LocusPermissionSession> => {
        const session = await sessions.resolve(childSessionId)
        if (session === undefined || session.id !== childSessionId) {
          throw new LocusPermissionMutationError(
            'CHILD_SESSION_UNAVAILABLE',
            '无法解析当前 locus 的 exact child session，权限未修改。',
          )
        }
        return session
      }
      let session: LocusPermissionSession
      try {
        session = await childSession()
      } catch (error) {
        await releaseFence()
        throw error
      }

      const requestedSandbox = modeFor(request.mode)
      try {
        await policy.apply(session, requestedSandbox)
      } catch (error) {
        await releaseFence()
        throw new LocusPermissionMutationError(
          'POLICY_APPLY_FAILED',
          `Host 拒绝应用 ${request.mode} sandbox，权限未修改。`,
          error,
        )
      }

      let verification
      try {
        verification = verifyLocusLivePolicy(
          { ...previous, permission: { ...previous.permission, desired: request.mode, effective: request.mode } },
          await policy.resolve(session),
        )
      } catch (error) {
        return restorePolicy(
          policy,
          session,
          previous,
          new LocusPermissionMutationError('POLICY_VERIFY_FAILED', 'sandbox 回读失败，权限未修改。', error),
          releaseFence,
        )
      }
      if (!verification.ok) {
        const error = request.mode === 'write'
          ? new LocusPermissionMutationError(
            'WRITE_UNSUPPORTED',
            `${verification.diagnostic} 已维持原 effective/read，未扩大权限。`,
          )
          : new LocusPermissionMutationError(
            'POLICY_VERIFY_FAILED',
            verification.diagnostic,
          )
        return restorePolicy(policy, session, previous, error, releaseFence)
      }
      const verified = verification.effective

      const verifiedAt = now()
      try {
        const current = repository.getLocus(previous.id)
        if (current === undefined || current.state !== 'switching' || current.generation !== fenced.generation) {
          throw new Error('durable permission mutation fence was lost')
        }
        // Persist the verified projection and release the busy bit in one
        // transaction. There is no observable database state where intake is
        // open but the committed permission still describes the old policy.
        return await repository.commitPermissionMutation(previous.id, {
          desired: request.mode,
          effective: verified,
          verifiedAt,
          grantedBy: actorId,
        }, verifiedAt, {
          expectedGeneration: current.generation,
          expectedUpdatedAt: current.updatedAt,
          ...(current.revision !== undefined ? { expectedRevision: current.revision } : {}),
        })
      } catch (error) {
        return restorePolicy(
          policy,
          session,
          previous,
          new LocusPermissionMutationError('PERSISTENCE_FAILED', 'sandbox 已核验但持久化失败；已尝试恢复原策略。', error),
          releaseFence,
        )
      }
    }),
  }
}
