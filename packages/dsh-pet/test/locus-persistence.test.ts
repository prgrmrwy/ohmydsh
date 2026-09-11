import { describe, expect, it } from 'vitest'
import { buildLocusRecord, endpointKeyOf, type LocusRecord } from '../src/host/locus/aggregate.js'
import { PET_DOMAIN_VERSION, petLocusRecord, type PetLocusOperation } from '../src/host/spec.js'
import {
  childIndexKey,
  defaultQaIndexKey,
  endpointIndexKey,
  LocusRepository as DurableLocusRepository,
  parentIndexKey,
} from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness, type MemoryMedium } from './harness.js'

function enableAtomicTransactions(harness: Awaited<ReturnType<typeof openPetHarness>>): void {
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: string, key: string, value: unknown): void
      delete(table: string, key: string): void
    }) => void) => Promise<void>
    table(name: string): {
      get(key: string): unknown
      put(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<boolean>
    }
  }
  Object.defineProperty(domain, 'supportsTransaction', { value: true, configurable: true })
  domain.transaction = async body => {
    const writes: Array<{ kind: 'put' | 'delete'; table: string; key: string; value?: unknown }> = []
    body({
      put: (table, key, value) => { writes.push({ kind: 'put', table, key, value }) },
      delete: (table, key) => { writes.push({ kind: 'delete', table, key }) },
    })
    for (const write of writes) {
      if (write.kind === 'delete') await domain.table(write.table).delete(write.key)
      else await domain.table(write.table).put(write.key, write.value)
    }
  }
}

function record(overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): LocusRecord {
  return buildLocusRecord({
    id: 'locus-group',
    endpoint: { chatId: 'oc_project' },
    parentSessionId: 'session-main',
    childSessionId: 'child-group',
    workspaceId: 'workspace-main',
    source: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  })
}

async function reopen(medium: MemoryMedium) {
  return openPetHarness(medium)
}

