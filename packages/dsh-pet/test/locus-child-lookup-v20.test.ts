/**
 * v20 `agent/created` lookup (owner A; design D15, spec "已退役的 locus 子会话不能再运行").
 * Order: 0 blocked → 1 active → 2 staged claim → 3 retired → 4 ordinary.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'

function memoryDomain(): LocusDomain {
  const tables = new Map<string, Map<string, unknown>>()
  const table = (name: string) => {
    let map = tables.get(name)
    if (map === undefined) {
      map = new Map()
      tables.set(name, map)
    }
    return {
      get: (key: string) => map!.get(key),
      entries: () => map!.entries(),
      keys: () => map!.keys(),
      get size() { return map!.size },
      put: async (key: string, value: unknown) => { map!.set(key, value) },
      delete: async (key: string) => map!.delete(key),
    }
  }
  return {
    table,
    supportsTransaction: true,
    transaction: async (body: (tx: { put(t: string, k: string, v: unknown): void; delete(t: string, k: string): void }) => void) => {
      body({ put: (t, k, v) => { table(t).put(k, v) }, delete: (t, k) => { table(t).delete(k) } })
    },
  } as unknown as LocusDomain
}

async function seeded(rowOverrides: Record<string, unknown> = {}, deliveries: Record<string, unknown>[] = [], operations: Record<string, unknown>[] = []) {
  const domain = memoryDomain()
  await domain.table('locus_mains').put('M1', { locusMainSessionId: 'M1', workSessionId: 'W1', generation: 1, status: 'active', spaceId: 's', workspaceId: 'ws', createdAt: 1, updatedAt: 1 })
  await domain.table('loci').put('oc_1', {
    endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'session-1', state: 'active', accessMode: 'read-only',
    revision: 3, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws', ...rowOverrides,
  })
  for (const d of deliveries) await domain.table('locus_deliveries').put(d.deliveryId as string, d)
  for (const o of operations) await domain.table('locus_operations').put(o.id as string, o)
  return new LocusRepositoryV20(domain, { now: () => 50 })
}

describe('lookupChildForAgentCreated (D15)', () => {
  it('branch 1: an active row with the matching sessionId composes', async () => {
    const repo = await seeded()
    expect(repo.lookupChildForAgentCreated({ sessionId: 'session-1', agentPreset: 'locus-child' })).toMatchObject({ kind: 'active', row: { row: { locusId: 'locus-1' }, locusMainSessionId: 'M1' } })
  })

  it('branch 0: an entry in the access-changing set blocks publication', async () => {
    const repo = await seeded()
    await repo.acquireAccessChange('locus-1')
    expect(repo.lookupChildForAgentCreated({ sessionId: 'session-1', agentPreset: 'locus-child' })).toEqual({ kind: 'blocked', reason: 'access-changing', locusId: 'locus-1' })
    repo.releaseAccessChange('locus-1')
  })

  it('branch 0: blocking first-creation recovery debt blocks publication', async () => {
    const repo = await seeded({}, [], [{ id: 'op-x', kind: 'delivery', phase: 'needs-recovery', locusId: 'locus-1', step: 0, attempts: 0, createdAt: 1, updatedAt: 1 }])
    expect(repo.lookupChildForAgentCreated({ sessionId: 'session-1', agentPreset: 'locus-child' })).toEqual({ kind: 'blocked', reason: 'recovery-debt', locusId: 'locus-1' })
  })

  it('branch 2: a not-created row exactly matching the staged (sessionId, M, revision) is staged', async () => {
    const repo = await seeded({ state: 'not-created', sessionId: 'session-r', revision: 5 })
    expect(repo.lookupChildForAgentCreated({
      sessionId: 'session-r', agentPreset: 'locus-child', staged: { sessionId: 'session-r', locusMainSessionId: 'M1', revision: 5 },
    })).toMatchObject({ kind: 'staged', row: { row: { state: 'not-created' } } })
  })

  it('branch 2 does not match when the staged revision is stale', async () => {
    const repo = await seeded({ state: 'not-created', sessionId: 'session-r', revision: 5 })
    expect(repo.lookupChildForAgentCreated({
      sessionId: 'session-r', agentPreset: 'locus-child', staged: { sessionId: 'session-r', locusMainSessionId: 'M1', revision: 4 },
    })).toEqual({ kind: 'retired' })
  })

  it('branch 3: a locus-child preset with no matching row is retired (refused)', async () => {
    const repo = await seeded()
    expect(repo.lookupChildForAgentCreated({ sessionId: 'session-old', agentPreset: 'locus-child' })).toEqual({ kind: 'retired' })
  })

  it('branch 4: any other preset is an ordinary session', async () => {
    const repo = await seeded()
    expect(repo.lookupChildForAgentCreated({ sessionId: 'session-other', agentPreset: 'default' })).toEqual({ kind: 'ordinary' })
  })
})
