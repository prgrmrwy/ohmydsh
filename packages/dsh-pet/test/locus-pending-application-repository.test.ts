import { describe, expect, it } from 'vitest'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'
import { endpointIndexKey, LocusRepository } from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness } from './harness.js'
import { resolveLocusPendingApplication } from '../src/host/locus/pending-application.js'

const pending = () => buildLocusRecord({
  id: 'pending-locus', endpoint: { chatId: 'oc-pending' }, generation: 3,
  parentSessionId: 'locus-main', childSessionId: 'child-pending', workspaceId: 'workspace',
  source: 'explicit', state: 'active', childComposition: 'tier3', createdAt: 1, updatedAt: 10,
  permission: { desired: 'write', effective: 'read', verifiedAt: 5, grantedBy: 'permission-owner' },
  toolTier: { desired: 'shell', effective: 'safe', verifiedAt: 6, grantedBy: 'tier-owner' },
})

function resolution(row: LocusRecord) {
  return {
    locusId: row.id, generation: row.generation, childSessionId: row.childSessionId!,
    expectedRevision: row.revision ?? 0,
    permission: { desired: 'write' as const, effective: 'write' as const, verifiedAt: 30, grantedBy: 'permission-owner' },
    toolTier: { desired: 'shell' as const, effective: 'shell' as const, verifiedAt: 30, grantedBy: 'tier-owner' },
    now: 30,
  }
}

function untouched(row: LocusRecord) {
  const { permission: _p, toolTier: _t, revision: _r, updatedAt: _u, ...rest } = row
  return rest
}

