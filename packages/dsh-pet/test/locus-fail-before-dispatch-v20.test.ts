/**
 * v20 failBeforeDispatch (owner A; v19 callers in index.ts / channel). A
 * pre-turn refusal settles the Delivery failed with a definitive dispatchFailure.
 * Matches on the exact (endpoint, locusId, sessionId) correlation. Written red first.
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

const correlation = (sessionId: string) => ({ endpoint, locusId: 'locus-g', sessionId })

describe('failBeforeDispatch (v20)', () => {
  it('settles an accepted backlog Delivery failed with dispatchFailure not-queued', async () => {
    const { repo, domain } = await seeded()
    const ok = await repo.failBeforeDispatch({ deliveryId: 'd1', correlation: correlation('session-g'), reason: 'refused' })
    expect(ok).toBe(true)
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ status: 'failed', dispatchFailure: 'not-queued', failureReason: 'refused' })
  })

  it('a mismatched correlation (replaced sessionId) changes nothing and returns false', async () => {
    const { repo, domain } = await seeded()
    const ok = await repo.failBeforeDispatch({ deliveryId: 'd1', correlation: correlation('session-old'), reason: 'refused' })
    expect(ok).toBe(false)
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ status: 'accepted' })
  })

  it('is idempotent: a second call on an already-failed Delivery returns true without a second write', async () => {
    const { repo } = await seeded()
    await repo.failBeforeDispatch({ deliveryId: 'd1', correlation: correlation('session-g'), reason: 'refused' })
    expect(await repo.failBeforeDispatch({ deliveryId: 'd1', correlation: correlation('session-g'), reason: 'refused' })).toBe(true)
  })
})
