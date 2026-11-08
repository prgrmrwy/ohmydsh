/** Real Pet entry + Cordis/Storage/Tools: exercise Host wiring, not helper replicas. */
import { mkdir, mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { PET_PREPARE_STOP_ROUTE } from '../src/host/locus/stop-preparation.js'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { runTool } from './support/tool-call.js'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as petPlugin from '../src/index.js'
import * as PetStorage from '../src/host/storage/plugin.js'
import * as channelCapability from '../src/host/channel/locus-capability.js'
import * as lark from '../src/host/channel/lark.js'
import { PET_BACKEND_NAME } from '../src/host/storage/backend.js'
import { PET_DOMAIN_NAME } from '../src/host/spec.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { endpointKeyV20 } from '../src/host/locus/locus-set-v20.js'
import { PetRepository } from '../src/host/repository.js'
import { LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET } from '../src/host/locus/preset.js'
import { attestLocusComposition, LOCUS_SAFE_TOOL_NAMES, LOCUS_FULL_ACCESS_TOOL_NAMES, LOCUS_DELEGATION_DENYLIST } from '../src/host/locus/composition.js'

const hosts: Context[] = []
const temporaryRoots: string[] = []
afterEach(async () => {
  for (const ctx of hosts.splice(0)) await ctx.fiber.dispose()
  for (const directory of temporaryRoots.splice(0)) {
    if (!path.isAbsolute(directory) || path.dirname(directory) !== tmpdir() || !/^pet-host-(wiring|project)-/.test(path.basename(directory))) throw new Error('Unsafe test cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function host(options: { readonly degradeLate?: boolean; readonly withoutObserveSession?: boolean; readonly seedBeforeStart?: (domain: { table(name: string): { put(key: string, value: unknown): Promise<void> } }) => Promise<void> } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-host-wiring-'))
  const project = await mkdtemp(path.join(tmpdir(), 'pet-host-project-'))
  temporaryRoots.push(home, project)
  const ctx = new Context()
  hosts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
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
    if (child) session.header.cwd = main.session.header.cwd
    sessions.set(id, session)
    const agent: any = { id, session, followup: vi.fn(), whenIdle: async () => {} }
    const scoped = createScope(agentFactoryContext, agent)
    agent.ctx = scoped.ctx
    agents.set(id, agent)
    return agent
  }
  for (const name of new Set([...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_FULL_ACCESS_TOOL_NAMES, 'write', 'edit', ...LOCUS_DELEGATION_DENYLIST, 'collab_status'])) {
    ctx.tools.register(defineTool({
      name, description: 'Host composition probe', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => true,
    }))
  }
  const main = addAgent('main')
  const ordinary = addAgent('ordinary')
  const petPath = path.join(home, 'plugins', 'dsh-pet', 'workspace')
  main.session.header.cwd = petPath
  const workspace = {
    id: 'ws', path: project, title: 'Project', sessionIds: ['ordinary'],
    status: async () => 'ok', attachSession: vi.fn(async (id: string) => {
      if (sessions.get(id)?.header.cwd !== project) throw new Error('session cwd does not match project workspace')
      workspace.sessionIds.push(id)
    }), detachSession: async () => {},
  }
  const petWorkspace = {
    id: 'ws-pet', path: petPath, title: 'DSH Pet', sessionIds: ['main'],
    status: async () => 'ok', attachSession: vi.fn(async (id: string) => {
      if (sessions.get(id)?.header.cwd !== petPath) throw new Error('session cwd does not match Pet workspace')
      petWorkspace.sessionIds.push(id)
    }), detachSession: async () => {},
  }
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  // Cordis 4.1 hands out a per-caller traceable proxy for `ctx.webServer`; a spy installed on that
  // proxy is not seen by the child fibers that call `register` through their own proxy. Spy on the
  // underlying service object, which every caller reaches.
  const webServerService = (ctx.webServer as unknown as Record<symbol, unknown>)[Symbol.for('cordis.original')] as typeof ctx.webServer
  const registerRoute = webServerService.register.bind(webServerService)
  vi.spyOn(webServerService, 'register').mockImplementation(route => { routes.push(route); return registerRoute(route) })
  const authentication = { requestRejection: vi.fn((_request: unknown): 401 | 403 | undefined => undefined), authenticatedUrl: (origin: string) => `${origin}/?token=fixture-only` }
  ctx.provide('connection', authentication)
  ctx.provide('profileContext', { name: 'web', dir: home })
  ctx.provide('workspaceRegistry', { list: () => [workspace, petWorkspace], get: (id: string) => id === 'ws-pet' ? petWorkspace : id === 'ws' ? workspace : undefined, create: async () => petWorkspace, archivedSessionIds: [], archiveSession: async () => {} })
  ctx.provide('sessions', { list: () => [...sessions.values()], get: (id: string) => sessions.get(id), flush: async () => true })
  ctx.provide('agents', { list: () => [...agents.values()], get: (id: string) => agents.get(id), resume: async () => undefined, create: async () => { throw new Error('unexpected main creation') } })
  ctx.provide('sessionController', {
    // DSH 0.2.2 has no `sessionController.inspect`; Pet cold-inspects through `sessionQuery.observeSession`.
    resolveAgent: async (id: string) => ({ agent: agents.get(id) }),
  })
  ctx.provide('sessionQuery', options.withoutObserveSession === true ? {} : {
    observeSession: async (id: string) => {
      const session = sessions.get(id)
      if (!session) throw new Error('missing durable session')
      return { header: session.header, events: session.snapshotEvents(), source: 'live', projections: { values: { agentPreset: session.header.agentPreset } }, [Symbol.dispose]() {} }
    },
  })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'test' }) })
  ctx.provide('agentPresets', { list: async () => [{ id: LOCUS_BASE_PRESET }, { id: LOCUS_CHILD_PRESET }], mount: async () => {} })
  ctx.provide('llm', { listProviders: () => [{ id: 'test' }] })
  ctx.provide('sessionTitle', { rename: async (_session: unknown, title: string) => ({ title }), get: () => 'Project' })
  ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })
  ctx.provide('sandboxPolicy', {
    resolve: ({ session }: { session: ReturnType<typeof makeSession> }) => ({
      mode: [...session.snapshotEvents()].reverse().find(event => event.type === 'sandbox/mode')?.data.mode,
      workspaceRoot: session.header.cwd,
    }),
  })
  const queue = vi.fn(async () => 'later-inbox')
  const sendMessage = vi.fn(async () => ({}))
  let firstTool: ((agent: any) => Promise<void>) | undefined
  let apiReturned = false
  const start = vi.fn(async (spec: any) => {
    expect(spec.request.parent).toBe(main)
    const child = addAgent(spec.childId, true)
    // DSH 0.2.1 persists the independent preset selection with the child; there
    // is no request-level tool filter any more (a stale field would be ignored).
    expect(spec.request).not.toHaveProperty('toolFilter')
    expect(spec.request.agentPreset).toBe(LOCUS_CHILD_PRESET)
    expect(spec.delivery).toBe('parent')
    child.session.header.agentPreset = spec.request.agentPreset
    await ctx.serial(scopeTarget(child, child), 'agent/created', { agent: child, source: 'create' } as never)
    child.session.append('turn/start', { turn: 1 })
    ctx.emit(scopeTarget(child, child), 'agent/inbox/claimed' as never, { agent: child, message: { id: 'first-inbox', source: { kind: 'user' } }, turn: 1 } as never)
    await firstTool?.(child)
    apiReturned = true
    return { childId: child.id, messageId: 'first-inbox', result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => undefined }
  })
  const drain = vi.fn(async (_parent: unknown, children: readonly string[]) => { for (const id of children) agents.delete(id) })
  ctx.provide('subagents', {
    startActivation: start, drainChildren: drain, getProvider: () => ({ inheritsParentContext: false, capabilities: { agentPreset: true } }),
    listChildren: async (parentId: string) => [...sessions.values()].filter(session => session.header.parentSession === parentId).map(session => ({ id: session.id, parentSessionId: parentId, mode: 'continuable' })), sendMessage,
    [Symbol.for('dsh.subagent.deliverPrompt')]: queue,
  })
  const replyToTarget = vi.fn(async () => ({ messageId: 'notice-receipt' }))
  const strictPort = lark.createLocusLarkPort()
  const controlMessage = vi.fn(strictPort.sendControlMessage)
  vi.spyOn(lark, 'createLocusLarkPort').mockReturnValue({ ...strictPort, sendControlMessage: controlMessage })
  vi.spyOn(lark, 'createLarkCliClient').mockReturnValue({
    replyToTarget,
    probeEntranceRead: async () => true, chatName: async () => 'Project', resolveMemberName: async () => 'Owner',
    listChatBots: async () => [], addReaction: async () => undefined, removeReaction: async () => {}, reply: async () => 'receipt',
  } as never)
  let capability: channelCapability.LocusChannelCapability | undefined
  const createCapability = channelCapability.createLocusChannelCapability
  vi.spyOn(channelCapability, 'createLocusChannelCapability').mockImplementation(deps => {
    if (options.degradeLate === true) throw new Error('injected late initialization failure')
    capability = createCapability(deps)
    return capability
  })
  if (options.seedBeforeStart !== undefined || options.degradeLate === true) {
    // A stored set that violates the v20 invariants: Pet must not become ready.
    const { openMigratedDomain } = await import('./support/pet-domain-open.js')
    await mkdir(path.join(home, 'plugins', 'dsh-pet'), { recursive: true })
    const seeding = await openMigratedDomain(path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'))
    try { await options.seedBeforeStart?.(seeding.domain as never) } finally { await seeding.close() }
    await ctx.plugin(PetStorage as never, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
    await ctx.plugin(StorageDomain, { backend: PET_BACKEND_NAME })
    const warnings: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(' ')) })
    await ctx.plugin(petPlugin, { home, version: 'test' })
    await vi.waitFor(() => expect(warnings.some(line => line.includes('degraded'))).toBe(true), { timeout: 5_000 })
    warn.mockRestore()
    return { degraded: warnings, routes, ctx, home }
  }
  await ctx.plugin(PetStorage as never, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
  await ctx.plugin(StorageDomain, { backend: PET_BACKEND_NAME })
  if (options.withoutObserveSession === true) {
    const logs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })
    try {
      await ctx.plugin(petPlugin, { home, version: 'test' })
      await vi.waitFor(() => expect(logs.some(line => line.includes('ready'))).toBe(true), { timeout: 5_000 })
    } finally { log.mockRestore() }
    return { logs, routes, ctx, home, capability: () => capability }
  }
  await ctx.plugin(petPlugin, { home, version: 'test' })
  await vi.waitFor(() => expect(routes.length).toBeGreaterThan(0))
  expect(capability).toMatchObject({ status: 'available' })
  const repository = new LocusRepositoryV20(ctx.storage.domain.get(PET_DOMAIN_NAME) as never)
  await ctx.storage.domain.get(PET_DOMAIN_NAME)!.table('locus_mains').put('main', {
    workSessionId: 'ordinary', locusMainSessionId: 'main', workspaceId: 'ws-pet', generation: 1, status: 'active', spaceId: 'space', createdAt: 1, updatedAt: 1,
  })
  const controller = (capability as channelCapability.AvailableLocusChannelCapability).controller
  const execute = (agent: any, name: string) => runTool(ctx, { agent, name, callId: `call-${name}` as never, arguments: {}, signal: new AbortController().signal })
  return { ctx, home, project, authentication, workspace, petWorkspace, agentFactoryContext, repository, main, ordinary, agents, sessions, start, queue, sendMessage, drain, controller, replyToTarget, controlMessage, execute, firstTool: (fn: typeof firstTool) => { firstTool = fn }, apiReturned: () => apiReturned }
}

