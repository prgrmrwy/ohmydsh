import { expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CollabService, FileStore, principals } from '../src/index.js'
import { FakeProvider } from './support/fake-provider.js'
import { MemStore } from './support/mem-store.js'
import { world } from './support/world.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const ctx = { spaceId: 's', cmdId: 'create', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }
const input = { name: 'aily', address: 'a:1', kind: 'agent' as const }
function fresh() {
  const store = new MemStore(), provider = new FakeProvider()
  const service = new CollabService({ serviceId: 'admission', store, providers: [provider] })
  return { service, store, provider }
}

it('create receipt cannot bypass service close; explicit open restores historical replay', async () => {
  const { service, store, provider } = fresh()
  const first = await service.createSpace(ctx, input)
  const commit = vi.spyOn(store, 'commit'), claim = vi.spyOn(provider, 'claim')
  await service.close('s')
  await expect.soft(service.createSpace(ctx, input)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  expect(commit).not.toHaveBeenCalled()
  expect(claim).not.toHaveBeenCalled()
  await service.open('s')
  expect(await service.createSpace(ctx, input)).toEqual(first)
  expect(store.records.get('s')).toHaveLength(1)
  await service.close('s')
})

it('create receipt cannot bypass failed storage; close/open restores historical replay', async () => {
  const { service, store } = fresh()
  const first = await service.createSpace(ctx, input)
  const commit = vi.spyOn(store, 'commit').mockRejectedValueOnce(new Error('injected commit failure'))
  await expect(service.setStatus({ ...ctx, cmdId: 'fail' }, { text: 'not committed' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  await expect.soft(service.createSpace(ctx, input)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  expect(commit).toHaveBeenCalledTimes(1)
  await service.close('s')
  await service.open('s')
  expect(await service.createSpace(ctx, input)).toEqual(first)
  expect(store.records.get('s')).toHaveLength(1)
  await service.close('s')
})

it.each(['open', 'read'] as const)('close fences an already admitted deferred store.%s without reviving service access', async stage => {
  const w = await world()
  await w.service.close('s')
  const entered = deferred(), release = deferred()
  if (stage === 'open') {
    const open = w.store.open.bind(w.store)
    vi.spyOn(w.store, 'open').mockImplementation(async id => {
      entered.resolve(); await release.promise; await open(id)
    })
  } else {
    const read = w.store.read.bind(w.store)
    vi.spyOn(w.store, 'read').mockImplementation(async (id, from) => {
      const records = await read(id, from)
      entered.resolve(); await release.promise; return records
    })
  }
  const service = w.service
  const commit = vi.spyOn(w.store, 'commit')
  const opening = service.open('s')
  // Attach rejection handling before close invalidates the outstanding operation.
  const opened = Promise.allSettled([opening])
  await entered.promise
  const closing = service.close('s')
  release.resolve()
  await Promise.all([opened, closing])
  await expect.soft(service.readSince(w.read(), 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  await expect.soft(service.setStatus(w.ctx(), { text: 'after close' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  expect.soft(commit).not.toHaveBeenCalled()
  expect.soft(w.log()).toHaveLength(1)
  await service.close('s')
  await service.open('s')
  expect.soft(await service.readSince(w.read(), 0)).toHaveLength(1)
  await service.close('s')
})

it('close blocks new open, reads and writes while the owned store handle is still draining', async () => {
  const w = await world()
  const entered = deferred(), release = deferred()
  const close = w.store.close.bind(w.store)
  vi.spyOn(w.store, 'close').mockImplementation(async id => {
    entered.resolve(); await release.promise; await close(id)
  })
  const open = vi.spyOn(w.store, 'open'), commit = vi.spyOn(w.store, 'commit')
  const closing = w.service.close('s')
  await entered.promise
  const attempts = Promise.allSettled([
    w.service.open('s'),
    w.service.readSince(w.read(), 0),
    w.service.setStatus(w.ctx(), { text: 'while closing' }),
  ])
  try {
    expect.soft(open).not.toHaveBeenCalled()
  } finally {
    release.resolve()
    await closing
  }
  for (const result of await attempts) {
    expect.soft(result).toMatchObject({ status: 'rejected', reason: { code: 'COLLAB_STORE_FAILED' } })
  }
  expect.soft(commit).not.toHaveBeenCalled()
  expect.soft(w.log()).toHaveLength(1)
  await expect.soft(w.service.readSince(w.read(), 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  await w.service.open('s')
  expect.soft(await w.service.readSince(w.read(), 0)).toHaveLength(1)
  await w.service.close('s')
})

it('close invalidates create admitted before a pending claim without reopening or persisting it', async () => {
  const { service, store, provider } = fresh()
  const entered = deferred(), release = deferred()
  const claim = provider.claim.bind(provider)
  vi.spyOn(provider, 'claim').mockImplementation(async (address, kind) => {
    entered.resolve(); await release.promise; return claim(address, kind)
  })
  const open = vi.spyOn(store, 'open'), commit = vi.spyOn(store, 'commit')
  const creating = service.createSpace(ctx, input)
  const created = Promise.allSettled([creating])
  await entered.promise
  const closing = service.close('s')
  // Claim has no bounded duration contract: close may wait for it, but must fence its eventual write.
  release.resolve()
  await closing
  const [result] = await created
  expect.soft(result).toMatchObject({ status: 'rejected', reason: { code: 'COLLAB_STORE_FAILED' } })
  expect.soft(open).not.toHaveBeenCalled()
  expect.soft(commit).not.toHaveBeenCalled()
  expect.soft(store.records.has('s')).toBe(false)
  await service.close('s')
  await service.open('s')
  expect(await service.createSpace(ctx, input)).toEqual({ seq: 1, spaceId: 's' })
  expect(store.records.get('s')).toHaveLength(1)
  await service.close('s')
})

async function diskFixture() {
  const parent = await realpath(tmpdir())
  const root = await realpath(await mkdtemp(path.join(parent, 'collab-admission-')))
  const store = new FileStore(root, { instanceId: 'admission-owner' })
  const service = new CollabService({ serviceId: 'disk-admission', store, providers: [new FakeProvider()] })
  return { root, service, cleanup: async () => {
    await service.close('s')
    const target = await realpath(root)
    if (target !== root || path.dirname(target) !== parent || !path.basename(target).startsWith('collab-admission-')) throw new Error('unsafe fixture cleanup')
    await rm(target, { recursive: true, force: true })
  } }
}

it('repeated service open preserves its current FileStore lock and usable handle', async () => {
  const { root, service, cleanup } = await diskFixture()
  try {
    await service.createSpace(ctx, input)
    const lock = await readFile(path.join(root, 's.lock'), 'utf8')
    // Duplicate open may be idempotent or rejected; neither outcome may close the existing handle.
    await service.open('s').catch(error => expect(['COLLAB_STORE_FAILED', 'COLLAB_STORE_LOCKED']).toContain(error.code))
    expect(await readFile(path.join(root, 's.lock'), 'utf8')).toBe(lock)
    expect(await service.readSince(ctx, 0)).toHaveLength(1)
    await service.setStatus({ ...ctx, cmdId: 'still-owned' }, { text: 'usable' })
    expect(await service.readSince(ctx, 0)).toHaveLength(2)
  } finally { await cleanup() }
})

it('failed service open cannot close another FileStore instance owner', async () => {
  const { root, service, cleanup } = await diskFixture()
  const other = new CollabService({ serviceId: 'contender', store: new FileStore(root, { instanceId: 'admission-contender' }), providers: [new FakeProvider()] })
  try {
    await service.createSpace(ctx, input)
    const lock = await readFile(path.join(root, 's.lock'), 'utf8')
    await expect(other.open('s')).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED' })
    expect(await readFile(path.join(root, 's.lock'), 'utf8')).toBe(lock)
    await service.setStatus({ ...ctx, cmdId: 'owner-still-live' }, { text: 'usable' })
    await service.close('s')
    await other.open('s')
    expect(await other.readSince(ctx, 0)).toHaveLength(2)
  } finally {
    await other.close('s')
    await cleanup()
  }
})
