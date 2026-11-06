/**
 * v20 Delivery association (owner A; design D3). A retargeted Delivery carries
 * `sessionId` (the v20 field), never the v19 `childSessionId`, so matching is
 * by (locusId, sessionId). Spec: pet-locus-collaboration "投递与结算关联独立于会话运行状态".
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

describe('Delivery association uses sessionId (D3)', () => {
  it('a backlog delivery retargeted by resetChat carries sessionId and no childSessionId', async () => {
    const domain = memoryDomain()
    await domain.table('loci').put('oc_1', {
      endpoint: { chatId: 'oc_1' }, locusId: 'locus-g', sessionId: 'session-g', state: 'active', accessMode: 'read-only',
      revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
    })
    await domain.table('locus_mains').put('M2', { locusMainSessionId: 'M2', workSessionId: 'W2', generation: 1, status: 'active', spaceId: 's', workspaceId: 'ws2', createdAt: 1, updatedAt: 1 })
    await domain.table('locus_deliveries').put('d1', {
      deliveryId: 'd1', locusId: 'locus-g', endpoint: { chatId: 'oc_1' }, sessionId: 'session-g', status: 'accepted', queueState: 'backlog',
    })
    const repo = new LocusRepositoryV20(domain, { now: () => 1 })
    await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'ws2', now: 2, reserveChildSessionId: () => 'session-new' }))
    const stored = domain.table('locus_deliveries').get('d1') as Record<string, unknown>
    expect(stored.sessionId).toBe('session-new')
    expect(stored).not.toHaveProperty('childSessionId')
  })
})
