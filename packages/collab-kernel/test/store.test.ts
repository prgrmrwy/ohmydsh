import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CollabService, principals, type CommitRecord, type CollabEvent, type Item } from '../src/index.js'
import { FileStore, type FileStoreFs } from '../src/store/file-store.js'
import { canonicalJson, checksum, encodeRecord } from '../src/store/canonical.js'
import { FakeProvider } from './support/fake-provider.js'
import { faultyFs, mockHandle } from './support/faulty-fs.js'
import { member } from './support/world.js'

const spaceId = 'space-1'
const tempPrefix = path.join(tmpdir(), 'collab-store-integration-')
let root: string
let cleanups: (() => Promise<void>)[]
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(tempPrefix)); cleanups = [] })
afterEach(async () => {
  try {
    for (const close of cleanups.reverse()) await close()
  } finally {
    const target = await fs.realpath(root)
    expect(path.isAbsolute(target)).toBe(true)
    expect(target).toBe(path.resolve(root))
    expect(path.dirname(target)).toBe(await fs.realpath(tmpdir()))
    expect(path.basename(target)).toMatch(/^collab-store-integration-/)
    await fs.rm(target, { recursive: true, force: true })
  }
})

function instance(instanceId: string, injectedFs: Partial<FileStoreFs> = {}) {
  const store = new FileStore(root, { instanceId, fs: injectedFs })
  const provider = new FakeProvider()
  const service = new CollabService({ serviceId: 'service-1', store, providers: [provider] })
  cleanups.push(() => service.close(spaceId))
  let nextId = 0
  const ctx = (name = 'aily', cmdId = `${instanceId}-${++nextId}`) => ({
    spaceId, cmdId,
    principal: name === 'pm'
      ? principals.provider('P1', { channel: 'test-a', address: 'a:pm' })
      : principals.agent({ channel: 'test-a', address: name === 'aily' ? 'a:1' : 'a:2' }),
  })
  const read = () => ({ spaceId, principal: ctx().principal })
  return { store, service, provider, ctx, read }
}
async function created(instanceId = 'x', injectedFs: Partial<FileStoreFs> = {}) {
  const w = instance(instanceId, injectedFs)
  await w.service.createSpace(w.ctx('aily', 'create'), { name: 'aily', kind: 'agent', address: 'a:1' })
  return w
}
const logPath = () => path.join(root, `${spaceId}.jsonl`)
const lockPath = () => path.join(root, `${spaceId}.lock`)
const logBytes = () => fs.readFile(logPath())
const lockBytes = () => fs.readFile(lockPath(), 'utf8')

// Independent JSON oracle: never validate the encoder with its own decoder/checksum.
function sortedJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => [k, sort((v as Record<string, unknown>)[k])]))
      : v
  return JSON.stringify(sort(value))
}
function checkedLines(bytes: Buffer): (CommitRecord & { sha256: string })[] {
  const text = bytes.toString('utf8')
  expect(text.endsWith('\n')).toBe(true)
  return text.slice(0, -1).split('\n').map(line => {
    const row = JSON.parse(line) as CommitRecord & { sha256: string }
    const { sha256, ...body } = row
    expect(sha256).toBe(createHash('sha256').update(sortedJson(body), 'utf8').digest('hex'))
    return row
  })
}

