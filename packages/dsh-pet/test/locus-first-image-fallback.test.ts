import { describe, expect, it, vi } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { createLocusChildAdapter, type LocusLiveParent } from '../src/host/locus/child.js'
import { createLocusChildDelivery } from '../src/host/locus/child-delivery.js'
import { createFirstDeliveryPublication } from '../src/host/locus/first-delivery-publication.js'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'
import { createLocusLazyChildCreator } from '../src/host/locus/lazy-child.js'
import { LocusPrepublicationStagingRegistry } from '../src/host/locus/prepublication-staging.js'
import { createLocusTurnObserver, type LocusInboxClaim } from '../src/host/locus/turn-observer.js'
import { FakeOfficialRuntime } from './support/official-subagent.js'
import { openThreeTier } from './support/three-tier.js'
import { petLocusDeliveryV20 as petLocusDelivery } from '../src/host/locus/contract-v20.js'
import { recoverLocusStartupV20 } from '../src/host/locus/reconcile.js'
import type { ActiveLocus } from '../src/host/channel/locus-controller.js'

async function fixture(options: { failText?: boolean; publish?: boolean; imageInput?: boolean; cleanupFails?: boolean; cleanupUnavailable?: boolean } = {}) {
  const world = await openThreeTier()
  await world.controller.ensureGroup({ chatId: 'image-chat', parentSessionId: 'work-1' })
  const groupRow = () => {
    const row = world.durable.getRow({ chatId: 'image-chat' })
    if (row === undefined || !('locusMainSessionId' in row)) throw new Error('group row missing')
    return row
  }
  const original = groupRow()
  const correlation = { endpoint: original.endpoint, locusId: original.locusId, sessionId: original.sessionId }
  /** The row as the channel sees it (v20 ActiveLocus). */
  const active = (): ActiveLocus => {
    const row = groupRow()
    return {
      locusId: row.locusId, endpoint: row.endpoint, sessionId: row.sessionId, locusMainSessionId: row.locusMainSessionId,
      workspaceId: row.workspaceId, state: row.state as 'active' | 'not-created', accessMode: row.accessMode, revision: row.revision,
    }
  }
  let reserved = 0
  const reserveChildSessionId = () => `session-reserved-${String(++reserved)}`
  const operations = () => [...(world.harness.domain.table('locus_operations') as unknown as { entries(): Iterable<[string, { operation?: string; phase?: string }]> }).entries()]
    .map(([, op]) => op).filter(op => op.operation === 'first-child-publication')
  let clock = 1000
  const now = () => ++clock
  const runtime = new FakeOfficialRuntime({ imageInput: options.imageInput ?? false })
  runtime.addParent(original.locusMainSessionId)
  const staging = new LocusPrepublicationStagingRegistry()
  const firstPrompts = createFirstPromptRegistry({ bindQueued: async (delivery, messageId) => {
    if ((await world.durable.bindQueued({ ...delivery.correlation, deliveryId: delivery.deliveryId, executionId: delivery.executionId, inboxMessageId: messageId, queuedAt: now() })).record === undefined) throw new Error('first binding refused')
  } })
  let claim!: (input: LocusInboxClaim) => void
  const turns = createLocusTurnObserver({
    onClaimed: listener => { claim = listener; return () => {} }, onTurnEnd: () => () => {},
    lookup: { find: input => {
      const row = world.durable.findDeliveryByInboxMessageId(input.messageId)
      return row?.executionId ? { deliveryId: row.deliveryId, executionId: row.executionId, correlation: row } : firstPrompts.resolve(input)
    } },
  })
  const executed: string[] = []
  runtime.onClaim = async ({ childId, messageId }) => {
    claim({ childSessionId: childId, messageId, turn: 1, sourceKind: 'user' })
    await firstPrompts.whenBound(childId)
    executed.push(turns.currentCapabilityForChild!(childId)!.deliveryId)
  }
  runtime.agentCreatedListeners.push(async ({ agent }) => {
    staging.claim(agent.id)
    if (options.failText && runtime.startCalls.at(-1)!.request.prompt.every(block => block.type !== 'image')) throw new Error('text creation veto')
    if (options.publish !== false) await staging.publishClaimed(agent.id)
  })
  const createAdapter = () => createLocusChildAdapter({
    parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent, resume: async () => undefined },
    subagent: { startActivation: spec => runtime.startActivation(spec as never), getProvider: name => runtime.getProvider(name) },
    proof: { findChild: async (parentSessionId, childSessionId) => runtime.listChildren(parentSessionId).some(child => child.id === childSessionId) ? { parentSessionId, childSessionId } : undefined },
    inbox: { queuePrompt: (parent, childId, content) => runtime.queuePrompt(parent, childId, content) },
    ...(options.cleanupUnavailable ? {} : { compensation: { drainChildren: async (_parent, childIds) => {
      if (options.cleanupFails) throw new Error('cleanup failed')
      for (const childId of childIds) runtime.release(childId)
    } } }),
  })
  const creator = createLocusLazyChildCreator({ staging, presetDeclared: () => true, createAdapter })
  const child = createLocusChildDelivery({ createAdapter, parentPreset: () => 'locus-base', lazy: {
    creator, publication: createFirstDeliveryPublication({ repository: world.durable, firstPrompts, reserveChildSessionId, now }),
  } })
  const media = vi.fn(async () => ({ kind: 'ready' as const, content: [{ type: 'image' as const, attachment: {
    attachmentId: 'test-image' as never, mediaType: 'image/png' as const, bytes: 8, width: 1, height: 1,
  } }] }))
  const controller = new LocusChannelController({
    locus: { resolveCurrent: () => active(), ensureForDelivery: async () => active() },
    child, turns, now, inspectResidentPolicy: () => ({ resident: false }),
    deliveries: {
      accept: input => world.durable.acceptDelivery(input), getById: id => world.durable.getDelivery(id),
      // Adapted exactly as index.ts adapts the channel ports to the flat v20 repository inputs.
      findByMessageId: id => world.durable.findDeliveryByMessageId(id),
      bindQueued: async ({ correlation, ...rest }) => (await world.durable.bindQueued({ ...correlation, ...rest })).record,
      bindTurn: async ({ correlation, ...rest }) => (await world.durable.bindTurn({ ...correlation, ...rest })).record,
      settleByTurn: ({ correlation, ...rest }) => world.durable.settleByTurn({ ...correlation, ...rest } as never),
      failBeforeDispatch: input => world.durable.failBeforeDispatch(input),
    },
    deliveryDispatch: {
      claimCurrent: async ({ correlation, ...rest }) => {
        const claimed = await world.durable.claimCurrentDelivery({ ...correlation, ...rest })
        return claimed.changed ? claimed.record : undefined
      },
      scheduleCurrent: () => {}, currentFinished: () => {}, dispatchNext: async () => {},
    },
    media: { available: true, admitCurrentImage: media } as never,
  })
  const admit = (messageId: string) => controller.handleAdmission({ kind: 'accepted', authorization: 'authorized', needsInitialization: false, message: {
    kind: 'message', messageId, endpoint: original.endpoint, senderOpenId: 'owner', text: `request ${messageId}`, chatType: 'group', replyTarget: { ...original.endpoint, messageId },
  } })
  return { world, runtime, original, correlation, creator, staging, firstPrompts, executed, media, controller, admit, now, operations, reserveChildSessionId,
    close: async () => { controller.dispose(); child.dispose(); turns.dispose(); staging.dispose(); await world.close() } }
}

