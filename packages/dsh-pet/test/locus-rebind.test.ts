/** Spec: pet-locus-collaboration "改绑到其他会话" (D6), controller half. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocusController, LocusControllerError } from '../src/host/locus/controller.js'
import { Topology, closeAllTopologies, type TopologyBackend } from './support/w-topology.js'

/** Each scenario runs on the recording fake AND on the real LocusRepositoryV20 over temp SQLite. */
let backend: TopologyBackend = 'fake'
const BACKENDS: readonly TopologyBackend[] = ['fake', 'real']
afterEach(closeAllTopologies)

async function setup(extra: { unusableMains?: string[] } = {}) {
  const t = await Topology.open({ archived: ['W1'], ...extra }, backend)
  await t.seedMain('W1', 'M-old')
  const group = await t.seedGroup('oc_1', 'M-old', 'proj-1', { defaultQa: true, revision: 4 })
  await t.seedTopic('oc_1', 't1', { revision: 2 })
  await t.seedTopic('oc_1', 't2', { state: 'stopped', stoppedAt: 9, revision: 1 })
  t.calls.length = 0
  return { t, group, controller: new LocusController(t.deps()) }
}
const fence = (g: { locusId: string; revision: number }, workSessionId = 'W2') =>
  ({ chatId: 'oc_1', workSessionId, expectedLocusId: g.locusId, expectedRevision: g.revision })
const refusal = (p: Promise<unknown>) => p.then(() => undefined, e => e as LocusControllerError)