/** v20: one group row (owns M and the workspace) and, for a topic, a topic row under it. */
async function seedNotCreated(h: Awaited<ReturnType<typeof host>>, endpoint: { chatId: string; threadId?: string } = { chatId: 'chat' }) {
  const base = { state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 } as const
  const table = h.ctx.storage.domain.get(PET_DOMAIN_NAME)!.table('loci')
  await table.put(endpoint.chatId, {
    endpoint: { chatId: endpoint.chatId }, locusId: endpoint.threadId === undefined ? 'entry' : 'parent-entry',
    sessionId: endpoint.threadId === undefined ? 'child' : 'parent-child', ...base, locusMainSessionId: 'main', workspaceId: 'ws',
  })
  if (endpoint.threadId !== undefined) {
    await table.put(endpointKeyV20(endpoint), { endpoint, locusId: 'entry', sessionId: 'child', ...base })
  }
}

function admit(h: Awaited<ReturnType<typeof host>>, endpoint: { chatId: string; threadId?: string } = { chatId: 'chat' }, messageId = 'original-message', senderOpenId = 'owner') {
  return h.controller.handleAdmission!({
    kind: 'accepted', authorization: 'authorized', needsInitialization: false,
    message: { kind: 'message', chatType: 'group', messageId, endpoint, senderOpenId, text: 'original question', replyTarget: { ...endpoint, messageId, ...(endpoint.threadId === undefined ? {} : { rootMessageId: 'root-message' }) } },
  })
}

