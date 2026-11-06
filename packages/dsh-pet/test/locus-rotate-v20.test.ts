/**
 * v20 rotateReservation (owner A; design D16). A creation-failure rotation
 * changes only the reservation: revision + 1, sessionId replaced. accessMode,
 * state and grantedBy are kept; only verifiedAt is cleared (it must be
 * re-verified against the new reservation).
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

describe('rotateReservation keeps the grant (D16)', () => {
  it('replaces sessionId, bumps revision, keeps accessMode and grantedBy, clears only verifiedAt', async () => {
    const domain = memoryDomain()
    await domain.table('loci').put('oc_1', {
      endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'session-old', state: 'not-created',
      accessMode: 'danger-full-access', grantedBy: 'owner', verifiedAt: 9, revision: 3,
      createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
    })
    const repo = new LocusRepositoryV20(domain, { now: () => 50 })
    const { row } = await repo.rotateReservation({
      locusId: 'locus-1', expectedRevision: 3, failedSessionId: 'session-old',
      reserveChildSessionId: () => 'session-new', now: 60,
    })
    expect(row).toMatchObject({ sessionId: 'session-new', revision: 4, state: 'not-created', accessMode: 'danger-full-access', grantedBy: 'owner' })
    expect(row).not.toHaveProperty('verifiedAt')
  })
})
