/**
 * Minimal host context for the REAL dsh-collab plugin (`apply`), so Pet's
 * proxy talks to real `Integrations` handles and a real collab-kernel with a
 * temp-dir file store — never a hand-written kernel double
 * (docs/architecture/dsh-plugin-integration-pitfalls.md §7).
 *
 * Only the surfaces dsh-collab touches are provided. Sessions are either live
 * (an Agent object published under `agents.get`) or absent; nothing here can
 * resume a session, and `counts.resolveAgent` proves it was never asked to.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from 'dsh-collab'
import type { CollabService } from '../../src/host/collab/types.js'

export interface FakeAgent {
  readonly id: string
  readonly session: { readonly id: string; readonly header: Record<string, unknown> }
  followup(message: unknown): void
}

export const SUBAGENT_HEADER = (parent: string) => ({ origin: 'subagent', delegationDepth: 1, parentSession: parent })

export interface CollabWorld {
  readonly root: string
  readonly service: CollabService
  readonly live: Map<string, FakeAgent>
  readonly counts: { resolveAgent: number; followup: number }
  /** Publish a live ordinary or child session. */
  session(id: string, header?: Record<string, unknown>): FakeAgent
  /** Drop a session from the live map (unloaded / replaced). */
  unload(id: string): void
  /** Call a dsh-collab tool as an exact Agent object. */
  call(agent: unknown, name: string, args: Record<string, unknown>): Promise<any>
  stop(): Promise<void>
}

export async function openCollabWorld(): Promise<CollabWorld> {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'pet-collab-'))
  const live = new Map<string, FakeAgent>()
  const counts = { resolveAgent: 0, followup: 0 }
  const tools = new Map<string, any>()
  const services = new Map<string, unknown>()
  const effects: (() => unknown)[] = []
  const makeAgent = (id: string, header: Record<string, unknown>): FakeAgent => ({
    id,
    session: { id, header: { id, cwd: join(root, 'work', id), ...header } },
    followup: () => { counts.followup += 1 },
  })
  const ctx: any = {
    tools: { register(tool: any) { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
    provide: (name: string, value: unknown) => { services.set(name, value); const d = () => { services.delete(name) }; effects.push(d); return d },
    agents: { get: (id: string) => live.get(id), isOwnedBy: () => false },
    sessions: { get: (id: string) => live.get(id)?.session },
    sessionQuery: {
      listSessions: async () => [...live.values()].map(agent => ({ header: agent.session.header, live: true, persisted: true })),
      observeSession: () => { throw new Error('content observation forbidden') },
    },
    sessionController: {
      resolveAgent: async () => { counts.resolveAgent += 1; return { error: { code: 'not_found' } } },
      inspect: () => { throw new Error('inspect forbidden') },
    },
    workspaceRegistry: { archivedSessionIds: [], list: () => [] },
    on: () => () => {},
    effect: (fn: () => unknown) => { effects.push(fn() as () => unknown) },
    fiber: {},
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  }
  await apply(ctx, { dataDir: join(root, 'data'), managedChannels: ['pet-locus'] } as never)
  const service = services.get('dshCollab') as CollabService | undefined
  if (service === undefined) throw new Error('dshCollab was not provided')
  return {
    root, service, live, counts,
    session(id, header = {}) { const agent = makeAgent(id, header); live.set(id, agent); return agent },
    unload(id) { live.delete(id) },
    async call(agent, name, args) {
      const tool = tools.get(name)
      if (!tool) throw new Error(`tool ${name} not registered`)
      return tool.execute(args, { agent, callId: 'test', signal: AbortSignal.timeout(5000) })
    },
    async stop() {
      for (const fn of effects.splice(0).reverse()) await (fn as () => Promise<void>)()
      const checked = await realpath(root)
      if (!checked.startsWith(join(parent, 'pet-collab-'))) throw new Error(`refusing to remove ${checked}`)
      await rm(checked, { recursive: true })
    },
  }
}

/** Let asynchronous kernel dispatch and completion persistence drain. */
export async function settle(turns = 40): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise(resolve => setImmediate(resolve))
}

/** Parse a tool result (dsh-collab tools return JSON text or objects). */
export function result(value: any): any {
  if (typeof value === 'string') { try { return JSON.parse(value) } catch { return value } }
  if (value && typeof value === 'object' && 'output' in value) return result(value.output)
  if (value && typeof value === 'object' && Array.isArray(value.content)) {
    const text = value.content.map((part: any) => part?.text ?? '').join('')
    try { return JSON.parse(text) } catch { return text }
  }
  return value
}
