#!/usr/bin/env node
/**
 * Observe whether a locus child's settlement disturbed its parent session.
 *
 * This is the acceptance oracle for the `settlementNotice: 'silent'` seam:
 * the child does its work and reports through its own channel, and the parent
 * session — the one a human is actually using — must show no trace of it.
 *
 * Reads persisted session logs only. Safe to run against a live Host.
 *
 * Usage:
 *   node scripts/observe-settlement-isolation.mjs --snapshot   # before the test
 *   node scripts/observe-settlement-isolation.mjs              # after
 */
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'

/** zstd frame magic — `28 B5 2F FD`. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decode a session log's compressed bytes.
 *
 * DSH appends to these logs by writing an INDEPENDENT zstd frame per flush, so
 * the file is a concatenation of frames rather than one stream. Both
 * `zstdDecompressSync` and the streaming decompressor stop after the first
 * frame and return it without error — a 36 KB log silently yields 214 bytes
 * and one line. Split on the frame magic and decode each frame separately.
 */
function decodeFrames(raw) {
  const starts = []
  for (let i = 0; i + 3 < raw.length; i += 1) {
    if (raw.compare(ZSTD_MAGIC, 0, 4, i, i + 4) === 0) starts.push(i)
  }
  if (starts.length === 0) return raw.toString('utf8')
  const parts = []
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : raw.length
    try {
      parts.push(zstdDecompressSync(raw.subarray(starts[k], end)).toString('utf8'))
    } catch {
      // A truncated tail frame is expected while the Host is mid-write; the
      // frames already decoded still answer the question this report asks.
    }
  }
  return parts.join('')
}

function arg(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
const database = path.join(home, 'plugins', 'dsh-pet', 'state.sqlite')
const snapshotFile = path.resolve(arg('--state') ?? '/tmp/settlement-isolation-snapshot.json')
const takeSnapshot = process.argv.includes('--snapshot')

/**
 * The active loci, read from a copy.
 *
 * The live database is held exclusively by the Host, so it cannot be opened
 * directly — copying first is the only read path that does not require a
 * shutdown. A torn page would only affect this report, never the source.
 */
async function activeLoci() {
  const copy = `/tmp/.settlement-observe-${process.pid}.sqlite`
  await writeFile(copy, await readFile(database))
  const db = new DatabaseSync(copy, { readOnly: true })
  try {
    const rows = []
    for (const row of db.prepare('SELECT value FROM u_dsh_pet_loci').all()) {
      try {
        const locus = JSON.parse(row.value)
        if (locus.state === 'active') rows.push(locus)
      } catch { /* a malformed row is not this report's business */ }
    }
    return rows
  } finally {
    db.close()
    await rm(copy, { force: true }).catch(() => undefined)
  }
}

/** Locate one session's log directory, wherever its workspace happens to be. */
async function sessionDir(sessionId) {
  const root = path.join(home, 'sessions')
  for (const workspace of await readdir(root)) {
    const candidate = path.join(root, workspace, sessionId)
    try {
      await readdir(candidate)
      return candidate
    } catch { /* not in this workspace */ }
  }
  return undefined
}

/**
 * Count the events in a session log, and how many of them are settlement
 * notices injected by the subagent runtime.
 *
 * `subagent-settled` is the public source kind the runtime stamps on that
 * message, so its presence in the PARENT's log is exactly the symptom the
 * silent seam exists to prevent.
 */
async function inspectLog(dir, since = 0) {
  // Session logs are zstd-compressed JSONL (`session.v3.jsonl.zstd`). Reading
  // them as plain text silently yields zero events — which would make this
  // report claim "the parent was untouched" no matter what actually happened.
  const files = (await readdir(dir)).filter(f => f.includes('.jsonl')).sort()
  let events = 0
  let settlementNotices = 0
  let latest = 0
  for (const file of files) {
    const raw = await readFile(path.join(dir, file))
    if (raw.length === 0) continue
    const text = file.endsWith('.zstd') ? decodeFrames(raw) : raw.toString('utf8')
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      // Timestamped filtering, not a running total. A settlement that happened
      // BEFORE the window is history: comparing totals against a baseline taken
      // before a Host restart reports those old events as fresh leaks, which is
      // exactly how a working fix got misread as a failure.
      let time = 0
      try { time = JSON.parse(line).time ?? 0 } catch { /* keep it counted */ }
      if (time > latest) latest = time
      if (time < since) continue
      events += 1
      if (line.includes('subagent-settled')) settlementNotices += 1
    }
  }
  return { events, settlementNotices, latest }
}

