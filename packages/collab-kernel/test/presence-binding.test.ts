import { expect, it } from 'vitest'
import { gate } from './support/fake-provider.js'
import { defaultMembers, intents } from './support/world.js'
import { managed, managedWorld, type ManagedWorld } from './support/managed-world.js'

const TOPIC_LIMIT = 20
const locusWorld = () => managedWorld({ allowed: ['pet-locus'], members: [...defaultMembers(), managed('locus-a', 'loc:old', 5), managed('locus-b', 'loc:b', 6)] })
/** Suspend P's presence sampling (P hosts locus-a and locus-b, so one command makes two calls). */
async function holdP(w: ManagedWorld) { const hold = gate(); w.P.presenceCalls = 0; w.P.holdPresence = () => hold.promise; return hold }
const wakesTo = (w: ManagedWorld, seq: number, name: string) => intents(w.events(seq)).filter(e => e.delivery.member === name)

it('binding-m-01：采样后换代的收件人不沿用旧样本', async () => {
  const w = await locusWorld()
  w.P.presenceBy = { 'loc:old': 'unreachable', 'loc:new': 'reachable' }
  const hold = await holdP(w)
  const ctx = w.ctx('aily', 'm-rebound'), input = { to: 'locus-a', body: 'question', needsReply: true }
  const pending = w.service.sendMessage(ctx, input)
  await expect.poll(() => w.P.presenceCalls).toBe(2)
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:new' })
  const before = w.log().length
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_BINDING_CHANGED' })
  await w.settle()
  expect(w.log()).toHaveLength(before)
  expect(w.log().some(r => r.kind === 'command' && r.receipt.cmdId === ctx.cmdId)).toBe(false)
  expect(w.P.deliveries).toEqual([])
  // Same cmdId retries and samples the new binding afresh.
  w.P.holdPresence = undefined
  const retried = await w.service.sendMessage(ctx, input)
  expect(wakesTo(w, retried.seq, 'locus-a')).toHaveLength(1)
  expect((await w.state()).topicWakes[retried.seq]).toBe(1)
})

it('binding-m-02：反方向换代同样不沿用', async () => {
  const w = await locusWorld()
  // Twenty counted needsReply messages in one topic between aily and doubao.
  let root: number | undefined, speaker = 'aily'
  for (let i = 0; i < TOPIC_LIMIT; i++) {
    const r = await w.service.sendMessage(w.ctx(speaker), { to: speaker === 'aily' ? 'doubao' : 'aily', body: `turn ${i}`, needsReply: true, ...(root === undefined ? {} : { ref: root }) })
    root ??= r.seq
    speaker = speaker === 'aily' ? 'doubao' : 'aily'
  }
  expect((await w.state()).topicWakes[root!]).toBe(TOPIC_LIMIT)
  w.P.presenceBy = { 'loc:old': 'reachable', 'loc:new': 'unreachable' }
  const hold = await holdP(w)
  const ctx = w.ctx('aily', 'm-limit'), input = { to: 'locus-a', body: 'one more', needsReply: true, ref: root! }
  const pending = w.service.sendMessage(ctx, input)
  await expect.poll(() => w.P.presenceCalls).toBe(2)
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:new' })
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_BINDING_CHANGED' })
  w.P.holdPresence = undefined
  const retried = await w.service.sendMessage(ctx, input)
  expect(intents(w.events(retried.seq))).toEqual([])
  expect((await w.state()).topicWakes[root!]).toBe(TOPIC_LIMIT)
})

it('binding-m-03：与唤醒无关的成员换代不影响命令', async () => {
  const w = await locusWorld()
  const hold = await holdP(w)
  const pending = w.service.sendMessage(w.ctx('aily', 'm-other'), { to: 'doubao', body: 'hi', needsReply: true })
  await expect.poll(() => w.P.presenceCalls).toBe(2)
  await w.service.rebindMember(w.mgr(), { member: 'locus-b', address: 'loc:b2' })
  hold.open()
  const result = await pending
  expect(wakesTo(w, result.seq, 'doubao')).toHaveLength(1)
  // Non-waking commands are unaffected too, even when they name the rebound member.
  const hold2 = await holdP(w)
  const quiet = w.service.sendMessage(w.ctx('aily', 'm-quiet'), { to: 'locus-a', body: 'fyi' })
  await expect.poll(() => w.P.presenceCalls).toBe(2)
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:a2' })
  hold2.open()
  await expect(quiet).resolves.toMatchObject({ spaceId: 's' })
})

it('binding-m-04：总览不把旧样本标到新绑定', async () => {
  const w = await locusWorld()
  w.P.presenceBy = { 'loc:old': 'reachable', 'loc:new': 'reachable' }
  const hold = await holdP(w)
  const pending = w.service.overview(w.read())
  await expect.poll(() => w.P.presenceCalls).toBe(2)
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:new' })
  hold.open()
  const overview = await pending
  expect(overview.members['locus-a']!.binding.address).toBe('loc:new')
  expect(overview.presence['locus-a']).toBe('unknown')
  expect(overview.presence['locus-b']).toBe('reachable')
  expect(overview.presence.doubao).toBe('reachable')
})

it('采样拒绝路径：rebind 期间的 BINDING_CHANGED 不使空间失败', async () => {
  const w = await locusWorld()
  const hold = await holdP(w)
  const ctx = w.ctx('aily', 'm-fail-check')
  const pending = w.service.sendMessage(ctx, { to: 'locus-a', body: 'x', needsReply: true })
  await expect.poll(() => w.P.presenceCalls).toBe(2)
  await w.service.rebindMember(w.mgr(), { member: 'locus-a', address: 'loc:new' })
  hold.open()
  await expect(pending).rejects.toMatchObject({ code: 'COLLAB_BINDING_CHANGED' })
  w.P.holdPresence = undefined
  const other = w.ctx('aily', 'after')
  await expect(w.service.setStatus(other, { text: 'fine' })).resolves.toBeDefined()
  expect((await w.state()).members.aily!.statusText).toBe('fine')
})
