import { it, expect } from 'vitest'
import { CollabHost } from '../src/host.js'
import { FileStore } from 'collab-kernel'
import { mkdtemp, realpath, rm, readdir, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'

async function fixture(run: (root: string) => Promise<void>) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'collab-host-unit-'))
  try { await run(root) } finally {
    const checked = await realpath(root)
    expect(dirname(checked)).toBe(parent); expect(basename(checked).startsWith('collab-host-unit-')).toBe(true)
    await rm(checked, { recursive: true })
  }
}
const provider: any = { id: 'test', channel: 'dsh-session', claim: async (address: string) => ({ channel: 'dsh-session', address, supports: { wake: true, confirm: false } }), deliver: async () => {}, presence: async () => 'unknown' }

it('host-admission: unclaimed address refuses and closed Host rejects reads', () => fixture(async root => {
  const host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [])
  try {
    await expect(host.command('a', 's', 'cmd', service => service.createSpace(host.context('a', 's', 'cmd'), { name: 'a', address: 'a', kind: 'agent' }))).rejects.toMatchObject({ code: 'COLLAB_ADDRESS_UNCLAIMED' })
    await host.close()
    await expect(host.read('a', 's', service => service.overview(host.context('a', 's')))).rejects.toMatchObject({ code: 'COLLAB_SERVICE_CLOSING' })
  } finally { await host.close() }
}))

it('host-claim-close: pending admitted claim is fenced without waiting for external provider', () => fixture(async root => {
  let release!: (value: any) => void
  let entered!: () => void
  const claiming = new Promise<void>(resolve => { entered = resolve })
  const slow: any = { ...provider, claim() { entered(); return new Promise(resolve => { release = resolve }) } }
  const host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [slow])
  try {
    const pending = host.command('a', 'pending', 'cmd', service => service.createSpace(host.context('a', 'pending', 'cmd'), { name: 'a', address: 'a', kind: 'agent' }))
    const observed = pending.catch(error => error)
    await claiming
    await host.close()
    release({ channel: 'dsh-session', address: 'a', supports: { wake: true, confirm: false } })
    expect((await observed).code).toBeDefined()
    expect(await readdir(join(root, 'data'))).toEqual([])
  } finally { await host.close() }
}))

