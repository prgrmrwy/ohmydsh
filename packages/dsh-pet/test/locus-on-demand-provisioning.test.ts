/**
 * End-to-end proof that the whole locus tree is built on demand by the first
 * qualifying @ message, over the REAL provisioning and admission controllers
 * sharing one durable repository — the exact composition `index.ts` wires
 * once `botLifecycleInitializer` is never set.
 *
 * This is the regression `pet-locus-on-demand-tree` exists to prove: bot-added
 * has zero effect on the repository, and `resolveLocus` → `ensureForDelivery`
 * → `LocusController.ensureGroup`/`ensureTopic` builds main, child and an
 * active locus inside the SAME admission that delivers the first message —
 * not a second, earlier step.
 */

import { LOCUS_MAIN_PRESET } from '../src/host/locus/aggregate.js'
import { describe, expect, it } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { LocusController } from '../src/host/locus/controller.js'
import { ControllerLocusRepositoryAdapter } from '../src/host/locus/controller-persistence-adapter.js'
import { LocusRepository as DurableLocusRepository } from '../src/host/locus/persistence.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { openPetHarness, type PetHarness } from './harness.js'

const CHAT_ID = 'oc-on-demand'
const PARENT_SESSION = 'session-owner-main'

/**
 * Provisioning's `beginProvisioning` requires an atomic-transaction seam
 * (`requireProvisioningTransaction`) that the plain in-memory test medium
 * does not implement. This installs a synchronous best-effort transaction —
 * sufficient here because these tests assert compensation and repository
 * state, not true cross-write atomicity.
 */
function enableAtomicTransactions(harness: PetHarness): void {
  type TableName = 'loci' | 'locus_indexes' | 'locus_operations' | 'locus_switch_notices' | 'locus_deliveries' | 'locus_permission_audit'
  type Write = { kind: 'put' | 'delete'; table: TableName; key: string; value?: unknown }
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: TableName, key: string, value: unknown): void
      delete(table: TableName, key: string): void
    }) => void) => Promise<void>
    table(name: TableName): {
      put(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<boolean>
    }
  }
  Object.defineProperty(domain, 'supportsTransaction', { value: true, configurable: true })
  domain.transaction = async body => {
    const writes: Write[] = []
    body({
      put: (table, key, value) => writes.push({ kind: 'put', table, key, value }),
      delete: (table, key) => writes.push({ kind: 'delete', table, key }),
    })
    for (const write of writes) {
      if (write.kind === 'delete') await domain.table(write.table).delete(write.key)
      else await domain.table(write.table).put(write.key, write.value)
    }
  }
}

function inbound(messageId: string, text: string, mentions = true) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: CHAT_ID,
    chat_type: 'group' as const,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-owner',
    sender_type: 'user',
    mentions: mentions ? [{ id: 'ou-bot', name: 'Pet' }] : [],
  }
}

/** Same shape as `inbound`, but addressed to an explicit `chatId`'s group body. */
function inboundFor(chatId: string, messageId: string, text: string) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: chatId,
    chat_type: 'group' as const,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-owner',
    sender_type: 'user',
    mentions: [{ id: 'ou-bot', name: 'Pet' }],
  }
}

/** Same shape as `inbound`, but addressed to a topic under a different group. */
function topicInbound(chatId: string, threadId: string, messageId: string, text: string) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: chatId,
    chat_type: 'group' as const,
    thread_id: threadId,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-owner',
    sender_type: 'user',
    mentions: [{ id: 'ou-bot', name: 'Pet' }],
  }
}

/**
 * Compose the real provisioning controller and the real channel controller
 * over one shared durable repository — the same repository instance
 * `index.ts` gives both `locusProvisioningController` and `locusResolution`.
 */
