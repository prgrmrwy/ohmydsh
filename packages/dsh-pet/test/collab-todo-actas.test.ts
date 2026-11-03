/**
 * `pet-locus-intent-triage` — 待办由 Host 以 locus 主会话身份代写.
 * Runs against the REAL dsh-collab plugin and collab-kernel (pitfalls §7).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { registerPetTools, PET_LOCUS_TRACK_TOOL } from '../src/host/tools.js'
import { trackTodo } from '../src/host/ledger/track.js'
import { authorizedFor, eventsAfter, identityOf, openTodoWorld, type TestLocusRow, type TodoWorld } from './support/collab-todo.js'

const M1 = 'locus-main-1'
const W = 'work-1'
const ALPHA = { chatId: 'oc-actas-alpha' }

let todo: TodoWorld | undefined
afterEach(async () => { await todo?.world.stop(); todo = undefined })

const row = (generation: number, main = M1): TestLocusRow => ({
  id: `rec-alpha-g${generation}`, generation, endpoint: ALPHA, locusMainSessionId: main, childSessionId: `child-g${generation}`, state: 'active',
})

async function ready() {
  todo = await openTodoWorld()
  await todo.addMain({ locusMainSessionId: M1, workSessionId: W })
  todo.addLocus(row(2))
  return todo
}

/** The real `pet_locus_track` definition, authorized as `row`'s current child. */
function trackTool(t: TodoWorld, authorized: () => ReturnType<typeof authorizedFor>) {
  const registered = new Map<string, any>()
  registerPetTools({ tools: { register: (definition: any) => { registered.set(definition.name, definition); return () => {} } } } as never, {
    repository: {} as never,
    intentTriage: {
      loci: { findByChildSessionId: () => [] },
      inspectCurrentCapability: () => ({ ok: true, capability: { deliveryId: authorized().currentDelivery?.deliveryId ?? 'none', executionId: 'x', turnId: 't', source: 'delivery' } }),
      inspectCurrentDeliveryAuthorization: async () => ({ ok: true, locus: authorized() }),
      track: { store: t.backend, now: () => Date.now(), newItemId: () => 'todo-tool' },
    },
  } as never)
  return registered.get(PET_LOCUS_TRACK_TOOL)
}

describe('待办由 Host 以 locus 主会话身份代写', () => {
  it('代写条目的作者与附加数据', async () => {
    const t = await ready()
    const before = (await t.records(M1)).at(-1).seq

    const registered = await t.register('rec-alpha-g2', { summary: '修按钮', detail: '位置与原因' }, 'todo-a')

    expect(registered.ok).toBe(true)
    const records = await t.records(M1)
    expect(eventsAfter(records, before)).toEqual(['item/created'])
    const created = records.at(-1).events[0]
    expect(created.actor).toBe('locus')
    expect(created.item).toMatchObject({
      id: 'todo-a', kind: 'request', author: 'locus', assignee: 'work', requiredAcks: [],
      ext: { pet: { entry: identityOf(ALPHA), generation: 2, endpoint: ALPHA, messageId: 'om-rec-alpha-g2', requester: 'ou_requester' } },
    })
    expect(Object.keys(created.item.ext.pet).sort()).toEqual(['endpoint', 'entry', 'generation', 'messageId', 'requester'])
  })

  it('工具不接受目标参数', async () => {
    const t = await ready()
    const tool = trackTool(t, () => authorizedFor(t.loci[0]!))
    const before = (await t.records(M1)).at(-1).seq

    await expect(tool.execute(
      { summary: 's', detail: 'd', chatId: 'oc-evil', messageId: 'om-evil', locusId: 'locus-evil' },
      { agent: { id: 'child-g2' } },
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    expect(eventsAfter(await t.records(M1), before)).toEqual([])
    await expect(tool.execute({ summary: 's', detail: 'd' }, { agent: { id: 'child-g2' } })).resolves.toEqual({ ok: true })
    expect(JSON.stringify(await t.records(M1))).not.toMatch(/oc-evil|om-evil|locus-evil/)
  })

  it('无唯一 current 时拒绝', async () => {
    const t = await ready()
    const noCurrent = { ...authorizedFor(t.loci[0]!), currentDelivery: undefined }
    const before = (await t.records(M1)).at(-1).seq

    const direct = await trackTodo(noCurrent as never, { summary: 's', detail: 'd' }, { store: t.backend, now: () => 1, newItemId: () => 'todo-none' })
    expect(direct).toEqual({ ok: false, reason: 'no-current-delivery' })

    const tool = trackTool(t, () => noCurrent as never)
    await expect(tool.execute({ summary: 's', detail: 'd' }, { agent: { id: 'child-g2' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(eventsAfter(await t.records(M1), before)).toEqual([])
  })

  it('更换 locus 主会话后待办仍在', async () => {
    const t = await ready()
    expect((await t.register('rec-alpha-g2', { summary: '换主前登记', detail: '' }, 'todo-t')).ok).toBe(true)
    // M1 becomes unavailable (unloaded); Pet builds M2 for the same work session and migrates the entry.
    t.world.unload(M1)
    await t.addMain({ locusMainSessionId: 'locus-main-2', workSessionId: W })
    t.addLocus(row(3, 'locus-main-2'))

    expect((await t.register('rec-alpha-g3', { summary: '换主后登记', detail: '' }, 'todo-u')).ok).toBe(true)

    // Listed under the work session across both spaces, and the old one is still disposable by the owner.
    expect((await t.backend.listForParent(W)).map(record => record.itemId)).toEqual(['todo-t', 'todo-u'])
    expect((await t.backend.getTodoItem('todo-t'))).toMatchObject({ parentSessionId: M1, workSessionId: W })
    expect((await t.backend.advanceStatus('todo-t', 'dropped', 2_000)).status).toBe('dropped')
    expect((await t.records('locus-main-2')).flatMap(record => record.events).some((event: any) => event.item?.id === 'todo-t')).toBe(false)
  })
})
