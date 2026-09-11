import { describe, expect, it, vi } from 'vitest'
import { buildLocusRecord, type LocusRecord as DurableLocusRecord } from '../src/host/locus/aggregate.js'
import {
  ControllerLocusRepositoryAdapter,
  ControllerPersistenceAdapterError,
  projectGroupRecord,
  projectLocusRecord,
} from '../src/host/locus/controller-persistence-adapter.js'
import { LocusController } from '../src/host/locus/controller.js'
import type {
  LocusProvisioningCommit,
  LocusProvisioningRecord,
  LocusRecord as ControllerLocusRecord,
} from '../src/host/locus/controller.js'
import { LocusRepository as DurableLocusRepository } from '../src/host/locus/persistence.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { openPetHarness } from './harness.js'

function durableRecord(
  overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {},
): DurableLocusRecord {
  return buildLocusRecord({
    id: 'locus-group',
    endpoint: { chatId: 'oc_project' },
    parentSessionId: 'session-main',
    childSessionId: 'session-child',
    workspaceId: 'workspace-main',
    source: 'auto',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  })
}

function controllerRecord(
  overrides: Partial<ControllerLocusRecord> = {},
): ControllerLocusRecord {
  return {
    locusId: 'controller-locus',
    generation: 1,
    endpoint: { chatId: 'oc_controller' },
    workspaceId: 'workspace-main',
    parentSessionId: 'session-main',
    childSessionId: 'session-child-controller',
    source: 'auto',
    state: 'active',
    permission: 'read',
    createdAt: 10,
    ...overrides,
  }
}

/**
 * Inject the future Domain transaction contract for repository unit tests.
 *
 * This is not evidence that the pinned runtime is crash-atomic: that runtime
 * publishes no transaction member, which is separately tested to fail closed.
 * The double only verifies that the repository stages the complete write-set in
 * one callback and makes no direct writes when the transaction rejects.
 */
function enableAtomicTransactions(harness: Awaited<ReturnType<typeof openPetHarness>>) {
  type TableName =
    | 'loci'
    | 'locus_indexes'
    | 'locus_operations'
    | 'locus_switch_notices'
    | 'locus_deliveries'
    | 'locus_permission_audit'
  type Write = { kind: 'put' | 'delete'; table: TableName; key: string; value?: unknown }
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: TableName, key: string, value: unknown): void
      delete(table: TableName, key: string): void
    }) => void) => Promise<void>
    table(name: TableName): {
      get(key: string): unknown
      put(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<boolean>
    }
  }
  let failNextAt: number | undefined
  Object.defineProperty(domain, 'supportsTransaction', { value: true, configurable: true })
  domain.transaction = async (body) => {
    const writes: Write[] = []
    body({
      put: (table, key, value) => { writes.push({ kind: 'put', table, key, value }) },
      delete: (table, key) => { writes.push({ kind: 'delete', table, key }) },
    })
    const snapshots = writes.map(write => ({
      write,
      previous: domain.table(write.table).get(write.key),
    }))
    let applied = 0
    try {
      for (let index = 0; index < writes.length; index += 1) {
        if (failNextAt !== undefined && index + 1 === failNextAt) {
          failNextAt = undefined
          throw new Error(`injected atomic write failure #${String(index + 1)}`)
        }
        const write = writes[index]!
        if (write.kind === 'delete') await domain.table(write.table).delete(write.key)
        else await domain.table(write.table).put(write.key, write.value)
        applied += 1
      }
      failNextAt = undefined
    } catch (error) {
      for (let index = applied - 1; index >= 0; index -= 1) {
        const snapshot = snapshots[index]!
        if (snapshot.previous === undefined) {
          await domain.table(snapshot.write.table).delete(snapshot.write.key)
        } else {
          await domain.table(snapshot.write.table).put(snapshot.write.key, snapshot.previous)
        }
      }
      throw error
    }
  }
  return {
    failNextTransactionAt(writeNumber: number) {
      failNextAt = writeNumber
    },
  }
}

