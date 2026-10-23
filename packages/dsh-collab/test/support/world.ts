import { mkdtemp, realpath, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { expect } from 'vitest'
import { apply } from '../../src/index.js'

export type Header = { id: string; cwd?: string; origin?: string; delegationDepth?: number; parentSession?: string }
export interface WorldOptions { admission?: string; allowedSessionIds?: string[]; denySessionIds?: string[]; extra?: Record<string, unknown> }

/** Temporary directory whose removal re-verifies its real parent and prefix. */
export async function tempRoot<T>(prefix: string, run: (root: string) => Promise<T>): Promise<T> {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, prefix))
  try { return await run(root) } finally {
    const checked = await realpath(root)
    expect(dirname(checked)).toBe(parent); expect(basename(checked).startsWith(prefix)).toBe(true)
    await rm(checked, { recursive: true })
  }
}

/**
 * Fake host context for the real plugin `apply()`. Every host surface the
 * plugin may touch is counted; content/activation surfaces can be made to
 * throw on use so tests prove they are never called.
 */
export function hostContext(root: string) {
  const live = new Map<string, any>()
  const headers = new Map<string, Header>()
  const archived: string[] = []
  const counts = { listSessions: 0, observeSession: 0, inspect: 0, resolveAgent: 0, followup: 0 }
  const followups: { id: string; message: any }[] = []
  const logs: string[] = []
  let failList = false
  let resolver: (id: string) => Promise<any> = async id => {
    const header = headers.get(id)
    if (!header) return { error: { code: 'not_found' } }
    const agent = live.get(id) ?? makeAgent(id, header)
    live.set(id, agent)
    return { agent }
  }
  const makeAgent = (id: string, header: Header = { id, cwd: join(root, 'work', id) }): any => ({
    id, session: { id, header },
    followup: (message: any) => { counts.followup++; followups.push({ id, message }) },
  })
  const tools = new Map<string, any>()
  const services = new Map<string, any>()
  const effects: (() => unknown)[] = []
  const ctx: any = {
    tools: { register(tool: any) { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
    // Like cordis, a provided service is a fiber effect: unloading the plugin unregisters it.
    provide: (name: string, value: unknown) => {
      if (services.has(name)) throw new Error(`service ${name} already provided`)
      services.set(name, value)
      const dispose = () => { if (services.get(name) === value) services.delete(name) }
      effects.push(dispose)
      return dispose
    },
    agents: { get: (id: string) => live.get(id), isOwnedBy: () => false },
    sessions: { get: (id: string) => live.get(id)?.session },
    sessionQuery: {
      listSessions: async () => { counts.listSessions++; if (failList) throw new Error('metadata backend unavailable'); return [...headers.values()].map(header => ({ header, live: live.has(header.id), persisted: true })) },
      observeSession: () => { counts.observeSession++; throw new Error('content observation forbidden') },
    },
    sessionController: {
      resolveAgent: (id: string) => { counts.resolveAgent++; return resolver(id) },
      inspect: () => { counts.inspect++; throw new Error('inspect forbidden') },
    },
    workspaceRegistry: { archivedSessionIds: archived, list: () => [] },
    on: () => () => {},
    effect: (fn: () => unknown) => { effects.push(fn() as () => unknown) },
    fiber: {},
    logger: () => ({ info: (...a: unknown[]) => logs.push(a.map(String).join(' ')), warn: (...a: unknown[]) => logs.push(a.map(String).join(' ')), error: (...a: unknown[]) => logs.push(a.map(String).join(' ')), debug: () => {} }),
  }
  /** Register an ordinary session; `live` publishes an Agent, otherwise header only (cold). */
  const session = (id: string, options: { live?: boolean; header?: Partial<Header> } = {}) => {
    const header: Header = { id, cwd: join(root, 'work', id), ...options.header }
    headers.set(id, header)
    if (options.live) live.set(id, makeAgent(id, header))
    return id
  }
  return {
    ctx, live, headers, archived, counts, followups, logs, tools, services, root,
    session, makeAgent,
    failMetadata: (value = true) => { failList = value },
    setResolver: (next: typeof resolver) => { resolver = next },
    defaultResolver: () => resolver,
    stop: async () => { for (const fn of effects.splice(0)) await (fn as () => Promise<void>)() },
  }
}

export type Host = ReturnType<typeof hostContext>

/** Start the real plugin on a host context. Returns the started promise result. */
export async function start(host: Host, options: WorldOptions = {}, dataDir = join(host.root, 'data')) {
  const config: any = { dataDir, ...(options.admission !== undefined ? { admission: options.admission } : {}), ...(options.allowedSessionIds ? { allowedSessionIds: options.allowedSessionIds } : {}), ...(options.denySessionIds ? { denySessionIds: options.denySessionIds } : {}), ...options.extra }
  await apply(host.ctx, config)
  return dataDir
}

/** Execute a registered tool as an exact live Agent (or with no agent). */
export async function call(host: Host, caller: string | undefined, name: string, args: Record<string, unknown>) {
  const tool = host.tools.get(name)
  if (!tool) throw new Error(`tool ${name} not registered`)
  const agent = caller === undefined ? undefined : host.live.get(caller)
  return callAs(host, agent, name, args)
}
/** Execute a registered tool as a specific Agent object (which may no longer be the Host's current one). */
export async function callAs(host: Host, agent: unknown, name: string, args: Record<string, unknown>) {
  const tool = host.tools.get(name)
  if (!tool) throw new Error(`tool ${name} not registered`)
  return tool.execute(args, { agent, callId: 'test', signal: AbortSignal.timeout(5000) })
}

let cmd = 0
/** Logical collaboration operations mapped onto the current tool surface. */
export function ops(host: Host) {
  const c = () => `cmd-${++cmd}`
  return {
    create: (caller: string, spaceId: string, name: string, cmdId = c()) => call(host, caller, 'collab_space', { action: 'create', spaceId, cmdId, name }),
    close: (caller: string, spaceId: string, cmdId = c()) => call(host, caller, 'collab_space', { action: 'close', spaceId, cmdId }),
    invite: (caller: string, spaceId: string, name: string, recipientSessionId: string, cmdId = c()) => call(host, caller, 'collab_invite', { spaceId, cmdId, name, recipientSessionId }),
    member: (caller: string, spaceId: string, action: string, extra: Record<string, unknown> = {}, cmdId = c()) => call(host, caller, 'collab_member', { action, spaceId, cmdId, ...extra }),
    join: (caller: string, spaceId: string, cmdId = c()) => call(host, caller, 'collab_member', { action: 'join', spaceId, cmdId }),
    overview: (caller: string, spaceId: string) => call(host, caller, 'collab_read', { view: 'overview', spaceId }),
    since: (caller: string, spaceId: string, sinceSeq: number) => call(host, caller, 'collab_read', { view: 'since', spaceId, sinceSeq }),
    send: (caller: string, spaceId: string, to: string, body: string, needsReply = false, cmdId = c(), extra: Record<string, unknown> = {}) => call(host, caller, 'collab_send_message', { spaceId, cmdId, to, body, needsReply, ...extra }),
    status: (caller: string, spaceId?: string) => call(host, caller, 'collab_status', spaceId === undefined ? {} : { spaceId }),
    setStatus: (caller: string, spaceId: string, text: string, cmdId = c()) => call(host, caller, 'collab_set_status', { spaceId, cmdId, text }),
    createItem: (caller: string, spaceId: string, input: Record<string, unknown>, cmdId = c()) => call(host, caller, 'collab_create_item', { spaceId, cmdId, title: 'T', body: '', requiredAcks: [], kind: 'other', ...input }),
    revise: (caller: string, spaceId: string, itemId: string, expectedRevision: number, changes: Record<string, unknown>, cmdId = c()) => call(host, caller, 'collab_revise_item', { spaceId, cmdId, itemId, expectedRevision, changes }),
    ack: (caller: string, spaceId: string, itemId: string, revision: number, cmdId = c()) => call(host, caller, 'collab_ack_item', { spaceId, cmdId, itemId, revision }),
  }
}

/** Let asynchronous kernel dispatch and completion persistence drain. */
export async function settle(turns = 30) { for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve)) }

export async function bytes(path: string) { try { return await readFile(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error } }
export async function exists(path: string) { return stat(path).then(() => true, () => false) }

/** Direct assembly (real CollabHost + real tools) when a test must reach the store. */
export async function direct(host: Host, options: WorldOptions & { probe?: (pid: number) => unknown } = {}, dataDir = join(host.root, 'data')) {
  const { probe, ...rest } = options; options = rest
  const { CollabHost } = await import('../../src/host.js')
  const { SessionAccess, SessionProvider } = await import('../../src/session-provider.js')
  const { collabTools } = await import('../../src/tools.js')
  const { admissionPolicy } = await import('../../src/config.js')
  const policy = admissionPolicy({ dataDir, ...options } as any)
  const access = new SessionAccess(host.ctx, policy)
  const provider = new SessionProvider(access)
  const collab = await CollabHost.create({ dataDir, ...options } as any, [], [provider], undefined, { logger: host.ctx.logger('dsh-collab'), ...(probe ? { probe } : {}) })
  const remove = collabTools(host.ctx, access, () => collab)
  return { collab, provider, access, close: async () => { remove(); provider.close(); await collab.close() } }
}