const confirmation = { requestId: 'D1', choice: 'ship', evidence: { actionId: 'click-1', deliveryId: 'confirm-pm' } }
async function decisionWorld(instanceId: string, injectedFs: Partial<FileStoreFs> = {}) {
  const w = instance(instanceId, injectedFs)
  const item: Item = { id: 'I1', kind: 'other', author: 'aily', title: 'Release', body: 'Review release', requiredAcks: ['aily'], deciders: ['pm'], revision: 1, status: 'draft', acks: {}, agentEditCount: 0 }
  const events: CollabEvent[] = [
    { type: 'space/created', actor: 'aily', spaceId, serviceId: 'service-1', leader: 'aily', convention: { version: '1', sha256: 'seed-convention' } },
    ...[member('aily', 'a:1'), member('pm', 'a:pm', 'human', 'active', 2)].map(m => ({ type: 'member/joined' as const, actor: 'aily', member: m })),
    { type: 'item/created', actor: 'aily', item },
    ...[2, 3, 4, 5].map(revision => ({ type: 'item/revised' as const, actor: 'aily', item: { ...item, revision, agentEditCount: revision - 1, status: revision === 5 ? 'escalated' as const : 'draft' as const } })),
    { type: 'decision/requested', actor: 'aily', request: { id: 'D1', itemId: 'I1', revision: 5, author: 'aily', options: ['ship', 'wait'], deciders: ['pm'], status: 'open', awaitingChannel: false } },
    { type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: 'confirm-pm', member: 'pm', kind: 'confirm', providerId: 'P1', requestId: 'D1' } },
  ]
  // Bootstrap through the storage SPI only; no public service event-append API.
  await w.store.open(spaceId)
  await w.store.commit(spaceId, { kind: 'command', seq: 1, events, receipt: { cmdId: 'seed', scope: { kind: 'create', channel: 'test-a', address: 'a:1' }, payloadHash: 'seed', result: { seq: 1, spaceId } } }, 0)
  await w.store.commit(spaceId, { kind: 'completion', seq: 2, events: [{ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: 'confirm-pm', outcome: 'succeeded', messageRef: 'm-1' }] }, 1)
  await w.store.close(spaceId)
  await w.service.open(spaceId)
  return w
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