describe.each(BACKENDS)('改绑到其他会话 [%s]', which => {
  beforeEach(() => { backend = which })

  it('改绑成功: M1 created, group moved with reboundFrom, defaultQa cleared, locusId kept, stopped stays stopped', async () => {
    const { t, group, controller } = await setup()
    await controller.rebindChat(fence(group))
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual(['begin:rebind'])
    const rebound = t.repository.getRow({ chatId: 'oc_1' })!
    if (!('locusMainSessionId' in rebound)) throw new Error('group row expected')
    expect(t.repository.findMain(rebound.locusMainSessionId)!.workSessionId).toBe('W2')
    expect(rebound.reboundFrom).toBe('W1')
    expect(rebound.workspaceId).toBe('proj-2')
    expect(rebound.defaultQa).toBeUndefined()
    expect(rebound.locusId).toBe(group.locusId)
    expect(rebound.revision).toBe(5)
    expect(rebound.sessionId).not.toBe(group.sessionId)
    expect(t.repository.getRow({ chatId: 'oc_1', threadId: 't1' })!.state).toBe('not-created')
    const stopped = t.repository.getRow({ chatId: 'oc_1', threadId: 't2' })!
    expect(stopped.state).toBe('stopped')
    expect(stopped.revision).toBe(2)
    // the old pairing and the old M are untouched
    expect(t.repository.findMain('M-old')!.status).toBe('active')
    expect(t.released).toEqual([])
  })

  it('目标 W 尚无 locus 主会话: creates M1 and its space', async () => {
    const { t, group, controller } = await setup()
    await controller.rebindChat(fence(group))
    expect(t.created.map(c => c.kind)).toEqual(['locus-main'])
    expect(t.spacesEstablished).toHaveLength(1)
  })

  it('目标 W 已有 active M 时复用，失败也不触碰它', async () => {
    const { t, group, controller } = await setup()
    await t.seedMain('W2', 'M-w2')
    await controller.rebindChat(fence(group))
    expect(t.created).toEqual([])
    const row = t.repository.getRow({ chatId: 'oc_1' })!
    expect('locusMainSessionId' in row && row.locusMainSessionId).toBe('M-w2')
  })

  describe('改绑被拒绝的各种情形 (checks run in the documented order)', () => {
    it('1 no group row → LOCUS_NOT_FOUND', async () => {
      const { controller } = await setup()
      const e = await refusal(controller.rebindChat({ chatId: 'oc_x', workSessionId: 'W2', expectedLocusId: 'l', expectedRevision: 0 }))
      expect(e?.code).toBe('LOCUS_NOT_FOUND')
    })
    it('2 stale fence → LOCUS_CONFLICT', async () => {
      const { group, controller } = await setup()
      const e = await refusal(controller.rebindChat({ ...fence(group), expectedRevision: 3 }))
      expect(e?.code).toBe('LOCUS_CONFLICT')
    })
    it('3 current W not archived → INVALID_REQUEST', async () => {
      const { t, group, controller } = await setup()
      t.archived.delete('W1')
      const e = await refusal(controller.rebindChat(fence(group)))
      expect(e?.code).toBe('INVALID_REQUEST')
      expect(t.created).toEqual([])
    })
    it.each([
      ['archived', () => Topology.open({ archived: ['W1', 'W2'] }, backend)],
    ])('4 target %s → INVALID_REQUEST', async (_n, build) => {
      const t = await build()
      await t.seedMain('W1', 'M-old')
      const group = await t.seedGroup('oc_1', 'M-old')
      const e = await refusal(new LocusController(t.deps()).rebindChat(fence(group)))
      expect(e?.code).toBe('INVALID_REQUEST')
    })
    it('4 target is a locus main / a child / missing → INVALID_REQUEST', async () => {
      const { t, group, controller } = await setup()
      t.addSession({ id: 'child-1', workspaceId: 'proj-2', title: 'c', parentSessionId: 'W2' })
      for (const target of ['M-old', 'child-1', 'nope']) {
        const e = await refusal(controller.rebindChat(fence(group, target)))
        expect(e?.code).toBe('INVALID_REQUEST')
      }
      expect(t.created).toEqual([])
    })
    it('5 current Delivery in the chat → LOCUS_BUSY, before any provisioning', async () => {
      const { t, group, controller } = await setup()
      await t.setCurrent('oc_1')
      const e = await refusal(controller.rebindChat(fence(group)))
      expect(e?.code).toBe('LOCUS_BUSY')
      expect(t.calls.filter(c => c.startsWith('begin'))).toEqual([])
    })
    it('first unmet check wins (stale fence and unarchived W → LOCUS_CONFLICT)', async () => {
      const { t, group, controller } = await setup()
      t.archived.delete('W1')
      const e = await refusal(controller.rebindChat({ ...fence(group), expectedRevision: 0 }))
      expect(e?.code).toBe('LOCUS_CONFLICT')
    })
  })

  it('提交前出现 current 时回滚并只补偿本操作的资源', async () => {
    const { t, group, controller } = await setup()
    const original = t.repository.rebindChat.bind(t.repository)
    t.repository.rebindChat = async input => { await t.setCurrent('oc_1'); return original(input) }
    const e = await refusal(controller.rebindChat(fence(group)))
    expect(e?.code).toBe('LOCUS_BUSY')
    expect(t.released).toEqual(t.created.map(c => c.id))
    expect(t.spacesReleased).toEqual(t.created.map(c => c.id))
    expect(t.repository.findMain('M-old')!.status).toBe('active')
    // Fully reclaimed by the rollback: nothing is left to compensate.
    expect(t.opStates()).toEqual(['compensated'])
  })

  describe('目标 W 的 M 不可用：管理面改绑先整 W 迁移 (D7)', () => {
    it('死 M 下没有任何群：退役它、新建 M1、不迁移任何东西，改绑成功', async () => {
      const { t, group, controller } = await setup({ unusableMains: ['M-dead'] })
      await t.seedMain('W2', 'M-dead')
      const result = await controller.rebindChat(fence(group))
      const row = t.repository.getRow({ chatId: 'oc_1' })!
      const m = (row as { locusMainSessionId: string }).locusMainSessionId
      expect(m).not.toBe('M-dead')
      expect(t.repository.findMain('M-dead')!.status).toBe('retired')
      expect(t.repository.findMain(m)).toMatchObject({ workSessionId: 'W2', status: 'active' })
      expect(t.mainIds().filter(id => id !== 'M-old' && id !== 'M-dead')).toEqual([m])
      expect(result.group.locusId).toBe(group.locusId)
    })

    it('死 M 下另有空闲群：那个群也一并迁移到新 M', async () => {
      const { t, group, controller } = await setup({ unusableMains: ['M-dead'] })
      await t.seedMain('W2', 'M-dead')
      await t.seedGroup('oc_other', 'M-dead', 'proj-2')
      await controller.rebindChat(fence(group))
      const m1 = (t.repository.getRow({ chatId: 'oc_1' }) as { locusMainSessionId: string }).locusMainSessionId
      const other = t.repository.getRow({ chatId: 'oc_other' }) as { locusMainSessionId: string; revision: number }
      expect(other.locusMainSessionId).toBe(m1)
      expect(other.revision).toBeGreaterThan(0)
    })

    it('死 M 下另一个群有 current 投递 → LOCUS_BUSY，什么也没建', async () => {
      const { t, group, controller } = await setup({ unusableMains: ['M-dead'] })
      await t.seedMain('W2', 'M-dead')
      await t.seedGroup('oc_other', 'M-dead', 'proj-2')
      await t.setCurrent('oc_other')
      const before = t.mainIds().sort()
      const e = await refusal(controller.rebindChat(fence(group)))
      expect(e?.code).toBe('LOCUS_BUSY')
      expect(e?.message).toContain('目标会话的另一个群有处理中的投递')
      expect(t.created).toEqual([])
      expect(t.mainIds().sort()).toEqual(before)
      expect(t.repository.findMain('M-dead')!.status).toBe('active')
      expect((t.repository.getRow({ chatId: 'oc_1' }) as { locusMainSessionId: string }).locusMainSessionId).toBe('M-old')
    })
  })

  it('仓库对 provisioning 的拒绝原样透传 code 与文案，不再包成 PROVISIONING_FAILED', async () => {
    const { t, group, controller } = await setup()
    const refused = Object.assign(new Error('provisioning p1 failed recently; retry after the block window'), { code: 'LOCUS_CONFLICT' })
    t.repository.beginProvisioning = async () => { throw refused }
    const e = await refusal(controller.rebindChat(fence(group)))
    expect(e?.code).toBe('LOCUS_CONFLICT')
    expect(e?.message).toContain('该群上一次操作刚失败')
    expect(t.created).toEqual([])
  })

  it('已有 M1 在失败时不受影响', async () => {
    const { t, group, controller } = await setup()
    await t.seedMain('W2', 'M-w2')
    t.repository.rebindChat = async () => { throw new Error('boom') }
    await expect(controller.rebindChat(fence(group))).rejects.toBeInstanceOf(LocusControllerError)
    expect(t.released).toEqual([])
    expect(t.spacesReleased).toEqual([])
    expect(t.repository.findMain('M-w2')!.status).toBe('active')
  })
})

