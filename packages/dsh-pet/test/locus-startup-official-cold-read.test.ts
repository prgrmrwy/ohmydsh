/** Official AgentLoop cancellation persisted to JSONL and read by a fresh sessionQuery. */
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query'
import Agents from '@deepseek-ai/dsh-agent'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
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
import { expect, it } from 'vitest'
import { proveStartupDeliveryFromColdRead } from '../src/host/locus/startup-recovery.js'
import { recoverLocusStartupV20 } from '../src/host/locus/reconcile.js'
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
    // DSH 0.2.1 subagent runtime injects workingDirectory (which injects fs).
    await writer.plugin(FsLocal, { cwd: realpathSync(tmpdir()) }); await writer.plugin(WorkingDirectory, { defaultDirectory: realpathSync(tmpdir()) })
    await writer.plugin(Subagents)
    await writer.plugin(Spawn)
    await world.controller.ensureGroup({ chatId: 'cancel-chat', parentSessionId: 'work-1' })
    const row = world.durable.getRow({ chatId: 'cancel-chat' })!
    const childSessionId = row.sessionId
    const mainId = (row as unknown as { readonly locusMainSessionId: string }).locusMainSessionId
    const correlation = { endpoint: row.endpoint, locusId: row.locusId, sessionId: childSessionId }
    const a = await world.durable.acceptDelivery({ ...correlation, messageId: 'A', text: 'A', senderOpenId: 'owner', acceptedAt: 1001 } as never)
    const b = await world.durable.acceptDelivery({ ...correlation, messageId: 'B', text: 'B', senderOpenId: 'owner', acceptedAt: 1002 } as never)
    await world.durable.claimCurrentDelivery({ ...correlation, now: 1003 } as never)
    await world.durable.publishFirstDelivery({ locusId: row.locusId, sessionId: childSessionId, revision: row.revision, deliveryId: a.record.deliveryId, now: 1000, executionId: 'exec-A' })
    await world.durable.commitFirstDelivery({ executionId: 'exec-A', now: 1000 })
    const parent = await writer.agentLoop.create(SessionId(mainId), { provider: 'fake', model: 'text' })
    const submitted = await writer.subagents.startActivation({
      provider: 'spawn', label: 'cancel-child', childId: SessionId(childSessionId),
      request: { parent, prompt: [{ type: 'text', text: 'A' }] }, signal: new AbortController().signal, delivery: 'parent',
    })
    await started.promise
    await world.durable.bindQueued({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'exec-A', inboxMessageId: submitted.messageId, queuedAt: 1004 } as never)
    const child = writer.agents.get(SessionId(childSessionId))!
    const turn = child.session.snapshotEvents().find(event => event.type === 'turn/start')!.data.turn
    await world.durable.bindTurn({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'exec-A', turnId: `${childSessionId}#${turn}`, startedAt: 1005 } as never)
    child.cancel({ kind })
    release.resolve()
    await child.whenIdle()
    await writer.sessions.flush(child.session)
    // Assert the producer's real event before the Pet reader sees it.
    expect(child.session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({ data: { turn, reason: { kind: 'aborted', reason: { kind } } } })
    expect(await proveStartupDeliveryFromColdRead({
      delivery: world.durable.getDelivery(a.record.deliveryId)! as never, parentSessionId: mainId,
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
    const report = await recoverLocusStartupV20(world.durable, {
      now: 2000,
      deliveryProof: delivery => proveStartupDeliveryFromColdRead({ delivery: delivery as never, parentSessionId: mainId, query, log: () => {} }),
    })
    expect(report.failedDeliveries).toEqual([expect.objectContaining({ deliveryId: a.record.deliveryId, status: 'failed', startupDisposition: 'turn-interrupted' })])
    expect(report.replayableDeliveries).toEqual([])
    expect((await world.durable.claimCurrentDelivery({ ...correlation, now: 2001 } as never)).record).toMatchObject({ deliveryId: b.record.deliveryId })
    expect(world.durable.getRow({ chatId: 'cancel-chat' })).toMatchObject({ sessionId: childSessionId, state: 'active', revision: row.revision })
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
