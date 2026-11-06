/**
 * v20 `resetChat` (owner A; design D17, spec "整群重置原语 resetChat").
 * One repository write callback: retarget the chat's group row to a new M,
 * reset every entry's lifecycle, retarget only uninjected backlog, refuse with
 * LOCUS_BUSY on any current Delivery, and roll everything back on refusal.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence.js'

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

const group = (overrides: Record<string, unknown> = {}) => ({
  endpoint: { chatId: 'oc_1' },
  locusId: 'locus-g',
  sessionId: 'session-g',
  state: 'active',
  accessMode: 'danger-full-access',
  verifiedAt: 9,
  grantedBy: 'owner',
  revision: 4,
  createdAt: 1,
  updatedAt: 1,
  locusMainSessionId: 'M1',
  workspaceId: 'W1',
  defaultQa: true,
  ...overrides,
})

const topic = (threadId: string, overrides: Record<string, unknown> = {}) => ({
  endpoint: { chatId: 'oc_1', threadId },
  locusId: `locus-${threadId}`,
  sessionId: `session-${threadId}`,
  state: 'active',
  accessMode: 'read-only',
  revision: 2,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

/** A schema-complete Delivery row (the Domain rejects partial rows at write time). */
const delivery = (id: string, overrides: Record<string, unknown> = {}) => ({
  deliveryId: id,
  messageId: `m-${id}`,
  locusId: `locus-${id}`,
  endpoint: { chatId: 'oc_1' },
  sessionId: `session-${id}`,
  senderOpenId: 'ou_1',
  sequence: 1,
  status: 'accepted',
  queueState: 'backlog',
  acceptedAt: 1,
  deadlineAt: 3_600_001,
  hardDeadlineAt: 86_400_001,
  revision: 0,
  stateRevision: 0,
  outboundResult: 'none',
  feedbackTarget: { chatId: 'oc_1', messageId: `m-${id}` },
  ...overrides,
})
/** A running Delivery: in flight, so it carries its execution proof and no queue position. */
const running = { status: 'running', queueState: undefined, executionId: 'exec-run', inboxMessageId: 'inbox-run', turnId: 'turn-run', startedAt: 2 }

async function seeded(extra: Array<[string, string, Record<string, unknown>]> = []) {
  const domain = memoryDomain()
  const loci = domain.table('loci')
  await loci.put('oc_1', group())
  await loci.put('oc_1\x1ft1', topic('t1'))
  for (const [table, key, value] of extra) await domain.table(table).put(key, value)
  await domain.table('locus_mains').put('M1', { locusMainSessionId: 'M1', workSessionId: 'W1-session', generation: 1, status: 'active', spaceId: 's', workspaceId: 'W1', createdAt: 1, updatedAt: 1 })
  await domain.table('locus_mains').put('M2', { locusMainSessionId: 'M2', workSessionId: 'W2-session', generation: 1, status: 'active', spaceId: 's2', workspaceId: 'W2', createdAt: 1, updatedAt: 1 })
  const repo = new LocusRepositoryV20(domain, { now: () => 100 })
  let counter = 0
  const reserve = () => `session-new-${++counter}`
  return { domain, repo, reserve }
}

