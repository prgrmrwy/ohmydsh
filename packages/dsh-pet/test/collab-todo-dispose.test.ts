/**
 * `pet-locus-intent-triage` — 所有者处置待办经 manager 代为记账.
 * Runs against the REAL dsh-collab plugin and collab-kernel (pitfalls §7).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { locusSpaceId } from '../src/host/collab/naming.js'
import { result } from './support/collab-host.js'
import { eventsAfter, openTodoWorld, type TestLocusRow, type TodoWorld } from './support/collab-todo.js'

const M = 'locus-main-d'
const W = 'work-d'
const ALPHA = { chatId: 'oc-dispose-alpha' }

let todo: TodoWorld | undefined
afterEach(async () => { await todo?.world.stop(); todo = undefined })

const child: TestLocusRow = {
  id: 'rec-alpha-g1', generation: 1, endpoint: ALPHA, locusMainSessionId: M, childSessionId: 'child-d', state: 'active',
}

async function ready() {
  todo = await openTodoWorld()
  await todo.addMain({ locusMainSessionId: M, workSessionId: W })
  todo.addLocus(child)
  return todo
}

describe('所有者处置待办经 manager 代为记账', () => {
  it('所有者直接了结', async () => {
    const t = await ready()
    expect((await t.register('rec-alpha-g1', { summary: '直接了结', detail: '' }, 'todo-direct')).ok).toBe(true)
    const before = (await t.records(M)).at(-1).seq
    const followups = t.world.counts.followup

    const record = await t.backend.advanceStatus('todo-direct', 'done', 1)

    expect(record.status).toBe('done')
    const records = await t.records(M)
    expect(eventsAfter(records, before)).toEqual(['request/progressed'])
    expect(records.at(-1).events[0]).toMatchObject({ type: 'request/progressed', actor: 'manager:pet-locus', itemId: 'todo-direct', progress: 'done' })
    expect(t.world.counts.followup).toBe(followups)
  })

  it('工作主会话自行完成', async () => {
    const t = await ready()
    expect((await t.register('rec-alpha-g1', { summary: '主会话自行完成', detail: '' }, 'todo-self')).ok).toBe(true)
    const work = t.world.live.get(W)
    const spaceId = locusSpaceId(M)
    expect(result(await t.world.call(work, 'collab_advance_request', { spaceId, cmdId: 'self-accept', itemId: 'todo-self', progress: 'accepted' }))).not.toHaveProperty('error')
    expect((await t.backend.getTodoItem('todo-self'))?.status).toBe('accepted')
    let childTurns = 0
    t.world.live.get('child-d')!.followup = () => { childTurns += 1 }

    expect(result(await t.world.call(work, 'collab_advance_request', { spaceId, cmdId: 'self-done', itemId: 'todo-self', progress: 'done' }))).not.toHaveProperty('error')

    const after = await t.backend.getTodoItem('todo-self')
    expect(after?.status).toBe('done')
    expect(after?.statusChangedAt).toBeGreaterThanOrEqual(after!.createdAt)
    expect(childTurns).toBe(0)
  })
})
