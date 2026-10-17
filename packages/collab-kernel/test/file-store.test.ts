import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, appendFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileStore } from '../src/store/file-store.js'
import { canonicalJson, checksum, encodeRecord, decodeRecord } from '../src/store/canonical.js'
import { faultyFs, mockHandle } from './support/faulty-fs.js'
import type { CommitRecord } from '../src/model/index.js'

const roots: string[] = []
async function root() { const value = await mkdtemp(path.join(tmpdir(), 'collab-store-')); roots.push(value); return value }
afterEach(async () => { await Promise.all(roots.splice(0).map(value => rm(value, { recursive: true, force: true }))) })
const row: CommitRecord = { kind: 'completion', seq: 1, events: [{ type: 'dispatch/completed', deliveryId: 'd1', outcome: 'succeeded', messageRef: 'm', actor: 'system:dispatch' }] }

describe('FileStore', () => {
  it('canonical checksum matches the approved fixed vector', () => {
    expect(checksum({ seq: 1, z: 'é\n', a: [3, { y: null, b: true }], u: undefined, n: 1.5 })).toBe('840fce0f37377ab788320a1479c096dd3eecae5e93795e4fda0be650adf39d9f')
  })
  it('opens, commits and reloads durable records from inclusive seq', async () => {
    const dir = await root(), first = new FileStore(dir, { instanceId: 'x' })
    await first.open('space-1'); await first.commit('space-1', row, 0); await first.close('space-1')
    const second = new FileStore(dir, { instanceId: 'y' }); await second.open('space-1')
    expect(await second.read('space-1', 1)).toEqual([row]); expect(await second.list()).toEqual(['space-1'])
    await second.close('space-1')
  })
  it.each([NaN, Infinity, -Infinity, new Date(), new Map(), new Set(), 1n, () => 1, Symbol('x'), [undefined], Array(1)])('rejects non-JSON value %s rather than silently changing it', value => {
    expect(() => canonicalJson({ value })).toThrow()
  })
  it('rejects cycles but accepts repeated noncyclic objects and strips undefined fields', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    expect(() => canonicalJson(cycle)).toThrow()
    const shared = { b: 1, absent: undefined }
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"b":1},"y":{"b":1}}')
  })
  it('preserves own __proto__ keys and returns decoded records without storage digest', () => {
    const value = JSON.parse('{"seq":1,"__proto__":{"z":2,"a":1}}') as Record<string, unknown>
    expect(canonicalJson(value)).toBe('{"__proto__":{"a":1,"z":2},"seq":1}')
    expect(decodeRecord(encodeRecord(value).trimEnd())).toEqual(value)
  })
  it('writes a disk digest verified independently of canonical helpers and read', async () => {
    const dir = await root(), store = new FileStore(dir)
    await store.open('s'); await store.commit('s', row, 0)
    const disk = JSON.parse(await readFile(path.join(dir, 's.jsonl'), 'utf8'))
    const expected = createHash('sha256').update('{"events":[{"actor":"system:dispatch","deliveryId":"d1","messageRef":"m","outcome":"succeeded","type":"dispatch/completed"}],"kind":"completion","seq":1}').digest('hex')
    expect(disk).toEqual({ ...row, sha256: expected })
    await store.close('s')
  })
  it('read omits the storage digest and mutations never change cached records', async () => {
    const dir = await root(), store = new FileStore(dir)
    await store.open('s'); await store.commit('s', row, 0)
    const records = await store.read('s', 1)
    expect(records).toEqual([row]); records[0]!.events[0]!.actor = 'changed'
    expect(await store.read('s', 1)).toEqual([row]); expect(await store.read('s', 2)).toEqual([])
    await store.close('s')
  })
  it('rejects path traversal without writing outside the root', async () => {
    const dir = await root(), store = new FileStore(dir)
    await expect(store.open('../escape')).rejects.toMatchObject({ code: 'COLLAB_BAD_SPACE_ID' })
  })
  it('loops through short writes', async () => {
    const dir = await root(), store = new FileStore(dir, { fs: faultyFs({ shortWrite: true }) })
    await store.open('s'); await store.commit('s', row, 0)
    const text = await readFile(path.join(dir, 's.jsonl'), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.split('\n')).toHaveLength(2)
    expect(JSON.parse(text)).toEqual({ ...row, sha256: '4e7b3b30eea3e7c0a0e8efc1a892e2a7a7ac405e64d6b8e922e0fe687225eedc' })
    await store.close('s')
  })
  it('fails the space after sync failure and blocks later commits', async () => {
    const dir = await root(), store = new FileStore(dir, { fs: faultyFs({ failSync: true }) })
    await store.open('s')
    await expect(store.commit('s', row, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await expect(store.commit('s', { ...row, seq: 2 }, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await store.close('s')
    const recovered = new FileStore(dir); await recovered.open('s')
    expect(await recovered.read('s', 0)).toEqual([row]); await recovered.close('s')
  })
  it('preserves complete corruption and truncates only trailing fragments', async () => {
    const dir = await root(), store = new FileStore(dir, { instanceId: 'x' })
    await store.open('s'); await store.commit('s', row, 0); await store.close('s')
    const file = path.join(dir, 's.jsonl'), good = await readFile(file)
    await import('node:fs/promises').then(({ appendFile }) => appendFile(file, '{"partial"'))
    const recover = new FileStore(dir, { instanceId: 'y' }); await recover.open('s')
    expect(await readFile(file)).toEqual(good); await recover.close('s')
    await import('node:fs/promises').then(({ appendFile }) => appendFile(file, '{"sha256":"bad"}\n'))
    const corrupt = await readFile(file), bad = new FileStore(dir)
    await expect(bad.open('s')).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    expect(await readFile(file)).toEqual(corrupt)
  })
  it.each(['\n', '{"sha256":"bad"}\n'])('preserves every byte when a complete corrupt line precedes a partial tail: %j', async badLine => {
    const dir = await root(), file = path.join(dir, 's.jsonl')
    const bytes = Buffer.from(encodeRecord(row as unknown as Record<string, unknown>) + badLine + '{"partial":')
    await writeFile(file, bytes)
    await expect(new FileStore(dir).open('s')).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    expect(await readFile(file)).toEqual(bytes)
  })
  it.each([Buffer.alloc(0), Buffer.from([0xe4, 0xb8, 0xff])])('rejects invalid UTF-8 in a complete line before recovering tail %j', async tail => {
    const dir = await root(), file = path.join(dir, 's.jsonl'), store = new FileStore(dir)
    const replacementRow: CommitRecord = { ...row, events: [{ ...row.events[0]!, messageRef: '\ufffd' }] }
    const valid = Buffer.from(encodeRecord(replacementRow as unknown as Record<string, unknown>))
    const offset = valid.indexOf(Buffer.from([0xef, 0xbf, 0xbd]))
    expect(offset).toBeGreaterThan(-1)
    // The old lossy decoder maps this byte back to the checksummed U+FFFD.
    const bad = Buffer.concat([valid.subarray(0, offset), Buffer.from([0xff]), valid.subarray(offset + 3), tail])
    await writeFile(file, bad)
    const result = await store.open('s').then(() => undefined, error => error)
    try {
      expect(await readFile(file)).toEqual(bad)
      expect(result).toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    } finally { await store.close('s') }
  })
  it.each([Buffer.from([0xe4, 0xb8]), Buffer.from([0xff]), Buffer.from([0xf0, 0x9f, 0x92])])('recovers a valid non-ASCII prefix at its raw byte offset with tail %j', async tail => {
    const dir = await root(), file = path.join(dir, 's.jsonl'), syncs: string[] = [], store = new FileStore(dir, { fs: faultyFs({ syncs }) })
    const unicodeRow: CommitRecord = { ...row, events: [{ ...row.events[0]!, messageRef: '消息é😀\ufffd' }] }
    const complete = Buffer.from(encodeRecord(unicodeRow as unknown as Record<string, unknown>))
    await writeFile(file, Buffer.concat([complete, Buffer.from('{"partial":"'), tail]))
    await store.open('s')
    try {
      expect(await readFile(file)).toEqual(complete)
      expect(syncs).toEqual(['file'])
      expect(await store.read('s', 1)).toEqual([unicodeRow])
    } finally { await store.close('s') }
  })
  it('commit rejects externally introduced invalid UTF-8 without writing and fails closed', async () => {
    const dir = await root(), file = path.join(dir, 's.jsonl'), store = new FileStore(dir)
    const replacementRow: CommitRecord = { ...row, events: [{ ...row.events[0]!, messageRef: '\ufffd' }] }
    await store.open('s'); await store.commit('s', replacementRow, 0)
    const valid = await readFile(file), offset = valid.indexOf(Buffer.from([0xef, 0xbf, 0xbd]))
    expect(offset).toBeGreaterThan(-1)
    const bad = Buffer.concat([valid.subarray(0, offset), Buffer.from([0xff]), valid.subarray(offset + 3)])
    await writeFile(file, bad)
    const result = await store.commit('s', { ...row, seq: 2 }, 1).then(() => undefined, error => error)
    try {
      expect(await readFile(file)).toEqual(bad)
      expect(result).toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
      await expect(store.commit('s', { ...row, seq: 2 }, 1)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
      await expect(store.read('s', 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    } finally { await store.close('s') }
  })
  it.each(['checksum', 'partial', 'blank'])('commit rejects %s disk corruption without appending and fails closed', async fault => {
    const dir = await root(), store = new FileStore(dir), file = path.join(dir, 's.jsonl')
    await store.open('s'); await store.commit('s', row, 0)
    if (fault === 'checksum') {
      const disk = JSON.parse(await readFile(file, 'utf8')); disk.events[0].messageRef = 'tampered'
      await writeFile(file, JSON.stringify(disk) + '\n')
    } else await appendFile(file, fault === 'blank' ? '\n' : '{"seq":1}')
    const before = await readFile(file)
    await expect(store.commit('s', { ...row, seq: 2 }, 1)).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    expect(await readFile(file)).toEqual(before)
    await expect(store.commit('s', { ...row, seq: 2 }, 1)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await store.close('s')
  })
  it.each([0, 2])('rejects non-successor record seq %s before writing', async seq => {
    const dir = await root(), store = new FileStore(dir)
    await store.open('s')
    await expect(store.commit('s', { ...row, seq }, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_CONFLICT' })
    await expect(readFile(path.join(dir, 's.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.commit('s', row, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await store.close('s')
  })
  it('rejects invalid JSON at the commit boundary without creating a log', async () => {
    const dir = await root(), store = new FileStore(dir)
    await store.open('s')
    await expect(store.commit('s', { ...row, events: [{ ...row.events[0]!, messageRef: NaN }] } as unknown as CommitRecord, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await expect(readFile(path.join(dir, 's.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
    await store.close('s')
  })
  it('seq conflict fails the space and read refuses failed or closed snapshots', async () => {
    const dir = await root(), store = new FileStore(dir)
    await store.open('s'); await store.commit('s', row, 0)
    await expect(store.commit('s', { ...row, seq: 2 }, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_CONFLICT' })
    await expect(store.read('s', 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await store.close('s')
    await expect(store.read('s', 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
  })
  it('fsyncs the complete new file before its directory, and not the directory on later commits', async () => {
    const dir = await root(), syncs: string[] = [], store = new FileStore(dir, { fs: faultyFs({ syncs }) })
    await store.open('s'); syncs.length = 0
    await store.commit('s', row, 0); await store.commit('s', { ...row, seq: 2 }, 1)
    expect(syncs).toEqual(['file', 'directory', 'file'])
    await store.close('s')
  })
  it.each([{ zeroWrite: true }, { shortWrite: true, failWriteAfter: 1 }, { failDirectorySync: true }])('write/directory failures fail the space and reopen recovers only whole lines: %j', async fault => {
    const dir = await root(), store = new FileStore(dir, { fs: faultyFs(fault) })
    await store.open('s')
    await expect(store.commit('s', row, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await expect(store.commit('s', row, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await store.close('s')
    const recovered = new FileStore(dir); await recovered.open('s')
    expect(await recovered.read('s', 0)).toEqual('failDirectorySync' in fault ? [row] : [])
    await recovered.close('s')
  })
  it('failed open does not delete a lock replaced during loading', async () => {
    const dir = await root(), lockPath = path.join(dir, 's.lock'), replacement = '{"instanceId":"replacement","pid":1}'
    const store = new FileStore(dir, { fs: {
      readFile: (async (...args: Parameters<typeof fs.readFile>) => {
        if (String(args[0]).endsWith('.jsonl')) {
          await unlink(lockPath); await writeFile(lockPath, replacement)
          throw new Error('injected load failure')
        }
        return fs.readFile(...args)
      }) as typeof fs.readFile,
    } })
    await expect(store.open('s')).rejects.toThrow('injected load failure')
    expect(await readFile(lockPath, 'utf8')).toBe(replacement)
  })
  it.each([false, true])('close waits for in-flight commit (sync fails: %s), rejects queued work, and is idempotent concurrently', async failSync => {
    const dir = await root()
    let started!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const store = new FileStore(dir, { fs: {
      open: (async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args)
        return args[1] === 'a' ? mockHandle(handle, {
          write: (async (...writeArgs: Parameters<typeof handle.write>) => { started(); await gate; return handle.write(...writeArgs) }) as typeof handle.write,
          sync: async () => { if (failSync) throw new Error('injected sync failure'); await handle.sync() },
        }) : handle
      }) as typeof fs.open,
    } })
    await store.open('s')
    const active = store.commit('s', row, 0)
    const settledActive = failSync ? expect(active).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' }) : active
    await entered
    const queued = expect(store.commit('s', { ...row, seq: 2 }, 1)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    let closed = false
    const closing = store.close('s').then(() => { closed = true }), again = store.close('s')
    await expect(store.commit('s', { ...row, seq: 3 }, 2)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    expect(closed).toBe(false)
    expect(JSON.parse(await readFile(path.join(dir, 's.lock'), 'utf8')).instanceId).toBe(store.instanceId)
    release(); await settledActive; await queued; await Promise.all([closing, again])
    const second = new FileStore(dir); await second.open('s'); expect(await second.read('s', 0)).toEqual([row]); await second.close('s')
  })
  it('close during open waits for loading and leaves no writable space or orphan lock', async () => {
    const dir = await root()
    let started!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { started = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const store = new FileStore(dir, { fs: {
      readFile: (async (...args: Parameters<typeof fs.readFile>) => {
        if (String(args[0]).endsWith('.jsonl')) { started(); await gate }
        return fs.readFile(...args)
      }) as typeof fs.readFile,
    } })
    const opening = store.open('s'); await entered
    let closed = false
    const closing = store.close('s').then(() => { closed = true })
    await Promise.resolve(); await Promise.resolve()
    expect(closed).toBe(false)
    release(); await opening; await closing
    await expect(store.commit('s', row, 0)).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
    await expect(readFile(path.join(dir, 's.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('concurrent open has exactly one winner and a stale pid never permits takeover', async () => {
    const dir = await root(), store = new FileStore(dir)
    const results = await Promise.allSettled([store.open('s'), store.open('s')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await store.close('s')
    const lockPath = path.join(dir, 's.lock'), stale = '{"instanceId":"stale","pid":999999999}'
    await writeFile(lockPath, stale)
    await expect(new FileStore(dir).open('s')).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED', lock: stale, details: { lockPath, lock: { instanceId: 'stale', pid: 999999999 } } })
    expect(await readFile(lockPath, 'utf8')).toBe(stale)
    await expect(store.breakLock('s', 'wrong')).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED' })
    expect(await readFile(lockPath, 'utf8')).toBe(stale)
  })
  it('limits structured lock details to valid instanceId and pid while preserving the raw lock', async () => {
    const dir = await root(), lockPath = path.join(dir, 's.lock'), store = new FileStore(dir)
    const raw = JSON.stringify({ instanceId: 'owner', pid: 42, unrelated: 'must-not-enter-details' })
    await writeFile(lockPath, raw)
    for (const action of [() => store.open('s'), () => store.breakLock('s', 'wrong')]) {
      const error = await action().then(() => undefined, error => error)
      expect(error).toMatchObject({ code: 'COLLAB_STORE_LOCKED', lockPath, lock: raw })
      expect(error.details).toEqual({ lockPath, lock: { instanceId: 'owner', pid: 42 } })
    }
    for (const raw of ['not-json', '{"instanceId":42,"pid":"not-a-pid"}', 'null']) {
      await writeFile(lockPath, raw)
      const error = await store.open('s').then(() => undefined, error => error)
      expect(error).toMatchObject({ code: 'COLLAB_STORE_LOCKED', lockPath, lock: raw })
      expect(error.details).toEqual({ lockPath })
    }
  })
  it('does not steal another instance lock and breaks only exact instance ids', async () => {
    const dir = await root(), owner = new FileStore(dir, { instanceId: 'owner' }), contender = new FileStore(dir, { instanceId: 'other' })
    await owner.open('s')
    await expect(contender.open('s')).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED', lockPath: path.join(dir, 's.lock') })
    await expect(contender.breakLock('s', 'wrong')).rejects.toMatchObject({ code: 'COLLAB_STORE_LOCKED' })
    await contender.breakLock('s', 'owner'); await owner.close('s')
  })
})
