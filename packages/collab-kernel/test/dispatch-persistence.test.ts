import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CollabService, FileStore, principals, type CollabEvent } from '../src/index.js'
import { FakeProvider } from './support/fake-provider.js'
import { faultyFs } from './support/faulty-fs.js'
import { dispatchWorld } from './support/dispatch-world.js'

const closers: (() => Promise<void>)[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map(close => close()))
  const temporaryRoot = await realpath(tmpdir())
  for (const dir of roots.splice(0)) {
    const resolved = await realpath(dir)
    const within = relative(temporaryRoot, resolved)
    if (!within || within.startsWith('..') || isAbsolute(within) || !resolved.includes('collab-dispatch-')) throw new Error('refuse unexpected cleanup target')
    await rm(resolved, { recursive: true, force: true })
  }
})

it('dispatch-08：投递完成可持久化重放且无命令收据', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'collab-dispatch-')))
  roots.push(dir)
  const provider = new FakeProvider()
  const store = new FileStore(dir)
  const service = new CollabService({ serviceId: 'x', store, providers: [provider] })
  closers.push(() => service.close('s'))
  const principal = principals.agent({ channel: 'test-a', address: 'a:1' })
  const read = { spaceId: 's', principal }
  await service.createSpace({ ...read, cmdId: 'create' }, { name: 'aily', kind: 'agent', address: 'a:1' })
  await service.invite({ ...read, cmdId: 'invite' }, { name: 'doubao', kind: 'agent', address: 'a:2' })
  await expect.poll(async () => (await service.overview(read)).inFlightDeliveries.length).toBe(0)
  const completion = (await service.readSince(read, 0)).find(r => r.kind === 'completion')!
  expect(completion).toBeDefined()
  expect(completion.events).toHaveLength(1)
  expect(completion.events[0]).toMatchObject({ type: 'dispatch/completed', outcome: 'succeeded', actor: 'system:dispatch' })
  expect(completion).not.toHaveProperty('receipt')
  expect(completion).not.toHaveProperty('cmdId')
  expect(completion).not.toHaveProperty('scope')
  const deliveryId = (completion.events[0] as Extract<CollabEvent, { type: 'dispatch/completed' }>).deliveryId
  await service.close('s')
  const next = new CollabService({ serviceId: 'y', store: new FileStore(dir), providers: [provider] })
  closers.push(() => next.close('s'))
  const calls = provider.deliveries.length
  await next.open('s')
  expect((await next.overview(read)).deliveries[deliveryId]?.outcome).toBe('succeeded')
  expect((await next.overview(read)).pendingDeliveries.some(d => d.deliveryId === deliveryId)).toBe(false)
  expect(provider.deliveries).toHaveLength(calls)
})

it('dispatch-10：completed整行落盘后fsync失败按日志恢复且不重投', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'collab-dispatch-')))
  roots.push(dir)
  const fault = { failSync: false }
  const provider = new FakeProvider()
  let finish!: () => void
  vi.spyOn(provider, 'deliver').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const service = new CollabService({ serviceId: 'x', store: new FileStore(dir, { fs: faultyFs(fault) }), providers: [provider] })
  closers.push(() => service.close('s'))
  const read = { spaceId: 's', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }
  await service.createSpace({ ...read, cmdId: 'create' }, { name: 'aily', kind: 'agent', address: 'a:1' })
  await service.invite({ ...read, cmdId: 'invite' }, { name: 'doubao', kind: 'agent', address: 'a:2' })
  await expect.poll(() => typeof finish).toBe('function')
  const before = await service.overview(read)
  const deliveryId = before.inFlightDeliveries[0]!.deliveryId
  fault.failSync = true
  finish()
  await expect.poll(async () => {
    try { await service.overview(read); return false } catch (e) { return (e as { code?: string }).code === 'COLLAB_STORE_FAILED' }
  }).toBe(true)
  await service.close('s')
  const calls = provider.deliveries.length
  const next = new CollabService({ serviceId: 'y', store: new FileStore(dir), providers: [provider] })
  closers.push(() => next.close('s'))
  await next.open('s')
  const records = await next.readSince(read, 0)
  expect(records.flatMap(r => r.events).filter(e => e.type === 'dispatch/completed' && e.deliveryId === deliveryId)).toHaveLength(1)
  expect((await next.overview(read)).deliveries[deliveryId]?.outcome).toBe('succeeded')
  expect((await next.overview(read)).pendingDeliveries.some(d => d.deliveryId === deliveryId)).toBe(false)
  expect(provider.deliveries).toHaveLength(calls)
})

it('failed空间的晚到SPI结果不发起完成提交', async () => {
  const w = await dispatchWorld()
  let finish!: () => void
  vi.spyOn(w.provider, 'deliver').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'pending', needsReply: true })
  await expect.poll(() => typeof finish).toBe('function')
  const commit = vi.spyOn(w.store, 'commit').mockRejectedValueOnce(new Error('injected failure'))
  await expect(w.service.setStatus(w.ctx(), { text: 'fail' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  const count = w.log().length
  const calls = commit.mock.calls.length
  finish()
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(commit).toHaveBeenCalledTimes(calls)
  expect(w.log()).toHaveLength(count)
  await w.service.close('s')
  const next = new CollabService({ serviceId: 'y', store: w.store, providers: [w.provider] })
  await next.open('s')
  expect((await next.overview(w.read())).pendingDeliveries).toHaveLength(1)
  await next.close('s')
})
