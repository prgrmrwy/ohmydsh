import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import {
  createProductionLocusDshPort,
  type LocusWorkspaceEntity,
  type ProductionLocusDshPortDeps,
} from '../src/host/locus/dsh-port.js'
import { LOCUS_MAIN_DENIED_TOOLS } from '../src/host/locus/locus-main.js'
import { openThreeTier } from './support/three-tier.js'

describe('Locus 三层实体', () => {
  it('同一干活主会话服务多个入口', async () => {
    const world = await openThreeTier()
    try {
      const group = await world.controller.ensureGroup({ chatId: 'oc_dev', parentSessionId: 'work-1' })
      const topic = await world.controller.ensureTopic({
        chatId: 'oc_dev',
        threadId: 'omt_a',
        parentSessionId: 'work-1',
      })

      const active = world.durable.listLocusMains().filter(
        main => main.workSessionId === 'work-1' && main.status === 'active',
      )
      expect(active).toHaveLength(1)
      const [main] = active
      // Both entries hang under the ONE locus main; neither under the work session.
      expect(group.locus.parentSessionId).toBe(main!.locusMainSessionId)
      expect(topic.locus.parentSessionId).toBe(main!.locusMainSessionId)
      expect(group.locus.parentSessionId).not.toBe('work-1')
      expect(world.world.createdMains).toHaveLength(1)
      expect(world.durable.getLocus(topic.locus.locusId)).toMatchObject({
        parentSessionId: main!.locusMainSessionId,
        parentLocusId: group.locus.locusId,
      })
    } finally { await world.close() }
  })

  it('concurrent bindings in different groups reuse one work-session coordinator', async () => {
    const world = await openThreeTier()
    try {
      const entries = await Promise.all(['oc_a', 'oc_b'].map(chatId =>
        world.controller.ensureGroup({ chatId, parentSessionId: 'work-1' })))
      expect(world.world.createdMains).toHaveLength(1)
      expect(new Set(entries.map(entry => entry.locus.parentSessionId)).size).toBe(1)
    } finally { await world.close() }
  })

  it('locus 主会话工具面锁死', async () => {
    const lockedTools = ['read', 'glob', 'grep', 'collab_read', 'collab_send_message', 'locus_note']
    const make = (visible: readonly string[], policy: { approval: string; sandbox: string }) => {
      const events: { type: string; data: unknown }[] = []
      const dispose = vi.fn(async () => undefined)
      const ws: LocusWorkspaceEntity = {
        id: WorkspaceId('ws-1'),
        path: '/workspaces/ws-1',
        sessionIds: [],
        status: async () => 'ok',
        attachSession: vi.fn(async () => undefined),
        detachSession: vi.fn(async () => undefined),
      }
      const created: { meta?: { agentPreset?: string } }[] = []
      const mounted: string[] = []
      const deps: ProductionLocusDshPortDeps = {
        repository: { getChannelConfig: () => ({ defaultWorkspaceId: 'ws-1' }) },
        sessionController: {
          inspect: vi.fn(async sessionId => ({ meta: { id: sessionId }, events: events as never })),
        },
        workspaceRegistry: { get: () => ws, list: () => [ws], archivedSessionIds: [] },
        agents: {
          create: vi.fn(async options => {
            created.push(options as never)
            const agent = { id: options.sessionId }
            await options.setup?.({ scope: 'agent' } as unknown as Context, agent)
            return { agent, dispose }
          }),
        },
        agentPresets: {
          defaultId: 'standard',
          list: () => [{ id: 'locus-base' }],
          mount: vi.fn(async (_ctx, id) => { mounted.push(id) }),
        },
        agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
        sessions: { get: id => ({ id: SessionId(String(id)) }) as unknown as Session, flush: async () => true },
        sessionTitle: { rename: (_session, title) => ({ title }) },
        createSessionId: () => 'locus-main-session',
        locusMainLockdown: {
          restrict: vi.fn(() => undefined),
          // The fake appends exactly what the policy said, the way the real
          // setters append log events; the port then reads them back.
          applyPolicy: () => {
            events.push({ type: 'approval/policy', data: { policy: policy.approval } })
            events.push({ type: 'sandbox/mode', data: { mode: policy.sandbox } })
          },
          visibleTools: () => visible,
        },
      }
      return { port: createProductionLocusDshPort(deps), dispose, created, mounted, ws }
    }

    // The locked-down surface: no bash/write/edit/delegation, collab kept,
    // approval never, sandbox read-only.
    const good = make(lockedTools, { approval: 'never', sandbox: 'read-only' })
    const main = await good.port.createLocusMainSession({ workSessionId: 'work-1', workspaceId: 'ws-1', label: 'Locus 主会话 · 研发' })
    expect(main).toMatchObject({ id: 'locus-main-session', workspaceId: 'ws-1' })
    expect(good.created[0]?.meta?.agentPreset).toBe('locus-base')
    expect(good.mounted).toEqual(['locus-base'])
    for (const denied of ['bash', 'write', 'edit', 'subagent', 'send_message']) {
      expect(LOCUS_MAIN_DENIED_TOOLS).toContain(denied)
    }

    // Anything wider, softer or unreadable is refused and rolled back.
    const leaks: [string, readonly string[], { approval: string; sandbox: string }][] = [
      ['a shell tool is visible', [...lockedTools, 'bash'], { approval: 'never', sandbox: 'read-only' }],
      ['a delegation tool is visible', [...lockedTools, 'subagent'], { approval: 'never', sandbox: 'read-only' }],
      ['collab tools are missing', ['read', 'glob'], { approval: 'never', sandbox: 'read-only' }],
      ['approval can ask', lockedTools, { approval: 'ask', sandbox: 'read-only' }],
      ['the sandbox can write', lockedTools, { approval: 'never', sandbox: 'workspace-write' }],
    ]
    for (const [label, tools, policy] of leaks) {
      const bad = make(tools, policy)
      await expect(
        bad.port.createLocusMainSession({ workSessionId: 'work-1', workspaceId: 'ws-1', label: 'x' }),
        label,
      ).rejects.toThrow(/locked-down surface/)
      expect(bad.dispose, label).toHaveBeenCalledOnce()
      expect(bad.ws.detachSession, label).toHaveBeenCalledOnce()
    }
  })

  it('干活主会话不得是子会话', async () => {
    const world = await openThreeTier()
    try {
      // `subagent-1` is a subagent child of work-1: not a session the owner works in.
      await expect(
        world.controller.ensureGroup({ chatId: 'oc_bind_child', parentSessionId: 'subagent-1' }),
      ).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED' })

      // Nor may Pet's own locus main stand in as someone's work session.
      const group = await world.controller.ensureGroup({ chatId: 'oc_dev', parentSessionId: 'work-1' })
      await expect(
        world.controller.ensureGroup({ chatId: 'oc_bind_main', parentSessionId: group.locus.parentSessionId }),
      ).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED' })

      // Refused means nothing was built for the refused binds.
      expect(world.durable.listLocusMains()).toHaveLength(1)
      expect(world.durable.getLatestLocusByEndpoint({ chatId: 'oc_bind_child' })).toBeUndefined()
      expect(world.durable.getLatestLocusByEndpoint({ chatId: 'oc_bind_main' })).toBeUndefined()
    } finally { await world.close() }
  })
})
