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

export type LocusPolicyVerificationFailure =
  | 'policy-unavailable'
  | 'mode-mismatch'

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
 * @returns verified effective mode, or the reason the locus must not serve.
 */
export function verifyLocusLivePolicy(
  locus: Pick<LocusRecord, 'permission' | 'contextAnchor'>,
  policy: LocusLiveSandboxPolicy | undefined,
): LocusPolicyVerification {
  if (policy === undefined || typeof policy.mode !== 'string') {
    return {
      ok: false,
      reason: 'policy-unavailable',
      diagnostic: '无法从 continuation owner 读取 live sandbox policy；locus 已暂停。',
    }
  }

  // `write` means full access (ADR-0005): it is the only mode under which a
  // locus child can touch the sibling worktrees its owner actually works in.
  const expectedMode = locus.permission.effective === 'write' ? 'danger-full-access' : 'read-only'
  if (policy.mode !== expectedMode) {
    return {
      ok: false,
      reason: 'mode-mismatch',
      diagnostic: locus.permission.effective === 'write'
        ? '宿主回读的文件策略不是完全访问；该入口已暂停，请重新提权或降权为只读。'
        : 'live sandbox mode 与 durable permission effective 不一致；locus 已暂停。',
    }
  }
  return { ok: true, effective: locus.permission.effective }
}
