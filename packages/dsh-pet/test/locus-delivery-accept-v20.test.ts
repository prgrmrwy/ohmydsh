/**
 * v20 acceptDelivery (owner A; design D3, D8). Acceptance matches the entry by
 * (locusId, sessionId) and refuses while the entry is changing access, inside
 * the same write queue as acquireAccessChange (lead decision, R2-C1).
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'
import { petLocusDeliveryV20 } from '../src/host/locus/contract-v20.js'

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

async function seeded(rowOverrides: Record<string, unknown> = {}) {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', {
    endpoint: { chatId: 'oc_1' }, locusId: 'locus-g', sessionId: 'session-g', state: 'active',
    accessMode: 'read-only', revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
    ...rowOverrides,
  })
  return { domain, repo: new LocusRepositoryV20(domain, { now: () => 5 }) }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  endpoint: { chatId: 'oc_1' }, locusId: 'locus-g', sessionId: 'session-g', messageId: 'm1',
  deliveryId: 'd1', senderOpenId: 'ou_1', text: 'hi', acceptedAt: 10, ...overrides,
})

describe('acceptDelivery (v20)', () => {
  it('creates an accepted backlog record keyed by sessionId, with no generation or childSessionId', async () => {
    const { repo, domain } = await seeded()
    const result = await repo.acceptDelivery(input() as never)
    expect(result).toMatchObject({ duplicate: false, conflict: false, record: { status: 'accepted', queueState: 'backlog', sessionId: 'session-g' } })
    const stored = domain.table('locus_deliveries').get('d1') as Record<string, unknown>
    expect(stored).not.toHaveProperty('generation')
    expect(stored).not.toHaveProperty('childSessionId')
    expect(petLocusDeliveryV20.safeParse(stored).success).toBe(true)
  })

  it('returns the original record as a duplicate when the messageId is already accepted', async () => {
    const { repo } = await seeded()
    await repo.acceptDelivery(input() as never)
    const again = await repo.acceptDelivery(input({ deliveryId: 'd2' }) as never)
    expect(again).toMatchObject({ duplicate: true, record: { deliveryId: 'd1' } })
  })

  it('refuses a sessionId that is not the entry reservation with LOCUS_CONFLICT', async () => {
    const { repo } = await seeded()
    const error = await repo.acceptDelivery(input({ sessionId: 'session-old' }) as never).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
  })

  it('refuses while the entry is changing access, with LOCUS_BUSY (same queue as acquireAccessChange)', async () => {
    const { repo } = await seeded()
    await repo.acquireAccessChange('locus-g')
    const error = await repo.acceptDelivery(input() as never).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
    repo.releaseAccessChange('locus-g')
  })

  it('refuses a stopped entry with INVALID_REQUEST', async () => {
    const { repo } = await seeded({ state: 'stopped', stoppedAt: 5 })
    const error = await repo.acceptDelivery(input() as never).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('INVALID_REQUEST')
  })
})
