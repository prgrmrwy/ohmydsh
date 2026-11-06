/**
 * Spec: pet-locus-collaboration "入口建立统一为一条路径" (D4, D5) and the
 * controller halves of "Locus 三层实体" / "新建入口默认只读".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocusController, LocusControllerError } from '../src/host/locus/controller.js'
import { Topology, closeAllTopologies, type TopologyBackend } from './support/w-topology.js'

/** Each scenario runs on the recording fake AND on the real LocusRepositoryV20 over temp SQLite. */
let backend: TopologyBackend = 'fake'
const BACKENDS: readonly TopologyBackend[] = ['fake', 'real']
afterEach(closeAllTopologies)

const make = async (options?: ConstructorParameters<typeof Topology>[0]) => {
  const t = await Topology.open(options, backend)
  return { t, controller: new LocusController(t.deps()) }
}

describe.each(BACKENDS)('入口建立统一为一条路径 [%s]', which => {
  beforeEach(() => { backend = which })

  it('auto 建立: group row alone under a fresh auto W and M, read-only, not-created', async () => {
    const { t, controller } = await make()
    const result = await controller.ensureGroup({ chatId: 'oc_1' })
    expect(t.created.map(c => c.kind)).toEqual(['work', 'locus-main'])
    expect(result.group.state).toBe('not-created')
    expect(result.group.accessMode).toBe('read-only')
    expect(result.group.revision).toBe(0)
    expect(t.rowCount()).toBe(1)
    expect(t.calls.filter(c => c.startsWith('commit'))).toEqual(['commit:1'])
  })

  it('话题内首次 bind 一次建出群行和话题行: ONE commit, explicit W carried, one M, no auto W', async () => {
    const { t, controller } = await make()
    const result = await controller.ensureTopic({ chatId: 'oc_1', threadId: 't1', parentSessionId: 'W1' })
    expect(t.created.map(c => c.kind)).toEqual(['locus-main'])
    expect(t.calls.filter(c => c.startsWith('commit'))).toEqual(['commit:2'])
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual(['begin:chat'])
    expect(result.groupCreated).toBe(true)
    const group = t.repository.getRow({ chatId: 'oc_1' })!
    expect('locusMainSessionId' in group && t.repository.findMain(group.locusMainSessionId)!.workSessionId).toBe('W1')
    expect(t.repository.getRow({ chatId: 'oc_1', threadId: 't1' })).toBeDefined()
    expect(t.mainIds()).toHaveLength(1)
  })

  it('话题首次 at 同样补出群行: auto W, a single commit of two rows', async () => {
    const { t, controller } = await make()
    await controller.ensureTopic({ chatId: 'oc_1', threadId: 't1' })
    expect(t.created.map(c => c.kind)).toEqual(['work', 'locus-main'])
    expect(t.calls.filter(c => c.startsWith('commit'))).toEqual(['commit:2'])
  })

  it('群已存在时话题追加不触碰外部: addTopicRow only, no provisioning, no Host creation', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M-existing')
    await t.seedGroup('oc_1', 'M-existing')
    t.calls.length = 0
    const result = await controller.ensureTopic({ chatId: 'oc_1', threadId: 't1' })
    expect(t.calls).toEqual(['addTopicRow'])
    expect(t.created).toEqual([])
    expect(result.created).toBe(true)
    expect(result.groupCreated).toBe(false)
  })

  it('绑定到已有工作主会话复用 locus 主会话', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M-existing')
    await controller.ensureGroup({ chatId: 'oc_2', parentSessionId: 'W1' })
    expect(t.created).toEqual([])
    expect(t.spacesEstablished).toEqual([])
    const group = t.repository.getRow({ chatId: 'oc_2' })!
    expect('locusMainSessionId' in group && group.locusMainSessionId).toBe('M-existing')
  })

  it('跨 W 的 bind 被拒绝且不触碰 Host: from a topic and from the group itself', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M1x')
    await t.seedGroup('oc_1', 'M1x')
    t.calls.length = 0
    for (const attempt of [
      () => controller.ensureTopic({ chatId: 'oc_1', threadId: 't1', parentSessionId: 'W2' }),
      () => controller.ensureGroup({ chatId: 'oc_1', parentSessionId: 'W2' }),
    ]) {
      const error = await attempt().then(() => undefined, e => e as LocusControllerError)
      expect(error?.code).toBe('EXPLICIT_PARENT_CONFLICT')
      expect(error?.message).toContain('改绑到其他会话')
      expect(error?.message).not.toContain('请先解除')
    }
    // Refused before resolveMainParent: the Host was never asked about W2.
    expect(t.resolved).not.toContain('W2')
    expect(t.created).toEqual([])
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual([])
  })

  it('同一 W 的 bind 幂等', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M1x')
    await t.seedGroup('oc_1', 'M1x')
    t.calls.length = 0
    const result = await controller.ensureGroup({ chatId: 'oc_1', parentSessionId: 'W1' })
    expect(result.reused).toBe(true)
    expect(result.created).toBe(false)
    expect(t.created).toEqual([])
    expect(t.calls.some(c => c.startsWith('commit') || c === 'addTopicRow')).toBe(false)
  })

  it('同群两个话题同时首次 at: one group row, one M, one space, two topics', async () => {
    const { t, controller } = await make()
    await Promise.all([
      controller.ensureTopic({ chatId: 'oc_1', threadId: 't1' }),
      controller.ensureTopic({ chatId: 'oc_1', threadId: 't2' }),
    ])
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    expect(t.created.filter(c => c.kind === 'work')).toHaveLength(1)
    expect(t.spacesEstablished).toHaveLength(1)
    expect(t.repository.listRowsOfChat('oc_1')).toHaveLength(3)
  })

  it('话题 bind 与群首次 at 同时到达（bind 先获得群锁）: group lands on the bound W', async () => {
    const { t, controller } = await make()
    const bind = controller.ensureTopic({ chatId: 'oc_1', threadId: 't1', parentSessionId: 'W1' })
    const at = controller.ensureGroup({ chatId: 'oc_1' })
    await Promise.all([bind, at])
    const group = t.repository.getRow({ chatId: 'oc_1' })!
    expect('locusMainSessionId' in group && t.repository.findMain(group.locusMainSessionId)!.workSessionId).toBe('W1')
    expect(t.created.filter(c => c.kind === 'work')).toEqual([])
    expect(t.mainCount()).toBe(1)
  })

  it('群首次 at 先于话题 bind 到达: later bind to another W is refused', async () => {
    const { t, controller } = await make()
    const at = controller.ensureGroup({ chatId: 'oc_1' })
    const bind = controller.ensureTopic({ chatId: 'oc_1', threadId: 't1', parentSessionId: 'W2' })
    await at
    const error = await bind.then(() => undefined, e => e as LocusControllerError)
    expect(error?.code).toBe('EXPLICIT_PARENT_CONFLICT')
    expect(t.mainCount()).toBe(1)
  })

  it('同一 W 的 Q&A 与首次 bind 并发: one M and one space', async () => {
    const { t, controller } = await make()
    await Promise.all([
      controller.createOrOpenDefaultQa({ parentSessionId: 'W1', ownerId: 'ou_1' }),
      controller.ensureGroup({ chatId: 'oc_9', parentSessionId: 'W1' }),
    ])
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    expect(t.spacesEstablished).toHaveLength(1)
    expect(t.mainCount()).toBe(1)
  })

  it('Q&A 只建群行并带 defaultQa 标记', async () => {
    const { t, controller } = await make()
    const result = await controller.createOrOpenDefaultQa({ parentSessionId: 'W1', ownerId: 'ou_1' })
    expect(result.group.defaultQa).toBe(true)
    expect(t.rowCount()).toBe(1)
  })

  it('提交前失败只补偿本操作的资源 (incl. the collab space)', async () => {
    const { t, controller } = await make()
    t.failCommit = true
    await expect(controller.ensureTopic({ chatId: 'oc_1', threadId: 't1' })).rejects.toBeInstanceOf(LocusControllerError)
    expect(t.released.sort()).toEqual(t.created.map(c => c.id).sort())
    expect(t.spacesReleased).toEqual(t.created.filter(c => c.kind === 'locus-main').map(c => c.id))
    expect(t.rowCount()).toBe(0)
    expect(t.opStates()).toEqual(['failed'])
  })

  it('提交前失败不触碰复用的 M 及其空间', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M-existing')
    t.failCommit = true
    await expect(controller.ensureGroup({ chatId: 'oc_2', parentSessionId: 'W1' })).rejects.toBeInstanceOf(LocusControllerError)
    expect(t.released).toEqual([])
    expect(t.spacesReleased).toEqual([])
  })

  it('建立失败不留半成品: space failure releases M, space and auto W; nothing published', async () => {
    const { t, controller } = await make()
    t.failSpace = true
    await expect(controller.ensureGroup({ chatId: 'oc_1' })).rejects.toBeInstanceOf(LocusControllerError)
    expect(t.rowCount()).toBe(0)
    expect(t.mainCount()).toBe(0)
    expect(t.released).toHaveLength(2)
    expect(t.spacesReleased).toHaveLength(1)
  })

  it('提交后 finalize 失败走已提交操作恢复: nothing released, committed op kept', async () => {
    const { t } = await make()
    const deps = t.deps()
    const failing = {
      ...deps,
      dsh: {
        ...deps.dsh,
        createLocusMainSession: async (input: Parameters<typeof deps.dsh.createLocusMainSession>[0]) => {
          const created = await deps.dsh.createLocusMainSession(input)
          return { ...created, commit: async () => { throw new Error('finalize failed') } }
        },
      },
    }
    const controller = new LocusController(failing)
    await expect(controller.ensureGroup({ chatId: 'oc_1' })).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' })
    expect(t.rowCount()).toBe(1)
    expect(t.released).toEqual([])
    expect(t.spacesReleased).toEqual([])
    expect(t.opStates()).toEqual(['committed'])
  })

  it('新建入口默认只读', async () => {
    const { t, controller } = await make()
    await controller.ensureTopic({ chatId: 'oc_1', threadId: 't1' })
    for (const row of t.rows()) {
      expect(row.accessMode).toBe('read-only')
      expect(row.state).toBe('not-created')
    }
  })

  it('同一工作主会话服务多个入口: two groups and a topic of one W share ONE M, ONE space; the topic stores no M', async () => {
    const { t, controller } = await make()
    await controller.ensureGroup({ chatId: 'oc_1', parentSessionId: 'W1' })
    await controller.ensureGroup({ chatId: 'oc_2', parentSessionId: 'W1' })
    await controller.ensureTopic({ chatId: 'oc_1', threadId: 't1', parentSessionId: 'W1' })
    expect(t.mainCount()).toBe(1)
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    expect(t.spacesEstablished).toHaveLength(1)
    const m = t.mainIds()[0]
    const groups = t.repository.listGroupRowsOfMain(m!)
    expect(groups.map(g => g.endpoint.chatId).sort()).toEqual(['oc_1', 'oc_2'])
    const topic = t.repository.getRow({ chatId: 'oc_1', threadId: 't1' })!
    expect(topic).not.toHaveProperty('locusMainSessionId')
    expect(topic).not.toHaveProperty('workspaceId')
    expect(t.repository.findActiveMain('W1')?.locusMainSessionId).toBe(m)
  })

  it('停止的入口重新绑定同一 W: stopped topic re-enabled in place', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M1x')
    await t.seedGroup('oc_1', 'M1x')
    await t.seedTopic('oc_1', 't1', { state: 'stopped', stoppedAt: 5, revision: 3 })
    const result = await controller.ensureTopic({ chatId: 'oc_1', threadId: 't1', parentSessionId: 'W1' })
    expect(result.reenabled).toBe(true)
    const row = t.repository.getRow({ chatId: 'oc_1', threadId: 't1' })!
    expect(row.state).toBe('not-created')
    expect(row.revision).toBe(4)
    expect(row.locusId).toBe('locus-oc_1-t1')
  })

  it('停止的群行只重启群行', async () => {
    const { t, controller } = await make()
    await t.seedMain('W1', 'M1x')
    await t.seedGroup('oc_1', 'M1x', 'proj-1', { state: 'stopped', stoppedAt: 5 })
    await t.seedTopic('oc_1', 't1', { state: 'stopped', stoppedAt: 5 })
    await controller.ensureGroup({ chatId: 'oc_1', parentSessionId: 'W1' })
    expect(t.repository.getRow({ chatId: 'oc_1' })!.state).toBe('not-created')
    expect(t.repository.getRow({ chatId: 'oc_1', threadId: 't1' })!.state).toBe('stopped')
  })
})
