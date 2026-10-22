import { expect, it } from 'vitest'
import { CollabService } from '../src/index.js'
import { world } from './support/world.js'

it('normal close fences a delayed callback even when the same service reopens the space', async () => {
  const w = await world()
  let finish!: () => void
  w.provider.deliver = async () => new Promise<void>(resolve => { finish = resolve })
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'pending', needsReply: true })
  await expect.poll(() => typeof finish).toBe('function')
  const count = w.log().length
  await w.service.close('s')
  await w.service.open('s')
  finish()
  for (let i = 0; i < 100; i++) await Promise.resolve()
  expect(w.log()).toHaveLength(count)
  expect((await w.service.overview(w.read())).pendingDeliveries).toHaveLength(1)
  await w.service.close('s')
})

it('failed replay releases the storage handle so another instance can recover', async () => {
  const w = await world()
  await w.service.close('s')
  const record = w.store.records.get('s')![0]!
  const original = structuredClone(record.events)
  record.events = [{ type: 'member/statusText', actor: 'aily', name: 'missing', text: 'x' }]
  let opened = false
  const open = w.store.open.bind(w.store)
  const close = w.store.close.bind(w.store)
  w.store.open = async id => { if (opened) throw new Error('already locked'); await open(id); opened = true }
  w.store.close = async id => { await close(id); opened = false }
  const next = new CollabService({ serviceId: 'next', store: w.store, providers: [w.provider] })
  await expect(next.open('s')).rejects.toThrow()
  record.events = original
  await expect(next.open('s')).resolves.toBeUndefined()
  await next.close('s')
})
