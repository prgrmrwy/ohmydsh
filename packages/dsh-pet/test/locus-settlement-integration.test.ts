/**
 * End-to-end Delivery lifecycle over the REAL parts: the durable locus
 * repository, the real per-turn observer, and the real channel controller.
 *
 * Every other locus test substitutes at least one of these. This one starts
 * from the facts a Host runtime actually emits — an inbox claim, a turn end,
 * and a durable finish CAS — and asserts the durable Delivery reaches its
 * business terminal state. `turn/end` is diagnostic-only execution evidence:
 * it never settles a Delivery. Only `pet_locus_finish` (durable
 * `markDeliveryFinishing`/`completeCurrentDelivery`, exercised here directly
 * against the repository, the way the Host lifecycle callback would) or
 * deadline expiry may terminate one.
 */

import { describe, expect, it, vi } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { createLocusTurnObserver } from '../src/host/locus/turn-observer.js'
import type { LocusInboxClaim, LocusTurnEnd } from '../src/host/locus/turn-observer.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'
import type { LocusReplyTarget } from '../src/host/locus/context.js'
import type { DeliveryCorrelation } from '../src/host/locus/delivery.js'

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
 * in for the two events DSH emits, and the test drives them directly. The
 * durable current-claim seam (`deliveryDispatch`) is the REAL repository too:
 * `LocusControllerDeps.deliveryDispatch` is a required production dependency,
 * and this suite exists specifically to prove the real claim/finish/advance
 * lifecycle end to end.
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
      fail: (input: never) => repository.fail(input),
    } as never,
    // The REAL durable current/backlog claim seam. Production requires this;
    // this suite is the one place its full lifecycle (claim -> queue -> real
    // observer proof -> durable finish -> successor claim) runs together.
    deliveryDispatch: {
      claimCurrent: (input: { readonly correlation: DeliveryCorrelation; readonly deliveryId?: string; readonly now: number }) =>
        repository.claimCurrentDelivery(input),
      currentFinished: () => {},
      dispatchNext: async (correlation: DeliveryCorrelation) => { await controller.dispatchNext(correlation) },
      scheduleCurrent: () => {},
    },
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
            listener({ childSessionId: CHILD, messageId: inboxMessageId, turn, sourceKind: 'user' })
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
    /**
     * Finish the exact durable current Delivery the way the Host lifecycle
     * callback does: CAS to `finishing` for a reply, or directly complete for
     * a no-reply, then advance the locus via `currentFinished`/`dispatchNext`.
     */
    finish: async (
      correlation: DeliveryCorrelation,
      outcome: 'reply' | 'no-reply',
      options2: { readonly outboundResult?: 'success' | 'failure' | 'unknown'; readonly reason?: string } = {},
    ) => {
      const current = repository.findCurrentSerializedDelivery({
        childSessionId: correlation.childSessionId,
        locusId: correlation.locusId,
        generation: correlation.generation,
      })
      if (current === undefined) throw new Error('no current Delivery to finish')
      const now = Date.now()
      if (outcome === 'no-reply') {
        await repository.completeCurrentDelivery({
          ...correlation,
          deliveryId: current.deliveryId,
          now,
          outcome: 'no-reply',
          outboundResult: 'none',
          reason: options2.reason ?? 'test no-reply',
          ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
        })
      } else {
        const finishing = await repository.markDeliveryFinishing({
          ...correlation,
          deliveryId: current.deliveryId,
          now,
          ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
        })
        await repository.completeCurrentDelivery({
          ...correlation,
          deliveryId: current.deliveryId,
          now: Date.now(),
          outcome: 'reply',
          outboundResult: options2.outboundResult ?? 'success',
          ...(finishing.record?.revision === undefined ? {} : { expectedRevision: finishing.record.revision }),
        })
      }
      controller.currentFinished({ deliveryId: current.deliveryId, correlation })
      await controller.dispatchNext(correlation)
    },
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