describe('controller to durable locus repository read adapter', () => {
  it('explicitly projects the chat-level locus into group and controller record shapes', () => {
    const durable = durableRecord({
      id: 'durable-id',
      generation: 3,
      revision: 7,
      busy: true,
      permission: { desired: 'read', effective: 'read', verifiedAt: 9 },
      contextAnchor: {
        status: 'confirmed',
        executionRoot: '/repo',
        confirmedAt: 9,
      },
      replacesLocusId: 'durable-old',
      updatedAt: 12,
    })

    expect(projectLocusRecord(durable)).toEqual({
      locusId: 'durable-id',
      generation: 3,
      endpoint: { chatId: 'oc_project' },
      workspaceId: 'workspace-main',
      parentSessionId: 'session-main',
      childSessionId: 'session-child',
      source: 'auto',
      state: 'active',
      permission: 'read',
      createdAt: 10,
      replacesLocusId: 'durable-old',
    })
    expect(projectGroupRecord(durable)).toEqual({
      chatId: 'oc_project',
      workspaceId: 'workspace-main',
      mainSessionId: 'session-main',
      mainSource: 'auto',
      state: 'active',
      createdAt: 10,
      updatedAt: 12,
    })
  })

  it('finds current, group, default Q&A and exact idle state from durable records', async () => {
    const harness = await openPetHarness()
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const qa = await durable.putLocus(durableRecord({ source: 'qa-created' }))
    const topic = await durable.putLocus(durableRecord({
      id: 'locus-topic',
      endpoint: { chatId: qa.endpoint.chatId, threadId: 'omt_topic' },
      parentLocusId: qa.id,
      childSessionId: 'session-child-topic',
      source: 'inherited',
    }))
    await durable.setDefaultQaLocus(qa.parentSessionId, qa.id)

    await expect(adapter.findGroup(qa.endpoint.chatId)).resolves.toEqual({
      chatId: qa.endpoint.chatId,
      workspaceId: qa.workspaceId,
      mainSessionId: qa.parentSessionId,
      mainSource: 'qa-created',
      state: 'active',
      createdAt: qa.createdAt,
      updatedAt: qa.updatedAt,
    })
    await expect(adapter.findActive(qa.endpoint)).resolves.toMatchObject({
      locusId: qa.id,
      state: 'active',
      permission: 'read',
    })
    await expect(adapter.findActive(topic.endpoint)).resolves.toMatchObject({
      locusId: topic.id,
      endpoint: topic.endpoint,
      source: 'inherited',
    })
    await expect(adapter.findDefaultQa(qa.parentSessionId)).resolves.toMatchObject({
      locusId: qa.id,
      source: 'qa-created',
    })
    await expect(adapter.isLocusIdle(qa.id)).resolves.toBe(true)

    await durable.acceptDelivery({
      deliveryId: 'delivery-busy',
      endpoint: qa.endpoint,
      locusId: qa.id,
      generation: qa.generation,
      childSessionId: qa.childSessionId as string,
      messageId: 'message-busy',
      senderOpenId: 'ou_sender',
      acceptedAt: 11,
    })
    await expect(adapter.isLocusIdle(qa.id)).resolves.toBe(false)
    await harness.close()
  })

  it.each([
    ['switching', 'switching'],
    ['stopped', 'stopped'],
    ['invalid', 'invalid'],
    ['retired', 'retired'],
  ] as const)('keeps a %s chat-level marker visible instead of folding it into missing', async (durableState, projectedState) => {
    const harness = await openPetHarness()
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const locus = await durable.putLocus(durableRecord())

    if (durableState === 'switching') await durable.transitionLocus(locus.id, 'switching', 11)
    if (durableState === 'stopped') await durable.stopLocus(locus.id, 11)
    if (durableState === 'invalid') await durable.invalidateLocus(locus.id, 'parent missing', 11)
    if (durableState === 'retired') await durable.retireLocus(locus.id, 11)

    await expect(adapter.findGroup(locus.endpoint.chatId)).resolves.toMatchObject({
      chatId: locus.endpoint.chatId,
      state: projectedState,
    })
    await expect(adapter.findActive(locus.endpoint)).resolves.toMatchObject({
      locusId: locus.id,
      state: projectedState,
    })
    await harness.close()
  })

  it('selects the latest retired generation even when the current index falls back to older invalid history', async () => {
    const harness = await openPetHarness()
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const original = await durable.putLocus(durableRecord())
    await durable.invalidateLocus(original.id, 'old generation invalid', 11)
    const rebuilt = await durable.rebuildLocus({
      id: 'locus-rebuilt',
      endpoint: original.endpoint,
      parentSessionId: original.parentSessionId,
      childSessionId: 'session-child-rebuilt',
      workspaceId: original.workspaceId,
      source: 'auto',
      createdAt: 12,
      updatedAt: 12,
    }, 12)
    await durable.retireLocus(rebuilt.id, 13)

    // The durable endpoint-current index excludes retired records and now
    // points back to the older invalid generation. The adapter reads the loci
    // aggregate's highest generation instead of exposing that stale pointer.
    expect(durable.getCurrentLocus(original.endpoint)?.id).toBe(original.id)
    await expect(adapter.findActive(original.endpoint)).resolves.toMatchObject({
      locusId: rebuilt.id,
      generation: 2,
      state: 'retired',
    })
    await expect(adapter.findGroup(original.endpoint.chatId)).resolves.toMatchObject({
      state: 'retired',
    })
    await harness.close()
  })

  it('does not use a legacy chat binding as a group or current locus fallback', async () => {
    const harness = await openPetHarness()
    await harness.domain.table('chat_bindings').put('oc_legacy', {
      chatId: 'oc_legacy',
      chatType: 'group',
      kind: 'workspace',
      workspaceId: 'legacy-workspace',
      boundBy: 'auto',
      boundAt: 1,
    })
    const adapter = new ControllerLocusRepositoryAdapter(
      new DurableLocusRepository(harness.domain),
    )

    await expect(adapter.findGroup('oc_legacy')).resolves.toBeUndefined()
    await expect(adapter.findActive({ chatId: 'oc_legacy' })).resolves.toBeUndefined()
    await harness.close()
  })

  it('projects the durable effective permission without claiming an unverified write', () => {
    const writable = durableRecord({
      permission: {
        desired: 'write',
        effective: 'write',
        verifiedAt: 10,
        grantedBy: 'ou_owner',
      },
    })
    const refused = durableRecord({
      permission: {
        desired: 'write',
        effective: 'read',
        verifiedAt: 10,
        grantedBy: 'ou_owner',
      },
    })
    expect(projectLocusRecord(writable).permission).toBe('write')
    expect(projectLocusRecord(refused).permission).toBe('read')
  })
})

