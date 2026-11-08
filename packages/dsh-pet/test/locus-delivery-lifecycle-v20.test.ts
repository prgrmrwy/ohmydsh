/**
 * v20 Delivery lifecycle (owner A; design D3). claim, finish, expire and the
 * late-event rule all match by (endpoint, locusId, sessionId). A late event
 * from a replaced sessionId changes nothing. Written red first.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'
import { MAX_DELIVERY_LEASE_MS } from '../src/host/locus/delivery.js'

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

const endpoint = { chatId: 'oc_1' }

async function seeded() {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', {
    endpoint, locusId: 'locus-g', sessionId: 'session-g', state: 'active', accessMode: 'read-only',
    revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
  })
  const repo = new LocusRepositoryV20(domain, { now: () => 5 })
  await repo.acceptDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', messageId: 'm1', deliveryId: 'd1', senderOpenId: 'ou_1', text: 'a', acceptedAt: 1 } as never)
  await repo.acceptDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', messageId: 'm2', deliveryId: 'd2', senderOpenId: 'ou_1', text: 'b', acceptedAt: 2 } as never)
  return { domain, repo }
}

const correlation = (sessionId: string) => ({ endpoint, locusId: 'locus-g', sessionId })

describe('Delivery lifecycle on (locusId, sessionId) (v20)', () => {
  it('claim promotes the oldest backlog Delivery to current with revision + 1', async () => {
    const { repo } = await seeded()
    const result = await repo.claimCurrentDelivery({ ...correlation('session-g'), now: 3 } as never)
    expect(result).toMatchObject({ changed: true, record: { deliveryId: 'd1', status: 'current', queueState: 'current', revision: 1 } })
  })

  it('a second claim while one Delivery is current changes nothing (current-occupied)', async () => {
    const { repo } = await seeded()
    await repo.claimCurrentDelivery({ ...correlation('session-g'), now: 3 } as never)
    const second = await repo.claimCurrentDelivery({ ...correlation('session-g'), now: 4 } as never)
    expect(second).toMatchObject({ changed: false, reason: 'current-occupied' })
  })

  it('a late event from a replaced sessionId changes nothing (correlation-mismatch)', async () => {
    const { repo, domain } = await seeded()
    await repo.claimCurrentDelivery({ ...correlation('session-g'), now: 3 } as never)
    const late = await repo.markDeliveryFinishing({ ...correlation('session-old'), deliveryId: 'd1', now: 4 } as never)
    expect(late).toMatchObject({ changed: false, reason: 'correlation-mismatch' })
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ status: 'current' })
  })

  it('a finish with the matching correlation moves the current Delivery to a terminal status', async () => {
    const { repo, domain } = await seeded()
    await repo.claimCurrentDelivery({ ...correlation('session-g'), now: 3 } as never)
    await repo.markDeliveryFinishing({ ...correlation('session-g'), deliveryId: 'd1', now: 3 } as never)
    const done = await repo.completeCurrentDelivery({ ...correlation('session-g'), deliveryId: 'd1', now: 4, outcome: 'reply', outboundResult: 'success' } as never)
    expect(done.changed).toBe(true)
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ status: 'replied' })
  })

  it('expire moves a backlog Delivery to expired only at its acceptedAt + 24h hard cap', async () => {
    const { repo, domain } = await seeded()
    const expired = await repo.expireCurrentDelivery({ ...correlation('session-g'), deliveryId: 'd2', now: 2 + MAX_DELIVERY_LEASE_MS } as never)
    expect(expired.changed).toBe(true)
    expect(domain.table('locus_deliveries').get('d2')).toMatchObject({ status: 'expired' })
  })

  it('spec Scenario \"静默 backlog 只在触发时检查硬上限\"', async () => {
    const { repo, domain } = await seeded()
    const far = 2 + MAX_DELIVERY_LEASE_MS + 60_000
    // Time passes with no trigger: reads report nothing expired and no timer runs.
    expect(repo.getDelivery('d1')).toMatchObject({ status: 'accepted' })
    expect(repo.getDelivery('d2')).toMatchObject({ status: 'accepted' })
    expect(repo.listDeliveries().every(record => record.status === 'accepted')).toBe(true)
    // The next dispatch trigger checks the hard cap and expires the oldest overdue item.
    const first = await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', now: far } as never)
    expect(first).toMatchObject({ changed: true, record: { deliveryId: 'd1', status: 'expired' } })
    expect(repo.getDelivery('d2')).toMatchObject({ status: 'accepted' })
    // The following trigger expires the next one.
    await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', now: far + 1 } as never)
    expect(repo.getDelivery('d2')).toMatchObject({ status: 'expired' })
  })
})
