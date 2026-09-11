import { mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalExecutionRoot, verifyLocusLivePolicy } from '../src/host/locus/policy-verification.js'

const read = { desired: 'read' as const, effective: 'read' as const, verifiedAt: 1 }
const write = { desired: 'write' as const, effective: 'write' as const, verifiedAt: 1, grantedBy: 'host:test' }

function authorized(executionRoot: string) {
  return {
    status: 'confirmed' as const,
    authorization: 'authorized' as const,
    executionRoot,
    provenance: 'host:sandbox-policy',
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

  it('rejects owner-confirmed or authorization-unknown roots for write', () => {
    expect(verifyLocusLivePolicy({
      permission: write,
      contextAnchor: { ...authorized('/repo'), authorization: 'unknown', provenance: 'owner:ou-owner' },
    }, { mode: 'workspace-write', workspaceRoot: '/repo' }))
      .toMatchObject({ ok: false, reason: 'write-root-unauthorized' })
  })

  it('requires canonical root equality and rejects a sibling root', () => {
    expect(verifyLocusLivePolicy({ permission: write, contextAnchor: authorized('/repo') }, {
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
    expect(verifyLocusLivePolicy({ permission: write, contextAnchor: authorized(link) }, {
      mode: 'workspace-write', workspaceRoot: root,
    })).toEqual({ ok: true, effective: 'write' })
  })
})
