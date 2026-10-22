import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
import { world } from './support/world.js'

it('a valid member name does not collide with Object.prototype', async () => {
  const w = await world()
  await w.service.invite(w.ctx(), { name: 'constructor', address: 'a:constructor', kind: 'agent' })
  await w.service.join({ spaceId: 's', cmdId: 'join-constructor', principal: principals.agent({ channel: 'test-a', address: 'a:constructor' }) })
  expect((await w.service.overview(w.read())).members.constructor).toMatchObject({ name: 'constructor', status: 'active' })
})

it('an inherited object key is not an existing item', async () => {
  const w = await world()
  await w.service.createItem(w.ctx(), { itemId: 'constructor', kind: 'other', title: 'ordinary item', body: '', requiredAcks: [] })
  expect((await w.service.overview(w.read())).items.constructor).toMatchObject({ id: 'constructor', revision: 1 })
})

it('creation requires a nonempty command id like all other writes', async () => {
  const store = new MemStore()
  const service = new CollabService({ serviceId: 'x', store, providers: [new FakeProvider()] })
  await expect(service.createSpace({ spaceId: 'new', principal: principals.agent({ channel: 'test-a', address: 'a:1' }), cmdId: '' }, { name: 'aily', address: 'a:1', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_BAD_CMD_ID' })
  expect(await store.list()).toEqual([])
})

it('all four reads reject a nonactive member without changing the journal', async () => {
  const w = await world()
  const before = structuredClone(w.log())
  for (const read of [
    () => w.service.overview(w.read('bob')),
    () => w.service.readSince(w.read('bob'), 0),
    () => w.service.project(w.read('bob')),
    () => w.service.readConvention(w.read('bob'), '1'),
  ]) await expect(read()).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' })
  expect(w.log()).toEqual(before)
})

it('returned state and log values cannot mutate authoritative state', async () => {
  const w = await world()
  const state = await w.service.overview(w.read())
  state.members.aily!.status = 'gone'
  state.leader = 'bob'
  const records = await w.service.readSince(w.read(), 0)
  records[0]!.events.splice(0)
  const reread = await w.service.overview(w.read())
  expect(reread.members.aily!.status).toBe('active')
  expect(reread.leader).toBe('aily')
  expect((await w.service.readSince(w.read(), 0))[0]!.events.length).toBeGreaterThan(0)
})
