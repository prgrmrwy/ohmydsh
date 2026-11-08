/**
 * v20 persistence rows (owner A): set invariants of the `loci` table.
 * Spec: pet-locus-collaboration "Locus 三层实体", "持久层 v20 只承载同构的 locus 入口行".
 */
import { describe, expect, it } from 'vitest'
import { validateLocusSetForStorage, endpointKeyV20 } from '../src/host/locus/locus-set-v20.js'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'

const base = { state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 } as const

function group(chatId: string, overrides: Record<string, unknown> = {}) {
  return {
    endpoint: { chatId },
    locusId: `locus-${chatId}`,
    sessionId: `session-${chatId}`,
    ...base,
    locusMainSessionId: 'M1',
    workspaceId: 'W1',
    ...overrides,
  }
}

function topic(chatId: string, threadId: string, overrides: Record<string, unknown> = {}) {
  return {
    endpoint: { chatId, threadId },
    locusId: `locus-${chatId}-${threadId}`,
    sessionId: `session-${chatId}-${threadId}`,
    ...base,
    ...overrides,
  }
}

function set(rows: Array<[string, unknown]>): Map<string, unknown> {
  return new Map(rows)
}

describe('validateLocusSetForStorage (v20 set invariants)', () => {
  it('accepts a group row with its topic row under the same chat', () => {
    const rows = set([
      ['oc_1', group('oc_1')],
      [endpointKeyV20({ chatId: 'oc_1', threadId: 't1' }), topic('oc_1', 't1')],
    ])
    expect(validateLocusSetForStorage(rows, new Set(['M1']))).toEqual([])
  })

  it('spec Scenario "话题行没有群行时集合校验失败"', () => {
    const rows = set([[endpointKeyV20({ chatId: 'oc_9', threadId: 't1' }), topic('oc_9', 't1')]])
    const codes = validateLocusSetForStorage(rows, new Set(['M1'])).map(violation => violation.code)
    expect(codes).toContain('TOPIC_WITHOUT_GROUP')
  })

  it('rejects a topic row that carries group-only fields (strict schema)', () => {
    const rows = set([
      ['oc_1', group('oc_1')],
      [endpointKeyV20({ chatId: 'oc_1', threadId: 't1' }), topic('oc_1', 't1', { locusMainSessionId: 'M2' })],
    ])
    const codes = validateLocusSetForStorage(rows, new Set(['M1', 'M2'])).map(violation => violation.code)
    expect(codes).toContain('ROW_INVALID')
  })

  it('spec Scenario "重复 sessionId 被拒绝"', () => {
    const rows = set([
      ['oc_1', group('oc_1', { sessionId: 'same' })],
      ['oc_2', group('oc_2', { sessionId: 'same' })],
    ])
    const codes = validateLocusSetForStorage(rows, new Set(['M1'])).map(violation => violation.code)
    expect(codes).toContain('DUPLICATE_SESSION_ID')
  })

  it('spec Scenario "同一 M 下两个默认 Q&A 标记被拒绝"', () => {
    const rows = set([
      ['oc_1', group('oc_1', { defaultQa: true })],
      ['oc_2', group('oc_2', { defaultQa: true })],
    ])
    const codes = validateLocusSetForStorage(rows, new Set(['M1'])).map(violation => violation.code)
    expect(codes).toContain('MULTIPLE_DEFAULT_QA')
  })

  it('rejects a group whose M has no locus_mains pairing', () => {
    const rows = set([['oc_1', group('oc_1', { locusMainSessionId: 'M-missing' })]])
    const codes = validateLocusSetForStorage(rows, new Set(['M1'])).map(violation => violation.code)
    expect(codes).toContain('GROUP_MAIN_UNPAIRED')
  })
})

/** In-memory stand-in for the domain: tables as Maps, atomic transaction shim. */
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

const pairing = (main: string, work: string, status: 'active' | 'retired' = 'active') => ({
  locusMainSessionId: main, workSessionId: work, generation: 1, status, spaceId: `space-${main}`, workspaceId: `ws-${work}`, createdAt: 1, updatedAt: 1,
})

const groupRow = (chatId: string, locusId: string, sessionId: string, main: string, extra: Record<string, unknown> = {}) => ({
  endpoint: { chatId }, locusId, sessionId, state: 'active', accessMode: 'read-only',
  revision: 1, createdAt: 1, updatedAt: 1, locusMainSessionId: main, workspaceId: 'ws', ...extra,
})

