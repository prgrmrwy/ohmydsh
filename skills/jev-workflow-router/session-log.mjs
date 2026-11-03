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
// Scan frame headers and blocks before decoding: magic bytes can occur inside
// payloads, and some Node versions return partial plaintext for truncated frames.
// Reject the whole log on corruption or truncation; never skip failed segments.
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
 * Decode structurally complete standard zstd frames in file order.
 * Reject corrupt or truncated frames, including any non-frame prefix/suffix.
 *
 * @param {Buffer} buffer
 * @returns {Buffer[]}
 */
export function decodeZstdFrames(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return []
  const chunks = []
  let offset = 0
  const advance = length => {
    if (length > buffer.length - offset) throw new Error('Incomplete zstd frame')
    offset += length
  }
  while (offset < buffer.length) {
    const start = offset
    advance(4)
    if (!buffer.subarray(start, offset).equals(ZSTD_MAGIC)) throw new Error('Invalid zstd magic')
    advance(1)
    const descriptor = buffer[offset - 1]
    if (descriptor & 0x18) throw new Error('Invalid zstd frame header')
    const singleSegment = Boolean(descriptor & 0x20)
    const contentSizeFlag = descriptor >>> 6
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    advance((singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes)
    for (;;) {
      advance(3)
      const block = buffer.readUIntLE(offset - 3, 3)
      const type = (block >>> 1) & 3
      if (type === 3) throw new Error('Invalid zstd block type')
      advance(type === 1 ? 1 : block >>> 3)
      if (block & 1) break
    }
    if (descriptor & 4) advance(4)
    chunks.push(zlib.zstdDecompressSync(buffer.subarray(start, offset)))
  }
  return chunks
}

/**
 * Decode every frame, or report decode-failed without returning a partial log.
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
    return { ok: true, text: Buffer.concat(chunks).toString('utf8'), frames: chunks.length }
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
