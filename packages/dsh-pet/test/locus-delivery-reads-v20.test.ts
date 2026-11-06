/**
 * v20 Delivery reads used by index.ts (owner A): findDeliveryByInboxMessageId
 * and hasPendingDeliveries. Written red first.
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

async function seeded() {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', {
    endpoint: { chatId: 'oc_1' }, locusId: 'locus-g', sessionId: 'session-g', state: 'active', accessMode: 'read-only',
    revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
  })
  await domain.table('locus_deliveries').put('d1', {
    deliveryId: 'd1', messageId: 'm1', locusId: 'locus-g', endpoint: { chatId: 'oc_1' }, sessionId: 'session-g',
    status: 'running', inboxMessageId: 'inbox-9', sequence: 1,
  })
  return new LocusRepositoryV20(domain, { now: () => 5 })
}

describe('Delivery reads for index.ts (v20)', () => {
  it('findDeliveryByInboxMessageId returns the delivery whose inbox message id matches', async () => {
    const repo = await seeded()
    expect(repo.findDeliveryByInboxMessageId('inbox-9')).toMatchObject({ deliveryId: 'd1' })
    expect(repo.findDeliveryByInboxMessageId('inbox-none')).toBeUndefined()
  })

  it('hasPendingDeliveries is true while the entry has a non-terminal delivery', async () => {
    const repo = await seeded()
    expect(repo.hasPendingDeliveries('locus-g')).toBe(true)
  })

  it('hasPendingDeliveries is false for an entry with no non-terminal delivery', async () => {
    const domain = memoryDomain()
    await domain.table('loci').put('oc_2', {
      endpoint: { chatId: 'oc_2' }, locusId: 'locus-h', sessionId: 'session-h', state: 'active', accessMode: 'read-only',
      revision: 1, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
    })
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    expect(repo.hasPendingDeliveries('locus-h')).toBe(false)
  })
})
