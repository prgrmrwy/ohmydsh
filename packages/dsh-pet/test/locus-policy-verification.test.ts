import { describe, expect, it } from 'vitest'
import { verifyLocusLivePolicy } from '../src/host/locus/policy-verification.js'

const read = { desired: 'read' as const, effective: 'read' as const, verifiedAt: 1 }
const write = { desired: 'write' as const, effective: 'write' as const, verifiedAt: 1, grantedBy: 'host:test' }

/**
 * An anchor exactly as the owner-facing confirm operation persists it.
 *
 * Since ADR-0005 the anchor is a CONTEXT fact — where the work belongs — and is
 * not consulted when deciding a write grant. These cases exist to pin that:
 * the write decision must depend only on the live sandbox mode.
 */
function confirmed(executionRoot: string) {
  return {
    status: 'confirmed' as const,
    authorization: 'unknown' as const,
    executionRoot,
    provenance: 'owner:ou-owner',
    confirmedAt: 1,
  }
}

describe('locus live sandbox policy verification', () => {
  it('requires exact durable mode for read', () => {
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'read-only', workspaceRoot: '/repo' }))
      .toEqual({ ok: true, effective: 'read' })
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'workspace-write', workspaceRoot: '/repo' }))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    // Full access is strictly wider than read, so it is a drift too.
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'danger-full-access' }))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    expect(verifyLocusLivePolicy({ permission: read }, undefined))
      .toMatchObject({ ok: false, reason: 'policy-unavailable' })
  })

  it('derives write authority from the live mode being full access', () => {
    // `write` means full access by explicit owner decision (ADR-0005): a locus
    // child's cwd is fixed to its parent's cwd, so `workspace-write` — whose
    // boundary IS that cwd — can never cover the sibling worktrees the owner
    // actually works in.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }))
      .toEqual({ ok: true, effective: 'write' })
  })

  it('never accepts a narrower live mode for write', () => {
    for (const mode of ['read-only', 'workspace-write']) {
      expect(verifyLocusLivePolicy({ permission: write }, { mode, workspaceRoot: '/repo' }))
        .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    }
    expect(verifyLocusLivePolicy({ permission: write }, undefined))
      .toMatchObject({ ok: false, reason: 'policy-unavailable' })
  })

  it('does not let an execution root decide the grant either way', () => {
    // Intent used to be mandatory and the root had to equal the live workspace
    // root; that rule was unreachable in practice (nothing could set a usable
    // root) and wrong for worktree workflows. The anchor is now context only.
    for (const contextAnchor of [
      undefined,
      { status: 'unknown' as const, executionRoot: '/repo' },
      { status: 'confirmed' as const },
      confirmed('/repo'),
      confirmed('/repo-sibling'),
      { ...confirmed('/repo'), authorization: 'unauthorized' as const },
    ]) {
      expect(verifyLocusLivePolicy(
        { permission: write, ...(contextAnchor === undefined ? {} : { contextAnchor }) },
        { mode: 'danger-full-access', workspaceRoot: '/repo' },
      )).toEqual({ ok: true, effective: 'write' })
    }
  })

  it('reports drift without a workspace root, because full access has none', () => {
    // A deployment that reports no workspace root is not a write blocker any
    // more; only the mode decides.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }))
      .toEqual({ ok: true, effective: 'write' })
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'read-only' }))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
  })

  it('keeps the runtime read-back path free of any root reasoning', () => {
    // Guards against reintroducing a directory boundary into the write
    // decision: a wide root with a narrow mode must still be refused, and a
    // full-access mode must be accepted regardless of the reported root.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'workspace-write', workspaceRoot: '/' }))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access', workspaceRoot: '/' }))
      .toEqual({ ok: true, effective: 'write' })
  })
})
