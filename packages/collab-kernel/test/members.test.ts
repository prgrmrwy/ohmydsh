import { createHash } from 'node:crypto'
import { canonical } from '../src/service/index.js'
import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { defaultMembers, member, rawCommand, rejectsCleanly, seedRecord, world, worldFrom } from './support/world.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
it('members-01：唯一认领后加入', async () => { const w = await world(); await w.service.invite(w.ctx(), { name: 'alice', address: 'a:42', kind: 'agent' }); const ctx = { spaceId: 's', principal: principals.agent({ channel: 'test-a', address: 'a:42' }), cmdId: 'join' }; await w.service.join(ctx); expect((await w.service.overview(w.read())).members.alice).toMatchObject({ status: 'active', binding: { channel: 'test-a', address: 'a:42' } }); expect(w.provider.claims).toContainEqual(['a:42', 'agent']) })
it('members-02：无人认领', async () => { const w = await world(); await expect(w.service.invite(w.ctx(), { name: 'alice', address: 'zzz', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_UNCLAIMED' }); expect(w.log()).toHaveLength(1) })
it('members-03：多个认领', async () => { const w = await world(); w.service.options.providers.push(new FakeProvider('P2', 'test-b')); await expect(w.service.invite(w.ctx(), { name: 'alice', address: 'a:42', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_AMBIGUOUS', details: { candidates: ['test-a', 'test-b'] } }) })
it('members-04：不能新增人类成员', async () => {
  const w = await world()
  const ctx = w.ctx('aily', 'invite-human')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.invite(ctx, { name: 'alice', address: 'a:5', kind: 'human' }), 'COLLAB_BAD_KIND')
  const store = new MemStore(), provider = new FakeProvider(), service = new CollabService({ serviceId: 'x', store, providers: [provider] })
  await expect(service.createSpace({ spaceId: 'new', cmdId: 'create-human', principal: principals.provider('P1', { channel: 'test-a', address: 'a:7' }) }, { name: 'pm', address: 'a:7', kind: 'human' })).rejects.toMatchObject({ code: 'COLLAB_BAD_KIND' })
  expect(await store.list()).toEqual([])
})
it('members-08：旧日志中的人类成员按普通成员重放', async () => {
  const pm = member('pm', 'a:pm', 'human', 'active', 3)
  const members = [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'active', 2), pm]
  const invite = { name: 'pm', address: 'a:pm', kind: 'human' as const }
  const original = { seq: 2, spaceId: 's' }
  const w = await worldFrom([
    seedRecord(members.slice(0, 2)),
    rawCommand(2, [{ type: 'member/invited', actor: 'aily', member: { ...pm, status: 'invited', joinSeq: 0 } }], { cmdId: 'inv-pm', payloadHash: createHash('sha256').update(canonical({ name: 'invite', input: invite })).digest('hex'), result: original }),
    rawCommand(3, [{ type: 'member/joined', actor: 'pm', member: pm }], { scope: { kind: 'member', name: 'pm' } }),
  ], members)
  await w.service.sendMessage(w.ctx('pm'), { to: 'aily', body: 'hello from history' })
  expect((await w.service.overview(w.read('pm'))).members.pm?.kind).toBe('human')
  const length = w.log().length
  expect(await w.service.invite(w.ctx('aily', 'inv-pm'), invite)).toEqual(original)
  expect(w.log()).toHaveLength(length)
})
it('members-05：地址与名字不能复用包括gone/declined', async () => { const w = await world(); await expect(w.service.invite(w.ctx(), { name: 'alice', address: 'a:9', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_TAKEN' }); await w.service.declineInvite(w.ctx('bob')); await expect(w.service.invite(w.ctx(), { name: 'alice', address: 'a:9', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_TAKEN' }); await expect(w.service.invite(w.ctx(), { name: 'bob', address: 'a:99', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_NAME_TAKEN' })
  // A managed member's retired binding is never reusable either, by invite of the same channel.
  const locus = { ...member('locus-a', 'a:77', 'agent', 'active', 5), managedBy: 'test-a', previousBindings: [{ channel: 'test-a', address: 'a:76' }] }
  const h = await world([], [...defaultMembers(), locus])
  const ctx = h.ctx('aily', 'invite-previous')
  await rejectsCleanly(h, ctx.cmdId, () => h.service.invite(ctx, { name: 'alice', address: 'a:76', kind: 'agent' }), 'COLLAB_ADDRESS_TAKEN')
})
it('members-06：agent不能自称human', async () => { const store = new MemStore(); const service = new CollabService({ serviceId: 'x', store, providers: [new FakeProvider()] }); await expect(service.createSpace({ spaceId: 'new', cmdId: 'create', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }, { name: 'aily', address: 'a:1', kind: 'human' })).rejects.toMatchObject({ code: 'COLLAB_BAD_KIND' }); expect(await store.list()).toEqual([]) })
it('members-07：非法成员名', async () => { const w = await world(); for (const name of ['Bob\n## 决定', '', 'A', 'a'.repeat(33)]) await expect(w.service.invite(w.ctx(), { name, address: 'a:new', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_BAD_NAME' }) })