describe('controller to durable locus repository write boundary', () => {
  it('fails before external creation when the Domain has no transaction', async () => {
    const harness = await openPetHarness()
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const createMainSession = vi.fn(async () => ({
      id: 'main-never-created', workspaceId: 'workspace-main',
    }))
    const locus = new LocusController({
      repository: adapter,
      dsh: {
        resolveSession: async () => undefined,
        resolveDefaultWorkspace: async () => ({ id: 'workspace-main' }),
        createMainSession,
        createChildSession: async () => ({ id: 'child-never-created' }),
      },
      now: () => 10,
      id: () => 'transaction-required',
    })

    await expect(locus.ensureGroup({ chatId: 'oc_no_transaction' })).rejects.toMatchObject({
      code: 'PROVISIONING_FAILED',
      cause: expect.objectContaining({ code: 'TRANSACTION_UNAVAILABLE', operation: 'beginProvisioning' }),
    })
    expect(createMainSession).not.toHaveBeenCalled()
    expect(durable.listLoci()).toEqual([])
    expect(durable.listOperations()).toEqual([])
    await harness.close()
  })

  it('atomically publishes one chat-level locus and indexes, with idempotent retries', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const provisioning: LocusProvisioningRecord = {
      provisioningId: 'provisioning-group',
      kind: 'group',
      endpoint: { chatId: 'oc_controller' },
      startedAt: 10,
    }
    const commit: LocusProvisioningCommit = {
      provisioningId: provisioning.provisioningId,
      locus: controllerRecord(),
      group: {
        chatId: 'oc_controller',
        workspaceId: 'workspace-main',
        mainSessionId: 'session-main',
        mainSource: 'auto',
        state: 'active',
        createdAt: 10,
        updatedAt: 10,
      },
    }

    await adapter.beginProvisioning(provisioning)
    await adapter.recordProvisioningResource(provisioning.provisioningId, { mainSessionId: 'session-main' })
    await adapter.recordProvisioningResource(provisioning.provisioningId, { childSessionId: 'session-child-controller' })
    await adapter.commitProvisioning(commit)
    await adapter.completeProvisioning(provisioning.provisioningId)
    // Same intent and same resource/commit are idempotent.
    await adapter.beginProvisioning(provisioning)
    await adapter.recordProvisioningResource(provisioning.provisioningId, { childSessionId: 'session-child-controller' })
    await adapter.commitProvisioning(commit)

    expect(durable.getLatestLocusByEndpoint(commit.locus.endpoint)).toMatchObject({
      id: commit.locus.locusId,
      generation: 1,
      state: 'active',
    })
    expect(harness.domain.table('locus_indexes').get(`endpoint:${commit.locus.endpoint.chatId}`)?.locusIds).toEqual([
      commit.locus.locusId,
    ])
    expect(durable.getOperation(provisioning.provisioningId)).toMatchObject({
      id: provisioning.provisioningId,
      phase: 'committed',
      newLocusId: commit.locus.locusId,
      resourceRefs: expect.objectContaining({
        mainSessionId: 'session-main',
        childSessionId: 'session-child-controller',
      }),
    })
    // Group is only a projection of the chat-level locus; no group table exists.
    await expect(adapter.findGroup('oc_controller')).resolves.toMatchObject({
      mainSessionId: 'session-main',
      state: 'active',
    })
    await harness.close()
  })

  it('atomically rebuilds a stopped default Q&A pointer to a fresh read generation', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const sessions = new Map([
      ['session-main', { id: 'session-main', workspaceId: 'workspace-main' }],
    ])
    let sequence = 0
    const locus = new LocusController({
      repository: adapter,
      dsh: {
        resolveDefaultWorkspace: async () => ({ id: 'workspace-main' }),
        resolveSession: async id => sessions.get(id),
        createMainSession: async () => ({ id: 'unused', workspaceId: 'workspace-main' }),
        createChildSession: async ({ parentSessionId }) => ({
          id: `session-child-${String(++sequence)}`, parentSessionId, workspaceId: 'workspace-main',
        }),
      },
      lark: { createGroup: async () => ({ chatId: 'oc_default_rebuild' }), sendControlMessage: async () => {} },
      id: () => `id-${String(++sequence)}`,
      now: () => 10,
    })
    const original = await locus.createOrOpenDefaultQa({ parentSessionId: 'session-main', ownerId: 'ou-owner' })
    await durable.stopLocus(original.locus.locusId, 20)

    const rebuilt = await locus.rebuildExplicit({
      endpoint: original.locus.endpoint,
      previousLocusId: original.locus.locusId,
      parentSessionId: 'session-main',
      asDefaultQa: true,
    })

    expect(rebuilt.locus).toMatchObject({ generation: 2, permission: 'read', source: 'qa-created' })
    expect(durable.getLocus(original.locus.locusId)?.state).toBe('stopped')
    expect(durable.getDefaultQaLocus('session-main')?.id).toBe(rebuilt.locus.locusId)
    await harness.close()
  })

  it('runs group then topic provisioning end to end through the durable adapter', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const sessions = new Map<string, { id: string; workspaceId: string }>()
    let sequence = 0
    const locus = new LocusController({
      repository: adapter,
      dsh: {
        resolveDefaultWorkspace: async () => ({ id: 'workspace-main' }),
        resolveSession: async sessionId => sessions.get(sessionId),
        createMainSession: async ({ workspaceId }) => {
          const session = { id: 'session-auto-main', workspaceId }
          sessions.set(session.id, session)
          return session
        },
        createChildSession: async ({ parentSessionId }) => ({
          id: `session-child-${String(++sequence)}`,
          parentSessionId,
          workspaceId: 'workspace-main',
        }),
      },
      id: () => `id-${String(++sequence)}`,
      now: () => 10,
    })

    const group = await locus.ensureGroup({ chatId: 'oc_end_to_end' })
    const topic = await locus.ensureTopic({ chatId: 'oc_end_to_end', threadId: 'omt_topic' })

    expect(group.locus.state).toBe('active')
    expect(topic.locus.parentLocusId).toBe(group.locus.locusId)
    expect(durable.getLatestLocusByEndpoint(topic.locus.endpoint)).toMatchObject({
      id: topic.locus.locusId,
      parentLocusId: group.locus.locusId,
    })
    expect(durable.listOperations().map(operation => operation.phase)).toEqual([
      'committed',
      'committed',
    ])
    await harness.close()
  })

  it('atomically replaces only an inherited topic generation and preserves its group default', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const sessions = new Map([
      ['session-source-1', { id: 'session-source-1', workspaceId: 'workspace-source' }],
    ])
    let sequence = 0
    let failNotice = true
    const sent: string[] = []
    const locus = new LocusController({
      repository: adapter,
      dsh: {
        resolveDefaultWorkspace: async () => ({ id: 'workspace-main' }),
        resolveSession: async id => sessions.get(id),
        createMainSession: async ({ workspaceId }) => {
          const session = { id: 'session-auto-main', workspaceId }
          sessions.set(session.id, session)
          return session
        },
        createChildSession: async ({ parentSessionId }) => ({
          id: `session-child-${String(++sequence)}`,
          parentSessionId,
          workspaceId: sessions.get(parentSessionId)!.workspaceId,
        }),
      },
      lark: {
        createGroup: async () => ({ chatId: 'unused' }),
        sendControlMessage: async ({ text }) => {
          if (failNotice) throw new Error('temporary send failure')
          sent.push(text)
        },
      },
      id: () => `id-${String(++sequence)}`,
      now: () => 10,
    })

    const group = await locus.ensureGroup({ chatId: 'oc_topic_replace' })
    const original = await locus.ensureTopic({ chatId: 'oc_topic_replace', threadId: 'omt_review' })
    await expect(locus.ensureTopic({
      chatId: 'oc_topic_replace', threadId: 'omt_review', parentSessionId: 'session-source-1',
    })).rejects.toMatchObject({ code: 'NOTIFICATION_FAILED' })

    const current = durable.getLatestLocusByEndpoint(original.locus.endpoint)
    expect(current).toMatchObject({
      generation: 2,
      parentSessionId: 'session-source-1',
      workspaceId: 'workspace-source',
      source: 'explicit',
      permission: { desired: 'read', effective: 'read' },
      replacesLocusId: original.locus.locusId,
      parentLocusId: group.locus.locusId,
    })
    expect(durable.getLocus(original.locus.locusId)?.state).toBe('retired')
    expect(durable.getLatestLocusByEndpoint(group.locus.endpoint)).toMatchObject({
      id: group.locus.locusId,
      parentSessionId: group.locus.parentSessionId,
    })
    expect(durable.getSwitchNotice(current!.id, current!.generation)).toBeDefined()

    failNotice = false
    const retried = await locus.ensureTopic({
      chatId: 'oc_topic_replace', threadId: 'omt_review', parentSessionId: 'session-source-1',
    })
    expect(retried).toMatchObject({ created: false, reused: true })
    expect(retried.locus.locusId).toBe(current!.id)
    expect(sent).toHaveLength(1)
    expect(durable.getSwitchNotice(current!.id, current!.generation)).toBeUndefined()
    expect(durable.listOperations().map(operation => operation.phase)).toEqual([
      'committed', 'committed', 'committed',
    ])
    await harness.close()
  })

  it('rejects reuse of a provisioning id for a different intent or resource', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const adapter = new ControllerLocusRepositoryAdapter(new DurableLocusRepository(harness.domain))
    const begin: LocusProvisioningRecord = {
      provisioningId: 'provisioning-conflict',
      kind: 'group',
      endpoint: { chatId: 'oc_a' },
      startedAt: 10,
    }
    await adapter.beginProvisioning(begin)
    await expect(adapter.beginProvisioning({ ...begin, endpoint: { chatId: 'oc_b' } })).rejects.toMatchObject({
      code: 'PROVISIONING_CONFLICT',
    })
    await adapter.recordProvisioningResource(begin.provisioningId, { childSessionId: 'child-a' })
    await expect(adapter.recordProvisioningResource(begin.provisioningId, { childSessionId: 'child-b' })).rejects.toMatchObject({
      code: 'PROVISIONING_CONFLICT',
    })
    await adapter.failProvisioning(begin.provisioningId, 'external create failed')
    await adapter.failProvisioning(begin.provisioningId, 'external create failed')
    await expect(adapter.failProvisioning(begin.provisioningId, 'different failure')).rejects.toMatchObject({
      code: 'PROVISIONING_CONFLICT',
    })
    await harness.close()
  })

  it('conditionally rejects a second provisioning winner for the same endpoint', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const makeCommit = (suffix: string): LocusProvisioningCommit => ({
      provisioningId: `provisioning-${suffix}`,
      locus: controllerRecord({
        locusId: `locus-${suffix}`,
        childSessionId: `child-${suffix}`,
      }),
      group: {
        chatId: 'oc_controller', workspaceId: 'workspace-main', mainSessionId: 'session-main',
        mainSource: 'auto', state: 'active', createdAt: 10, updatedAt: 10,
      },
    })
    for (const suffix of ['a', 'b']) {
      await adapter.beginProvisioning({
        provisioningId: `provisioning-${suffix}`,
        kind: 'group',
        endpoint: { chatId: 'oc_controller' },
        startedAt: 10,
      })
      await adapter.recordProvisioningResource(`provisioning-${suffix}`, { mainSessionId: 'session-main' })
      await adapter.recordProvisioningResource(`provisioning-${suffix}`, { childSessionId: `child-${suffix}` })
    }

    const results = await Promise.allSettled([
      adapter.commitProvisioning(makeCommit('a')),
      adapter.commitProvisioning(makeCommit('b')),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(durable.listLoci()).toHaveLength(1)
    expect(durable.getLatestLocusByEndpoint({ chatId: 'oc_controller' })?.id).toBe('locus-a')
    expect(durable.getOperation('provisioning-b')?.phase).toBe('provisioning')
    await harness.close()
  })

  it('persists topic parentLocusId and default-Q&A pointer in the same atomic publish', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)

    const group = await durable.putLocus(durableRecord({ source: 'qa-created' }))
    await adapter.beginProvisioning({
      provisioningId: 'provisioning-topic-invalid',
      kind: 'topic',
      endpoint: { chatId: group.endpoint.chatId, threadId: 'omt_invalid' },
      parentSessionId: group.parentSessionId,
      startedAt: 19,
    })
    await adapter.recordProvisioningResource('provisioning-topic-invalid', { childSessionId: 'child-topic-invalid' })
    await expect(adapter.commitProvisioning({
      provisioningId: 'provisioning-topic-invalid',
      locus: controllerRecord({
        locusId: 'locus-topic-invalid',
        endpoint: { chatId: group.endpoint.chatId, threadId: 'omt_invalid' },
        childSessionId: 'child-topic-invalid',
        source: 'inherited',
        createdAt: 19,
      }),
    })).rejects.toMatchObject({ code: 'INVALID_LOCUS' })
    expect(durable.getLatestLocusByEndpoint({ chatId: group.endpoint.chatId, threadId: 'omt_invalid' })).toBeUndefined()

    await adapter.beginProvisioning({
      provisioningId: 'provisioning-topic',
      kind: 'topic',
      endpoint: { chatId: group.endpoint.chatId, threadId: 'omt_topic' },
      parentSessionId: group.parentSessionId,
      startedAt: 20,
    })
    await adapter.recordProvisioningResource('provisioning-topic', { childSessionId: 'child-topic' })
    await adapter.commitProvisioning({
      provisioningId: 'provisioning-topic',
      locus: controllerRecord({
        locusId: 'locus-topic',
        endpoint: { chatId: group.endpoint.chatId, threadId: 'omt_topic' },
        childSessionId: 'child-topic',
        parentLocusId: group.id,
        source: 'inherited',
        createdAt: 20,
      }),
    })
    expect(durable.getLatestLocusByEndpoint({ chatId: group.endpoint.chatId, threadId: 'omt_topic' })).toMatchObject({
      id: 'locus-topic', parentLocusId: group.id,
    })

    await adapter.beginProvisioning({
      provisioningId: 'provisioning-default',
      kind: 'qa',
      endpoint: { chatId: 'pending-session-default' },
      parentSessionId: 'session-default',
      startedAt: 30,
    })
    await adapter.recordProvisioningResource('provisioning-default', { childSessionId: 'child-default' })
    await adapter.recordProvisioningResource('provisioning-default', { chatId: 'oc_default' })
    const defaultCommit: LocusProvisioningCommit = {
      provisioningId: 'provisioning-default',
      locus: controllerRecord({
        locusId: 'locus-default',
        endpoint: { chatId: 'oc_default' },
        parentSessionId: 'session-default',
        childSessionId: 'child-default',
        source: 'qa-created',
        createdAt: 30,
      }),
      group: {
        chatId: 'oc_default', workspaceId: 'workspace-main', mainSessionId: 'session-default',
        mainSource: 'qa-created', state: 'active', createdAt: 30, updatedAt: 30,
      },
      defaultQaForParentSessionId: 'session-default',
    }
    await adapter.commitProvisioning(defaultCommit)
    expect(durable.getDefaultQaLocus('session-default')?.id).toBe('locus-default')
    expect(durable.getOperation('provisioning-default')?.phase).toBe('committed')
    await harness.close()
  })

  it('atomically replaces the old generation with notice debt and leaves no partial publish on failure', async () => {
    const harness = await openPetHarness()
    const transaction = enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const original = await durable.putLocus(durableRecord())
    const existingTopic = await durable.putLocus(durableRecord({
      id: 'locus-existing-topic',
      endpoint: { chatId: original.endpoint.chatId, threadId: 'omt_existing' },
      parentLocusId: original.id,
      childSessionId: 'child-existing-topic',
      source: 'inherited',
    }))
    const begin: LocusProvisioningRecord = {
      provisioningId: 'provisioning-replace',
      kind: 'replacement',
      endpoint: original.endpoint,
      parentSessionId: 'session-next',
      startedAt: 20,
    }
    const commit: LocusProvisioningCommit = {
      provisioningId: begin.provisioningId,
      locus: controllerRecord({
        locusId: 'locus-next', generation: 2, endpoint: original.endpoint,
        parentSessionId: 'session-next', childSessionId: 'child-next',
        workspaceId: 'workspace-next', source: 'explicit', createdAt: 20,
        replacesLocusId: original.id,
      }),
      group: {
        chatId: original.endpoint.chatId, workspaceId: 'workspace-next', mainSessionId: 'session-next',
        mainSource: 'explicit', state: 'active', createdAt: 20, updatedAt: 20,
      },
      replace: { oldLocusId: original.id, noticeText: 'S0 → S1；旧历史未合并。' },
    }
    await adapter.beginProvisioning(begin)
    await adapter.recordProvisioningResource(begin.provisioningId, { childSessionId: 'child-next' })
    transaction.failNextTransactionAt(2)
    await expect(adapter.commitProvisioning(commit)).rejects.toThrow('injected atomic write failure')
    expect(durable.getLocus(original.id)?.state).toBe('active')
    expect(durable.getLocus('locus-next')).toBeUndefined()
    expect(harness.domain.table('locus_switch_notices').size).toBe(0)
    expect(durable.getOperation(begin.provisioningId)?.phase).toBe('provisioning')

    await adapter.commitProvisioning(commit)
    await adapter.commitProvisioning(commit)
    expect(durable.getLocus(original.id)?.state).toBe('retired')
    expect(durable.getLocus(existingTopic.id)).toMatchObject({
      state: 'active',
      parentLocusId: original.id,
    })
    expect(durable.getLatestLocusByEndpoint(original.endpoint)?.id).toBe('locus-next')
    expect(harness.domain.table('locus_switch_notices').get('locus-next\u00002')).toMatchObject({
      text: 'S0 → S1；旧历史未合并。', attempts: 0,
    })
    await adapter.acknowledgeSwitchNotice('locus-next', 2)
    expect(harness.domain.table('locus_switch_notices').size).toBe(0)
    await expect(adapter.commitProvisioning({
      ...commit,
      replace: { ...commit.replace!, noticeText: 'different intent' },
    })).rejects.toMatchObject({ code: 'PROVISIONING_CONFLICT' })
    await harness.close()
  })

  it('retries an owed replacement notice through the durable adapter without creating new work', async () => {
    const harness = await openPetHarness()
    enableAtomicTransactions(harness)
    const durable = new DurableLocusRepository(harness.domain)
    const adapter = new ControllerLocusRepositoryAdapter(durable)
    const sessions = new Map([
      ['session-source-1', { id: 'session-source-1', workspaceId: 'workspace-source' }],
    ])
    const children: string[] = []
    const sent: string[] = []
    let sequence = 0
    let failNotice = true
    const locus = new LocusController({
      repository: adapter,
      dsh: {
        resolveDefaultWorkspace: async () => ({ id: 'workspace-main' }),
        resolveSession: async sessionId => sessions.get(sessionId),
        createMainSession: async ({ workspaceId }) => {
          const session = { id: 'session-auto-main', workspaceId }
          sessions.set(session.id, session)
          return session
        },
        createChildSession: async ({ parentSessionId }) => {
          const id = `session-child-${String(++sequence)}`
          children.push(id)
          return {
            id,
            parentSessionId,
            workspaceId: parentSessionId === 'session-source-1'
              ? 'workspace-source'
              : 'workspace-main',
          }
        },
      },
      lark: {
        createGroup: async () => ({ chatId: 'unused' }),
        sendControlMessage: async ({ text }) => {
          if (failNotice) {
            failNotice = false
            throw new Error('temporary send failure')
          }
          sent.push(text)
        },
      },
      id: () => `id-${String(++sequence)}`,
      now: () => 10,
    })

    await locus.ensureGroup({ chatId: 'oc_notice_retry' })
    await expect(locus.replaceAutomaticGroupParent({
      chatId: 'oc_notice_retry',
      parentSessionId: 'session-source-1',
    })).rejects.toMatchObject({ code: 'NOTIFICATION_FAILED' })

    const current = durable.getLatestLocusByEndpoint({ chatId: 'oc_notice_retry' })
    expect(current).toMatchObject({ source: 'explicit', parentSessionId: 'session-source-1' })
    const debt = durable.getSwitchNotice(current!.id, current!.generation)
    expect(debt?.text).toContain('上下文来源发生变化')
    const exactText = debt!.text
    const resolution = createLocusResolution({ store: durable })
    expect(() => resolution.resolveCurrent({ chatId: 'oc_notice_retry' })).toThrowError(
      expect.objectContaining({ reason: 'locus-unusable' }),
    )
    await expect(durable.acceptDelivery({
      deliveryId: 'delivery-before-notice',
      endpoint: current!.endpoint,
      locusId: current!.id,
      generation: current!.generation,
      childSessionId: current!.childSessionId!,
      messageId: 'message-before-notice',
      senderOpenId: 'ou_sender',
      acceptedAt: 11,
    })).rejects.toMatchObject({ code: 'LOCUS_INVALID' })
    const operationsAfterCommit = durable.listOperations().length
    const childrenAfterCommit = children.length

    const retried = await locus.replaceAutomaticGroupParent({
      chatId: 'oc_notice_retry',
      parentSessionId: 'session-source-1',
    })
    expect(retried.created).toBe(false)
    expect(retried.warningText).toBe(exactText)
    expect(sent).toEqual([exactText])
    expect(durable.getSwitchNotice(current!.id, current!.generation)).toBeUndefined()
    expect(resolution.resolveCurrent({ chatId: 'oc_notice_retry' })).toMatchObject({
      id: current!.id,
      state: 'active',
    })
    expect(durable.listOperations()).toHaveLength(operationsAfterCommit)
    expect(children).toHaveLength(childrenAfterCommit)

    const postAck = await locus.replaceAutomaticGroupParent({
      chatId: 'oc_notice_retry',
      parentSessionId: 'session-source-1',
    })
    expect(postAck.created).toBe(false)
    expect(postAck.warningText).toBe('')
    expect(sent).toEqual([exactText])
    expect(durable.listOperations()).toHaveLength(operationsAfterCommit)
    expect(children).toHaveLength(childrenAfterCommit)
    await harness.close()
  })

  it('exposes a stable typed projection error', () => {
    const error = new ControllerPersistenceAdapterError(
      'CONTROLLER_RECORD_UNREPRESENTABLE',
      'unavailable',
      'commitProvisioning',
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      code: 'CONTROLLER_RECORD_UNREPRESENTABLE',
      operation: 'commitProvisioning',
    })
  })
})