const CORRELATION: DeliveryCorrelation = {
  endpoint: ENDPOINT,
  locusId: 'locus-settle',
  generation: 1,
  childSessionId: CHILD,
}

describe('durable Delivery lifecycle against its exact child turn', () => {
  it('carries one accepted message through current, real turn proof, and a durable finish', async () => {
    const host = await composeSettlementHost()
    try {
      const accepted = await host.controller.handleAdmission(admission('om_first') as never)
      expect(accepted.kind).toBe('accepted')

      // `claimCurrent` promotes accepted -> current before queueing.
      const delivery = host.repository.findDeliveryByMessageId('om_first')
      expect(delivery?.status).toBe('current')

      // The two facts a real runtime emits. `turn/end` is diagnostic only: it
      // must NOT settle the Delivery on its own.
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1, sourceKind: 'user' })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(host.repository.findDeliveryByMessageId('om_first')?.status).toBe('current')
      expect(host.settledReactions).toEqual([])

      // Only the durable finish operation (what the Host lifecycle callback
      // performs for `pet_locus_finish`) reaches a business terminal state.
      await host.finish(CORRELATION, 'reply')
      const settled = host.repository.findDeliveryByMessageId('om_first')
      expect(settled?.status).toBe('replied')
      expect(settled?.turnId).toBe(`${CHILD}#1`)
      expect(settled?.executionId).toBeDefined()
      expect(host.settledReactions).toEqual([
        { target: expect.objectContaining({ messageId: 'om_first' }), outcome: 'settled' },
      ])
      // Finishing the only pending Delivery releases the locus busy fence.
      expect(host.repository.getLocus('locus-settle')?.busy).toBe(false)
    } finally {
      await host.close()
    }
  })

  it.each(['completed', 'failed'] as const)(
    'stays current after %s end-before-bind after a delay beyond 200ms, until explicitly finished',
    async outcome => {
      const host = await composeSettlementHost({ endBeforeBind: outcome })
      try {
        const result = await host.controller.handleAdmission(admission(`om_delayed_${outcome}`) as never)
        expect(result.kind).toBe('accepted')
        const record = host.repository.findDeliveryByMessageId(`om_delayed_${outcome}`)
        // A `completed`/`failed` execution-evidence event is diagnostic only:
        // the exact turn is still bound, but the Delivery stays `current`.
        expect(record).toMatchObject({ status: 'current', turnId: `${CHILD}#1` })
        expect(host.settledReactions).toEqual([])

        await host.finish(CORRELATION, outcome === 'completed' ? 'reply' : 'no-reply',
          outcome === 'completed' ? {} : { reason: 'early failure' })
        const finished = host.repository.findDeliveryByMessageId(`om_delayed_${outcome}`)
        expect(finished?.status).toBe(outcome === 'completed' ? 'replied' : 'no-reply')
      } finally {
        await host.close()
      }
    },
  )

  it('serializes consecutive messages: B stays backlog while A is current, and dispatches once A finishes', async () => {
    const host = await composeSettlementHost()
    try {
      await host.controller.handleAdmission(admission('om_a') as never)
      expect(host.repository.findDeliveryByMessageId('om_a')?.status).toBe('current')
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1, sourceKind: 'user' })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })

      // B is accepted while A is still current: it must be durably backlogged,
      // not injected into the child inbox.
      const acceptedB = await host.controller.handleAdmission(admission('om_b') as never)
      expect(acceptedB.kind).toBe('accepted')
      expect(host.repository.findDeliveryByMessageId('om_b')?.status).toBe('accepted')
      expect(host.queued).toHaveLength(1)

      await host.finish(CORRELATION, 'reply')
      expect(host.repository.findDeliveryByMessageId('om_a')?.status).toBe('replied')

      // A's finish must claim and physically queue B exactly once.
      await vi.waitFor(() => {
        expect(host.repository.findDeliveryByMessageId('om_b')?.status).toBe('current')
      })
      expect(host.queued).toHaveLength(2)
      host.claim({ childSessionId: CHILD, messageId: host.queued[1]!.messageId, turn: 2, sourceKind: 'user' })
      host.end({ childSessionId: CHILD, turn: 2, outcome: 'failed', reason: 'model error' })
      // The observer binds the turn asynchronously (`void this.observe(...)`
      // in the real runtime subscription wrapper); wait for the durable
      // `turnId` before finishing, the way a real Delivery prompt turn would
      // only call `pet_locus_finish` after it has actually started.
      await vi.waitFor(() => {
        expect(host.repository.findDeliveryByMessageId('om_b')?.turnId).toBe(`${CHILD}#2`)
      })
      await host.finish(CORRELATION, 'no-reply', { reason: 'model error' })

      expect(host.repository.findDeliveryByMessageId('om_a')?.turnId).toBe(`${CHILD}#1`)
      expect(host.repository.findDeliveryByMessageId('om_b')?.turnId).toBe(`${CHILD}#2`)
      expect(host.repository.findDeliveryByMessageId('om_b')?.status).toBe('no-reply')
      expect(host.settledReactions.map(entry => entry.target.messageId)).toEqual(['om_a', 'om_b'])
    } finally {
      await host.close()
    }
  })

  it('recovers the exact current Delivery after controller in-memory state is lost', async () => {
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
        } as never,
        deliveryDispatch: {
          claimCurrent: (input: { readonly correlation: DeliveryCorrelation; readonly deliveryId?: string; readonly now: number }) =>
            host.repository.claimCurrentDelivery(input),
        },
        child: { ensureChild: () => undefined, queueChild: async () => ({ accepted: false as const, reason: 'unused' }) },
        turns: host.observer,
        receipts: { markAccepted: () => {}, markSettled: () => {} },
      })
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 8, sourceKind: 'user' })
      host.end({ childSessionId: CHILD, turn: 8, outcome: 'completed' })
      await new Promise(resolve => setTimeout(resolve, 20))
      // The durable current row survives the controller's in-memory loss; it
      // is still `current`, ready for a durable finish, not auto-settled.
      expect(host.repository.findDeliveryByMessageId('om_restart')?.status).toBe('current')
      expect(host.repository.findDeliveryByMessageId('om_restart')?.turnId).toBe(`${CHILD}#8`)
      recovered.dispose()
    } finally {
      await host.close()
    }
  })

  it('never lets an unrelated turn of the same child produce a settlement receipt', async () => {
    const host = await composeSettlementHost()
    try {
      await host.controller.handleAdmission(admission('om_only') as never)
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 2, sourceKind: 'user' })

      // An initialization or GUI turn of the SAME child ends. It claimed no
      // Delivery, so it must not consume this one's pending feedback.
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(host.repository.findDeliveryByMessageId('om_only')?.status).toBe('current')
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
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1, sourceKind: 'user' })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await host.finish(CORRELATION, 'reply')
      expect(host.repository.findDeliveryByMessageId('om_before_drift')?.status).toBe('replied')
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

  it('keeps a finished Delivery finished when its turn end is reported twice', async () => {
    const host = await composeSettlementHost()
    try {
      await host.controller.handleAdmission(admission('om_dup') as never)
      host.claim({ childSessionId: CHILD, messageId: host.queued[0]!.messageId, turn: 1, sourceKind: 'user' })
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'completed' })
      await host.finish(CORRELATION, 'reply')
      expect(host.repository.findDeliveryByMessageId('om_dup')?.status).toBe('replied')

      // A duplicate, contradicting end must not rewrite a terminal record —
      // and must not even reach settlement logic, since turn/end is ignored.
      host.end({ childSessionId: CHILD, turn: 1, outcome: 'failed' })
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(host.repository.findDeliveryByMessageId('om_dup')?.status).toBe('replied')
      expect(host.settledReactions).toHaveLength(1)
    } finally {
      await host.close()
    }
  })
})
