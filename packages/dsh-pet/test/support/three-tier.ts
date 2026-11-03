/**
 * A three-tier locus world for tests: the real durable repository behind the
 * real controller adapter, with fake Host ports that record what they created.
 *
 * Only the Host is faked (sessions, workspaces, the collaboration space, Lark).
 * Persistence, the controller and its invariants are the production ones, so a
 * rule that only holds against a hand-rolled repository cannot pass here.
 */

import { LocusController, type LocusParentSession, type LocusSpaceEstablishment } from '../../src/host/locus/controller.js'
import { LOCUS_MAIN_PRESET } from '../../src/host/locus/aggregate.js'
import { ControllerLocusRepositoryAdapter } from '../../src/host/locus/controller-persistence-adapter.js'
import { LocusRepository as DurableLocusRepository } from '../../src/host/locus/persistence.js'
import { openPetHarness } from '../harness.js'

/** Same atomic-write shim the other durable-repository tests use. */
export function enableAtomicTransactions(harness: Awaited<ReturnType<typeof openPetHarness>>): void {
  if (harness.domain.supportsTransaction === true && typeof harness.domain.transaction === 'function') return
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: string, key: string, value: unknown): void
      delete(table: string, key: string): void
    }) => void) => Promise<void>
    table(name: string): {
      put(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<boolean>
    }
  }
  Object.defineProperty(domain, 'supportsTransaction', { value: true, configurable: true })
  domain.transaction = async body => {
    const writes: Array<{ kind: 'put' | 'delete'; table: string; key: string; value?: unknown }> = []
    body({
      put: (table, key, value) => { writes.push({ kind: 'put', table, key, value }) },
      delete: (table, key) => { writes.push({ kind: 'delete', table, key }) },
    })
    for (const write of writes) {
      if (write.kind === 'delete') await domain.table(write.table).delete(write.key)
      else await domain.table(write.table).put(write.key, write.value)
    }
  }
}

export interface ThreeTierOptions {
  /** Work sessions the owner already has, besides the built-in `work-1`/`work-2`. */
  readonly extraSessions?: readonly (LocusParentSession & { readonly agentPreset?: string })[]
}

export async function openThreeTier(options: ThreeTierOptions = {}) {
  const harness = await openPetHarness()
  enableAtomicTransactions(harness)
  const durable = new DurableLocusRepository(harness.domain)
  const adapter = new ControllerLocusRepositoryAdapter(durable)

  const sessions = new Map<string, LocusParentSession>([
    ['work-1', { id: 'work-1', workspaceId: 'ws-1', title: '研发工作会话', state: 'active' }],
    ['work-2', { id: 'work-2', workspaceId: 'ws-1', title: '另一个工作会话', state: 'active' }],
    ['subagent-1', { id: 'subagent-1', workspaceId: 'ws-1', title: 'sub', state: 'active', parentSessionId: 'work-1' }],
    ...(options.extraSessions ?? []).map(session => [session.id, session] as const),
  ])
  const archived = new Set<string>()
  const missing = new Set<string>()
  const world = {
    createdWorks: [] as string[],
    createdMains: [] as { id: string; workSessionId: string }[],
    spaces: [] as { workSessionId: string; locusMainSessionId: string }[],
    released: [] as string[],
    children: [] as string[],
    sent: [] as string[],
    /** Next `establishSpace` result; reset to success after one use unless sticky. */
    spaceResult: undefined as LocusSpaceEstablishment | undefined,
    spaceError: undefined as Error | undefined,
  }
  let sequence = 0
  let clock = 100

  const controller = new LocusController({
    repository: adapter,
    dsh: {
      locusMainWorkspaceId: 'ws-pet',
      resolveSession: async id => {
        if (missing.has(id)) return undefined
        const session = sessions.get(id)
        if (session === undefined) return undefined
        return archived.has(id) ? { ...session, state: 'archived' as const } : session
      },
      resolveDefaultWorkspace: async () => ({ id: 'ws-1' }),
      createMainSession: async input => {
        const id = `work-auto-${String(++sequence)}`
        sessions.set(id, { id, workspaceId: input.workspaceId, title: input.label, state: 'active' })
        world.createdWorks.push(id)
        return {
          id,
          workspaceId: input.workspaceId,
          title: input.label,
          rollback: async () => { world.released.push(id); sessions.delete(id) },
        }
      },
      createLocusMainSession: async input => {
        const id = `locus-main-${String(++sequence)}`
        sessions.set(id, {
          id,
          workspaceId: 'ws-pet',
          title: input.label,
          state: 'active',
          agentPreset: LOCUS_MAIN_PRESET,
        })
        world.createdMains.push({ id, workSessionId: input.workSessionId })
        return {
          id,
          workspaceId: 'ws-pet',
          title: input.label,
          rollback: async () => { world.released.push(id); sessions.delete(id) },
        }
      },
      releaseSession: async id => { world.released.push(id) },
    },
    lark: {
      createGroup: async input => ({ chatId: `oc_qa_${String(++sequence)}`, chatName: input.name }),
      sendControlMessage: async input => { world.sent.push(input.text) },
      deleteGroup: async id => { world.released.push(`chat:${id}`) },
    },
    establishSpace: async input => {
      if (world.spaceError !== undefined) throw world.spaceError
      if (world.spaceResult !== undefined && !world.spaceResult.ok) return world.spaceResult
      world.spaces.push({ ...input })
      return { ok: true, spaceId: `space-${input.locusMainSessionId}` }
    },
    id: () => `id-${String(++sequence)}`,
    now: () => ++clock,
  })

  return {
    harness,
    durable,
    adapter,
    controller,
    world,
    sessions,
    archive: (id: string) => { archived.add(id) },
    restore: (id: string) => { archived.delete(id) },
    delete: (id: string) => { missing.add(id) },
    /** A session the Host reports under another preset (mis-composed locus main). */
    setPreset: (id: string, preset: string) => {
      const session = sessions.get(id)
      if (session !== undefined) sessions.set(id, { ...session, agentPreset: preset })
    },
    close: () => harness.close(),
  }
}

export type ThreeTier = Awaited<ReturnType<typeof openThreeTier>>
