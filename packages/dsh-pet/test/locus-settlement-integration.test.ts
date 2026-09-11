/**
 * End-to-end settlement over the REAL parts: the durable locus repository, the
 * real per-turn observer, and the real channel controller.
 *
 * Every other locus test substitutes at least one of these. This one starts
 * from the two facts a Host runtime actually emits — an inbox claim and a turn
 * end — and asserts the durable Delivery reached `settled`. That is the gate
 * the unified capability has been waiting on: correlating a Feishu message to
 * the exact child turn that ran it, with no FIFO or child-id guessing.
 */

import { describe, expect, it, vi } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { createLocusTurnObserver } from '../src/host/locus/turn-observer.js'
import type { LocusInboxClaim, LocusTurnEnd } from '../src/host/locus/turn-observer.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'
import type { LocusReplyTarget } from '../src/host/locus/context.js'

const GROUP_ENDPOINT = { chatId: 'oc_settle' } as const
const ENDPOINT = { chatId: 'oc_settle', threadId: 'omt_settle' } as const
const PARENT = 'session-main'
const CHILD = 'session-child'

/** Boot the durable repository with one active locus generation. */
async function durableLocus(harness: PetHarness): Promise<LocusRepository> {
  const repository = new LocusRepository(harness.domain)
  await repository.putLocus({
    id: 'locus-settle-group',
    generation: 1,
    endpoint: GROUP_ENDPOINT,
    parentSessionId: PARENT,
    childSessionId: 'session-group-child',
    workspaceId: 'workspace-settle',
    source: 'auto',
    state: 'active',
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    busy: false,
    createdAt: 1,
    updatedAt: 1,
  })
  await repository.putLocus({
    id: 'locus-settle',
    generation: 1,
    endpoint: ENDPOINT,
    parentSessionId: PARENT,
    childSessionId: CHILD,
    workspaceId: 'workspace-settle',
    parentLocusId: 'locus-settle-group',
    source: 'inherited',
    state: 'active',
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    busy: false,
    createdAt: 2,
    updatedAt: 2,
  })
  return repository
}

/**
 * Compose the controller over the durable repository and the real observer.
 *
 * The runtime seams (`claimed` / `turn/end`) are the only doubles: they stand
 * in for the two events DSH emits, and the test drives them directly.
 */
async function composeSettlementHost(options: {
  readonly endBeforeBind?: 'completed' | 'failed'
} = {}) {
  const harness = await openPetHarness(emptyMedium())
  const repository = await durableLocus(harness)

  const claimListeners: ((claim: LocusInboxClaim) => void)[] = []
  const endListeners: ((end: LocusTurnEnd) => void)[] = []
  const observer = createLocusTurnObserver({
    onClaimed: (listener) => { claimListeners.push(listener); return () => {} },
    onTurnEnd: (listener) => { endListeners.push(listener); return () => {} },
    // The durable ledger is what resolves a claimed message to its Delivery:
    // exactly the lookup a production Host would supply.
    lookup: {
      find: ({ childSessionId, messageId }) => {
        const record = repository.findDeliveryByInboxMessageId(messageId)
        if (record === undefined || record.childSessionId !== childSessionId) return undefined
        if (record.executionId === undefined) return undefined
        return {
          deliveryId: record.deliveryId,
          executionId: record.executionId,
          correlation: {
            endpoint: record.endpoint,
            locusId: record.locusId,
            generation: record.generation,
            childSessionId: record.childSessionId,
          },
        }
      },
    },
  })

  const queued: { messageId: string; turn: number }[] = []
  let livePolicy: { mode?: string; workspaceRoot?: string } | undefined = {
    mode: 'read-only', workspaceRoot: '/repo',
  }
  const settledReactions: { target: LocusReplyTarget; outcome: string }[] = []
  const diagnostics: string[] = []
  // The REAL durable resolution adapter, not a fixed row: this is what proves
  // the endpoint index, the stop marker and the child identity are honoured.
  const resolution = createLocusResolution({ store: repository })
  const controller = new LocusChannelController({
    locus: resolution as never,
    // Thin naming adapter over the durable repository: the controller's port
    // uses `accept`/`findByMessageId`, the repository exposes the durable
    // `acceptDelivery`/`findDeliveryByMessageId`. Everything below the names
    // is the real durable implementation.
    deliveries: {
      findByMessageId: (messageId: string) => repository.findDeliveryByMessageId(messageId),
      getById: (deliveryId: string) => repository.getDelivery(deliveryId),
      accept: (input: never) => repository.acceptDelivery(input),
      bindQueued: (input: never) => repository.bindQueued(input),
      bindTurn: (input: never) => repository.bindTurn(input),
      settleByTurn: (input: never) => repository.settleByTurn(input),
    } as never,
    child: {
      ensureChild: () => ({ parentSessionId: PARENT, childSessionId: CHILD }),
      withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: CHILD }) }),
      queueChild: async (input) => {
        // A real Host queues the turn and the runtime reports the claim; the
        // claim can arrive before this call resolves, which is why the
        // observer is subscribed before any Delivery is queued.
        const inboxMessageId = `inbox-${input.deliveryId}`
        const turn = queued.length + 1
        queued.push({ messageId: inboxMessageId, turn })
        if (options.endBeforeBind !== undefined) {
          for (const listener of claimListeners) {
            listener({ childSessionId: CHILD, messageId: inboxMessageId, turn })
          }
          for (const listener of endListeners) {
            listener({
              childSessionId: CHILD,
              turn,
              outcome: options.endBeforeBind,
              ...(options.endBeforeBind === 'failed' ? { reason: 'early failure' } : {}),
            })
          }
          // Deliberately exceed the former fixed ~200ms polling window before
          // returning the queue result and allowing bindQueued to commit.
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        return { accepted: true as const, executionId: input.executionId, inboxMessageId }
      },
    },
    resolveLivePolicy: () => livePolicy,
    invalidatePolicyDrift: ({ locus, reason }) => repository.invalidateLocus(
      locus.id ?? locus.locusId ?? '', reason, Date.now(), undefined,
    ),
    turns: observer,
    receipts: {
      markAccepted: () => {},
      markSettled: (target, outcome) => { settledReactions.push({ target, outcome }) },
    },
    admissionContext: {
      botOpenId: 'ou_bot',
      allowlist: ['ou_owner'],
      startupWatermark: 0,
    },
    log: (code) => { diagnostics.push(code) },
  })

  return {
    harness,
    repository,
    controller,
    observer,
    queued,
    settledReactions,
    diagnostics,
    setLivePolicy: (policy: typeof livePolicy) => { livePolicy = policy },
    claim: (claim: LocusInboxClaim) => { for (const listener of claimListeners) listener(claim) },
    end: (end: LocusTurnEnd) => { for (const listener of endListeners) listener(end) },
    close: async () => {
      observer.dispose()
      controller.dispose()
      await harness.close()
    },
  }
}

