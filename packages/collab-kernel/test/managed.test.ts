import { expect, it } from 'vitest'
import type { CollabEvent } from '../src/index.js'
import { gate, FakeProvider } from './support/fake-provider.js'
import { defaultMembers, intents, rejectsCleanly } from './support/world.js'
import { managed, managedWorld } from './support/managed-world.js'

const withLocus = (...extra: ReturnType<typeof managed>[]) => [...defaultMembers(), ...extra]

it('managed-01：授权后接纳、换代与退役', async () => {
  const w = await managedWorld()
  const allowed = await w.service.allowManager(w.ctx(), { channel: 'pet-locus' })
  expect((await w.state()).managers).toEqual(['pet-locus'])
  const admitted = await w.service.admitMember(w.mgr(), { name: 'locus-7f3a', address: 'loc:1' })
  const joined = (await w.state()).members['locus-7f3a']!
  expect(joined).toMatchObject({ kind: 'agent', status: 'active', joinSeq: admitted.seq, managedBy: 'pet-locus', binding: { channel: 'pet-locus', address: 'loc:1' } })
  expect(w.P.claims).toEqual([['loc:1', 'agent']])
  expect(w.S.claims).toEqual([])
  expect(w.provider.claims).toEqual([])
  const rebound = await w.service.rebindMember(w.mgr(), { member: 'locus-7f3a', address: 'loc:2' })
  const after = (await w.state()).members['locus-7f3a']!
  expect(after.binding.address).toBe('loc:2')
  expect(after.previousBindings).toEqual([{ channel: 'pet-locus', address: 'loc:1' }])
  expect(after.joinSeq).toBe(admitted.seq)
  expect(after.status).toBe('active')
  const stale = w.at('loc:1')
  await rejectsCleanly(w, stale.cmdId, () => w.service.sendMessage(stale, { to: 'aily', body: 'old address' }), 'COLLAB_NOT_MEMBER')
  const retired = await w.service.retireMember(w.mgr(), { member: 'locus-7f3a' })
  expect((await w.state()).members['locus-7f3a']!.status).toBe('gone')
  await w.settle()
  for (const seq of [allowed.seq, admitted.seq, rebound.seq, retired.seq]) expect(intents(w.events(seq)), `seq ${seq}`).toEqual([])
  expect(w.provider.deliveries).toEqual([])
  expect(w.P.deliveries).toEqual([])
  for (const seq of [admitted.seq, rebound.seq, retired.seq]) expect(w.events(seq).map(e => e.actor), `seq ${seq}`).toEqual(['manager:pet-locus'])
  expect(w.events(rebound.seq)).toEqual([{ type: 'member/rebound', actor: 'manager:pet-locus', name: 'locus-7f3a', binding: { channel: 'pet-locus', address: 'loc:2', supports: { wake: true, confirm: false } } }])
  expect(w.events(retired.seq)).toEqual([{ type: 'member/status', actor: 'manager:pet-locus', name: 'locus-7f3a', status: 'gone' }])
  expect(w.events(allowed.seq)).toEqual([{ type: 'manager/allowed', actor: 'aily', channel: 'pet-locus' }])
  // Manager receipts carry their own scope kind.
  const receipt = w.log().find(r => r.seq === admitted.seq)!
  expect(receipt.kind === 'command' && receipt.receipt.scope).toEqual({ kind: 'manager', channel: 'pet-locus' })
})

