import { expect, it } from 'vitest'
import type { Member } from '../src/index.js'
import { intents, member, rejectsCleanly } from './support/world.js'
import { managedWorld } from './support/managed-world.js'

/** An ordinary `dsh-session` member, as an integrator-owned session would be bound. */
const session = (name: string, address: string, joinSeq: number): Member => ({ ...member(name, address, 'agent', 'active', joinSeq), binding: { channel: 'dsh-session', address, supports: { wake: true, confirm: false } } })

it('处置接入方拥有的普通会话登记的 request', async () => {
  const w = await managedWorld({ members: [member('aily', 'a:1'), session('locus', 'M', 2), session('work', 'W', 3)], allowed: ['pet-locus'] })
  for (const [id, author] of [['todo-2', 'locus'], ['todo-3', 'work']] as const) {
    await w.service.createItem(w.at(author === 'locus' ? 'M' : 'W', `mk-${id}`, 'dsh-session', null), { itemId: id, kind: 'request', assignee: 'aily', title: id, body: '', requiredAcks: [] })
  }
  await w.settle()
  const owned = (address: string) => address === 'M'
  const ok = await w.service.disposeManagedRequest({ ...w.mgr('own-1'), authorOwned: owned }, { itemId: 'todo-2', progress: 'done' })
  await w.settle()
  const item = (await w.state()).items['todo-2']!
  expect(item.kind === 'request' && item.progress).toBe('done')
  expect(w.events(ok.seq)).toEqual([{ type: 'request/progressed', actor: 'manager:pet-locus', itemId: 'todo-2', progress: 'done' }])
  expect(intents(w.events(ok.seq))).toEqual([])
  const ctx = { ...w.mgr('own-2'), authorOwned: owned }
  await rejectsCleanly(w, ctx.cmdId, () => w.service.disposeManagedRequest(ctx, { itemId: 'todo-3', progress: 'done' }), 'COLLAB_FORBIDDEN')
  // No authorOwned supplied (or a throwing one) counts as false.
  for (const [cmd, extra] of [['own-3', {}], ['own-4', { authorOwned: () => { throw new Error('x') } }]] as const) {
    const c = { ...w.mgr(cmd), ...extra }
    await rejectsCleanly(w, c.cmdId, () => w.service.disposeManagedRequest(c, { itemId: 'todo-3', progress: 'done' }), 'COLLAB_FORBIDDEN')
  }
})
