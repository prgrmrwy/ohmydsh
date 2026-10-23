import { expect, it } from 'vitest'
import { principals } from '../src/index.js'
import { gate } from './support/fake-provider.js'
import { defaultMembers, intents, rejectsCleanly } from './support/world.js'
import { managed, managedWorld } from './support/managed-world.js'

const locusWorld = () => managedWorld({ allowed: ['pet-locus'], members: [...defaultMembers(), managed('locus-a', 'loc:1', 5)] })
/** A host guard over a mutable flag, counting its calls. */
const flag = () => { const g = { valid: true, calls: 0, check: () => { g.calls++; return g.valid } }; return g }

it('guard-01：入口通过后、提交前守卫失效', async () => {
  const w = await locusWorld(), g = flag()
  const hold = gate(); w.P.holdPresence = () => hold.promise
  const ctx = w.at('loc:1', 'm-stale', 'pet-locus', g.check)
  const before = w.log().length
  const pending = w.service.sendMessage(ctx, { to: 'aily', body: 'hello', needsReply: true })
  await expect.poll(() => w.P.presenceCalls).toBe(1)
  g.valid = false
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  await w.settle()
  expect(w.log()).toHaveLength(before)
  expect(w.log().flatMap(r => r.events).filter(e => e.type === 'dispatch/intended')).toEqual([])
  expect(w.provider.deliveries).toEqual([])
  expect(g.calls).toBeGreaterThan(0)
  // The ledger was not touched: the member is still active and the space is healthy.
  expect((await w.state()).members['locus-a']!.status).toBe('active')
  await w.service.setStatus(w.ctx(), { text: 'still writable' })
})

it('guard-02b：project 在 overview 之后、返回之前再查守卫', async () => {
  const w = await locusWorld()
  let valid = true, calls = 0
  // Turns false right after its first (overview) check, before project's own continuation runs.
  const guard = () => { calls++; if (calls === 1) queueMicrotask(() => { valid = false }); return valid }
  const read = { spaceId: 's', principal: principals.agent({ channel: 'pet-locus', address: 'loc:1' }), guard }
  await expect(w.service.project(read)).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
})

it('guard-02：读取期间守卫失效不返回数据', async () => {
  const w = await locusWorld(), g = flag()
  const hold = gate(); w.P.holdPresence = () => hold.promise
  const read = { spaceId: 's', principal: principals.agent({ channel: 'pet-locus', address: 'loc:1' }), guard: g.check }
  const pending = w.service.overview(read)
  await expect.poll(() => w.P.presenceCalls).toBe(1)
  g.valid = false
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  // Every read path consults the guard before returning.
  await expect(w.service.readSince(read, 0)).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  await expect(w.service.project(read)).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  await expect(w.service.readConvention(read, '1')).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  g.valid = true
  expect((await w.service.overview(read)).members['locus-a']!.status).toBe('active')
  expect(await w.service.readSince(read, 0)).toHaveLength(1)
})

it('guard-03：守卫失效时连收据也不返回', async () => {
  const w = await locusWorld()
  const input = { to: 'aily', body: 'once' }
  const first = await w.service.sendMessage(w.at('loc:1', 'm-1'), input)
  const length = w.log().length
  await expect(w.service.sendMessage(w.at('loc:1', 'm-1', 'pet-locus', () => false), input)).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  expect(await w.service.sendMessage(w.at('loc:1', 'm-1', 'pet-locus', () => true), input)).toEqual(first)
  expect(w.log()).toHaveLength(length)
  // Manager receipts as well.
  const admit = await w.service.admitMember(w.mgr('adm-1'), { name: 'locus-b', address: 'loc:2' })
  await expect(w.service.admitMember(w.mgr('adm-1', 'PL', () => false), { name: 'locus-b', address: 'loc:2' })).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  expect(await w.service.admitMember(w.mgr('adm-1'), { name: 'locus-b', address: 'loc:2' })).toEqual(admit)
  // A stale manager never commits.
  const stale = w.mgr('adm-stale', 'PL', () => false)
  await rejectsCleanly(w, stale.cmdId, () => w.service.admitMember(stale, { name: 'locus-c', address: 'loc:3' }), 'COLLAB_CALLER_STALE')
})

it('guard-04：托管 channel 的调用缺少守卫被拒', async () => {
  const w = await locusWorld(), before = JSON.stringify(w.log())
  const presence = () => w.P.presenceCalls + w.Q.presenceCalls + w.S.presenceCalls + w.provider.presenceCalls
  await expect(w.service.sendMessage(w.at('loc:1', 'no-guard', 'pet-locus', null), { to: 'aily', body: 'x', needsReply: true })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.sendMessage({ spaceId: 's', cmdId: 'no-guard-provider', principal: principals.provider('PL', { channel: 'pet-locus', address: 'loc:1' }) }, { to: 'aily', body: 'x' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.admitMember(w.mgr('no-guard-admit', 'PL', null), { name: 'locus-b', address: 'loc:2' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.overview({ spaceId: 's', principal: principals.agent({ channel: 'pet-locus', address: 'loc:1' }) })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  await expect(w.service.createSpace(w.at('loc:1', 'no-guard-create', 'pet-locus', null), { name: 'x', address: 'loc:1', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  // A non-function guard is the same as none.
  await expect(w.service.setStatus({ ...w.at('loc:1', 'bad-guard', 'pet-locus', null), guard: true as never }, { text: 'x' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
  expect(w.P.claims).toEqual([])
  expect(w.S.claims).toEqual([])
  expect(presence()).toBe(0)
  expect(JSON.stringify(w.log())).toBe(before)
})

it('guard-05：守卫抛错按失效处理', async () => {
  const w = await locusWorld()
  const ctx = { ...w.ctx('aily', 'throwing'), guard: () => { throw new Error('host gone') } }
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'x', needsReply: true }), 'COLLAB_CALLER_STALE')
  await expect(w.service.overview({ ...w.read(), guard: () => { throw new Error('host gone') } })).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  // Any non-true return value is stale as well.
  await expect(w.service.setStatus({ ...w.ctx(), guard: (() => 1) as never }, { text: 'x' })).rejects.toMatchObject({ code: 'COLLAB_CALLER_STALE' })
  const ok = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'after', needsReply: true })
  expect(intents(w.events(ok.seq))).toHaveLength(1)
  await w.service.setStatus(w.at('loc:1'), { text: 'managed still fine' })
})

it('guard-06：普通成员不带守卫不受影响', async () => {
  const w = await locusWorld()
  await expect(w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'no guard', needsReply: true })).resolves.toMatchObject({ seq: 2 })
  await expect(w.service.overview(w.read())).resolves.toMatchObject({ spaceId: 's' })
  // A passing guard on an ordinary call is called and changes nothing.
  const g = flag()
  await w.service.setStatus({ ...w.ctx(), guard: g.check }, { text: 'guarded' })
  expect(g.calls).toBe(1)
})

it('guard-04b：缺少守卫时先报 FORBIDDEN，不被不可序列化的附加数据抢先', async () => {
  const w = await locusWorld()
  const ctx = { spaceId: 's', cmdId: 'gb-1', principal: principals.agent({ channel: 'pet-locus', address: 'loc:1' }) }
  await expect(w.service.sendMessage(ctx, { to: 'aily', body: 'x', ext: { n: 1n } as never })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
})