it('managed-02：未授权的接入方与非成员不可区分', async () => {
  const s1 = await managedWorld()
  const s2 = await managedWorld({ extra: [{ type: 'space/closed', actor: 'aily' }] })
  const s4 = await managedWorld({ allowed: ['pet-locus'] })
  await s4.service.revokeManager(s4.ctx(), { channel: 'pet-locus' })
  for (const [label, w] of [['S1', s1], ['S2', s2], ['S4', s4]] as const) {
    const ctx = w.mgr(`adm-${label}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.admitMember(ctx, { name: 'locus-a', address: 'loc:1' }), 'COLLAB_NOT_MEMBER', label)
    expect((await w.state()).members['locus-a'], label).toBeUndefined()
  }
  const before = s1.log().length
  await expect(s1.service.admitMember({ ...s1.mgr('adm-S3'), spaceId: 'missing' }, { name: 'locus-a', address: 'loc:1' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_NOT_FOUND' })
  expect(s1.log()).toHaveLength(before)
  expect(await s1.store.list()).toEqual(['s'])
})

it('managed-03：不能授权普通 provider 或重复授权', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  for (const channel of ['dsh-session', 'unknown-x', 'pet-locus', 'test-a']) {
    const ctx = w.ctx('aily', `allow-${channel}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.allowManager(ctx, { channel }), 'COLLAB_BAD_CHANNEL', channel)
  }
  const ctx = w.ctx('aily', 'revoke-other')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.revokeManager(ctx, { channel: 'other-y' }), 'COLLAB_BAD_CHANNEL')
  // A registered managed channel that was never granted cannot be revoked either.
  const never = w.ctx('aily', 'revoke-never')
  await rejectsCleanly(w, never.cmdId, () => w.service.revokeManager(never, { channel: 'other-loc' }), 'COLLAB_BAD_CHANNEL')
  expect((await w.state()).managers).toEqual(['pet-locus'])
})

it('managed-04：非 Leader 不能授权', async () => {
  const w = await managedWorld({ allowed: ['other-loc'] })
  const allow = w.ctx('doubao', 'allow')
  await rejectsCleanly(w, allow.cmdId, () => w.service.allowManager(allow, { channel: 'pet-locus' }), 'COLLAB_FORBIDDEN')
  const revoke = w.ctx('doubao', 'revoke')
  await rejectsCleanly(w, revoke.cmdId, () => w.service.revokeManager(revoke, { channel: 'other-loc' }), 'COLLAB_FORBIDDEN')
  expect((await w.state()).managers).toEqual(['other-loc'])
})

it('managed-05：撤销同时退役全部托管成员', async () => {
  const w = await managedWorld({ allowed: ['pet-locus', 'other-loc'], members: withLocus(managed('locus-a', 'loc:a', 5), managed('locus-b', 'loc:b', 6), managed('locus-c', 'loc:c', 7, 'gone'), managed('other-a', 'oth:a', 8, 'active', 'other-loc')) })
  const revoked = await w.service.revokeManager(w.ctx(), { channel: 'pet-locus' })
  await w.settle()
  expect(w.events(revoked.seq)).toEqual([
    { type: 'manager/revoked', actor: 'aily', channel: 'pet-locus' },
    { type: 'member/status', actor: 'aily', name: 'locus-a', status: 'gone' },
    { type: 'member/status', actor: 'aily', name: 'locus-b', status: 'gone' },
  ])
  const s = await w.state()
  expect(s.managers).toEqual(['other-loc'])
  expect(s.members['other-a']!.status).toBe('active')
  expect(w.provider.deliveries).toEqual([])
  const ctx = w.mgr('after-revoke')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.admitMember(ctx, { name: 'locus-d', address: 'loc:d' }), 'COLLAB_NOT_MEMBER')
  await w.service.revokeManager(w.ctx(), { channel: 'other-loc' })
  expect((await w.state()).managers).toEqual([])
})

it('managed-06：只能管理本 channel 的成员', async () => {
  const w = await managedWorld({ allowed: ['pet-locus', 'other-loc'], members: withLocus(managed('locus-a', 'loc:a', 5)) })
  const before = structuredClone((await w.state()).members)
  const q = w.mgr('q-retire', 'QL')
  await rejectsCleanly(w, q.cmdId, () => w.service.retireMember(q, { member: 'locus-a' }), 'COLLAB_FORBIDDEN')
  const p = w.mgr('p-rebind')
  await rejectsCleanly(w, p.cmdId, () => w.service.rebindMember(p, { member: 'doubao', address: 'loc:z' }), 'COLLAB_FORBIDDEN')
  const missing = w.mgr('p-missing')
  await rejectsCleanly(w, missing.cmdId, () => w.service.retireMember(missing, { member: 'nobody' }), 'COLLAB_FORBIDDEN')
  expect((await w.state()).members).toEqual(before)
})

