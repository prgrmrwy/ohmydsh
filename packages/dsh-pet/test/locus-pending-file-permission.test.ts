import { describe, expect, it, vi } from 'vitest'
import { buildLocusRecord, withLocusPermission, type LocusPermissionMode, type LocusRecord } from '../src/host/locus/aggregate.js'
import { composeLocusChild, LOCUS_CALLER_BOUND_TOOLS, LOCUS_SAFE_TOOL_NAMES, type LocusChildComposition, type LocusChildPermission } from '../src/host/locus/composition.js'
import { resolveLocusPendingApplication } from '../src/host/locus/pending-application.js'
import { verifyLocusPersistedPolicy } from '../src/host/locus/policy-verification.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import { petLocusPermission, petLocusRecord } from '../src/host/spec.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { createLocusPermissionMutation } from '../src/host/locus/permission-mutation.js'
import { emptyMedium, openPetHarness } from './harness.js'

const active = (mode: LocusPermissionMode) => buildLocusRecord({
  id: 'pending-file', endpoint: { chatId: 'oc-pending-file' }, generation: 1,
  parentSessionId: 'locus-main', childSessionId: 'child-file', workspaceId: 'workspace',
  source: 'explicit', state: 'active', childComposition: 'tier3', createdAt: 1,
  permission: { desired: mode, effective: mode, verifiedAt: 5, grantedBy: 'original-owner' },
})

function releasedMutation(repository: LocusRepository, writeEnabled = true) {
  const apply = vi.fn()
  const resolve = vi.fn()
  return {
    apply, resolve,
    mutation: createLocusPermissionMutation({
      repository, writeEnabled, now: () => 10,
      sessions: { resolve: () => undefined },
      policy: { apply, resolve },
    }),
  }
}

function compose(row: LocusRecord, readback: (applied: LocusChildPermission[]) => LocusChildPermission | undefined) {
  const applied: LocusChildPermission[] = []
  const composition: LocusChildComposition = {
    locusId: row.id, generation: row.generation, parentSessionId: row.parentSessionId,
    childSessionId: row.childSessionId!, revision: row.revision ?? 0,
    ...(row.childComposition === undefined ? {} : { childComposition: row.childComposition }), endpoint: row.endpoint,
    permission: row.permission.effective,
    ...(row.permission.desired === row.permission.effective ? {} : { pendingPermission: row.permission.desired }),
  }
  const run = () => composeLocusChild({ id: row.childSessionId!, scope: { get: () => ({}) } }, {
    lookup: { find: () => composition }, parentPreset: () => LOCUS_BASE_PRESET, writeEnabled: true,
    surface: {
      install: () => {}, setToolTier: () => {}, installOutboundGuard: () => {},
      visibleTools: () => [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS],
    },
    policy: { apply: (_id, permission) => { applied.push(permission) }, resolve: () => readback(applied) },
  })
  return { run, applied }
}