describe('durable unified locus repository', () => {
  it('round-trips an explicit context anchor and keeps it separate from permission', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const anchored = await repository.putLocus(record({
      contextAnchor: {
        status: 'confirmed',
        executionRoot: '/repo/project',
        constraints: ['read source', 'no unrestricted writes'],
        provenance: 'host-confirmed',
        confirmedAt: 12,
      },
    }))
    expect(repository.findContextAnchor({ childSessionId: anchored.childSessionId as string, locusId: anchored.id, generation: anchored.generation })).toEqual({
      status: 'confirmed',
      executionRoot: '/repo/project',
      constraints: ['read source', 'no unrestricted writes'],
      provenance: 'host-confirmed',
      confirmedAt: 12,
    })
    await first.close()
    const second = await reopen(medium)
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.findContextAnchor({ childSessionId: anchored.childSessionId as string, locusId: anchored.id, generation: anchored.generation })).toEqual({
      status: 'confirmed',
      executionRoot: '/repo/project',
      constraints: ['read source', 'no unrestricted writes'],
      provenance: 'host-confirmed',
      confirmedAt: 12,
    })
    await second.close()
  })

  it('persists owner-confirmed anchors without turning paths into authority or routing', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const original = await repository.putLocus(record())

    const anchored = await repository.confirmContextAnchor(
      original.id,
      {
        status: 'confirmed',
        existence: 'exists',
        executionRoot: '/repo/.worktrees/project',
        projectResources: ['https://example.test/prd', 'chat:project-materials'],
        constraints: ['do not create a worktree', 'ask before writes'],
      },
      'owner-1',
      20,
      { expectedGeneration: original.generation, expectedLocusId: original.id },
    )

    expect(anchored).toMatchObject({
      id: original.id,
      endpoint: original.endpoint,
      parentSessionId: original.parentSessionId,
      workspaceId: original.workspaceId,
      permission: original.permission,
      contextAnchor: {
        status: 'confirmed', existence: 'exists', authorization: 'unknown',
        executionRoot: '/repo/.worktrees/project',
        projectResources: ['https://example.test/prd', 'chat:project-materials'],
        constraints: ['do not create a worktree', 'ask before writes'],
        provenance: 'owner:owner-1', confirmedAt: 20,
      },
    })
    await first.close()

    const second = await reopen(medium)
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.getLocus(original.id)?.contextAnchor).toEqual(anchored.contextAnchor)
    await second.close()
  })

  it('rejects stale or busy owner anchor confirmation', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const original = await repository.putLocus(record())
    await expect(repository.confirmContextAnchor(
      original.id,
      { status: 'confirmed', executionRoot: '/repo' },
      'owner-1',
      20,
      { expectedGeneration: original.generation + 1 },
    )).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    const busy = await repository.setLocusBusy(original.id, true, 21)
    await expect(repository.confirmContextAnchor(
      busy.id,
      { status: 'confirmed', executionRoot: '/repo' },
      'owner-1',
    )).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    await harness.close()
  })

  it('persists loci and all reverse indexes across a domain restart', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const group = await repository.putLocus(record({ source: 'qa-created' }))
    const topic = await repository.putLocus(
      record({
        id: 'locus-topic',
        endpoint: { chatId: 'oc_project', threadId: 'omt_topic' },
        parentLocusId: group.id,
        childSessionId: 'child-topic',
        source: 'inherited',
        generation: 1,
      }),
    )
    await repository.setDefaultQaLocus(group.parentSessionId, group.id)

    expect(first.domain.table('locus_indexes').get(endpointIndexKey(group.endpoint))).toMatchObject({
      kind: 'endpoint-current',
      locusIds: [group.id],
    })
    expect(first.domain.table('locus_indexes').get(endpointIndexKey(topic.endpoint))).toMatchObject({
      kind: 'endpoint-current',
      locusIds: [topic.id],
    })
    expect(first.domain.table('locus_indexes').get(parentIndexKey(group.parentSessionId))).toMatchObject({
      kind: 'parent-loci',
      locusIds: [group.id, topic.id],
    })
    expect(first.domain.table('locus_indexes').get(childIndexKey('child-topic'))).toMatchObject({
      kind: 'child-locus',
      locusIds: [topic.id],
    })
    expect(first.domain.table('locus_indexes').get(defaultQaIndexKey(group.parentSessionId))).toMatchObject({
      kind: 'default-qa',
      locusIds: [group.id],
    })
    expect(repository.getLocusByChild('child-topic')).toEqual(topic)
    expect(repository.getDefaultQa(group.parentSessionId)).toEqual(group)
    expect(repository.listOperations().at(-1)?.phase).toBe('committed')
    await first.close()

    const second = await reopen(medium)
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.getCurrentLocus(group.endpoint)).toEqual(group)
    expect(restarted.getCurrentLocus(topic.endpoint)).toEqual(topic)
    expect(restarted.listLociByParent(group.parentSessionId).map(item => item.id)).toEqual([
      group.id,
      topic.id,
    ])
    expect(restarted.getLocusByChild('child-topic')).toEqual(topic)
    expect(restarted.getDefaultQa(group.parentSessionId)).toEqual(group)
    expect(restarted.findByChildSessionId('child-topic')).toEqual([topic])
    await second.close()
  })

  it('keeps historical and current indexes coherent during replacement and retirement', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const original = await repository.putLocus(record())
    const switched = await repository.replaceLocus(
      original.id,
      record({
        id: 'locus-explicit',
        childSessionId: 'child-explicit',
        parentSessionId: 'session-other',
        workspaceId: 'workspace-other',
        source: 'explicit',
      }),
      2,
    )

    expect(switched.previous.state).toBe('retired')
    expect(repository.getCurrentLocus(original.endpoint)).toEqual(switched.current)
    expect(repository.findByChildSessionId('child-group')).toEqual([switched.previous])
    expect(repository.findByChildSessionId('child-explicit')).toEqual([switched.current])
    expect(repository.listLociByParent('session-main').map(item => item.id)).toEqual([original.id])
    expect(repository.listLociByParent('session-other').map(item => item.id)).toEqual([
      switched.current.id,
    ])
    expect(
      harness.domain.table('locus_indexes').get(endpointIndexKey(original.endpoint))?.locusIds,
    ).toEqual([switched.current.id])
    expect(
      harness.domain.table('locus_indexes').get(parentIndexKey('session-main'))?.locusIds,
    ).toEqual([original.id])
    expect(
      harness.domain.table('locus_indexes').get(parentIndexKey('session-other'))?.locusIds,
    ).toEqual([switched.current.id])

    await repository.retireLocus(switched.current.id, 3)
    expect(repository.getCurrentLocus(original.endpoint)).toBeUndefined()
    expect(repository.findByChildSessionId('child-explicit')).toEqual([
      { ...switched.current, state: 'retired', retiredAt: 3, updatedAt: 3, busy: false, revision: (switched.current.revision ?? 0) + 1 },
    ])
    expect(harness.domain.table('locus_indexes').get(endpointIndexKey(original.endpoint))).toBeUndefined()
    await harness.close()
  })

  it('rejects stale lifecycle fences after a serialized mutation', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const fence = {
      expectedLocusId: locus.id,
      expectedGeneration: locus.generation,
      expectedUpdatedAt: locus.updatedAt,
      expectedRevision: locus.revision,
    }

    const first = await repository.setLocusBusy(locus.id, true, 2, fence)
    expect(first.updatedAt).toBe(2)
    expect(first.revision).toBe((locus.revision ?? 0) + 1)
    await expect(repository.setLocusBusy(locus.id, false, 3, fence)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    })
    expect(repository.getLocus(locus.id)).toMatchObject({ busy: true, updatedAt: 2 })
    await harness.close()
  })

  it('applies stale fences to durable permission and stop operations', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const fence = {
      expectedGeneration: locus.generation,
      expectedUpdatedAt: locus.updatedAt,
      expectedRevision: locus.revision,
    }
    const writable = await repository.setLocusPermission(locus.id, {
      desired: 'write',
      effective: 'write',
      verifiedAt: 2,
      grantedBy: 'owner',
    }, 2, fence)
    expect(writable.permission.effective).toBe('write')
    await expect(repository.stopLocus(locus.id, 3, fence)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(repository.retireLocus(locus.id, 3, fence)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(repository.getLocus(locus.id)?.state).toBe('active')
    await harness.close()
  })

  it('records Delivery WAL metadata and compensates a failed partial write', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const locus = await repository.putLocus(record())
    const before = new Set(first.domain.table('locus_operations').keys())
    await repository.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-wal',
      deliveryId: 'delivery-wal',
      senderOpenId: 'ou_sender',
      text: 'wal',
      acceptedAt: 2,
    })
    const operation = repository.listOperations().find(item => !before.has(item.id))
    expect(operation).toMatchObject({ kind: 'delivery', phase: 'committed', newLocusId: locus.id })
    expect(operation?.endpointKey).toBe(endpointKeyOf(locus.endpoint))
    expect(repository.getDelivery('delivery-wal')?.status).toBe('accepted')
    await first.close()
  })

  it('accepts overlapping same-locus messages into one durable FIFO backlog while controls stay busy', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const base = {
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      senderOpenId: 'ou_overlap',
    }

    const [first, second] = await Promise.all([
      repository.acceptDelivery({ ...base, messageId: 'message-overlap-1', deliveryId: 'delivery-overlap-1', acceptedAt: 2 }),
      repository.acceptDelivery({ ...base, messageId: 'message-overlap-2', deliveryId: 'delivery-overlap-2', acceptedAt: 3 }),
    ])

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(false)
    expect(repository.listDeliveries(locus.id).map(item => item.messageId)).toEqual([
      'message-overlap-1',
      'message-overlap-2',
    ])
    expect(repository.getLocus(locus.id)?.busy).toBe(true)
    await expect(repository.retireLocus(locus.id, 4)).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    await expect(repository.setLocusPermission(locus.id, {
      desired: 'write', effective: 'write', verifiedAt: 4, grantedBy: 'owner',
    }, 4)).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    await harness.close()
  })

  it('persists definitive queue failure, releases busy, and accepts a retry message', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const correlation = {
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
    }
    const accepted = await repository.acceptDelivery({
      ...correlation,
      deliveryId: 'delivery-queue-failed',
      messageId: 'message-queue-failed',
      senderOpenId: 'ou_queue_failed',
      acceptedAt: 2,
    })

    await expect(repository.fail({
      deliveryId: accepted.record.deliveryId,
      correlation,
      executionId: 'execution-not-queued',
      reason: 'inbox-failed',
    })).resolves.toBe(true)
    expect(repository.getDelivery(accepted.record.deliveryId)).toMatchObject({
      status: 'failed',
      dispatchFailure: 'not-queued',
      failureReason: 'inbox-failed',
    })
    expect(repository.getDelivery(accepted.record.deliveryId)).not.toHaveProperty('executionId')
    expect(repository.getDelivery(accepted.record.deliveryId)).not.toHaveProperty('turnId')
    expect(repository.getLocus(locus.id)?.busy).toBe(false)

    await expect(repository.acceptDelivery({
      ...correlation,
      deliveryId: 'delivery-queue-retry',
      messageId: 'message-queue-retry',
      senderOpenId: 'ou_queue_failed',
      acceptedAt: 4,
    })).resolves.toMatchObject({ duplicate: false, record: { status: 'accepted' } })
    expect(repository.getLocus(locus.id)?.busy).toBe(true)
    await harness.close()
  })

  it('rejects duplicate inbox message ids and fails closed on corrupt multi-match lookup', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const correlation = {
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
    }
    const first = await repository.acceptDelivery({
      ...correlation, deliveryId: 'delivery-inbox-first', messageId: 'message-inbox-first',
      senderOpenId: 'ou_inbox', acceptedAt: 2,
    })
    const second = await repository.acceptDelivery({
      ...correlation, deliveryId: 'delivery-inbox-second', messageId: 'message-inbox-second',
      senderOpenId: 'ou_inbox', acceptedAt: 3,
    })
    await repository.bindQueued({
      deliveryId: first.record.deliveryId, correlation,
      executionId: 'execution-inbox-first', inboxMessageId: 'inbox-duplicate', queuedAt: 4,
    })
    await expect(repository.bindQueued({
      deliveryId: second.record.deliveryId, correlation,
      executionId: 'execution-inbox-second', inboxMessageId: 'inbox-duplicate', queuedAt: 5,
    })).rejects.toMatchObject({ code: 'INVALID_LOCUS' })
    expect(repository.getDelivery(second.record.deliveryId)?.status).toBe('accepted')

    const corrupt = {
      ...first.record,
      deliveryId: 'delivery-inbox-corrupt',
      messageId: 'message-inbox-corrupt',
      sequence: 99,
      status: 'queued' as const,
      executionId: 'execution-inbox-corrupt',
      inboxMessageId: 'inbox-duplicate',
      queuedAt: 4,
    }
    await harness.domain.table('locus_deliveries').put(corrupt.deliveryId, corrupt)
    expect(() => repository.findDeliveryByInboxMessageId('inbox-duplicate')).toThrowError(
      expect.objectContaining({ code: 'INVALID_LOCUS' }),
    )
    await harness.close()
  })

  it('restores multiple pending proof-free Deliveries and preserves the busy fence', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const pending = {
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      deliveryId: 'delivery-restore',
      messageId: 'message-restore',
      senderOpenId: 'ou_restore',
      sequence: 1,
      status: 'accepted' as const,
      feedbackTarget: { chatId: locus.endpoint.chatId, messageId: 'message-restore' },
    }
    await expect(repository.putDelivery({ ...pending, executionId: 'forged-execution' })).rejects.toMatchObject({
      code: 'INVALID_LOCUS',
    })
    const restored = await repository.putDelivery(pending)
    const secondPending = {
      ...pending,
      deliveryId: 'delivery-restore-second',
      messageId: 'message-restore-second',
      sequence: 2,
      feedbackTarget: { chatId: locus.endpoint.chatId, messageId: 'message-restore-second' },
    }
    const secondRestored = await repository.putDelivery(secondPending)
    expect(restored).toEqual(pending)
    expect(secondRestored).toEqual(secondPending)
    expect(repository.listDeliveries(locus.id).map(item => item.deliveryId)).toEqual([
      'delivery-restore', 'delivery-restore-second',
    ])
    expect(repository.getLocus(locus.id)).toMatchObject({ busy: true })
    await expect(repository.putDelivery({ ...pending, status: 'queued' as const, queuedAt: 1, executionId: undefined })).rejects.toMatchObject({
      code: 'INVALID_LOCUS',
    })
    await harness.close()
  })

  it('publishes a replacement and its endpoint pointer in one transaction', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const original = await repository.putLocus(record())
    await repository.replaceLocus(
      original.id,
      record({
        id: 'locus-next',
        childSessionId: 'child-next',
        parentSessionId: 'session-next',
        workspaceId: 'workspace-next',
        source: 'explicit',
      }),
      2,
    )
    await first.close()

    // Reopening proves the medium itself is coherent: the old generation is
    // retired AND the endpoint points at the new one. A sequence of separate
    // writes could have been interrupted between those two facts.
    const second = await reopen(medium)
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.getLocus(original.id)).toMatchObject({ state: 'retired' })
    expect(restarted.getCurrentLocus(original.endpoint)?.id).toBe('locus-next')
    expect(restarted.getLocusByChild('child-next')?.id).toBe('locus-next')
    // The operation row committed with the records it describes, so recovery
    // has no half-finished operation to reconcile.
    expect(restarted.listOperations().every(item => item.phase === 'committed')).toBe(true)
    await second.close()
  })

  it('leaves no partial state on the medium when a mutation fails', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const original = await repository.putLocus(record())
    await first.close()

    // Fail inside the replacement's commit: without a transaction the old
    // generation could already be retired while its replacement is absent,
    // leaving the endpoint served by nobody.
    const failing = await openPetHarness(medium, { failOnWriteNumber: 2 })
    const failingRepository = new DurableLocusRepository(failing.domain)
    await expect(failingRepository.replaceLocus(
      original.id,
      record({ id: 'locus-lost', childSessionId: 'child-lost', source: 'explicit' }),
      2,
    )).rejects.toThrow()
    await failing.close()

    const reopened = await reopen(medium)
    const restarted = new DurableLocusRepository(reopened.domain)
    expect(restarted.getLocus('locus-lost')).toBeUndefined()
    expect(restarted.getLocus(original.id)).toMatchObject({ state: original.state })
    expect(restarted.getCurrentLocus(original.endpoint)?.id).toBe(original.id)
    await reopened.close()
  })

  it('keeps an append-only permission trail that a later downgrade cannot erase', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const locus = await repository.putLocus(record())

    await repository.setLocusMode(locus.id, 'write', 'ou_owner', 10)
    await repository.setLocusMode(locus.id, 'read', 'ou_owner', 20)
    await first.close()

    // The locus itself now says `read`. Without the trail there would be no
    // way to answer "was write ever granted, by whom, and when".
    const second = await reopen(medium)
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.getLocus(locus.id)?.permission.effective).toBe('read')
    expect(restarted.listPermissionAudit(locus.id, locus.generation)).toEqual([
      expect.objectContaining({ sequence: 1, desired: 'write', effective: 'write', grantedBy: 'ou_owner', verifiedAt: 10 }),
      expect.objectContaining({ sequence: 2, desired: 'read', effective: 'read', grantedBy: 'ou_owner', verifiedAt: 20 }),
    ])
    await second.close()
  })

  it('records a refused escalation instead of leaving it invisible', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())

    // The Host verified only read while the owner asked for write.
    await repository.setLocusPermission(
      locus.id,
      { desired: 'write', effective: 'read', verifiedAt: 30, grantedBy: 'ou_owner' },
      30,
    )

    const trail = repository.listPermissionAudit(locus.id, locus.generation)
    expect(trail).toEqual([
      expect.objectContaining({ desired: 'write', effective: 'read', refusedReason: expect.stringContaining('write') }),
    ])
    // The stored permission must not claim the escalation succeeded.
    expect(repository.getLocus(locus.id)?.permission.effective).toBe('read')
    await harness.close()
  })

  it('does not carry a permission trail across a replaced generation', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const original = await repository.putLocus(record())
    await repository.setLocusMode(original.id, 'write', 'ou_owner', 10)

    const switched = await repository.replaceLocus(
      original.id,
      record({ id: 'locus-next', childSessionId: 'child-next', source: 'explicit' }),
      20,
    )

    // A new generation starts read and owns no inherited grant; the old
    // generation's history stays addressable under its own id.
    expect(repository.listPermissionAudit(switched.current.id, switched.current.generation)).toEqual([])
    expect(repository.listPermissionAudit(original.id, original.generation)).toHaveLength(1)
    expect(switched.current.permission.effective).toBe('read')
    await harness.close()
  })

  it('commits a source switch and the notice it owes in one transaction', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const original = await repository.putLocus(record())

    const switched = await repository.replaceLocus(
      original.id,
      record({
        id: 'locus-s1',
        childSessionId: 'child-s1',
        parentSessionId: 'session-s1',
        workspaceId: 'workspace-s1',
        source: 'explicit',
      }),
      2,
      { text: '当前入口已从 S0 切换到 S1；旧对话历史未自动合并。' },
    )
    await first.close()

    // Reopening proves both facts survived together. A notice recorded after
    // the switch could be lost by a crash in between, and the new source would
    // then answer the entry without ever saying the source changed.
    const second = await reopen(medium)
    const notices = second.domain.table('locus_switch_notices')
    expect([...notices.entries()].map(([, value]) => value)).toEqual([
      expect.objectContaining({
        locusId: switched.current.id,
        generation: switched.current.generation,
        text: '当前入口已从 S0 切换到 S1；旧对话历史未自动合并。',
        attempts: 0,
      }),
    ])
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.getCurrentLocus(original.endpoint)?.id).toBe(switched.current.id)
    await second.close()
  })

  it('leaves neither the switch nor its notice when the commit fails', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const original = await repository.putLocus(record())
    await first.close()

    const failing = await openPetHarness(medium, { failOnWriteNumber: 1 })
    const failingRepository = new DurableLocusRepository(failing.domain)
    await expect(failingRepository.replaceLocus(
      original.id,
      record({ id: 'locus-lost', childSessionId: 'child-lost', source: 'explicit' }),
      2,
      { text: 'never announced' },
    )).rejects.toThrow()
    await failing.close()

    const reopened = await reopen(medium)
    const restarted = new DurableLocusRepository(reopened.domain)
    // All-or-nothing: no orphan notice for a switch that never happened, and
    // no switch without its notice.
    expect(restarted.getLocus('locus-lost')).toBeUndefined()
    expect([...reopened.domain.table('locus_switch_notices').entries()]).toEqual([])
    expect(restarted.getCurrentLocus(original.endpoint)?.id).toBe(original.id)
    await reopened.close()
  })

  it('fails an accepted-but-unqueued Delivery on restart without replay and clears busy', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const firstRepository = new DurableLocusRepository(first.domain)
    const locus = await firstRepository.putLocus(record())
    const accepted = await firstRepository.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-reopen',
      deliveryId: 'delivery-reopen',
      senderOpenId: 'ou_reopen',
      acceptedAt: 2,
    })
    await first.close()

    const second = await reopen(medium)
    enableAtomicTransactions(second)
    const restarted = new DurableLocusRepository(second.domain)
    const report = await restarted.reconcileStartup({ now: 3 })
    expect(report.pendingDeliveries).toEqual([])
    expect(report.failedDeliveries).toEqual([
      expect.objectContaining({
        deliveryId: accepted.record.deliveryId,
        status: 'failed',
        startupDisposition: 'unqueued',
      }),
    ])
    expect(restarted.getDelivery(accepted.record.deliveryId)).toMatchObject({
      status: 'failed',
      startupDisposition: 'unqueued',
    })
    expect(restarted.getLocus(locus.id)).toMatchObject({ busy: false })
    await second.close()
  })

  it('retains a queued Delivery only with exact live-turn proof across restart', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const locus = await repository.putLocus(record())
    const accepted = await repository.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-live',
      deliveryId: 'delivery-live',
      senderOpenId: 'ou_live',
      acceptedAt: 2,
    })
    const correlation = {
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
    }
    await repository.bindQueued({
      deliveryId: accepted.record.deliveryId,
      correlation,
      executionId: 'execution-live',
      inboxMessageId: 'inbox-live',
      queuedAt: 3,
    })
    await first.close()

    const second = await reopen(medium)
    enableAtomicTransactions(second)
    const restarted = new DurableLocusRepository(second.domain)
    const report = await restarted.reconcileStartup({
      now: 4,
      deliveryProof: async delivery => ({
        deliveryId: delivery.deliveryId,
        executionId: 'execution-live',
        turnId: 'turn-live',
        state: 'running',
      }),
    })
    expect(report.failedDeliveries).toEqual([])
    expect(report.retainedDeliveries).toEqual([
      expect.objectContaining({ deliveryId: 'delivery-live', status: 'running', turnId: 'turn-live' }),
    ])
    expect(restarted.getLocus(locus.id)?.busy).toBe(true)

    const repeated = await restarted.reconcileStartup({
      now: 5,
      deliveryProof: async delivery => ({
        deliveryId: delivery.deliveryId,
        executionId: 'execution-live',
        turnId: 'turn-live',
        state: 'running',
      }),
    })
    expect(repeated.retainedDeliveries).toHaveLength(1)
    expect(restarted.getDelivery('delivery-live')).toMatchObject({ status: 'running', turnId: 'turn-live' })
    await second.close()
  })

  it('keeps queued work busy as explicit manual debt when termination is unavailable', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const locus = await repository.putLocus(record())
    const accepted = await repository.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-manual',
      deliveryId: 'delivery-manual',
      senderOpenId: 'ou_manual',
      acceptedAt: 2,
    })
    await repository.bindQueued({
      deliveryId: accepted.record.deliveryId,
      correlation: {
        endpoint: locus.endpoint, locusId: locus.id, generation: locus.generation,
        childSessionId: locus.childSessionId as string,
      },
      executionId: 'execution-manual',
      inboxMessageId: 'inbox-manual',
      queuedAt: 3,
    })
    await first.close()

    const second = await reopen(medium)
    enableAtomicTransactions(second)
    const restarted = new DurableLocusRepository(second.domain)
    const report = await restarted.reconcileStartup({ now: 4 })
    expect(report.manualDeliveries).toEqual([
      expect.objectContaining({ deliveryId: 'delivery-manual', status: 'queued' }),
    ])
    expect(restarted.getDelivery('delivery-manual')?.startupRecoveryDebt).toContain('manual recovery')
    expect(restarted.getLocus(locus.id)?.busy).toBe(true)
    await second.close()
  })

  it('fails queued work after exact termination, invalidates the locus, and never replays', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const locus = await repository.putLocus(record())
    const accepted = await repository.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-terminated',
      deliveryId: 'delivery-terminated',
      senderOpenId: 'ou_terminated',
      acceptedAt: 2,
    })
    await repository.bindQueued({
      deliveryId: accepted.record.deliveryId,
      correlation: {
        endpoint: locus.endpoint, locusId: locus.id, generation: locus.generation,
        childSessionId: locus.childSessionId as string,
      },
      executionId: 'execution-terminated',
      inboxMessageId: 'inbox-terminated',
      queuedAt: 3,
    })
    await first.close()

    const second = await reopen(medium)
    enableAtomicTransactions(second)
    const restarted = new DurableLocusRepository(second.domain)
    const terminated: string[] = []
    const report = await restarted.reconcileStartup({
      now: 4,
      terminateDelivery: async delivery => { terminated.push(delivery.deliveryId) },
    })
    expect(terminated).toEqual(['delivery-terminated'])
    expect(report.failedDeliveries).toEqual([
      expect.objectContaining({
        deliveryId: 'delivery-terminated', status: 'failed',
        startupDisposition: 'execution-unrecoverable',
      }),
    ])
    expect(restarted.getLocus(locus.id)).toMatchObject({ state: 'invalid', busy: false })
    const duplicate = await restarted.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-terminated',
      senderOpenId: 'ou_terminated',
      acceptedAt: 5,
    })
    expect(duplicate).toMatchObject({ duplicate: true, conflict: false })
    expect(restarted.listDeliveries()).toHaveLength(1)
    await second.close()

    // The execution was queued but had not yet opened a durable turn. The
    // startup terminal record must still pass the same repository assertion on
    // a subsequent reopen; schema and imperative validation intentionally agree.
    const third = await reopen(medium)
    enableAtomicTransactions(third)
    const reopened = new DurableLocusRepository(third.domain)
    await expect(reopened.reconcileStartup({ now: 5 })).resolves.toMatchObject({
      failedDeliveries: [],
      pendingDeliveries: [],
    })
    expect(reopened.getDelivery('delivery-terminated')).toMatchObject({
      status: 'failed',
      startupDisposition: 'execution-unrecoverable',
      executionId: 'execution-terminated',
      inboxMessageId: 'inbox-terminated',
    })
    expect(reopened.getDelivery('delivery-terminated')?.turnId).toBeUndefined()
    await third.close()
  })

  it('rebuilds stale indexes and reports pending work without replaying side effects', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    await repository.acceptDelivery({
      endpoint: locus.endpoint,
      locusId: locus.id,
      generation: locus.generation,
      childSessionId: locus.childSessionId as string,
      messageId: 'message-pending',
      deliveryId: 'delivery-pending',
      rootMessageId: 'root-pending',
      replyTarget: {
        chatId: locus.endpoint.chatId,
        messageId: 'message-pending',
        rootMessageId: 'root-pending',
      },
      replyToMessageId: 'reply-parent',
      senderOpenId: 'ou_sender',
      text: '继续处理',
      acceptedAt: 4,
    })

    const indexes = harness.domain.table('locus_indexes')
    await indexes.delete(endpointIndexKey(locus.endpoint))
    await indexes.put(parentIndexKey(locus.parentSessionId), {
      kind: 'parent-loci',
      key: parentIndexKey(locus.parentSessionId),
      locusIds: ['stale-locus'],
      updatedAt: 1,
    })
    const operation: PetLocusOperation = {
      id: 'operation-pending',
      kind: 'replace',
      phase: 'needs-recovery',
      locusId: locus.id,
      step: 1,
      attempts: 1,
      lastError: 'process stopped before publish',
      createdAt: 5,
      updatedAt: 5,
    }
    await harness.domain.table('locus_operations').put(operation.id, operation)

    enableAtomicTransactions(harness)
    const report = await repository.reconcileStartup({ now: 99 })

    expect(report.indexStatus).toBe('rebuilt')
    expect(report.indexChanges).toBeGreaterThanOrEqual(2)
    expect(report.pendingDeliveries).toEqual([])
    expect(report.failedDeliveries.map(item => item.deliveryId)).toEqual(['delivery-pending'])
    expect(report.recoverableOperations.map(item => item.id)).toContain('operation-pending')
    expect(report.sideEffectsReplayed).toBe(false)
    expect(repository.getDelivery('delivery-pending')?.status).toBe('failed')
    expect(repository.getDelivery('delivery-pending')?.startupDisposition).toBe('unqueued')
    expect(repository.getDelivery('delivery-pending')?.rootMessageId).toBe('root-pending')
    expect(repository.getDelivery('delivery-pending')?.replyTarget).toEqual({
      chatId: locus.endpoint.chatId,
      messageId: 'message-pending',
      rootMessageId: 'root-pending',
    })
    expect(repository.getDelivery('delivery-pending')?.replyToMessageId).toBe('reply-parent')
    expect(repository.getCurrentLocus(locus.endpoint)).toMatchObject({ ...locus, busy: false, updatedAt: 99 })
    expect(indexes.get(endpointIndexKey(locus.endpoint))?.locusIds).toEqual([locus.id])
    expect(indexes.get(parentIndexKey(locus.parentSessionId))?.locusIds).toEqual([locus.id])
    await harness.close()
  })

  it('leaves a consistent index set unchanged on repeated startup recovery', async () => {
    const harness = await openPetHarness()
    const repository = new DurableLocusRepository(harness.domain)
    const locus = await repository.putLocus(record())
    const first = await repository.reconcileStartup({ now: 10 })
    const second = await repository.reconcileStartup({ now: 20 })

    expect(first.indexStatus).toBe('unchanged')
    expect(second.indexStatus).toBe('unchanged')
    expect(first.indexChanges).toBe(0)
    expect(second.indexChanges).toBe(0)
    expect(repository.getCurrentLocus(locus.endpoint)).toEqual(locus)
    await harness.close()
  })

  it.each([
    ['topic without parent', { endpoint: { chatId: 'oc_bad', threadId: 'omt_bad' } }],
    ['chat with topic parent', { endpoint: { chatId: 'oc_bad' }, parentLocusId: 'locus-parent' }],
  ] as const)('rejects malformed durable %s records at schema and reopen boundaries', async (_label, patch) => {
    const malformed = {
      id: 'locus-malformed',
      generation: 1,
      endpoint: { chatId: 'oc_bad' },
      parentSessionId: 'session-main',
      childSessionId: 'child-malformed',
      workspaceId: 'workspace-main',
      source: 'inherited',
      state: 'active',
      permission: { desired: 'read', effective: 'read' },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
      ...patch,
    }
    expect(petLocusRecord.safeParse(malformed).success).toBe(false)
    const medium: MemoryMedium = {
      version: PET_DOMAIN_VERSION,
      global: null,
      tables: { loci: { [malformed.id]: JSON.stringify(malformed) } },
    }
    await expect(openPetHarness(medium)).rejects.toThrow()
  })

  it.each([
    ['topic without parent', { endpoint: { chatId: 'oc_live_bad', threadId: 'omt_bad' } }],
    ['chat with topic parent', { endpoint: { chatId: 'oc_live_bad' }, parentLocusId: 'locus-parent' }],
  ] as const)('rejects malformed live %s writes without poisoning reopen', async (_label, patch) => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const repository = new DurableLocusRepository(first.domain)
    const malformed = {
      id: 'locus-live-malformed',
      generation: 1,
      endpoint: { chatId: 'oc_live_bad' },
      parentSessionId: 'session-main',
      childSessionId: 'child-live-malformed',
      workspaceId: 'workspace-main',
      source: 'inherited',
      state: 'active',
      permission: { desired: 'read', effective: 'read' },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
      ...patch,
    } as LocusRecord

    await expect(repository.putLocus(malformed)).rejects.toMatchObject({ code: 'INVALID_LOCUS' })
    expect(first.domain.table('loci').size).toBe(0)
    await first.close()

    const reopened = await openPetHarness(medium)
    expect(new DurableLocusRepository(reopened.domain).listLoci()).toEqual([])
    await reopened.close()
  })

  it('isolates new locus routing from legacy chat and invocation rows', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const legacyChat = {
      chatId: 'oc_legacy',
      chatType: 'group' as const,
      kind: 'workspace' as const,
      workspaceId: 'legacy-workspace',
      boundBy: 'auto' as const,
      boundAt: 1,
    }
    const legacyInvocation = {
      invocationId: 'legacy-invocation',
      chatId: 'oc_legacy',
      chatType: 'group' as const,
      triggerMessageId: 'legacy-message',
      senderOpenId: 'ou_legacysender',
      createdAt: 1,
    }
    await first.domain.table('chat_bindings').put('oc_legacy', legacyChat)
    await first.domain.table('invocation_channel').put('legacy-invocation', legacyInvocation)

    const repository = new DurableLocusRepository(first.domain)
    expect(repository.getCurrentLocus({ chatId: 'oc_legacy' })).toBeUndefined()
    const locus = await repository.putLocus(
      record({ id: 'new-locus', endpoint: { chatId: 'oc_legacy' }, childSessionId: 'new-child' }),
    )
    expect(repository.getCurrentLocus(locus.endpoint)).toEqual(locus)
    expect(first.domain.table('chat_bindings').get('oc_legacy')).toEqual(legacyChat)
    expect(first.domain.table('invocation_channel').get('legacy-invocation')).toEqual(legacyInvocation)
    await first.close()

    const second = await reopen(medium)
    const restarted = new DurableLocusRepository(second.domain)
    expect(restarted.getCurrentLocus({ chatId: 'oc_legacy' })).toEqual(locus)
    expect(second.domain.table('chat_bindings').get('oc_legacy')).toEqual({ ...legacyChat, qaOrigin: 'created' })
    expect(second.domain.table('invocation_channel').get('legacy-invocation')).toEqual(legacyInvocation)
    await second.close()
  })
})