async function composeOnDemandHost(options: { readonly failFirstCreate?: boolean } = {}) {
  const harness: PetHarness = await openPetHarness()
  enableAtomicTransactions(harness)
  const durable = new DurableLocusRepository(harness.domain)

  const sessions = new Map([
    // agentPreset mirrors the real Host: an explicitly named main must run
    // LOCUS_MAIN_PRESET, because the locus child inherits its composition.
    [PARENT_SESSION, { id: PARENT_SESSION, workspaceId: 'workspace-owner', title: 'Owner main', agentPreset: LOCUS_MAIN_PRESET }],
  ])
  let sequence = 0
  let createChildCalls = 0
  const adapter = new ControllerLocusRepositoryAdapter(durable)
  const provisioning = new LocusController({
    repository: adapter,
    dsh: {
      resolveSession: async id => sessions.get(id),
      resolveDefaultWorkspace: async () => ({ id: 'workspace-auto' }),
      createMainSession: async ({ workspaceId, chatId }) => {
        const session = { id: `session-auto-${++sequence}`, workspaceId, title: `auto:${chatId}` }
        sessions.set(session.id, session)
        return session
      },
      createChildSession: async ({ parentSessionId }) => {
        createChildCalls += 1
        if (options.failFirstCreate === true && createChildCalls === 1) {
          throw new Error('injected child creation failure')
        }
        const parent = sessions.get(parentSessionId)
        if (parent === undefined) throw new Error('missing parent fixture')
        return {
          id: `session-child-${++sequence}`,
          parentSessionId,
          workspaceId: parent.workspaceId,
          childComposition: 'safe-v1' as const,
        }
      },
    },
    // Only exercised by `replaceAutomaticGroupParentLocked`'s switch-warning
    // delivery, per `LocusControllerDeps`'s own contract. The on-demand build
    // path never calls it: `ensureGroup` with an explicit parent on a fresh
    // endpoint builds directly and never reaches the replace branch.
    lark: { createGroup: async () => { throw new Error('unused in this fixture') }, sendControlMessage: async () => {} },
    id: () => `id-${++sequence}`,
    now: () => sequence + 100,
  })

  const queued: { childSessionId: string; prompt: string }[] = []
  const diagnostics: string[] = []
  const controller = new LocusChannelController({
    locus: createLocusResolution({
      store: durable,
      provisioning: {
        ensureForDelivery: async ({ endpoint }) => {
          const ensured = endpoint.threadId === undefined
            ? await provisioning.ensureGroup({ chatId: endpoint.chatId })
            : await provisioning.ensureTopic({ chatId: endpoint.chatId, threadId: endpoint.threadId })
          const record = ensured.locus
          if (record.state !== 'active') throw new Error(`Provisioned locus is ${record.state}, not active`)
          return {
            id: record.locusId,
            endpoint: record.endpoint,
            generation: record.generation,
            parentSessionId: record.parentSessionId,
            childSessionId: record.childSessionId,
            workspaceId: record.workspaceId,
            state: 'active' as const,
            childComposition: 'safe-v1' as const,
            permission: { desired: record.permission, effective: record.permission, verifiedAt: Date.now() },
          }
        },
      },
    }) as never,
    deliveries: {
      findByMessageId: id => durable.findDeliveryByMessageId(id),
      getById: id => durable.getDelivery(id),
      accept: input => durable.acceptDelivery(input),
      bindQueued: input => durable.bindQueued(input),
      bindTurn: input => durable.bindTurn(input),
    } as never,
    deliveryDispatch: {
      claimCurrent: input => durable.claimCurrentDelivery(input),
      currentFinished: () => {},
      dispatchNext: async () => {},
      scheduleCurrent: () => {},
    },
    child: {
      ensureChild: locus => ({ parentSessionId: locus.parentSessionId, childSessionId: locus.childSessionId }),
      withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: input.identity.childSessionId }) }),
      queueChild: input => {
        queued.push({ childSessionId: input.child.childSessionId, prompt: input.content.filter(block => block.type === 'text').map(block => block.text).join('\n') })
        return { accepted: true as const, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
      },
    },
    resolveLivePolicy: () => ({ mode: 'read-only', workspaceRoot: '/repo' }),
    invalidatePolicyDrift: (input: { reason: string }) => { diagnostics.push(`policy-drift-reason:${input.reason}`) },
    turns: { perTurnCorrelation: true, subscribe: () => () => {} },
    admissionContext: {
      botOpenId: 'ou-bot', allowOpenIds: ['ou-owner'], watermark: 1000,
      isDuplicate: () => false,
      // Real, not fixed: this is the exact fact the whole test is about.
      // A fixed 'authorized' would force `needsInitialization: false` and
      // never exercise `ensureForDelivery` at all — silently turning "the
      // first @ builds the tree" into a no-op assertion. Uninitialized
      // until the durable repository actually has an active group.
      authorization: (endpoint: { chatId: string; threadId?: string }) => {
        const record = durable.findCurrentLocus(endpoint)
        return record?.state === 'active' ? 'authorized' : 'uninitialized'
      },
    },
    log: code => diagnostics.push(code),
    // Same monotonic scale as the provisioning controller's own
    // `now: () => sequence + 100` (both close over the same `sequence`).
    // Left at its `Date.now` default, an accepted Delivery would stamp the
    // locus record's `updatedAt` at real-wall-clock scale, and a later
    // provisioning write using the small `sequence`-based clock would then
    // fail `transitionLocus`'s monotonic check as if time had gone backward.
    now: () => sequence + 100,
  })

  // Same scale as `LocusController`'s own `now: () => sequence + 100`, read
  // fresh so it always sits at or ahead of the locus record's `updatedAt`.
  const now = () => sequence + 100
  return { harness, durable, adapter, provisioning, controller, queued, diagnostics, now, close: async () => { controller.dispose(); await harness.close() } }
}

