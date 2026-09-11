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
 * No caller-controlled or owner-confirmed `authorization: unknown` anchor can
 * satisfy write: the provenance must explicitly identify the Host.
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
  const hostAuthorized = anchor?.status === 'confirmed'
    && anchor.authorization === 'authorized'
    && typeof anchor.provenance === 'string'
    && anchor.provenance.startsWith('host:')
  if (!hostAuthorized || anchor.executionRoot === undefined) {
    return {
      ok: false,
      reason: 'write-root-unauthorized',
      diagnostic: '缺少 Host-derived 且明确 authorized 的 execution root；workspace-write 不受支持。',
    }
  }

  const executionRoot = canonicalExecutionRoot(anchor.executionRoot)
  const workspaceRoot = typeof policy.workspaceRoot === 'string'
    ? canonicalExecutionRoot(policy.workspaceRoot)
    : undefined
  if (executionRoot === undefined || workspaceRoot === undefined || executionRoot !== workspaceRoot) {
    return {
      ok: false,
      reason: 'write-root-mismatch',
      diagnostic: 'authorized execution root 与 live sandbox workspace root 不精确一致；workspace-write 不受支持。',
    }
  }
  return { ok: true, effective: 'write' }
}