describe('durable released-child file permission protocol', () => {
  it.each([
    { from: 'read' as const, to: 'write' as const },
    { from: 'write' as const, to: 'read' as const },
  ])('records $from → $to without changing effective permission, including across reopen', async ({ from, to }) => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    let recorded
    try {
      const repository = new LocusRepository(h.domain)
      const initial = await repository.putLocus(active(from))
      const w = releasedMutation(repository)
      recorded = await w.mutation.mutate({ locusId: initial.id, actorId: 'request-owner', mode: to })
      expect(recorded).toMatchObject({
        state: 'active', childSessionId: initial.childSessionId, generation: initial.generation,
        permission: { desired: to, effective: from, verifiedAt: 5, grantedBy: 'request-owner' },
      })
      expect(w.apply).not.toHaveBeenCalled()
      expect(w.resolve).not.toHaveBeenCalled()
      expect(buildLocusRecord(recorded).permission).toEqual(recorded.permission)
      expect(petLocusRecord.safeParse(recorded).success).toBe(true)
      expect(verifyLocusPersistedPolicy(recorded, true)).toEqual({ ok: true, effective: from })
    } finally { await h.close() }

    const reopened = await openPetHarness(medium)
    try {
      expect(new LocusRepository(reopened.domain).getLocus(recorded!.id)).toEqual(recorded)
    } finally { await reopened.close() }
  })

  it.each([
    { from: 'write' as const, to: 'read' as const, success: true },
    { from: 'write' as const, to: 'read' as const, success: false },
    { from: 'read' as const, to: 'write' as const, success: true },
    { from: 'read' as const, to: 'write' as const, success: false },
  ])('resolves pending $from → $to with readback success=$success and audits the actual outcome', async ({ from, to, success }) => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    try {
      const repository = new LocusRepository(h.domain)
      const initial = await repository.putLocus(active(from))
      await releasedMutation(repository).mutation.mutate({ locusId: initial.id, actorId: 'request-owner', mode: to })
    } finally { await h.close() }

    const reopened = await openPetHarness(medium)
    try {
      const repository = new LocusRepository(reopened.domain)
      const pending = repository.getLocus('pending-file')!
      const wake = await repository.acceptDelivery({
        locusId: pending.id, generation: pending.generation, endpoint: pending.endpoint,
        childSessionId: pending.childSessionId!, messageId: 'wake', senderOpenId: 'owner', acceptedAt: 20,
      })
      await repository.claimCurrentDelivery({ correlation: wake.record, now: 21 })
      const before = repository.getLocus(pending.id)!
      const delivery = repository.getDelivery(wake.record.deliveryId)
      const w = compose(before, applied => success ? applied.at(-1) : from)
      const result = w.run()
      expect(result.composed).toBe(true)
      if (!result.composed || result.pending === undefined) throw new Error('pending outcome missing')
      const notices: string[] = []
      await resolveLocusPendingApplication({
        repository, now: () => 30, notify: ({ text }) => { notices.push(text) },
      }, result.composition, result.pending)
      const effective = success ? to : from
      expect(w.applied).toEqual(success ? [to] : [to, from])
      expect(repository.getLocus(pending.id)).toMatchObject({
        childSessionId: before.childSessionId, generation: before.generation, state: 'active', busy: before.busy,
        permission: { desired: effective, effective, verifiedAt: 30, grantedBy: 'request-owner' },
      })
      expect(repository.getDelivery(wake.record.deliveryId)).toEqual(delivery)
      expect(repository.listPermissionAudit(pending.id, 1)).toEqual([
        expect.objectContaining({ desired: to, effective: from, grantedBy: 'request-owner', verifiedAt: 5 }),
        expect.objectContaining({ desired: to, effective, grantedBy: 'request-owner', verifiedAt: 30 }),
      ])
      expect(notices).toHaveLength(1)
      expect(notices[0]).toContain(success ? `应用并核验为 ${to}` : `原权限 ${from}`)
      if (!success) expect(notices[0]).toContain('待应用变更已清除')
      const again = compose(repository.getLocus(pending.id)!, applied => applied.at(-1))
      expect(again.run()).not.toHaveProperty('pending')
      expect(again.applied).toEqual([effective])
    } finally { await reopened.close() }
  })

  it('records a revoke with the global write switch off and refuses a later grant without replacing it', async () => {
    const h = await openPetHarness()
    try {
      const repository = new LocusRepository(h.domain)
      const initial = await repository.putLocus(active('write'))
      const w = releasedMutation(repository, false)
      const pending = await w.mutation.mutate({ locusId: initial.id, actorId: 'revoke-owner', mode: 'read' })
      await expect(w.mutation.mutate({ locusId: initial.id, actorId: 'later-owner', mode: 'write' }))
        .rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })
      expect(repository.getLocus(initial.id)?.permission).toEqual(pending.permission)
      expect(repository.listPermissionAudit(initial.id, 1)).toHaveLength(1)
      expect(w.apply).not.toHaveBeenCalled()
    } finally { await h.close() }
  })

  it('a later read/write request replaces only the unapplied target, not the verified effective value', async () => {
    const h = await openPetHarness()
    try {
      const repository = new LocusRepository(h.domain)
      const initial = await repository.putLocus(active('write'))
      const w = releasedMutation(repository)
      await w.mutation.mutate({ locusId: initial.id, actorId: 'revoke-owner', mode: 'read' })
      const restored = await w.mutation.mutate({ locusId: initial.id, actorId: 'later-owner', mode: 'write' })
      expect(restored.permission).toEqual({ desired: 'write', effective: 'write', verifiedAt: 5, grantedBy: 'later-owner' })
      expect(w.apply).not.toHaveBeenCalled()
      expect(compose(restored, applied => applied.at(-1)).run()).not.toHaveProperty('pending')
    } finally { await h.close() }
  })

  it('does not publish or resolve when neither requested read nor original write can be verified', async () => {
    const h = await openPetHarness()
    try {
      const repository = new LocusRepository(h.domain)
      const initial = await repository.putLocus(active('write'))
      const pending = await releasedMutation(repository).mutation.mutate({ locusId: initial.id, actorId: 'owner', mode: 'read' })
      const w = compose(pending, applied => applied.at(-1) === 'read' ? 'write' : 'read')
      expect(w.run).toThrow('Host resolved')
      expect(w.applied).toEqual(['read', 'write'])
      expect(repository.getLocus(pending.id)).toEqual(pending)
      expect(repository.listPermissionAudit(pending.id, 1)).toHaveLength(1)
    } finally { await h.close() }
  })

  it.each(['safe-v1', 'safe-v2', undefined] as const)('keeps legacy %s write/read pairs fail-closed', async marker => {
    const { childComposition: _marker, ...base } = active('write')
    const row: LocusRecord = { ...base, ...(marker === undefined ? {} : { childComposition: marker }) }
    const permission = { ...row.permission, desired: 'read' as const }
    expect(() => buildLocusRecord({ ...row, permission })).toThrow()
    expect(() => withLocusPermission(row, permission, 10)).toThrow()
    expect(petLocusRecord.safeParse({ ...row, permission }).success).toBe(false)
    const h = await openPetHarness()
    try {
      await expect(new LocusRepository(h.domain).putLocus({ ...row, permission })).rejects.toThrow()
    } finally { await h.close() }
  })

  it('cannot turn a verified read row into write through a pending revoke projection', () => {
    const row = active('read')
    expect(() => withLocusPermission(row, { desired: 'read', effective: 'write', verifiedAt: 10 }, 10)).toThrow()
  })

  it('never accepts an effective write without verifiedAt in aggregate, schema, repository or persisted policy', async () => {
    const row = active('write')
    for (const desired of ['read', 'write'] as const) {
      const permission = { desired, effective: 'write' as const, grantedBy: 'owner' }
      expect(() => buildLocusRecord({ ...row, permission })).toThrow()
      expect(() => withLocusPermission(row, permission, 10)).toThrow()
      expect(petLocusPermission.safeParse(permission).success).toBe(false)
      expect(verifyLocusPersistedPolicy({ permission }, true)).toMatchObject({ ok: false })
      const h = await openPetHarness()
      try {
        await expect(new LocusRepository(h.domain).putLocus({ ...row, permission })).rejects.toThrow()
      } finally { await h.close() }
    }
  })

  it('does not mint a verification timestamp when recording a revoke for a malformed write row', async () => {
    let row: LocusRecord = { ...active('write'), permission: { desired: 'write', effective: 'write' } }
    const commit = vi.fn()
    const mutation = createLocusPermissionMutation({
      writeEnabled: true, now: () => 10,
      repository: {
        getLocus: () => row, getCurrentLocus: () => row, getLocusByChild: () => row,
        beginPermissionMutation: () => { row = { ...row, state: 'switching' }; return row },
        abortPermissionMutation: () => { row = { ...row, state: 'active' }; return row }, commitPermissionMutation: commit,
      },
      sessions: { resolve: () => undefined }, policy: { apply: vi.fn(), resolve: vi.fn() },
    })
    await expect(mutation.mutate({ locusId: row.id, actorId: 'owner', mode: 'read' })).rejects.toThrow()
    expect(commit).not.toHaveBeenCalled()
  })
})