describe('locus tree is built on demand by the first qualifying @ message', () => {
  it('bot-added has zero repository effect: no group marker exists until the first @', async () => {
    const host = await composeOnDemandHost()
    try {
      // No admission at all yet — simulating that `im.chat.member.bot.added_v1`
      // never reaches provisioning, because `index.ts` never constructs its
      // subscription without `botLifecycleInitializer`. Nothing else in this
      // fixture ever calls `ensureGroup`/`ensureTopic` on its own, so the
      // repository staying empty here is exactly what "bot-added has zero
      // effect" means end to end.
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(await host.adapter.findActive({ chatId: CHAT_ID })).toBeUndefined()
    } finally {
      await host.close()
    }
  })

  it('the first qualifying @ builds main, child and an active locus inside one admission, then delivers it', async () => {
    const host = await composeOnDemandHost()
    try {
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()

      const result = await host.controller.handle(inbound('om-first', '@Pet hello'))

      expect(result).toMatchObject({ kind: 'accepted' })
      const group = (await host.adapter.findGroup(CHAT_ID))
      expect(group).toBeDefined()
      expect(group?.mainSource).toBe('auto')
      const locus = (await host.adapter.findActive({ chatId: CHAT_ID }))
      expect(locus).toMatchObject({ state: 'active' })
      expect(locus?.childSessionId).toBeDefined()
      // Delivered in the SAME admission: the child that was just created
      // already received the message, not a second round trip.
      expect(host.queued).toHaveLength(1)
      expect(host.queued[0]!.childSessionId).toBe(locus?.childSessionId)
    } finally {
      await host.close()
    }
  })

  it('non-@ traffic before the first mention never builds anything', async () => {
    const host = await composeOnDemandHost()
    try {
      const result = await host.controller.handle(inbound('om-noise', 'just chatting', false))
      expect(result).toMatchObject({ kind: 'ignored', reason: 'no-mention' })
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(host.queued).toEqual([])
    } finally {
      await host.close()
    }
  })

  it('a build failure inside the first admission publishes no partial locus and leaves no group marker', async () => {
    const host = await composeOnDemandHost({ failFirstCreate: true })
    try {
      const result = await host.controller.handle(inbound('om-fails', '@Pet hello'))

      // The controller must not silently swallow this into an accepted
      // Delivery: a group that never got a working child must not look active.
      expect(result).not.toMatchObject({ kind: 'accepted' })
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(await host.adapter.findActive({ chatId: CHAT_ID })).toBeUndefined()
      expect(host.queued).toEqual([])
    } finally {
      await host.close()
    }
  })

  it('a failed build permanently blocks the same endpoint within the process (BACKLOG B040)', async () => {
    // This is EXISTING provisioning behavior, not something this change
    // introduces: `failProvisioning` marks the operation `phase: 'failed'`,
    // and the only code path that ever promotes `failed`/`needs-recovery` to
    // `compensated` (`persistence.ts` inside `reconcileStartup`) runs once at
    // Host startup, not on the next admission. `findBlockingProvisioningOperation`
    // treats `failed` as still-blocking. A same-process retry on the same
    // endpoint therefore does NOT recover — it fails again with a distinct,
    // durable "unresolved provisioning" reason, not the original transient
    // error. This pins the current behavior; B040 tracks making it recover
    // without a restart.
    const host = await composeOnDemandHost({ failFirstCreate: true })
    try {
      const first = await host.controller.handle(inbound('om-fails', '@Pet hello'))
      expect(first).not.toMatchObject({ kind: 'accepted' })

      const retried = await host.controller.handle(inbound('om-retry', '@Pet hello again'))
      expect(retried).not.toMatchObject({ kind: 'accepted' })
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(host.queued).toEqual([])
    } finally {
      await host.close()
    }
  })
})

