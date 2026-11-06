/**
 * Pure verification of one locus entry's `accessMode` (design D8).
 *
 * v20 has one value per row. A child serves only when the live sandbox mode
 * equals that value exactly; there is no demotion, fallback or stored intent
 * that differs from what is in force. The execution root is not part of the
 * decision (ADR-0005): full access has no directory boundary, and a context
 * fact is never a grant.
 */

import type { LocusAccessModeV20 } from './contract-v20.js'

export interface LocusLiveSandboxPolicy {
  readonly mode?: string
  readonly workspaceRoot?: string
}

/**
 * Master switch for `danger-full-access`.
 *
 * Turned OFF while there is no agreed protocol for CONCURRENT WRITES: several
 * locus children share one checkout and full access lets two of them destroy
 * each other's work with nothing to arbitrate. Deliberately a constant, not
 * configuration: re-enabling is a one-line change plus a rebuild, together
 * with the concurrency protocol it is waiting on.
 *
 * While off (D8): granting full access is refused; changing back to
 * `read-only` is allowed; an entry that already holds full access is refused
 * at its next assembly and its row is NOT rewritten — never silently demoted.
 */
export const LOCUS_WRITE_ENABLED: boolean = false

/** Stated wherever full access is refused because of {@link LOCUS_WRITE_ENABLED}. */
export const LOCUS_WRITE_DISABLED_DIAGNOSTIC =
  '写档已全局停用：多个 locus 子会话共享同一份代码目录，而完全访问下的并发写入尚无协商机制。' +
  '完全访问的入口暂不服务（入口设置保持不变），可改回只读；恢复写档需要先定下并发写协议。'

export type LocusPolicyVerificationFailure =
  | 'policy-unavailable'
  | 'mode-mismatch'
  | 'write-disabled'

export type LocusPolicyVerification =
  | { readonly ok: true; readonly effective: LocusAccessModeV20 }
  | {
      readonly ok: false
      readonly reason: LocusPolicyVerificationFailure
      readonly diagnostic: string
    }

const WRITE_DISABLED: LocusPolicyVerification = {
  ok: false,
  reason: 'write-disabled',
  diagnostic: LOCUS_WRITE_DISABLED_DIAGNOSTIC,
}

/**
 * Verify a row against the policy read from its live child.
 * @param row - the entry row (only `accessMode` is read).
 * @param policy - the policy read back from the exact live child session.
 * @param writeEnabled - defaults to {@link LOCUS_WRITE_ENABLED}; injectable for tests.
 */
export function verifyLocusLivePolicy(
  row: { readonly accessMode: LocusAccessModeV20 },
  policy: LocusLiveSandboxPolicy | undefined,
  writeEnabled: boolean = LOCUS_WRITE_ENABLED,
): LocusPolicyVerification {
  if (row.accessMode === 'danger-full-access' && !writeEnabled) return WRITE_DISABLED
  if (policy === undefined || typeof policy.mode !== 'string') {
    return {
      ok: false,
      reason: 'policy-unavailable',
      diagnostic: '无法从 continuation owner 读取 live sandbox policy；该入口暂不服务。',
    }
  }
  if (policy.mode !== row.accessMode) {
    return {
      ok: false,
      reason: 'mode-mismatch',
      diagnostic: `宿主回读的沙箱为 ${policy.mode}，与入口的访问模式 ${row.accessMode} 不一致；该入口暂不服务。`,
    }
  }
  return { ok: true, effective: row.accessMode }
}

/**
 * Verify a row without a live session (the child is not resident). Its
 * sandbox is applied and read back at the next assembly (`composeLocusChild`),
 * so the only thing left to check here is whether this build honours the value.
 */
export function verifyLocusPersistedPolicy(
  row: { readonly accessMode: LocusAccessModeV20 },
  writeEnabled: boolean = LOCUS_WRITE_ENABLED,
): LocusPolicyVerification {
  if (row.accessMode === 'danger-full-access' && !writeEnabled) return WRITE_DISABLED
  return { ok: true, effective: row.accessMode }
}
