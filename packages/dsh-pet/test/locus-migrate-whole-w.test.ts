/** Spec: pet-locus-collaboration "换绑与归档按层处理" whole-W migration rows (D7), controller half. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocusController } from '../src/host/locus/controller.js'
import { Topology, closeAllTopologies, type TopologyBackend } from './support/w-topology.js'

/** Each scenario runs on the recording fake AND on the real LocusRepositoryV20 over temp SQLite. */
let backend: TopologyBackend = 'fake'
const BACKENDS: readonly TopologyBackend[] = ['fake', 'real']
afterEach(closeAllTopologies)

/** W1 with an unusable active M-old, two chats, one stopped topic, a retired pairing with its own chat. */
async function setup(unusable = ['M-old']) {
  const t = await Topology.open({ unusableMains: unusable }, backend)
  await t.seedMain('W1', 'M-retired', 'retired', 1)
  await t.seedMain('W1', 'M-old', 'active', 2)
  await t.seedGroup('oc_a', 'M-old', 'proj-1', { defaultQa: true, revision: 1 })
  await t.seedTopic('oc_a', 't1', { revision: 3, state: 'active', sessionId: 'session-live' })
  await t.seedTopic('oc_a', 't2', { state: 'stopped', stoppedAt: 2, revision: 1 })
  await t.seedGroup('oc_b', 'M-old', 'proj-1')
  await t.seedGroup('oc_c', 'M-retired', 'proj-1')
  t.calls.length = 0
  return { t, controller: new LocusController(t.deps()) }
}
const groupM = (t: Topology, chatId: string) => {
  const row = t.repository.getRow({ chatId })!
  return 'locusMainSessionId' in row ? row.locusMainSessionId : undefined
}

describe.each(BACKENDS)('整 W 迁移 [%s]', which => {
  beforeEach(() => { backend = which })

  it('locus 主会话不可用时整体迁移: one new M1, retire active pairing, every chat of every pairing reset', async () => {
    const { t, controller } = await setup()
    const result = await controller.migrateWholeW('W1', 'oc_a')
    expect(result).toMatchObject({ migrated: true, chats: 3 })
    expect(t.created.map(c => c.kind)).toEqual(['locus-main'])
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual(['begin:migrate'])
    const m1 = t.repository.findActiveMain('W1')!
    expect(m1.locusMainSessionId).not.toBe('M-old')
    expect(m1.generation).toBe(3)
    expect(t.repository.findMain('M-old')!.status).toBe('retired')
    for (const chat of ['oc_a', 'oc_b', 'oc_c']) expect(groupM(t, chat)).toBe(m1.locusMainSessionId)
    const live = t.repository.getRow({ chatId: 'oc_a', threadId: 't1' })!
    expect(live.state).toBe('not-created')
    expect(live.sessionId).not.toBe('session-live')
    expect(live.accessMode).toBe('read-only')
    expect(live.revision).toBe(4)
  })

  it('停止的入口不被复活，defaultQa 标记随行走', async () => {
    const { t, controller } = await setup()
    await controller.migrateWholeW('W1', 'oc_a')
    const stopped = t.repository.getRow({ chatId: 'oc_a', threadId: 't2' })!
    expect(stopped.state).toBe('stopped')
    expect(stopped.revision).toBe(2)
    const group = t.repository.getRow({ chatId: 'oc_a' })!
    expect('defaultQa' in group && group.defaultQa).toBe(true)
  })

  it('任何群有 current 投递时不迁移: nothing created, nothing begun', async () => {
    const { t, controller } = await setup()
    await t.setCurrent('oc_c')
    const result = await controller.migrateWholeW('W1', 'oc_a')
    expect(result).toMatchObject({ migrated: false, reason: 'current-delivery', chatId: 'oc_c' })
    expect(t.created).toEqual([])
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual([])
    expect(t.repository.findMain('M-old')!.status).toBe('active')
  })

  it('两个触发同时到达只建一个 M1', async () => {
    const { t, controller } = await setup()
    const [first, second] = await Promise.all([
      controller.migrateWholeW('W1', 'oc_a'),
      controller.migrateWholeW('W1', 'oc_b'),
    ])
    expect([first.migrated, second.migrated].sort()).toEqual([false, true])
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    const loser = [first, second].find(r => !r.migrated)!
    expect(loser).toMatchObject({ reason: 'main-usable' })
  })

  it('M 可用时不迁移', async () => {
    const { t, controller } = await setup([])
    const result = await controller.migrateWholeW('W1', 'oc_a')
    expect(result).toMatchObject({ migrated: false, reason: 'main-usable' })
    expect(t.created).toEqual([])
  })

  it('M1 再次不可用时重复同一机制 (generation advances)', async () => {
    const { t, controller } = await setup()
    await controller.migrateWholeW('W1', 'oc_a')
    const m1 = t.repository.findActiveMain('W1')!
    t.unusableMains.add(m1.locusMainSessionId)
    await controller.migrateWholeW('W1', 'oc_a')
    const m2 = t.repository.findActiveMain('W1')!
    expect(m2.locusMainSessionId).not.toBe(m1.locusMainSessionId)
    expect(m2.generation).toBe(4)
    expect(t.repository.findMain(m1.locusMainSessionId)!.status).toBe('retired')
  })

  it('无 active 配对时一次触发迁移所有配对下的群', async () => {
    const t = await Topology.open({ unusableMains: [] }, backend)
    await t.seedMain('W1', 'M-r1', 'retired', 1)
    await t.seedMain('W1', 'M-r2', 'retired', 2)
    await t.seedGroup('oc_a', 'M-r1')
    await t.seedGroup('oc_b', 'M-r2')
    const result = await new LocusController(t.deps()).migrateWholeW('W1', 'oc_a')
    expect(result).toMatchObject({ migrated: true, chats: 2 })
    const m1 = t.repository.findActiveMain('W1')!.locusMainSessionId
    expect(groupM(t, 'oc_a')).toBe(m1)
    expect(groupM(t, 'oc_b')).toBe(m1)
  })

  it('事务内复查发现 current 则整体回滚并只补偿 M1', async () => {
    const { t, controller } = await setup()
    const original = t.repository.commitWholeWMigration.bind(t.repository)
    t.repository.commitWholeWMigration = async input => { await t.setCurrent('oc_b'); return original(input) }
    await expect(controller.migrateWholeW('W1', 'oc_a')).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    expect(t.repository.findMain('M-old')!.status).toBe('active')
    expect(groupM(t, 'oc_a')).toBe('M-old')
    expect(t.released).toEqual(t.created.map(c => c.id))
    expect(t.spacesReleased).toEqual(t.created.map(c => c.id))
  })

  it('W 已归档时不迁移（改绑与迁移互斥）', async () => {
    const { t, controller } = await setup()
    t.archived.add('W1')
    await expect(controller.migrateWholeW('W1', 'oc_a')).rejects.toMatchObject({ code: 'SOURCE_ARCHIVED' })
    expect(t.created).toEqual([])
  })

  it('ensureEntry on an unusable M triggers the whole-W migration and returns the reset row', async () => {
    const { t, controller } = await setup()
    const result = await controller.ensureEntry({ chatId: 'oc_b' })
    expect(result.created).toBe(true)
    expect(result.migration?.chats).toBe(3)
    expect(result.locus.state).toBe('not-created')
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
  })
})

