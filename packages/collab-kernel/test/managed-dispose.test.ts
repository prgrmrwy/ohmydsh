import { expect, it } from 'vitest'
import type { CollabEvent, Item } from '../src/index.js'
import { intents, member, rejectsCleanly } from './support/world.js'
import { managed, managedWorld } from './support/managed-world.js'

/** Leader `aily`, the user's main session `main`, and the integrator-managed `pet`. */
const members = () => [member('aily', 'a:1'), member('main', 'a:2', 'agent', 'active', 2), managed('pet', 'loc:pet', 3)]
const request = (id: string, author: string, extra: Partial<Item> = {}): Item => ({ id, kind: 'request', assignee: 'main', progress: 'open', author, title: id, body: '', revision: 1, status: 'draft', requiredAcks: [], acks: {}, ...extra } as Item)

/** A world where `pet` has just registered `todo-1` through its own (managed) principal. */
async function withTodo(itemId = 'todo-1', opts: { allowed?: string[]; extra?: CollabEvent[] } = { allowed: ['pet-locus'] }) {
  const w = await managedWorld({ members: members(), ...opts })
  await w.service.createItem(w.at('loc:pet'), { itemId, kind: 'request', assignee: 'main', title: itemId, body: 'todo', requiredAcks: [] })
  await w.settle()
  return w
}

it('dispose-01：代人受理不唤醒', async () => {
  const w = await withTodo()
  const first = await w.service.disposeManagedRequest(w.mgr('acc-1'), { itemId: 'todo-1', progress: 'accepted' })
  await w.settle()
  const length = w.log().length
  const second = await w.service.disposeManagedRequest(w.mgr('acc-1'), { itemId: 'todo-1', progress: 'accepted' })
  await w.settle()
  expect(second).toEqual(first)
  expect(w.log()).toHaveLength(length)
  const item = (await w.state()).items['todo-1']!
  expect(item.kind === 'request' && item.progress).toBe('accepted')
  expect(w.events(first.seq)).toEqual([{ type: 'request/progressed', actor: 'manager:pet-locus', itemId: 'todo-1', progress: 'accepted' }])
  expect(intents(w.events(first.seq))).toEqual([])
  const record = w.log().find(r => r.seq === first.seq)!
  expect(record.kind === 'command' && record.receipt.scope).toEqual({ kind: 'manager', channel: 'pet-locus' })
  // Not counted in any topic, and nobody was woken.
  expect((await w.state()).topicWakes).toEqual({})
  expect(w.provider.deliveries).toEqual([])
  expect(w.P.deliveries).toEqual([])
})

it('dispose-02：不经受理直接完成', async () => {
  const w = await withTodo()
  const done = await w.service.disposeManagedRequest(w.mgr('done-1'), { itemId: 'todo-1', progress: 'done' })
  await w.settle()
  const item = (await w.state()).items['todo-1']!
  expect(item.kind === 'request' && item.progress).toBe('done')
  expect(intents(w.events(done.seq))).toEqual([])
  const ctx = w.ctx('main', 'main-reject')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.advanceRequest(ctx, { itemId: 'todo-1', progress: 'rejected' }), 'COLLAB_BAD_TRANSITION')
})

it('dispose-03：不能处置非托管成员的 request', async () => {
  const w = await managedWorld({ members: members(), allowed: ['pet-locus'] })
  await w.service.createItem(w.ctx('main'), { itemId: 'r-2', kind: 'request', assignee: 'main', title: 'r-2', body: '', requiredAcks: [] })
  const ctx = w.mgr('dispose-r2')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.disposeManagedRequest(ctx, { itemId: 'r-2', progress: 'done' }), 'COLLAB_FORBIDDEN')
  const item = (await w.state()).items['r-2']!
  expect(item.kind === 'request' && item.progress).toBe('open')
})

it('dispose-04：作者退役后仍可处置', async () => {
  const w = await withTodo('todo-3')
  await w.service.retireMember(w.mgr('retire-pet'), { member: 'pet' })
  expect((await w.state()).members.pet!.status).toBe('gone')
  const rejected = await w.service.disposeManagedRequest(w.mgr('rej-3'), { itemId: 'todo-3', progress: 'rejected' })
  await w.settle()
  const item = (await w.state()).items['todo-3']!
  expect(item.kind === 'request' && item.progress).toBe('rejected')
  expect(intents(w.events(rejected.seq))).toEqual([])
  expect(w.provider.deliveries).toEqual([])
})

