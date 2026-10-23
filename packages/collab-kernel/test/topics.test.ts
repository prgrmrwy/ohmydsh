import { expect, it } from 'vitest'
import type { CollabEvent } from '../src/index.js'
import { intents, rawCommand, rejectsCleanly, seedRecord, world, worldFrom, type World } from './support/world.js'

const TOPIC_LIMIT = 20
const wakeTo = (seq: number, to: string, extra: Record<string, unknown> = {}): CollabEvent => ({ type: 'dispatch/intended', actor: to === 'doubao' ? 'aily' : 'doubao', delivery: { deliveryId: `legacy-${seq}-${to}`, member: to, kind: 'wake', providerId: 'P1', pointer: { spaceId: 's', toSeq: seq, counts: { message: 1, item: 0, decision: 0, member: 0 }, from: to === 'doubao' ? 'aily' : 'doubao' }, ...extra } })
const other = (name: string) => name === 'aily' ? 'doubao' : 'aily'

/**
 * Drive real service commands: aily and doubao alternate needsReply messages
 * in one topic. `pick` chooses which earlier seq of the topic each one refs.
 */
async function converse(w: World, count: number, options: { root?: number; first?: string; pick?: (seqs: number[]) => number } = {}) {
  const seqs: number[] = options.root === undefined ? [] : [options.root]
  let speaker = options.first ?? 'aily'
  for (let i = 0; i < count; i++) {
    const ref = seqs.length ? (options.pick ?? (s => s.at(-1)!))(seqs) : undefined
    const result = await w.service.sendMessage(w.ctx(speaker), { to: other(speaker), body: `turn ${i}`, needsReply: true, ...(ref === undefined ? {} : { ref }) })
    seqs.push(result.seq)
    speaker = other(speaker)
  }
  return { root: options.root ?? seqs[0]!, seqs, next: speaker }
}
const overview = (w: World) => w.service.overview(w.host())

it('topic-01：同一话题第 21 条唤醒消息被拒绝', async () => {
  const w = await world()
  let turn = 0
  // Mix of refs: always the root on even turns, the latest message on odd turns.
  const { root, seqs, next } = await converse(w, TOPIC_LIMIT, { pick: s => (turn++ % 2 ? s.at(-1)! : s[0]!) })
  for (const seq of seqs) {
    const wakes = intents(w.events(seq))
    expect(wakes, `seq ${seq}`).toHaveLength(1)
    expect(wakes[0]!.delivery.thread, `seq ${seq}`).toBe(root)
  }
  const ctx = w.ctx(next, 'twenty-first')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: other(next), body: 'one more', needsReply: true, ref: root }), 'COLLAB_THREAD_LIMIT')
  expect((await overview(w)).topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-02：旧日志中的唤醒消息计入其话题', async () => {
  const w = await worldFrom([
    seedRecord(),
    rawCommand(2, [{ type: 'member/statusText', actor: 'aily', name: 'aily', text: 'old' }]),
    rawCommand(3, [{ type: 'message/sent', actor: 'aily', message: { id: '3', actor: 'aily', to: 'doubao', body: 'old question', needsReply: true } }, wakeTo(3, 'doubao')]),
  ])
  expect((await overview(w)).topicWakes[3]).toBe(1)
  const { next } = await converse(w, TOPIC_LIMIT - 1, { root: 3, first: 'doubao' })
  await w.reopen()
  expect((await overview(w)).topicWakes[3]).toBe(TOPIC_LIMIT)
  const ctx = w.ctx(next, 'after-reopen')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: other(next), body: 'over', needsReply: true, ref: 3 }), 'COLLAB_THREAD_LIMIT')
})

it('topic-03：不写 ref 的新消息开启新话题', async () => {
  const w = await world()
  const { root } = await converse(w, TOPIC_LIMIT)
  const fresh = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'new subject', needsReply: true })
  expect(intents(w.events(fresh.seq))[0]!.delivery.thread).toBe(fresh.seq)
  const o = await overview(w)
  expect(o.topicOf[fresh.seq]).toBe(fresh.seq)
  expect(o.topicWakes[fresh.seq]).toBe(1)
  expect(o.topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-04：引用条目的消息归属条目话题', async () => {
  const w = await world()
  const item = await w.service.createItem(w.ctx('aily'), { itemId: 'C1', kind: 'charter', title: 'C1', body: '', requiredAcks: [] })
  const ask = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'about C1', needsReply: true, ref: item.seq })
  const reply = await w.service.sendMessage(w.ctx('doubao'), { to: 'aily', body: 'ok', needsReply: true, ref: ask.seq })
  const o = await overview(w)
  expect(o.topicOf[item.seq]).toBe(item.seq)
  expect(o.topicOf[ask.seq]).toBe(item.seq)
  expect(o.topicOf[reply.seq]).toBe(item.seq)
  expect(o.topicWakes[item.seq]).toBe(2)
})

