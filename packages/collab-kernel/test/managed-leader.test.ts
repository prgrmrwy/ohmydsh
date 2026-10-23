import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { member, rejectsCleanly } from './support/world.js'
import { managed, managedWorld } from './support/managed-world.js'
import { MemStore } from './support/mem-store.js'

it('managed-leader-01：Leader 离开时跳过托管成员', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: [member('aily', 'a:1'), managed('locus-a', 'loc:a', 2), member('doubao', 'a:2', 'agent', 'active', 3)] })
  const left = await w.service.leave(w.ctx())
  expect(w.events(left.seq)).toContainEqual({ type: 'leader/changed', actor: 'aily', leader: 'doubao' })
  expect((await w.state()).leader).toBe('doubao')
})

it('managed-leader-02：只剩托管成员时关闭', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: [member('aily', 'a:1'), managed('locus-a', 'loc:a', 2), managed('locus-b', 'loc:b', 3), member('doubao', 'a:2', 'agent', 'gone', 4)] })
  const left = await w.service.leave(w.ctx())
  expect(w.events(left.seq).map(e => e.type)).toEqual(['member/status', 'space/closed'])
  expect((await w.state()).status).toBe('closed')
  const ctx = w.at('loc:a', 'after-close')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'locus-b', body: 'x' }), 'COLLAB_SPACE_CLOSED')
})

it('managed-leader-03：不能转交给托管成员', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: [member('aily', 'a:1'), managed('locus-a', 'loc:a', 2)] })
  const ctx = w.ctx('aily', 'transfer')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.transferLeader(ctx, { member: 'locus-a' }), 'COLLAB_FORBIDDEN')
  expect((await w.state()).leader).toBe('aily')
})

it('managed-leader-04：托管成员不能自行离开', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: [member('aily', 'a:1'), managed('locus-a', 'loc:a', 2), managed('locus-i', 'loc:i', 3, 'invited')] })
  const leave = w.at('loc:a', 'leave')
  await rejectsCleanly(w, leave.cmdId, () => w.service.leave(leave), 'COLLAB_FORBIDDEN')
  expect((await w.state()).members['locus-a']!.status).toBe('active')
  // join / declineInvite are refused the same way, even in the invited state.
  const join = w.at('loc:i', 'join')
  await rejectsCleanly(w, join.cmdId, () => w.service.join(join), 'COLLAB_FORBIDDEN')
  const decline = w.at('loc:i', 'decline')
  await rejectsCleanly(w, decline.cmdId, () => w.service.declineInvite(decline), 'COLLAB_FORBIDDEN')
  expect((await w.state()).members['locus-i']!.status).toBe('invited')
})

it('managed-leader-05：Leader 可以标记托管成员离开', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: [member('aily', 'a:1'), managed('locus-a', 'loc:a', 2)] })
  await w.service.markGone(w.ctx(), { member: 'locus-a' })
  expect((await w.state()).members['locus-a']!.status).toBe('gone')
  const rebind = w.mgr('rebind-gone')
  await rejectsCleanly(w, rebind.cmdId, () => w.service.rebindMember(rebind, { member: 'locus-a', address: 'loc:b' }), 'COLLAB_MEMBER_INACTIVE')
  const retire = w.mgr('retire-gone')
  await rejectsCleanly(w, retire.cmdId, () => w.service.retireMember(retire, { member: 'locus-a' }), 'COLLAB_MEMBER_INACTIVE')
  expect((await w.state()).members['locus-a']!.binding.address).toBe('loc:a')
})

it('managed-leader-06：邀请不经托管 provider 认领', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  const ctx = w.ctx('aily', 'invite-loc')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.invite(ctx, { name: 'locus-9', address: 'loc:9', kind: 'agent' }), 'COLLAB_ADDRESS_UNCLAIMED')
  const store = new MemStore()
  const service = new CollabService({ ...w.service.options, store })
  await expect(service.createSpace({ spaceId: 'new', cmdId: 'create-loc', principal: principals.agent({ channel: 'pet-locus', address: 'loc:9' }), guard: () => true }, { name: 'locus-9', address: 'loc:9', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_UNCLAIMED' })
  expect(await store.list()).toEqual([])
  expect(w.P.claims).toEqual([])
  expect(w.Q.claims).toEqual([])
  // Ordinary providers are still asked.
  expect(w.S.claims).toEqual([['loc:9', 'agent'], ['loc:9', 'agent']])
})
