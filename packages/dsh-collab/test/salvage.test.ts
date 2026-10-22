import { it, expect } from 'vitest'
import { join } from 'node:path'
import { promises as nodeFs } from 'node:fs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { FileStore } from 'collab-kernel'
import { salvage } from '../src/salvage.js'
import { hostContext, ops, direct, settle, tempRoot, bytes, exists, type Host } from './support/world.js'

const dead = () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) }
const world = (run: (host: Host, dataDir: string) => Promise<void>) => tempRoot('collab-salvage-', async root => {
  const host = hostContext(root); host.session('session-a', { live: true }); host.session('session-b', { live: true })
  try { await run(host, join(root, 'data')) } finally { await host.stop() }
})
const lines = async (path: string) => (await readFile(path, 'utf8')).split('\n').filter(Boolean)
/** Ledger of exactly `count` lines for space S (a creates; b joins when `withB`). */
async function ledger(host: Host, dataDir: string, count: number, withB = false) {
  const h = await direct(host, {}, dataDir), op = ops(host)
  try {
    await op.create('session-a', 'S', 'a')
    if (withB) { await op.invite('session-a', 'S', 'b', 'session-b'); await settle(); await op.join('session-b', 'S') }
    while ((await lines(join(dataDir, 'S.jsonl'))).length < count) await op.setStatus('session-a', 'S', `step ${(await lines(join(dataDir, 'S.jsonl'))).length}`)
  } finally { await h.close() }
  expect(await lines(join(dataDir, 'S.jsonl'))).toHaveLength(count)
}
/** Corrupt line `n` (1-based) in place without changing the line count. */
async function corrupt(dataDir: string, n: number, replacement = 'not a record') {
  const all = await lines(join(dataDir, 'S.jsonl')); all[n - 1] = replacement
  await writeFile(join(dataDir, 'S.jsonl'), `${all.join('\n')}\n`)
  return readFile(join(dataDir, 'S.jsonl'))
}
const run = (dataDir: string, extra: Parameters<typeof salvage>[1] = {}) => salvage({ dataDir, spaceId: 'S' }, extra)
const backups = async (dataDir: string) => (await readdir(dataDir)).filter(name => name.startsWith('S.jsonl.corrupt-'))
const snapshot = async (dir: string) => Promise.all((await readdir(dir)).sort().map(async name => [name, (await bytes(join(dir, name)))?.toString('hex')]))

