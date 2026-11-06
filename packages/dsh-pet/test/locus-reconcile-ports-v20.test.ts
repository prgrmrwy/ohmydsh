/**
 * v20 startup-reconcile ports (owner A; spec "持久层 v20 只承载同构的 locus 入口行"
 * row "群行的 M 无配对使启动对账失败", and the recovery reads and CAS writes used by
 * owner A3's reconcile.ts). Written red first.
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

const group = (chatId: string, main: string) => ({
  endpoint: { chatId }, locusId: `locus-${chatId}`, sessionId: `session-${chatId}`, state: 'active',
  accessMode: 'read-only', revision: 1, createdAt: 1, updatedAt: 1, locusMainSessionId: main, workspaceId: 'ws',
})

async function seeded() {
  const domain = memoryDomain()
  await domain.table('locus_mains').put('M1', { locusMainSessionId: 'M1', workSessionId: 'W1', generation: 1, status: 'active', spaceId: 's', workspaceId: 'ws', createdAt: 1, updatedAt: 1 })
  await domain.table('loci').put('oc_ok', group('oc_ok', 'M1'))
  await domain.table('loci').put('oc_bad', group('oc_bad', 'M-gone'))
  await domain.table('locus_operations').put('op-live', { id: 'op-live', kind: 'rebind', phase: 'provisioning', step: 0, attempts: 0, createdAt: 1, updatedAt: 1 })
  await domain.table('locus_operations').put('op-done', { id: 'op-done', kind: 'ensure', phase: 'committed', step: 0, attempts: 0, createdAt: 1, updatedAt: 1 })
  await domain.table('locus_operations').put('op-failed', { id: 'op-failed', kind: 'rebind', phase: 'failed', step: 0, attempts: 0, createdAt: 1, updatedAt: 1 })
  await domain.table('locus_deliveries').put('d-run', { deliveryId: 'd-run', locusId: 'locus-oc_ok', endpoint: { chatId: 'oc_ok' }, sessionId: 'session-oc_ok', status: 'running', revision: 2 })
  await domain.table('locus_deliveries').put('d-done', { deliveryId: 'd-done', locusId: 'locus-oc_ok', endpoint: { chatId: 'oc_ok' }, sessionId: 'session-oc_ok', status: 'settled', revision: 1 })
  return { domain, repo: new LocusRepositoryV20(domain, { now: () => 5 }) }
}

describe('assertEveryGroupMainPaired (startup reconcile)', () => {
  it('throws INVALID_REQUEST naming every group key whose M has no pairing', async () => {
    const { repo } = await seeded()
    const error = (() => { try { repo.assertEveryGroupMainPaired(); return undefined } catch (e) { return e } })()
    expect(error).toBeInstanceOf(LocusRefusalError)
    expect((error as LocusRefusalError).code).toBe('INVALID_REQUEST')
    expect((error as Error).message).toContain('oc_bad')
    expect((error as Error).message).not.toContain('oc_ok')
  })

  it('passes when every group M is paired', async () => {
    const { repo, domain } = await seeded()
    await domain.table('loci').put('oc_bad', group('oc_bad', 'M1'))
    expect(() => repo.assertEveryGroupMainPaired()).not.toThrow()
  })
})

describe('recovery reads', () => {
  it('listRecoverableOperations includes failed operations so they are retried at startup', async () => {
    const { repo } = await seeded()
    expect(repo.listRecoverableOperations().map(op => op.id).sort()).toEqual(['op-failed', 'op-live'])
  })

  it('getOperation and getDelivery read one record by id', async () => {
    const { repo } = await seeded()
    expect(repo.getOperation('op-done')).toMatchObject({ phase: 'committed' })
    expect(repo.getDelivery('d-run')).toMatchObject({ status: 'running' })
  })

  it('listPendingDeliveries returns only non-terminal deliveries', async () => {
    const { repo } = await seeded()
    expect(repo.listPendingDeliveries().map(d => d.deliveryId)).toEqual(['d-run'])
  })
})

describe('recovery CAS writes', () => {
  it('putDeliveryCas writes when the revision matches, and bumps it', async () => {
    const { repo } = await seeded()
    const prev = repo.getDelivery('d-run')!
    await repo.putDeliveryCas(prev, { ...prev, status: 'unknown-terminal' })
    expect(repo.getDelivery('d-run')).toMatchObject({ status: 'unknown-terminal', revision: 3 })
  })

  it('putDeliveryCas refuses a stale prev with LOCUS_CONFLICT and changes nothing', async () => {
    const { repo } = await seeded()
    const prev = { ...repo.getDelivery('d-run')!, revision: 1 }
    const error = await repo.putDeliveryCas(prev, { ...prev, status: 'expired' }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect(repo.getDelivery('d-run')).toMatchObject({ status: 'running', revision: 2 })
  })

  it('putOperation upserts the operation record', async () => {
    const { repo } = await seeded()
    const op = repo.getOperation('op-live')!
    await repo.putOperation({ ...op, phase: 'needs-recovery' })
    expect(repo.getOperation('op-live')).toMatchObject({ phase: 'needs-recovery' })
  })
})

describe('beginProvisioning records only the endpoint, not compensable resources (D4)', () => {
  it('a rebind on an existing chat does not claim the chat or its main session', async () => {
    const { repo, domain } = await seeded()
    await repo.beginProvisioning({ provisioningId: 'op-new', kind: 'rebind', chatId: 'oc_ok', workSessionId: 'W2', startedAt: 9 })
    const op = domain.table('locus_operations').get('op-new') as Record<string, unknown>
    expect(op.endpointKey).toBe('oc_ok')
    expect((op.resourceRefs as Record<string, unknown>)).not.toHaveProperty('chatId')
    expect((op.resourceRefs as Record<string, unknown>)).not.toHaveProperty('parentSessionId')
  })
})
