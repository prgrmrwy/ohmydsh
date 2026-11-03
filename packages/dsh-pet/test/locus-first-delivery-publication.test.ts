import { describe, expect, it } from 'vitest'
import { createFirstDeliveryPublication } from '../src/host/locus/first-delivery-publication.js'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'
import { openThreeTier } from './support/three-tier.js'
import { petLocusDelivery } from '../src/host/spec.js'
import { createLocusLazyChildCreator } from '../src/host/locus/lazy-child.js'
import { createLocusChildAdapter, type LocusLiveParent } from '../src/host/locus/child.js'
import { composeLocusChild, LOCUS_SAFE_TOOL_NAMES, LOCUS_CALLER_BOUND_TOOLS } from '../src/host/locus/composition.js'
import { createPrepublicationCompositionLookup, LocusPrepublicationStagingRegistry } from '../src/host/locus/prepublication-staging.js'
import { createLocusTurnObserver, type LocusInboxClaim, type LocusTurnEnd } from '../src/host/locus/turn-observer.js'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'
import { createDeliveryExecutionProof } from '../src/host/locus/delivery-execution-proof.js'
import { createRefusedReplyTracker } from '../src/host/locus/refused-reply.js'
import { FakeOfficialRuntime } from './support/official-subagent.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'

async function fixture() {
  const world = await openThreeTier()
  const result = await world.controller.ensureGroup({ chatId: 'chat', parentSessionId: 'work-1' })
  const row = world.durable.getLocus(result.locus.locusId)!
  const correlation = { locusId: row.id, generation: row.generation, childSessionId: row.reservedChildSessionId!, endpoint: row.endpoint }
  const accepted = await world.durable.acceptDelivery({ ...correlation, messageId: 'message', senderOpenId: 'owner', text: 'question', acceptedAt: 1000 })
  const claimed = await world.durable.claimCurrentDelivery({ correlation, now: 1001 })
  if (!claimed) throw new Error('missing current')
  const firstPrompts = createFirstPromptRegistry({
    bindQueued: async (delivery, messageId) => {
      const bound = await world.durable.bindQueued({ deliveryId: delivery.deliveryId, correlation: delivery.correlation, executionId: delivery.executionId, inboxMessageId: messageId, queuedAt: 1003 })
      if (!bound) throw new Error('binding refused')
    },
  })
  const publication = createFirstDeliveryPublication({ repository: world.durable, firstPrompts, now: () => 1002 })({
    locus: { ...correlation, id: row.id, parentSessionId: row.parentSessionId, state: 'not-created' },
    deliveryId: accepted.record.deliveryId, executionId: 'execution',
  })
  const composition = { ...correlation, parentSessionId: row.parentSessionId, permission: 'read' as const, childComposition: 'tier3' as const }
  return { world, row, correlation, accepted, firstPrompts, publication, composition }
}

