#!/usr/bin/env node
/**
 * Repair one DSH session log that fails at boot with:
 *   "corrupt Zstandard session log: first frame is not exactly one header line"
 *
 * The official reader requires the FIRST zstd frame to contain exactly one
 * header line; events must live in later frames. When a writer packed the
 * header together with events into a single frame, the bytes are still intact
 * — only the frame split is wrong. This re-splits them.
 *
 * Usage:
 *   node repair-session-log.mjs <path-to-session.jsonl.zstd> [--write]
 *
 * Without --write it only reports (dry run). With --write it backs the file up
 * to "<file>.bak-<timestamp>" first, then writes the repaired container.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

/**
 * Decode EVERY frame of the concatenated container.
 * `zstdDecompressSync` stops after the first frame, so a naive call silently
 * returns only the header when a log holds several frames.
 */
function decodeAllFrames(buf) {
  const out = []
  let offset = 0
  while (offset < buf.length) {
    if (buf.length - offset < 4 || buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      if (out.length === 0) throw new Error(`invalid frame magic at byte ${offset}`)
      break // trailing torn bytes: the official reader tolerates a partial final frame
    }
    const rest = buf.subarray(offset)
    let plain
    try { plain = zstdDecompressSync(rest) } catch (e) {
      if (out.length === 0) throw e
      break // final frame incomplete
    }
    out.push(plain)
    // Re-compressing is not reliable for length; find the next magic instead.
    let next = -1
    for (let i = offset + 4; i + 4 <= buf.length; i++) {
      if (buf.readUInt32LE(i) === ZSTD_MAGIC) { next = i; break }
    }
    if (next === -1) break
    offset = next
  }
  return Buffer.concat(out)
}

const [file, ...flags] = process.argv.slice(2)
const write = flags.includes('--write')
if (!file) { console.error('usage: node repair-session-log.mjs <session.jsonl.zstd> [--write]'); process.exit(2) }
if (!existsSync(file)) { console.error(`not found: ${file}`); process.exit(2) }

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

let plain
try {
  plain = decodeAllFrames(readFileSync(file))
} catch (e) {
  console.error(`cannot decompress: ${e.message}`)
  console.error('The bytes are damaged, not merely mis-framed — this file cannot be repaired;')
  console.error('move its session directory aside instead.')
  process.exit(1)
}

const text = plain.toString('utf8')
if (!text.endsWith('\n')) { console.error('log does not end with a newline; refusing to guess a record boundary'); process.exit(1) }

const lines = text.slice(0, -1).split('\n')
if (lines.length === 0) { console.error('log is empty'); process.exit(1) }

// Validate that every record is parseable JSON before rewriting anything.
for (const [i, line] of lines.entries()) {
  try { JSON.parse(line) } catch { console.error(`line ${i + 1} is not valid JSON; refusing to rewrite`); process.exit(1) }
}

console.log(`records: ${lines.length} (1 header + ${lines.length - 1} events)`)
if (lines.length === 1) console.log('note: header-only log; the repaired file will hold a single frame')

// Frame 1: exactly the header line. Frame 2 (if any): every remaining event.
const headerFrame = zstdCompressSync(Buffer.from(lines[0] + '\n', 'utf8'), CHECKSUM)
const parts = [headerFrame]
if (lines.length > 1) parts.push(zstdCompressSync(Buffer.from(lines.slice(1).join('\n') + '\n', 'utf8'), CHECKSUM))
const repaired = Buffer.concat(parts)

// Self-check with the official invariant before touching the original.
const firstPlain = zstdDecompressSync(headerFrame)
if (firstPlain.length === 0 || firstPlain.indexOf(10) !== firstPlain.length - 1) {
  console.error('internal check failed: rebuilt first frame is still not one header line'); process.exit(1)
}
if (decodeAllFrames(repaired).toString('utf8') !== text) {
  console.error('internal check failed: repaired content differs from the original'); process.exit(1)
}
console.log('verified: first frame holds exactly one header line, and content is byte-identical')

if (!write) { console.log('\ndry run — nothing written. Re-run with --write to apply.'); process.exit(0) }

const backup = `${file}.bak-${Date.now()}`
copyFileSync(file, backup)
writeFileSync(file, repaired)
console.log(`backup: ${backup}`)
console.log(`repaired: ${file}`)
