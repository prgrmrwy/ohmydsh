import { expect, it } from 'vitest'
import { CollabService, authorization, principals, type Principal, type Item, type CollabEvent } from '../src/index.js'
import { world, member } from './support/world.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
import { serviceMethods, missingAuthorization } from './support/api-coverage.js'
it('auth-01：动作记为 principal 反查到的成员', async () => { const w = await world(); await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hi' }); expect(w.log().at(-1)?.events.find(e => e.type === 'message/sent')?.actor).toBe('aily') })
it('auth-02：首次创建与创建重放', async () => { const store = new MemStore(), service = new CollabService({ serviceId: 'x', store, providers: [new FakeProvider()] }); const ctx = { spaceId: 'new', principal: principals.agent({ channel: 'test-a', address: 'a:1' }), cmdId: 'c-1' }, input = { name: 'aily', address: 'a:1', kind: 'agent' as const }; const first = await service.createSpace(ctx, input); expect(await service.createSpace(ctx, input)).toEqual(first); expect((await store.read('new', 0))).toHaveLength(1) })
it('auth-03：重复创建同一协作空间', async () => { const w = await world(); await expect(w.service.createSpace(w.ctx('doubao'), { name: 'doubao', address: 'a:2', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_EXISTS' }) })
it('auth-04：internal 命令不做成员反查', async () => { const w = await world(); await w.service.resetBreaker({ spaceId: 's', cmdId: 'reset', principal: principals.internal('breaker-reset') }, { member: 'doubao' }); expect(w.log().at(-1)?.events).toContainEqual({ type: 'breaker/reset', actor: 'internal:breaker-reset', member: 'doubao' }) })
it('auth-05：不存在空间先于成员反查', async () => { const w = await world(); await expect(w.service.sendMessage({ ...w.ctx(), spaceId: 'missing' }, { to: 'x', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_NOT_FOUND' }) })
it('auth-06：真实API授权覆盖及漏登记负夹具', () => { expect(Object.keys(authorization).sort()).toEqual(serviceMethods()); expect(missingAuthorization(Object.keys(authorization), true)).toEqual(['unsafeWrite']) })
it('auth-07：没有字符串分发入口', () => { expect(CollabService.prototype).not.toHaveProperty('execute'); expect(CollabService.prototype).not.toHaveProperty('setDeciders'); expect(CollabService.prototype).not.toHaveProperty('recordDispatch') })
it('auth-08：非Leader邀请被拒', async () => { const w = await world(); await expect(w.service.invite(w.ctx('doubao'), { name: 'new', address: 'a:new', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(w.log()).toHaveLength(1) })
it('auth-09：他人代为加入被拒', async () => { const w = await world(); await expect(w.service.join(w.ctx())).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }); expect((await w.service.overview(w.read())).members.bob?.status).toBe('invited') })
it('auth-10：provider其他channel被拒', async () => { const w = await world(); await expect(w.service.sendMessage({ ...w.ctx(), principal: principals.provider('P1', { channel: 'test-b', address: 'a:1' }) }, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
it('auth-11：agent不能确认', async () => { const w = await world(); await expect(w.service.confirmDecision(w.ctx(), { requestId: 'D1', choice: 'A', evidence: { actionId: 'e', deliveryId: 'dv' } })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(w.log()).toHaveLength(1) })
it('auth-12：internal不能执行成员命令', async () => { const w = await world(); await expect(w.service.sendMessage({ ...w.ctx(), principal: principals.internal('breaker-reset') }, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
it('auth-13：gone成员不能读写', async () => { const w = await world([], [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'gone')]); await expect(w.service.setStatus(w.ctx('doubao'), { text: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }); await expect(w.service.overview(w.read('doubao'))).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' }) })
it('全部具名写命令逐项允许与拒绝授权', async () => {
  const item: Item = { id: 'C', kind: 'request', assignee: 'doubao', progress: 'open', author: 'aily', title: 'C', body: '', revision: 1, status: 'draft', requiredAcks: [], deciders: ['pm'], acks: {}, agentEditCount: 0 }
  const seed: CollabEvent[] = [{ type: 'item/created', actor: 'aily', item }, { type: 'decision/requested', actor: 'aily', request: { id: 'D', itemId: 'C', revision: 1, author: 'aily', options: ['A', 'B'], deciders: ['pm'], status: 'open', awaitingChannel: false } }, { type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: 'dv', member: 'pm', providerId: 'P1', kind: 'confirm', requestId: 'D', outcome: 'succeeded', messageRef: 'm' } }]
  type W = Awaited<ReturnType<typeof world>>
  const checks: { name: keyof typeof authorization; run: (w: W, allowed: boolean) => Promise<unknown> }[] = [
    { name: 'createSpace', run: (w, yes) => w.service.createSpace({ ...w.ctx(), spaceId: 'new', principal: yes ? principals.agent({ channel: 'test-a', address: 'a:1' }) : principals.internal('breaker-reset') }, { name: 'aily', kind: 'agent', address: 'a:1' }) },
    { name: 'invite', run: (w, yes) => w.service.invite(w.ctx(yes ? 'aily' : 'doubao'), { name: 'new', kind: 'agent', address: 'a:new' }) },
    { name: 'join', run: (w, yes) => w.service.join(w.ctx(yes ? 'bob' : 'aily')) },
    { name: 'declineInvite', run: (w, yes) => w.service.declineInvite(w.ctx(yes ? 'bob' : 'aily')) },
    { name: 'leave', run: (w, yes) => w.service.leave(w.ctx(yes ? 'doubao' : 'bob')) },
    { name: 'markGone', run: (w, yes) => w.service.markGone(w.ctx(yes ? 'aily' : 'doubao'), { member: 'qa' }) },
    { name: 'transferLeader', run: (w, yes) => w.service.transferLeader(w.ctx(yes ? 'aily' : 'doubao'), { member: 'qa' }) },
    { name: 'closeSpace', run: (w, yes) => w.service.closeSpace(w.ctx(yes ? 'aily' : 'doubao')) },
    { name: 'createItem', run: (w, yes) => w.service.createItem(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'new', kind: 'other', title: 'new', body: '', requiredAcks: [], deciders: [] }) },
    { name: 'reviseItem', run: (w, yes) => w.service.reviseItem(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'C', expectedRevision: 1, changes: { body: 'x' } }) },
    { name: 'ackItem', run: (w, yes) => w.service.ackItem(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'C', revision: 1 }) },
    { name: 'sendMessage', run: (w, yes) => w.service.sendMessage(w.ctx(yes ? 'aily' : 'bob'), { to: 'doubao', body: 'hi' }) },
    { name: 'setStatus', run: (w, yes) => w.service.setStatus(w.ctx(yes ? 'aily' : 'bob'), { text: 'x' }) },
    { name: 'advanceRequest', run: (w, yes) => w.service.advanceRequest(w.ctx(yes ? 'doubao' : 'aily'), { itemId: 'C', progress: 'accepted' }) },
    { name: 'requestDecision', run: (w, yes) => w.service.requestDecision(w.ctx(yes ? 'aily' : 'bob'), { itemId: 'C', options: ['A', 'B'] }) },
    { name: 'confirmDecision', run: (w, yes) => w.service.confirmDecision(w.ctx(yes ? 'pm' : 'aily'), { requestId: 'D', choice: 'A', evidence: { actionId: 'e', deliveryId: 'dv' } }) },
    { name: 'resetBreaker', run: (w, yes) => w.service.resetBreaker({ ...w.ctx(), principal: yes ? principals.internal('breaker-reset') : w.principal('aily') }, { member: 'doubao' }) },
  ]
  expect(checks.map(c => c.name).sort()).toEqual(Object.keys(authorization).sort())
  for (const check of checks) { const yes = await world(seed); await expect(check.run(yes, true), check.name).resolves.toBeDefined(); const no = await world(seed); await expect(check.run(no, false), check.name).rejects.toMatchObject({ code: expect.stringMatching(/^COLLAB_(FORBIDDEN|MEMBER_INACTIVE)$/) }); expect(no.log(), check.name).toHaveLength(1) }
})
it('principal必须受信构造', async () => { const w = await world(); await expect(w.service.overview({ spaceId: 's', principal: { kind: 'agent', channel: 'test-a', address: 'a:1' } as Principal })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }) })