it('salvage-01：抢救后重启即可继续', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 10)
  const original = await corrupt(dataDir, 7)
  const broken = await direct(host, {}, dataDir)
  try { expect(host.logs.some(line => line.includes('space=S') && line.includes('line=7'))).toBe(true) } finally { await broken.close() }
  const result = await run(dataDir)
  expect(result.code).toBe(0)
  const [backup] = await backups(dataDir)
  expect(await readFile(join(dataDir, backup!))).toEqual(original)
  expect((await lines(join(dataDir, 'S.jsonl'))).map(line => JSON.parse(line).seq)).toEqual([1, 2, 3, 4, 5, 6])
  expect(await exists(join(dataDir, 'S.lock'))).toBe(false)
  const h = await direct(host, {}, dataDir)
  try {
    expect((await ops(host).overview('session-a', 'S')).lastSeq).toBe(6)
    expect((await ops(host).setStatus('session-a', 'S', 'after salvage')).seq).toBe(7)
  } finally { await h.close() }
}))
it('salvage-02：空间被持有时拒绝抢救', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 3); await corrupt(dataDir, 2)
  await writeFile(join(dataDir, 'S.lock'), JSON.stringify({ instanceId: 'holder', pid: process.pid }))
  const before = await snapshot(dataDir)
  expect((await run(dataDir)).code).not.toBe(0)
  expect(await snapshot(dataDir)).toEqual(before)
}))
it('salvage-03：写临时文件失败时原日志不变', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 4); const original = await corrupt(dataDir, 3)
  const fs = { ...nodeFs, open: async (...args: Parameters<typeof nodeFs.open>) => {
    const handle = await nodeFs.open(...args)
    if (!String(args[0]).endsWith('.salvage-tmp')) return handle
    return new Proxy(handle, { get(t, k) { if (k === 'sync') return async () => { throw new Error('injected fsync failure') }; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v } })
  } }
  expect((await run(dataDir, { fs })).code).not.toBe(0)
  expect(await readFile(join(dataDir, 'S.jsonl'))).toEqual(original)
  expect(await exists(join(dataDir, 'S.lock'))).toBe(false)
  expect(await exists(join(dataDir, 'S.jsonl.salvage-tmp'))).toBe(false)
  expect(await backups(dataDir)).toEqual([])
}))
it('salvage-04：替换前中断时原日志仍在', () => world(async (host, dataDir) => {
  for (const mode of ['rename-fails', 'killed-between-4-and-5']) {
    await ledger(host, dataDir, 4); const original = await corrupt(dataDir, 3)
    const killed = Object.assign(new Error('simulated SIGKILL'), { simulatedKill: true })
    const fs = { ...nodeFs, rename: async () => { throw mode === 'rename-fails' ? new Error('injected rename failure') : killed } }
    const result = await run(dataDir, { fs, pid: 999999999, ...(mode === 'killed-between-4-and-5' ? { killedBy: killed } : {}) })
    expect(result.code).not.toBe(0)
    expect(await readFile(join(dataDir, 'S.jsonl'))).toEqual(original)
    const [backup] = await backups(dataDir)
    expect(await readFile(join(dataDir, backup!))).toEqual(original)
    const h = await direct(host, { probe: dead }, dataDir)
    try {
      expect(await ops(host).overview('session-a', 'S')).toEqual({ error: { code: 'COLLAB_SPACE_UNAVAILABLE' } })
      expect((await ops(host).create('session-a', 'S', 'a')).error).toBeDefined()
      expect(await readFile(join(dataDir, 'S.jsonl'))).toEqual(original)
    } finally { await h.close() }
    for (const name of await readdir(dataDir)) await nodeFs.unlink(join(dataDir, name))
  }
}))
it('salvage-05：首行即损坏时允许原 ID 重新创建', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 3, false); const original = await corrupt(dataDir, 1)
  expect((await run(dataDir)).code).toBe(0)
  const [backup] = await backups(dataDir)
  expect(await readFile(join(dataDir, backup!))).toEqual(original)
  expect(await exists(join(dataDir, 'S.jsonl'))).toBe(false)
  expect(await exists(join(dataDir, 'S.jsonl.salvage-tmp'))).toBe(false)
  const h = await direct(host, {}, dataDir)
  try {
    expect(await ops(host).create('session-a', 'S', 'a', 'cmd-reused')).toEqual({ seq: 1, spaceId: 'S' })
    const state = await ops(host).overview('session-a', 'S')
    expect(state.leader).toBe('a'); expect(Object.keys(state.members)).toEqual(['a'])
    expect((await ops(host).since('session-a', 'S', 0)).map((r: any) => r.receipt?.cmdId)).toEqual(['cmd-reused'])
  } finally { await h.close() }
}))
it('salvage-06：换新空间重建无需停机', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 4, true); await corrupt(dataDir, 3)
  const before = await snapshot(dataDir)
  const h = await direct(host, {}, dataDir)
  try {
    const op = ops(host)
    expect(await op.overview('session-a', 'S')).toEqual({ error: { code: 'COLLAB_SPACE_UNAVAILABLE' } })
    expect((await op.create('session-a', 'S2', 'a')).seq).toBe(1)
    expect((await op.invite('session-a', 'S2', 'b', 'session-b')).autoJoined).toBe(true); await settle()
    expect((await op.overview('session-b', 'S2')).members.b.status).toBe('active')
    expect((await snapshot(dataDir)).filter(([name]) => String(name).startsWith('S.'))).toEqual(before.filter(([name]) => String(name).startsWith('S.')))
  } finally { await h.close() }
}))
it('salvage-report-01：输出含收据丢失与 seq 复用提示', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 10); await corrupt(dataDir, 7)
  const result = await run(dataDir), text = result.lines.join('\n')
  expect(result.code).toBe(0)
  expect(text).toContain('保留 6'); expect(text).toContain('第 7 行')
  expect(text).toContain('收据已丢失')
  expect(text).toContain('seq 会被复用'); expect(text).toContain('游标重置为 0'); expect(text).toContain('新 spaceId')
  expect(text).not.toMatch(/7\s*[-–~～]\s*10/)
}))
it('salvage-report-02：抢救后游标重置可读到新提交', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 10, true)
  let h = await direct(host, {}, dataDir)
  const cursor = (await ops(host).since('session-b', 'S', 0)).at(-1).seq
  await h.close()
  expect(cursor).toBe(10)
  await corrupt(dataDir, 7)
  expect((await run(dataDir)).code).toBe(0)
  h = await direct(host, {}, dataDir)
  try {
    const op = ops(host)
    expect((await op.setStatus('session-a', 'S', 'new after salvage')).seq).toBe(7)
    const { lastSeq } = await op.overview('session-b', 'S')
    expect(lastSeq).toBe(7); expect(lastSeq).toBeLessThan(cursor)
    const reread = await op.since('session-b', 'S', 0)
    expect(reread.map((r: any) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(reread.at(-1).events.some((e: any) => e.type === 'member/statusText' && e.text === 'new after salvage')).toBe(true)
  } finally { await h.close() }
}))
it('salvage-report-03：上次抢救中断时拒绝重跑', () => world(async (host, dataDir) => {
  await ledger(host, dataDir, 3); await corrupt(dataDir, 2)
  await writeFile(join(dataDir, 'S.jsonl.salvage-tmp'), 'partial')
  const before = await snapshot(dataDir)
  const result = await run(dataDir), text = result.lines.join('\n')
  expect(result.code).not.toBe(0)
  expect(text).toContain('S.jsonl.salvage-tmp：存在'); expect(text).toContain('备份 S.jsonl.corrupt-*：不存在'); expect(text).toContain('日志 S.jsonl：存在')
  expect(text).toContain('确认 S.jsonl 为原损坏文件后删除 S.jsonl.salvage-tmp')
  expect(await snapshot(dataDir)).toEqual(before)
}))
it('salvage-decode：非法 UTF-8 出现在第 N 行时，保留前缀与 FileStore 加载一致', () => world(async (host, dataDir) => {
  for (const n of [1, 3, 5]) {
    await ledger(host, dataDir, 5)
    const raw = await readFile(join(dataDir, 'S.jsonl'))
    const parts = raw.toString('latin1').split('\n')
    parts[n - 1] = parts[n - 1]!.replace('"seq"', '"s\u00ffq"')
    await writeFile(join(dataDir, 'S.jsonl'), Buffer.from(parts.join('\n'), 'latin1'))
    const whole = new FileStore(dataDir)
    await expect(whole.open('S')).rejects.toMatchObject({ code: 'COLLAB_STORE_CORRUPT' })
    const result = await run(dataDir)
    expect(result.code).toBe(0); expect(result.lines.join('\n')).toContain(`第 ${n} 行`)
    if (n === 1) expect(await exists(join(dataDir, 'S.jsonl'))).toBe(false)
    else {
      const store = new FileStore(dataDir)
      await store.open('S')
      try {
        const loaded = await store.read('S', 0)
        expect(loaded.map(r => r.seq)).toEqual(Array.from({ length: n - 1 }, (_, i) => i + 1))
        // Kept bytes are exactly the original prefix through the end of line n-1.
        let end = 0
        for (let i = 0; i < n - 1; i++) end = raw.indexOf(0x0a, end) + 1
        expect((await readFile(join(dataDir, 'S.jsonl'))).equals(raw.subarray(0, end))).toBe(true)
      } finally { await store.close('S') }
    }
    for (const name of await readdir(dataDir)) await nodeFs.unlink(join(dataDir, name))
  }
}))