it('topic-05：不唤醒的消息不受限也不计数', async () => {
  const w = await world()
  const { root, seqs } = await converse(w, TOPIC_LIMIT)
  const last = seqs.at(-1)!
  const sender = w.log().flatMap(r => r.events).find(e => e.type === 'message/sent' && e.message.id === `${last}`)!.actor
  const reply = await w.service.sendMessage(w.ctx(other(sender)), { to: sender, body: 'fyi', needsReply: false, ref: last })
  expect(intents(w.events(reply.seq))).toEqual([])
  const o = await overview(w)
  expect(o.topicOf[reply.seq]).toBe(root)
  expect(o.topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-06：不可达收件人的消息不计数', async () => {
  const w = await world()
  const { root, seqs } = await converse(w, 1)
  w.provider.observedPresence = 'unreachable'
  const unreachable = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'are you there', needsReply: true, ref: seqs[0]! })
  expect(intents(w.events(unreachable.seq))).toEqual([])
  const o = await overview(w)
  expect(o.topicOf[unreachable.seq]).toBe(root)
  expect(o.topicWakes[root]).toBe(1)
  // At the limit an unreachable recipient is still not a rejection.
  w.provider.observedPresence = 'reachable'
  await converse(w, TOPIC_LIMIT - 1, { root, first: 'doubao' })
  w.provider.observedPresence = 'unreachable'
  const atLimit = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'still there?', needsReply: true, ref: root })
  expect(intents(w.events(atLimit.seq))).toEqual([])
  expect((await overview(w)).topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-07：结束通知不受话题上限限制', async () => {
  const w = await world()
  const { root } = await converse(w, TOPIC_LIMIT)
  await w.service.createItem(w.ctx('aily'), { itemId: 'R1', kind: 'request', assignee: 'doubao', title: 'R1', body: '', requiredAcks: [], ref: root })
  const accepted = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'accepted' })
  const done = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'done' })
  expect(intents(w.events(accepted.seq))).toEqual([])
  const notice = intents(w.events(done.seq))
  expect(notice).toHaveLength(1)
  expect(notice[0]!.delivery).toMatchObject({ member: 'aily', kind: 'wake', thread: root })
  expect((await overview(w)).topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-08：跨 request 的结束通知不受话题上限约束', async () => {
  const w = await world()
  const { root } = await converse(w, TOPIC_LIMIT)
  await w.service.createItem(w.ctx('aily'), { itemId: 'R6', kind: 'request', assignee: 'doubao', title: 'R6', body: '', requiredAcks: [], ref: root })
  await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R6', progress: 'accepted' })
  const r6 = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R6', progress: 'done' })
  await w.service.createItem(w.ctx('doubao'), { itemId: 'R7', kind: 'request', assignee: 'aily', title: 'R7', body: '', requiredAcks: [], ref: root })
  await w.service.advanceRequest(w.ctx('aily'), { itemId: 'R7', progress: 'accepted' })
  const r7 = await w.service.advanceRequest(w.ctx('aily'), { itemId: 'R7', progress: 'done' })
  expect(intents(w.events(r6.seq)).map(e => e.delivery.member)).toEqual(['aily'])
  expect(intents(w.events(r7.seq)).map(e => e.delivery.member)).toEqual(['doubao'])
  expect((await overview(w)).topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-09：并发提交不越过上限', async () => {
  const w = await world()
  const { root } = await converse(w, TOPIC_LIMIT - 1)
  await w.settle()
  const before = w.log().length
  const first = w.service.sendMessage(w.ctx('aily', 'race-1'), { to: 'doubao', body: 'race one', needsReply: true, ref: root })
  const second = w.service.sendMessage(w.ctx('doubao', 'race-2'), { to: 'aily', body: 'race two', needsReply: true, ref: root })
  const [a, b] = await Promise.allSettled([first, second])
  expect(a.status).toBe('fulfilled')
  expect(b).toMatchObject({ status: 'rejected', reason: { code: 'COLLAB_THREAD_LIMIT' } })
  await w.settle()
  expect(w.log().filter(r => r.kind === 'command')).toHaveLength(w.log().slice(0, before).filter(r => r.kind === 'command').length + 1)
  expect(w.log().some(r => r.kind === 'command' && r.receipt.cmdId === 'race-2')).toBe(false)
  expect((await overview(w)).topicWakes[root]).toBe(TOPIC_LIMIT)
})

it('topic-10：命令时判定与重新加载一致', async () => {
  const w = await world()
  const { root, next } = await converse(w, TOPIC_LIMIT)
  await expect(w.service.sendMessage(w.ctx(next), { to: other(next), body: 'REJECTED-21ST', needsReply: true, ref: root })).rejects.toMatchObject({ code: 'COLLAB_THREAD_LIMIT' })
  const item = await w.service.createItem(w.ctx('aily'), { itemId: 'R1', kind: 'request', assignee: 'doubao', title: 'R1', body: '', requiredAcks: [] })
  await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'see item', needsReply: true, ref: item.seq })
  w.provider.observedPresence = 'unreachable'
  await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'offline', needsReply: true, ref: item.seq })
  w.provider.observedPresence = 'reachable'
  await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'accepted' })
  await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'done' })
  await w.settle()
  const pick = (o: Awaited<ReturnType<typeof overview>>) => structuredClone({ topicOf: o.topicOf, topicWakes: o.topicWakes, itemSeq: o.itemSeq })
  const before = pick(await overview(w))
  expect(before.topicWakes[root]).toBe(TOPIC_LIMIT)
  expect(before.topicWakes[item.seq]).toBe(1)
  await w.reopen()
  expect(pick(await overview(w))).toEqual(before)
  expect(JSON.stringify(w.log())).not.toContain('REJECTED-21ST')
})

it('topic-11：旧的成员级熔断不再阻断', async () => {
  const legacy = [2, 3, 4, 5, 6, 7].map(seq => rawCommand(seq, [{ type: 'message/sent', actor: 'aily', message: { id: `${seq}`, actor: 'aily', to: 'doubao', body: 'old', needsReply: true } }, wakeTo(seq, 'doubao')]))
  const w = await worldFrom([seedRecord(), ...legacy])
  expect((await overview(w)).members.doubao?.wakeCount).toBe(6)
  const result = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'new', needsReply: true })
  expect(intents(w.events(result.seq)).map(e => [e.delivery.member, e.delivery.kind])).toEqual([['doubao', 'wake']])
  expect((await w.service.overview(w.read())).presence.doubao).not.toBe('paused')
})