describe('/bind on a not-yet-built endpoint builds directly, without an automatic detour', () => {
  it('a fresh endpoint bound before any @ is built once with the explicit main, no auto main, no warning', async () => {
    const host = await composeOnDemandHost()
    try {
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()

      // This is exactly what `createLocusControlDispatcher`'s `bind.bind`
      // does in production (`index.ts`): `ensureGroup` with an explicit
      // `parentSessionId`. No prior @ ever reached this endpoint, so there is
      // no automatic association to replace.
      const bound = await host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })

      expect(bound.created).toBe(true)
      expect(bound.group.mainSource).toBe('explicit')
      expect(bound.group.mainSessionId).toBe(PARENT_SESSION)
      expect(bound.locus.source).toBe('explicit')
      // The defining absence: no automatic main was ever created for this
      // endpoint to later be replaced. `provisionGroupLocked` never calls
      // `createMainSession` when an explicit parent is supplied — the parent
      // session count stays exactly what the fixture started with.
      const group = await host.adapter.findGroup(CHAT_ID)
      expect(group?.mainSource).toBe('explicit')
      // No "warningText" field at all — `replaceAutomaticGroupParentLocked`
      // (the only place that produces one) is never called on this path.
      expect('warningText' in bound).toBe(false)
    } finally {
      await host.close()
    }
  })

  it('an existing automatic locus still replaces with a warning when explicitly bound (regression)', async () => {
    // Pins the UNCHANGED behavior D4 promises to leave alone: once a group
    // already has an automatic main (built by a real first @, not by
    // bot-added), binding a different explicit parent must still go through
    // `replaceAutomaticGroupParentLocked` and carry its warning.
    const host = await composeOnDemandHost()
    try {
      const first = await host.controller.handle(inbound('om-first', '@Pet hello'))
      expect(first).toMatchObject({ kind: 'accepted' })
      const before = await host.adapter.findGroup(CHAT_ID)
      expect(before?.mainSource).toBe('auto')

      // `isLocusIdle` correctly refuses a switch while the first Delivery is
      // still current — finish it the way `pet_locus_finish(no-reply)` would,
      // so the switch itself, not an unrelated busy fence, is under test.
      // `now` stays on the SAME small monotonic scale as `LocusController`'s
      // own `now: () => sequence + 100`: a real `Date.now()` here would bump
      // the locus record's `updatedAt` far ahead of that scale, and the next
      // `ensureGroup`'s tiny `now` would then fail `transitionLocus`'s
      // monotonic check as if time had gone backward.
      const locus = await host.adapter.findActive({ chatId: CHAT_ID })
      const current = host.durable.findDeliveryByMessageId('om-first')!
      await host.durable.completeCurrentDelivery({
        endpoint: { chatId: CHAT_ID },
        locusId: locus!.locusId,
        generation: locus!.generation,
        childSessionId: locus!.childSessionId,
        deliveryId: current.deliveryId,
        now: host.now(),
        outcome: 'no-reply',
        outboundResult: 'none',
        reason: 'test setup: free the locus before the bind switch',
        ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
      })

      const rebound = await host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })

      // `created: true` is correct here: a genuine replace mints a NEW
      // generation (retiring the old one) — the true regression signal is the
      // new generation number and the switch warning, not `created` itself.
      expect(rebound.created).toBe(true)
      expect(rebound.locus.source).toBe('explicit')
      expect(rebound.locus.parentSessionId).toBe(PARENT_SESSION)
      expect(rebound.locus.generation).toBeGreaterThan(1)
      expect(rebound.locus.replacesLocusId).toBe(locus!.locusId)
      // The switch warning is exactly what a genuinely automatic-to-explicit
      // replacement must carry — this is the path D4 says stays untouched.
      expect(typeof rebound.warningText).toBe('string')
      expect(rebound.warningText!.length).toBeGreaterThan(0)
    } finally {
      await host.close()
    }
  })
})

