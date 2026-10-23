import { expect, it } from 'vitest'
import { FakeProvider } from './support/fake-provider.js'
import { intents, member, rejectsCleanly, world } from './support/world.js'

const MODE = 'pet-locus:inquiry'
const message = (events: { type: string }[]) => { const e = events.find(e => e.type === 'message/sent') as { message: Record<string, unknown> } | undefined; return e?.message }

it('mode-01：支持的方式随投递传递', async () => {
  const w = await world()
  w.provider.modes.add(MODE)
  const result = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'question', needsReply: true, mode: MODE })
  await w.settle()
  const events = w.events(result.seq)
  expect(message(events)?.mode).toBe(MODE)
  const wakes = intents(events)
  expect(wakes).toHaveLength(1)
  expect(wakes[0]!.delivery.mode).toBe(MODE)
  expect(wakes[0]!.delivery.pointer!.mode).toBe(MODE)
  expect(w.provider.deliveries).toHaveLength(1)
  expect(w.provider.deliveries[0]!.pointer.mode).toBe(MODE)
  expect((await w.service.overview(w.read())).topicWakes[result.seq]).toBe(1)
})

it('mode-02：不支持或非法方式被拒', async () => {
  const w = await world()
  w.provider.modes.add(MODE)
  const cases: [string, Record<string, unknown>, string][] = [
    ['unsupported', { needsReply: true, mode: 'x:y' }, 'COLLAB_MODE_UNSUPPORTED'],
    ['format', { needsReply: true, mode: 'inquiry' }, 'COLLAB_BAD_MODE'],
    ['no-reply', { needsReply: false, mode: MODE }, 'COLLAB_BAD_MODE'],
    ['reply-absent', { mode: MODE }, 'COLLAB_BAD_MODE'],
    ['upper', { needsReply: true, mode: 'Pet:inquiry' }, 'COLLAB_BAD_MODE'],
    ['non-string', { needsReply: true, mode: 7 }, 'COLLAB_BAD_MODE'],
    ['too-long', { needsReply: true, mode: `a:${'b'.repeat(33)}` }, 'COLLAB_BAD_MODE'],
    ['longest', { needsReply: true, mode: `a:${'b'.repeat(32)}` }, 'COLLAB_MODE_UNSUPPORTED'],
  ]
  for (const [label, extra, code] of cases) {
    const ctx = w.ctx('aily', `mode-${label}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'x', ...extra } as never), code, label)
  }
  // A provider without supportsMode supports nothing.
  const plain = new FakeProvider('P2', 'test-b', 'b:')
  ;(plain as { supportsMode?: unknown }).supportsMode = undefined
  const v = await world([], [member('aily', 'a:1'), { ...member('bee', 'b:1', 'agent', 'active', 2), binding: { channel: 'test-b', address: 'b:1', supports: { wake: true, confirm: false } } }], [plain])
  const ctx = v.ctx('aily', 'mode-none')
  await rejectsCleanly(v, ctx.cmdId, () => v.service.sendMessage(ctx, { to: 'bee', body: 'x', needsReply: true, mode: MODE }), 'COLLAB_MODE_UNSUPPORTED')
  // Order: after ref, so a dangling ref wins over an unsupported mode.
  await expect(w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'x', needsReply: true, mode: 'x:y', ref: 999 })).rejects.toMatchObject({ code: 'COLLAB_BAD_REF' })
})

it('mode-03：supportsMode 抛错视为不支持', async () => {
  const w = await world()
  w.provider.supportsMode = () => { throw new Error('registry gone') }
  const ctx = w.ctx('aily', 'mode-throws')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'x', needsReply: true, mode: MODE }), 'COLLAB_MODE_UNSUPPORTED')
  await expect(w.service.setStatus(w.ctx(), { text: 'space not failed' })).resolves.toBeDefined()
  // Non-true return values are unsupported too.
  w.provider.supportsMode = (() => 'yes') as never
  await expect(w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'x', needsReply: true, mode: MODE })).rejects.toMatchObject({ code: 'COLLAB_MODE_UNSUPPORTED' })
})

it('mode-04：方式不绕过话题上限', async () => {
  const w = await world()
  w.provider.modes.add(MODE)
  let root: number | undefined, speaker = 'aily'
  for (let i = 0; i < 20; i++) {
    const r = await w.service.sendMessage(w.ctx(speaker), { to: speaker === 'aily' ? 'doubao' : 'aily', body: `turn ${i}`, needsReply: true, ...(root === undefined ? {} : { ref: root }) })
    root ??= r.seq
    speaker = speaker === 'aily' ? 'doubao' : 'aily'
  }
  const ctx = w.ctx('aily', 'mode-limit')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'over', needsReply: true, ref: root!, mode: MODE }), 'COLLAB_THREAD_LIMIT')
})

it('mode-05：普通唤醒不带方式', async () => {
  const w = await world()
  w.provider.modes.add(MODE)
  const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'plain', needsReply: true })
  const invited = await w.service.invite(w.ctx(), { name: 'alice', address: 'a:42', kind: 'agent' })
  await w.settle()
  expect(message(w.events(sent.seq))).not.toHaveProperty('mode')
  const wakes = [...intents(w.events(sent.seq)), ...intents(w.events(invited.seq))]
  expect(wakes).toHaveLength(2)
  for (const wake of wakes) { expect(wake.delivery).not.toHaveProperty('mode'); expect(wake.delivery.pointer).not.toHaveProperty('mode') }
  expect(w.provider.deliveries).toHaveLength(2)
  for (const d of w.provider.deliveries) expect(d.pointer).not.toHaveProperty('mode')
  // Completion notices never carry a mode.
  await w.service.createItem(w.ctx('aily'), { itemId: 'R1', kind: 'request', assignee: 'doubao', title: 'R1', body: '', requiredAcks: [] })
  await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'accepted' })
  const done = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'done' })
  const notice = intents(w.events(done.seq))
  expect(notice).toHaveLength(1)
  expect(notice[0]!.delivery).not.toHaveProperty('mode')
})