describe('resetChat (D17)', () => {
  it('spec Scenario "重置一个群"', async () => {
    const { repo, reserve } = await seeded()
    await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', reboundFrom: 'W1-session', now: 100, reserveChildSessionId: reserve, expectedRevisions: { oc_1: 4, 'oc_1\x1ft1': 2 } }))
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M2', workspaceId: 'W2', reboundFrom: 'W1-session', state: 'not-created', accessMode: 'read-only', revision: 5, sessionId: 'session-new-1' })
    expect(repo.getRow({ chatId: 'oc_1', threadId: 't1' })).toMatchObject({ state: 'not-created', accessMode: 'read-only', revision: 3, sessionId: 'session-new-2' })
  })

  it('spec Scenario "clearDefaultQa 清除标记"', async () => {
    const { repo, reserve } = await seeded()
    await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', reboundFrom: 'W1-session', clearDefaultQa: true, now: 100, reserveChildSessionId: reserve }))
    expect(repo.getRow({ chatId: 'oc_1' })).not.toHaveProperty('defaultQa')
  })

  it('spec Scenario "backlog 按事务内的投递表改指"', async () => {
    const { repo, domain, reserve } = await seeded([['locus_deliveries', 'd-backlog', delivery('d-backlog', { locusId: 'locus-t1', endpoint: { chatId: 'oc_1', threadId: 't1' }, feedbackTarget: { chatId: 'oc_1', threadId: 't1', messageId: 'm-d-backlog' } })]])
    const result = await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', now: 100, reserveChildSessionId: reserve }))
    expect(result.retargetedDeliveryIds).toEqual(['d-backlog'])
    expect((domain.table('locus_deliveries').get('d-backlog') as { sessionId: string }).sessionId).toBe('session-new-2')
  })

  it('spec Scenario "已交给 runtime 的投递不被改指"', async () => {
    const { repo, domain, reserve } = await seeded([['locus_deliveries', 'd-run', delivery('d-run', { ...running, locusId: 'locus-t1', endpoint: { chatId: 'oc_1', threadId: 't1' } })]])
    const error = await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', now: 100, reserveChildSessionId: reserve })).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M1', revision: 4, sessionId: 'session-g' })
    expect((domain.table('locus_deliveries').get('d-run') as { sessionId: string }).sessionId).toBe('session-d-run')
  })

  it('spec Scenario "stopped 群行下仍有 active 话题时整群重置"', async () => {
    const { repo, domain, reserve } = await seeded()
    await domain.table('loci').put('oc_1', group({ state: 'stopped', stoppedAt: 5 }))
    await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', now: 100, reserveChildSessionId: reserve }))
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'stopped', stoppedAt: 5, accessMode: 'read-only', revision: 5 })
    expect(repo.getRow({ chatId: 'oc_1', threadId: 't1' })).toMatchObject({ state: 'not-created', revision: 3 })
  })

  it('rolls every write back when a refusal happens inside the callback', async () => {
    const { repo, reserve } = await seeded()
    const error = await repo.write(tx => {
      tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', now: 100, reserveChildSessionId: reserve })
      throw new LocusRefusalError('LOCUS_BUSY', 'forced after the reset')
    }).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ locusMainSessionId: 'M1', revision: 4, state: 'active' })
  })

  it('refuses an expectedRevisions mismatch with LOCUS_CONFLICT and changes nothing', async () => {
    const { repo, reserve } = await seeded()
    const error = await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', now: 100, reserveChildSessionId: reserve, expectedRevisions: { oc_1: 3 } })).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect(repo.getRow({ chatId: 'oc_1' })).toMatchObject({ revision: 4 })
  })

  it('spec Scenario \"事务内发现 current 则整体回滚\"', async () => {
    const { repo, domain, reserve } = await seeded([
      ['locus_deliveries', 'd-run', delivery('d-run', { ...running, locusId: 'locus-t1', endpoint: { chatId: 'oc_1' } })],
      ['locus_deliveries', 'd-backlog', delivery('d-backlog', { locusId: 'locus-t1', endpoint: { chatId: 'oc_1', threadId: 't1' }, feedbackTarget: { chatId: 'oc_1', threadId: 't1', messageId: 'm-d-backlog' } })],
    ])
    const before = JSON.stringify([...domain.table('loci').entries()])
    const error = await repo.write(tx => tx.resetChat('oc_1', { toM: 'M2', workspaceId: 'W2', now: 100, reserveChildSessionId: reserve })).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
    expect(JSON.stringify([...domain.table('loci').entries()])).toBe(before)
    expect((domain.table('locus_deliveries').get('d-backlog') as { sessionId: string }).sessionId).toBe('session-d-backlog')
  })
})
