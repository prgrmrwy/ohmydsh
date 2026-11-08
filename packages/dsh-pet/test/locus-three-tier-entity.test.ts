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
import { LocusController } from '../src/host/locus/controller.js'
import { Topology } from './support/w-topology.js'

const make = (options?: ConstructorParameters<typeof Topology>[0]) => {
  const t = new Topology(options)
  return { t, controller: new LocusController(t.deps()) }
}

describe('Locus 三层实体', () => {
  it('concurrent bindings in different groups reuse one work-session coordinator', async () => {
    const { t, controller } = make()
    const entries = await Promise.all(['oc_a', 'oc_b'].map(chatId => controller.ensureGroup({ chatId, parentSessionId: 'W1' })))
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    const mains = entries.map(entry => (entry.group as { locusMainSessionId: string }).locusMainSessionId)
    expect(new Set(mains).size).toBe(1)
  })

  it('locus 主会话归 DSH Pet，入口仍关联工作项目', async () => {
    const { t, controller } = make()
    const entry = await controller.ensureGroup({ chatId: 'oc_project', parentSessionId: 'W1' })
    const group = t.repository.getRow({ chatId: 'oc_project' }) as { locusMainSessionId: string; workspaceId: string }
    // W stays in the source workspace; M runs in the Pet workspace; the row names the project.
    expect(t.resolved).toContain('W1')
    const main = await t.deps().dsh.resolveSession(group.locusMainSessionId)
    expect(main).toMatchObject({ workspaceId: 'pet-ws', title: '[locus] W1' })
    expect(t.repository.mains.get(group.locusMainSessionId)).toMatchObject({ workSessionId: 'W1', workspaceId: 'pet-ws', status: 'active' })
    expect(group.workspaceId).toBe('proj-1')
    expect(entry.group.workspaceId).toBe('proj-1')

    // An M left in the source workspace is replaced through whole-W migration; history is kept.
    t.addSession({ id: group.locusMainSessionId, workspaceId: 'proj-1', title: main!.title ?? '', agentPreset: 'locus-base' })
    const migrated = await controller.ensureEntry({ chatId: 'oc_project' })
    const after = t.repository.getRow({ chatId: 'oc_project' }) as { locusMainSessionId: string; workspaceId: string }
    expect(after.locusMainSessionId).not.toBe(group.locusMainSessionId)
    expect(await t.deps().dsh.resolveSession(after.locusMainSessionId)).toMatchObject({ workspaceId: 'pet-ws' })
    expect(t.repository.mains.get(group.locusMainSessionId)?.status).toBe('retired')
    expect(after.workspaceId).toBe('proj-1')
    expect(migrated.locus.workspaceId ?? after.workspaceId).toBe('proj-1')
    expect(await t.deps().dsh.resolveSession(group.locusMainSessionId)).toBeDefined()
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
      const petWs: LocusWorkspaceEntity = {
        ...ws, id: WorkspaceId('ws-pet'), path: '/pet/workspace',
        attachSession: vi.fn(async () => undefined), detachSession: vi.fn(async () => undefined),
      }
      const created: { meta?: { agentPreset?: string; cwd?: string } }[] = []
      const mounted: string[] = []
      const deps: ProductionLocusDshPortDeps = {
        repository: { getChannelConfig: () => ({ defaultWorkspaceId: 'ws-1' }) },
        locusMainWorkspaceId: 'ws-pet',
        sessionController: {
          inspect: vi.fn(async sessionId => ({ meta: { id: sessionId }, events: events as never })),
        },
        workspaceRegistry: { get: id => id === petWs.id ? petWs : id === ws.id ? ws : undefined, list: () => [ws, petWs], archivedSessionIds: [] },
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
      return { port: createProductionLocusDshPort(deps), dispose, created, mounted, ws: petWs, workWs: ws }
    }

    // The locked-down surface: no bash/write/edit/delegation, collab kept,
    // approval never, sandbox read-only.
    const good = make(lockedTools, { approval: 'never', sandbox: 'read-only' })
    const main = await good.port.createLocusMainSession({ workSessionId: 'work-1', workspaceId: 'ws-1', label: 'Locus 主会话 · 研发' })
    expect(main).toMatchObject({ id: 'locus-main-session', workspaceId: 'ws-pet' })
    expect(good.created[0]?.meta?.cwd).toBe('/pet/workspace')
    expect(good.ws.attachSession).toHaveBeenCalledWith('locus-main-session')
    expect(good.workWs.attachSession).not.toHaveBeenCalled()
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

  it('工作主会话不得是子会话', async () => {
    const { t, controller } = make({ sessions: [{ id: 'sub-1', workspaceId: 'proj-1', title: 'sub', state: 'active', parentSessionId: 'W1' }] })
    // `sub-1` is a subagent child of W1: not a session the owner works in.
    await expect(controller.ensureGroup({ chatId: 'oc_bind_child', parentSessionId: 'sub-1' })).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED' })

    // Nor may Pet's own locus main stand in as someone's work session.
    await controller.ensureGroup({ chatId: 'oc_dev', parentSessionId: 'W1' })
    const m = (t.repository.getRow({ chatId: 'oc_dev' }) as { locusMainSessionId: string }).locusMainSessionId
    await expect(controller.ensureGroup({ chatId: 'oc_bind_main', parentSessionId: m })).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED' })

    // Refused means nothing was built for the refused binds.
    expect(t.repository.mains.size).toBe(1)
    expect(t.repository.getRow({ chatId: 'oc_bind_child' })).toBeUndefined()
    expect(t.repository.getRow({ chatId: 'oc_bind_main' })).toBeUndefined()
  })
})
