/** Official AgentLoop cancellation persisted to JSONL and read by a fresh sessionQuery. */
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query'
import Agents from '@deepseek-ai/dsh-agent'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Projections from '@deepseek-ai/dsh-session-projection'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { proveStartupDeliveryFromColdRead } from '../src/host/locus/startup-recovery.js'
import { openThreeTier } from './support/three-tier.js'

it.each(['user', 'parent', 'disposed'] as const)('official aborted %s survives persisted cold recovery without replay', async kind => {
  const world = await openThreeTier()
  const writer = new Context()
  const reader = new Context()
  const root = await mkdtemp(join(tmpdir(), 'locus-startup-cancel-'))
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  try {
    await writer.plugin(Sessions)
    await writer.plugin(Persistence, { root })
    await writer.plugin(Query)
    for (const plugin of [Agents, Llm, Tools, Prompt, Projections]) await writer.plugin(plugin)
    writer.llm.registerAdapter(['fake'], new class extends LlmAdapter {
      override async *stream() {
        started.resolve()
        await release.promise
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
    }())
    await writer.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
    await writer.plugin(Subagents)
    await writer.plugin(Spawn)
    const entry = await world.controller.ensureGroup({ chatId: 'cancel-chat', parentSessionId: 'work-1' })
    const row = world.durable.getLocus(entry.locus.locusId)!
    const childSessionId = row.reservedChildSessionId!
    await world.durable.publishCreatedChild({ locusId: row.id, generation: row.generation, childSessionId, now: 1000 })
    const correlation = { endpoint: row.endpoint, locusId: row.id, generation: row.generation, childSessionId }
    const a = await world.durable.acceptDelivery({ ...correlation, messageId: 'A', text: 'A', senderOpenId: 'owner', acceptedAt: 1001 })
    const b = await world.durable.acceptDelivery({ ...correlation, messageId: 'B', text: 'B', senderOpenId: 'owner', acceptedAt: 1002 })
    await world.durable.claimCurrentDelivery({ correlation, now: 1003 })
    const parent = await writer.agentLoop.create(SessionId(row.parentSessionId), { provider: 'fake', model: 'text' })
    const submitted = await writer.subagents.startContinuable({
      provider: 'spawn', label: 'cancel-child', childId: SessionId(childSessionId),
      request: { parent, prompt: [{ type: 'text', text: 'A' }] }, signal: new AbortController().signal,
    })
    await started.promise
    await world.durable.bindQueued({ deliveryId: a.record.deliveryId, correlation, executionId: 'exec-A', inboxMessageId: submitted.messageId, queuedAt: 1004 })
    const child = writer.agents.get(SessionId(childSessionId))!
    const turn = child.session.snapshotEvents().find(event => event.type === 'turn/start')!.data.turn
    await world.durable.bindTurn({ deliveryId: a.record.deliveryId, correlation, executionId: 'exec-A', turnId: `${childSessionId}#${turn}`, startedAt: 1005 })
    child.cancel({ kind })
    release.resolve()
    await child.whenIdle()
    await writer.sessions.flush(child.session)
    // Assert the producer's real event before the Pet reader sees it.
    expect(child.session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({ data: { turn, reason: { kind: 'aborted', reason: { kind } } } })
    expect(await proveStartupDeliveryFromColdRead({
      delivery: world.durable.getDelivery(a.record.deliveryId)!, parentSessionId: row.parentSessionId,
      query: { observeSession: (id, options) => writer.sessionQuery.observeSession(SessionId(id), options) }, log: () => {},
    })).toEqual({ deliveryId: a.record.deliveryId, executionId: 'exec-A', turnId: `${childSessionId}#${turn}`, state: 'interrupted' })
    await writer.fiber.dispose()

    await reader.plugin(Sessions)
    await reader.plugin(Persistence, { root })
    await reader.plugin(Query)
    const observed = await reader.sessionQuery.observeSession(SessionId(childSessionId), { projectionMode: 'none' })
    try {
      expect(observed.source).toBe('prepared')
      expect(observed.events.find(event => event.type === 'turn/end')).toMatchObject({ data: { turn, reason: { kind: 'aborted', reason: { kind } } } })
    } finally { observed[Symbol.dispose]() }
    const query = { observeSession: (id: string, options?: { projectionMode?: 'all' | 'none'; signal?: AbortSignal }) => reader.sessionQuery.observeSession(SessionId(id), options) }
    const report = await world.durable.reconcileStartup({
      now: 2000,
      deliveryProof: delivery => proveStartupDeliveryFromColdRead({ delivery, parentSessionId: row.parentSessionId, query, log: () => {} }),
    })
    expect(report.failedDeliveries).toEqual([expect.objectContaining({ deliveryId: a.record.deliveryId, status: 'failed', startupDisposition: 'turn-interrupted' })])
    expect(report.replayableDeliveries).toEqual([])
    expect(await world.durable.claimCurrentDelivery({ correlation, now: 2001 })).toMatchObject({ deliveryId: b.record.deliveryId })
    expect(world.durable.getLocus(row.id)).toMatchObject({ generation: row.generation, childSessionId, state: 'active' })
    // Cold evidence reads never activate either native session.
    expect(reader.agents?.get(SessionId(childSessionId))).toBeUndefined()
    expect(reader.sessions.get(SessionId(childSessionId))).toBeUndefined()
  } finally {
    release.resolve()
    await writer.fiber.dispose()
    await reader.fiber.dispose()
    await world.close()
    if (resolve(root) !== root || !root.startsWith(join(tmpdir(), 'locus-startup-cancel-'))) throw new Error('unexpected test cleanup root')
    await rm(root, { recursive: true, force: true })
  }
})
