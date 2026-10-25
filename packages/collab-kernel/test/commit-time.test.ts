import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CollabService, FileStore, principals, type CommitRecord } from '../src/index.js'
import { FakeProvider } from './support/fake-provider.js'
import { MemStore } from './support/mem-store.js'
import { defaultMembers, seedRecord } from './support/world.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

/** A clock that returns the given values in order, then keeps returning the last one. */
const clock = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]! }
const agent = (address: string) => principals.agent({ channel: 'test-a', address })

it('commit-time-01：新提交带时间且重放不刷新', async () => {
  const store = new MemStore(); store.records.set('s', [seedRecord()])
  const service = new CollabService({ serviceId: 'service-1', store, providers: [new FakeProvider()], now: clock(1000, 2000) })
  await service.open('s')
  const ctx = { spaceId: 's', cmdId: 'c-1', principal: agent('a:1') }
  const input = { itemId: 'i-1', kind: 'other' as const, title: 't', body: 'b', requiredAcks: [] }
  const first = await service.createItem(ctx, input)
  const before = store.records.get('s')!.length
  const second = await service.createItem(ctx, input)
  expect(second).toEqual(first)
  const log = store.records.get('s')!
  expect(log).toHaveLength(before)
  const commits = log.filter(r => r.kind === 'command' && r.receipt.cmdId === 'c-1')
  expect(commits).toHaveLength(1)
  expect(commits[0]!.at).toBe(1000)
  // Reads return the stored time unchanged.
  const read = await service.readSince({ spaceId: 's', principal: agent('a:1') }, 0)
  expect(read.find(r => r.seq === first.seq)!.at).toBe(1000)
  await service.close('s')
})

it('commit-time-02：旧日志无时间照常重放', async () => {
  const store = new MemStore()
  const legacy: CommitRecord[] = [seedRecord(defaultMembers()), { kind: 'command', seq: 2, events: [{ type: 'member/statusText', actor: 'aily', name: 'aily', text: 'old' }], receipt: { cmdId: 'old-2', scope: { kind: 'member', name: 'aily' }, payloadHash: 'h', result: { seq: 2, spaceId: 's' } } }]
  store.records.set('s', structuredClone(legacy))
  const provider = new FakeProvider()
  const service = new CollabService({ serviceId: 'service-1', store, providers: [provider], now: clock(5000) })
  await service.open('s')
  const host = { spaceId: 's', principal: principals.internal('host-index') }
  const old = await service.readSince(host, 0)
  expect(old).toEqual(legacy)
  for (const r of old) expect(Object.hasOwn(r, 'at')).toBe(false)
  // A waking message produces a command commit and later a completion commit; both carry `at`.
  const sent = await service.sendMessage({ spaceId: 's', cmdId: 'm-1', principal: agent('a:1') }, { to: 'doubao', body: 'hi', needsReply: true })
  await vi.waitFor(() => expect(store.records.get('s')!.some(r => r.kind === 'completion')).toBe(true))
  const after = await service.readSince(host, 2)
  expect(after.map(r => [r.kind, r.at])).toEqual([['command', 5000], ['completion', 5000]])
  // The old commits are still returned without a time.
  for (const r of (await service.readSince(host, 0)).slice(0, 2)) expect(Object.hasOwn(r, 'at')).toBe(false)
  await service.close('s')
})

it('commit-time-03：篡改时间被识别为损坏', async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'collab-commit-time-'))); roots.push(dir)
  const store = new FileStore(dir, { instanceId: 'x' })
  const service = new CollabService({ serviceId: 'service-1', store, providers: [new FakeProvider()], now: clock(1000) })
  await service.createSpace({ spaceId: 'sp', cmdId: 'create', principal: agent('a:1') }, { name: 'aily', address: 'a:1', kind: 'agent' })
  await service.close('sp')
  const logPath = path.join(dir, 'sp.jsonl')
  const rows = (await fs.readFile(logPath, 'utf8')).trimEnd().split('\n')
  const row = JSON.parse(rows[0]!)
  expect(row.at).toBe(1000)
  row.at = 9999
  const tampered = `${JSON.stringify(row)}\n`
  await fs.writeFile(logPath, tampered)
  const reloaded = new CollabService({ serviceId: 'service-2', store: new FileStore(dir, { instanceId: 'y' }), providers: [new FakeProvider()] })
  await expect(reloaded.open('sp')).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
  expect(await fs.readFile(logPath, 'utf8')).toBe(tampered)
})