it('managed-07：历史地址不能复用', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  await w.service.admitMember(w.mgr(), { name: 'locus-a', address: 'loc:1' })
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:2' })
  const admit = w.mgr('admit-old')
  await rejectsCleanly(w, admit.cmdId, () => w.service.admitMember(admit, { name: 'locus-b', address: 'loc:1' }), 'COLLAB_ADDRESS_TAKEN')
  const back = w.mgr('rebind-old')
  await rejectsCleanly(w, back.cmdId, () => w.service.rebindMember(back, { member: 'locus-a', address: 'loc:1' }), 'COLLAB_ADDRESS_TAKEN')
  const current = w.mgr('rebind-current')
  await rejectsCleanly(w, current.cmdId, () => w.service.rebindMember(current, { member: 'locus-a', address: 'loc:2' }), 'COLLAB_ADDRESS_TAKEN')
  // Name rules are those of invite.
  const taken = w.mgr('admit-name')
  await rejectsCleanly(w, taken.cmdId, () => w.service.admitMember(taken, { name: 'doubao', address: 'loc:9' }), 'COLLAB_NAME_TAKEN')
  const bad = w.mgr('admit-bad-name')
  await rejectsCleanly(w, bad.cmdId, () => w.service.admitMember(bad, { name: 'Locus A', address: 'loc:9' }), 'COLLAB_BAD_NAME')
  const unclaimed = w.mgr('admit-unclaimed')
  await rejectsCleanly(w, unclaimed.cmdId, () => w.service.admitMember(unclaimed, { name: 'locus-z', address: 'a:77' }), 'COLLAB_ADDRESS_UNCLAIMED')
  expect(w.provider.claims).toEqual([])
})

it('managed-08：认领挂起期间被撤销', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  const hold = gate(); w.P.holdClaim = () => hold.promise
  const ctx = w.mgr('adm-held')
  const pending = w.service.admitMember(ctx, { name: 'locus-a', address: 'loc:1' })
  await expect.poll(() => w.P.claims.length).toBe(1)
  await w.service.revokeManager(w.ctx(), { channel: 'pet-locus' })
  const length = w.log().length
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_NOT_MEMBER' })
  expect(w.log()).toHaveLength(length)
  expect((await w.state()).members['locus-a']).toBeUndefined()
  expect(w.log().some(r => r.kind === 'command' && r.receipt.cmdId === 'adm-held')).toBe(false)
})

it('managed-09：认领挂起期间目标被标记离开', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: withLocus(managed('locus-a', 'loc:1', 5)) })
  const hold = gate(); w.P.holdClaim = () => hold.promise
  const pending = w.service.rebindMember(w.mgr('rebind-held'), { member: 'locus-a', address: 'loc:2' })
  await expect.poll(() => w.P.claims.length).toBe(1)
  await w.service.markGone(w.ctx(), { member: 'locus-a' })
  const length = w.log().length
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' })
  expect(w.log()).toHaveLength(length)
  const locus = (await w.state()).members['locus-a']!
  expect(locus.status).toBe('gone')
  expect(locus.binding.address).toBe('loc:1')
  expect(locus.previousBindings).toBeUndefined()
})

it('managed-10：并发的同 cmdId 接纳只提交一次', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  const first = gate(), second = gate(), holds = [first, second]
  w.P.holdClaim = () => holds.shift()!.promise
  const a = w.service.admitMember(w.mgr('adm-1'), { name: 'locus-a', address: 'loc:1' })
  const b = w.service.admitMember(w.mgr('adm-1'), { name: 'locus-a', address: 'loc:1' })
  await expect.poll(() => w.P.claims.length).toBe(2)
  first.open(); const ra = await a
  second.open(); const rb = await b
  expect(rb).toEqual(ra)
  expect(w.log().flatMap(r => r.events).filter(e => e.type === 'member/joined' && e.member.name === 'locus-a')).toHaveLength(1)
  expect(w.log().filter(r => r.kind === 'command' && r.receipt.cmdId === 'adm-1')).toHaveLength(1)
})

