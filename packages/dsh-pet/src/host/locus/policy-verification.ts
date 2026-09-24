/**
 * Pure verification of one locus generation against the live Host sandbox.
 *
 * A `write` grant is valid only when the live Host reports FULL access for the
 * exact child session. The execution root is deliberately NOT part of this
 * decision: a locus child's cwd is fixed at creation to its parent's cwd, so a
 * directory-equality rule could never cover the sibling worktrees an owner
 * works in, and requiring it made escalation unreachable
 * (`docs/adr/ADR-0005-locus-write-grants-full-access.md`). Context anchors stay
 * context facts, never grants.
 */

import type { LocusPermissionMode, LocusRecord } from './aggregate.js'

export interface LocusLiveSandboxPolicy {
  readonly mode?: string
  readonly workspaceRoot?: string
}

/**
 * Master switch for the `write` grant.
 *
 * `false` means no locus may hold write authority, whatever a durable record
 * says and whatever the live sandbox reports. Turned OFF while there is no
 * agreed protocol for CONCURRENT WRITES: several locus children share one
 * checkout and `write` is full access (ADR-0005), so two children acting at
 * once can destroy each other's work with nothing to arbitrate between them.
 * A read-only locus cannot have that problem, so closed is the safe state
 * until that protocol exists.
 *
 * Deliberately a constant rather than configuration: this is a temporary
 * safety stance, not a per-deployment knob. Re-enabling is a one-line change
 * plus a rebuild, and should happen only together with the concurrency
 * protocol it is waiting on.
 *
 * Enforced HERE because this derivation is the single funnel every path goes
 * through — Feishu `/scope`, the management panel and startup re-verification
 * alike — so no caller can route around it. Existing grants are demoted at
 * their next verification rather than rewritten in storage: the durable record
 * keeps the owner's original intent, so flipping this back restores it without
 * re-granting anything.
 */
export const LOCUS_WRITE_ENABLED: boolean = false

/** Stated whenever a stored write grant is demoted by {@link LOCUS_WRITE_ENABLED}. */
export const LOCUS_WRITE_DISABLED_DIAGNOSTIC =
  '写档已全局停用：多个 locus 子会话共享同一份代码目录，而 write 即完全访问，' +
  '并发写入尚无协商机制。该入口按只读服务；恢复写档需要先定下并发写协议。'

export type LocusPolicyVerificationFailure =
  | 'policy-unavailable'
  | 'mode-mismatch'
  | 'write-disabled'

export type LocusPolicyVerification =
  | { readonly ok: true; readonly effective: LocusPermissionMode }
  | {
      readonly ok: false
      readonly reason: LocusPolicyVerificationFailure
      readonly diagnostic: string
    }

/**
 * Verify the durable permission against a policy read from the live child.
 *
 * Write authority is DERIVED here, never stored: the fact that must hold is
 * "the live sandbox reports FULL access for this exact child session". A stored
 * grant could go stale, and a persisted "yes" would then outrank the live truth.
 *
 * The execution root is not consulted. It is a CONTEXT fact — where the work
 * belongs, injected into the child — not a boundary: `write` grants full access
 * by explicit owner decision, because a locus child's cwd is fixed to its
 * parent's cwd and `workspace-write` could therefore never cover the sibling
 * worktrees the owner works in
 * (`docs/adr/ADR-0005-locus-write-grants-full-access.md`).
 *
 * @param locus - The durable locus record whose permission is being checked.
 * @param policy - The policy read back from the live child session.
 * @param writeEnabled - Whether write grants are honoured at all. Defaults to
 *   {@link LOCUS_WRITE_ENABLED}; every production caller takes that default.
 *   Injectable ONLY so the ADR-0005 write semantics keep their own test
 *   coverage while the switch is off — otherwise turning it back on would mean
 *   trusting a mechanism nothing has exercised since the day it was disabled.
 * @returns verified effective mode, or the reason the locus must not serve.
 */
export function verifyLocusLivePolicy(
  locus: Pick<LocusRecord, 'permission' | 'contextAnchor'>,
  policy: LocusLiveSandboxPolicy | undefined,
  writeEnabled: boolean = LOCUS_WRITE_ENABLED,
): LocusPolicyVerification {
  if (policy === undefined || typeof policy.mode !== 'string') {
    return {
      ok: false,
      reason: 'policy-unavailable',
      diagnostic: '无法从 continuation owner 读取 live sandbox policy；locus 已暂停。',
    }
  }

  // The write switch is checked BEFORE the mode comparison, so a stored write
  // grant is demoted rather than failing as a mismatch: the entry keeps
  // serving read-only work instead of being suspended for holding a grant the
  // build no longer honours.
  const requested = writeEnabled ? locus.permission.effective : 'read'

  // `write` means full access (ADR-0005): it is the only mode under which a
  // locus child can touch the sibling worktrees its owner actually works in.
  const expectedMode = requested === 'write' ? 'danger-full-access' : 'read-only'
  if (policy.mode !== expectedMode) {
    // A demoted grant whose child is still sitting in full access is NOT a
    // mismatch to report as such — it is the switch doing its job, and the
    // caller must be told the real reason so the panel does not read as a
    // host fault.
    if (!writeEnabled && locus.permission.effective === 'write') {
      return { ok: false, reason: 'write-disabled', diagnostic: LOCUS_WRITE_DISABLED_DIAGNOSTIC }
    }
    return {
      ok: false,
      reason: 'mode-mismatch',
      diagnostic: locus.permission.effective === 'write'
        ? '宿主回读的文件策略不是完全访问；该入口已暂停，请重新提权或降权为只读。'
        : 'live sandbox mode 与 durable permission effective 不一致；locus 已暂停。',
    }
  }
  // Report the mode that is actually in force, not the stored intent: a
  // demoted locus serves as `read`, and saying otherwise would make every
  // downstream display and authorization claim something untrue.
  return { ok: true, effective: requested }
}
