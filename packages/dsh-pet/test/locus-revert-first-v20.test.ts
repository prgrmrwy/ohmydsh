/**
 * v20 revertFirstDelivery (owner A; design D16; requested by A3's
 * StartupRecoveryPortV20). One repository write: CAS the row, reserve a fresh
 * sessionId at revision + 1 keeping accessMode, settle the trigger Delivery
 * failed on its OLD sessionId (not retargeted), retarget uninjected backlog,
 * and mark the operation `first-child:<executionId>` compensated.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'
import { DEFAULT_DELIVERY_LEASE_MS, MAX_DELIVERY_LEASE_MS } from '../src/host/locus/delivery.js'

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
    endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'session-old', state: 'not-created',
    accessMode: 'danger-full-access', grantedBy: 'owner', revision: 3, createdAt: 1, updatedAt: 1,
    locusMainSessionId: 'M1', workspaceId: 'ws',
  })
  const base = { endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'session-old', senderOpenId: 'ou_1', sequence: 1, revision: 0, stateRevision: 0, outboundResult: 'none', acceptedAt: 1, deadlineAt: 1 + DEFAULT_DELIVERY_LEASE_MS, hardDeadlineAt: 1 + MAX_DELIVERY_LEASE_MS, feedbackTarget: { chatId: 'oc_1', messageId: 'm' } }
  await domain.table('locus_deliveries').put('d-trigger', { ...base, deliveryId: 'd-trigger', messageId: 'm-trigger', feedbackTarget: { chatId: 'oc_1', messageId: 'm-trigger' }, status: 'accepted', queueState: 'backlog' })
  await domain.table('locus_deliveries').put('d-backlog', { ...base, deliveryId: 'd-backlog', messageId: 'm-backlog', feedbackTarget: { chatId: 'oc_1', messageId: 'm-backlog' }, sequence: 2, status: 'accepted', queueState: 'backlog' })
  await domain.table('locus_operations').put('first-child:exec-1', {
    id: 'first-child:exec-1', kind: 'delivery', operation: 'first-child-publication', phase: 'publishing', step: 0, attempts: 0,
    locusId: 'locus-1', deliveryId: 'd-trigger', endpointKey: 'oc_1', expectedRevision: 3,
    resourceRefs: { parentSessionId: 'M1', childSessionId: 'session-old' }, createdAt: 1, updatedAt: 1,
  })
  let counter = 0
  const reserve = () => `session-new-${++counter}`
  return { domain, repo: new LocusRepositoryV20(domain, { now: () => 50 }), reserve }
}

describe('revertFirstDelivery (D16, startup compensation)', () => {
  it('resets the row to a fresh reservation at revision + 1 and keeps accessMode and grant', async () => {
    const { repo, reserve } = await seeded()
    await repo.revertFirstDelivery({ locusId: 'locus-1', sessionId: 'session-old', revision: 3, deliveryId: 'd-trigger', executionId: 'exec-1', now: 60, reserveChildSessionId: reserve })
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ sessionId: 'session-new-1', state: 'not-created', accessMode: 'danger-full-access', grantedBy: 'owner', revision: 4 })
  })

  it('settles the trigger Delivery failed on its OLD sessionId, and does not retarget it', async () => {
    const { repo, domain, reserve } = await seeded()
    await repo.revertFirstDelivery({ locusId: 'locus-1', sessionId: 'session-old', revision: 3, deliveryId: 'd-trigger', executionId: 'exec-1', now: 60, reserveChildSessionId: reserve })
    expect(domain.table('locus_deliveries').get('d-trigger')).toMatchObject({ status: 'failed', sessionId: 'session-old' })
  })

  it('retargets uninjected backlog to the new sessionId', async () => {
    const { repo, domain, reserve } = await seeded()
    await repo.revertFirstDelivery({ locusId: 'locus-1', sessionId: 'session-old', revision: 3, deliveryId: 'd-trigger', executionId: 'exec-1', now: 60, reserveChildSessionId: reserve })
    expect(domain.table('locus_deliveries').get('d-backlog')).toMatchObject({ sessionId: 'session-new-1' })
  })

  it('marks the first-child operation compensated', async () => {
    const { repo, domain, reserve } = await seeded()
    await repo.revertFirstDelivery({ locusId: 'locus-1', sessionId: 'session-old', revision: 3, deliveryId: 'd-trigger', executionId: 'exec-1', now: 60, reserveChildSessionId: reserve })
    expect(domain.table('locus_operations').get('first-child:exec-1')).toMatchObject({ phase: 'compensated' })
  })

  it('refuses a stale sessionId with LOCUS_CONFLICT and changes nothing', async () => {
    const { repo, domain, reserve } = await seeded()
    const error = await repo.revertFirstDelivery({ locusId: 'locus-1', sessionId: 'session-other', revision: 3, deliveryId: 'd-trigger', executionId: 'exec-1', now: 60, reserveChildSessionId: reserve }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ sessionId: 'session-old', revision: 3 })
    expect(domain.table('locus_deliveries').get('d-trigger')).toMatchObject({ status: 'accepted' })
  })
})