async function ownerRoute(h: { readonly ctx: Context }, route: string, body: Record<string, unknown>) {
  const origin = `http://127.0.0.1:${h.ctx.webServer.port}`
  const response = await fetch(`${origin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
  const text = await response.text()
  let result
  try { result = JSON.parse(text) } catch { result = text }
  return { status: response.status, body: result }
}
async function stopRequest(h: { readonly ctx: Context; readonly home: string }, action = 'prepare', extra: Record<string, unknown> = {}) {
  const filename = path.join(h.home, 'run', 'dsh-pet-stop', `${h.ctx.webServer.port}.json`)
  const descriptor = JSON.parse(await readFile(filename, 'utf8'))
  expect((await stat(filename)).mode & 0o777).toBe(0o600)
  expect((await stat(path.dirname(filename))).mode & 0o777).toBe(0o700)
  return ownerRoute(h, PET_PREPARE_STOP_ROUTE, { v: 1, action, nonce: 'host-stop-request', expectedHostPid: descriptor.pid, expectedBootId: descriptor.bootId, deadlineAt: Date.now() + 10_000, ...extra })
}

describe('actual Host three-tier assembly', () => {
  it('DSH 0.2.2: Locus provisioning composes through sessionQuery.observeSession alone (no sessionController.inspect)', async () => {
    const h = await host()
    expect(h.ctx.sessionController).not.toHaveProperty('inspect')
    expect(h.controller).toBeDefined()
  })

  it('without sessionQuery.observeSession Pet says why, keeps the unified channel unavailable, and does not guess a Session', async () => {
    const h: any = await host({ withoutObserveSession: true })
    expect(h.logs.some((line: string) => line.includes('Locus provisioning and Session listing unavailable: sessionQuery.observeSession is not provided'))).toBe(true)
    // The unified channel needs durable provisioning; its capability is never published.
    expect(h.capability()).toBeUndefined()
  })

  it('prepares only after exact owned native close and Pet commit; backlog waits for resume', async () => {
    const h = await host()
    await seedNotCreated(h); await admit(h); await admit(h, { chatId: 'chat' }, 'successor')
    const closed = deferred()
    h.drain.mockImplementation(async (parent, children) => {
      expect(parent).toBe(h.main); expect(children).toEqual(['child'])
      const child = h.agents.get('child')
      child.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
      h.ctx.emit('session/event' as never, child.session, child.session.snapshotEvents().at(-1))
      await closed.promise
      h.agents.delete('child')
    })
    let prepared = false
    const operation = stopRequest(h).then(result => { prepared = true; return result })
    try {
    await vi.waitFor(() => expect(h.repository.listDeliveries().find(row => row.messageId === 'original-message')?.startupDisposition).toBe('turn-interrupted'))
    expect(prepared).toBe(false); expect(h.queue).not.toHaveBeenCalled()
    expect(await admit(h, { chatId: 'chat' }, 'during-stop')).toMatchObject({ kind: 'refused', reason: 'shutdown-frozen' })
    const management = await ownerRoute(h, '/dsh-pet/api/locus-default-qa', { parentSessionId: 'ordinary' })
    expect(management.body).toMatchObject({ ok: false, error: 'LOCUS_BUSY' })
    expect((await ownerRoute(h, '/dsh-pet/api/locus', {})).status).toBe(200)
    closed.resolve()
    expect(await operation).toMatchObject({ status: 200, body: { ok: true, data: { phase: 'prepared', hostPid: process.pid } } })
    expect(h.queue).not.toHaveBeenCalled()
    expect(await stopRequest(h, 'resume')).toMatchObject({ body: { ok: true, data: { phase: 'active' } } })
    expect(h.queue).toHaveBeenCalledTimes(1)
    expect(h.agents.has('ordinary')).toBe(true)
    } finally { closed.resolve(); await operation.catch(() => undefined) }
  })

  it('authenticates and rejects foreign wire fields before freezing or draining', async () => {
    const h = await host()
    h.authentication.requestRejection.mockReturnValueOnce(401)
    expect((await stopRequest(h)).status).toBe(401)
    expect(await h.controller.runWhileActive!(async () => true)).toBe(true)
    expect((await stopRequest(h, 'prepare', { childSessionId: 'ordinary' })).status).toBe(400)
    expect((await stopRequest(h, 'prepare', { expectedHostPid: process.pid + 1 })).status).toBe(400)
    expect(h.drain).not.toHaveBeenCalled()
    expect(await h.controller.runWhileActive!(async () => true)).toBe(true)
  })

  it('keeps admission frozen after native durability failure until explicit resume', async () => {
    const h = await host()
    await seedNotCreated(h); await admit(h)
    h.drain.mockRejectedValueOnce(new Error('native durable close failed'))
    expect((await stopRequest(h)).body).toMatchObject({ ok: false })
    expect((await stopRequest(h, 'status')).body).toMatchObject({ data: { phase: 'failed' } })
    await expect(h.controller.runWhileActive!(async () => true)).rejects.toThrow('frozen')
    expect((await stopRequest(h, 'resume')).body).toMatchObject({ ok: true, data: { phase: 'active' } })
    expect(h.repository.listDeliveries()[0]?.status).toBe('current')
  })
  it.each([
    ['topic row without its group row', async (domain: any) => {
      await domain.table('loci').put('chat\u0000omt', { endpoint: { chatId: 'chat', threadId: 'omt' }, locusId: 'orphan-topic', sessionId: 's1', state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 })
    }, 'chat\u0000omt'],
    ['duplicate sessionId', async (domain: any) => {
      const g = (c: string, sid: string, extra: Record<string, unknown> = {}) => ({ endpoint: { chatId: c }, locusId: `l-${c}`, sessionId: sid, state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M', workspaceId: 'w', ...extra })
      await domain.table('locus_mains').put('M', { workSessionId: 'W', locusMainSessionId: 'M', workspaceId: 'p', generation: 1, status: 'active', spaceId: 's', createdAt: 1, updatedAt: 1 })
      await domain.table('loci').put('c1', g('c1', 'same'))
      await domain.table('loci').put('c2', g('c2', 'same'))
    }, 'same'],
    ['more than one defaultQa per M', async (domain: any) => {
      const g = (c: string, sid: string, extra: Record<string, unknown> = {}) => ({ endpoint: { chatId: c }, locusId: `l-${c}`, sessionId: sid, state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M', workspaceId: 'w', ...extra })
      await domain.table('locus_mains').put('M', { workSessionId: 'W', locusMainSessionId: 'M', workspaceId: 'p', generation: 1, status: 'active', spaceId: 's', createdAt: 1, updatedAt: 1 })
      await domain.table('loci').put('c1', g('c1', 's1', { defaultQa: true }))
      await domain.table('loci').put('c2', g('c2', 's2', { defaultQa: true }))
    }, 'MULTIPLE_DEFAULT_QA'],
  ])('Pet is NOT ready when the stored loci set violates a v20 invariant: %s', async (_name, seed, key) => {
    const h: any = await host({ seedBeforeStart: seed })
    const line = h.degraded.find((entry: string) => entry.includes('degraded'))
    expect(line).toContain(key.replace('\u0000', '\u0000'))
    // No Pet routes except the safe-stop route a degraded start still serves.
    await vi.waitFor(() => expect(h.routes.map((route: any) => route.path)).toEqual([PET_PREPARE_STOP_ROUTE]))
  })

  it('a degraded start (before any live work) still publishes the stop descriptor and serves prepare-stop with no-op freeze/drain', async () => {
    const orphanTopic = async (domain: any) => {
      await domain.table('loci').put('chat\u0000omt', { endpoint: { chatId: 'chat', threadId: 'omt' }, locusId: 'orphan-topic', sessionId: 's1', state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 })
    }
    const h: any = await host({ seedBeforeStart: orphanTopic })
    const descriptor = JSON.parse(await readFile(path.join(h.home, 'run', 'dsh-pet-stop', `${h.ctx.webServer.port}.json`), 'utf8'))
    expect(descriptor).toMatchObject({ v: 1, pid: process.pid })
    expect(await stopRequest(h, 'prepare')).toMatchObject({ body: { ok: true, data: { phase: 'prepared', bootId: descriptor.bootId, hostPid: process.pid } } })
    expect(await stopRequest(h, 'status')).toMatchObject({ body: { data: { phase: 'prepared' } } })
    expect(await stopRequest(h, 'resume')).toMatchObject({ body: { ok: true, data: { phase: 'active' } } })
    // Only the stop route: a degraded Pet still has no other routes.
    await vi.waitFor(() => expect(h.routes.map((route: any) => route.path)).toEqual([PET_PREPARE_STOP_ROUTE]))
  })

  it('degradation AFTER live work could exist publishes no no-op stopper (the legacy path stays honest)', async () => {
    const h: any = await host({ degradeLate: true })
    expect(h.degraded.some((line: string) => line.includes('injected late initialization failure'))).toBe(true)
    // Publication (if any) happens right after initialization settles; give it time.
    await new Promise(resolve => setTimeout(resolve, 300))
    await expect(readFile(path.join(h.home, 'run', 'dsh-pet-stop', `${h.ctx.webServer.port}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

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

  it('Pet 工作区子会话仍按持久绑定读取项目，拒绝 Pet 状态且冷恢复保持', async () => {
    const h = await host()
    const petCwd = path.join(h.home, 'plugins', 'dsh-pet', 'workspace')
    h.main.session.header.cwd = petCwd
    const projectFile = path.join(h.project, 'readme.txt')
    const privateFile = path.join(petCwd, 'private.txt')
    await writeFile(projectFile, 'project')
    await writeFile(privateFile, 'private')
    await seedNotCreated(h)
    const results: boolean[] = []
    const check = async (child: any) => {
      expect(child.session.header.cwd).toBe(petCwd)
      for (const file of [projectFile, privateFile]) {
        const result = await runTool(h.ctx, { agent: child, name: 'read', callId: `read-${results.length}` as never, arguments: { file_path: file }, signal: new AbortController().signal })
        results.push(result.isError)
      }
    }
    h.firstTool(check)
    await admit(h)
    expect(h.repository.getLocus('entry')).toMatchObject({ state: 'active', sessionId: 'child' })
    expect(h.repository.getRow({ chatId: 'chat' })).toMatchObject({ workspaceId: 'ws' })
    expect(h.petWorkspace.attachSession).toHaveBeenCalledWith('child')
    expect(h.workspace.attachSession).not.toHaveBeenCalled()
    expect(results).toEqual([false, true])
    expect(JSON.stringify(h.start.mock.calls[0]![0].request.prompt)).toContain(h.project)
    // A new agent scope stands for native cold reconstruction of the same id.
    const child = h.agents.get('child')
    const restored = { ...child }
    restored.ctx = createScope(h.agentFactoryContext, restored).ctx
    expect(restored.session.header.agentPreset).toBe(LOCUS_CHILD_PRESET)
    h.agents.set('child', restored)
    await h.ctx.serial(scopeTarget(restored, restored), 'agent/created', { agent: restored, source: 'resume' } as never)
    // The resumed child is served only after its surface read back as the
    // reviewed safe set: write/edit/delegation/collab globals stay hidden.
    const resumedNames = h.ctx.tools.schemas(restored).map(tool => tool.name)
    expect(attestLocusComposition(resumedNames, 'safe')).toMatchObject({ ok: true, leaks: [] })
    for (const hidden of ['write', 'edit', 'subagent', 'workflow', 'collab_status', 'bash', 'skill']) expect(resumedNames).not.toContain(hidden)
    await check(restored)
    expect(h.petWorkspace.attachSession).toHaveBeenCalledTimes(2)
    expect(h.workspace.attachSession).not.toHaveBeenCalled()
    expect(results).toEqual([false, true, false, true])
  })

  it('real index.ts wiring maps DeliveryMutation to records end to end: accept → claim → bind → finish settles the Delivery and frees the entry', async () => {
    const h = await host()
    await seedNotCreated(h)
    const result = await admit(h)
    // claim / bind returned records (not mutations): the channel queued the first prompt and bound it.
    expect(result).toMatchObject({ kind: 'accepted' })
    expect(h.start).toHaveBeenCalledTimes(1)
    expect(h.repository.findDeliveryByInboxMessageId('first-inbox')).toMatchObject({ messageId: 'original-message', status: 'current' })
    // The runtime's own claim event proves the turn belongs to the Delivery.
    const child = h.agents.get('child')
    child.session.append('turn/start', { turn: 1 })
    h.ctx.emit('agent/inbox/claimed' as never, { agent: { id: 'child' }, message: { id: 'first-inbox', source: { kind: 'user' } }, turn: 1 } as never)
    await new Promise(resolve => setTimeout(resolve, 50))
    const finished = await runTool(h.ctx, {
      agent: child, name: 'pet_locus_finish', callId: 'finish-e2e' as never,
      arguments: { outcome: 'no-reply', reason: 'e2e wiring proof' }, signal: new AbortController().signal,
    })
    expect(finished).toMatchObject({ isError: false })
    expect(h.repository.findDeliveryByMessageId('original-message')?.status).toBe('no-reply')
    expect(h.repository.hasNonTerminalDelivery('entry')).toBe(false)
  })

  it.each(['resolve', 'reject'] as const)('首工具等待持久绑定 / 首轮持久绑定失败拒绝执行: gates first caller-bound body on deferred durable UUID bind: %s', async outcome => {
    const h = await host()
    await seedNotCreated(h)
    const binding = deferred()
    const originalBind = LocusRepositoryV20.prototype.bindQueued
    const bind = vi.spyOn(LocusRepositoryV20.prototype, 'bindQueued').mockImplementation(async function(input) {
      await binding.promise
      return originalBind.call(this, input)
    })
    const bodies = vi.fn()
    let result: unknown
    h.firstTool(async child => {
      expect(h.apiReturned()).toBe(false)
      expect(h.repository.getLocus('entry')).toMatchObject({ state: 'active', sessionId: child.id })
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
      expect(h.repository.getLocus('entry')).toMatchObject({ state: 'not-created' })
      expect(h.repository.findDeliveryByMessageId('original-message')).toMatchObject({ status: 'failed' })
    }
  })
})
