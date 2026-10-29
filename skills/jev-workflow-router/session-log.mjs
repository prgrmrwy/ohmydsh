// Decode DSH session event logs (`session.v*.jsonl.zstd`) without an external
// `zstd` binary.
//
// Why this exists: two things break naive decoding on a stock machine.
//
//  1. Node has no `zstd` *CLI* dependency, and the previous implementations
//     shelled out to `zstd -dc`. On a machine without that binary the readiness
//     probe reported `decodeFailed: true` forever and the test fixture could not
//     even be built. Neither is acceptable: the probe must work wherever Node
//     itself works.
//
//  2. DSH appends each log write as its own zstd frame, so a session log is a
//     multi-frame stream. `zlib.zstdDecompressSync(buf)` and
//     `createZstdDecompress()` both stop after the FIRST frame and report
//     success — a 996 KiB log decoded to 218 bytes, silently. Anything that
//     treats "decompression returned" as "whole log read" is wrong.
//
// So frames are located by the zstd magic number and decoded one at a time, and
// the concatenation is the log text. A candidate boundary that does not decode
// is treated as not-a-frame (the magic can occur inside compressed data), and
// the output must be non-empty and larger than any single frame for multi-frame
// input — otherwise the decode is refused rather than reported as success.
//
// Kept inside the skill directory on purpose: sync copies each skill directory
// wholesale into `$DSH_HOME/skills/<id>/` (`scripts/sync.mjs`), so a deployed
// recorder cannot import anything from `scripts/lib/`. `scripts/jev-readiness.mjs`
// imports this module from the repo and tests exercise the same code.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** zstd frame magic number, little-endian `0xFD2FB528`. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Session log file names, newest format first. */
export const SESSION_LOG_NAMES = ['session.v4.jsonl.zstd', 'session.v3.jsonl.zstd']

/** Structured reasons a session log can be unreadable. */
export const SESSION_LOG_REASONS = Object.freeze({
  NO_SESSION_ID: 'no-session-id',
  ROOT_MISSING: 'sessions-root-missing',
  FILE_MISSING: 'session-file-missing',
  DECODE_FAILED: 'decode-failed',
  NO_REQUEST_HEADER: 'no-request-header',
})

/**
 * Locate a session's log file under `<dshHome>/sessions/<workspace>/<sessionId>/`.
 * Prefers the newest format present; a v3 log is only used when no v4 exists.
 *
 * @param {{ dshHome: string, sessionId?: string }} options
 * @returns {{ file?: string, name?: string, reason?: string }}
 */
export function findSessionLog({ dshHome, sessionId }) {
  if (!sessionId) return { reason: SESSION_LOG_REASONS.NO_SESSION_ID }
  const root = path.join(dshHome, 'sessions')
  if (!existsSync(root)) return { reason: SESSION_LOG_REASONS.ROOT_MISSING }
  for (const name of SESSION_LOG_NAMES) {
    let workspaces
    try {
      workspaces = readdirSync(root)
    } catch {
      return { reason: SESSION_LOG_REASONS.ROOT_MISSING }
    }
    for (const workspace of workspaces) {
      const file = path.join(root, workspace, sessionId, name)
      try {
        if (existsSync(file) && statSync(file).isFile()) return { file, name }
      } catch {
        // A vanished or unreadable candidate is simply not this session's log.
      }
    }
  }
  return { reason: SESSION_LOG_REASONS.FILE_MISSING }
}

/**
 * Split a multi-frame zstd buffer into decoded chunks.
 *
 * Frames are found by magic number; any candidate whose bytes fail to decode is
 * skipped rather than trusted, because the four-byte sequence can appear inside
 * compressed payload data. Returns the decoded chunks in order.
 *
 * @param {Buffer} buffer
 * @returns {Buffer[]}
 */
export function decodeZstdFrames(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return []
  const offsets = []
  let index = buffer.indexOf(ZSTD_MAGIC)
  while (index !== -1) {
    offsets.push(index)
    index = buffer.indexOf(ZSTD_MAGIC, index + ZSTD_MAGIC.length)
  }
  if (offsets.length === 0) return []

  const chunks = []
  for (let position = 0; position < offsets.length; position += 1) {
    const start = offsets[position]
    const end = position + 1 < offsets.length ? offsets[position + 1] : buffer.length
    try {
      const decoded = zlib.zstdDecompressSync(buffer.subarray(start, end))
      if (decoded.length > 0) chunks.push(decoded)
    } catch {
      // Not a real frame boundary; the magic occurred inside payload data.
    }
  }
  return chunks
}

/**
 * Decode a whole zstd buffer to text, tolerating multi-frame streams.
 *
 * The convenience APIs decode only the first frame. When more than one valid
 * frame exists, their result is shorter than the concatenated one and is
 * discarded; the caller never sees a silently truncated log.
 *
 * @param {Buffer} buffer
 * @returns {{ ok: true, text: string, frames: number } | { ok: false, reason: string }}
 */
export function decodeZstdText(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return { ok: false, reason: SESSION_LOG_REASONS.DECODE_FAILED }
    }
    const chunks = decodeZstdFrames(buffer)
    if (chunks.length === 0) return { ok: false, reason: SESSION_LOG_REASONS.DECODE_FAILED }
    const framed = Buffer.concat(chunks)
    // Fast path: a single-frame stream needs no framing. Compare lengths so a
    // multi-frame stream can never be reported as the (short) first frame.
    let whole
    try {
      whole = zlib.zstdDecompressSync(buffer)
    } catch {
      whole = null
    }
    const text = whole !== null && whole.length >= framed.length
      ? whole.toString('utf8')
      : framed.toString('utf8')
    return { ok: true, text, frames: chunks.length }
  } catch {
    return { ok: false, reason: SESSION_LOG_REASONS.DECODE_FAILED }
  }
}

/**
 * Read and decode a session log file.
 *
 * @param {string} file
 * @returns {{ ok: true, text: string, frames: number } | { ok: false, reason: string }}
 */
export function readSessionLogFile(file) {
  let buffer
  try {
    buffer = readFileSync(file)
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'ENOENT' ? SESSION_LOG_REASONS.FILE_MISSING : SESSION_LOG_REASONS.DECODE_FAILED,
    }
  }
  return decodeZstdText(buffer)
}

/**
 * Parse decoded log text into event objects, skipping unparseable lines.
 *
 * @param {string} text
 * @returns {object[]}
 */
export function parseSessionEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // Partial trailing writes and unknown line shapes are not fatal.
    }
  }
  return events
}

/**
 * Build a multi-frame zstd buffer from strings. Used by tests to create
 * realistic fixtures without an external `zstd` binary.
 *
 * @param {string[]} parts - one frame per entry.
 * @returns {Buffer}
 */
export function encodeZstdFrames(parts) {
  const frames = parts.map((part) => zlib.zstdCompressSync(Buffer.from(part, 'utf8')))
  return Buffer.concat(frames)
}