it('dispose-05：未授权空间不可区分', async () => {
  // T: the integrator was never granted; S4: granted then revoked; closed: never granted and closed.
  const seeded: CollabEvent[] = [{ type: 'item/created', actor: 'pet', item: request('todo-1', 'pet') }]
  const t = await managedWorld({ members: members(), extra: seeded })
  const revoked = await managedWorld({ members: members(), allowed: ['pet-locus'], extra: seeded })
  await revoked.service.revokeManager(revoked.ctx('aily', 'revoke'), { channel: 'pet-locus' })
  const closed = await managedWorld({ members: members(), extra: [...seeded, { type: 'space/closed', actor: 'aily' }] })
  for (const [label, w] of [['T', t], ['revoked', revoked], ['closed', closed]] as const) {
    for (const itemId of ['todo-1', 'missing']) {
      const ctx = w.mgr(`dispose-${label}-${itemId}`)
      await rejectsCleanly(w, ctx.cmdId, () => w.service.disposeManagedRequest(ctx, { itemId, progress: 'done' }), 'COLLAB_NOT_MEMBER', `${label}/${itemId}`)
    }
    // The same class of error an unauthorized admitMember gets.
    const admit = w.mgr(`admit-${label}`)
    await rejectsCleanly(w, admit.cmdId, () => w.service.admitMember(admit, { name: 'locus-x', address: 'loc:x' }), 'COLLAB_NOT_MEMBER', label)
  }
  const item = (await t.state()).items['todo-1']!
  expect(item.kind === 'request' && item.progress).toBe('open')
})

it('disposeManagedRequest 的业务校验', async () => {
  const seeded: CollabEvent[] = [
    { type: 'item/created', actor: 'pet', item: request('esc', 'pet', { status: 'escalated' }) },
    { type: 'item/created', actor: 'pet', item: request('dec', 'pet', { status: 'decided' }) },
    { type: 'item/created', actor: 'pet', item: { id: 'note', kind: 'other', author: 'pet', title: 'note', body: '', revision: 1, status: 'draft', requiredAcks: [], acks: {} } },
    { type: 'item/created', actor: 'pet', item: request('acc', 'pet', { progress: 'accepted' }) },
    { type: 'item/created', actor: 'pet', item: request('fin', 'pet', { progress: 'done' }) },
    { type: 'item/created', actor: 'pet', item: request('rej', 'pet', { progress: 'rejected' }) },
    { type: 'item/created', actor: 'pet', item: request('opn', 'pet') },
  ]
  // Another integrator's managed member authored `oth-r`.
  const all = [...members(), managed('other', 'oth:1', 4, 'active', 'other-loc')]
  seeded.push({ type: 'item/created', actor: 'other', item: request('oth-r', 'other') })
  const w = await managedWorld({ members: all, allowed: ['pet-locus', 'other-loc'], extra: seeded })
  const cases: [string, string, 'open' | 'accepted' | 'done' | 'rejected'][] = [
    ['missing', 'COLLAB_ITEM_NOT_FOUND', 'done'],
    ['note', 'COLLAB_FORBIDDEN', 'done'],
    ['oth-r', 'COLLAB_FORBIDDEN', 'done'],
    ['esc', 'COLLAB_ITEM_ESCALATED', 'accepted'],
    ['dec', 'COLLAB_DECIDED_LOCKED', 'accepted'],
    ['opn', 'COLLAB_BAD_TRANSITION', 'open'],
    ['acc', 'COLLAB_BAD_TRANSITION', 'accepted'],
    ['acc', 'COLLAB_BAD_TRANSITION', 'open'],
    ['fin', 'COLLAB_BAD_TRANSITION', 'rejected'],
    ['rej', 'COLLAB_BAD_TRANSITION', 'done'],
    ['opn', 'COLLAB_BAD_TRANSITION', 'bogus' as never],
  ]
  for (const [itemId, code, progress] of cases) {
    const ctx = w.mgr(`biz-${itemId}-${progress}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.disposeManagedRequest(ctx, { itemId, progress }), code, `${itemId}→${progress}`)
  }
  // accepted → done and accepted → rejected are both allowed.
  await expect(w.service.disposeManagedRequest(w.mgr('acc-done'), { itemId: 'acc', progress: 'done' })).resolves.toBeDefined()
  // The other integrator may dispose its own member's request.
  await expect(w.service.disposeManagedRequest(w.mgr('oth-done', 'QL'), { itemId: 'oth-r', progress: 'rejected' })).resolves.toBeDefined()
  // A member principal (even the assignee) cannot use the manager command.
  const asMain = { ...w.ctx('main', 'as-main'), guard: () => true }
  await rejectsCleanly(w, asMain.cmdId, () => w.service.disposeManagedRequest(asMain, { itemId: 'opn', progress: 'done' }), 'COLLAB_FORBIDDEN')
  // A non-managed provider cannot act as manager.
  const asS = w.mgr('as-s', 'S')
  await rejectsCleanly(w, asS.cmdId, () => w.service.disposeManagedRequest(asS, { itemId: 'opn', progress: 'done' }), 'COLLAB_FORBIDDEN')
  // The manager command never claims an address.
  expect(w.P.claims).toEqual([])
})
