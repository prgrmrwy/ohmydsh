/**
 * Pure verification of one locus generation against the live Host sandbox.
 *
 * The pinned policy owner canonicalizes its `workspaceRoot` from the exact
 * Session header.  A locus write grant is valid only when a separately
 * Host-derived, explicitly authorized execution root canonicalizes to that
 * exact value. Owner-confirmed/unknown anchors are context facts, not grants.
 */

import { resolve } from 'node:path'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import type { LocusPermissionMode, LocusRecord } from './aggregate.js'

export interface LocusLiveSandboxPolicy {
  readonly mode?: string
  readonly workspaceRoot?: string
}

export type LocusPolicyVerificationFailure =
  | 'policy-unavailable'
  | 'mode-mismatch'
  | 'write-root-unauthorized'
  | 'write-root-mismatch'

export type LocusPolicyVerification =
  | { readonly ok: true; readonly effective: LocusPermissionMode }
  | {
      readonly ok: false
      readonly reason: LocusPolicyVerificationFailure
      readonly diagnostic: string
    }

/** Match the canonical identity used by the pinned sandbox enforcement layer. */
export function canonicalExecutionRoot(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  try {
    return resolve(canonicalPath(trimmed))
  } catch {
    return undefined
  }
}

/**
 * Verify the durable permission against a policy read from the live child.
 *
 * Write authority is DERIVED here, never stored. Two independent facts must
 * agree, and neither alone is sufficient:
 *
 * 1. The owner explicitly confirmed an execution root (`status: 'confirmed'`,
 *    recorded with owner provenance). This is a statement of INTENT — it says
 *    where work belongs. A path a model proposed can never reach this field:
 *    only the owner-facing confirm operation writes it.
 * 2. The live Host sandbox reports that exact path as its `workspaceRoot`.
 *    This is the AUTHORITY, and it is Host-derived by construction because it
 *    is read back from the running sandbox rather than from Pet's own records.
 *
 * Requiring an additional stored `authorization: 'authorized'` flag would be
 * both redundant and harmful: redundant because the root equality below is the
 * real Host derivation, and harmful because a stored grant can go stale — the
 * sandbox root may change after the flag was written, and a persisted "yes"
 * would then outrank the live truth. Deriving per verification keeps the
 * decision fresh and fail-closed.
 *
 * An owner may still explicitly revoke: `authorization: 'unauthorized'` is
 * honored as a hard refusal regardless of root agreement.
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

  const expectedMode = locus.permission.effective === 'write' ? 'workspace-write' : 'read-only'
  if (policy.mode !== expectedMode) {
    return {
      ok: false,
      reason: 'mode-mismatch',
      diagnostic: 'live sandbox mode 与 durable permission effective 不一致；locus 已暂停。',
    }
  }
  if (locus.permission.effective === 'read') return { ok: true, effective: 'read' }

  const anchor = locus.contextAnchor
  // An explicit owner revocation outranks everything below, including a root
  // that would otherwise agree.
  if (anchor?.authorization === 'unauthorized') {
    return {
      ok: false,
      reason: 'write-root-unauthorized',
      diagnostic: '所有者已显式撤销该执行根的写授权；workspace-write 不受支持。',
    }
  }
  if (anchor?.status !== 'confirmed' || anchor.executionRoot === undefined) {
    return {
      ok: false,
      reason: 'write-root-unauthorized',
      diagnostic: '缺少所有者已确认的 execution root；请先确认上下文锚点再提权。',
    }
  }

  // This equality IS the Host derivation: `workspaceRoot` is read back from the
  // live sandbox, so agreement proves the Host itself authorizes exactly the
  // root the owner confirmed. Canonicalization makes the comparison resistant
  // to symlinks and non-normalized input; an unresolvable path fails closed.
  const executionRoot = canonicalExecutionRoot(anchor.executionRoot)
  const workspaceRoot = typeof policy.workspaceRoot === 'string'
    ? canonicalExecutionRoot(policy.workspaceRoot)
    : undefined
  if (executionRoot === undefined || workspaceRoot === undefined || executionRoot !== workspaceRoot) {
    return {
      ok: false,
      reason: 'write-root-mismatch',
      diagnostic: '已确认的 execution root 与 live sandbox workspace root 不精确一致；workspace-write 不受支持。',
    }
  }
  return { ok: true, effective: 'write' }
}
