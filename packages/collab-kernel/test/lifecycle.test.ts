import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { world, member, intents } from './support/world.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
it('lifecycle-01：创建者成为Leader', async () => { const store = new MemStore(); const s = new CollabService({ serviceId: 'service', store, providers: [new FakeProvider()] }); const ctx = { spaceId: 'new', cmdId: 'create', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }; await s.createSpace(ctx, { name: 'aily', address: 'a:1', kind: 'agent' }); expect((await s.overview(ctx))).toMatchObject({ leader: 'aily', members: { aily: { status: 'active' } } }); expect((await store.read('new', 0))[0]?.events.map(e => e.type)).toEqual(['space/created', 'member/joined']) })
it('lifecycle-02：Leader直接转交', async () => { const w = await world(); const result = await w.service.transferLeader(w.ctx(), { member: 'doubao' }); expect(await w.service.overview(w.read())).toMatchObject({ leader: 'doubao', members: { aily: { status: 'active' } } }); expect(w.log().find(r => r.seq === result.seq)?.events).toContainEqual({ type: 'leader/changed', actor: 'aily', leader: 'doubao' }) })
it('lifecycle-03：不能转交给非active或自己', async () => { const w = await world(); for (const name of ['bob', 'aily', 'missing']) await expect(w.service.transferLeader(w.ctx(), { member: name })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); await expect(w.service.markGone(w.ctx(), { member: 'aily' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
it('lifecycle-04：离开后自动接手', async () => { const w = await world(); const result = await w.service.leave(w.ctx()); const s = await w.service.overview(w.read('doubao')); expect(s.leader).toBe('doubao'); expect(s.members.aily?.status).toBe('gone'); expect(w.log().find(r => r.seq === result.seq)?.events.filter(e => e.type !== 'dispatch/intended').map(e => e.type)).toEqual(['member/status', 'leader/changed']) })
it('lifecycle-05：无人接手关闭', async () => { const w = await world([], [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'gone')]); await w.service.leave(w.ctx()); const ctx = { spaceId: 's', principal: principals.internal('host-index') }; expect((await w.service.overview(ctx)).status).toBe('closed'); await expect(w.service.setStatus(w.ctx(), { text: 'x' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_CLOSED' }); expect(await w.service.readSince(ctx, 0)).toHaveLength(2); await expect(w.service.overview(w.read())).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }) })
it('lifecycle-06：主动关闭后只读', async () => { const w = await world(); await w.service.closeSpace(w.ctx()); expect((await w.service.overview(w.read())).status).toBe('closed'); expect((await w.service.overview(w.read('doubao'))).status).toBe('closed'); expect(await w.service.readSince({ spaceId: 's', principal: principals.internal('host-index') }, 0)).toHaveLength(2); await expect(w.service.sendMessage(w.ctx('doubao'), { to: 'aily', body: 'x' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_CLOSED' }); await expect(w.service.createSpace(w.ctx(), { name: 'aily', kind: 'agent', address: 'a:1' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_EXISTS' }); expect(w.log()).toHaveLength(2) })
it('lifecycle-07：创建时记录用途', async () => {
  const store = new MemStore(), s = new CollabService({ serviceId: 'service', store, providers: [new FakeProvider()] })
  const ctx = (spaceId: string) => ({ spaceId, cmdId: `create-${spaceId}`, principal: principals.agent({ channel: 'test-a', address: 'a:1' }) })
  const purpose = '仓库 a 与 b 的公共接口'
  await s.createSpace(ctx('space-1'), { name: 'aily', address: 'a:1', kind: 'agent', purpose } as never)
  await s.createSpace(ctx('space-2'), { name: 'aily', address: 'a:1', kind: 'agent' })
  expect((await s.overview(ctx('space-1'))).purpose).toBe(purpose)
  const created = (await store.read('space-2', 0))[0]!.events[0]!
  expect(created.type).toBe('space/created')
  expect(Object.hasOwn(created, 'purpose')).toBe(false)
})
it('lifecycle-08：非法用途被拒', async () => {
  const store = new MemStore(), s = new CollabService({ serviceId: 'service', store, providers: [new FakeProvider()] })
  for (const [i, purpose] of ['', '   ', 'a\nb', 'x'.repeat(201), 42, null].entries()) await expect(s.createSpace({ spaceId: `bad-${i}`, cmdId: `bad-${i}`, principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }, { name: 'aily', address: 'a:1', kind: 'agent', purpose } as never), String(purpose)).rejects.toMatchObject({ code: 'COLLAB_BAD_PURPOSE' })
  expect(await store.list()).toEqual([])
})
it('lifecycle-09：Leader 变化不唤醒', async () => {
  const w = await world([], [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'active', 2)])
  const transfer = await w.service.transferLeader(w.ctx('aily'), { member: 'doubao' })
  const leave = await w.service.leave(w.ctx('doubao'))
  expect((await w.service.overview(w.read())).leader).toBe('aily')
  expect(intents(w.events(transfer.seq))).toEqual([])
  expect(intents(w.events(leave.seq))).toEqual([])
  expect(w.provider.deliveries).toEqual([])
})
