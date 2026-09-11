import { describe, expect, it, vi } from 'vitest'
import { LocusRepository } from '../src/host/locus/repository.js'
import { LocusRepository as DurableLocusRepository } from '../src/host/locus/persistence.js'
import { openPetHarness } from './harness.js'
import {
  createLocusPermissionMutation,
  LocusPermissionMutationError,
} from '../src/host/locus/permission-mutation.js'

function activeRepository() {
  const repository = new LocusRepository()
  repository.ensureLocus({
    id: 'locus-current',
    endpoint: { chatId: 'oc_scope' },
    workspaceId: 'workspace-a',
    parentSessionId: 'session-parent',
    childSessionId: 'session-child',
    source: 'auto',
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    contextAnchor: {
      status: 'confirmed',
      authorization: 'authorized',
      executionRoot: '/repo',
      provenance: 'host:test',
      confirmedAt: 1,
    },
    state: 'active',
    createdAt: 1,
  })
  return repository
}

function harness(options: {
  resolvedId?: string
  afterApply?: (mode: string) => string
  applyError?: Error
  pending?: boolean
} = {}) {
  const repository = activeRepository()
  let effective = 'read-only'
  const apply = vi.fn((_session: { id: string }, mode: string) => {
    if (options.applyError !== undefined) throw options.applyError
    effective = options.afterApply?.(mode) ?? mode
  })
  const resolve = vi.fn(() => ({ mode: effective, workspaceRoot: '/repo' }))
  const mutation = createLocusPermissionMutation({
    repository: {
      getLocus: id => repository.getLocus(id),
      getCurrentLocus: endpoint => repository.getCurrent(endpoint),
      getLocusByChild: child => repository.getLocusByChild(child),
      hasPendingDeliveries: () => options.pending === true,
      beginPermissionMutation: (id, now) => repository.beginPermissionMutation(id, now),
      abortPermissionMutation: (id, now) => repository.abortPermissionMutation(id, now),
      commitPermissionMutation: (id, permission, now) =>
        repository.commitPermissionMutation(id, permission, now),
    },
    sessions: {
      resolve: () => ({ id: options.resolvedId ?? 'session-child' }),
    },
    policy: { apply, resolve },
    now: () => 10,
  })
  return { repository, mutation, apply, resolve, effective: () => effective }
}

