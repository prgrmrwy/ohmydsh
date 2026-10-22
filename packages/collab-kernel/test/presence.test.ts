import { expect, it } from 'vitest'
import { dispatchMembers, dispatchWorld } from './support/dispatch-world.js'
import { intents, member } from './support/world.js'

it('binding-01：不可达成员不记账', async () => {
  const w = await dispatchWorld()
  w.provider.observedPresence = 'unreachable'
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  expect(w.log().at(-1)?.events.some(e => e.type === 'dispatch/intended' && e.delivery.member === 'doubao')).toBe(false)
  expect((await w.service.overview(w.read())).presence.doubao).toBe('unreachable')
})

it('binding-02：不支持唤醒的绑定不记账', async () => {
  const pm = member('pm', 'a:pm', 'agent', 'active', 5)
  const members = [...dispatchMembers(), { ...pm, binding: { ...pm.binding, supports: { wake: false, confirm: false } } }]
  const w = await dispatchWorld([], members)
  const result = await w.service.sendMessage(w.ctx(), { to: 'pm', body: 'hello', needsReply: true })
  const events = w.events(result.seq)
  expect(events.some(e => e.type === 'message/sent' && e.message.to === 'pm')).toBe(true)
  expect(intents(events)).toEqual([])
  // Not counted either: the message wakes nobody.
  expect((await w.service.overview(w.read())).topicWakes[result.seq] ?? 0).toBe(0)
})
