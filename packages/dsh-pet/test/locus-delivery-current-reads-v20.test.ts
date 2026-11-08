/**
 * v20 current-Delivery reads and the `fail` alias (owner A; contract's
 * settlement-integration port). findCurrentSerializedDelivery returns the one
 * current/finishing row of an entry; findCurrentDelivery needs an exact turn
 * proof; fail is the same pre-turn refusal as failBeforeDispatch. Written red first.
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

const endpoint = { chatId: 'oc_1' }

async function seeded() {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', {
    endpoint, locusId: 'locus-g', sessionId: 'session-g', state: 'active', accessMode: 'read-only',
    revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
  })
  const repo = new LocusRepositoryV20(domain, { now: () => 5 })
  await repo.acceptDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', messageId: 'm1', deliveryId: 'd1', senderOpenId: 'ou_1', text: 'a', acceptedAt: 1 } as never)
  return { domain, repo }
}

describe('current-Delivery reads and fail (v20)', () => {
  it('findCurrentSerializedDelivery is undefined before a claim, and returns the current row after one', async () => {
    const { repo } = await seeded()
    expect(repo.findCurrentSerializedDelivery({ locusId: 'locus-g', sessionId: 'session-g' })).toBeUndefined()
    await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', now: 3 } as never)
    expect(repo.findCurrentSerializedDelivery({ locusId: 'locus-g', sessionId: 'session-g' })).toMatchObject({ deliveryId: 'd1', status: 'current' })
  })

  it('findCurrentSerializedDelivery does not return a row for a replaced sessionId', async () => {
    const { repo } = await seeded()
    await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', now: 3 } as never)
    expect(repo.findCurrentSerializedDelivery({ locusId: 'locus-g', sessionId: 'session-old' })).toBeUndefined()
  })

  it('findCurrentDelivery requires an executionId and a turnId; without them it is undefined', async () => {
    const { repo } = await seeded()
    await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-g', sessionId: 'session-g', now: 3 } as never)
    expect(repo.findCurrentDelivery({ locusId: 'locus-g', sessionId: 'session-g' })).toBeUndefined()
  })

  it('findCurrentDelivery matches the one pending row with the exact executionId and turnId', async () => {
    const { repo, domain } = await seeded()
    await domain.table('locus_deliveries').put('d-run', {
      deliveryId: 'd-run', messageId: 'm-run', locusId: 'locus-g', endpoint, sessionId: 'session-g',
      status: 'running', executionId: 'exec-1', turnId: 'turn-1', inboxMessageId: 'inbox-1', sequence: 9,
    })
    expect(repo.findCurrentDelivery({ locusId: 'locus-g', sessionId: 'session-g', executionId: 'exec-1', turnId: 'turn-1' })).toMatchObject({ deliveryId: 'd-run' })
    expect(repo.findCurrentDelivery({ locusId: 'locus-g', sessionId: 'session-g', executionId: 'exec-2', turnId: 'turn-1' })).toBeUndefined()
  })

  it('fail settles a pre-turn accepted Delivery the same way as failBeforeDispatch', async () => {
    const { repo, domain } = await seeded()
    const ok = await repo.fail({ deliveryId: 'd1', correlation: { endpoint, locusId: 'locus-g', sessionId: 'session-g' }, reason: 'refused' })
    expect(ok).toBe(true)
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ status: 'failed', dispatchFailure: 'not-queued' })
  })
})