describe.each(BACKENDS)('入口内 /bind 改绑已归档来源 [%s]', which => {
  beforeEach(() => { backend = which })

  it('W 已归档且指定其它会话：整群改绑，随后同 W 的 ensure 复用', async () => {
    const { t, controller } = await setup()
    const rebound = await controller.rebindArchivedChatForBind({ chatId: 'oc_1', workSessionId: 'W2' })
    expect(rebound).toBeDefined()
    const group = t.repository.getRow({ chatId: 'oc_1' })!
    if (!('locusMainSessionId' in group)) throw new Error('group row expected')
    expect(t.repository.findMain(group.locusMainSessionId)!.workSessionId).toBe('W2')
    expect(group.reboundFrom).toBe('W1')
    const ensured = await controller.ensureGroup({ chatId: 'oc_1', parentSessionId: 'W2' })
    expect(ensured.reused).toBe(true)
  })

  it('W 未归档：不改绑，普通 ensure 仍以 EXPLICIT_PARENT_CONFLICT 拒绝', async () => {
    const t = await Topology.open({}, backend)
    await t.seedMain('W1', 'M-old')
    await t.seedGroup('oc_1', 'M-old', 'proj-1', { revision: 1 })
    const controller = new LocusController(t.deps())
    await expect(controller.rebindArchivedChatForBind({ chatId: 'oc_1', workSessionId: 'W2' })).resolves.toBeUndefined()
    await expect(controller.ensureGroup({ chatId: 'oc_1', parentSessionId: 'W2' }))
      .rejects.toMatchObject({ code: 'EXPLICIT_PARENT_CONFLICT' })
  })

  it('同一个已归档 W：不改绑', async () => {
    const { controller } = await setup()
    await expect(controller.rebindArchivedChatForBind({ chatId: 'oc_1', workSessionId: 'W1' })).resolves.toBeUndefined()
  })

  it('没有群行：不改绑', async () => {
    const { controller } = await setup()
    await expect(controller.rebindArchivedChatForBind({ chatId: 'oc_none', workSessionId: 'W2' })).resolves.toBeUndefined()
  })
})