describe('first lazy typed-image prompt on an official text-only route', () => {
  it.each([true, false])('首图降级交接使用新快照: keeps original A current, rotates the persisted veto id and executes text once (published=%s)', async publish => {
    const f = await fixture({ publish })
    try {
      // Existing B/C were admitted before physical dispatch; neither may overtake A.
      const a = await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'A', text: 'request A', senderOpenId: 'owner', acceptedAt: f.now() })
      const b = await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'B', text: 'request B', senderOpenId: 'owner', acceptedAt: f.now() })
      const c = await f.world.durable.acceptDelivery({ ...f.correlation, messageId: 'C', text: 'request C', senderOpenId: 'owner', acceptedAt: f.now() })
      // Publication is skipped only for the first image attempt in the second case.
      if (!publish) f.runtime.agentCreatedListeners.push(async ({ agent }) => {
        if (f.runtime.startCalls.at(-1)!.request.prompt.every(block => block.type !== 'image')) await f.staging.publishClaimed(agent.id)
      })
      await f.controller.dispatchNext(f.correlation)
      const current = f.world.durable.getDelivery(a.record.deliveryId)!
      expect(current).toMatchObject({ status: 'current', queueState: 'current', messageId: 'A', sequence: a.record.sequence, deadlineAt: a.record.deadlineAt })
      expect(current.sessionId).not.toBe(f.correlation.sessionId)
      expect(f.runtime.persisted.has(f.correlation.sessionId)).toBe(true)
      expect(f.runtime.agents.has(f.correlation.sessionId)).toBe(false)
      expect(f.runtime.startCalls.map(call => call.childId)).toEqual([f.correlation.sessionId, current.sessionId])
      expect(f.runtime.startCalls[1]!.request.prompt).toEqual([
        { type: 'text', text: 'request A' },
        { type: 'text', text: '[当前模型无法查看图片；请仅依据以上文字回复，不要声称已看见或理解图片内容。]' },
      ])
      expect(petLocusDelivery.parse(current)).toHaveProperty('imageRouteRejected', true)
      expect(f.executed).toEqual([a.record.deliveryId])
      expect(current.inboxMessageId).toBe('message-1')
      expect(f.media).toHaveBeenCalledTimes(1)
      expect(f.runtime.queueCalls).toHaveLength(0)
      expect(f.firstPrompts.size).toBe(0)
      const publications = f.operations()
      expect(publications).toHaveLength(publish ? 2 : 1)
      expect(publications.map(operation => operation.phase)).toEqual(publish ? ['compensated', 'committed'] : ['committed'])
      for (const row of [b.record, c.record]) expect(f.world.durable.getDelivery(row.deliveryId)).toMatchObject({ status: 'accepted', sessionId: current.sessionId, sequence: row.sequence })
      // The row itself moved with the rotation (revision + 1) and is active on the fresh id.
      expect(f.world.durable.getRow(f.original.endpoint)).toMatchObject({ sessionId: current.sessionId, revision: f.original.revision + 1, accessMode: f.original.accessMode })
      expect(await f.world.durable.completeCurrentDelivery({ endpoint: current.endpoint, locusId: current.locusId, sessionId: current.sessionId, deliveryId: current.deliveryId, outcome: 'no-reply', reason: 'text done', outboundResult: 'none', now: f.now() } as never)).toMatchObject({ changed: true })
      const next = await f.world.durable.claimCurrentDelivery({ endpoint: current.endpoint, locusId: current.locusId, sessionId: current.sessionId, now: f.now() })
      expect(next.changed && next.record?.deliveryId).toBe(b.record.deliveryId)
      expect(f.world.durable.getDelivery(c.record.deliveryId)?.status).toBe('accepted')
    } finally { await f.close() }
  })

  it('首条图片不支持时安全降为文本: handles the original inbound request successfully without asking the user to resend', async () => {
    const f = await fixture()
    try {
      expect(await f.admit('A')).toMatchObject({ kind: 'accepted' })
      const a = f.world.durable.findDeliveryByMessageId('A')!
      expect(a).toMatchObject({ status: 'current', imageRouteRejected: true, inboxMessageId: 'message-1' })
      expect(f.executed).toEqual([a.deliveryId])
      expect(f.runtime.startCalls).toHaveLength(2)
      expect(f.media).toHaveBeenCalledTimes(1)
    } finally { await f.close() }
  })

  it('首图降级跨崩溃最多一次文本: retains text-only disposition and the fresh identity across capacity refusal and restart recovery', async () => {
    const f = await fixture()
    vi.useFakeTimers()
    try {
      let freshId: string | undefined
      f.runtime.agentCreatedListeners.push(({ agent }) => {
        if (f.runtime.startCalls.at(-1)!.request.prompt.some(block => block.type === 'image')) {
          // The following text start hits capacity before materialization.
          f.runtime.activeLimit = 0
        } else freshId = agent.id
      })
      expect(await f.admit('A')).toMatchObject({ kind: 'accepted' })
      const waiting = f.world.durable.findDeliveryByMessageId('A')!
      expect(waiting).toMatchObject({ status: 'current', imageRouteRejected: true })
      expect(waiting.executionId).toBeUndefined()
      expect(waiting.sessionId).not.toBe(f.correlation.sessionId)
      expect(f.runtime.startCalls).toHaveLength(2)
      expect(f.runtime.persisted.has(waiting.sessionId)).toBe(false)
      const recovery = await recoverLocusStartupV20(f.world.durable as never, { now: f.now(), reserveChildSessionId: f.reserveChildSessionId })
      expect(recovery.replayableDeliveries).toMatchObject([{ deliveryId: waiting.deliveryId, imageRouteRejected: true }])
      expect(recovery.manualOperations).toHaveLength(0)
      f.runtime.activeLimit = Infinity
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.runtime.startCalls).toHaveLength(3)
      expect(f.runtime.startCalls[1]!.childId).toBe(f.runtime.startCalls[2]!.childId)
      expect(freshId).toBe(waiting.sessionId)
      expect(f.executed).toEqual([waiting.deliveryId])
      expect(f.media).toHaveBeenCalledTimes(1)
      expect(f.runtime.startCalls.slice(1).every(call => call.request.prompt.every(block => block.type === 'text'))).toBe(true)
    } finally { vi.useRealTimers(); await f.close() }
  })

  it('does not treat an arbitrary creation error mentioning the image code as retry proof', async () => {
    const f = await fixture({ imageInput: true })
    try {
      f.runtime.failAfterCreated = new Error('plugin failure: MODEL_DOES_NOT_SUPPORT_IMAGES')
      expect(await f.admit('A')).toMatchObject({ kind: 'refused' })
      expect(f.runtime.startCalls).toHaveLength(1)
      expect(f.world.durable.findDeliveryByMessageId('A')).toMatchObject({ status: 'failed' })
      expect(f.executed).toEqual([])
    } finally { await f.close() }
  })

  it('已接受或认领的图片拒绝不重放: never retries a code-shaped image error after the first prompt was really claimed', async () => {
    const f = await fixture({ imageInput: true })
    try {
      f.runtime.onClaim = async ({ childId, messageId }) => {
        f.firstPrompts.resolve({ childSessionId: childId, messageId })
        await f.firstPrompts.whenBound(childId)
        throw Object.assign(new Error('late failure'), { code: 'MODEL_DOES_NOT_SUPPORT_IMAGES' })
      }
      // The error has the official code but real work already claimed the image prompt.
      expect(await f.admit('A')).toMatchObject({ kind: 'refused' })
      expect(f.runtime.startCalls).toHaveLength(1)
      expect(f.world.durable.findDeliveryByMessageId('A')?.inboxMessageId).toBe('message-1')
      expect(f.world.durable.getRow(f.original.endpoint)?.state).toBe('not-created')
      expect(f.world.durable.findDeliveryByMessageId('A')?.status).toBe('failed')
      expect(f.firstPrompts.size).toBe(0)
      expect(f.media).toHaveBeenCalledTimes(1)
    } finally { await f.close() }
  })

  it.each([
    { mode: 'fails', publish: true }, { mode: 'unavailable', publish: true }, { mode: 'fails', publish: false },
  ])('does not start text when old-child release is $mode (published=$publish)', async ({ mode, publish }) => {
    const f = await fixture({ publish, cleanupFails: mode === 'fails', cleanupUnavailable: mode === 'unavailable' })
    try {
      expect(await f.admit('A')).toMatchObject({ kind: 'refused' })
      expect(f.runtime.startCalls).toHaveLength(1)
      expect(f.executed).toEqual([])
      expect(f.world.durable.findDeliveryByMessageId('A')?.status).toBe('current')
      expect(f.world.durable.hasFirstDeliveryRecoveryDebt(f.original.locusId)).toBe(true)
      expect(f.operations()).toMatchObject([{ phase: 'needs-recovery' }])
      expect(f.firstPrompts.size).toBe(0)
    } finally { await f.close() }
  })

  it('settles A only when the one text-only retry also fails', async () => {
    const f = await fixture({ failText: true })
    try {
      expect(await f.admit('A')).toMatchObject({ kind: 'refused' })
      expect(f.world.durable.findDeliveryByMessageId('A')).toMatchObject({ status: 'failed' })
      expect(f.runtime.startCalls).toHaveLength(2)
      expect(f.media).toHaveBeenCalledTimes(1)
      expect(f.executed).toEqual([])
    } finally { await f.close() }
  })
})
