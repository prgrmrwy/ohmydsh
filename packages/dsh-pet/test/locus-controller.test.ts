/**
 * Controller behaviour on v20 rows (spec "换绑与归档按层处理", "Locus 三层实体",
 * "入口建立统一为一条路径"). Runs on owner B's recording Topology fake; the
 * creation / bind / rebind / migrate rows themselves live in
 * locus-dual-creation, locus-rebind and locus-migrate-whole-w.
 */
import { describe, expect, it } from 'vitest'
import { LocusController, LocusControllerError } from '../src/host/locus/controller.js'
import { Refusal, Topology } from './support/w-topology.js'

const make = (options?: ConstructorParameters<typeof Topology>[0]) => {
  const t = new Topology(options)
  return { t, controller: new LocusController(t.deps()) }
}

const fenceOf = (row: { locusId: string; revision: number }) => ({ expectedLocusId: row.locusId, expectedRevision: row.revision })

describe('automatic source', () => {
  it('creates one automatic work session and M per group, in the default workspace', async () => {
    const { t, controller } = make({ defaultWorkspace: 'default-ws' })
    const first = await controller.ensureGroup({ chatId: 'oc_a' })
    const second = await controller.ensureGroup({ chatId: 'oc_b' })
    expect(t.created.filter(c => c.kind === 'work')).toHaveLength(2)
    expect(first.group.workspaceId).toBe('default-ws')
    expect(second.group.locusMainSessionId).not.toBe(first.group.locusMainSessionId)
  })

  it('fails closed when automatic work-session creation has no default workspace', async () => {
    const t = new Topology()
    const deps = t.deps()
    const controller = new LocusController({ ...deps, dsh: { ...deps.dsh, resolveDefaultWorkspace: async () => undefined } })
    await expect(controller.ensureGroup({ chatId: 'oc_a' })).rejects.toMatchObject({ code: 'DEFAULT_WORKSPACE_UNAVAILABLE' })
    expect(t.repository.rows.size).toBe(0)
    expect(t.created).toEqual([])
  })
})

describe('default Q&A', () => {
  it('creates once, then opens the same default group', async () => {
    const { t, controller } = make()
    const first = await controller.createOrOpenDefaultQa({ parentSessionId: 'W1', ownerId: 'ou_1' })
    const again = await controller.createOrOpenDefaultQa({ parentSessionId: 'W1', ownerId: 'ou_1' })
    expect(first).toMatchObject({ created: true, reused: false })
    expect(again).toMatchObject({ created: false, reused: true })
    expect(again.group.locusId).toBe(first.group.locusId)
    expect(first.group.defaultQa).toBe(true)
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
  })

  it('shares the work session\'s M with issue entries of the same W', async () => {
    const { controller } = make()
    const qa = await controller.createOrOpenDefaultQa({ parentSessionId: 'W1', ownerId: 'ou_1' })
    const issue = await controller.ensureGroup({ chatId: 'oc_issue', parentSessionId: 'W1' })
    expect(issue.group.locusMainSessionId).toBe(qa.group.locusMainSessionId)
    expect(issue.group.defaultQa).toBeUndefined()
  })
})