it('host-lock-only: orphan lock without log is not enumerated or taken over by create', () => fixture(async root => {
  const dataDir = join(root, 'data')
  const seed = await CollabHost.create({ dataDir }, [], [provider])
  await seed.close()
  const lockPath = join(dataDir, 'orphan.lock'), lockBytes = JSON.stringify({ instanceId: 'foreign', pid: process.pid })
  await writeFile(lockPath, lockBytes)
  const host = await CollabHost.create({ dataDir }, [], [provider])
  try {
    expect(host.tracked.has('orphan')).toBe(false)
    await expect(host.command('a', 'orphan', 'create', service => service.createSpace(host.context('a', 'orphan', 'create'), { name: 'a', address: 'a', kind: 'agent' }))).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED' })
    expect(await readFile(lockPath, 'utf8')).toBe(lockBytes)
    await expect(readFile(join(dataDir, 'orphan.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
    await host.command('a', 'healthy', 'create', service => service.createSpace(host.context('a', 'healthy', 'create'), { name: 'a', address: 'a', kind: 'agent' }))
    expect((await stat(join(dataDir, 'healthy.lock'))).mode & 0o777).toBe(0o600)
  } finally { await host.close() }
  expect(await readFile(lockPath, 'utf8')).toBe(lockBytes)
}))

it('host-isolation: corrupt and locked spaces retain diagnostics without blocking healthy state', () => fixture(async root => {
  const dataDir = join(root, 'data')
  let host = await CollabHost.create({ dataDir }, [], [provider])
  try {
    await host.command('a', 'healthy', 'create', service => service.createSpace(host.context('a', 'healthy', 'create'), { name: 'a', address: 'a', kind: 'agent' }))
  } finally { await host.close() }
  await writeFile(join(dataDir, 'locked.jsonl'), '')
  const foreign = new FileStore(dataDir)
  await foreign.open('locked')
  await writeFile(join(dataDir, 'corrupt.jsonl'), 'invalid complete line\n')
  host = await CollabHost.create({ dataDir }, [], [provider])
  try {
    await expect(host.read('a', 'locked', service => service.overview(host.context('a', 'locked')))).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED' })
    await expect(host.read('a', 'corrupt', service => service.overview(host.context('a', 'corrupt')))).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    expect((await host.read('a', 'healthy', service => service.overview(host.context('a', 'healthy')))).members.a.status).toBe('active')
    expect(await readFile(join(dataDir, 'corrupt.jsonl'), 'utf8')).toBe('invalid complete line\n')
  } finally { await host.close(); await foreign.close('locked') }
}))

it('host-close-drain: one close rejection cannot finish shutdown before another real store drains', () => fixture(async root => {
  const host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [provider])
  for (const id of ['failed', 'healthy']) await host.command('a', id, 'create', service => service.createSpace(host.context('a', id, 'create'), { name: 'a', address: 'a', kind: 'agent' }))
  const close = host.store.close.bind(host.store)
  let entered!: () => void, release!: () => void
  const closing = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  host.store.close = async id => {
    if (id === 'failed') throw new Error('injected close failure')
    entered(); await barrier; await close(id)
  }
  let settled = false
  const observed = host.close().then(() => { settled = true; return undefined }, error => { settled = true; return error })
  try {
    await closing
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    expect(await readdir(host.config.dataDir)).toContain('healthy.lock')
    release()
    expect(await observed).toBeInstanceOf(AggregateError)
    expect(await readdir(host.config.dataDir)).not.toContain('healthy.lock')
    expect(await readdir(host.config.dataDir)).toContain('failed.lock')
  } finally { release(); await observed; await close('failed') }
}))

it('host-human-history: legitimate persisted human with no confirmation channel remains awaitingChannel', () => fixture(async root => {
  const dataDir = join(root, 'data')
  let host = await CollabHost.create({ dataDir }, [], [provider])
  const serviceId = host.config.serviceId
  await host.close()
  const store = new FileStore(dataDir)
  await store.open('history')
  const agent = { name: 'a', kind: 'agent', status: 'active', joinSeq: 1, binding: { channel: 'dsh-session', address: 'a', supports: { wake: true, confirm: false } }, statusText: '', wakeCount: 0 }
  const human = { ...agent, name: 'pm', kind: 'human', binding: { channel: 'historic-human', address: 'pm', supports: { wake: false, confirm: false } } }
  await store.commit('history', {
    kind: 'command', seq: 1,
    receipt: { cmdId: 'historical-import', scope: { kind: 'create', channel: 'dsh-session', address: 'a' }, payloadHash: 'historical-fixture', result: { seq: 1, spaceId: 'history' } },
    events: [
      { type: 'space/created', actor: 'a', spaceId: 'history', serviceId, leader: 'a', convention: { version: '1', sha256: 'historic' } },
      { type: 'member/joined', actor: 'a', member: agent },
      { type: 'member/joined', actor: 'pm', member: human },
      { type: 'item/created', actor: 'a', item: { id: 'i', kind: 'other', author: 'a', title: 'Title', body: '', revision: 1, status: 'draft', requiredAcks: [], deciders: ['pm'], acks: {}, agentEditCount: 0 } },
    ],
  } as any, 0)
  await store.close('history')
  // Consumer has ONLY the agent provider; historical humans are not fabricated
  // by an exposed command or granted a provider principal at this boundary.
  host = await CollabHost.create({ dataDir }, [], [provider])
  try {
    const result = await host.command('a', 'history', 'decision', service => service.requestDecision(host.context('a', 'history', 'decision'), { itemId: 'i', options: ['yes', 'no'] }))
    const state = await host.read('a', 'history', service => service.overview(host.context('a', 'history')))
    expect(state.requests[result.requestId!]).toMatchObject({ status: 'open', awaitingChannel: true, deciders: ['pm'] })
    expect(state.decisions).toEqual([])
    expect(state.pendingDeliveries).toEqual([])
    const records = (await readFile(join(dataDir, 'history.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records.flatMap(record => record.events).some(event => event.type === 'decision/decided' || event.type === 'dispatch/intended')).toBe(false)
  } finally { await host.close() }
}))

it('host-fsync-drain: close waits for an admitted physical commit and rejects later admission', () => fixture(async root => {
  const host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [provider])
  const io = (host.store as any).fs, open = io.open.bind(io)
  let entered!: () => void, release!: () => void
  const syncing = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  io.open = async (...args: any[]) => {
    const handle = await open(...args)
    if (args[1] !== 'a') return handle
    return new Proxy(handle, { get(target, key) {
      if (key === 'sync') return async () => { entered(); await barrier; await target.sync() }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
  const pending = host.command('a', 's', 'create', service => service.createSpace(host.context('a', 's', 'create'), { name: 'a', address: 'a', kind: 'agent' }))
  await syncing
  let settled = false
  const closing = host.close().then(() => { settled = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    await expect(host.read('a', 's', service => service.overview(host.context('a', 's')))).rejects.toMatchObject({ code: 'COLLAB_SERVICE_CLOSING' })
    expect(await readdir(host.config.dataDir)).toContain('s.lock')
    release()
    await pending.catch(() => {}) // close can fence the caller after durable append
    await closing
    expect(await readdir(host.config.dataDir)).not.toContain('s.lock')
    const reopened = await CollabHost.create({ dataDir: host.config.dataDir }, [], [provider])
    try { expect((await reopened.service.overview(reopened.context('a', 's'))).members.a.status).toBe('active') }
    finally { await reopened.close() }
  } finally { release(); await pending.catch(() => {}); await closing }
}))

it('host-pending-replay: reopening unknown delivery preserves pending and never calls provider again', () => fixture(async root => {
  const dataDir = join(root, 'data')
  let host = await CollabHost.create({ dataDir }, [], [provider])
  const serviceId = host.config.serviceId
  await host.close()
  const store = new FileStore(dataDir)
  await store.open('s')
  const member = { name: 'a', kind: 'agent', status: 'active', joinSeq: 1, binding: { channel: 'dsh-session', address: 'a', supports: { wake: true, confirm: false } }, statusText: '', wakeCount: 0 }
  await store.commit('s', { kind: 'command', seq: 1, receipt: { cmdId: 'historical', scope: { kind: 'create', channel: 'dsh-session', address: 'a' }, payloadHash: 'historic', result: { seq: 1, spaceId: 's' } }, events: [
    { type: 'space/created', actor: 'a', spaceId: 's', serviceId, leader: 'a', convention: { version: '1', sha256: 'historic' } },
    { type: 'member/joined', actor: 'a', member },
    { type: 'dispatch/intended', actor: 'a', delivery: { deliveryId: 'historic-pending', member: 'a', kind: 'wake', providerId: 'test', pointer: { spaceId: 's', toSeq: 1, counts: { message: 0, item: 0, decision: 0, member: 1 }, from: 'a' } } },
  ] } as any, 0)
  await store.close('s')
  const before = await readFile(join(dataDir, 's.jsonl'))
  let sends = 0
  host = await CollabHost.create({ dataDir }, [], [{ ...provider, deliver: async () => { sends++ } }])
  try {
    const state = await host.read('a', 's', service => service.overview(host.context('a', 's')))
    expect(state.pendingDeliveries.map(delivery => delivery.deliveryId)).toEqual(['historic-pending'])
    await new Promise(resolve => setImmediate(resolve))
    expect(sends).toBe(0)
    expect(await readFile(join(dataDir, 's.jsonl'))).toEqual(before)
  } finally { await host.close() }
}))

it('host-fsync-failure: failed commit cannot report success and retry after reopen resolves by durable receipt', () => fixture(async root => {
  const dataDir = join(root, 'data')
  let host = await CollabHost.create({ dataDir }, [], [provider])
  const io = (host.store as any).fs
  const open = io.open.bind(io)
  let fail = true
  io.open = async (...args: any[]) => {
    const handle = await open(...args)
    if (args[1] !== 'a') return handle
    return new Proxy(handle, { get(target, key) {
      if (key === 'sync') return async () => { if (fail) throw new Error('injected fsync failure'); await target.sync() }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
  const create = () => host.command('a', 's', 'create', service => service.createSpace(host.context('a', 's', 'create'), { name: 'a', address: 'a', kind: 'agent' }))
  try {
    await expect(create()).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    fail = false
    await expect(create()).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await host.close()
    host = await CollabHost.create({ dataDir }, [], [provider])
    expect(await create()).toEqual({ seq: 1, spaceId: 's' })
    const records = (await readFile(join(dataDir, 's.jsonl'), 'utf8')).trim().split('\n')
    expect(records).toHaveLength(1)
  } finally { await host.close() }
}))

it('host-late-delivery: close does not await unresolved provider and late completion never persists', () => fixture(async root => {
  let entered!: () => void, release!: () => void
  const sending = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  const slow = { ...provider, deliver: async () => { entered(); await barrier } }
  const host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [slow])
  try {
    await host.command('a', 's', 'create', service => service.createSpace(host.context('a', 's', 'create'), { name: 'a', address: 'a', kind: 'agent' }))
    await host.command('a', 's', 'invite', service => service.invite(host.context('a', 's', 'invite'), { name: 'b', address: 'b', kind: 'agent' }))
    await sending
    await host.close()
    const path = join(host.config.dataDir, 's.jsonl')
    const before = await readFile(path)
    release()
    for (let turn = 0; turn < 5; turn++) await new Promise(resolve => setImmediate(resolve))
    expect(await readFile(path)).toEqual(before)
    expect(before.toString()).not.toContain('dispatch/completed')
  } finally { release(); await host.close() }
}))

it('host-location-commit: location invalidated during provider sampling refuses physical commit', () => fixture(async root => {
  let entered!: () => void, release!: () => void
  const sampled = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  let blocked = false, invalidate = false
  const sampling = { ...provider, presence: async () => { if (blocked) { entered(); await barrier }; return 'unknown' as const } }
  const host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [sampling])
  host.admissionCheck = () => { if (invalidate) throw new Error('invalid location') }
  try {
    await host.command('a', 's', 'create', service => service.createSpace(host.context('a', 's', 'create'), { name: 'a', address: 'a', kind: 'agent' }))
    const path = join(host.config.dataDir, 's.jsonl'), before = await readFile(path)
    blocked = true
    const pending = host.command('a', 's', 'status', service => service.setStatus(host.context('a', 's', 'status'), { text: 'not persisted' }))
    const observed = pending.catch(error => error)
    await sampled
    invalidate = true; release()
    expect(await observed).toBeInstanceOf(Error)
    expect(await readFile(path)).toEqual(before)
  } finally { release(); await host.close() }
}))

it('host-startup-close: dispose during first replay opens no later spaces and releases admitted handles', () => fixture(async root => {
  const dataDir = join(root, 'data')
  let seed = await CollabHost.create({ dataDir }, [], [provider])
  for (const id of ['a', 'b']) await seed.command('a', id, 'create', service => service.createSpace(seed.context('a', id, 'create'), { name: 'a', address: 'a', kind: 'agent' }))
  await seed.close()
  let host!: CollabHost, entered!: () => void, release!: () => void
  const opening = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  const opened: string[] = []
  const start = CollabHost.create({ dataDir }, [], [provider], value => {
    host = value
    const open = value.store.open.bind(value.store)
    value.store.open = async id => { opened.push(id); await open(id); entered(); await barrier }
  })
  await opening
  const closing = host.close()
  release()
  await start; await closing
  expect(opened).toEqual(['a'])
  expect((await readdir(dataDir)).filter(name => name.endsWith('.lock'))).toEqual([])
}))

it('host-startup-location: changing declared workspace during replay stops later opens without touching their logs', () => fixture(async root => {
  const dataDir = join(root, 'data')
  const seed = await CollabHost.create({ dataDir }, [], [provider])
  for (const id of ['a', 'b']) await seed.command('a', id, 'create', service => service.createSpace(seed.context('a', id, 'create'), { name: 'a', address: 'a', kind: 'agent' }))
  await seed.close()
  const before = await readFile(join(dataDir, 'b.jsonl'))
  let entered!: () => void, release!: () => void, invalid = false
  const opening = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  const opens: string[] = []
  const pending = CollabHost.create({ dataDir }, [], [provider], host => {
    host.admissionCheck = () => { if (invalid) throw new Error('workspace overlap') }
    const open = host.store.open.bind(host.store)
    host.store.open = async id => { opens.push(id); await open(id); entered(); await barrier }
  })
  const observed = pending.catch(error => error)
  await opening
  invalid = true; release()
  expect(await observed).toBeInstanceOf(Error)
  expect(opens).toEqual(['a'])
  expect(await readFile(join(dataDir, 'b.jsonl'))).toEqual(before)
  expect((await readdir(dataDir)).filter(name => name.endsWith('.lock'))).toEqual([])
}))

it('host-replay: command retry and service identity survive physical close/reopen', () => fixture(async root => {
  let host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [provider])
  try {
    const create = () => host.command('a', 's', 'cmd', service => service.createSpace(host.context('a', 's', 'cmd'), { name: 'a', address: 'a', kind: 'agent' }))
    const first = await create()
    expect(await create()).toEqual(first)
    const serviceId = host.config.serviceId
    await host.close()
    host = await CollabHost.create({ dataDir: join(root, 'data') }, [], [provider])
    expect(host.config.serviceId).toBe(serviceId)
    expect(await create()).toEqual(first)
    const state = await host.service.overview(host.context('a', 's'))
    expect(state.members.a.binding.address).toBe('a')
    expect(state.lastSeq).toBe(1)
  } finally { await host.close() }
}))
