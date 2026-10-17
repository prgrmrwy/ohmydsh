import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
import { world } from './support/world.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const input = { name: 'aily', address: 'a:1', kind: 'agent' as const }
const context = () => ({ spaceId: 'new', cmdId: 'create', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) })

it('create receipt cannot bypass service close', async () => {
  const service = new CollabService({ serviceId: 's', store: new MemStore(), providers: [new FakeProvider()] })
  const ctx = context()
  await service.createSpace(ctx, input)
  await service.close('new')
  await expect(service.createSpace(ctx, input)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
})

it('close drains pending store open without allowing late publication', async () => {
  const store = new MemStore(), gate = deferred<void>(), entered = deferred<void>()
  const original = store.open.bind(store)
  store.open = async id => { entered.resolve(); await gate.promise; await original(id) }
  const service = new CollabService({ serviceId: 's', store, providers: [] })
  const opening = service.open('new').then(() => undefined, error => error)
  await entered.promise
  let closed = false
  const closing = service.close('new').then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  gate.resolve()
  await closing
  expect(await opening).toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  await expect(service.createSpace(context(), input)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
})

it('close does not wait for claim and an old create cannot reopen after recovery', async () => {
  const store = new MemStore(), provider = new FakeProvider(), gate = deferred<void>(), entered = deferred<void>()
  const claim = provider.claim.bind(provider)
  provider.claim = async (...args) => { entered.resolve(); await gate.promise; return claim(...args) }
  const service = new CollabService({ serviceId: 's', store, providers: [provider] })
  const creating = service.createSpace(context(), input).then(() => undefined, error => error)
  await entered.promise
  let closed = false
  const closing = service.close('new').then(() => { closed = true })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const drainedWithoutClaim = closed
  // Always release the fixture even if close incorrectly waits for claim.
  if (!drainedWithoutClaim) gate.resolve()
  await closing
  expect(drainedWithoutClaim).toBe(true)
  await service.open('new')
  provider.claim = claim
  await service.createSpace(context(), input)
  gate.resolve()
  expect(await creating).toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  expect(await store.read('new', 0)).toHaveLength(1)
})

it('provider principal address is snapshotted before asynchronous presence', async () => {
  const w = await world(), gate = deferred<void>(), entered = deferred<void>()
  w.provider.presence = async () => { entered.resolve(); await gate.promise; return 'reachable' }
  const on = { channel: 'test-a', address: 'a:1' }
  const principal = principals.provider('P1', on)
  const writing = w.service.setStatus({ spaceId: 's', cmdId: 'snapshot-principal', principal }, { text: 'original actor' })
  await entered.promise
  on.address = 'a:2'
  gate.resolve()
  await writing
  const state = await w.service.overview(w.read())
  expect(state.members.aily?.statusText).toBe('original actor')
  expect(state.members.doubao?.statusText).toBe('')
})

it('service close drains an admitted commit even with an ungated store replacement', async () => {
  const w = await world(), entered = deferred<void>(), gate = deferred<void>()
  const commit = w.store.commit.bind(w.store), close = w.store.close.bind(w.store)
  let storeClosed = false
  w.store.commit = async (...args) => { entered.resolve(); await gate.promise; await commit(...args) }
  w.store.close = async id => { storeClosed = true; await close(id) }
  const writing = w.service.setStatus(w.ctx(), { text: 'durable before release' })
  await entered.promise
  const closing = w.service.close('s')
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(storeClosed).toBe(false)
  await expect(w.service.setStatus(w.ctx(), { text: 'too late' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  gate.resolve()
  await Promise.all([writing, closing])
  expect(storeClosed).toBe(true)
  await w.service.open('s')
  expect((await w.service.overview(w.read())).members.aily?.statusText).toBe('durable before release')
  expect(w.log()).toHaveLength(2)
})
