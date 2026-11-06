/**
 * v20 first-publication methods (owner A; design D15, D16; contract
 * LocusRepositoryPortV20): publishFirstDelivery, commitFirstDelivery,
 * failFirstDeliveryCreation, and the retryText / recoveryDebt forms of
 * revertFirstDelivery. Written red first.
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

const endpoint = { chatId: 'oc_1' }

/** A not-created entry with its trigger Delivery claimed (current, no execution yet). */
async function seeded(rowOverrides: Record<string, unknown> = {}, withDelivery = true) {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', {
    endpoint, locusId: 'locus-1', sessionId: 'session-new', state: 'not-created', accessMode: 'danger-full-access',
    grantedBy: 'owner', verifiedAt: 9, revision: 3, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
    ...rowOverrides,
  })
  const repo = new LocusRepositoryV20(domain, { now: () => 5 })
  if (withDelivery) {
    await repo.acceptDelivery({ endpoint, locusId: 'locus-1', sessionId: 'session-new', messageId: 'm1', deliveryId: 'd1', senderOpenId: 'ou_1', text: 'a', acceptedAt: 1 } as never)
    await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-1', sessionId: 'session-new', now: 2 } as never)
  }
  return { domain, repo }
}

const identity = { locusId: 'locus-1', sessionId: 'session-new', revision: 3, deliveryId: 'd1', now: 10 }

describe('publishFirstDelivery (D15)', () => {
  it('activates the not-created row at the same revision and keeps accessMode and grant', async () => {
    const { repo } = await seeded()
    await repo.publishFirstDelivery({ ...identity, executionId: 'exec-1' })
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'active', revision: 3, accessMode: 'danger-full-access', grantedBy: 'owner' })
  })

  it('writes the publishing operation fenced on the row revision, and stamps the trigger with the executionId', async () => {
    const { repo, domain } = await seeded()
    await repo.publishFirstDelivery({ ...identity, executionId: 'exec-1' })
    expect(domain.table('locus_operations').get('first-child:exec-1')).toMatchObject({
      phase: 'publishing', expectedRevision: 3, locusId: 'locus-1', deliveryId: 'd1', endpointKey: 'oc_1',
      resourceRefs: { parentSessionId: 'M1', childSessionId: 'session-new' },
    })
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ executionId: 'exec-1' })
  })

  it('refuses a stale revision with LOCUS_CONFLICT and changes nothing', async () => {
    const { repo } = await seeded()
    const error = await repo.publishFirstDelivery({ ...identity, revision: 2, executionId: 'exec-1' }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'not-created', revision: 3 })
  })

  it('refuses while the entry is changing access, with LOCUS_BUSY', async () => {
    const { repo } = await seeded({}, false)
    await repo.acquireAccessChange('locus-1')
    const error = await repo.publishFirstDelivery({ ...identity, executionId: 'exec-1' }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
    repo.releaseAccessChange('locus-1')
  })
})

describe('commitFirstDelivery (D15)', () => {
  it('closes the publishing operation as committed', async () => {
    const { repo, domain } = await seeded()
    await repo.publishFirstDelivery({ ...identity, executionId: 'exec-1' })
    await repo.commitFirstDelivery({ executionId: 'exec-1', now: 11 })
    expect(domain.table('locus_operations').get('first-child:exec-1')).toMatchObject({ phase: 'committed' })
  })
})

describe('failFirstDeliveryCreation (D16, before publication)', () => {
  it('settles the trigger failed on the old sessionId and rotates the reservation, keeping state and grant', async () => {
    const { repo, domain } = await seeded()
    let counter = 0
    await repo.failFirstDeliveryCreation({ ...identity, reserveChildSessionId: () => `session-fresh-${++counter}` })
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ status: 'failed', sessionId: 'session-new' })
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'not-created', sessionId: 'session-fresh-1', revision: 4, accessMode: 'danger-full-access', grantedBy: 'owner' })
  })
})

describe('revertFirstDelivery forms (D16)', () => {
  async function publishedThenReverted(options: Record<string, unknown>) {
    const seed = await seeded()
    await seed.repo.publishFirstDelivery({ ...identity, executionId: 'exec-1' })
    let counter = 0
    await seed.repo.revertFirstDelivery({ ...identity, executionId: 'exec-1', reserveChildSessionId: () => `session-fresh-${++counter}`, ...options } as never)
    return seed
  }

  it('retryText rotates the reservation and retargets THIS Delivery unsettled, marked imageRouteRejected', async () => {
    const { repo, domain } = await publishedThenReverted({ retryText: true })
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ sessionId: 'session-fresh-1', revision: 4 })
    expect(domain.table('locus_deliveries').get('d1')).toMatchObject({ sessionId: 'session-fresh-1', imageRouteRejected: true })
    expect((domain.table('locus_deliveries').get('d1') as { status: string }).status).not.toBe('failed')
  })

  it('retryText leaves the retargeted trigger unissued: no executionId, inboxMessageId or turnId', async () => {
    const { repo, domain } = await publishedThenReverted({ retryText: true })
    const trigger = domain.table('locus_deliveries').get('d1') as Record<string, unknown>
    expect(trigger.executionId).toBeUndefined()
    expect(trigger.inboxMessageId).toBeUndefined()
    expect(trigger.turnId).toBeUndefined()
    expect(trigger).toMatchObject({ status: 'current', queueState: 'current' })
    expect(repo.getDelivery('d1')).toMatchObject({ sessionId: 'session-fresh-1' })
  })

  it('spec Scenario "无法证明释放成功时留下恢复债务"', async () => {
    const { repo } = await publishedThenReverted({ recoveryDebt: true, reserveChildSessionId: undefined })
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ sessionId: 'session-new', revision: 3 })
    expect(repo.hasFirstDeliveryRecoveryDebt('locus-1')).toBe(true)
  })
})
