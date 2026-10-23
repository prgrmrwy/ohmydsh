#!/usr/bin/env node
/**
 * Report whether fork-seeded child sessions (e.g. /btw side questions or
 * subagent forks) reused their parent's provider prompt cache.
 *
 * For each seeded child created in the window, prints:
 *  - the parent's last request usage and how long before the child it ran
 *    (a gap beyond the provider's cache TTL makes a miss uninformative);
 *  - whether the child's first request carried a byte-identical tool set
 *    (any tool difference breaks the cached prefix, see BACKLOG B049);
 *  - the tools present only on one side;
 *  - the child's own usage per step.
 *
 * Read-only. Usage: node scripts/fork-cache-report.mjs [minutes=60]
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'

const minutes = Number(process.argv[2] ?? 60)
if (!Number.isFinite(minutes) || minutes <= 0) { console.error('usage: fork-cache-report.mjs [minutes>0]'); process.exit(2) }
const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
if (!existsSync(root)) { console.error(`no sessions dir: ${root}`); process.exit(2) }

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Decode every frame of the concatenated-frame session log. */
function readEvents(file) {
  const buf = readFileSync(file)
  const starts = []
  for (let i = buf.indexOf(ZSTD_MAGIC); i >= 0; i = buf.indexOf(ZSTD_MAGIC, i + 4)) starts.push(i)
  let text = ''
  for (let k = 0; k < starts.length; k++) {
    try { text += zstdDecompressSync(buf.subarray(starts[k], starts[k + 1] ?? buf.length)).toString() } catch { /* skip a bad frame */ }
  }
  return text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
}
const usageOf = event => event?.data?.usage ?? event?.data?.message?.usage
const headerOf = event => event?.data?.header ?? event?.data
const toolNames = header => (header?.tools ?? []).map(tool => tool.name)

const cutoff = Date.now() - minutes * 60e3
const rows = []
for (const workspace of readdirSync(root)) {
  const dir = join(root, workspace)
  if (!statSync(dir).isDirectory()) continue
  for (const session of readdirSync(dir)) {
    const file = join(dir, session, 'session.v4.jsonl.zstd')
    if (!existsSync(file) || statSync(file).mtimeMs < cutoff) continue
    const events = readEvents(file)
    const header = events[0]
    if (!header?.isSeeded || !header.parentSession || header.createdAt < cutoff) continue
    // A parent that was itself seeded carries its own end-seed; the child's boundary is the LAST one.
    const seedEnd = events.findLastIndex(event => event.type === 'session/end-seed')
    if (seedEnd < 0) continue
    const inherited = events.slice(0, seedEnd)
    const own = events.slice(seedEnd + 1)
    const parentHeader = headerOf(inherited.filter(event => event.type === 'request/header').at(-1))
    const childHeader = headerOf(own.filter(event => event.type === 'request/header').at(-1))
    const parentLast = inherited.filter(event => event.type === 'assistant/message').at(-1)
    const parentTools = new Set(toolNames(parentHeader))
    const childTools = new Set(toolNames(childHeader))
    const config = childHeader?.config ?? parentHeader?.config
    rows.push({
      child: session,
      parent: header.parentSession,
      createdAt: new Date(header.createdAt).toISOString(),
      label: own.filter(event => event.type === 'subagent/descriptor').at(-1)?.data?.label,
      model: config ? `${config.provider}/${config.model}` : undefined,
      parentGapSeconds: parentLast ? Math.round((header.createdAt - parentLast.time) / 1000) : undefined,
      parentLastUsage: usageOf(parentLast),
      toolSetIdentical: JSON.stringify(parentHeader?.tools) === JSON.stringify(childHeader?.tools),
      toolsOnlyInParent: [...parentTools].filter(name => !childTools.has(name)),
      toolsOnlyInChild: [...childTools].filter(name => !parentTools.has(name)),
      childSteps: own.filter(event => event.type === 'assistant/message').map(usageOf),
      endReason: own.filter(event => event.type === 'turn/end').at(-1)?.data?.reason?.kind,
    })
  }
}
rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
console.log(JSON.stringify(rows, null, 1))
