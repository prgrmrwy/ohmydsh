/** Real Pet entry + Cordis/Storage/Tools: exercise Host wiring, not helper replicas. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as petPlugin from '../src/index.js'
import * as PetStorage from '../src/host/storage/plugin.js'
import * as channelCapability from '../src/host/channel/locus-capability.js'
import * as lark from '../src/host/channel/lark.js'
import { PET_BACKEND_NAME } from '../src/host/storage/backend.js'
import { PET_DOMAIN_NAME } from '../src/host/spec.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import { LOCUS_SAFE_TOOL_NAMES, LOCUS_SHELL_TIER_TOOL_NAMES, LOCUS_DELEGATION_DENYLIST } from '../src/host/locus/composition.js'

const hosts: Context[] = []
afterEach(async () => {
  for (const ctx of hosts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function host() {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-host-wiring-'))
  const project = await mkdtemp(path.join(tmpdir(), 'pet-host-project-'))
  const ctx = new Context()
  hosts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // AgentLoop mints its agent scopes from an injected runtime context. A scope
  // minted under a bare test root has no declared tools API in Cordis.
  let agentFactoryContext!: Context
  await ctx.plugin({ name: 'official-agent-context', inject: ['tools', 'systemPrompt'], apply(scope: Context) { agentFactoryContext = scope } })
  const routes: unknown[] = []
  const sessions = new Map<string, ReturnType<typeof makeSession>>()
  const agents = new Map<string, any>()
  function makeSession(id: string, parentSession?: string) {
    const events: any[] = []
    return {
      id, header: { id, cwd: project, agentPreset: id === 'ordinary' ? 'standard' : LOCUS_BASE_PRESET, ...(parentSession ? { parentSession, origin: 'subagent' } : {}) },
      seq: 0,
      snapshotEvents: () => events,
      append(type: string, data: unknown) { events.push({ type, data, seq: events.length + 1, time: Date.now() }); this.seq++ },
    }
  }
  function addAgent(id: string, child = false) {
    const session = makeSession(id, child ? 'main' : undefined)
    sessions.set(id, session)
    const agent: any = { id, session, followup: vi.fn(), whenIdle: async () => {} }
    const scoped = createScope(agentFactoryContext, agent)
    agent.ctx = scoped.ctx
    agents.set(id, agent)
    return agent
  }
  for (const name of new Set([...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_SHELL_TIER_TOOL_NAMES, 'write', 'edit', ...LOCUS_DELEGATION_DENYLIST, 'collab_status'])) {
    ctx.tools.register(defineTool({
      name, description: 'Host composition probe', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => true,
    }))
  }
  const main = addAgent('main')
  const ordinary = addAgent('ordinary')
  const workspace = {
    id: 'ws', path: project, title: 'Project', sessionIds: ['main', 'ordinary'],
    status: async () => 'ok', attachSession: async (id: string) => { workspace.sessionIds.push(id) }, detachSession: async () => {},
  }
  ctx.provide('webServer', { register: (route: unknown) => { routes.push(route); return () => {} } })
  ctx.provide('connection', { requestRejection: () => undefined })
  ctx.provide('workspaceRegistry', { list: () => [workspace], get: () => workspace, create: async () => workspace, archivedSessionIds: [], archiveSession: async () => {} })
  ctx.provide('sessions', { list: () => [...sessions.values()], get: (id: string) => sessions.get(id), flush: async () => true })
  ctx.provide('agents', { list: () => [...agents.values()], get: (id: string) => agents.get(id), resume: async () => undefined, create: async () => { throw new Error('unexpected main creation') } })
  ctx.provide('sessionController', {
    inspect: async (id: string) => { const session = sessions.get(id); if (!session) throw new Error('missing'); return { meta: session.header, events: session.snapshotEvents() } },
    resolveAgent: async (id: string) => ({ agent: agents.get(id) }),
  })
  ctx.provide('sessionQuery', {
    observeSession: async (id: string) => {
      const session = sessions.get(id)
      if (!session) throw new Error('missing durable session')
      return { header: session.header, events: session.snapshotEvents(), source: 'live', projections: { values: { agentPreset: session.header.agentPreset } }, [Symbol.dispose]() {} }
    },
  })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'test' }) })
  ctx.provide('agentPresets', { list: async () => [{ id: LOCUS_BASE_PRESET }], mount: async () => {} })
  ctx.provide('llm', { listProviders: () => [{ id: 'test' }] })
  ctx.provide('sessionTitle', { rename: async (_session: unknown, title: string) => ({ title }), get: () => 'Project' })
  ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })
  ctx.provide('sandboxPolicy', {
    resolve: ({ session }: { session: ReturnType<typeof makeSession> }) => ({
      mode: [...session.snapshotEvents()].reverse().find(event => event.type === 'sandbox/mode')?.data.mode,
      workspaceRoot: project,
    }),
  })
  const queue = vi.fn(async () => 'later-inbox')
  const sendMessage = vi.fn(async () => ({}))
  let firstTool: ((agent: any) => Promise<void>) | undefined
  let apiReturned = false
  const start = vi.fn(async (spec: any) => {
    expect(spec.request.parent).toBe(main)
    const child = addAgent(spec.childId, true)
    child.ctx.tools.restrict(spec.request.toolFilter)
    await ctx.serial(scopeTarget(child, child), 'agent/created', { agent: child, source: 'create' } as never)
    child.session.append('turn/start', { turn: 1 })
    ctx.emit(scopeTarget(child, child), 'agent/inbox/claimed' as never, { agent: child, message: { id: 'first-inbox', source: { kind: 'user' } }, turn: 1 } as never)
    await firstTool?.(child)
    apiReturned = true
    return { childId: child.id, messageId: 'first-inbox' }
  })
  const drain = vi.fn(async (_parent: unknown, children: readonly string[]) => { for (const id of children) agents.delete(id) })
  ctx.provide('subagents', {
    startContinuable: start, drainContinuableChildren: drain, getProvider: () => ({ inheritsParentContext: false }),
    listChildren: async () => [], sendMessage,
    [Symbol.for('dsh.subagent.deliverPrompt')]: queue,
  })
  vi.spyOn(lark, 'createLarkCliClient').mockReturnValue({
    probeEntranceRead: async () => true, chatName: async () => 'Project', resolveMemberName: async () => 'Owner',
    listChatBots: async () => [], addReaction: async () => undefined, removeReaction: async () => {}, reply: async () => 'receipt',
  } as never)
  let capability: channelCapability.LocusChannelCapability | undefined
  const createCapability = channelCapability.createLocusChannelCapability
  vi.spyOn(channelCapability, 'createLocusChannelCapability').mockImplementation(deps => {
    capability = createCapability(deps)
    return capability
  })
  await ctx.plugin(PetStorage as never, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
  await ctx.plugin(StorageDomain, { backend: PET_BACKEND_NAME })
  await ctx.plugin(petPlugin, { home, version: 'test' })
  await vi.waitFor(() => expect(routes.length).toBeGreaterThan(0))
  expect(capability).toMatchObject({ status: 'available' })
  const repository = new LocusRepository(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
  await ctx.storage.domain.get(PET_DOMAIN_NAME)!.table('locus_mains').put('main', {
    workSessionId: 'ordinary', locusMainSessionId: 'main', workspaceId: 'ws', generation: 1, status: 'active', spaceId: 'space', createdAt: 1, updatedAt: 1,
  })
  const controller = (capability as channelCapability.AvailableLocusChannelCapability).controller
  const execute = (agent: any, name: string) => ctx.tools.execute({ agent, name, callId: `call-${name}` as never, arguments: {}, signal: new AbortController().signal })
  return { ctx, repository, main, ordinary, agents, sessions, start, queue, sendMessage, drain, controller, execute, firstTool: (fn: typeof firstTool) => { firstTool = fn }, apiReturned: () => apiReturned }
}

async function seedNotCreated(h: Awaited<ReturnType<typeof host>>) {
  await h.repository.putLocus({
    id: 'entry', generation: 1, endpoint: { chatId: 'chat' }, parentSessionId: 'main', reservedChildSessionId: 'child', workspaceId: 'ws',
    source: 'auto', state: 'not-created', permission: { desired: 'read', effective: 'read', verifiedAt: 1 }, toolTier: { desired: 'safe', effective: 'safe' }, busy: false, createdAt: 1, updatedAt: 1,
  })
}

function admit(h: Awaited<ReturnType<typeof host>>) {
  return h.controller.handleAdmission!({
    kind: 'accepted', authorization: 'authorized', needsInitialization: false,
    message: { kind: 'message', chatType: 'group', messageId: 'original-message', endpoint: { chatId: 'chat' }, senderOpenId: 'owner', text: 'original question', replyTarget: { chatId: 'chat', messageId: 'original-message' } },
  })
}

describe('actual Host three-tier assembly', () => {
  it('cold-restores a locked main with its own tools, preserving collab and ordinary sessions', async () => {
    const h = await host()
    const before = h.ctx.tools.schemas(h.ordinary).map(tool => tool.name)
    await h.ctx.serial(scopeTarget(h.main, h.main), 'agent/created', { agent: h.main, source: 'resume' } as never)
    const names = h.ctx.tools.schemas(h.main).map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['locus_note', 'locus_reply_child', 'collab_status']))
    for (const name of ['bash', 'write', 'edit', ...LOCUS_DELEGATION_DENYLIST]) expect(names).not.toContain(name)
    expect(h.main.session.snapshotEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'read-only' } }),
      expect.objectContaining({ type: 'approval/policy', data: { policy: 'never' } }),
    ]))
    await h.ctx.serial(scopeTarget(h.ordinary, h.ordinary), 'agent/created', { agent: h.ordinary, source: 'resume' } as never)
    expect(h.ctx.tools.schemas(h.ordinary).map(tool => tool.name)).toEqual(before)
    expect(h.ordinary.session.snapshotEvents()).toEqual([])
    expect(h.ordinary.session.header.agentPreset).toBe('standard')
    expect(before).toEqual(expect.arrayContaining(['bash', 'write', 'edit', ...LOCUS_DELEGATION_DENYLIST]))
    expect(before).not.toContain('locus_note')
  })

  it('插件挂入自有作用域的委派工具在执行时被拒: refuses Agent Team tools mounted in its own scope', async () => {
    const h = await host()
    // The official Team plugin makes every ordinary root a Lead and registers
    // its tools into that agent's OWN scope, which tools.restrict cannot hide.
    const team = ['spawn_teammate', 'team_task_create']
    const ran: string[] = []
    for (const name of team) {
      h.main.ctx.tools.register(defineTool({
        name, description: 'Team probe', parameters: {},
        output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => { ran.push(name); return true },
      }))
    }
    await h.ctx.serial(scopeTarget(h.main, h.main), 'agent/created', { agent: h.main, source: 'resume' } as never)
    expect(h.ctx.tools.schemas(h.main).map(tool => tool.name)).toEqual(expect.arrayContaining(team))
    for (const name of team) expect(await h.execute(h.main, name)).toMatchObject({ isError: true })
    expect(ran).toEqual([])
    expect(await h.execute(h.main, 'collab_status')).not.toMatchObject({ isError: true })
  })

  it.each(['resolve', 'reject'] as const)('首工具等待持久绑定 / 首轮持久绑定失败拒绝执行: gates first caller-bound body on deferred durable UUID bind: %s', async outcome => {
    const h = await host()
    await seedNotCreated(h)
    const binding = deferred()
    const originalBind = LocusRepository.prototype.bindQueued
    const bind = vi.spyOn(LocusRepository.prototype, 'bindQueued').mockImplementation(async function(input) {
      await binding.promise
      return originalBind.call(this, input)
    })
    const bodies = vi.fn()
    let result: unknown
    h.firstTool(async child => {
      expect(h.apiReturned()).toBe(false)
      expect(h.repository.getLocus('entry')).toMatchObject({ state: 'active', childComposition: 'tier3', childSessionId: child.id })
      const definition = h.ctx.tools.get('pet_context', child)!
      const body = definition.execute
      vi.spyOn(definition, 'execute').mockImplementation(async (...args: any[]) => {
        bodies()
        const value = await body(...args)
        expect(JSON.parse((value as { json: string }).json)).toMatchObject({
          scope: 'locus', locus: { locusId: 'entry' },
          currentDelivery: { messageId: 'original-message', text: 'original question' },
        })
        expect(h.apiReturned()).toBe(false)
        return value
      })
      // This goes through the REAL Tools runtime, including the hook installed
      // by src/index.ts; no direct registry.whenBound call can make it pass.
      result = await h.execute(child, 'pet_context')
    })
    const handling = admit(h)
    await vi.waitFor(() => expect(bind).toHaveBeenCalled(), { timeout: 2_000 })
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ inboxMessageId: 'first-inbox' }))
    expect(h.repository.findDeliveryByInboxMessageId('first-inbox')).toBeUndefined()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(bodies).not.toHaveBeenCalled()
    expect(h.apiReturned()).toBe(false)
    if (outcome === 'resolve') binding.resolve()
    else binding.reject(new Error('durable UUID bind refused'))
    await handling
    expect(h.start).toHaveBeenCalledTimes(1)
    expect(h.queue).not.toHaveBeenCalled()
    expect(h.sendMessage).not.toHaveBeenCalled()
    expect(h.start.mock.calls[0]![0].request.prompt).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('original question') })]))
    if (outcome === 'resolve') {
      expect(bodies).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ isError: false })
      expect(JSON.stringify(result)).toContain('original-message')
      expect(h.repository.findDeliveryByInboxMessageId('first-inbox')).toMatchObject({ messageId: 'original-message', locusId: 'entry' })
    } else {
      expect(bodies).not.toHaveBeenCalled()
      expect(result).toMatchObject({ isError: true })
      expect(h.repository.findDeliveryByInboxMessageId('first-inbox')).toBeUndefined()
      expect(h.drain).toHaveBeenCalledTimes(1)
      expect(h.repository.getLocus('entry')).toMatchObject({ state: 'not-created', busy: false })
      expect(h.repository.findDeliveryByMessageId('original-message')).toMatchObject({ status: 'failed' })
    }
  })
})