describe('durable pending application resolution', () => {
  it('atomically resolves both requests while the awakening Delivery is current, preserving actors and other facts across reopen', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    const repo = new LocusRepository(h.domain)
    const initial = await repo.putLocus(pending())
    const accepted = await repo.acceptDelivery({
      endpoint: initial.endpoint, locusId: initial.id, generation: initial.generation,
      childSessionId: initial.childSessionId!, messageId: 'wake', senderOpenId: 'owner', acceptedAt: 20,
    })
    await repo.claimCurrentDelivery({ correlation: accepted.record, now: 21 })
    const before = repo.getLocus(initial.id)!
    const delivery = repo.getDelivery(accepted.record.deliveryId)
    const result = await repo.resolvePendingApplication(resolution(before))
    expect(result.permission).toEqual(resolution(before).permission)
    expect(result.toolTier).toEqual(resolution(before).toolTier)
    expect(untouched(result)).toEqual(untouched(before))
    expect(repo.getDelivery(accepted.record.deliveryId)).toEqual(delivery)
    expect(repo.listPermissionAudit(initial.id, 3)).toEqual([
      expect.objectContaining({ desired: 'write', effective: 'write', grantedBy: 'permission-owner' }),
      expect.objectContaining({ toolDesired: 'shell', toolEffective: 'shell', grantedBy: 'tier-owner' }),
    ])
    await h.close()
    const reopened = await openPetHarness(medium)
    try {
      const persisted = new LocusRepository(reopened.domain)
      expect(persisted.getLocus(initial.id)).toEqual(result)
      expect(persisted.listPermissionAudit(initial.id, 3)).toHaveLength(2)
    } finally { await reopened.close() }
  })

  it('discards failed desired values but audits the original request and operator', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      await repo.resolvePendingApplication({
        ...resolution(row),
        permission: { ...resolution(row).permission, desired: 'read', effective: 'read' },
        toolTier: { ...resolution(row).toolTier, desired: 'safe', effective: 'safe' },
      })
      expect(repo.getLocus(row.id)).toMatchObject({
        permission: { desired: 'read', effective: 'read', grantedBy: 'permission-owner' },
        toolTier: { desired: 'safe', effective: 'safe', grantedBy: 'tier-owner' },
      })
      expect(repo.listPermissionAudit(row.id, 3)).toEqual([
        expect.objectContaining({ desired: 'write', effective: 'read', grantedBy: 'permission-owner', refusedReason: expect.any(String) }),
        expect.objectContaining({ toolDesired: 'shell', toolEffective: 'safe', grantedBy: 'tier-owner' }),
      ])
    } finally { await h.close() }
  })

  it('rolls back both settings and all audit rows when the atomic commit fails', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const before = structuredClone(h.medium)
      h.failNextAtomicBatch(2)
      await expect(repo.resolvePendingApplication(resolution(row))).rejects.toThrow('injected atomic write failure')
      expect(repo.getLocus(row.id)).toEqual(row)
      expect(repo.listPermissionAudit(row.id, 3)).toEqual([])
      expect(h.medium).toEqual(before)
    } finally { await h.close() }
  })

  it.each(['generation', 'child', 'not-current', 'stopped', 'changed-permission', 'changed-tier', 'same-values-new-command'] as const)(
    'rejects %s without writing any result or audit', async mismatch => {
      const h = await openPetHarness()
      try {
        const repo = new LocusRepository(h.domain)
        const row = await repo.putLocus(pending())
        const input = resolution(row)
        if (mismatch === 'generation') input.generation += 1
        if (mismatch === 'child') input.childSessionId = 'other-child'
        if (mismatch === 'not-current') await h.domain.table('locus_indexes').delete(endpointIndexKey(row.endpoint))
        if (mismatch === 'stopped') await repo.stopLocus(row.id, 11)
        if (mismatch === 'changed-permission') await repo.setLocusPermission(row.id, { ...row.permission, desired: 'read' }, 11)
        if (mismatch === 'changed-tier' || mismatch === 'same-values-new-command') {
          const begun = await repo.beginToolTierMutation(row.id, 11)
          await repo.commitToolTierMutation(row.id, {
            desired: mismatch === 'changed-tier' ? 'safe' : 'shell', effective: 'safe', verifiedAt: 12, grantedBy: 'later-owner',
          }, 12, { expectedRevision: begun.revision })
        }
        const before = structuredClone(h.medium)
        await expect(repo.resolvePendingApplication(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
        expect(h.medium).toEqual(before)
      } finally { await h.close() }
    },
  )

  it('changes only the supplied setting and rejects unresolved result pairs', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const { toolTier: _tier, ...input } = resolution(row)
      await expect(repo.resolvePendingApplication({ ...input, permission: { ...input.permission, effective: 'read' } }))
        .rejects.toMatchObject({ code: 'INVALID_PERMISSION' })
      const next = await repo.resolvePendingApplication(input)
      expect(next.toolTier).toEqual(row.toolTier)
      expect(untouched(next)).toEqual(untouched(row))
      expect(repo.listPermissionAudit(row.id, 3)).toHaveLength(1)
    } finally { await h.close() }
  })

  it('appends both resolution audits after the earlier grant without replacing its history', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const requested = await repo.setLocusPermission(row.id, row.permission, 20)
      const prior = repo.listPermissionAudit(row.id, 3)
      await repo.resolvePendingApplication(resolution(requested))
      const trail = repo.listPermissionAudit(row.id, 3)
      expect(trail[0]).toEqual(prior[0])
      expect(trail.map(audit => audit.sequence)).toEqual([1, 2, 3])
    } finally { await h.close() }
  })

  it('commits one concurrent resolution and refuses the stale duplicate without another audit', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const results = await Promise.allSettled([
        repo.resolvePendingApplication(resolution(row)), repo.resolvePendingApplication(resolution(row)),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ code: 'REVISION_CONFLICT' }) }),
      ])
      expect(repo.listPermissionAudit(row.id, 3)).toHaveLength(2)
    } finally { await h.close() }
  })

  it('a tier-only resolution leaves the pending file permission intact and keeps the original operator', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const { permission: _permission, ...input } = resolution(row)
      const next = await repo.resolvePendingApplication({ ...input, toolTier: { ...input.toolTier, grantedBy: 'not-the-grantor' } })
      expect(next.permission).toEqual(row.permission)
      expect(next.toolTier).toMatchObject({ desired: 'shell', effective: 'shell', grantedBy: 'tier-owner' })
      expect(repo.listPermissionAudit(row.id, 3)).toEqual([
        expect.objectContaining({ toolDesired: 'shell', toolEffective: 'shell', grantedBy: 'tier-owner' }),
      ])
    } finally { await h.close() }
  })

  it('the real resolver carries the pre-apply revision rather than substituting a newer owner request', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const composition = {
        locusId: row.id, generation: row.generation, parentSessionId: row.parentSessionId,
        childSessionId: row.childSessionId!, revision: row.revision ?? 0,
        permission: 'read' as const, pendingPermission: 'write' as const,
        childComposition: 'tier3' as const, toolTier: { desired: 'shell' as const, effective: 'safe' as const },
        endpoint: row.endpoint,
      }
      const notices: string[] = []
      await repo.setLocusPermission(row.id, { ...row.permission, desired: 'read', grantedBy: 'later-owner' }, 20)
      const before = structuredClone(h.medium)
      await expect(resolveLocusPendingApplication({ repository: repo, now: () => 30, notify: ({ text }) => { notices.push(text) } }, composition, {
        permission: { requested: 'write', effective: 'write', applied: true },
      })).rejects.toMatchObject({ code: 'pending-resolution-not-persisted' })
      expect(h.medium).toEqual(before)
      expect(notices).toEqual([])
    } finally { await h.close() }
  })

  it('the real resolver persists a failed request with its original actor and clears only that pending value', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const notices: string[] = []
      await resolveLocusPendingApplication({ repository: repo, now: () => 30, notify: ({ text }) => { notices.push(text) } }, {
        locusId: row.id, generation: row.generation, parentSessionId: row.parentSessionId,
        childSessionId: row.childSessionId!, revision: row.revision ?? 0,
        permission: 'read', pendingPermission: 'write', childComposition: 'tier3', endpoint: row.endpoint,
      }, { permission: { requested: 'write', effective: 'read', applied: false, reason: 'readback mismatch' } })
      expect(repo.getLocus(row.id)).toMatchObject({ permission: { desired: 'read', effective: 'read', grantedBy: 'permission-owner' } })
      expect(repo.getLocus(row.id)?.toolTier).toEqual(row.toolTier)
      expect(repo.listPermissionAudit(row.id, 3)).toEqual([
        expect.objectContaining({ desired: 'write', effective: 'read', grantedBy: 'permission-owner' }),
      ])
      expect(notices).toHaveLength(1)
      expect(notices[0]).toContain('readback mismatch')
    } finally { await h.close() }
  })

  it('a pending resolution without its pre-apply revision never reaches the repository', async () => {
    const h = await openPetHarness()
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const before = structuredClone(h.medium)
      await expect(resolveLocusPendingApplication({ repository: repo, now: () => 30, notify: () => { throw new Error('must not notify') } }, {
        locusId: row.id, generation: row.generation, parentSessionId: row.parentSessionId,
        childSessionId: row.childSessionId!, permission: 'read', pendingPermission: 'write', childComposition: 'tier3',
      }, { permission: { requested: 'write', effective: 'write', applied: true } })).rejects.toMatchObject({ code: 'pending-resolution-not-persisted' })
      expect(h.medium).toEqual(before)
    } finally { await h.close() }
  })

  it('refuses a non-transactional medium without attempting fallback writes', async () => {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    try {
      const repo = new LocusRepository(h.domain)
      const row = await repo.putLocus(pending())
      const before = structuredClone(h.medium)
      await expect(repo.resolvePendingApplication(resolution(row))).rejects.toThrow()
      expect(h.medium).toEqual(before)
    } finally { await h.close() }
  })
})
