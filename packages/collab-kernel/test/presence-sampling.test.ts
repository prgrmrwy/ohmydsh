import { expect, it, vi } from 'vitest'
import { defaultMembers, world } from './support/world.js'

it('presence is sampled once before queue admission and later changes do not rewrite the intent', async () => {
  const w = await world()
  const realCommit = w.store.commit.bind(w.store)
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(resolve => { entered = resolve })
  w.store.commit = async (...args) => {
    entered()
    await new Promise<void>(resolve => { release = resolve })
    return realCommit(...args)
  }
  const first = w.service.setStatus(w.ctx(), { text: 'occupy queue' })
  await blocked
  w.store.commit = realCommit
  const presence = vi.spyOn(w.provider, 'presence')
  w.provider.observedPresence = 'reachable'
  const pending = w.service.sendMessage(w.ctx('aily', 'queued'), { to: 'doubao', body: 'message', needsReply: true })
  await expect.poll(() => presence.mock.calls.length).toBe(defaultMembers().length)
  w.provider.observedPresence = 'unreachable'
  release()
  await first
  const result = await pending
  const command = w.log().find(r => r.seq === result.seq)!
  expect(command.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'dispatch/intended', delivery: expect.objectContaining({ member: 'doubao', kind: 'wake' }) })]))
  expect(presence).toHaveBeenCalledTimes(defaultMembers().length)
})

it('a pending provider delivery cannot hold the space serial queue or close', async () => {
  const w = await world()
  let called = false
  w.provider.deliver = async () => { called = true; return new Promise<void>(() => {}) }
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'pending forever', needsReply: true })
  expect(called).toBe(true)
  await w.service.setStatus(w.ctx(), { text: 'queue still works' })
  expect((await w.service.overview(w.read())).members.aily!.statusText).toBe('queue still works')
  await w.service.close('s')
  await expect(w.service.overview(w.read())).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
})