/**
 * R3-C2: the backlog dispatcher verifies M (and migrates / rebuilds) BEFORE it
 * claims, re-reads the new sessionId, and never ends silently.
 */
import { createLocusChannelController } from '../src/host/channel/locus-controller.js'

describe('backlog 派发器在 claim 之前核验 M', () => {
  const endpoint = { chatId: 'oc_a' }
  const correlation = { endpoint, locusId: 'locus-a', sessionId: 'session-old' }
  const row = (sessionId: string, extra: Record<string, unknown> = {}) => ({
    locusId: 'locus-a', endpoint, sessionId, state: 'not-created' as const, accessMode: 'read-only' as const,
    revision: 1, locusMainSessionId: 'M-x', workspaceId: 'w', workSessionId: 'W1', ...extra,
  })

  function harness(ensure: () => Promise<unknown>) {
    const order: string[] = []
    const claims: string[] = []
    const logs: string[] = []
    const controller = createLocusChannelController({
      locus: {
        resolveCurrent: async () => { order.push('resolveCurrent'); return row('session-old') },
        ensureForDelivery: async () => { order.push('ensureForDelivery'); return ensure() },
      } as never,
      deliveries: {} as never,
      deliveryDispatch: {
        claimCurrent: async (input: { correlation: { sessionId: string } }) => {
          order.push('claim')
          claims.push(input.correlation.sessionId)
          return undefined
        },
        pendingForLocus: async () => [],
      } as never,
      child: {} as never,
      turns: { perTurnCorrelation: true, subscribe: () => () => {} } as never,
      log: code => { logs.push(code) },
    } as never)
    return { controller, order, claims, logs }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))

  it('verifies/migrates first, then claims on the NEW sessionId (never the stale one)', async () => {
    const h = harness(async () => row('session-new'))
    await h.controller.dispatchNext(correlation)
    await settle()
    expect(h.order.indexOf('ensureForDelivery')).toBeGreaterThanOrEqual(0)
    expect(h.order.indexOf('ensureForDelivery')).toBeLessThan(h.order.indexOf('claim'))
    expect(h.claims).toEqual(['session-new'])
  })

  it('claims on the same sessionId when M is fine', async () => {
    const h = harness(async () => row('session-old'))
    await h.controller.dispatchNext(correlation)
    expect(h.claims).toEqual(['session-old'])
  })

  it('when the migration is deferred (current elsewhere) nothing is claimed and the stop is NOT silent', async () => {
    const h = harness(async () => { throw Object.assign(new Error('current in oc_c'), { code: 'LOCUS_BUSY' }) })
    await h.controller.dispatchNext(correlation)
    await settle()
    expect(h.claims).toEqual([])
    expect(h.logs.some(code => code.startsWith('dispatch-main-unverified'))).toBe(true)
  })
})
