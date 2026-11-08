/**
 * v20 repository half of rebind (D6) and whole-W migrate (D7). Both are one
 * transaction built on resetChat. Spec: pet-locus-collaboration
 * "换绑与归档按层处理". Controller checks (W archived, target eligibility,
 * the migrate trigger) are NOT here; they run before these calls.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
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

const pairing = (main: string, work: string, status: 'active' | 'retired') => ({
  locusMainSessionId: main, workSessionId: work, generation: 1, status, spaceId: `space-${main}`, workspaceId: `ws-${work}`, createdAt: 1, updatedAt: 1,
})

async function seeded() {
  const domain = memoryDomain()
  await domain.table('locus_mains').put('M0', pairing('M0', 'W0', 'active'))
  await domain.table('locus_mains').put('M1', pairing('M1', 'W1', 'active'))
  await domain.table('locus_mains').put('M2', pairing('M2', 'W2', 'active'))
  await domain.table('loci').put('oc_1', {
    endpoint: { chatId: 'oc_1' }, locusId: 'locus-g', sessionId: 'session-g', state: 'active', accessMode: 'read-only',
    revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M0', workspaceId: 'ws-W0', defaultQa: true,
  })
  await domain.table('loci').put('oc_1\x1ft1', {
    endpoint: { chatId: 'oc_1', threadId: 't1' }, locusId: 'locus-t1', sessionId: 'session-t1', state: 'active',
    accessMode: 'read-only', revision: 2, createdAt: 1, updatedAt: 1,
  })
  await domain.table('locus_operations').put('op-rebind', {
    id: 'op-rebind', kind: 'rebind', phase: 'provisioning', step: 0, attempts: 0, createdAt: 1, updatedAt: 1,
  })
  await domain.table('locus_operations').put('op-migrate', {
    id: 'op-migrate', kind: 'migrate', phase: 'provisioning', step: 0, attempts: 0, createdAt: 1, updatedAt: 1,
  })
  let counter = 0
  const reserve = () => `session-new-${++counter}`
  return { domain, repo: new LocusRepositoryV20(domain, { now: () => 100 }), reserve }
}

describe('rebindChat (D6 repository half)', () => {
  it('moves the group row to M1 and resets the chat, clearing defaultQa, in one commit', async () => {
    const { repo, domain, reserve } = await seeded()
    await repo.rebindChat({
      provisioningId: 'op-rebind', chatId: 'oc_1', expectedLocusId: 'locus-g', expectedRevision: 4, toM: 'M1',
      workspaceId: 'ws-W1', reboundFrom: 'W0', now: 100, reserveChildSessionId: reserve,
    })
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M1', workspaceId: 'ws-W1', reboundFrom: 'W0', state: 'not-created', revision: 5 })
    expect(repo.getRow({ chatId: 'oc_1' })).not.toHaveProperty('defaultQa')
    expect((domain.table('locus_operations').get('op-rebind') as { phase: string }).phase).toBe('committed')
  })

  it('refuses a group-row fence mismatch with LOCUS_CONFLICT and changes nothing', async () => {
    const { repo, reserve } = await seeded()
    const error = await repo.rebindChat({
      provisioningId: 'op-rebind', chatId: 'oc_1', expectedLocusId: 'locus-g', expectedRevision: 3, toM: 'M1',
      workspaceId: 'ws-W1', reboundFrom: 'W0', now: 100, reserveChildSessionId: reserve,
    }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M0', revision: 4 })
  })
})

describe('commitWholeWMigration (D7 repository half)', () => {
  it('retires the W pairing, activates M1 and resets every chat of the W in one transaction', async () => {
    const { repo, domain, reserve } = await seeded()
    await repo.commitWholeWMigration({
      provisioningId: 'op-migrate', workSessionId: 'W0', newMain: pairing('M3', 'W0', 'active'),
      retireMain: { locusMainSessionId: 'M0', reason: 'unavailable' },
      chats: [{ chatId: 'oc_1', expectedRevisions: { oc_1: 4, 'oc_1\x1ft1': 2 } }],
      now: 100, reserveChildSessionId: reserve,
    })
    expect((domain.table('locus_mains').get('M0') as { status: string }).status).toBe('retired')
    expect((domain.table('locus_mains').get('M3') as { status: string }).status).toBe('active')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M3', state: 'not-created', revision: 5 })
  })

  it('rolls everything back, leaving the old pairing active, when a chat row CAS fails', async () => {
    const { repo, domain, reserve } = await seeded()
    const error = await repo.commitWholeWMigration({
      provisioningId: 'op-migrate', workSessionId: 'W0', newMain: pairing('M3', 'W0', 'active'),
      retireMain: { locusMainSessionId: 'M0', reason: 'unavailable' },
      chats: [{ chatId: 'oc_1', expectedRevisions: { oc_1: 99 } }],
      now: 100, reserveChildSessionId: reserve,
    }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect((domain.table('locus_mains').get('M0') as { status: string }).status).toBe('active')
    expect(domain.table('locus_mains').get('M3')).toBeUndefined()
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M0', revision: 4 })
  })
})
