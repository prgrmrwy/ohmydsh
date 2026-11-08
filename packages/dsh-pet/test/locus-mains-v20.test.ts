/**
 * v20 listMains (owner A; requested by impl-b for the collab directory's
 * `owns` check): every locus_mains pairing, active and retired. Written red first.
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

describe('listMains (v20)', () => {
  it('returns every pairing, active and retired', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', { locusMainSessionId: 'M1', workSessionId: 'W1', generation: 1, status: 'retired', spaceId: 's1', workspaceId: 'ws', createdAt: 1, updatedAt: 2, retiredAt: 2, retiredReason: 'archived' })
    await domain.table('locus_mains').put('M2', { locusMainSessionId: 'M2', workSessionId: 'W1', generation: 2, status: 'active', spaceId: 's2', workspaceId: 'ws', createdAt: 3, updatedAt: 3 })
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    expect(repo.listMains().map(main => `${main.locusMainSessionId}:${main.status}`).sort()).toEqual(['M1:retired', 'M2:active'])
  })

  it('returns an empty list when no pairing exists', () => {
    const repo = new LocusRepositoryV20(memoryDomain(), { now: () => 5 })
    expect(repo.listMains()).toEqual([])
  })
})