describe('locus permission mutation', () => {
  it('applies and reads back exact child policy before persisting write', async () => {
    const { repository, mutation, apply, resolve } = harness()
    const next = await mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' })

    expect(apply).toHaveBeenCalledWith({ id: 'session-child' }, 'workspace-write')
    expect(resolve).toHaveBeenCalledWith({ id: 'session-child' })
    expect(next.permission).toMatchObject({ desired: 'write', effective: 'write', grantedBy: 'ou-owner', verifiedAt: 10 })
    expect(repository.getLocus('locus-current')?.permission.effective).toBe('write')
  })

  it('fails closed before Host policy mutation when Delivery is pending', async () => {
    const { repository, mutation, apply } = harness({ pending: true })
    await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
      .rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    expect(apply).not.toHaveBeenCalled()
    expect(repository.getLocus('locus-current')?.permission.effective).toBe('read')
  })

  it('requires the exact child session identity', async () => {
    const { repository, mutation, apply } = harness({ resolvedId: 'session-sibling' })
    await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
      .rejects.toMatchObject({ code: 'CHILD_SESSION_UNAVAILABLE' })
    expect(apply).not.toHaveBeenCalled()
    expect(repository.getLocus('locus-current')?.permission.effective).toBe('read')
  })

  it('rejects unsupported write, restores read-only, and never persists desired write', async () => {
    const { repository, mutation, apply, effective } = harness({
      afterApply: mode => mode === 'workspace-write' ? 'read-only' : mode,
    })
    await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
      .rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })

    expect(apply.mock.calls.map(call => call[1])).toEqual(['workspace-write', 'read-only'])
    expect(effective()).toBe('read-only')
    expect(repository.getLocus('locus-current')?.permission).toMatchObject({ desired: 'read', effective: 'read' })
  })

  it.each([
    {
      name: 'authorization unknown',
      anchor: { status: 'confirmed' as const, authorization: 'unknown' as const, executionRoot: '/repo', provenance: 'owner:ou-owner' },
      workspaceRoot: '/repo',
    },
    {
      name: 'missing execution root',
      anchor: { status: 'confirmed' as const, authorization: 'authorized' as const, provenance: 'host:test' },
      workspaceRoot: '/repo',
    },
    {
      name: 'non-Host authorized root',
      anchor: { status: 'confirmed' as const, authorization: 'authorized' as const, executionRoot: '/repo', provenance: 'owner:ou-owner' },
      workspaceRoot: '/repo',
    },
    {
      name: 'canonical root mismatch',
      anchor: { status: 'confirmed' as const, authorization: 'authorized' as const, executionRoot: '/repo', provenance: 'host:test' },
      workspaceRoot: '/repo-sibling',
    },
  ])('rejects write for $name and rolls the live policy back to read', async ({ anchor, workspaceRoot }) => {
    const repository = new LocusRepository()
    repository.ensureLocus({
      id: 'locus-current', endpoint: { chatId: 'oc_scope' }, workspaceId: 'workspace-a',
      parentSessionId: 'session-parent', childSessionId: 'session-child', source: 'auto',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      contextAnchor: anchor, state: 'active', createdAt: 1,
    })
    let effective = 'read-only'
    const apply = vi.fn((_session: { id: string }, mode: string) => { effective = mode })
    const mutation = createLocusPermissionMutation({
      repository: {
        getLocus: id => repository.getLocus(id),
        getCurrentLocus: endpoint => repository.getCurrent(endpoint),
        getLocusByChild: child => repository.getLocusByChild(child),
        beginPermissionMutation: (id, now) => repository.beginPermissionMutation(id, now),
        abortPermissionMutation: (id, now) => repository.abortPermissionMutation(id, now),
        commitPermissionMutation: (id, permission, now) => repository.commitPermissionMutation(id, permission, now),
      },
      sessions: { resolve: () => ({ id: 'session-child' }) },
      policy: { apply, resolve: () => ({ mode: effective, workspaceRoot }) },
      now: () => 10,
    })

    await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
      .rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })
    expect(apply.mock.calls.map(call => call[1])).toEqual(['workspace-write', 'read-only'])
    expect(effective).toBe('read-only')
    expect(repository.getLocus('locus-current')?.permission.effective).toBe('read')
  })

  it('does not persist when setSandboxMode fails', async () => {
    const { repository, mutation } = harness({ applyError: new Error('policy denied') })
    await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
      .rejects.toMatchObject({ code: 'POLICY_APPLY_FAILED' })
    expect(repository.getLocus('locus-current')?.permission.effective).toBe('read')
  })

  it('restores the previous policy if durable permission commit races or fails', async () => {
    const repository = activeRepository()
    let effective = 'read-only'
    const apply = vi.fn((_session: { id: string }, mode: string) => { effective = mode })
    const mutation = createLocusPermissionMutation({
      repository: {
        getLocus: id => repository.getLocus(id),
        getCurrentLocus: endpoint => repository.getCurrent(endpoint),
        getLocusByChild: child => repository.getLocusByChild(child),
        beginPermissionMutation: (id, now) => repository.beginPermissionMutation(id, now),
        abortPermissionMutation: (id, now) => repository.abortPermissionMutation(id, now),
        commitPermissionMutation: async () => { throw new Error('revision raced') },
      },
      sessions: { resolve: () => ({ id: 'session-child' }) },
      policy: { apply, resolve: () => ({ mode: effective, workspaceRoot: '/repo' }) },
      now: () => 10,
    })

    await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
      .rejects.toBeInstanceOf(LocusPermissionMutationError)
    expect(apply.mock.calls.map(call => call[1])).toEqual(['workspace-write', 'read-only'])
    expect(effective).toBe('read-only')
    expect(repository.getLocus('locus-current')?.permission.effective).toBe('read')
  })

  it.each([
    { from: 'read' as const, to: 'write' as const, initial: 'read-only', requested: 'workspace-write' },
    { from: 'write' as const, to: 'read' as const, initial: 'workspace-write', requested: 'read-only' },
  ])('durably pauses Delivery intake during $from → $to Host policy I/O', async ({ from, to, initial, requested }) => {
    const storage = await openPetHarness()
    const repository = new DurableLocusRepository(storage.domain)
    const seed = activeRepository().getLocus('locus-current')!
    await repository.putLocus({
      ...seed,
      permission: {
        desired: from,
        effective: from,
        ...(from === 'write' ? { verifiedAt: 1, grantedBy: 'ou-owner' } : { verifiedAt: 1 }),
      },
    })
    let effective = initial
    let release!: () => void
    const applying = new Promise<void>(resolve => { release = resolve })
    const apply = vi.fn(async (_session: { id: string }, mode: string) => {
      effective = mode
      await applying
    })
    const mutation = createLocusPermissionMutation({
      repository,
      sessions: { resolve: () => ({ id: 'session-child' }) },
      policy: { apply, resolve: () => ({ mode: effective, workspaceRoot: '/repo' }) },
      now: () => 20,
    })

    const pending = mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: to })
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith({ id: 'session-child' }, requested))
    expect(repository.getLocus('locus-current')?.state).toBe('switching')
    await expect(repository.acceptDelivery({
      endpoint: seed.endpoint,
      locusId: seed.id,
      generation: seed.generation,
      childSessionId: seed.childSessionId!,
      messageId: `message-during-${from}-${to}`,
      senderOpenId: 'ou-sender',
      acceptedAt: 20,
    })).rejects.toMatchObject({ code: 'LOCUS_INVALID' })
    expect(repository.listDeliveries(seed.id)).toHaveLength(0)

    release()
    await expect(pending).resolves.toMatchObject({
      state: 'active',
      permission: { desired: to, effective: to },
    })
    await storage.close()
  })

  it('persists permission and append-only audit only after Host verification', async () => {
    const storage = await openPetHarness()
    const repository = new DurableLocusRepository(storage.domain)
    await repository.putLocus(activeRepository().getLocus('locus-current')!)
    let effective = 'read-only'
    const mutation = createLocusPermissionMutation({
      repository,
      sessions: { resolve: () => ({ id: 'session-child' }) },
      policy: {
        apply: (_session, mode) => { effective = mode },
        resolve: () => ({ mode: effective, workspaceRoot: '/repo' }),
      },
      now: () => 20,
    })

    await mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' })
    expect(repository.getLocus('locus-current')?.permission).toMatchObject({
      desired: 'write', effective: 'write', grantedBy: 'ou-owner', verifiedAt: 20,
    })
    expect(repository.listPermissionAudit('locus-current', 1)).toEqual([
      expect.objectContaining({ desired: 'write', effective: 'write', grantedBy: 'ou-owner', verifiedAt: 20 }),
    ])
    await storage.close()
  })

  it('never accepts unrestricted or danger-full-access as a verified mode', async () => {
    for (const resolvedMode of ['unrestricted', 'danger-full-access']) {
      const { repository, mutation } = harness({
        afterApply: mode => mode === 'workspace-write' ? resolvedMode : mode,
      })
      await expect(mutation.mutate({ locusId: 'locus-current', actorId: 'ou-owner', mode: 'write' }))
        .rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })
      expect(repository.getLocus('locus-current')?.permission.effective).toBe('read')
    }
  })
})