const delivery = (deliveryId: string, locusId: string, sessionId: string, chatId: string, status: string, extra: Record<string, unknown> = {}) => ({
  deliveryId, messageId: `m-${deliveryId}`, locusId, endpoint: { chatId }, sessionId, senderOpenId: 'ou', sequence: 1,
  status, acceptedAt: 1, deadlineAt: 1 + 3_600_000, hardDeadlineAt: 1 + 86_400_000, revision: 0, stateRevision: 0,
  outboundResult: 'none', feedbackTarget: { chatId, messageId: `m-${deliveryId}` }, ...extra,
})

const inbound = (locusId: string, sessionId: string, chatId: string, messageId: string) => ({
  endpoint: { chatId }, locusId, sessionId, messageId, deliveryId: messageId, senderOpenId: 'ou', text: 'hi', acceptedAt: 10,
} as never)

describe('spec scenarios of the v20 persistence rows', () => {
  it('spec Scenario \"群行独占 M 与工作区\"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('locus_mains').put('M2', pairing('M2', 'W1'))
    await domain.table('loci').put('oc_g', groupRow('oc_g', 'locus-g', 'child-g', 'M1'))
    await domain.table('loci').put('oc_g\x1ft', { endpoint: { chatId: 'oc_g', threadId: 't' }, locusId: 'locus-t', sessionId: 'child-t', state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 })
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    // The stored shapes: the group row carries M and workspace, the topic row carries neither.
    expect(repo.getRow({ chatId: 'oc_g' })).toMatchObject({ locusMainSessionId: 'M1', workspaceId: 'ws' })
    expect(repo.getRow({ chatId: 'oc_g', threadId: 't' })).not.toHaveProperty('locusMainSessionId')
    expect(repo.getRow({ chatId: 'oc_g', threadId: 't' })).not.toHaveProperty('workspaceId')
    expect(repo.findBySessionId('child-t')?.locusMainSessionId).toBe('M1')
    // Repointing the group row moves the topic's resolved M with it.
    await domain.table('loci').put('oc_g', groupRow('oc_g', 'locus-g', 'child-g', 'M2'))
    expect(repo.findBySessionId('child-t')?.locusMainSessionId).toBe('M2')
  })

  it('spec Scenario \"全部索引按行重建\"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('loci').put('oc_g', groupRow('oc_g', 'locus-g', 'child-g', 'M1'))
    await domain.table('loci').put('oc_g2', groupRow('oc_g2', 'locus-g2', 'child-g2', 'M1'))
    await domain.table('loci').put('oc_g\x1ft', { endpoint: { chatId: 'oc_g', threadId: 't' }, locusId: 'locus-t', sessionId: 'child-t', state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 })
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    expect(repo.findBySessionId('child-t')).toMatchObject({ row: { locusId: 'locus-t' }, locusMainSessionId: 'M1' })
    expect(repo.listGroupRowsOfMain('M1').map(row => row.locusId).sort()).toEqual(['locus-g', 'locus-g2'])
    expect(repo.getLocus('locus-t')).toMatchObject({ sessionId: 'child-t' })
    expect(repo.getLocus('locus-missing')).toBeUndefined()
    // No index table is declared any more (D12).
    expect(Object.keys((await import('../src/host/domain.js')).petDomainSpec.tables)).not.toContain('locus_indexes')
  })

  it('spec Scenario \"默认 Q&A 经标记查找\"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('locus_mains').put('M0', pairing('M0', 'W1', 'retired'))
    await domain.table('loci').put('oc_qa', groupRow('oc_qa', 'locus-qa', 'child-qa', 'M1', { defaultQa: true }))
    await domain.table('loci').put('oc_g2', groupRow('oc_g2', 'locus-g2', 'child-g2', 'M1'))
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    expect(repo.findDefaultQa('W1')).toMatchObject({ endpoint: { chatId: 'oc_qa' }, locusId: 'locus-qa' })
    // A retired pairing's marked row is not the default Q&A of the W now.
    await domain.table('loci').put('oc_qa', groupRow('oc_qa', 'locus-qa', 'child-qa', 'M0', { defaultQa: true }))
    expect(repo.findDefaultQa('W1')).toBeUndefined()
  })

  it('spec Scenario "acquire 与到达的 at 在写队列内竞争（acquire 先）"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('loci').put('oc_1', groupRow('oc_1', 'locus-1', 'child-1', 'M1'))
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    const [acquire, at] = await Promise.allSettled([repo.acquireAccessChange('locus-1'), repo.acceptDelivery(inbound('locus-1', 'child-1', 'oc_1', 'at-1'))])
    expect(acquire.status).toBe('fulfilled')
    expect(at.status).toBe('rejected')
    expect((at as PromiseRejectedResult).reason).toMatchObject({ code: 'LOCUS_BUSY' })
  })

  it('spec Scenario "acquire 与到达的 at 在写队列内竞争（at 先）"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('loci').put('oc_1', groupRow('oc_1', 'locus-1', 'child-1', 'M1'))
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    const [at, acquire] = await Promise.allSettled([repo.acceptDelivery(inbound('locus-1', 'child-1', 'oc_1', 'at-1')), repo.acquireAccessChange('locus-1')])
    expect(at.status).toBe('fulfilled')
    expect(acquire.status).toBe('rejected')
    expect((acquire as PromiseRejectedResult).reason).toMatchObject({ code: 'LOCUS_BUSY' })
  })

  it('spec Scenario \"入口忙时拒绝变更\"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('loci').put('oc_1', groupRow('oc_1', 'locus-1', 'child-1', 'M1'))
    await domain.table('locus_deliveries').put('d-run', delivery('d-run', 'locus-1', 'child-1', 'oc_1', 'running'))
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    const error = await repo.acquireAccessChange('locus-1').catch(e => e)
    expect(error).toBeInstanceOf(LocusRefusalError)
    expect((error as LocusRefusalError).code).toBe('LOCUS_BUSY')
    expect(repo.getLocus('locus-1')).toMatchObject({ revision: 1 })
    expect(repo.isAccessChanging('locus-1')).toBe(false)
  })

  it('spec Scenario \"变更与停止、改绑、迁移、重建互斥\"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('locus_mains').put('M2', pairing('M2', 'W2'))
    await domain.table('loci').put('oc_1', groupRow('oc_1', 'locus-1', 'child-1', 'M1'))
    await domain.table('locus_operations').put('op-rebind', { id: 'op-rebind', kind: 'rebind', operation: 'rebind', phase: 'provisioning', step: 0, attempts: 0, createdAt: 1, updatedAt: 1 })
    await domain.table('locus_operations').put('op-migrate', { id: 'op-migrate', kind: 'migrate', operation: 'migrate', phase: 'provisioning', step: 0, attempts: 0, createdAt: 1, updatedAt: 1 })
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    await repo.acquireAccessChange('locus-1')
    const fence = { expectedLocusId: 'locus-1', expectedRevision: 1 }
    const busy = async (promise: Promise<unknown>) => (await promise.catch(e => e) as LocusRefusalError).code
    expect(await busy(repo.stopRow(fence, 9))).toBe('LOCUS_BUSY')
    expect(await busy(repo.rebindChat({
      provisioningId: 'op-rebind', chatId: 'oc_1', expectedLocusId: 'locus-1', expectedRevision: 1, toM: 'M2',
      workspaceId: 'ws-W2', reboundFrom: 'W1', now: 9, reserveChildSessionId: () => 'child-new',
    }))).toBe('LOCUS_BUSY')
    expect(await busy(repo.commitWholeWMigration({
      provisioningId: 'op-migrate', workSessionId: 'W1', newMain: pairing('M3', 'W1'),
      chats: [{ chatId: 'oc_1', expectedRevisions: { oc_1: 1 } }], now: 9, reserveChildSessionId: () => 'child-new',
    }))).toBe('LOCUS_BUSY')
    // A row can only be rebuilt in place once invalid; mark it invalid mid-change, then rebuild.
    await repo.markInvalid({ expectedLocusId: 'locus-1', expectedRevision: 1 }, 'child lost', 9)
    expect(await busy(repo.rebuildRowInPlace({ expectedLocusId: 'locus-1', expectedRevision: 2 }, 9, () => 'child-new'))).toBe('LOCUS_BUSY')
    repo.releaseAccessChange('locus-1')
  })

  it('spec Scenario \"话题行没有群行使 Domain 打开失败\"', async () => {
    const domain = memoryDomain()
    await domain.table('locus_mains').put('M1', pairing('M1', 'W1'))
    await domain.table('loci').put('oc_9\x1ft1', { endpoint: { chatId: 'oc_9', threadId: 't1' }, locusId: 'locus-t', sessionId: 'child-t', state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 })
    const repo = new LocusRepositoryV20(domain, { now: () => 5 })
    const error = (() => { try { repo.assertLocusSetValid(); return undefined } catch (e) { return e } })()
    expect(error).toBeInstanceOf(LocusRefusalError)
    expect((error as LocusRefusalError).code).toBe('INVALID_REQUEST')
    expect((error as Error).message).toContain('oc_9')
  })
})
