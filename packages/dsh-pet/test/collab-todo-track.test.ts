/**
 * `pet-locus-intent-triage` → "待办登记固定来源与回复去向且关联标识而非实例"
 * (track-01..06) on the collab `TodoBackend`, over the REAL dsh-collab plugin.
 * The retained `spec: 无唯一 current 时拒绝登记` stays in ledger-track.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackTodo } from '../src/host/ledger/track.js'
import { locusSpaceId } from '../src/host/collab/naming.js'
import { authorizedFor, eventsAfter, identityOf, openTodoWorld, readOverview, type TodoWorld } from './support/collab-todo.js'
import { result } from './support/collab-host.js'

const MAIN = 'session-main-track'
const ALPHA = { chatId: 'oc-track-alpha' }
const SPACE = locusSpaceId(MAIN)

let todo: TodoWorld | undefined
afterEach(async () => { await todo?.world.stop(); todo = undefined })

const gen = (generation: number, child: string, state = 'active') =>
  ({ id: `rec-alpha-g${generation}`, generation, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: child, state })

async function ready() {
  todo = await openTodoWorld()
  todo.addLocus(gen(2, 'child-g2'))
  await todo.loadMain(MAIN)
  return todo
}

describe('待办登记固定来源与回复去向且关联标识而非实例（collab）', () => {
  it('track-01：工具不接受目标参数', async () => {
    const t = await ready()
    // The Host derives every fact from the authorized Delivery; a model-supplied
    // target never reaches the input `trackTodo` builds.
    const forged = { summary: 's', detail: 'd', chatId: 'oc-evil', messageId: 'om-evil', locusId: 'locus-evil' } as never
    const registered = await trackTodo(authorizedFor(t.loci[0]!), forged, {
      store: t.backend, now: () => 1_000, newItemId: () => 'todo-t1',
    })
    expect(registered.ok).toBe(true)
    const item = (await readOverview(t.world, t.world.live.get(MAIN), MAIN)).items['todo-t1']
    expect(JSON.stringify(item)).not.toMatch(/oc-evil|om-evil|locus-evil/)
    expect(item.ext.pet).toMatchObject({ locusId: identityOf(ALPHA), endpoint: ALPHA, triggerMessageId: 'om-rec-alpha-g2' })
  })

  it('track-02：代际更替后待办仍可解析', async () => {
    const t = await ready()
    expect((await t.register('rec-alpha-g2', { summary: '第 2 代', detail: '' }, 'todo-g2')).ok).toBe(true)
    t.updateLocus('rec-alpha-g2', { state: 'retired' })
    t.addLocus(gen(3, 'child-g3'))

    const record = await t.backend.getTodoItem('todo-g2')
    expect(record).toMatchObject({ itemId: 'todo-g2', parentSessionId: MAIN, generation: 2, endpoint: ALPHA, status: 'open' })
    // The ext keeps the identity and the registering generation as audit facts.
    const item = (await readOverview(t.world, t.world.live.get(MAIN), MAIN)).items['todo-g2']
    expect(item.ext.pet).toMatchObject({ locusId: identityOf(ALPHA), generation: 2, recordId: 'rec-alpha-g2' })
  })

  it('track-03：入口退役不使待办消失', async () => {
    const t = await ready()
    expect((await t.register('rec-alpha-g2', { summary: '退役前登记', detail: '' }, 'todo-r')).ok).toBe(true)
    t.updateLocus('rec-alpha-g2', { state: 'retired' })
    t.world.unload('child-g2')

    expect((await t.backend.listForParent(MAIN)).map(record => record.itemId)).toEqual(['todo-r'])
    // Still disposable by the owner.
    expect((await t.backend.advanceStatus('todo-r', 'dropped', 2_000)).status).toBe('dropped')
  })

  it('track-04：登记不唤醒主会话', async () => {
    const t = await ready()
    const before = (await t.records(MAIN)).at(-1).seq
    expect((await t.register('rec-alpha-g2', { summary: '不唤醒', detail: '' }, 'todo-w')).ok).toBe(true)
    const records = await t.records(MAIN)
    expect(eventsAfter(records, before)).toEqual(['item/created'])
    const item = records.at(-1).events[0].item
    expect(item).toMatchObject({ kind: 'request', author: 'pet', assignee: 'main', requiredAcks: [], ext: { pet: { locusId: identityOf(ALPHA) } } })
    expect(t.world.counts.followup).toBe(0)
  })

  it('track-05：主会话修订条目不改变登记证据', async () => {
    const t = await ready()
    expect((await t.register('rec-alpha-g2', { summary: '错误位于 A', detail: '栈在 a.ts' }, 'todo-e')).ok).toBe(true)
    const main = t.world.live.get(MAIN)
    const revised = result(await t.world.call(main, 'collab_revise_item', {
      spaceId: SPACE, cmdId: 'rev-1', itemId: 'todo-e', expectedRevision: 1, changes: { title: '已修复', body: '{"summary":"已修复","detail":""}' },
    }))
    expect(revised.error).toBeUndefined()
    const record = await t.backend.getTodoItem('todo-e')
    expect(record?.evidence).toEqual({ summary: '错误位于 A', detail: '栈在 a.ts' })
  })

  it('track-06：时间在重启后保持不变', async () => {
    // One fake clock drives both Pet and the kernel's commit times.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(1_000)
      const t = await ready()
      expect((await trackTodo(authorizedFor(t.loci[0]!), { summary: 's', detail: '' }, { store: t.backend, now: () => Date.now(), newItemId: () => 'todo-time' })).ok).toBe(true)
      vi.setSystemTime(5_000)
      await t.backend.advanceStatus('todo-time', 'accepted', Date.now())
      vi.setSystemTime(9_000)
      // A retried acceptance does not move the recorded time.
      await expect(t.backend.advanceStatus('todo-time', 'accepted', Date.now())).rejects.toBeDefined()

      const restarted = await t.restartPet()
      const record = await restarted.backend.getTodoItem('todo-time')
      expect(record).toMatchObject({ createdAt: 1_000, statusChangedAt: 5_000, status: 'accepted' })
    } finally {
      vi.useRealTimers()
    }
  })
})
