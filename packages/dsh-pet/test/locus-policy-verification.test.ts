import { mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalExecutionRoot, verifyLocusLivePolicy } from '../src/host/locus/policy-verification.js'

const read = { desired: 'read' as const, effective: 'read' as const, verifiedAt: 1 }
const write = { desired: 'write' as const, effective: 'write' as const, verifiedAt: 1, grantedBy: 'host:test' }

/**
 * An anchor exactly as the owner-facing confirm operation persists it:
 * `status: 'confirmed'`, owner provenance, and NO stored authorization.
 * Write authority is derived at verification time from live-root agreement.
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
    expect(verifyLocusLivePolicy({ permission: read }, undefined))
      .toMatchObject({ ok: false, reason: 'policy-unavailable' })
  })

  it('derives write authority from live root agreement, not a stored grant', () => {
    // The owner-facing confirm operation persists exactly this shape. Requiring
    // an additional stored `authorization: 'authorized'` made write
    // unreachable: nothing in the Host ever wrote that value, so every
    // legitimate grant failed closed.
    expect(verifyLocusLivePolicy(
      { permission: write, contextAnchor: confirmed('/repo') },
      { mode: 'workspace-write', workspaceRoot: '/repo' },
    )).toEqual({ ok: true, effective: 'write' })
  })

  it('refuses write without an owner-confirmed root', () => {
    // Intent is still mandatory: agreement alone cannot authorize a root the
    // owner never confirmed.
    for (const anchor of [
      undefined,
      { status: 'unknown' as const, executionRoot: '/repo' },
      { status: 'confirmed' as const },
    ]) {
      expect(verifyLocusLivePolicy(
        { permission: write, ...(anchor === undefined ? {} : { contextAnchor: anchor }) },
        { mode: 'workspace-write', workspaceRoot: '/repo' },
      )).toMatchObject({ ok: false, reason: 'write-root-unauthorized' })
    }
  })

  it('honors an explicit owner revocation over an agreeing root', () => {
    expect(verifyLocusLivePolicy(
      { permission: write, contextAnchor: { ...confirmed('/repo'), authorization: 'unauthorized' } },
      { mode: 'workspace-write', workspaceRoot: '/repo' },
    )).toMatchObject({ ok: false, reason: 'write-root-unauthorized' })
  })

  it('refuses write when the live sandbox reports no workspace root', () => {
    // Without a live root there is no Host derivation to rely on.
    expect(verifyLocusLivePolicy(
      { permission: write, contextAnchor: confirmed('/repo') },
      { mode: 'workspace-write' },
    )).toMatchObject({ ok: false, reason: 'write-root-mismatch' })
  })

  it('requires canonical root equality and rejects a sibling root', () => {
    expect(verifyLocusLivePolicy({ permission: write, contextAnchor: confirmed('/repo') }, {
      mode: 'workspace-write', workspaceRoot: '/repo-sibling',
    })).toMatchObject({ ok: false, reason: 'write-root-mismatch' })
  })

  it('accepts different spellings only when canonical identity is equal', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-pet-policy-'))
    const root = join(base, 'root')
    const link = join(base, 'link')
    await mkdir(root)
    await symlink(root, link)
    expect(canonicalExecutionRoot(link)).toBe(await realpath(root))
    expect(verifyLocusLivePolicy({ permission: write, contextAnchor: confirmed(link) }, {
      mode: 'workspace-write', workspaceRoot: root,
    })).toEqual({ ok: true, effective: 'write' })
  })
})