describe('FileStore service integration — approved storage scenarios', () => {
  it('store-01: restart preserves full state after member join, item revision and human decision', async () => {
    const x = await decisionWorld('x')
    await x.service.invite(x.ctx(), { name: 'doubao', kind: 'agent', address: 'a:2' })
    await x.service.join(x.ctx('doubao'))
    await x.service.createItem(x.ctx(), { itemId: 'I2', kind: 'request', title: 'Build', body: 'v1', requiredAcks: ['aily'], deciders: ['pm'], assignee: 'doubao' })
    await x.service.reviseItem(x.ctx(), { itemId: 'I2', expectedRevision: 1, changes: { body: 'v2' } })
    await x.service.confirmDecision(x.ctx('pm'), confirmation)
    await expect.poll(async () => (await x.service.overview(x.read())).inFlightDeliveries).toEqual([])
    const before = await x.service.overview(x.read())
    expect(before.members.doubao).toMatchObject({ status: 'active', binding: { address: 'a:2' } })
    expect(before.items.I2).toMatchObject({ revision: 2, body: 'v2', assignee: 'doubao', progress: 'open' })
    expect(before.requests.D1?.status).toBe('closed')
    expect(before.decisions).toHaveLength(1)
    expect(before.decisions[0]).toMatchObject({ requestId: 'D1', itemId: 'I1', actor: 'pm', choice: 'ship' })
    await x.service.close(spaceId)
    const bytes = await logBytes()
    const y = instance('y'); await y.service.open(spaceId)
    expect(await y.service.overview(y.read())).toEqual(before)
    expect(await y.service.readSince(y.read(), 0)).toEqual(await y.store.read(spaceId, 0))
    expect(await logBytes()).toEqual(bytes)
  })

  it('store-02: canonical JSON and both checksum calculations match the approved fixed vector', async () => {
    const vector = { seq: 1, z: 'é\n', a: [3, { y: null, b: true }], u: undefined, n: 1.5 }
    const canonical = '{"a":[3,{"b":true,"y":null}],"n":1.5,"seq":1,"z":"é\\n"}'
    const digest = '840fce0f37377ab788320a1479c096dd3eecae5e93795e4fda0be650adf39d9f'
    expect(canonicalJson(vector)).toBe(canonical)
    expect(checksum(vector)).toBe(digest)
    const encoded = encodeRecord(vector)
    expect(encoded.endsWith('\n')).toBe(true)
    expect(encoded.split('\n')).toHaveLength(2)
    await fs.writeFile(logPath(), encoded)
    const parsed = JSON.parse(await fs.readFile(logPath(), 'utf8'))
    expect(parsed).not.toHaveProperty('u')
    expect(parsed.sha256).toBe(digest)
    expect(checksum(parsed)).toBe(digest)
    const { sha256: _digest, ...body } = parsed
    expect(sortedJson(body)).toBe(canonical)
    expect(createHash('sha256').update(canonical, 'utf8').digest('hex')).toBe(digest)
  })

  it('store-03: loading ten complete commits truncates and fsyncs only the partial eleventh line', async () => {
    const x = await created()
    for (let n = 2; n <= 10; n++) await x.service.setStatus(x.ctx(), { text: `status-${n}` })
    await x.service.close(spaceId)
    const good = await logBytes()
    expect(checkedLines(good)).toHaveLength(10)
    await fs.appendFile(logPath(), '{"seq":11,"events":[{"text":"截断')
    const syncs: string[] = []
    const y = instance('y', faultyFs({ syncs })); await y.service.open(spaceId)
    expect((await y.service.overview(y.read())).lastSeq).toBe(10)
    expect((await y.service.overview(y.read())).members.aily?.statusText).toBe('status-10')
    expect(await y.store.read(spaceId, 0)).toHaveLength(10)
    expect(await logBytes()).toEqual(good)
    expect(syncs).toContain('file')
  })

  it('store-04: a complete checksum-mismatched line rejects load without changing any bytes', async () => {
    const x = await created(); await x.service.setStatus(x.ctx(), { text: 'original' }); await x.service.close(spaceId)
    const rows = (await logBytes()).toString('utf8').trimEnd().split('\n')
    const tampered = JSON.parse(rows.at(-1)!)
    tampered.events[0].text = 'tampered'
    rows[rows.length - 1] = JSON.stringify(tampered)
    const corrupt = Buffer.from(rows.join('\n') + '\n')
    await fs.writeFile(logPath(), corrupt)
    const y = instance('y')
    await expect(y.service.open(spaceId)).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    expect(await logBytes()).toEqual(corrupt)
    await expect(fs.stat(lockPath())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('store-05: half writes are completed before success, with complete independently verified lines', async () => {
    const syncs: string[] = []
    const x = await created('x', faultyFs({ shortWrite: true, syncs }))
    const result = await x.service.setStatus(x.ctx(), { text: 'complete é 字节\nline' })
    const bytes = await logBytes(), rows = checkedLines(bytes)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.seq).toBe(result.seq)
    expect(rows[1]?.events).toEqual([{ type: 'member/statusText', actor: 'aily', name: 'aily', text: 'complete é 字节\nline' }])
    expect(rows[1]?.receipt?.result).toEqual(result)
    expect(syncs).toContain('directory')
    expect(syncs.filter(s => s === 'file')).toHaveLength(2)
    await x.service.close(spaceId)
    const y = instance('y'); await y.service.open(spaceId)
    expect((await y.service.overview(y.read())).members.aily?.statusText).toBe('complete é 字节\nline')
    expect(await logBytes()).toEqual(bytes)
  })

  it('store-06: partial write of a valid multi-event human confirmation leaves D1 open after recovery', async () => {
    const fault = { shortWrite: true, failWriteAfter: undefined as number | undefined }
    const x = await decisionWorld('x', faultyFs(fault))
    const baseline = await logBytes()
    expect((await x.service.overview(x.read())).requests.D1?.status).toBe('open')
    fault.failWriteAfter = 1
    await expect(x.service.confirmDecision(x.ctx('pm', 'confirm-1'), confirmation)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    const partial = await logBytes()
    expect(partial.length).toBeGreaterThan(baseline.length)
    expect(partial.subarray(0, baseline.length)).toEqual(baseline)
    expect(partial.at(-1)).not.toBe(10)
    await x.service.close(spaceId)
    const y = instance('y'); await y.service.open(spaceId)
    expect(await logBytes()).toEqual(baseline)
    const recovered = await y.service.overview(y.read())
    expect(recovered.requests.D1?.status).toBe('open')
    expect(recovered.items.I1?.status).toBe('escalated')
    expect(recovered.decisions).toEqual([])
    expect(await y.store.read(spaceId, 0)).toHaveLength(2)
    // The same fixture must be a legal multi-event confirmation without the fault.
    const result = await y.service.confirmDecision(y.ctx('pm', 'confirm-1'), confirmation)
    const committed = (await y.service.readSince(y.read(), 2)).find(r => r.seq === result.seq)!
    expect(committed.events.filter(e => e.type === 'decision/decided')).toHaveLength(1)
    expect(committed.events.length).toBeGreaterThan(1)
    expect(committed.events).toContainEqual({ type: 'breaker/reset', actor: 'pm', member: 'aily' })
    expect((await y.service.overview(y.read())).requests.D1?.status).toBe('closed')
  })

  it('store-07: a complete line surviving fsync failure is resolved by same-cmdId replay without growth', async () => {
    const fault = { failSync: false }
    const x = await created('x', faultyFs(fault))
    fault.failSync = true
    const ctx = x.ctx('aily', 'cmd-5'), input = { text: 'durable-but-unknown' }
    await expect(x.service.setStatus(ctx, input)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    const written = await logBytes(), rows = checkedLines(written)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.receipt).toMatchObject({ cmdId: 'cmd-5', result: { seq: 2, spaceId } })
    await expect(x.service.setStatus(x.ctx(), { text: 'must-not-write' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    expect(await logBytes()).toEqual(written)
    await x.service.close(spaceId)
    const y = instance('y'); await y.service.open(spaceId)
    expect(await y.service.setStatus(y.ctx('aily', 'cmd-5'), input)).toEqual({ seq: 2, spaceId })
    expect((await y.service.overview(y.read())).members.aily?.statusText).toBe(input.text)
    expect(await y.service.readSince(y.read(), 0)).toHaveLength(2)
    expect(await logBytes()).toEqual(written)
  })

  it('store-08: failed X rejects queued work and close releases its lock before Y opens', async () => {
    const entered = deferred(), release = deferred()
    let armed = false, writes = 0
    const injectedFs: Partial<FileStoreFs> = {
      open: (async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args)
        if (args[1] !== 'a') return handle
        return mockHandle(handle, { write: (async (...writeArgs: Parameters<typeof handle.write>) => {
          if (!armed) return handle.write(...writeArgs)
          writes++; entered.resolve(); await release.promise
          throw new Error('injected in-flight write failure')
        }) as typeof handle.write })
      }) as typeof fs.open,
    }
    const x = await created('x', injectedFs), baseline = await logBytes()
    armed = true
    const active = x.service.setStatus(x.ctx('aily', 'active'), { text: 'fails' })
    const activeRejected = expect(active).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await entered.promise
    const queued = expect(x.service.setStatus(x.ctx('aily', 'queued'), { text: 'must-not-write' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    release.resolve(); await activeRejected
    // X is now failed; the command accepted into its queue cannot survive close.
    expect(JSON.parse(await lockBytes()).instanceId).toBe('x')
    await x.service.close(spaceId)
    await queued
    expect(writes).toBe(1)
    expect(await logBytes()).toEqual(baseline)
    await expect(fs.stat(lockPath())).rejects.toMatchObject({ code: 'ENOENT' })
    const y = instance('y'); await y.service.open(spaceId)
    expect(JSON.parse(await lockBytes()).instanceId).toBe('y')
    await expect(x.service.setStatus(x.ctx(), { text: 'late-old-command' })).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    const oldRecord = (await y.store.read(spaceId, 0))[0]!
    await expect(x.store.commit(spaceId, { ...oldRecord, seq: 2 }, 1)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    expect(await logBytes()).toEqual(baseline)
    expect((await y.service.overview(y.read())).members.aily?.statusText).toBe('')
  })

  it('store-09: a live owner lock excludes a second instance and preserves exact lock bytes', async () => {
    const x = await created('x'), locked = await lockBytes(), bytes = await logBytes()
    expect(JSON.parse(locked)).toEqual({ instanceId: 'x', pid: process.pid })
    const y = instance('y')
    await expect(y.service.open(spaceId)).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED', lockPath: lockPath(), lock: locked })
    expect(await lockBytes()).toBe(locked)
    await y.service.close(spaceId)
    expect(await lockBytes()).toBe(locked)
    expect(await logBytes()).toEqual(bytes)
    expect((await x.service.overview(x.read())).spaceId).toBe(spaceId)
    const replacement = JSON.stringify({ instanceId: 'replacement', pid: process.pid })
    await fs.writeFile(lockPath(), replacement)
    await x.service.close(spaceId)
    expect(await lockBytes()).toBe(replacement)
  })

  it('store-10: a residual lock with nonexistent pid is never automatically taken over', async () => {
    const stale = JSON.stringify({ instanceId: 'absent-owner', pid: 2147483647 })
    await fs.writeFile(lockPath(), stale)
    const y = instance('y')
    await expect(y.service.open(spaceId)).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED', lockPath: lockPath(), lock: stale })
    expect(await lockBytes()).toBe(stale)
    await y.service.close(spaceId)
    expect(await lockBytes()).toBe(stale)
  })

  it('store-11: exact-id breakLock removes a synthetic residual lock and allows a new instance', async () => {
    // This synthetic owner never existed; no live holder is being broken.
    await fs.writeFile(lockPath(), JSON.stringify({ instanceId: 'x-1', pid: 2147483647 }))
    const recovery = instance('recovery')
    await recovery.store.breakLock(spaceId, 'x-1')
    await expect(fs.stat(lockPath())).rejects.toMatchObject({ code: 'ENOENT' })
    const y = await created('y')
    expect(JSON.parse(await lockBytes())).toEqual({ instanceId: 'y', pid: process.pid })
    expect((await y.service.overview(y.read())).members.aily?.status).toBe('active')
  })

  it('store-12: mismatched instance id cannot remove a residual lock', async () => {
    const stale = JSON.stringify({ instanceId: 'x-2', pid: 2147483647 })
    await fs.writeFile(lockPath(), stale)
    const recovery = instance('recovery')
    await expect(recovery.store.breakLock(spaceId, 'x-1')).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED', lockPath: lockPath(), lock: stale })
    expect(await lockBytes()).toBe(stale)
    await expect(instance('y').service.open(spaceId)).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED' })
    expect(await lockBytes()).toBe(stale)
  })

  it('store-read-boundary: service readSince is exclusive, pure, and preserves the persisted command shape', async () => {
    const x = await created()
    await x.service.setStatus(x.ctx(), { text: 'second' })
    await x.service.setStatus(x.ctx(), { text: 'third' })
    const before = await logBytes()
    const all = await x.service.readSince(x.read(), 0)
    expect(all.map(r => r.seq)).toEqual([1, 2, 3])
    expect((await x.service.readSince(x.read(), 1)).map(r => r.seq)).toEqual([2, 3])
    expect(await x.service.readSince(x.read(), 3)).toEqual([])
    expect(await x.service.readSince(x.read(), 25)).toEqual([])
    await x.service.close(spaceId)
    const y = instance('y'); await y.service.open(spaceId)
    expect(await y.service.readSince(y.read(), 0)).toEqual(all)
    expect((await y.service.readSince(y.read(), 1)).map(r => r.seq)).toEqual([2, 3])
    expect(await logBytes()).toEqual(before)
  })
})