describe('group and topic entries build on demand with structurally equivalent timing', () => {
  it('a topic\'s first qualifying @ builds the group root AND the topic child in the same admission, just like a bare group', async () => {
    const host = await composeOnDemandHost()
    const TOPIC_CHAT_ID = 'oc-on-demand-topic-host'
    const THREAD_ID = 'omt-on-demand'
    try {
      expect(await host.adapter.findGroup(TOPIC_CHAT_ID)).toBeUndefined()

      const result = await host.controller.handle(
        topicInbound(TOPIC_CHAT_ID, THREAD_ID, 'om-topic-first', '@Pet hello from topic'),
      )

      expect(result).toMatchObject({ kind: 'accepted' })
      // Exactly the same shape the bare-group test proved: no bot-added ever
      // touched this endpoint, yet the FIRST @ on the topic alone was enough
      // to establish both levels of the hierarchy at once — a group with no
      // dedicated topic child of its own, and the topic's own active locus.
      const group = await host.adapter.findGroup(TOPIC_CHAT_ID)
      expect(group).toBeDefined()
      expect(group?.mainSource).toBe('auto')
      const topicLocus = await host.adapter.findActive({ chatId: TOPIC_CHAT_ID, threadId: THREAD_ID })
      expect(topicLocus).toMatchObject({ state: 'active' })
      expect(topicLocus?.childSessionId).toBeDefined()
      // Delivered in the SAME admission, exactly like the bare-group case.
      expect(host.queued).toHaveLength(1)
      expect(host.queued[0]!.childSessionId).toBe(topicLocus?.childSessionId)
    } finally {
      await host.close()
    }
  })

  it('the topic child is a sibling of the group child under the same main, not built ahead of the group', async () => {
    const host = await composeOnDemandHost()
    const TOPIC_CHAT_ID = 'oc-on-demand-topic-sibling'
    const THREAD_ID = 'omt-sibling'
    try {
      const topicResult = await host.controller.handle(
        topicInbound(TOPIC_CHAT_ID, THREAD_ID, 'om-topic-a', '@Pet first in topic'),
      )
      expect(topicResult).toMatchObject({ kind: 'accepted' })

      const groupResult = await host.controller.handle(
        inboundFor(TOPIC_CHAT_ID, 'om-group-a', '@Pet first in group body'),
      )
      expect(groupResult).toMatchObject({ kind: 'accepted' })

      const group = await host.adapter.findGroup(TOPIC_CHAT_ID)
      const topicLocus = await host.adapter.findActive({ chatId: TOPIC_CHAT_ID, threadId: THREAD_ID })
      const groupLocus = await host.adapter.findActive({ chatId: TOPIC_CHAT_ID })

      // One group root shared by both; two distinct children — the group
      // level and the topic level never collapse into one child, and the
      // group-body message did not need its own separate bot-added trigger.
      expect(topicLocus?.parentSessionId).toBe(group?.mainSessionId)
      expect(groupLocus?.parentSessionId).toBe(group?.mainSessionId)
      expect(topicLocus?.childSessionId).not.toBe(groupLocus?.childSessionId)
      expect(host.queued).toHaveLength(2)
    } finally {
      await host.close()
    }
  })
})
