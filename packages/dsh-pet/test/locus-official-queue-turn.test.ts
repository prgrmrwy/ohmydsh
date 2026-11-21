import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query'
import Agents from '@deepseek-ai/dsh-agent'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Projections from '@deepseek-ai/dsh-session-projection'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Subagents from '@deepseek-ai/dsh-subagent'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { adaptLocusInboxPort, createLocusChildAdapter } from '../src/host/locus/child.js'
import { createLocusChildDelivery } from '../src/host/locus/child-delivery.js'
import { createLocusTurnObserver, type LocusInboxClaim, type LocusTurnEnd } from '../src/host/locus/turn-observer.js'
import { replyChild } from '../src/host/collab/locus-tools.js'
import { openThreeTier } from './support/three-tier.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

it('业务结算后下一条仍为独立轮次: B uses official queue/user and a new turn/UUID while settled A is still running; parent sendMessage only continues A', async () => {
  const world = await openThreeTier()
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'locus-queue-'))
  const aStarted = deferred(), releaseStep = deferred(), replyStarted = deferred(), releaseA = deferred(), bStarted = deferred(), releaseB = deferred()
  let controller: LocusChannelController | undefined
  let childDelivery: ReturnType<typeof createLocusChildDelivery> | undefined
  let turns: ReturnType<typeof createLocusTurnObserver> | undefined
  try {
    await ctx.plugin(Sessions)
    await ctx.plugin(Persistence, { root })
    await ctx.plugin(Query)
    for (const plugin of [Agents, Llm, Tools, Prompt, Projections]) await ctx.plugin(plugin)
    await ctx.plugin(NativeToolExecutor)
    let requests = 0
    ctx.llm.registerAdapter(['fake'], new class extends LlmAdapter {
      override async *stream() {
        const request = ++requests
        if (request === 1) { aStarted.resolve(); await releaseStep.promise }
        if (request === 2) { replyStarted.resolve(); await releaseA.promise }
        if (request === 3) { bStarted.resolve(); await releaseB.promise }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
    }())
    await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
    // DSH 0.2.1 subagent runtime injects workingDirectory (which injects fs).
    await ctx.plugin(FsLocal, { cwd: realpathSync(tmpdir()) }); await ctx.plugin(WorkingDirectory, { defaultDirectory: realpathSync(tmpdir()) })
    await ctx.plugin(Subagents)
    await ctx.plugin(Spawn)
    const entry = await world.controller.ensureGroup({ chatId: 'queue-chat', parentSessionId: 'work-1' })
    const initial = world.durable.getLocus(entry.locus.locusId)!
    const childId = initial.sessionId
    const mainId = entry.group.locusMainSessionId
    const row = { endpoint: initial.endpoint }
    // The channel's resolution view of the entry, always re-read from the row.
    const active = () => {
      const current = world.durable.getLocus(initial.locusId)!
      return { locusId: current.locusId, endpoint: current.endpoint, sessionId: current.sessionId, state: current.state as 'active' | 'not-created',
        accessMode: current.accessMode, revision: current.revision, locusMainSessionId: mainId, workSessionId: 'work-1', workspaceId: entry.group.workspaceId }
    }
    const parent = await ctx.agentLoop.create(SessionId(mainId), { provider: 'fake', model: 'text' })
    const correlation = { endpoint: initial.endpoint, locusId: initial.locusId, sessionId: childId }
    const claims: LocusInboxClaim[] = []
    let claim!: (value: LocusInboxClaim) => void
    let ended!: (value: LocusTurnEnd) => void
    turns = createLocusTurnObserver({
      onClaimed: listener => { claim = listener; return () => {} }, onTurnEnd: listener => { ended = listener; return () => {} },
      lookup: { find: input => {
        const delivery = world.durable.findDeliveryByInboxMessageId(input.messageId)
        return delivery?.executionId ? { deliveryId: delivery.deliveryId, executionId: delivery.executionId, correlation: { endpoint: delivery.endpoint, locusId: delivery.locusId, sessionId: delivery.sessionId } } : undefined
      } },
    })
    ctx.on('agent/inbox/claimed', event => {
      if (event.agent.id !== childId) return
      const value = { childSessionId: childId, messageId: String(event.message.id), turn: event.turn, sourceKind: event.message.source?.kind }
      claims.push(value); claim(value)
    })
    ctx.on('session/event', (session, event) => { if (session.id === childId && event.type === 'turn/end') ended({ childSessionId: childId, turn: event.data.turn, outcome: 'completed' }) })
    const a = await world.durable.acceptDelivery({ ...correlation, messageId: 'A', text: 'A', senderOpenId: 'owner', acceptedAt: 1001 })
    await world.durable.claimCurrentDelivery({ ...correlation, now: 1002 })
    // First creation (D16): publish the row active on the current trigger, then commit once bound.
    await world.durable.publishFirstDelivery({ locusId: initial.locusId, sessionId: childId, revision: initial.revision, deliveryId: a.record.deliveryId, executionId: 'execution-A', now: 1002 })
    const start = await ctx.subagents.startActivation({ provider: 'spawn', label: 'queue-child', childId: SessionId(childId), request: { parent, prompt: [{ type: 'text', text: 'A' }] }, signal: new AbortController().signal, delivery: 'parent' })
    await world.durable.bindQueued({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'execution-A', inboxMessageId: start.messageId, queuedAt: 1003 })
    await world.durable.commitFirstDelivery({ executionId: 'execution-A', now: 1003 })
    turns.deliveryAvailable!({ childSessionId: childId, messageId: start.messageId })
    await aStarted.promise
    childDelivery = createLocusChildDelivery({ parentPreset: () => 'locus-base', createAdapter: () => createLocusChildAdapter({
      parent: { get: id => ctx.agents.get(id), resume: async () => undefined },
      subagent: ctx.subagents as never, inbox: adaptLocusInboxPort(ctx.subagents)!,
      proof: { findChild: async () => ({ parentSessionId: parent.id, childSessionId: childId }) },
    }) })
    controller = new LocusChannelController({
      locus: { resolveCurrent: () => active(), ensureForDelivery: async () => active() },
      child: childDelivery, turns, now: () => 1005, inspectResidentPolicy: () => ({ resident: false }),
      deliveries: { accept: input => world.durable.acceptDelivery(input), getById: id => world.durable.getDelivery(id), bindQueued: async ({ correlation: c, ...rest }) => (await world.durable.bindQueued({ ...c, ...rest })).record, bindTurn: async ({ correlation: c, ...rest }) => (await world.durable.bindTurn({ ...c, ...rest })).record, settleByTurn: input => world.durable.settleByTurn({ ...input, turnId: input.correlation.turnId }), failBeforeDispatch: input => world.durable.failBeforeDispatch(input) },
      deliveryDispatch: { claimCurrent: async ({ correlation: c, ...rest }) => { const r = await world.durable.claimCurrentDelivery({ ...c, ...rest }); return r.changed ? r.record : undefined }, scheduleCurrent: () => {} },
    })
    const send = vi.spyOn(ctx.subagents, 'sendMessage')
    expect(await replyChild(parent, parent.id, { childSessionId: childId, text: 'parent context for A', askRef: 'A' }, new AbortController().signal, { loci: { findBySessionId: id => world.durable.findBySessionId(id), findCurrentSerializedDelivery: input => world.durable.findCurrentSerializedDelivery(input), listEntryEndpointsOfMain: () => [initial.endpoint] }, subagents: () => ctx.subagents as never })).toEqual({ ok: true })
    releaseStep.resolve()
    await replyStarted.promise
    expect(turns.currentCapabilityForChild!(childId)).toMatchObject({ deliveryId: a.record.deliveryId })
    const parentClaim = claims.find(value => value.sourceKind === 'agent-message')!
    expect(parentClaim.turn).toBe(claims.find(value => value.messageId === start.messageId)!.turn)
    expect(await controller.handleAdmission({ kind: 'accepted', authorization: 'authorized', needsInitialization: false, message: { kind: 'message', messageId: 'B', endpoint: row.endpoint, text: 'B', senderOpenId: 'owner', chatType: 'group', replyTarget: { ...row.endpoint, messageId: 'B' } } })).toMatchObject({ kind: 'accepted', executionId: '' })
    expect(world.durable.findDeliveryByMessageId('B')).toMatchObject({ status: 'accepted' })
    await world.durable.completeCurrentDelivery({ ...correlation, deliveryId: a.record.deliveryId, outcome: 'no-reply', reason: 'done', outboundResult: 'none', now: 1006 })
    await controller.dispatchNext(correlation)
    const b = world.durable.findDeliveryByMessageId('B')!
    expect(b).toMatchObject({ status: 'current' })
    expect(b.inboxMessageId).toBeTruthy()
    expect(b.inboxMessageId).not.toBe(start.messageId)
    expect(claims.some(value => value.messageId === b.inboxMessageId)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    releaseA.resolve()
    await bStarted.promise
    const bClaim = claims.find(value => value.messageId === b.inboxMessageId)!
    expect(bClaim.sourceKind).toBe('user')
    expect(bClaim.turn).toBeGreaterThan(parentClaim.turn)
    expect(turns.currentCapabilityForChild!(childId)).toMatchObject({ deliveryId: b.deliveryId, executionId: b.executionId, source: 'delivery' })
    expect(world.durable.findDeliveryByInboxMessageId(bClaim.messageId)?.deliveryId).toBe(b.deliveryId)
  } finally {
    releaseStep.resolve(); releaseA.resolve(); releaseB.resolve()
    controller?.dispose(); childDelivery?.dispose(); turns?.dispose()
    await ctx.fiber.dispose(); await world.close()
    if (resolve(root) !== root || !root.startsWith(join(tmpdir(), 'locus-queue-'))) throw new Error('unexpected test cleanup root')
    await rm(root, { recursive: true, force: true })
  }
})
