/**
 * v20 single-row lifecycle (owner A; design D7): stop, re-enable, invalid and
 * in-place rebuild. Spec: pet-locus-collaboration "换绑与归档按层处理" and
 * "停止与重建". Written after the implementation: see the report for the slip.
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

const row = (overrides: Record<string, unknown> = {}) => ({
  endpoint: { chatId: 'oc_1' },
  locusId: 'locus-1',
  sessionId: 'session-1',
  state: 'active',
  accessMode: 'read-only',
  revision: 3,
  createdAt: 1,
  updatedAt: 1,
  locusMainSessionId: 'M1',
  workspaceId: 'W1',
  ...overrides,
})

async function seeded(rowOverrides: Record<string, unknown> = {}, deliveries: Record<string, unknown>[] = []) {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', row(rowOverrides))
  for (const delivery of deliveries) await domain.table('locus_deliveries').put(delivery.deliveryId as string, delivery)
  let counter = 0
  const reserve = () => `session-fresh-${++counter}`
  return { domain, repo: new LocusRepositoryV20(domain, { now: () => 50 }), reserve }
}

const fence = { expectedLocusId: 'locus-1', expectedRevision: 3 }

describe('stopRow (D7)', () => {
  it('stops an idle row, bumps revision and records stoppedAt', async () => {
    const { repo } = await seeded()
    const next = await repo.stopRow(fence, 60)
    expect(next).toMatchObject({ state: 'stopped', stoppedAt: 60, revision: 4 })
  })

  it('refuses with LOCUS_BUSY while a non-terminal delivery exists', async () => {
    const { repo } = await seeded({}, [{ deliveryId: 'd1', locusId: 'locus-1', status: 'running', endpoint: { chatId: 'oc_1' } }])
    const error = await repo.stopRow(fence, 60).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
  })
})

describe('reenableRow (D7)', () => {
  it('re-enables only a stopped row with a fresh reservation, read-only and revision + 1', async () => {
    const { repo, reserve } = await seeded({ state: 'stopped', stoppedAt: 5 })
    const next = await repo.reenableRow(fence, 60, reserve)
    expect(next).toMatchObject({ state: 'not-created', sessionId: 'session-fresh-1', accessMode: 'read-only', revision: 4 })
    expect(next).not.toHaveProperty('stoppedAt')
  })

  it('refuses a row that is not stopped with INVALID_REQUEST', async () => {
    const { repo, reserve } = await seeded()
    const error = await repo.reenableRow(fence, 60, reserve).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('INVALID_REQUEST')
  })
})

describe('markInvalid and rebuildRowInPlace (D7)', () => {
  it('marks a row invalid with a reason, then rebuilds it in place keeping the locusId', async () => {
    const { repo, reserve } = await seeded()
    const invalid = await repo.markInvalid(fence, 'child session lost', 60)
    expect(invalid).toMatchObject({ state: 'invalid', invalidReason: 'child session lost', revision: 4 })
    const rebuilt = await repo.rebuildRowInPlace({ expectedLocusId: 'locus-1', expectedRevision: 4 }, 70, reserve)
    expect(rebuilt).toMatchObject({ locusId: 'locus-1', state: 'not-created', sessionId: 'session-fresh-1', accessMode: 'read-only', revision: 5 })
    expect(rebuilt).not.toHaveProperty('invalidReason')
  })

  it('refuses an in-place rebuild of a row that is not invalid', async () => {
    const { repo, reserve } = await seeded()
    const error = await repo.rebuildRowInPlace(fence, 60, reserve).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('INVALID_REQUEST')
  })
})

describe('rebuildRowInPlace with deliveries (D7): uninjected backlog moves, runtime-issued refuses', () => {
  const backlog = {
    deliveryId: 'dB', messageId: 'mB', locusId: 'locus-1', endpoint: { chatId: 'oc_1' }, sessionId: 'child-1',
    senderOpenId: 'ou', sequence: 1, status: 'accepted', queueState: 'backlog', acceptedAt: 1,
    deadlineAt: 3_600_001, hardDeadlineAt: 86_400_001, revision: 0, stateRevision: 0,
    outboundResult: 'none', feedbackTarget: { chatId: 'oc_1', messageId: 'mB' },
  }

  it('rebuilds an invalid row and retargets its uninjected accepted backlog to the new reservation', async () => {
    const { repo, domain, reserve } = await seeded({}, [backlog])
    await repo.markInvalid({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'child lost', 9)
    const rebuilt = await repo.rebuildRowInPlace({ expectedLocusId: 'locus-1', expectedRevision: 4 }, 9, reserve)
    expect(rebuilt).toMatchObject({ state: 'not-created', sessionId: 'session-fresh-1', revision: 5 })
    expect(domain.table('locus_deliveries').get('dB')).toMatchObject({ status: 'accepted', sessionId: 'session-fresh-1' })
  })

  it('still refuses to rebuild while a runtime-issued delivery is in flight', async () => {
    const running = { ...backlog, deliveryId: 'dR', messageId: 'mR', status: 'running', queueState: undefined, executionId: 'exec-r', inboxMessageId: 'inbox-r', turnId: 'turn-r', startedAt: 2, feedbackTarget: { chatId: 'oc_1', messageId: 'mR' } }
    const { repo, reserve } = await seeded({}, [running])
    await repo.markInvalid({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'child lost', 9)
    const error = await repo.rebuildRowInPlace({ expectedLocusId: 'locus-1', expectedRevision: 4 }, 9, reserve).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
  })
})

