import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { canonical } from '../src/service/index.js'
import { intents, rawCommand, rejectsCleanly, seedRecord, world, worldFrom } from './support/world.js'

it.each([[true, false], [false, true], [true, true], [false, false]])('notify=%s and needsReply=%s are independent', async (notify, needsReply) => {
  const w = await world()
  const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'SECRET', notify, needsReply })
  await w.settle()
  const state = await w.service.overview(w.read())
  expect(state.messages.at(-1)).toMatchObject({ notify, needsReply })
  expect(intents(w.events(sent.seq))).toHaveLength(notify ? 1 : 0)
  expect(w.provider.deliveries).toHaveLength(notify ? 1 : 0)
  expect(state.topicWakes[sent.seq] ?? 0).toBe(notify ? 1 : 0)
  expect(JSON.stringify(w.provider.deliveries)).not.toContain('SECRET')
})

it('omitted notify preserves legacy defaults', async () => {
  const w = await world()
  for (const extra of [{}, { needsReply: false }, { needsReply: true }]) {
    const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'legacy', ...extra })
    expect((await w.service.overview(w.read())).messages.at(-1)).toMatchObject({ notify: extra.needsReply ?? false, needsReply: extra.needsReply ?? false })
    expect(intents(w.events(sent.seq))).toHaveLength(extra.needsReply ? 1 : 0)
  }
})

it('invalid notify leaves no message, receipt or dispatch', async () => {
  const w = await world()
  for (const notify of [null, 'false', 0]) {
    const ctx = w.ctx()
    await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'x', notify: notify as unknown as boolean }), 'COLLAB_BAD_MESSAGE')
  }
})

it('old parameter hashes replay unchanged; explicit notify is part of the command identity', async () => {
  const input = { to: 'doubao', body: 'old result', needsReply: false }
  const receipt = { cmdId: 'old-command', payloadHash: createHash('sha256').update(canonical({ name: 'sendMessage', input })).digest('hex') }
  const w = await worldFrom([seedRecord(), rawCommand(2, [{ type: 'message/sent', actor: 'aily', message: { id: '2', actor: 'aily', ...input } }], receipt)])
  const ctx = w.ctx('aily', receipt.cmdId)
  expect(await w.service.sendMessage(ctx, input)).toEqual({ seq: 2, spaceId: 's' })
  expect(w.log()).toHaveLength(2)
  expect(w.provider.deliveries).toHaveLength(0)
  await rejectsCleanly(w, 'new-conflict-probe', () => w.service.sendMessage(ctx, { ...input, notify: false }), 'COLLAB_CMD_CONFLICT')
  const fresh = w.ctx('aily', 'new-notice'), next = { ...input, notify: true }
  const result = await w.service.sendMessage(fresh, next)
  await w.settle()
  const count = w.provider.deliveries.length
  await w.reopen()
  expect(await w.service.sendMessage(fresh, next)).toEqual(result)
  expect(w.provider.deliveries).toHaveLength(count)
  await expect(w.service.sendMessage(fresh, { ...next, notify: false })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' })
})

it('notification-only messages reach the topic limit and replay with the same counts', async () => {
  const w = await world()
  let root: number | undefined
  for (let i = 0; i < 20; i++) {
    const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: `result ${i}`, notify: true, needsReply: false, ...(root === undefined ? {} : { ref: root }) })
    root ??= sent.seq
  }
  await w.reopen()
  expect((await w.service.overview(w.read())).topicWakes[root!]).toBe(20)
  const ctx = w.ctx()
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'over', notify: true, needsReply: false, ref: root! }), 'COLLAB_THREAD_LIMIT')
  const silent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'later question', notify: false, needsReply: true, ref: root! })
  expect(intents(w.events(silent.seq))).toHaveLength(0)
  expect((await w.service.overview(w.read())).topicWakes[root!]).toBe(20)
})

it('unreachable notification does not consume the topic budget', async () => {
  const w = await world()
  w.provider.observedPresence = 'unreachable'
  const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'result', notify: true, needsReply: false })
  expect(intents(w.events(sent.seq))).toHaveLength(0)
  expect((await w.service.overview(w.read())).topicWakes[sent.seq]).toBeUndefined()
})

it('mode follows notify independently of needsReply', async () => {
  const w = await world(), mode = 'pet-locus:inquiry'
  w.provider.modes.add(mode)
  const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'result', notify: true, needsReply: false, mode })
  await w.settle()
  expect(intents(w.events(sent.seq))[0]?.delivery.pointer?.mode).toBe(mode)
  expect(w.provider.deliveries[0]?.pointer.mode).toBe(mode)
  const ctx = w.ctx()
  await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'silent', notify: false, needsReply: true, mode }), 'COLLAB_BAD_MODE')
})