/** One admitted Feishu message, already past mention/allowlist admission. */
function admission(messageId: string) {
  return {
    kind: 'accepted' as const,
    authorization: 'authorized' as const,
    needsInitialization: false,
    message: {
      kind: 'message' as const,
      messageId,
      endpoint: ENDPOINT,
      chatType: 'group' as const,
      senderOpenId: 'ou_owner',
      text: '请看这个问题',
      replyTarget: { chatId: ENDPOINT.chatId, threadId: ENDPOINT.threadId, messageId },
      createdAt: 10,
    },
  }
}

describe('durable Delivery settles against its exact child turn', () => {
  it('carries one accepted message from claim to a settled durable record', async () => {
    const host = await composeSettlementHost()
    try {
      const accepted = await host.controller.handleAdmission(admission('om_first') as never)
      expect(accepted.kind).toBe('accepted')

      const delivery = host.repository.findDeliveryByMessageId('om_first')
      expect(delivery?.status).toBe('queued')

      // The two facts a real runtime emits, nothing else.
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1 })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await vi.waitFor(() => {
        expect(host.repository.findDeliveryByMessageId('om_first')?.status).toBe('settled')
      })

      const settled = host.repository.findDeliveryByMessageId('om_first')
      // The durable record carries the exact proof, not a guess.
      expect(settled?.turnId).toBe(`${CHILD}#1`)
      expect(settled?.executionId).toBeDefined()
      expect(host.settledReactions).toEqual([
        { target: expect.objectContaining({ messageId: 'om_first' }), outcome: 'settled' },
      ])
      // Settling the only pending Delivery releases the locus busy fence.
      expect(host.repository.getLocus('locus-settle')?.busy).toBe(false)
    } finally {
      await host.close()
    }
  })

  it.each(['completed', 'failed'] as const)(
    'settles %s end-before-bind after a delay beyond 200ms',
    async outcome => {
      const host = await composeSettlementHost({ endBeforeBind: outcome })
      try {
        const result = await host.controller.handleAdmission(admission(`om_delayed_${outcome}`) as never)
        expect(result.kind).toBe('accepted')
        const record = host.repository.findDeliveryByMessageId(`om_delayed_${outcome}`)
        expect(record).toMatchObject({
          status: outcome === 'completed' ? 'settled' : 'failed',
          turnId: `${CHILD}#1`,
        })
        expect(host.settledReactions).toEqual([
          expect.objectContaining({ outcome: outcome === 'completed' ? 'settled' : 'failed' }),
        ])
      } finally {
        await host.close()
      }
    },
  )

  it('settles consecutive messages against their own inbox and turn proofs', async () => {
    const host = await composeSettlementHost()
    try {
      await host.controller.handleAdmission(admission('om_a') as never)
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1 })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await vi.waitFor(() => {
        expect(host.repository.findDeliveryByMessageId('om_a')?.status).toBe('settled')
      })

      await host.controller.handleAdmission(admission('om_b') as never)
      host.claim({ childSessionId: CHILD, messageId: host.queued[1]!.messageId, turn: 2 })
      host.end({ childSessionId: CHILD, turn: 2, outcome: 'failed', reason: 'model error' })
      await vi.waitFor(() => {
        expect(host.repository.findDeliveryByMessageId('om_b')?.status).toBe('failed')
      })

      expect(host.repository.findDeliveryByMessageId('om_a')?.turnId).toBe(`${CHILD}#1`)
      expect(host.repository.findDeliveryByMessageId('om_b')?.turnId).toBe(`${CHILD}#2`)
      expect(host.repository.findDeliveryByMessageId('om_b')?.failureReason).toContain('model error')
      expect(host.settledReactions.map(entry => entry.target.messageId)).toEqual(['om_a', 'om_b'])
    } finally {
      await host.close()
    }
  })

  it('recovers exact queued settlement after controller in-memory state is lost', async () => {
    const host = await composeSettlementHost()
    try {
      const accepted = await host.controller.handleAdmission(admission('om_restart') as never)
      expect(accepted.kind).toBe('accepted')
      host.controller.dispose()

      const recovered = new LocusChannelController({
        locus: createLocusResolution({ store: host.repository }) as never,
        deliveries: {
          findByMessageId: (messageId: string) => host.repository.findDeliveryByMessageId(messageId),
          getById: (deliveryId: string) => host.repository.getDelivery(deliveryId),
          accept: (input: never) => host.repository.acceptDelivery(input),
          bindQueued: (input: never) => host.repository.bindQueued(input),
          bindTurn: (input: never) => host.repository.bindTurn(input),
          settleByTurn: (input: never) => host.repository.settleByTurn(input),
        } as never,
        child: { ensureChild: () => undefined, queueChild: async () => ({ accepted: false as const, reason: 'unused' }) },
        turns: host.observer,
        receipts: { markAccepted: () => {}, markSettled: () => {} },
      })
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 8 })
      host.end({ childSessionId: CHILD, turn: 8, outcome: 'completed' })
      await vi.waitFor(() => expect(host.repository.findDeliveryByMessageId('om_restart')?.status).toBe('settled'))
      recovered.dispose()
    } finally {
      await host.close()
    }
  })

  it('never settles a Delivery from an unrelated turn of the same child', async () => {
    const host = await composeSettlementHost()
    try {
      await host.controller.handleAdmission(admission('om_only') as never)
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 2 })

      // An initialization or GUI turn of the SAME child ends. It claimed no
      // Delivery, so it must not consume this one's pending feedback.
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(host.repository.findDeliveryByMessageId('om_only')?.status).toBe('running')
      expect(host.settledReactions).toEqual([])
    } finally {
      await host.close()
    }
  })

  it('persists invalid and accepts nothing when live policy drifts between ordinary Deliveries', async () => {
    const host = await composeSettlementHost()
    try {
      const first = await host.controller.handleAdmission(admission('om_before_drift') as never)
      expect(first.kind).toBe('accepted')
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1 })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await vi.waitFor(() => expect(host.repository.findDeliveryByMessageId('om_before_drift')?.status).toBe('settled'))
      const queuedBefore = host.queued.length

      host.setLivePolicy({ mode: 'danger-full-access', workspaceRoot: '/repo' })
      await expect(host.controller.handleAdmission(admission('om_after_drift') as never)).resolves.toEqual({
        kind: 'refused', reason: 'policy-drift',
      })
      expect(host.repository.findDeliveryByMessageId('om_after_drift')).toBeUndefined()
      expect(host.queued).toHaveLength(queuedBefore)
      expect(host.repository.getLocus('locus-settle')).toMatchObject({
        state: 'invalid',
        permission: { effective: 'read' },
        invalidReason: expect.stringContaining('不一致'),
      })
    } finally {
      await host.close()
    }
  })

  it('refuses an ordinary message on a stopped endpoint instead of reviving it', async () => {
    const host = await composeSettlementHost()
    try {
      await host.repository.stopLocus('locus-settle', 20)

      const refused = await host.controller.handleAdmission(admission('om_after_stop') as never)

      // The owner's stop is authoritative. An ordinary at-message must not
      // auto-create a replacement generation, and must not queue work.
      expect(refused.kind).not.toBe('accepted')
      expect(host.repository.findDeliveryByMessageId('om_after_stop')).toBeUndefined()
      expect(host.queued).toEqual([])
      expect(host.repository.getLocus('locus-settle')?.state).toBe('stopped')
    } finally {
      await host.close()
    }
  })

  it('keeps a settled Delivery settled when its turn end is reported twice', async () => {
    const host = await composeSettlementHost()
    try {
      await host.controller.handleAdmission(admission('om_dup') as never)
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1 })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await vi.waitFor(() => {
        expect(host.repository.findDeliveryByMessageId('om_dup')?.status).toBe('settled')
      })

      // A duplicate, contradicting end must not rewrite a terminal record.
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'failed' })
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(host.repository.findDeliveryByMessageId('om_dup')?.status).toBe('settled')
      expect(host.settledReactions).toHaveLength(1)
    } finally {
      await host.close()
    }
  })
})
