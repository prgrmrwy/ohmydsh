import { expect, it } from 'vitest'
import { CollabService, authorization, principals, type Principal, type Item, type CollabEvent } from '../src/index.js'
import { world, member } from './support/world.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
import { serviceMethods, missingAuthorization } from './support/api-coverage.js'
import { managed, managedWorld } from './support/managed-world.js'
import { defaultMembers } from './support/world.js'
it('auth-01：动作记为 principal 反查到的成员', async () => { const w = await world(); await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hi' }); expect(w.log().at(-1)?.events.find(e => e.type === 'message/sent')?.actor).toBe('aily') })
it('auth-02：首次创建与创建重放', async () => { const store = new MemStore(), service = new CollabService({ serviceId: 'x', store, providers: [new FakeProvider()] }); const ctx = { spaceId: 'new', principal: principals.agent({ channel: 'test-a', address: 'a:1' }), cmdId: 'c-1' }, input = { name: 'aily', address: 'a:1', kind: 'agent' as const }; const first = await service.createSpace(ctx, input); expect(await service.createSpace(ctx, input)).toEqual(first); expect((await store.read('new', 0))).toHaveLength(1) })
it('auth-03：重复创建同一协作空间', async () => { const w = await world(); await expect(w.service.createSpace(w.ctx('doubao'), { name: 'doubao', address: 'a:2', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_EXISTS' }) })
it('auth-04：已移除的 internal purpose 被拒绝', async () => { const w = await world(); const removed = { spaceId: 's', principal: principals.internal('breaker-reset' as never) }; await expect(w.service.overview(removed)).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); await expect(w.service.sendMessage({ ...removed, cmdId: 'removed-purpose' }, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(w.log()).toHaveLength(1) })
it('auth-05：不存在的协作空间先于成员反查报错', async () => { const w = await world(); await expect(w.service.sendMessage({ ...w.ctx(), spaceId: 'missing' }, { to: 'x', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_NOT_FOUND' }) })
it('auth-06：公开命令与授权表一致', () => { const methods = serviceMethods(); expect(Object.keys(authorization).sort()).toEqual(methods); for (const removed of ['requestDecision', 'confirmDecision', 'resetBreaker']) expect(methods).not.toContain(removed); expect(missingAuthorization(Object.keys(authorization), true)).toEqual(['unsafeWrite']) })
it('auth-07：没有按字符串分发的入口', () => { expect(CollabService.prototype).not.toHaveProperty('execute'); expect(CollabService.prototype).not.toHaveProperty('setDeciders'); expect(CollabService.prototype).not.toHaveProperty('recordDispatch'); for (const removed of ['requestDecision', 'confirmDecision', 'resetBreaker']) expect(CollabService.prototype).not.toHaveProperty(removed) })
it('auth-08：非 Leader 邀请被拒', async () => { const w = await world(); await expect(w.service.invite(w.ctx('doubao'), { name: 'new', address: 'a:new', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(w.log()).toHaveLength(1) })
it('auth-09：他人代为加入被拒', async () => { const w = await world(); await expect(w.service.join(w.ctx())).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }); expect((await w.service.overview(w.read())).members.bob?.status).toBe('invited') })
it('auth-10：provider 代表其他 channel 被拒', async () => { const w = await world(); await expect(w.service.sendMessage({ ...w.ctx(), principal: principals.provider('P1', { channel: 'test-b', address: 'a:1' }) }, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
it('auth-12：internal 不能执行成员命令', async () => { const w = await world(); for (const purpose of ['host-index', 'breaker-reset'] as const) await expect(w.service.sendMessage({ ...w.ctx(), principal: principals.internal(purpose as never) }, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(w.log()).toHaveLength(1) })
it('auth-13：gone 成员不能读写', async () => { const w = await world([], [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'gone')]); await expect(w.service.setStatus(w.ctx('doubao'), { text: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }); await expect(w.service.overview(w.read('doubao'))).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }) })
it('全部具名写命令逐项允许与拒绝授权', async () => {
  const item: Item = { id: 'C', kind: 'request', assignee: 'doubao', progress: 'open', author: 'aily', title: 'C', body: '', revision: 1, status: 'draft', requiredAcks: [], acks: {} }
  const seed: CollabEvent[] = [{ type: 'item/created', actor: 'aily', item }]
  type W = Awaited<ReturnType<typeof managedWorld>>
  const checks: { name: keyof typeof authorization; run: (w: W, allowed: boolean) => Promise<unknown> }[] = [
    { name: 'createSpace', run: (w, yes) => w.service.createSpace({ ...w.ctx(), spaceId: 'new', principal: yes ? principals.agent({ channel: 'test-a', address: 'a:1' }) : principals.internal('host-index') }, { name: 'aily', kind: 'agent', address: 'a:1' }) },
    { name: 'invite', run: (w, yes) => w.service.invite(w.ctx(yes ? 'aily' : 'doubao'), { name: 'new', kind: 'agent', address: 'a:new' }) },
    { name: 'join', run: (w, yes) => w.service.join(w.ctx(yes ? 'bob' : 'aily')) },
    { name: 'declineInvite', run: (w, yes) => w.service.declineInvite(w.ctx(yes ? 'bob' : 'aily')) },
    { name: 'leave', run: (w, yes) => w.service.leave(w.ctx(yes ? 'doubao' : 'bob')) },
    { name: 'markGone', run: (w, yes) => w.service.markGone(w.ctx(yes ? 'aily' : 'doubao'), { member: 'qa' }) },
    { name: 'transferLeader', run: (w, yes) => w.service.transferLeader(w.ctx(yes ? 'aily' : 'doubao'), { member: 'qa' }) },
    { name: 'closeSpace', run: (w, yes) => w.service.closeSpace(w.ctx(yes ? 'aily' : 'doubao')) },
    { name: 'createItem', run: (w, yes) => w.service.createItem(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'new', kind: 'other', title: 'new', body: '', requiredAcks: [] }) },
    { name: 'reviseItem', run: (w, yes) => w.service.reviseItem(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'C', expectedRevision: 1, changes: { body: 'x' } }) },
    { name: 'ackItem', run: (w, yes) => w.service.ackItem(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'C', revision: 1 }) },
    { name: 'sendMessage', run: (w, yes) => w.service.sendMessage(w.ctx(yes ? 'aily' : 'bob'), { to: 'doubao', body: 'hi' }) },
    { name: 'setStatus', run: (w, yes) => w.service.setStatus(w.ctx(yes ? 'aily' : 'bob'), { text: 'x' }) },
    { name: 'advanceRequest', run: (w, yes) => w.service.advanceRequest(w.ctx(yes ? 'doubao' : 'aily'), { itemId: 'C', progress: 'accepted' }) },
    { name: 'allowManager', run: (w, yes) => w.service.allowManager(w.ctx(yes ? 'aily' : 'doubao'), { channel: 'other-loc' }) },
    { name: 'revokeManager', run: (w, yes) => w.service.revokeManager(w.ctx(yes ? 'aily' : 'doubao'), { channel: 'pet-locus' }) },
    // Manager commands: allowed for the manager principal, forbidden for the Leader's own agent principal.
    { name: 'admitMember', run: (w, yes) => w.service.admitMember(yes ? w.mgr() : { ...w.ctx('aily'), guard: () => true }, { name: 'locus-b', address: 'loc:b' }) },
    { name: 'rebindMember', run: (w, yes) => w.service.rebindMember(yes ? w.mgr() : { ...w.ctx('aily'), guard: () => true }, { member: 'locus-a', address: 'loc:b' }) },
    { name: 'retireMember', run: (w, yes) => w.service.retireMember(yes ? w.mgr() : { ...w.ctx('aily'), guard: () => true }, { member: 'locus-a' }) },
  ]
  expect(checks.map(c => c.name).sort()).toEqual(Object.keys(authorization).sort())
  const fresh = () => managedWorld({ extra: seed, allowed: ['pet-locus'], members: [...defaultMembers(), managed('locus-a', 'loc:a', 5)] })
  for (const check of checks) { const yes = await fresh(); await expect(check.run(yes, true), check.name).resolves.toBeDefined(); const no = await fresh(); await expect(check.run(no, false), check.name).rejects.toMatchObject({ code: expect.stringMatching(/^COLLAB_(FORBIDDEN|MEMBER_INACTIVE)$/) }); expect(no.log(), check.name).toHaveLength(1) }
})
it('principal必须受信构造', async () => { const w = await world(); await expect(w.service.overview({ spaceId: 's', principal: { kind: 'agent', channel: 'test-a', address: 'a:1' } as Principal })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
const counted = (w: Awaited<ReturnType<typeof world>>) => {
  const calls = { claim: 0, presence: 0, deliver: 0 }
  const p = w.provider
  const claim = p.claim.bind(p), presence = p.presence.bind(p), deliver = p.deliver.bind(p)
  p.claim = async (...a) => { calls.claim++; return claim(...a) }
  p.presence = async (...a) => { calls.presence++; return presence(...a) }
  p.deliver = async (...a) => { calls.deliver++; return deliver(...a) }
  return calls
}
it('auth-14：host-index 可以读取任意空间', async () => { const w = await world(); const before = JSON.stringify(w.log()); const records = await w.service.readSince({ spaceId: 's', principal: principals.internal('host-index') }, 0); expect(records).toEqual(w.log()); expect(JSON.stringify(w.log())).toBe(before) })
it('auth-15：host-index 不能执行任何写命令', async () => {
  const w = await world(), calls = counted(w), before = JSON.stringify(w.log())
  const c = { spaceId: 's', cmdId: 'hi', principal: principals.internal('host-index') }
  const runs: [string, () => Promise<unknown>][] = [
    ['createSpace', () => w.service.createSpace({ ...c, spaceId: 'new' }, { name: 'x', address: 'a:x', kind: 'agent' })],
    ['invite', () => w.service.invite(c, { name: 'x', address: 'a:x', kind: 'agent' })],
    ['join', () => w.service.join(c)], ['declineInvite', () => w.service.declineInvite(c)], ['leave', () => w.service.leave(c)],
    ['markGone', () => w.service.markGone(c, { member: 'doubao' })], ['transferLeader', () => w.service.transferLeader(c, { member: 'doubao' })], ['closeSpace', () => w.service.closeSpace(c)],
    ['createItem', () => w.service.createItem(c, { itemId: 'x', kind: 'other', title: 'x', body: '', requiredAcks: [] })],
    ['reviseItem', () => w.service.reviseItem(c, { itemId: 'x', expectedRevision: 1, changes: {} })], ['ackItem', () => w.service.ackItem(c, { itemId: 'x', revision: 1 })],
    ['sendMessage', () => w.service.sendMessage(c, { to: 'doubao', body: 'hi' })], ['setStatus', () => w.service.setStatus(c, { text: 'x' })],
    ['advanceRequest', () => w.service.advanceRequest(c, { itemId: 'x', progress: 'accepted' })],
    ['allowManager', () => w.service.allowManager(c, { channel: 'pet-locus' })], ['revokeManager', () => w.service.revokeManager(c, { channel: 'pet-locus' })],
    ['admitMember', () => w.service.admitMember({ ...c, guard: () => true }, { name: 'x', address: 'a:x' })], ['rebindMember', () => w.service.rebindMember({ ...c, guard: () => true }, { member: 'doubao', address: 'a:x' })],
    ['retireMember', () => w.service.retireMember({ ...c, guard: () => true }, { member: 'doubao' })],
  ]
  expect(runs.map(r => r[0]).sort()).toEqual(Object.keys(authorization).sort())
  for (const [name, run] of runs) await expect(run(), name).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  expect(JSON.stringify(w.log())).toBe(before)
  expect(calls).toEqual({ claim: 0, presence: 0, deliver: 0 })
  // Ordering: any internal principal is rejected before prepare/presence.
  const reset = { ...c, principal: principals.internal('breaker-reset' as never) }
  await expect(w.service.invite(reset, { name: 'x', address: 'a:x', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.sendMessage(reset, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  expect(calls).toEqual({ claim: 0, presence: 0, deliver: 0 })
})
it('auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN', async () => { const w = await world([{ type: 'space/closed', actor: 'aily' }]), calls = counted(w); await expect(w.service.invite({ spaceId: 's', cmdId: 'x', principal: principals.internal('host-index') }, { name: 'x', address: 'a:x', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); await expect(w.service.invite({ spaceId: 's', cmdId: 'y', principal: principals.internal('breaker-reset' as never) }, { name: 'x', address: 'a:x', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(calls).toEqual({ claim: 0, presence: 0, deliver: 0 }) })
it('auth-17：未知 internal purpose 被拒绝', async () => { const w = await world(); await expect(w.service.overview({ spaceId: 's', principal: principals.internal('other' as never) })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
it('auth-m-01：manager principal 不能执行成员命令或读取', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] }), before = JSON.stringify(w.log())
  await expect(w.service.sendMessage(w.mgr('m-send'), { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.invite(w.mgr('m-invite'), { name: 'x', address: 's:x', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.overview({ spaceId: 's', principal: principals.manager('PL'), guard: () => true })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.readSince({ spaceId: 's', principal: principals.manager('PL'), guard: () => true }, 0)).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.createSpace({ ...w.mgr('m-create'), spaceId: 'new' }, { name: 'x', address: 'loc:x', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  // The Leader's agent principal cannot run a manager command, with or without a guard.
  await expect(w.service.admitMember({ ...w.ctx('aily', 'leader-admit'), guard: () => true }, { name: 'locus-a', address: 'loc:1' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.admitMember(w.ctx('aily', 'leader-admit-2'), { name: 'locus-a', address: 'loc:1' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  expect(JSON.stringify(w.log())).toBe(before)
  expect(w.P.claims).toEqual([])
  expect(w.P.presenceCalls + w.provider.presenceCalls).toBe(0)
})
it('auth-m-02：未声明托管的 provider 不能作为 manager', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] }), before = JSON.stringify(w.log())
  await expect(w.service.admitMember(w.mgr('s-admit', 'S'), { name: 'locus-a', address: 's:1' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.admitMember(w.mgr('unknown-admit', 'nobody'), { name: 'locus-a', address: 's:1' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  expect(w.S.claims).toEqual([])
  expect(JSON.stringify(w.log())).toBe(before)
})