it('managed-11：认领期间地址被抢占', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  const first = gate(), second = gate(), holds = [first, second]
  w.P.holdClaim = () => holds.shift()!.promise
  const a = w.service.admitMember(w.mgr('adm-a'), { name: 'locus-a', address: 'loc:1' })
  const b = w.service.admitMember(w.mgr('adm-b'), { name: 'locus-b', address: 'loc:1' })
  await expect.poll(() => w.P.claims.length).toBe(2)
  first.open(); await a
  const length = w.log().length
  second.open()
  await expect(b).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_TAKEN' })
  expect(w.log()).toHaveLength(length)
  expect((await w.state()).members['locus-b']).toBeUndefined()
})

it('managed-12：收据重放不再认领', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'] })
  const ctx = w.mgr('adm-1'), input = { name: 'locus-a', address: 'loc:1' }
  const first = await w.service.admitMember(ctx, input)
  let calls = 0
  w.P.claim = async () => { calls++; throw new Error('claim must not run on replay') }
  const length = w.log().length
  expect(await w.service.admitMember(ctx, input)).toEqual(first)
  expect(calls).toBe(0)
  expect(w.log()).toHaveLength(length)
  // A different payload under an existing cmdId conflicts; the receipt still prevents any claim.
  await expect(w.service.admitMember(ctx, { name: 'locus-a', address: 'loc:2' })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' })
  expect(calls).toBe(0)
})

it('managed-13：托管 provider 声明非法 channel', async () => {
  const w = await managedWorld()
  const bad = new FakeProvider('BAD', 'Pet Locus', 'bad:'); bad.managed = true
  w.service.options.providers.push(bad)
  const ctx = w.ctx('aily', 'allow-bad')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.allowManager(ctx, { channel: 'Pet Locus' }), 'COLLAB_BAD_CHANNEL')
  expect((await w.state()).managers).toEqual([])
})

it('managed-14：换代后旧收据仍按成员名命中', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: withLocus(managed('locus-a', 'loc:1', 5)) })
  const input = { to: 'aily', body: 'before rebind' }
  const first = await w.service.sendMessage(w.at('loc:1', 'm-1'), input)
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:2' })
  const length = w.log().length
  expect(await w.service.sendMessage(w.at('loc:2', 'm-1'), input)).toEqual(first)
  expect(w.log()).toHaveLength(length)
  // The retired address resolves to nobody.
  await expect(w.service.sendMessage(w.at('loc:1', 'm-2'), input)).rejects.toMatchObject({ code: 'COLLAB_NOT_MEMBER' })
})

it('托管事件按顺序重放：rebound 追加历史，旧日志 managers 为空', async () => {
  const w = await managedWorld({ allowed: ['pet-locus'], members: withLocus(managed('locus-a', 'loc:1', 5)) })
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:2' })
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:3' })
  await w.service.setStatus(w.at('loc:3'), { text: 'kept' })
  const live = await w.state()
  await w.reopen()
  const replayed = await w.state()
  expect(replayed.members['locus-a']).toEqual(live.members['locus-a'])
  expect(replayed.members['locus-a']!.previousBindings).toEqual([{ channel: 'pet-locus', address: 'loc:1' }, { channel: 'pet-locus', address: 'loc:2' }])
  expect(replayed.members['locus-a']!.statusText).toBe('kept')
  expect(replayed.managers).toEqual(['pet-locus'])
  const legacy = await managedWorld()
  expect((await legacy.state()).managers).toEqual([])
  const events: CollabEvent['type'][] = w.log().flatMap(r => r.events.map(e => e.type))
  expect(events.filter(t => t === 'member/rebound')).toHaveLength(2)
})
