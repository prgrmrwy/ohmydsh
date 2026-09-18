import { describe, expect, it } from 'vitest'
import {
  LOCUS_WRITE_DISABLED_DIAGNOSTIC,
  LOCUS_WRITE_ENABLED,
  verifyLocusLivePolicy,
} from '../src/host/locus/policy-verification.js'

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
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'read-only', workspaceRoot: '/repo' }, true))
      .toEqual({ ok: true, effective: 'read' })
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'workspace-write', workspaceRoot: '/repo' }, true))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    // Full access is strictly wider than read, so it is a drift too.
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'danger-full-access' }, true))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    expect(verifyLocusLivePolicy({ permission: read }, undefined, true))
      .toMatchObject({ ok: false, reason: 'policy-unavailable' })
  })

  it('derives write authority from the live mode being full access', () => {
    // `write` means full access by explicit owner decision (ADR-0005): a locus
    // child's cwd is fixed to its parent's cwd, so `workspace-write` — whose
    // boundary IS that cwd — can never cover the sibling worktrees the owner
    // actually works in.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }, true))
      .toEqual({ ok: true, effective: 'write' })
  })

  it('never accepts a narrower live mode for write', () => {
    for (const mode of ['read-only', 'workspace-write']) {
      expect(verifyLocusLivePolicy({ permission: write }, { mode, workspaceRoot: '/repo' }, true))
        .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    }
    expect(verifyLocusLivePolicy({ permission: write }, undefined, true))
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
        true,
      )).toEqual({ ok: true, effective: 'write' })
    }
  })

  it('reports drift without a workspace root, because full access has none', () => {
    // A deployment that reports no workspace root is not a write blocker any
    // more; only the mode decides.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }, true))
      .toEqual({ ok: true, effective: 'write' })
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'read-only' }, true))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
  })

  it('keeps the runtime read-back path free of any root reasoning', () => {
    // Guards against reintroducing a directory boundary into the write
    // decision: a wide root with a narrow mode must still be refused, and a
    // full-access mode must be accepted regardless of the reported root.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'workspace-write', workspaceRoot: '/' }, true))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access', workspaceRoot: '/' }, true))
      .toEqual({ ok: true, effective: 'write' })
  })
})

describe('the write master switch (LOCUS_WRITE_ENABLED)', () => {
  const write = { desired: 'write' as const, effective: 'write' as const }
  const read = { desired: 'read' as const, effective: 'read' as const }

  it('ships OFF: concurrent writes have no agreed protocol yet', () => {
    // If this ever reads `true` without a concurrency protocol landing first,
    // that is the regression — several locus children share one checkout and
    // `write` is full access (ADR-0005).
    expect(LOCUS_WRITE_ENABLED).toBe(false)
  })

  it('demotes a stored write grant to read instead of reporting the stored intent', () => {
    // The durable record still says `write` — the owner's intent is kept, not
    // rewritten — but what is IN FORCE is read, and that is what callers get.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'read-only' }, false))
      .toEqual({ ok: true, effective: 'read' })
  })

  it('keeps a demoted entry SERVING, not suspended', () => {
    // A demoted locus must go on answering read-only work; failing it closed
    // would take the entry offline for holding a grant it never chose to lose.
    const result = verifyLocusLivePolicy({ permission: write }, { mode: 'read-only' }, false)
    expect(result.ok).toBe(true)
  })

  it('names the real reason when the child still sits in full access', () => {
    // Not a `mode-mismatch`: the switch is doing this, and a mismatch would
    // read as a host fault the owner is supposed to fix.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }, false))
      .toMatchObject({ ok: false, reason: 'write-disabled' })
  })

  it('explains itself in the diagnostic rather than just refusing', () => {
    const result = verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }, false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic).toBe(LOCUS_WRITE_DISABLED_DIAGNOSTIC)
    expect(result.diagnostic).toContain('并发写')
  })

  it('leaves read-only loci completely untouched', () => {
    expect(verifyLocusLivePolicy({ permission: read }, { mode: 'read-only' }, false))
      .toEqual({ ok: true, effective: 'read' })
  })

  it('restores the write path exactly when flipped back on', () => {
    // Proves the mechanism is intact behind the switch: re-enabling is a
    // one-line change, not a rewrite.
    expect(verifyLocusLivePolicy({ permission: write }, { mode: 'danger-full-access' }, true))
      .toEqual({ ok: true, effective: 'write' })
  })
})