describe('换绑与归档按层处理: stop', () => {
  it('忙时拒绝停止: LOCUS_BUSY, state and revision unchanged; idle then accepted', async () => {
    const { t, controller } = make()
    t.seedMain('W1', 'M1')
    const row = t.seedGroup('oc_1', 'M1', 'proj-1', { state: 'active', revision: 4 })
    t.repository.currentChats.add('oc_1')
    await expect(controller.stopEntry(fenceOf(row))).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    expect(t.repository.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'active', revision: 4 })

    t.repository.currentChats.delete('oc_1')
    const stopped = await controller.stopEntry(fenceOf(row))
    expect(stopped).toMatchObject({ state: 'stopped', revision: 5 })
  })

  it('refuses a stale fence with LOCUS_CONFLICT and an unknown entry with LOCUS_NOT_FOUND', async () => {
    const { t, controller } = make()
    t.seedMain('W1', 'M1')
    const row = t.seedGroup('oc_1', 'M1', 'proj-1', { state: 'active', revision: 4 })
    await expect(controller.stopEntry({ expectedLocusId: row.locusId, expectedRevision: 3 })).rejects.toMatchObject({ code: 'LOCUS_CONFLICT' })
    await expect(controller.stopEntry({ expectedLocusId: 'nope', expectedRevision: 0 })).rejects.toBeInstanceOf(Refusal)
  })

  it('停止群行不连带停止话题行: the topic keeps state, sessionId and revision', async () => {
    const { t, controller } = make()
    t.seedMain('W1', 'M1')
    const group = t.seedGroup('oc_1', 'M1', 'proj-1', { state: 'active', revision: 2 })
    const topic = t.seedTopic('oc_1', 't1', { state: 'active', revision: 7 })
    await controller.stopEntry(fenceOf(group))
    expect(t.repository.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'stopped' })
    expect(t.repository.getRow({ chatId: 'oc_1', threadId: 't1' })).toMatchObject({
      state: 'active', sessionId: topic.sessionId, revision: 7,
    })
  })

  it('a stopped group does not revive on an ordinary @: ensureEntry refuses, rows unchanged', async () => {
    const { t, controller } = make()
    t.seedMain('W1', 'M1')
    t.seedGroup('oc_1', 'M1', 'proj-1', { state: 'stopped', stoppedAt: 5, revision: 3 })
    await expect(controller.ensureEntry({ chatId: 'oc_1' })).rejects.toBeInstanceOf(LocusControllerError)
    expect(t.repository.getRow({ chatId: 'oc_1' })).toMatchObject({ state: 'stopped', revision: 3 })
  })
})

describe('换绑与归档按层处理: child unavailable', () => {
  it('子会话不可用只换该入口一代: A rebuilds in place, B is untouched', async () => {
    const { t, controller } = make()
    t.seedMain('W1', 'M1')
    t.seedGroup('oc_A', 'M1', 'proj-1', { state: 'active', sessionId: 'sess-A', revision: 1 })
    t.seedGroup('oc_B', 'M1', 'proj-1', { state: 'active', sessionId: 'sess-B', revision: 1 })
    const a = t.repository.getRow({ chatId: 'oc_A' })!
    const b = t.repository.getRow({ chatId: 'oc_B' })!
    await t.repository.markInvalid(fenceOf(a), 'child lost', 10)

    const result = await controller.ensureEntry({ chatId: 'oc_A' })
    expect(result.created).toBe(true)
    const rebuilt = t.repository.getRow({ chatId: 'oc_A' })!
    expect(rebuilt).toMatchObject({ state: 'not-created', accessMode: 'read-only', locusId: a.locusId, revision: 3 })
    expect(rebuilt.sessionId).not.toBe('sess-A')
    expect(rebuilt.invalidReason).toBeUndefined()
    expect(t.repository.getRow({ chatId: 'oc_B' })).toEqual(b)
    // No external creation: in-place rebuild is a single row write.
    expect(t.created).toEqual([])
    expect(t.calls.filter(c => c === 'rebuildRowInPlace')).toHaveLength(1)
  })

  it('a healthy active or not-created entry is served as is', async () => {
    const { t, controller } = make()
    t.seedMain('W1', 'M1')
    const active = t.seedGroup('oc_1', 'M1', 'proj-1', { state: 'active', revision: 2 })
    const result = await controller.ensureEntry({ chatId: 'oc_1' })
    expect(result).toMatchObject({ created: false })
    expect(t.repository.getRow({ chatId: 'oc_1' })).toEqual(active)
  })
})

describe('工作主会话归档', () => {
  it('refuses with SOURCE_ARCHIVED and never rewrites the row', async () => {
    const { t, controller } = make({ archived: ['W1'] })
    t.seedMain('W1', 'M1')
    const row = t.seedGroup('oc_1', 'M1', 'proj-1', { state: 'active', revision: 6 })
    await expect(controller.ensureEntry({ chatId: 'oc_1' })).rejects.toMatchObject({ code: 'SOURCE_ARCHIVED' })
    expect(t.repository.getRow({ chatId: 'oc_1' })).toEqual(row)
    expect(t.calls).not.toContain('commitWholeWMigration')
  })
})