describe('durable first Delivery publication', () => {
  it('resolves the first context and refused-turn association before API return, then fails A and releases B exactly once', async () => {
    const f = await fixture()
    const runtime = new FakeOfficialRuntime()
    runtime.addParent(f.row.parentSessionId)
    const staging = new LocusPrepublicationStagingRegistry()
    let claim!: (value: LocusInboxClaim) => void
    let ended!: (value: LocusTurnEnd) => void
    const observer = createLocusTurnObserver({
      onClaimed: listener => { claim = listener; return () => {} },
      onTurnEnd: listener => { ended = listener; return () => {} },
      lookup: { find: input => {
        const durable = f.world.durable.findDeliveryByInboxMessageId(input.messageId)
        return durable ? { deliveryId: durable.deliveryId, executionId: durable.executionId!, correlation: f.correlation } : f.firstPrompts.resolve(input)
      } },
    })
    runtime.agentCreatedListeners.push(async ({ agent }) => {
      const composed = composeLocusChild({ id: agent.id, scope: agent.ctx }, {
        lookup: createPrepublicationCompositionLookup({ durable: { find: () => undefined }, staging }),
        parentPreset: () => 'locus-base',
        policy: { apply: () => {}, resolve: () => 'read' },
        surface: { install: () => {}, setToolTier: () => {}, installOutboundGuard: () => {}, visibleTools: () => [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS] },
      })
      if (composed.composed) await staging.publishClaimed(agent.id)
    })
    const creator = createLocusLazyChildCreator({ staging, presetDeclared: () => true, createAdapter: () => createLocusChildAdapter({
      parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent, resume: async () => undefined },
      subagent: { startContinuable: spec => runtime.startContinuable(spec as never), getProvider: name => runtime.getProvider(name) },
    }) })
    try {
      await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'next', senderOpenId: 'owner', text: 'next', acceptedAt: 1001 })
      let advances = 0
      const tracker = createRefusedReplyTracker({
        getDelivery: id => f.world.durable.getDelivery(id), isActive: () => true,
        abandonRefusedDelivery: input => f.world.durable.abandonRefusedDelivery(input),
        withDispatchLane: async (_scope, operation) => operation(),
        finishAndAdvance: async () => { advances++; await f.world.durable.claimCurrentDelivery({ correlation: f.correlation, now: 1005 }) },
        now: () => 1004,
      })
      runtime.onClaim = async ({ childId, messageId }) => {
        expect(staging.activeCount).toBe(0)
        claim({ childSessionId: childId, messageId, turn: 1, sourceKind: 'user' })
        await f.firstPrompts.whenBound(childId)
        const capability = observer.currentCapabilityForChild!(childId)!
        const context = asLocusContextRepository(f.world.durable, id => observer.currentForChild!(id))
        expect(context.authorizeCurrentDelivery!({ childSessionId: childId, operation: 'finish', proof: capability })).toMatchObject({ currentDelivery: { deliveryId: f.accepted.record.deliveryId } })
        const proof = createDeliveryExecutionProof({ currentForChild: () => f.world.durable.listDeliveries(), findByInboxMessageId: id => f.world.durable.findDeliveryByInboxMessageId(id), deliveryForTurn: (id, turn) => observer.deliveryForTurn!(id, turn), isActive: () => true })({ agent: { id: childId, session: { snapshotEvents: () => [{ type: 'turn/start', data: { turn: 1 } }] } } })
        expect(proof).toMatchObject({ sessionId: childId, turn: 1 })
        tracker.refused(f.world.durable.getDelivery(f.accepted.record.deliveryId)!, proof!.turn)
        ended({ childSessionId: childId, turn: 1, outcome: 'completed' })
        await tracker.end(childId, 1)
        await tracker.end(childId, 1)
        expect(runtime.milestones).not.toContain(`returned:${childId}`)
      }
      expect(await creator.create({ childSessionId: f.correlation.childSessionId, parentSessionId: f.row.parentSessionId, workspaceId: f.row.workspaceId, locusId: f.row.id, generation: f.row.generation, label: 'entry', endpoint: f.row.endpoint, permission: 'read', prompt: [{ type: 'text', text: 'first' }], ...f.publication })).toMatchObject({ ok: true })
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)).toMatchObject({ status: 'failed', failureReason: 'reply-refused' })
      expect(f.world.durable.findDeliveryByMessageId('next')).toMatchObject({ status: 'current' })
      expect(advances).toBe(1)
      expect(runtime.startCalls).toHaveLength(1)
      expect(runtime.queueCalls).toHaveLength(0)
    } finally { observer.dispose(); staging.dispose(); await f.world.close() }
  })

  it('rotates a failed prepublication Session id and retargets only unissued backlog without changing generation', async () => {
    const f = await fixture()
    try {
      const backlog = await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'backlog', senderOpenId: 'owner', text: 'next', acceptedAt: 1001 })
      await f.publication.failed?.(f.correlation.childSessionId)
      const next = f.world.durable.getLocus(f.row.id)!
      expect(next).toMatchObject({ state: 'not-created', generation: f.row.generation })
      expect(next.reservedChildSessionId).not.toBe(f.correlation.childSessionId)
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)).toMatchObject({ status: 'failed', childSessionId: f.correlation.childSessionId })
      expect(f.world.durable.getDelivery(backlog.record.deliveryId)).toMatchObject({ status: 'accepted', childSessionId: next.reservedChildSessionId })
      const current = await f.world.durable.claimCurrentDelivery({ correlation: { ...f.correlation, childSessionId: next.reservedChildSessionId! }, now: 1003 })
      expect(current?.deliveryId).toBe(backlog.record.deliveryId)
    } finally { await f.world.close() }
  })

  it('creates the next backlog prompt with a fresh id after the official runtime persisted a vetoed child', async () => {
    const f = await fixture()
    const runtime = new FakeOfficialRuntime()
    runtime.addParent(f.row.parentSessionId)
    const staging = new LocusPrepublicationStagingRegistry()
    let veto = true
    runtime.agentCreatedListeners.push(async ({ agent }) => {
      staging.claim(agent.id)
      if (veto) throw new Error('composition readback refused')
      await staging.publishClaimed(agent.id)
    })
    runtime.onClaim = ({ childId, messageId }) => { f.firstPrompts.resolve({ childSessionId: childId, messageId }) }
    const creator = createLocusLazyChildCreator({ staging, presetDeclared: () => true, createAdapter: () => createLocusChildAdapter({
      parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent, resume: async () => undefined },
      subagent: { startContinuable: spec => runtime.startContinuable(spec as never), getProvider: name => runtime.getProvider(name) },
    }) })
    const request = { parentSessionId: f.row.parentSessionId, workspaceId: f.row.workspaceId, locusId: f.row.id, generation: f.row.generation, label: 'entry', endpoint: f.row.endpoint, permission: 'read' as const, prompt: [{ type: 'text' as const, text: 'first' }] }
    try {
      const b = await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'backlog', senderOpenId: 'owner', text: 'next', acceptedAt: 1001 })
      expect(await creator.create({ ...request, childSessionId: f.correlation.childSessionId, ...f.publication })).toMatchObject({ ok: false, retryable: false })
      expect(runtime.persisted.has(f.correlation.childSessionId)).toBe(true)
      veto = false
      const row = f.world.durable.getLocus(f.row.id)!
      const nextCorrelation = { ...f.correlation, childSessionId: row.reservedChildSessionId! }
      const next = await f.world.durable.claimCurrentDelivery({ correlation: nextCorrelation, now: 1003 })
      expect(next?.deliveryId).toBe(b.record.deliveryId)
      const publication = createFirstDeliveryPublication({ repository: f.world.durable, firstPrompts: f.firstPrompts, now: () => 1003 })({ locus: { ...row, childSessionId: row.reservedChildSessionId! }, deliveryId: b.record.deliveryId, executionId: 'execution-b' })
      expect(await creator.create({ ...request, childSessionId: row.reservedChildSessionId!, ...publication })).toMatchObject({ ok: true })
      expect(runtime.startCalls.map(call => call.childId)).toEqual([f.correlation.childSessionId, row.reservedChildSessionId])
      expect(f.world.durable.getLocus(f.row.id)).toMatchObject({ state: 'active', generation: f.row.generation, childSessionId: row.reservedChildSessionId })
    } finally { staging.dispose(); await f.world.close() }
  })

  it('preserves an unissued current on a not-created generation across restart for capacity retry', async () => {
    const f = await fixture()
    try {
      const recovered = await f.world.durable.reconcileStartup({ now: 1002 })
      expect(recovered.manualDeliveries).toHaveLength(0)
      expect(recovered.replayableDeliveries).toMatchObject([{ deliveryId: f.accepted.record.deliveryId, status: 'current' }])
      expect(f.world.durable.getLocus(f.row.id)).toMatchObject({ state: 'not-created', reservedChildSessionId: f.correlation.childSessionId })
    } finally { await f.world.close() }
  })

  it('rejects text retry compensation after A expired and B became current', async () => {
    const f = await fixture()
    try {
      const b = await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'B', text: 'B', senderOpenId: 'owner', acceptedAt: 1002 })
      await f.publication.publish(f.correlation.childSessionId, f.composition)
      const deadline = f.world.durable.getDelivery(f.accepted.record.deliveryId)!.deadlineAt!
      await f.world.durable.expireCurrentDelivery({ ...f.correlation, deliveryId: f.accepted.record.deliveryId, now: deadline })
      await f.world.durable.claimCurrentDelivery({ correlation: f.correlation, now: deadline + 1 })
      await expect(f.publication.retryText!(f.correlation.childSessionId)).rejects.toThrow('same unissued first current')
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)?.status).toBe('expired')
      expect(f.world.durable.getDelivery(b.record.deliveryId)).toMatchObject({ status: 'current', childSessionId: f.correlation.childSessionId })
    } finally { await f.world.close() }
  })

  it.each([true, false])('首图补偿失败保留恢复债务: leaves recovery debt if atomic text compensation fails (published=%s)', async publish => {
    const f = await fixture()
    try {
      if (publish) await f.publication.publish(f.correlation.childSessionId, f.composition)
      f.world.harness.failNextAtomicBatch(2)
      await expect(f.publication.retryText!(f.correlation.childSessionId)).rejects.toThrow('injected atomic write failure #2')
      expect(f.world.durable.getOperation('first-child:execution')?.phase).toBe('needs-recovery')
      expect(f.world.durable.hasFirstDeliveryRecoveryDebt(f.row.id)).toBe(true)
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)).toMatchObject({ status: 'current', childSessionId: f.correlation.childSessionId })
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)?.executionId).toBe(publish ? 'execution' : undefined)
      const recovered = await f.world.durable.reconcileStartup({ now: 1005 })
      expect(recovered.manualOperations).toHaveLength(1)
      expect(recovered.replayableDeliveries).toHaveLength(0)
    } finally { await f.world.close() }
  })

  it('publishes marker/current/execution before claim and persists its inbox association before first tool', async () => {
    const f = await fixture()
    try {
      await f.publication.publish(f.correlation.childSessionId, f.composition)
      expect(f.world.durable.getLocus(f.row.id)).toMatchObject({ state: 'active', childComposition: 'tier3', busy: true })
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)).toMatchObject({ status: 'current', executionId: 'execution' })
      expect(f.firstPrompts.resolve({ childSessionId: f.correlation.childSessionId, messageId: 'inbox' })).toMatchObject({ deliveryId: f.accepted.record.deliveryId })
      await f.firstPrompts.whenBound(f.correlation.childSessionId)
      expect(f.world.durable.findDeliveryByInboxMessageId('inbox')?.deliveryId).toBe(f.accepted.record.deliveryId)
      // The controller's post-return bind is idempotent, not a second dispatch.
      expect(await f.world.durable.bindQueued({ deliveryId: f.accepted.record.deliveryId, correlation: f.correlation, executionId: 'execution', inboxMessageId: 'inbox' })).toBeDefined()
    } finally { await f.world.close() }
  })
  it('commits creation only after the durable inbox bind and retires the temporary bridge', async () => {
    const f = await fixture()
    try {
      await f.publication.publish(f.correlation.childSessionId, f.composition)
      expect(f.world.durable.getOperation('first-child:execution')?.phase).toBe('publishing')
      f.firstPrompts.resolve({ childSessionId: f.correlation.childSessionId, messageId: 'inbox' })
      await f.publication.commit?.(f.correlation.childSessionId, f.composition)
      expect(f.world.durable.getOperation('first-child:execution')?.phase).toBe('committed')
      expect(f.firstPrompts.size).toBe(0)
    } finally { await f.world.close() }
  })

  it('retries a durable compensation debt after restart without replaying the first prompt', async () => {
    const f = await fixture()
    try {
      await f.publication.publish(f.correlation.childSessionId, f.composition)
      const debt = await f.world.durable.reconcileStartup({ now: 1004 })
      expect(debt.manualOperations).toHaveLength(1)
      expect(f.world.durable.hasFirstDeliveryRecoveryDebt(f.row.id)).toBe(true)
      const resolution = createLocusResolution({ store: f.world.durable })
      expect(() => resolution.resolveCurrent(f.row.endpoint)).toThrow('compensation is awaiting recovery')
      expect(debt.replayableDeliveries).toHaveLength(0)
      const released: string[] = []
      const recovered = await f.world.durable.reconcileStartup({ now: 1005, compensators: { childSession: async input => { released.push(input.childSessionId) } } })
      expect(released).toEqual([f.correlation.childSessionId])
      expect(recovered.compensatedOperations).toHaveLength(1)
      expect(f.world.durable.hasFirstDeliveryRecoveryDebt(f.row.id)).toBe(false)
      expect(f.world.durable.getLocus(f.row.id)).toMatchObject({ state: 'not-created', busy: false })
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)).toMatchObject({ status: 'failed', failureReason: 'child-create-failed' })
      expect(recovered.replayableDeliveries).toEqual([])
    } finally { await f.world.close() }
  })

  it('does not revive a first Delivery that finished before startContinuable returned', async () => {
    const f = await fixture()
    try {
      await f.publication.publish(f.correlation.childSessionId, f.composition)
      f.firstPrompts.resolve({ childSessionId: f.correlation.childSessionId, messageId: 'inbox' })
      await f.firstPrompts.whenBound(f.correlation.childSessionId)
      await f.world.durable.completeCurrentDelivery({ ...f.correlation, deliveryId: f.accepted.record.deliveryId, outcome: 'no-reply', reason: 'reference-only', outboundResult: 'none', now: 1004 })
      expect(await f.world.durable.bindQueued({ deliveryId: f.accepted.record.deliveryId, correlation: f.correlation, executionId: 'execution', inboxMessageId: 'inbox' })).toMatchObject({ status: 'no-reply' })
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)?.queueState).toBeUndefined()
    } finally { await f.world.close() }
  })

  it('durably compensates committed publication and lets the next Delivery create again', async () => {
    const f = await fixture()
    try {
      await f.publication.publish(f.correlation.childSessionId, f.composition)
      await f.publication.unpublish(f.correlation.childSessionId, f.composition)
      expect(f.world.durable.getLocus(f.row.id)).toMatchObject({ state: 'not-created', busy: false })
      expect(f.world.durable.getLocus(f.row.id)?.childSessionId).toBeUndefined()
      expect(f.world.durable.getDelivery(f.accepted.record.deliveryId)).toMatchObject({ status: 'failed', failureReason: 'child-create-failed' })
      expect(petLocusDelivery.safeParse(f.world.durable.getDelivery(f.accepted.record.deliveryId)).success).toBe(true)
      expect(f.firstPrompts.size).toBe(0)
      const nextCorrelation = { ...f.correlation, childSessionId: f.world.durable.getLocus(f.row.id)!.reservedChildSessionId! }
      expect(nextCorrelation.childSessionId).not.toBe(f.correlation.childSessionId)
      await f.world.durable.acceptDelivery({ ...nextCorrelation, messageId: 'next', senderOpenId: 'owner', text: 'next question', acceptedAt: 1004 })
      expect((await f.world.durable.claimCurrentDelivery({ correlation: nextCorrelation, now: 1005 }))?.messageId).toBe('next')
    } finally { await f.world.close() }
  })
})
