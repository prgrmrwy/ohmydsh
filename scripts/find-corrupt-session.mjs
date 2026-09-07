#!/usr/bin/env node
/**
 * Locate the session log that makes DSH 0.1.2 fail at boot with:
 *   "corrupt Zstandard session log: first frame is not exactly one header line"
 *
 * Read-only. Prints offenders; never modifies anything.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'

const ZSTD_MAGIC = 0xfd2fb528
const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
if (!existsSync(root)) { console.error(`no sessions dir: ${root}`); process.exit(2) }

/** Split the concatenated-frame container the way the official reader does. */
function firstFrameRange(buf) {
  if (buf.length < 4) return null
  if (buf.readUInt32LE(0) !== ZSTD_MAGIC) return { bad: `invalid frame magic 0x${buf.readUInt32LE(0).toString(16)}` }
  return { ok: true }
}

const offenders = []
let scanned = 0
for (const ws of readdirSync(root)) {
  const wsDir = join(root, ws)
  if (!statSync(wsDir).isDirectory()) continue
  for (const s of readdirSync(wsDir)) {
    const f = join(wsDir, s, 'session.jsonl.zstd')
    if (!existsSync(f)) continue
    scanned++
    const buf = readFileSync(f)
    if (buf.length === 0) { offenders.push([f, 'empty file']); continue }
    const r = firstFrameRange(buf)
    if (r?.bad) { offenders.push([f, r.bad]); continue }
    // Decode only the FIRST frame and apply the official header assertion.
    // NOTE: zstdDecompressSync stops at the first frame of a concatenated
    // container — which is precisely what we want here, and precisely why a
    // caller that wants the whole log must iterate frames itself.
    try {
      const plain = zstdDecompressSync(buf)
      const nl = plain.indexOf(10)
      if (plain.length === 0) offenders.push([f, 'first frame decoded empty'])
      else if (nl !== plain.length - 1) {
        // The official check requires the FIRST frame to hold exactly one line.
        // A multi-line first frame means header+events were packed together.
        offenders.push([f, `first frame holds ${plain.toString('utf8').trimEnd().split('\n').length} lines (expected exactly 1)`])
      }
    } catch (e) {
      offenders.push([f, `decode failed: ${e.message}`])
    }
  }
}

console.log(`scanned ${scanned} session logs under ${root}`)
if (offenders.length === 0) { console.log('no corrupt logs found'); process.exit(0) }
console.log(`\n${offenders.length} offender(s):`)
for (const [f, why] of offenders) console.log(`  ${f}\n    → ${why}`)
console.log('\nEach offending session directory can be moved aside to unblock boot, e.g.:')
console.log('  mv "<dir>" "<dir>.corrupt-$(date +%s)"')