const loci = await activeLoci()
if (loci.length === 0) {
  console.log('没有 active locus — 先在飞书群里 @ 一次 bot，建立 locus 后再跑。')
  process.exit(0)
}

const report = {}
// On the comparison run, only events after the baseline's cut line count.
// Totals would fold in everything that happened before it — including a
// settlement from an earlier Host generation, which is history, not a leak.
let since = 0
let baseline
if (!takeSnapshot) {
  try {
    baseline = JSON.parse(await readFile(snapshotFile, 'utf8'))
    since = baseline.__since ?? 0
  } catch {
    console.error(`找不到基线 ${snapshotFile}`)
    console.error('先跑一次 --snapshot，再触发飞书，再跑这条。')
    process.exit(1)
  }
}

for (const locus of loci) {
  const parentId = locus.parentSessionId
  const childId = locus.childSessionId
  const parentDir = await sessionDir(parentId)
  const childDir = await sessionDir(childId)
  report[childId] = {
    chatId: locus.endpoint?.chatId,
    parentId,
    parent: parentDir === undefined ? undefined : await inspectLog(parentDir, since),
    child: childDir === undefined ? undefined : await inspectLog(childDir, since),
  }
}

if (takeSnapshot) {
  // The cut line for the next comparison. Everything already in the logs is
  // history by definition, so the follow-up only has to look after this.
  report.__since = Date.now()
  await writeFile(snapshotFile, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`已记录基线 → ${snapshotFile}\n`)
  for (const [childId, row] of Object.entries(report)) {
    if (childId.startsWith('__')) continue
    console.log(`locus  chat=${row.chatId}`)
    console.log(`  父 ${row.parentId}`)
    console.log(`    事件数 ${row.parent?.events ?? '?'}  结算通知 ${row.parent?.settlementNotices ?? '?'}`)
    console.log(`  子 ${childId}`)
    console.log(`    事件数 ${row.child?.events ?? '?'}`)
  }
  console.log('\n现在去飞书群里 @ bot 提一个问题，等它答完，再不带 --snapshot 跑一次。')
  process.exit(0)
}

console.log(`结算隔离观测 — 只统计 ${new Date(since).toLocaleString()} 之后\n`)
let failures = 0
let worked = false

for (const [childId, row] of Object.entries(report)) {
  if (childId.startsWith('__')) continue
  const before = baseline[childId]
  if (before === undefined) {
    console.log(`· 新 locus ${childId.slice(0, 20)}… 不在基线中，跳过`)
    continue
  }
  // Already scoped to the window by `since`, so these ARE the deltas.
  const childGrew = row.child?.events ?? 0
  const parentGrew = row.parent?.events ?? 0
  const noticeGrew = row.parent?.settlementNotices ?? 0

  console.log(`locus  chat=${row.chatId}`)
  console.log(`  子会话新增事件: ${childGrew}${childGrew > 0 ? '  ← 子代确实干活了' : '  ← 没有动静'}`)
  console.log(`  父会话新增事件: ${parentGrew}`)
  console.log(`  父会话新增结算通知: ${noticeGrew}`)

  if (childGrew > 0) worked = true

  if (noticeGrew > 0) {
    console.log('  ✗ 父会话收到了结算通知 —— silent seam 未生效')
    failures += 1
  } else if (childGrew > 0) {
    console.log('  ✓ 子代完成工作，父会话零结算通知')
  }
  console.log()
}

if (!worked) {
  console.log('子会话没有新增事件 —— 这次触发可能没走到 locus child。')
  console.log('确认是在上面列出的 chat 里 @ 了 bot，且 bot 有回复。')
  process.exitCode = 1
} else {
  console.log(failures === 0
    ? '通过：结算未打断父会话。'
    : `${failures} 个 locus 的结算泄漏到了父会话。`)
  process.exitCode = failures === 0 ? 0 : 1
}
