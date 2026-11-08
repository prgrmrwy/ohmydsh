import { describe, expect, it, vi } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { openPetHarness } from './harness.js'
import {
  LocusChannelController,
  type ActiveLocus,
  type LocusControllerDeps,
  type NormalizedLocusAdmission,
} from '../src/host/channel/locus-controller.js'
import {
  acceptDelivery, bindQueued, bindTurn, claimCurrentDelivery, createDeliveryLedger, settleByTurn,
  type DeliveryCorrelation, type DeliveryRecord,
} from '../src/host/locus/delivery.js'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
  type LocusTurnEnd,
} from '../src/host/locus/turn-observer.js'

const correlation: DeliveryCorrelation = {
  endpoint: { chatId: 'oc_shutdown', threadId: 'omt_shutdown' },
  locusId: 'locus-shutdown', sessionId: 'child-shutdown',
}
const locus: ActiveLocus = {
  locusId: correlation.locusId, endpoint: correlation.endpoint, sessionId: correlation.sessionId,
  locusMainSessionId: 'main-shutdown', workspaceId: 'project', state: 'active',
  accessMode: 'read-only', revision: 1,
}
function admission(messageId = 'message-a'): Extract<NormalizedLocusAdmission, { kind: 'accepted' }> {
  return {
    kind: 'accepted', authorization: 'authorized', needsInitialization: true,
    message: {
      kind: 'message', messageId, endpoint: correlation.endpoint, chatType: 'group',
      senderOpenId: 'ou_owner', text: 'work',
      replyTarget: { ...correlation.endpoint, messageId },
    },
  }
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function harness(overrides: Partial<LocusControllerDeps> = {}) {
  let state = createDeliveryLedger()
  let claimed!: (claim: LocusInboxClaim) => void
  let ended!: (end: LocusTurnEnd) => void
  const events: unknown[] = []
  const turns = createLocusTurnObserver({
    onClaimed: listener => { claimed = listener; return () => {} },
    onTurnEnd: listener => { ended = listener; return () => {} },
    lookup: { find: ({ childSessionId, messageId }) => {
      const row = Object.values(state.byDeliveryId).find(record =>
        record.sessionId === childSessionId && record.inboxMessageId === messageId)
      return row?.executionId === undefined ? undefined : {
        deliveryId: row.deliveryId, executionId: row.executionId, correlation, status: row.status,
      }
    } },
  })
  turns.subscribe(event => events.push(event))
  const queueChild = vi.fn<NonNullable<LocusControllerDeps['child']>['queueChild']>(async input => {
    const messageId = `inbox-${input.deliveryId}`
    claimed({ childSessionId: locus.sessionId, messageId, turn: state.nextDeliverySequence, sourceKind: 'user' })
    return { accepted: true, executionId: input.executionId, inboxMessageId: messageId }
  })
  const resolveCurrent = vi.fn(() => locus)
  const ensureForDelivery = vi.fn(() => locus)
  const control = vi.fn(async () => ({ ok: true, text: 'done' }))
  const markSettled = vi.fn()
  const deliveries: LocusControllerDeps['deliveries'] = {
    getById: id => state.byDeliveryId[id],
    findByMessageId: id => state.byMessageId[id],
    accept: input => {
      const mutation = acceptDelivery(state, input)
      state = mutation.state
      return mutation
    },
    bindQueued: input => {
      const mutation = bindQueued(state, { ...input.correlation, ...input })
      state = mutation.state
      return mutation.record
    },
    bindTurn: input => {
      const mutation = bindTurn(state, { ...input.correlation, ...input })
      state = mutation.state
      return mutation.record
    },
    settleByTurn: vi.fn(async input => {
      const mutation = settleByTurn(state, { ...input, turnId: input.correlation.turnId })
      state = mutation.state
      return mutation
    }),
    failBeforeDispatch: () => false,
  }
  let controller!: LocusChannelController
  controller = new LocusChannelController({
    locus: { resolveCurrent, ensureForDelivery }, deliveries,
    deliveryDispatch: {
      claimCurrent: input => {
        const mutation = claimCurrentDelivery(state, { ...input.correlation, ...input })
        state = mutation.state
        return mutation.changed && mutation.record?.status === 'current' ? mutation.record : undefined
      },
      dispatchNext: input => controller.dispatchNext(input),
      currentFinished: input => controller.currentFinished(input),
    },
    child: {
      ensureChild: () => ({ parentSessionId: locus.locusMainSessionId, childSessionId: locus.sessionId }),
      queueChild,
    },
    turns, controlDispatch: { dispatch: control }, now: () => 100,
    receipts: { markAccepted: () => {}, markSettled },
    ...overrides,
  })
  return {
    controller, turns, queueChild, resolveCurrent, ensureForDelivery, control, deliveries, events,
    record: (messageId: string) => state.byMessageId[messageId],
    updateRecord: (messageId: string, patch: Partial<DeliveryRecord>) => {
      const current = state.byMessageId[messageId]!
      const next = { ...current, ...patch }
      state = {
        ...state,
        byMessageId: { ...state.byMessageId, [messageId]: next },
        byDeliveryId: { ...state.byDeliveryId, [current.deliveryId]: next },
      }
    },
    claim: (messageId: string, turn: number, childSessionId = locus.sessionId) =>
      claimed({ childSessionId, messageId, turn, sourceKind: 'user' }),
    end: (end: Omit<LocusTurnEnd, 'childSessionId'> & { childSessionId?: string }) =>
      ended({ childSessionId: locus.sessionId, ...end }),
    finish: (messageId: string) => {
      const current = state.byMessageId[messageId]!
      const terminal = { ...current, status: 'no-reply' as const, queueState: undefined }
      state = {
        ...state,
        byMessageId: { ...state.byMessageId, [messageId]: terminal },
        byDeliveryId: { ...state.byDeliveryId, [current.deliveryId]: terminal },
      }
      controller.currentFinished({ deliveryId: current.deliveryId, correlation })
      return controller.dispatchNext(correlation)
    },
    dispose: () => { controller.dispose(); turns.dispose() },
  }
}

describe('Locus shutdown freeze', () => {
  it('rejects new first admissions, controls and management mutations and suppresses dispatch until resume', async () => {
    const h = harness()
    try {
      await h.controller.handleAdmission(admission('a'))
      await h.controller.handleAdmission(admission('b'))
      await h.controller.freezeForShutdown()
      await h.controller.freezeForShutdown()
      const accepted = h.queueChild.mock.calls.length
      const ensures = h.ensureForDelivery.mock.calls.length
      expect(await h.controller.handle({} as never)).toEqual({ kind: 'refused', reason: 'shutdown-frozen' })
      expect(await h.controller.handleAdmission(admission('c'))).toEqual({ kind: 'refused', reason: 'shutdown-frozen' })
      expect(await h.controller.handleAdmission({ ...admission('control'), kind: 'control', command: { kind: 'scope', mode: 'read' } })).toEqual({ kind: 'refused', reason: 'shutdown-frozen' })
      const mutation = vi.fn(async () => 'changed')
      await expect(h.controller.runWhileActive(mutation)).rejects.toMatchObject({ code: 'LOCUS_SHUTDOWN_FROZEN' })
      expect(mutation).not.toHaveBeenCalled()
      expect(h.control).not.toHaveBeenCalled()
      expect(h.ensureForDelivery).toHaveBeenCalledTimes(ensures)
      await h.finish('a')
      expect(h.record('a')?.status).toBe('no-reply')
      expect(h.queueChild).toHaveBeenCalledTimes(accepted)
      expect(h.record('b')?.status).toBe('accepted')
      await h.controller.resumeAfterShutdown()
      expect(h.queueChild).toHaveBeenCalledTimes(accepted + 1)
      expect(h.record('b')?.status).toBe('current')
      await expect(h.controller.runWhileActive(mutation)).resolves.toBe('changed')
    } finally { h.dispose() }
  })

  it('waits for entered inbound enrichment and management mutations without starting a late bootstrap', async () => {
    const inbound = deferred<string | undefined>()
    const enrichmentEntered = deferred()
    const mutationEntered = deferred()
    const mutation = deferred<number>()
    const h = harness({ addressing: {
      listChatBots: () => [],
      resolveMemberName: () => { enrichmentEntered.resolve(); return inbound.promise },
    } })
    try {
      const intake = h.controller.handleAdmission(admission())
      await enrichmentEntered.promise
      const managed = h.controller.runWhileActive(() => { mutationEntered.resolve(); return mutation.promise })
      await mutationEntered.promise
      const frozen = vi.fn()
      const freeze = h.controller.freezeForShutdown().then(frozen)
      await tick()
      expect(frozen).not.toHaveBeenCalled()
      inbound.resolve('owner')
      await expect(intake).resolves.toEqual({ kind: 'refused', reason: 'shutdown-frozen' })
      expect(h.ensureForDelivery).not.toHaveBeenCalled()
      expect(h.queueChild).not.toHaveBeenCalled()
      expect(frozen).not.toHaveBeenCalled()
      mutation.resolve(42)
      await expect(managed).resolves.toBe(42)
      await freeze
      expect(frozen).toHaveBeenCalledOnce()
    } finally { inbound.resolve(undefined); mutation.resolve(0); h.dispose() }
  })

  it('waits for entered queue acceptance and binding but not an unfinished native turn', async () => {
    const queued = deferred<{ accepted: true; executionId: string; inboxMessageId: string }>()
    const queueEntered = deferred()
    const h = harness({ child: {
      ensureChild: () => ({ parentSessionId: locus.locusMainSessionId, childSessionId: locus.sessionId }),
      queueChild: input => {
        queueEntered.resolve()
        void queued.promise
        return queued.promise.then(result => ({ ...result, executionId: input.executionId }))
      },
    } })
    try {
      const intake = h.controller.handleAdmission(admission())
      await queueEntered.promise
      const frozen = vi.fn()
      const freeze = h.controller.freezeForShutdown().then(frozen)
      await tick()
      expect(frozen).not.toHaveBeenCalled()
      queued.resolve({ accepted: true, executionId: '', inboxMessageId: 'native-still-running' })
      await intake
      await freeze
      expect(h.record('message-a')?.inboxMessageId).toBe('native-still-running')
      expect(h.record('message-a')?.status).toBe('current')
    } finally { h.dispose() }
  })

  it('waits for an entered control mutation and recovers after a rejected external mutation', async () => {
    const control = deferred<{ ok: true; text: string }>()
    const entered = deferred()
    const h = harness({ controlDispatch: { dispatch: () => { entered.resolve(); return control.promise } } })
    try {
      const active = h.controller.handleAdmission({ ...admission(), kind: 'control', command: { kind: 'scope', mode: 'read' } })
      await entered.promise
      const failedMutation = h.controller.runWhileActive(async () => { throw new Error('external failure') })
      await expect(failedMutation).rejects.toThrow('external failure')
      const frozen = vi.fn()
      const freeze = h.controller.freezeForShutdown().then(frozen)
      await tick()
      expect(frozen).not.toHaveBeenCalled()
      control.resolve({ ok: true, text: 'done' })
      await expect(active).resolves.toMatchObject({ kind: 'control', ok: true })
      await freeze
      await h.controller.resumeAfterShutdown()
      await expect(h.controller.runWhileActive(async () => 42)).resolves.toBe(42)
    } finally { control.resolve({ ok: true, text: 'done' }); h.dispose() }
  })

  it('retains a claimed current across a renderer delay and resumes its first physical dispatch', async () => {
    const render = deferred<string>()
    const rendering = deferred()
    const h = harness({ renderPrompt: () => { rendering.resolve(); return render.promise } })
    try {
      const intake = h.controller.handleAdmission(admission())
      await rendering.promise
      const freeze = h.controller.freezeForShutdown()
      render.resolve('prompt')
      await intake
      await freeze
      expect(h.record('message-a')?.status).toBe('current')
      expect(h.record('message-a')?.executionId).toBeUndefined()
      expect(h.queueChild).not.toHaveBeenCalled()
      await h.controller.resumeAfterShutdown()
      expect(h.queueChild).toHaveBeenCalledOnce()
    } finally { render.resolve('prompt'); h.dispose() }
  })
})

describe('live cancellation evidence', () => {
  it('persists a real current interruption through the repository CAS and resumes the durable backlog', async () => {
    const storage = await openPetHarness()
    await storage.domain.table('locus_mains').put('main-live', {
      locusMainSessionId: 'main-live', workSessionId: 'work-live', generation: 1, status: 'active',
      spaceId: 'space-live', workspaceId: 'ws-pet', createdAt: 1, updatedAt: 1,
    } as never)
    const repository = new LocusRepositoryV20(storage.domain as never)
    const liveEndpoint = { chatId: 'oc_live_cancel' }
    const row = {
      endpoint: liveEndpoint, locusId: 'locus-live', sessionId: 'child-live', state: 'active' as const,
      accessMode: 'read-only' as const, revision: 1, createdAt: 1, updatedAt: 1,
      locusMainSessionId: 'main-live', workspaceId: 'project',
    }
    await storage.domain.table('loci').put(liveEndpoint.chatId, row as never)
    const activeLive = (): ActiveLocus => ({
      locusId: row.locusId, endpoint: liveEndpoint, sessionId: row.sessionId,
      locusMainSessionId: row.locusMainSessionId, workspaceId: row.workspaceId, state: 'active',
      accessMode: 'read-only', revision: 1,
    })
    let claim!: (value: LocusInboxClaim) => void
    let end!: (value: LocusTurnEnd) => void
    const turns = createLocusTurnObserver({
      onClaimed: listener => { claim = listener; return () => {} },
      onTurnEnd: listener => { end = listener; return () => {} },
      lookup: { find: ({ childSessionId, messageId }) => {
        const delivery = repository.findDeliveryByInboxMessageId(messageId)
        return delivery?.executionId !== undefined && delivery.sessionId === childSessionId ? {
          deliveryId: delivery.deliveryId, executionId: delivery.executionId,
          correlation: { locusId: row.locusId, sessionId: childSessionId, endpoint: liveEndpoint },
        } : undefined
      } },
    })
    let controller!: LocusChannelController
    const queue = vi.fn<LocusControllerDeps['child']['queueChild']>(async input => {
      const inboxMessageId = `inbox-${input.deliveryId}`
      claim({ childSessionId: row.sessionId, messageId: inboxMessageId, turn: queue.mock.calls.length, sourceKind: 'user' })
      return { accepted: true, executionId: input.executionId, inboxMessageId }
    })
    controller = new LocusChannelController({
      locus: { resolveCurrent: activeLive, ensureForDelivery: activeLive },
      child: { ensureChild: () => ({ parentSessionId: row.locusMainSessionId, childSessionId: row.sessionId }), queueChild: queue },
      turns, now: () => 100,
      deliveries: {
        getById: id => repository.getDelivery(id), findByMessageId: id => repository.findDeliveryByMessageId(id),
        accept: input => repository.acceptDelivery(input as never),
        bindQueued: async input => (await repository.bindQueued({ ...input.correlation, ...input } as never)).record,
        bindTurn: async input => (await repository.bindTurn({ ...input.correlation, ...input } as never)).record,
        settleByTurn: input => repository.settleByTurn({ ...input, turnId: input.correlation.turnId } as never),
        failBeforeDispatch: input => repository.failBeforeDispatch(input as never),
      },
      deliveryDispatch: {
        claimCurrent: async input => {
          const result = await repository.claimCurrentDelivery({ ...input.correlation, ...input } as never)
          return result.changed ? result.record : undefined
        },
        currentFinished: input => controller.currentFinished(input),
        dispatchNext: input => controller.dispatchNext(input),
      },
    })
    const liveAdmission = (id: string) => {
      const input = admission(id)
      return { ...input, message: { ...input.message, endpoint: liveEndpoint, replyTarget: { ...liveEndpoint, messageId: id } } }
    }
    try {
      await controller.handleAdmission(liveAdmission('live-a'))
      await controller.handleAdmission(liveAdmission('live-b'))
      const current = repository.findDeliveryByMessageId('live-a')!
      expect(current.status).toBe('current')
      expect(current.turnId).toBe('child-live#1')
      await controller.freezeForShutdown()
      end({ childSessionId: 'child-live', turn: 1, outcome: 'aborted', reason: 'disposed' })
      await controller.freezeForShutdown()
      expect(repository.findDeliveryByMessageId('live-a')).toMatchObject({ status: 'failed', startupDisposition: 'turn-interrupted' })
      expect(repository.findDeliveryByMessageId('live-b')?.status).toBe('accepted')
      expect(queue).toHaveBeenCalledOnce()
      await controller.resumeAfterShutdown()
      expect(repository.findDeliveryByMessageId('live-b')?.status).toBe('current')
      expect(queue).toHaveBeenCalledTimes(2)
    } finally {
      controller.dispose()
      turns.dispose()
      await storage.close()
    }
  })
  it.each(['user', 'parent', 'disposed'] as const)('emits one exact failed turn for a real aborted %s', async reason => {
    const h = harness()
    try {
      await h.controller.handleAdmission(admission())
      const current = h.record('message-a')!
      const turn = Number(current.turnId!.split('#').at(-1))
      h.end({ turn, outcome: 'aborted', reason })
      h.end({ turn, outcome: 'aborted', reason })
      await tick()
      expect(h.events).toContainEqual({
        phase: 'failed', deliveryId: current.deliveryId, executionId: current.executionId,
        turnId: current.turnId, correlation, reason: 'turn-interrupted', cancelReason: reason,
      })
      expect(h.events.filter(event => (event as { phase: string }).phase === 'failed')).toHaveLength(1)
      expect(h.deliveries.settleByTurn).toHaveBeenCalledWith({
        deliveryId: current.deliveryId, executionId: current.executionId,
        correlation: { ...correlation, turnId: current.turnId }, outcome: 'failed',
        settledAt: 100, failureReason: 'turn-interrupted',
        inboxMessageId: current.inboxMessageId, expectedRevision: current.revision,
      })
      // This legacy pure-CAS adapter refuses current rows; refusal must never fabricate a finish.
      expect(h.record('message-a')?.status).toBe('current')
      expect(h.queueChild).toHaveBeenCalledOnce()
    } finally { h.dispose() }
  })

  it('waits for exact inbox binding when a live abort arrives before queue acceptance returns', async () => {
    const h = harness({ child: {
      ensureChild: () => ({ parentSessionId: locus.locusMainSessionId, childSessionId: locus.sessionId }),
      queueChild: async input => {
        h.claim('inbox-before-bind', 7)
        h.end({ turn: 7, outcome: 'aborted', reason: 'parent' })
        expect(h.deliveries.settleByTurn).not.toHaveBeenCalled()
        return { accepted: true, executionId: input.executionId, inboxMessageId: 'inbox-before-bind' }
      },
    } })
    try {
      await h.controller.handleAdmission(admission())
      expect(h.record('message-a')?.turnId).toBe(`${locus.sessionId}#7`)
      expect(h.deliveries.settleByTurn).toHaveBeenCalledWith(expect.objectContaining({
        correlation: { ...correlation, turnId: `${locus.sessionId}#7` },
        outcome: 'failed', failureReason: 'turn-interrupted',
      }))
    } finally { h.dispose() }
  })

  it('settles an exact supported running CAS while frozen and defers its successor until resume', async () => {
    const h = harness()
    try {
      await h.controller.handleAdmission(admission('a'))
      await h.controller.handleAdmission(admission('b'))
      const current = h.record('a')!
      // Older running rows are the existing settleByTurn contract; use the real pure CAS.
      h.updateRecord('a', { status: 'running' })
      await h.controller.freezeForShutdown()
      h.end({ turn: Number(current.turnId!.split('#').at(-1)), outcome: 'aborted', reason: 'disposed' })
      await h.controller.freezeForShutdown()
      expect(h.record('a')?.status).toBe('failed')
      expect(h.record('a')?.failureReason).toBe('turn-interrupted')
      expect(h.record('b')?.status).toBe('accepted')
      expect(h.queueChild).toHaveBeenCalledOnce()
      await h.controller.resumeAfterShutdown()
      expect(h.record('b')?.status).toBe('current')
      expect(h.queueChild).toHaveBeenCalledTimes(2)
    } finally { h.dispose() }
  })

  it.each([
    { executionId: 'replacement-execution' },
    { sessionId: 'replacement-child' },
    { endpoint: { chatId: 'replacement-endpoint' } },
    { turnId: 'child-shutdown#999' },
  ])('rejects stale cancellation after durable identity changes: %j', async patch => {
    const h = harness()
    try {
      await h.controller.handleAdmission(admission())
      const current = h.record('message-a')!
      h.updateRecord('message-a', patch)
      h.end({ turn: Number(current.turnId!.split('#').at(-1)), outcome: 'aborted', reason: 'disposed' })
      await tick()
      expect(h.deliveries.settleByTurn).not.toHaveBeenCalled()
      expect(h.record('message-a')?.status).toBe('current')
    } finally { h.dispose() }
  })

  it.each([
    { outcome: 'completed' as const },
    { outcome: 'failed' as const, reason: 'interrupted' },
    { outcome: 'aborted' as const },
    { outcome: 'aborted' as const, reason: 'legacy' },
  ])('does not invent interruption from $outcome / $reason', async end => {
    const h = harness()
    try {
      await h.controller.handleAdmission(admission())
      const turn = Number(h.record('message-a')!.turnId!.split('#').at(-1))
      h.end({ turn, ...end })
      await tick()
      expect(h.events.filter(event => (event as { phase: string }).phase === 'failed')).toHaveLength(0)
      expect(h.deliveries.settleByTurn).not.toHaveBeenCalled()
      expect(h.record('message-a')?.status).toBe('current')
    } finally { h.dispose() }
  })

  it('does not attribute another child or turn cancellation to current, or settle ambiguous claims', async () => {
    const h = harness()
    try {
      await h.controller.handleAdmission(admission())
      const turn = Number(h.record('message-a')!.turnId!.split('#').at(-1))
      h.end({ turn, childSessionId: 'other-child', outcome: 'aborted', reason: 'disposed' })
      h.end({ turn: turn + 1, outcome: 'aborted', reason: 'disposed' })
      h.claim('unknown-gui', turn)
      h.end({ turn, outcome: 'aborted', reason: 'disposed' })
      await tick()
      expect(h.events.filter(event => (event as { phase: string }).phase === 'failed')).toHaveLength(0)
      expect(h.deliveries.settleByTurn).not.toHaveBeenCalled()
      expect(h.record('message-a')?.status).toBe('current')
    } finally { h.dispose() }
  })
})
