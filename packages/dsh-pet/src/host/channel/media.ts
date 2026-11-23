/** Host-owned, caller-bound Lark image admission for one durable Delivery. */

import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AttachmentStore,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { petCliArgs } from './cli.js'
import { killProcessTree } from './media-process.js'
import {
  extractSecondFrames,
  LOCUS_VIDEO_LIMITS,
  type SecondFrameExtraction,
  type FrameTools,
  type VideoLimits,
  type VideoSkipReason,
} from './media-video.js'
import { meetsPetLarkCliFloor } from './lark-cli-compat.js'
import { extractMessageLinksFromRaw } from '../locus/message-link.js'
import { createCursorStore, type CursorKind, type CursorStore } from '../locus/media-cursor.js'
import {
  initialTopicState,
  readTopicPage,
  type TopicMessage,
  type TopicReaderState,
  type TopicRunnerResult,
} from '../locus/topic-reader.js'
import type { LarkCliRunner } from './lark.js'

const run = promisify(execFile) as unknown as LarkCliRunner
const CALL_TIMEOUT_MS = 20_000
const MAX_METADATA_ITEMS = 8
const MAX_METADATA_FIELD = 128
const MAX_RECEIPT_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 4 * 1024
/**
 * How often the growing spool entry is measured.
 *
 * The official CLI has no byte ceiling of its own, so the bound is enforced
 * here: an over-limit download is killed within one interval of crossing the
 * limit. 50 ms on a local disk keeps the overshoot far below anything a
 * deployment limit would care about, without inotify/fsevents portability.
 */
const SPOOL_POLL_MS = 50
/** Default `execFile` stdout ceiling for platform envelopes (design D9). */
export const LOCUS_ENVELOPE_MAX_BYTES = 128 * 1024 * 1024
/** Default free-space floor of the spool volume (design D9); below it work stops. */
export const LOCUS_DISK_RESERVE_BYTES = 512 * 1024 * 1024
/** Random token length of one spool entry, in bytes (32 hex characters). */
const SPOOL_TOKEN_BYTES = 16
export interface LarkMessageResource {
  readonly kind: 'image' | 'file' | 'audio' | 'video' | 'media' | 'unknown'
  readonly key?: string
  readonly name?: string
}

export interface ParsedMessageResources {
  readonly imageKeys: readonly string[]
  readonly unsupported: readonly LarkMessageResource[]
}

export type LocusMediaAdmission =
  | { readonly kind: 'ready'; readonly content: readonly ContentBlock[] }
  | { readonly kind: 'none'; readonly content: readonly ContentBlock[] }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly content: readonly ContentBlock[] }

/** One piece of model-facing media output, in the order the message presents it. */
export type LocusMessagePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }

/** Closed vocabulary of why a single-message read produced no message at all. */
export type LocusMessageReadFailure =
  | 'invalid-message-id'
  | 'aborted'
  | 'platform-read-failed'
  | 'envelope-invalid'
  | 'message-not-unique'
  | 'message-mismatch'
  | 'message-deleted'
  | 'chat-mismatch'
  | 'content-unparseable'
  | 'media-unavailable'
  | 'deadline-exceeded'
export interface LocusMediaPort {
  readonly available: boolean
  readonly diagnostic?: string
  admitCurrentImage(input: {
    readonly messageId: string
    readonly signal: AbortSignal
    /** Exact durable current fence, invoked immediately before persistence. */
    readonly fenceBeforeSave: () => Promise<boolean>
  }): Promise<LocusMediaAdmission>
  /**
   * Paged read of one message or merge-forward of the caller's chat (change
   * `locus-read-referenced-chats`): a ledger plus Host data blocks and typed
   * images, continued with the returned `cursor`.
   */
  readMessagePage(input: LocusPageInput): Promise<LocusPageResult>
  /**
   * Paged read of the message a Feishu message link in one entrance message
   * points at (design D3): the link comes from that message's raw body; the
   * platform's `is_authorized` and a raw read of the target gate everything.
   */
  readLinkedPage(input: LocusLinkedPageInput): Promise<LocusPageResult>
}

/**
 * A version-verified official CLI plus the one directory it may write into.
 *
 * A bare executable path is not enough: the version must meet Pet's verified
 * floor, and the spool is the only place a downloaded byte may exist on disk.
 */
export interface VerifiedLarkDownloader {
  readonly binary: string
  /** Reported version; must satisfy `meetsPetLarkCliFloor`. */
  readonly version: string
  /** Pet-owned 0700 directory, already inside the locus child's denied roots. */
  readonly spoolRoot: string
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function parseJsonSuffix(text: string): unknown {
  const lines = text.trim().split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    try { return JSON.parse(lines.slice(index).join('\n')) } catch { /* try next boundary */ }
  }
  return undefined
}

function bounded(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\r\n\0]/g, ' ').trim()
  return clean === '' ? undefined : clean.slice(0, MAX_METADATA_FIELD)
}

/** Strictly select one returned message and retain first-occurrence image order. */
export function parseSingleMessageResources(value: unknown, expectedMessageId: string): ParsedMessageResources {
  const envelope = recordOf(value)
  if (envelope?.['ok'] !== true) throw new Error('mget-envelope-invalid')
  const messages = recordOf(envelope['data'])?.['messages']
  if (!Array.isArray(messages) || messages.length !== 1) throw new Error('mget-message-not-unique')
  const message = recordOf(messages[0])
  if (message?.['message_id'] !== expectedMessageId) throw new Error('mget-message-mismatch')

  const keys = new Set<string>()
  const unsupported: LarkMessageResource[] = []
  const content = typeof message['content'] === 'string' ? message['content'] : ''
  for (const match of content.matchAll(/!\[Image\]\((img_[A-Za-z0-9_-]+)\)/g)) keys.add(match[1]!)
  for (const match of content.matchAll(/<(file|folder)\s+key="file_[A-Za-z0-9_-]+"(?:\s+name="([^"]*)")?\s*\/>/g)) {
    const name = bounded(match[2])
    unsupported.push({ kind: 'file', ...(name === undefined ? {} : { name }) })
  }
  // `+messages-mget` renders a video — a `media` message or a post's `media`
  // element — as `[Media: file_…]`; it is the only video marker in the formatted body.
  const videoMarkers = content.match(/\[Media:\s*file_[A-Za-z0-9_-]+\]/g) ?? []
  for (let index = 0; index < videoMarkers.length && unsupported.length < MAX_METADATA_ITEMS; index += 1) {
    unsupported.push({ kind: 'video' })
  }
  const directKey = bounded(message['image_key'])
  if (directKey?.startsWith('img_')) keys.add(directKey)

  const resources = message['resources']
  if (Array.isArray(resources)) {
    for (const item of resources.slice(0, MAX_METADATA_ITEMS)) {
      const resource = recordOf(item)
      if (resource === undefined) continue
      const rawType = bounded(resource['type'] ?? resource['resource_type'])
      const key = bounded(resource['file_key'] ?? resource['image_key'] ?? resource['key'])
      const kind = rawType === 'image' || rawType === 'file' || rawType === 'audio' || rawType === 'video' || rawType === 'media'
        ? rawType : key?.startsWith('img_') ? 'image' : 'unknown'
      if (kind === 'image' && key?.startsWith('img_')) keys.add(key)
      else {
        const name = bounded(resource['name'])
        unsupported.push({ kind, ...(key === undefined ? {} : { key }), ...(name === undefined ? {} : { name }) })
      }
    }
  }
  const msgType = bounded(message['msg_type'])
  if (msgType !== undefined && msgType !== 'text' && msgType !== 'post' && msgType !== 'image') {
    unsupported.push({ kind: msgType === 'file' || msgType === 'audio' || msgType === 'video' || msgType === 'media' ? msgType : 'unknown' })
  }
  // A `media` message is reported by its type AND its body marker: keep one entry
  // per kind so the note does not name the same video twice.
  const seen = new Set<string>()
  const distinct = unsupported.filter(item => {
    const kind = isVideo(item) ? 'video' : item.kind
    if (kind !== 'video' && item.name !== undefined) return true
    if (seen.has(kind)) return false
    seen.add(kind)
    return true
  })
  return { imageKeys: [...keys], unsupported: distinct.slice(0, MAX_METADATA_ITEMS) }
}

/** Detect supported MIME from bytes, never filename or transport claims. */
export function detectImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && String.fromCharCode(...data.slice(0, 6)) === 'GIF87a') return 'image/gif'
  if (data.length >= 6 && String.fromCharCode(...data.slice(0, 6)) === 'GIF89a') return 'image/gif'
  if (data.length >= 12 && String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

function isVideo(resource: LarkMessageResource): boolean {
  return resource.kind === 'video' || resource.kind === 'media'
}

/**
 * Bounded notes for resources the automatic path does not read.
 *
 * A video is never downloaded or framed here; the note names the on-demand tool
 * and this message's id so the child can ask for the cover and keyframes.
 */
function unsupportedContent(resources: readonly LarkMessageResource[], messageId: string): ContentBlock[] {
  if (resources.length === 0) return []
  const blocks: ContentBlock[] = []
  const others = resources.filter(item => !isVideo(item))
  if (others.length > 0) {
    const kinds = [...new Set(others.map(item => item.kind))].join(', ')
    blocks.push({ type: 'text', text: `[当前消息还包含暂不支持的资源类型：${kinds || 'unknown'}；未下载、执行、解压、转码或 OCR。]` })
  }
  if (resources.some(isVideo)) {
    blocks.push({
      type: 'text',
      text: `[当前消息含视频：未下载、未抽帧。可用 \`pet_locus_message\` 读取该消息（id ${messageId}）查看其封面与场景关键帧。]`,
    })
  }
  return blocks
}

/** What the path-mode receipt must prove about the file Pet is about to read. */
interface SpoolReceipt {
  readonly savedName: string
  /** Declared size; absent when the platform did not report a Content-Length. */
  readonly sizeBytes?: number
}

function parseSpoolReceipt(stdout: string): SpoolReceipt | undefined {
  const envelope = recordOf(parseJsonSuffix(stdout))
  const receipt = envelope?.['ok'] === true ? recordOf(envelope['data']) : envelope
  const savedPath = receipt?.['saved_path']
  if (typeof savedPath !== 'string' || savedPath.trim() === '') return undefined
  const savedName = savedPath.split(/[\\/]/).pop()
  if (savedName === undefined || savedName === '') return undefined
  const value = receipt?.['size_bytes']
  return {
    savedName,
    // A negative size means "the platform did not say"; the file itself is
    // then the only measurement, and Pet bounds it by its own limit.
    ...(Number.isSafeInteger(value) && (value as number) >= 0 ? { sizeBytes: value as number } : {}),
  }
}

/**
 * Every entry inside one call's own directory.
 *
 * Each download gets a directory of its own rather than a filename inside a
 * shared one: the CLI saves atomically (temp file plus rename) and cannot be
 * relied on to name that temp file predictably, so "delete what this call
 * created" is only provable if the call owns the whole directory.
 */
function spoolEntries(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function largestSpoolEntry(dir: string): number {
  let largest = 0
  for (const name of spoolEntries(dir)) {
    try {
      largest = Math.max(largest, statSync(join(dir, name)).size)
    } catch { /* renamed or removed mid-measurement */ }
  }
  return largest
}

function removeSpoolDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* startup sweep is the backstop */ }
}

/**
 * Delete every leftover in the media spool.
 *
 * Called once at Pet startup: at that moment no download can be in flight, so
 * anything in the directory is debris from a crash and must never be read as
 * one.
 * @param spoolRoot - Pet-owned spool directory.
 * @returns how many entries were removed.
 */
export async function sweepMediaSpool(spoolRoot: string): Promise<number> {
  let removed = 0
  try {
    for (const name of readdirSync(spoolRoot)) {
      try {
        rmSync(join(spoolRoot, name), { recursive: true, force: true })
        removed += 1
      } catch { /* leave it for the next startup */ }
    }
  } catch { /* a missing spool directory means there is nothing to sweep */ }
  return removed
}

/**
 * Download one resource with the official CLI into the guarded spool.
 *
 * The bytes land in a Pet-owned directory that the locus child's project-read
 * guard already refuses, under a random name the CLI is told to honour. Because
 * the official path mode has no byte ceiling, the caller's limit is enforced by
 * measuring the growing entry and killing the whole process group on breach;
 * nothing survives the call either way.
 *
 * `use` runs while the verified file still exists — this is how a video is framed
 * in place without ever copying it out of the guarded directory. The directory
 * is removed when `use` settles, however it settles. The downloader's own
 * watchdogs end with the downloader: they must not outlive it, or a late tick
 * could signal a recycled process group.
 */
export async function withSpoolDownload<T>(input: {
  readonly binary: string
  readonly spoolRoot: string
  readonly args: readonly string[]
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly signal: AbortSignal
  /** Free-space floor of the spool volume; defaults to {@link LOCUS_DISK_RESERVE_BYTES}. */
  readonly diskReserveBytes?: number
  /** Free bytes of the spool volume; defaults to `statfs(spoolRoot)`. Injectable for tests. */
  readonly freeBytes?: () => Promise<number> | number
}, use: (file: SpoolFile, phaseSignal: AbortSignal) => Promise<T>): Promise<T> {
  if (input.signal.aborted) throw new Error('download-aborted')
  const token = randomBytes(SPOOL_TOKEN_BYTES).toString('hex')
  const targetName = `${token}.bin`
  const dir = join(input.spoolRoot, token)
  const target = join(dir, targetName)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const child = spawn(input.binary, [...input.args, '--output', `./${targetName}`], {
    windowsHide: true,
    cwd: dir,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderrTail = ''
  let failure: Error | undefined
  let exited = false
  let diskLow = false
  const phase = new AbortController()
  const fail = (error: Error): void => {
    if (failure !== undefined) return
    failure = error
    killProcessTree(child)
  }
  const onAbort = () => fail(new Error('download-aborted'))
  input.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => fail(new Error('download-timeout')), input.timeoutMs)
  timer.unref?.()
  const reserve = input.diskReserveBytes ?? LOCUS_DISK_RESERVE_BYTES
  const measureFree = input.freeBytes ?? (async (): Promise<number> => {
    const stats = await statfs(input.spoolRoot)
    return Number(stats.bavail) * Number(stats.bsize)
  })
  let measuring = false
  // One watcher covers BOTH the download and the `use` phase (frame extraction):
  // it measures the volume's free space (concurrent calls included) and the
  // growing entry's size, and stops everything on a breach.
  const poll = setInterval(() => {
    if (!exited && largestSpoolEntry(dir) > input.maxBytes) fail(new Error('download-byte-limit-exceeded'))
    if (measuring) return
    measuring = true
    void Promise.resolve().then(measureFree).then(free => {
      if (free < reserve && !diskLow) {
        diskLow = true
        phase.abort()
        if (!exited) fail(new Error('disk-low'))
      }
    }).catch(() => { /* an unreadable volume is no evidence of low space */ }).finally(() => { measuring = false })
  }, SPOOL_POLL_MS)
  poll.unref?.()

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (data.byteLength > MAX_RECEIPT_BYTES - Buffer.byteLength(stdout)) {
      fail(new Error('download-receipt-too-large'))
      return
    }
    stdout += data.toString()
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrTail = (stderrTail + (Buffer.isBuffer(chunk) ? chunk.toString() : chunk)).slice(-MAX_STDERR_BYTES)
  })
  child.on('error', error => fail(error))

  try {
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null]
    exited = true
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onAbort)
    if (failure !== undefined) throw failure
    if (code !== 0 || signal !== null) {
      if (/No space left on device|ENOSPC/.test(stderrTail)) throw new Error('disk-low')
      // The CLI prints a failure envelope on stderr (stdout when it is not empty): keep its platform code.
      const doc = failureDocument(stdout) ?? failureDocument(stderrTail)
      const platformCode = doc === undefined ? undefined : recordOf(doc['error'])?.['code']
      throw Object.assign(new Error('download-process-failed'), typeof platformCode === 'number' ? { platformCode } : {})
    }

    const receipt = parseSpoolReceipt(stdout)
    // The CLI must have written the name it was given: a different basename
    // means it invented a path Pet did not choose, and nothing about that file
    // is proven.
    if (receipt === undefined || receipt.savedName !== targetName) {
      throw new Error('download-receipt-name-mismatch')
    }
    let size: number
    try {
      size = statSync(target).size
    } catch {
      throw new Error('download-output-missing')
    }
    if (size > input.maxBytes) throw new Error('download-byte-limit-exceeded')
    if (receipt.sizeBytes !== undefined && receipt.sizeBytes !== size) {
      throw new Error('download-receipt-size-mismatch')
    }
    let result: T
    try {
      result = await use({ dir, name: targetName, path: target, size }, AbortSignal.any([input.signal, phase.signal]))
    } catch (error) {
      if (diskLow) throw new Error('disk-low')
      throw error
    }
    if (diskLow) throw new Error('disk-low')
    return result
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    input.signal.removeEventListener('abort', onAbort)
    if (!exited) killProcessTree(child)
    removeSpoolDir(dir)
  }
}


/** Why one CLI envelope read produced no usable envelope. */
export type CliEnvelopeFailureReason =
  | 'platform-error'
  | 'envelope-too-large'
  | 'envelope-invalid'
  | 'disk-low'
  | 'aborted'
  | 'timeout'
  | 'cli-failed'

export type CliEnvelopeResult =
  | { readonly kind: 'ok'; readonly envelope: Record<string, unknown>; readonly bytes: number }
  | {
    readonly kind: 'failed'
    readonly reason: CliEnvelopeFailureReason
    /** The platform's own error code when the failure envelope carried one. */
    readonly platformCode?: number
    /** Observed stdout size for `envelope-too-large`. */
    readonly bytes?: number
  }

/** The LAST parseable JSON document of a text (one line, or a pretty-printed suffix). */
function lastJsonDocument(text: string): Record<string, unknown> | undefined {
  const lines = text.trim().split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const doc = recordOf(JSON.parse(lines.slice(index).join('\n')))
      if (doc !== undefined) return doc
    } catch { /* keep walking toward the start */ }
  }
  return undefined
}

function failureDocument(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== 'string') return undefined
  const doc = lastJsonDocument(text)
  return doc !== undefined && (doc['ok'] === false || recordOf(doc['error']) !== undefined) ? doc : undefined
}

function platformFailure(doc: Record<string, unknown>): CliEnvelopeResult {
  const code = recordOf(doc['error'])?.['code']
  return { kind: 'failed', reason: 'platform-error', ...(typeof code === 'number' ? { platformCode: code } : {}) }
}

/**
 * Run one official-CLI JSON call and read its envelope (design D4, D9).
 *
 * A failure envelope is read from stdout first and, when stdout has none, from
 * stderr (the last parseable document) — the real CLI prints it on stderr with
 * an empty stdout. An envelope above `maxBuffer` is `envelope-too-large` with
 * its byte count, never an empty success.
 */
export async function runLarkEnvelope(
  runner: LarkCliRunner,
  binary: string,
  args: readonly string[],
  options: { readonly signal: AbortSignal; readonly timeoutMs: number; readonly maxBufferBytes?: number },
): Promise<CliEnvelopeResult> {
  let stdout: string
  try {
    stdout = (await runner(binary, args, {
      windowsHide: true,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBufferBytes ?? LOCUS_ENVELOPE_MAX_BYTES,
      signal: options.signal,
    })).stdout
  } catch (error) {
    const failed = recordOf(error)
    if (failed?.['code'] === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      const out = failed['stdout']
      return { kind: 'failed', reason: 'envelope-too-large', bytes: typeof out === 'string' ? Buffer.byteLength(out) : 0 }
    }
    if (options.signal.aborted || failed?.['name'] === 'AbortError' || failed?.['code'] === 'ABORT_ERR') {
      return { kind: 'failed', reason: 'aborted' }
    }
    if (failed?.['killed'] === true) return { kind: 'failed', reason: 'timeout' }
    const doc = failureDocument(failed?.['stdout']) ?? failureDocument(failed?.['stderr'])
    if (doc !== undefined) return platformFailure(doc)
    const stderr = failed?.['stderr']
    if (typeof stderr === 'string' && /No space left on device|ENOSPC/.test(stderr)) return { kind: 'failed', reason: 'disk-low' }
    return { kind: 'failed', reason: 'cli-failed' }
  }
  const doc = lastJsonDocument(stdout)
  if (doc === undefined) return { kind: 'failed', reason: 'envelope-invalid' }
  if (doc['ok'] === false) return platformFailure(doc)
  if (doc['ok'] !== true) return { kind: 'failed', reason: 'envelope-invalid' }
  return { kind: 'ok', envelope: doc, bytes: Buffer.byteLength(stdout) }
}

/** A verified download, still inside its call-owned directory. */
interface SpoolFile {
  readonly dir: string
  /** Relative name inside `dir`. */
  readonly name: string
  readonly path: string
  readonly size: number
}

/** Download one resource and return its bytes; nothing is left on disk. */
async function downloadIntoSpool(input: Parameters<typeof withSpoolDownload>[0]): Promise<Uint8Array> {
  return withSpoolDownload(input, async file => {
    const data = readFileSync(file.path)
    if (data.byteLength > input.maxBytes) throw new Error('download-byte-limit-exceeded')
    if (data.byteLength !== file.size) throw new Error('download-output-changed')
    return new Uint8Array(data)
  })
}


const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]{1,128}$/
const IMAGE_KEY_PATTERN = /^img_[A-Za-z0-9_-]+$/
const FILE_KEY_PATTERN = /^file_[A-Za-z0-9_-]+$/
/** Platform message types whose raw `body.content` is a JSON document Pet reads resources from. */
const JSON_CONTENT_TYPES: ReadonlySet<string> = new Set(['post', 'image', 'media', 'file', 'audio'])

/** A resource a message carries, in the order the message presents it. */
export type RawMessageResource =
  | { readonly kind: 'image'; readonly key: string }
  | { readonly kind: 'video'; readonly fileKey: string; readonly coverKey?: string; readonly name?: string; readonly durationMs?: number }
  | { readonly kind: 'file'; readonly name?: string }
  | { readonly kind: 'audio' }
  /** A merge-forward inside a merge-forward: metadata only, never expanded. */
  | { readonly kind: 'nested' }

/** The facts the raw `api GET /im/v1/messages/<id>` read proves about one message. */
export interface RawMessageFacts {
  readonly msgType: string
  readonly createTime?: string
  readonly threadId?: string
  readonly resources: readonly RawMessageResource[]
  /** Feishu message links in the raw `text`/`post` body, in order (see `locus/message-link.ts`). */
  readonly links: readonly string[]
}

class MessageReadError extends Error {
  constructor(readonly reason: LocusMessageReadFailure) {
    super(reason)
    this.name = 'MessageReadError'
  }
}

/** Format epoch milliseconds as ISO 8601 with the host offset (same form the history tool prints). */
function formatEpochMs(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{10,16}$/.test(value)) return undefined
  const date = new Date(Number(value))
  if (Number.isNaN(date.getTime())) return undefined
  const pad = (part: number): string => String(part).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const absolute = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${offset >= 0 ? '+' : '-'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

function singleItem(value: unknown, listKey: 'messages', expectedId: string, expectedChat: string): Record<string, unknown> {
  const envelope = recordOf(value)
  if (envelope?.['ok'] !== true) throw new MessageReadError('envelope-invalid')
  const list = recordOf(envelope['data'])?.[listKey]
  if (!Array.isArray(list)) throw new MessageReadError('envelope-invalid')
  if (list.length !== 1) throw new MessageReadError('message-not-unique')
  const item = recordOf(list[0])
  if (item === undefined) throw new MessageReadError('envelope-invalid')
  if (item['message_id'] !== expectedId) throw new MessageReadError('message-mismatch')
  if (item['chat_id'] !== expectedChat) throw new MessageReadError('chat-mismatch')
  return item
}

/**
 * Parse the RAW message read. It is the only place a video's cover key and the
 * authoritative `chat_id` survive; `+messages-mget` drops the former.
 *
 * Envelope shape measured on lark-cli 1.0.97 (pitfalls §3): the result is in
 * `data.items[0]`, `body.content` is the platform JSON string, and a recalled
 * message is `ok: true` with `deleted: true` and a non-JSON body.
 */
/**
 * The raw read's items: the requested message first, then — only for a
 * merge-forward — its children. Measured 2026-11-13: every child carries
 * `upper_message_id` = the outer id and the chat it came FROM; the outer
 * chat is the one that must match. Anything else fails closed.
 */
function rawItems(value: unknown, expectedId: string, expectedChat: string): {
  readonly item: Record<string, unknown>
  readonly children: readonly Record<string, unknown>[]
} {
  const envelope = recordOf(value)
  if (envelope?.['ok'] !== true) throw new MessageReadError('envelope-invalid')
  const list = recordOf(envelope['data'])?.['items']
  if (!Array.isArray(list)) throw new MessageReadError('envelope-invalid')
  if (list.length === 0) throw new MessageReadError('message-not-unique')
  const item = recordOf(list[0])
  if (item === undefined) throw new MessageReadError('envelope-invalid')
  if (item['message_id'] !== expectedId) throw new MessageReadError('message-mismatch')
  if (item['chat_id'] !== expectedChat) throw new MessageReadError('chat-mismatch')
  if (list.length === 1) return { item, children: [] }
  if (item['msg_type'] !== 'merge_forward') throw new MessageReadError('message-not-unique')
  const children = list.slice(1).map(entry => {
    const child = recordOf(entry)
    if (child === undefined || child['upper_message_id'] !== expectedId || typeof child['message_id'] !== 'string') {
      throw new MessageReadError('envelope-invalid')
    }
    return child
  })
  return { item, children }
}

/** Resources of one raw body, in the order the message presents them. */
function resourcesOf(msgType: string, rawContent: unknown): RawMessageResource[] {
  if (!JSON_CONTENT_TYPES.has(msgType)) return []
  let content: Record<string, unknown> | undefined
  try {
    content = typeof rawContent === 'string' ? recordOf(JSON.parse(rawContent)) : undefined
  } catch {
    content = undefined
  }
  if (content === undefined) throw new MessageReadError('content-unparseable')
  const resources: RawMessageResource[] = []
  const video = (element: Record<string, unknown>): void => {
    const fileKey = element['file_key']
    if (typeof fileKey !== 'string' || !FILE_KEY_PATTERN.test(fileKey)) return
    const cover = element['image_key']
    const name = bounded(element['file_name'])
    const duration = element['duration']
    resources.push({
      kind: 'video',
      fileKey,
      ...(typeof cover === 'string' && IMAGE_KEY_PATTERN.test(cover) ? { coverKey: cover } : {}),
      ...(name === undefined ? {} : { name }),
      ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { durationMs: duration } : {}),
    })
  }
  if (msgType === 'post') {
    const paragraphs = content['content'] ?? content['content_v2']
    if (!Array.isArray(paragraphs)) throw new MessageReadError('content-unparseable')
    for (const paragraph of paragraphs) {
      if (!Array.isArray(paragraph)) continue
      for (const raw of paragraph) {
        const element = recordOf(raw)
        if (element === undefined) continue
        if (element['tag'] === 'img') {
          const key = element['image_key']
          if (typeof key === 'string' && IMAGE_KEY_PATTERN.test(key)) resources.push({ kind: 'image', key })
        } else if (element['tag'] === 'media') video(element)
      }
    }
  } else if (msgType === 'image') {
    const key = content['image_key']
    if (typeof key === 'string' && IMAGE_KEY_PATTERN.test(key)) resources.push({ kind: 'image', key })
  } else if (msgType === 'media') video(content)
  else if (msgType === 'file') {
    const name = bounded(content['file_name'])
    resources.push({ kind: 'file', ...(name === undefined ? {} : { name }) })
  } else resources.push({ kind: 'audio' })
  return resources
}

/** Parse the formatted `+messages-mget` read: sender name, rendered body, topic. */
export function parseFormattedMessage(value: unknown, expectedId: string, expectedChat: string): {
  readonly senderName?: string
  readonly text: string
  readonly threadId?: string
} {
  const item = singleItem(value, 'messages', expectedId, expectedChat)
  const senderName = bounded(recordOf(item['sender'])?.['name'])
  const threadId = bounded(item['thread_id'])
  return {
    ...(senderName === undefined ? {} : { senderName }),
    text: typeof item['content'] === 'string' ? item['content'] : '',
    ...(threadId === undefined ? {} : { threadId }),
  }
}

export const LOCUS_MEDIA_UNAVAILABLE_REASON = 'pinned-cli-media-download-unavailable'


/** Download one image resource, enforce the byte bound, and prove its type from bytes. */
async function downloadImageBytes(input: {
  readonly binary: string
  readonly spoolRoot: string
  readonly messageId: string
  readonly key: string
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly limits: ImageAttachmentLimits
  readonly diskReserveBytes?: number
  readonly freeBytes?: () => Promise<number> | number
}): Promise<SaveImageAttachment> {
  const data = await downloadIntoSpool({
    binary: input.binary,
    spoolRoot: input.spoolRoot,
    args: petCliArgs([
      'im', '+messages-resources-download', '--as', 'bot',
      '--message-id', input.messageId,
      '--file-key', input.key, '--type', 'image', '--format', 'json',
    ]),
    maxBytes: input.maxBytes,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    ...(input.diskReserveBytes === undefined ? {} : { diskReserveBytes: input.diskReserveBytes }),
    ...(input.freeBytes === undefined ? {} : { freeBytes: input.freeBytes }),
  })
  const mediaType = detectImageMediaType(data)
  if (mediaType === undefined || !input.limits.mediaTypes.includes(mediaType)) {
    throw new Error('image-mime-unsupported')
  }
  return { data, mediaType }
}


function skipNote(reason: VideoSkipReason): string {
  return `[视频未抽帧：${reason}。仅提供封面与元数据。]`
}

function secondFramesNote(durationSeconds: number, fromSecond: number, nextSecond: number): string {
  return `[视频截帧：画面截帧，没有声音；每整秒取一帧，时长 ${durationSeconds.toFixed(1)}s，本页读到第 ${String(fromSecond)}–${String(Math.max(fromSecond, nextSecond - 1))} 秒；不得声称已看过完整视频。]`
}

function formatTime(seconds: number): string {
  return `${String(Number(seconds.toFixed(2)))}s`
}

// ---------------------------------------------------------------------------
// Paged read (change `locus-read-referenced-chats`): plan → units → pages.
//
// A read first builds an immutable PLAN of units (a head, text segments,
// resources, metadata notes), then delivers the units in order. The plan is the
// only thing a continuation reads (design D7, D8).
// ---------------------------------------------------------------------------

/** Fixed text segment budget: escaped JSON characters per segment (design D9). */
export const LOCUS_SEGMENT_BUDGET = 4_000
/** Wall-clock bound of ONE page, platform reads, downloads and decoding included. */
export const LOCUS_PAGE_DEADLINE_MS = 90_000
/** One page's capacity in characters of final serialized output (design D9). */
export const LOCUS_PAGE_CAPACITY_CHARS = 16_000
/** Fixed reserve: ledger skeleton, the longest cursor, one failure detail or diagnostic line. */
export const LOCUS_PAGE_RESERVE_CHARS = 1_000
/** Upper bound of one text segment's data block: the 4000 budget plus wrapper, keys and unit id. */
const SEGMENT_BLOCK_MAX_CHARS = LOCUS_SEGMENT_BUDGET + 300
/** Upper bound of one ledger failure line. */
const FAILURE_LINE_MAX_CHARS = 400
/** Worst-case note and failure allowance of one video unit, plus per-frame label cost. */
const VIDEO_UNIT_BASE_CHARS = 700
const FRAME_LINE_CHARS = 120
/** The third failure at one position skips the unit. */
const MAX_ATTEMPTS = 3

/** One terminal failure the ledger reports. */
export interface LocusPageFailure {
  readonly id: string
  readonly reason: string
}

export type LocusPageResult =
  | {
    readonly kind: 'ok'
    /** True only when there is no `cursor` and no terminal failure so far. */
    readonly complete: boolean
    /** Units delivered on THIS page. */
    readonly delivered: number
    /** Terminal failures newly recorded on THIS page. */
    readonly failed: readonly LocusPageFailure[]
    readonly cursor?: string
    /** Host data blocks, Host lines and typed images, in reading order. */
    readonly parts: readonly LocusMessagePart[]
    readonly source?: { readonly chatId: string; readonly name?: string }
    readonly linkIndex?: number
    readonly linkCount?: number
  }
  | {
    readonly kind: 'failed'
    readonly reason: string
    /** Sub-reason, e.g. `cycle` or `unreachable` for `envelope-invalid`. */
    readonly detail?: string
    readonly platformCode?: number
    /** Observed size for `envelope-too-large`. */
    readonly bytes?: number
  }

export interface LocusPageInput {
  /** The entrance message (or the container) to read. */
  readonly messageId: string
  /** The caller's entrance chat id; a topic entrance passes its GROUP chat id. */
  readonly chatId: string
  /** Opaque identity of the calling session and entrance; a cursor is bound to it. */
  readonly caller: string
  readonly cursor?: string
  readonly signal: AbortSignal
  readonly canViewImages: () => Promise<boolean> | boolean
  /** Re-verified after the platform work and before any cursor is issued. */
  readonly isCurrent?: () => boolean
}

/** Where a topic read stands; stored in the cursor snapshot between pages. */
interface TopicState {
  readonly state: TopicReaderState
  readonly threadId: string
  readonly chatId: string
  readonly linkedMessageId: string
  readonly sourceName?: string
  /** The linked message's own single-message plan, used when the topic cannot be listed at all. */
  readonly fallback: readonly PlanUnit[]
  readonly done: boolean
}

export interface LocusLinkedPageInput extends LocusPageInput {
  /** 1-based index among the message's extractable links; default 1, no upper bound. */
  readonly linkIndex?: number
}

type PlanUnit =
  | { readonly kind: 'head'; readonly id: string; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | { readonly kind: 'note'; readonly id: string; readonly text: string }
  | { readonly kind: 'fail'; readonly id: string; readonly reason: string }
  | { readonly kind: 'image'; readonly id: string; readonly key: string; readonly downloadId: string; readonly cover?: boolean }
  | { readonly kind: 'video'; readonly id: string; readonly fileKey: string; readonly downloadId: string }

/** A read that cannot start or continue; carries the vocabulary the result reports. */
class PlanError extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: string,
    readonly platformCode?: number,
    readonly bytes?: number,
    /** Ledger id of the step that failed, when it is not the container read. */
    readonly step?: string,
  ) {
    super(reason)
    this.name = 'PlanError'
  }
}

function escapedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

/** Size of one code point inside the escaped JSON string. */
function escapedSize(codePoint: string): number {
  return codePoint === '<' || codePoint === '>' || codePoint === '&' ? 6 : JSON.stringify(codePoint).length - 2
}

/**
 * Cut text into fixed segments: accumulate each code point's escaped size and
 * break BEFORE the code point that would exceed the budget. A surrogate pair is
 * never split, and the boundaries depend on the text and the budget only.
 * @returns segments with their starting code-point offset.
 */
export function segmentText(text: string, budget: number = LOCUS_SEGMENT_BUDGET): { readonly offset: number; readonly text: string }[] {
  const segments: { offset: number; text: string }[] = []
  let current = ''
  let size = 0
  let start = 0
  let offset = 0
  for (const codePoint of text) {
    const width = escapedSize(codePoint)
    if (current !== '' && size + width > budget) {
      segments.push({ offset: start, text: current })
      current = ''
      size = 0
      start = offset
    }
    current += codePoint
    size += width
    offset += 1
  }
  if (current !== '') segments.push({ offset: start, text: current })
  return segments
}

/** Source-chat names are labels, not content: control characters become spaces, 64 characters at most. */
const LINK_SOURCE_NAME_CHARS = 64
function labelOf(value: string, max: number): string {
  return [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, max).join('')
}

function dataBlock(wrapper: string, payload: Record<string, unknown>): string {
  return `<${wrapper}>\n${escapedJson(payload)}\n</${wrapper}>`
}

/** One node of a raw container read. */
interface TreeNode {
  readonly id: string
  readonly msgType: string
  readonly chatId: string
  readonly deleted: boolean
  readonly content: unknown
  readonly upper?: string
  readonly createTime?: string
  readonly threadId?: string
}

function treeNode(entry: unknown): TreeNode {
  const item = recordOf(entry)
  const id = item?.['message_id']
  const msgType = bounded(item?.['msg_type'])
  if (item === undefined || typeof id !== 'string' || msgType === undefined) throw new PlanError('envelope-invalid')
  const upper = item['upper_message_id']
  const createTime = formatEpochMs(item['create_time'])
  const threadId = bounded(item['thread_id'])
  return {
    id,
    msgType,
    chatId: typeof item['chat_id'] === 'string' ? item['chat_id'] : '',
    deleted: item['deleted'] === true,
    content: recordOf(item['body'])?.['content'],
    ...(typeof upper === 'string' && upper !== '' ? { upper } : {}),
    ...(createTime === undefined ? {} : { createTime }),
    ...(threadId === undefined ? {} : { threadId }),
  }
}

/**
 * Validate the RAW read of a container BEFORE anything is rendered or downloaded
 * (design D5): first item is the root and belongs to this entrance; items are
 * deduplicated by `message_id` (first kept); a walk from the root with a visited
 * set finds cycles; an item the walk cannot reach fails the whole container.
 * @returns the root and its descendants in pre-order (siblings in raw order).
 */
export function parseRawContainer(value: unknown, rootId: string, expectedChat: string): {
  readonly root: TreeNode
  readonly descendants: readonly TreeNode[]
} {
  const envelope = recordOf(value)
  const items = recordOf(envelope?.['data'])?.['items']
  if (envelope?.['ok'] !== true || !Array.isArray(items)) throw new PlanError('envelope-invalid')
  if (items.length === 0) throw new PlanError('message-not-unique')
  const nodes = items.map(treeNode)
  const root = nodes[0]!
  if (root.id !== rootId) throw new PlanError(nodes.length === 1 ? 'message-mismatch' : 'envelope-invalid')
  if (root.chatId !== expectedChat) throw new PlanError('chat-mismatch')
  if (root.deleted) throw new PlanError('message-deleted')
  if (nodes.length === 1) return { root, descendants: [] }
  if (root.msgType !== 'merge_forward') throw new PlanError('message-not-unique')

  const seen = new Set<string>()
  const unique = nodes.filter(node => !seen.has(node.id) && seen.add(node.id))
  const childrenOf = new Map<string, TreeNode[]>()
  for (const node of unique) {
    if (node.upper === undefined) continue
    const siblings = childrenOf.get(node.upper)
    if (siblings === undefined) childrenOf.set(node.upper, [node])
    else siblings.push(node)
  }
  const visited = new Set<string>()
  const order: TreeNode[] = []
  const visit = (node: TreeNode): void => {
    if (visited.has(node.id)) throw new PlanError('envelope-invalid', 'cycle')
    visited.add(node.id)
    order.push(node)
    for (const child of childrenOf.get(node.id) ?? []) visit(child)
  }
  visit(root)
  if (order.length < unique.length) throw new PlanError('envelope-invalid', 'unreachable')
  return { root, descendants: order.slice(1) }
}

const CONTENT_TYPES_WITH_RESOURCES: ReadonlySet<string> = new Set(['post', 'image', 'media', 'file', 'audio'])

function metadataNote(id: string, kind: string, name?: string): PlanUnit {
  return {
    kind: 'note',
    id,
    text: `[元数据：${kind}${name === undefined ? '' : ` ${name}`} · ${id.split('#')[0]!}：仅元数据，未下载、解析或执行。]`,
  }
}

/** The resource and metadata units of one node; `downloadId` is the id every download uses. */
function resourceUnits(node: TreeNode, downloadId: string): PlanUnit[] {
  if (node.deleted || node.msgType === 'text' || node.msgType === 'merge_forward') return []
  if (!CONTENT_TYPES_WITH_RESOURCES.has(node.msgType)) return [metadataNote(`${node.id}#n0`, node.msgType)]
  let resources: RawMessageResource[]
  try {
    resources = resourcesOf(node.msgType, node.content)
  } catch {
    return [{ kind: 'fail', id: `${node.id}#r0`, reason: 'content-unparseable' }]
  }
  const units: PlanUnit[] = []
  let images = 0
  let videos = 0
  let notes = 0
  for (const resource of resources) {
    if (resource.kind === 'image') {
      units.push({ kind: 'image', id: `${node.id}#r${String(images++)}`, key: resource.key, downloadId })
    } else if (resource.kind === 'video') {
      if (resource.coverKey !== undefined) {
        units.push({ kind: 'image', id: `${node.id}#r${String(images++)}`, key: resource.coverKey, downloadId, cover: true })
      }
      units.push({ kind: 'video', id: `${node.id}#v${videos === 0 ? '' : String(videos)}`, fileKey: resource.fileKey, downloadId })
      videos += 1
    } else if (resource.kind === 'file' || resource.kind === 'audio') {
      units.push(metadataNote(`${node.id}#n${String(notes++)}`, resource.kind, resource.kind === 'file' ? resource.name : undefined))
    }
  }
  return units
}

function textUnits(messageId: string, text: string): PlanUnit[] {
  return segmentText(text.replace(/\0/g, '')).map(segment => ({
    kind: 'text' as const, id: `${messageId}#t@${String(segment.offset)}`, text: segment.text,
  }))
}

function headUnit(messageId: string, fields: Record<string, string | undefined>): PlanUnit {
  const clean: Record<string, string> = {}
  for (const [name, value] of Object.entries(fields)) if (value !== undefined) clean[name] = value
  return { kind: 'head', id: `${messageId}#h`, fields: clean }
}

function describeSkippedMedia(images: number, videos: number): string {
  const parts = [images > 0 ? `${String(images)} 张图片` : '', videos > 0 ? `${String(videos)} 段视频` : ''].filter(Boolean)
  return `[当前模型无法查看图片，未下载任何媒体。消息含：${parts.join('、')}。]`
}

export interface CreateLocusMediaPortInput {
  readonly attachments?: AttachmentStore
  /** Resolved only by the official-CLI version-floor probe. */
  readonly download?: VerifiedLarkDownloader
  /** Ordinary runner remains sufficient for metadata-only mget. */
  readonly runner?: LarkCliRunner
  readonly timeoutMs?: number
  /** Fixed `ffmpeg`/`ffprobe` paths from the Host-start probe; absent keeps videos cover-only. */
  readonly frameTools?: FrameTools
  /** Overrides of {@link LOCUS_VIDEO_LIMITS}; non-positive or non-finite values are ignored. */
  readonly video?: Partial<VideoLimits>
  /** Paged-read configuration; the defaults are the owner-approved ones (design D9). */
  readonly page?: { readonly capacityChars?: number; readonly deadlineMs?: number }
  /** Continuation snapshot table; injectable so tests can observe issued cursors. */
  readonly cursors?: CursorStore
  /** Spool volume guard (design D9); defaults are 512 MiB and `statfs` of the spool root. */
  readonly spool?: { readonly diskReserveBytes?: number; readonly freeBytes?: () => Promise<number> | number }
}

/** Create the spooled media port; an unproven CLI performs no I/O at all. */
export function createLocusMediaPort(input: CreateLocusMediaPortInput): LocusMediaPort {
  if (
    input.attachments === undefined
    || input.download === undefined
    || !meetsPetLarkCliFloor(input.download.version)
    || input.download.binary.trim() === ''
    || input.download.spoolRoot.trim() === ''
  ) {
    return {
      available: false,
      diagnostic: LOCUS_MEDIA_UNAVAILABLE_REASON,
      async admitCurrentImage() {
        return { kind: 'unavailable', reason: LOCUS_MEDIA_UNAVAILABLE_REASON, content: [] }
      },
      async readMessagePage() { return { kind: 'failed', reason: 'media-unavailable' } },
      async readLinkedPage() { return { kind: 'failed', reason: 'media-unavailable' } },
    }
  }

  const attachments = input.attachments
  const limits: ImageAttachmentLimits = attachments.imageLimits
  if (
    !Number.isSafeInteger(limits.maxImageBytes) || limits.maxImageBytes < 1
    || !Number.isSafeInteger(limits.maxMessageImageBytes) || limits.maxMessageImageBytes < 1
  ) {
    return {
      available: false,
      diagnostic: 'attachment-byte-limit-not-representable',
      async admitCurrentImage() { return { kind: 'unavailable', reason: 'media-unavailable', content: [] } },
      async readMessagePage() { return { kind: 'failed', reason: 'media-unavailable' } },
      async readLinkedPage() { return { kind: 'failed', reason: 'media-unavailable' } },
    }
  }
  const runner = input.runner ?? run
  const timeoutMs = input.timeoutMs ?? CALL_TIMEOUT_MS
  const binary = input.download.binary
  const spoolRoot = input.download.spoolRoot
  const video: VideoLimits = { ...LOCUS_VIDEO_LIMITS }
  for (const [name, value] of Object.entries(input.video ?? {})) {
    if (name in video && typeof value === 'number' && Number.isFinite(value) && value > 0) {
      (video as Record<string, number>)[name] = value
    }
  }

  const pageCapacity = input.page?.capacityChars ?? LOCUS_PAGE_CAPACITY_CHARS
  const pageReserve = LOCUS_PAGE_RESERVE_CHARS
  const pageDeadlineMs = input.page?.deadlineMs ?? LOCUS_PAGE_DEADLINE_MS
  if (!Number.isSafeInteger(pageCapacity) || pageCapacity < pageReserve + SEGMENT_BLOCK_MAX_CHARS) {
    throw new Error(`page capacity ${String(pageCapacity)} is below the fixed reserve plus one segment (${String(pageReserve + SEGMENT_BLOCK_MAX_CHARS)})`)
  }
  const cursors = input.cursors ?? createCursorStore()
  const spoolGuard = {
    ...(input.spool?.diskReserveBytes === undefined ? {} : { diskReserveBytes: input.spool.diskReserveBytes }),
    ...(input.spool?.freeBytes === undefined ? {} : { freeBytes: input.spool.freeBytes }),
  }
  /** One platform read through the envelope runner; every failure is a {@link PlanError}. */
  const readEnvelope = async (
    args: readonly string[],
    signal: AbortSignal,
    step?: string,
    onPlatformError?: (code: number | undefined) => PlanError,
  ): Promise<Record<string, unknown>> => {
    const result = await runLarkEnvelope(runner, binary, petCliArgs(args), { signal, timeoutMs })
    if (result.kind === 'ok') return result.envelope
    switch (result.reason) {
      case 'aborted': throw new PlanError('aborted')
      case 'envelope-too-large': throw new PlanError('envelope-too-large', undefined, undefined, result.bytes)
      case 'platform-error':
        throw onPlatformError?.(result.platformCode) ?? new PlanError('platform-read-failed', undefined, result.platformCode)
      case 'envelope-invalid': throw new PlanError('envelope-invalid')
      case 'disk-low': throw new PlanError('disk-low')
      default: throw new PlanError('platform-read-failed', result.reason, undefined, undefined, step)
    }
  }

  /** The read plan of one message or merge-forward root, proven to be in `chatId`. */
  const buildPlan = async (
    messageId: string,
    chatId: string,
    signal: AbortSignal,
    headExtra: Record<string, string | undefined> = {},
  ): Promise<{ readonly units: readonly PlanUnit[]; readonly kind: 'single' | 'merge'; readonly threadId?: string }> => {
    const step = `container@${messageId}`
    const rawEnvelope = await readEnvelope(['api', 'GET', `/open-apis/im/v1/messages/${messageId}`, '--as', 'bot'], signal, step)
    const { root, descendants } = parseRawContainer(rawEnvelope, messageId, chatId)
    const mgetEnvelope = await readEnvelope([
      'im', '+messages-mget', '--as', 'bot', '--message-ids', messageId, '--no-reactions', '--format', 'json',
    ], signal, step)
    let formatted: ReturnType<typeof parseFormattedMessage>
    try {
      formatted = parseFormattedMessage(mgetEnvelope, messageId, chatId)
    } catch (error) {
      throw new PlanError(error instanceof MessageReadError ? error.reason : 'envelope-invalid')
    }
    const units = [
      headUnit(messageId, {
        messageId,
        msgType: root.msgType,
        sender: formatted.senderName,
        time: root.createTime,
        thread: root.threadId ?? formatted.threadId,
        ...headExtra,
      }),
      ...textUnits(messageId, formatted.text),
      // Every download of a container's resources uses the ROOT id (design D5).
      ...resourceUnits(root, messageId),
      ...descendants.flatMap(node => resourceUnits(node, messageId)),
    ]
    return { units, kind: descendants.length > 0 ? 'merge' : 'single', ...(root.threadId === undefined ? {} : { threadId: root.threadId }) }
  }

  /** The topic reader's injected runner: the same envelope runner as every other platform read. */
  const topicRunner = async (args: readonly string[], signal?: AbortSignal): Promise<TopicRunnerResult> => {
    const result = await runLarkEnvelope(runner, binary, petCliArgs(args), {
      signal: signal ?? new AbortController().signal,
      timeoutMs,
    })
    if (result.kind === 'ok') return { ok: true, envelope: result.envelope }
    return { ok: false, ...(result.platformCode === undefined ? {} : { code: String(result.platformCode) }), detail: result.reason }
  }

  /** Units of the messages of one topic page: head (marked when it is the linked one), text, media. */
  const topicUnits = async (messages: readonly TopicMessage[], topic: TopicState, signal: AbortSignal): Promise<PlanUnit[]> => {
    const units: PlanUnit[] = []
    for (const message of messages) {
      const fields = {
        messageId: message.messageId,
        msgType: message.msgType,
        sender: message.senderName,
        time: message.createTime === '' ? undefined : message.createTime,
        position: String(message.position),
        thread: topic.threadId,
        source: topic.sourceName,
        linked: message.linked ? 'true' : undefined,
      }
      if (message.deleted) {
        units.push(headUnit(message.messageId, fields), metadataNote(`${message.messageId}#n0`, 'deleted'))
        continue
      }
      if (message.msgType === 'merge_forward') {
        // A merge-forward item is a root of its own: expanded with its own id.
        try {
          units.push(...(await buildPlan(message.messageId, topic.chatId, signal, fields)).units)
        } catch (error) {
          if (error instanceof PlanError && error.reason === 'aborted') throw error
          units.push(headUnit(message.messageId, fields), {
            kind: 'fail', id: `container@${message.messageId}`, reason: error instanceof PlanError ? error.reason : 'envelope-invalid',
          })
        }
        continue
      }
      units.push(headUnit(message.messageId, fields), ...textUnits(message.messageId, message.content))
      if (message.msgType === 'text') continue
      if (!CONTENT_TYPES_WITH_RESOURCES.has(message.msgType)) {
        units.push(...resourceUnits({ id: message.messageId, msgType: message.msgType, chatId: topic.chatId, deleted: false, content: undefined }, message.messageId))
        continue
      }
      // Media items are read raw on their own, and download with their OWN id.
      try {
        const raw = await readEnvelope(['api', 'GET', `/open-apis/im/v1/messages/${message.messageId}`, '--as', 'bot'], signal)
        units.push(...resourceUnits(parseRawContainer(raw, message.messageId, topic.chatId).root, message.messageId))
      } catch (error) {
        if (error instanceof PlanError && error.reason === 'aborted') throw error
        units.push({ kind: 'fail', id: `container@${message.messageId}`, reason: error instanceof PlanError ? error.reason : 'envelope-invalid' })
      }
    }
    return units
  }

  /** What a download failure means for the advance rule (design D8). */
  const classifyDownload = (error: unknown): { readonly kind: 'final'; readonly reason: string } | { readonly kind: 'transient'; readonly detail: string } => {
    const message = error instanceof Error ? error.message : ''
    if (typeof recordOf(error)?.['platformCode'] === 'number') return { kind: 'final', reason: 'resource-download-failed' }
    if (message === 'disk-low') return { kind: 'final', reason: 'disk-low' }
    if (message === 'image-mime-unsupported' || message === 'attachment-count-mismatch') return { kind: 'final', reason: 'image-admission-failed' }
    if (message === 'download-timeout' || message === 'download-process-failed' || message === 'download-aborted') {
      return { kind: 'transient', detail: message }
    }
    return { kind: 'final', reason: 'resource-download-failed' }
  }

  const failureLine = (failure: LocusPageFailure): string => `- 失败 ${failure.id}: ${failure.reason}`

  interface PageRun {
    readonly units: readonly PlanUnit[]
    readonly position: number
    readonly progress: number
    readonly attempt: number
    readonly kind: CursorKind
    readonly topic?: TopicState
  }
  interface PageOutcome {
    /** The plan after this page: a topic read appends the units of the platform pages it read. */
    readonly units: readonly PlanUnit[]
    readonly kind: CursorKind
    readonly topic?: TopicState
    readonly parts: LocusMessagePart[]
    readonly delivered: number
    readonly failed: LocusPageFailure[]
    /** Where a continuation resumes; equals `units.length` when the plan is exhausted. */
    readonly position: number
    readonly progress: number
    readonly attempt: number
    /** True when the page ended before the plan did. */
    readonly stopped: boolean
    /** Transient-failure note for the ledger text. */
    readonly diagnostic?: string
  }

  /**
   * Deliver units from the run's position until the plan, the page capacity, the
   * image quota or the page deadline ends the page. Units and their failure
   * detail are packed atomically against the FINAL serialized size (design D9).
   */
  const runPage = async (run: PageRun, ctx: {
    readonly wrapper: string
    readonly caller: AbortSignal
    readonly deadline: AbortSignal
    readonly signal: AbortSignal
    readonly canViewImages: () => Promise<boolean> | boolean
  }): Promise<PageOutcome> => {
    let units = run.units
    let topic = run.topic
    let kind = run.kind
    let fetched = 0
    const parts: LocusMessagePart[] = []
    const failed: LocusPageFailure[] = []
    let position = run.position
    let attempt = run.attempt
    let delivered = 0
    let body = 0
    let failLines = 0
    let imagesLeft = limits.maxImagesPerMessage
    let bytesLeft = limits.maxMessageImageBytes
    let skippedImages = 0
    let skippedVideos = 0
    let stopped = false
    let videoProgress = 0
    const pageStart = Date.now()
    let diagnostic: string | undefined
    let viewable: boolean | undefined
    const canView = async (): Promise<boolean> => {
      if (viewable === undefined) {
        try { viewable = await ctx.canViewImages() } catch { viewable = false }
      }
      return viewable
    }
    const fits = (need: number): boolean => body + failLines + need + pageReserve + 0 <= pageCapacity
    const addText = (text: string): void => { parts.push({ type: 'text', text }); body += text.length }
    const addFailure = (failure: LocusPageFailure): void => { failed.push(failure); failLines += failureLine(failure).length + 1 }
    const advance = (): void => { position += 1; attempt = 0; videoProgress = 0 }

    for (;;) {
      if (position >= units.length) {
        if (topic === undefined || topic.done) break
        if (ctx.caller.aborted) throw new PlanError('aborted')
        if (fetched > 0 && ctx.deadline.aborted) { stopped = true; break }
        if (!fits(SEGMENT_BLOCK_MAX_CHARS + FAILURE_LINE_MAX_CHARS)) { stopped = true; break }
        // One platform page per CLI call; the reader state travels in the snapshot (design D6).
        const result = await readTopicPage({
          runner: topicRunner,
          threadId: topic.threadId,
          chatId: topic.chatId,
          linkedMessageId: topic.linkedMessageId,
          state: topic.state,
          signal: ctx.signal,
        })
        if (ctx.caller.aborted) throw new PlanError('aborted')
        fetched += 1
        if (result.kind === 'retry') {
          topic = { ...topic, state: result.state }
          attempt = result.state.attempt
          diagnostic = `[瞬时失败] 话题列表第 ${String(topic.state.pageIndex)} 页 ${result.diagnostic}，尝试 ${String(attempt)}/${String(MAX_ATTEMPTS)}；`
            + '用返回的 cursor 续读将重试同一页，同一位置第 3 次失败会结束话题读取。'
          stopped = true
          break
        }
        if (result.kind === 'fallback') {
          // The topic cannot be listed at all: read the linked message alone.
          addFailure(result.failed)
          units = topic.fallback
          position = 0
          attempt = 0
          videoProgress = 0
          topic = undefined
          kind = 'single'
          continue
        }
        if (result.kind === 'stopped') {
          addFailure(result.failed)
          topic = { ...topic, done: true }
          continue
        }
        const appended = await topicUnits(result.messages, topic, ctx.signal)
        units = [...units, ...appended]
        topic = { ...topic, state: result.state, done: result.done || result.failed !== undefined }
        if (result.failed !== undefined) addFailure(result.failed)
        continue
      }
      if (ctx.caller.aborted) throw new PlanError('aborted')
      const unit = units[position]!
      const progressed = position > run.position
      if (progressed && ctx.deadline.aborted) { stopped = true; break }

      if (unit.kind === 'head' || unit.kind === 'text' || unit.kind === 'note') {
        const text = unit.kind === 'head' ? dataBlock(ctx.wrapper, { unit: unit.id, ...unit.fields })
          : unit.kind === 'text' ? dataBlock(ctx.wrapper, { unit: unit.id, text: unit.text })
            : unit.text
        if (!fits(Math.max(text.length, 0))) { stopped = true; break }
        addText(text)
        delivered += 1
        advance()
        continue
      }
      if (unit.kind === 'fail') {
        if (!fits(FAILURE_LINE_MAX_CHARS)) { stopped = true; break }
        addFailure({ id: unit.id, reason: unit.reason })
        advance()
        continue
      }

      // Resource units from here on.
      if (!await canView()) {
        if (unit.kind === 'video') skippedVideos += 1
        else if (unit.cover !== true) skippedImages += 1
        advance()
        continue
      }
      if (unit.kind === 'image') {
        if (!fits(FAILURE_LINE_MAX_CHARS) || imagesLeft < 1 || bytesLeft < 1) { stopped = true; break }
        try {
          const image = await downloadImageBytes({
            binary, spoolRoot, messageId: unit.downloadId, key: unit.key,
            maxBytes: Math.min(limits.maxImageBytes, bytesLeft), timeoutMs, signal: ctx.signal, limits,
            ...spoolGuard,
          })
          const refs = await attachments.saveImages([image])
          if (refs.length !== 1) throw new Error('attachment-count-mismatch')
          addText(`[图片 ${unit.id}]`)
          parts.push({ type: 'image', attachment: refs[0]! })
          imagesLeft -= 1
          bytesLeft -= image.data.byteLength
          delivered += 1
          advance()
        } catch (error) {
          if (ctx.caller.aborted) throw new PlanError('aborted')
          const outcome = classifyDownload(error)
          if (ctx.deadline.aborted && progressed) { stopped = true; break }
          if (outcome.kind === 'final') {
            addFailure({ id: unit.id, reason: outcome.reason })
            advance()
            continue
          }
          if (attempt + 1 >= MAX_ATTEMPTS) {
            addFailure({ id: unit.id, reason: `transient(${ctx.deadline.aborted ? 'page-deadline' : outcome.detail})` })
            advance()
            continue
          }
          attempt += 1
          diagnostic = `[瞬时失败] ${unit.id} 第 ${String(attempt)} 次失败（${ctx.deadline.aborted ? 'page-deadline' : outcome.detail}），尝试 ${String(attempt)}/${String(MAX_ATTEMPTS)}；`
            + '用返回的 cursor 续读将重试同一位置，同一位置第 3 次失败会跳过该单元。'
          stopped = true
          break
        }
        continue
      }
      // ---- video unit: one decode window per page, resumed from the whole second `k` ----
      const tools = input.frameTools
      if (tools === undefined) {
        addText(skipNote('frame-tools-unavailable'))
        delivered += 1
        advance()
        continue
      }
      const startSecond = position === run.position ? run.progress : 0
      const frameQuota = Math.min(video.maxFrames, imagesLeft)
      if (frameQuota < 1 || bytesLeft < 1 || !fits(VIDEO_UNIT_BASE_CHARS + frameQuota * FRAME_LINE_CHARS)) { stopped = true; break }
      let extraction: SecondFrameExtraction
      try {
        // The download may use whatever is left of THIS page's time; there is no separate CLI timeout.
        extraction = await withSpoolDownload({
          binary,
          spoolRoot,
          args: petCliArgs([
            'im', '+messages-resources-download', '--as', 'bot', '--message-id', unit.downloadId,
            '--file-key', unit.fileKey, '--type', 'file', '--format', 'json',
          ]),
          maxBytes: Number.MAX_SAFE_INTEGER,
          timeoutMs: Math.max(1, pageDeadlineMs - (Date.now() - pageStart)),
          signal: ctx.signal,
          ...spoolGuard,
        }, (file, phaseSignal) => extractSecondFrames({
          tools,
          dir: file.dir,
          fileName: file.name,
          fromSecond: startSecond,
          maxFrames: frameQuota,
          maxFrameBytes: Math.min(limits.maxImageBytes, bytesLeft),
          signal: phaseSignal,
          limits: video,
        }))
      } catch (error) {
        if (ctx.caller.aborted) throw new PlanError('aborted')
        const message = error instanceof Error ? error.message : ''
        const timedOut = ctx.deadline.aborted || message === 'download-timeout'
        if (timedOut) {
          // Earlier deliveries on this page: the video waits for the next page. Otherwise no
          // page can ever fit it — a terminal skip, so the cursor always moves forward.
          if (delivered > 0) { stopped = true; break }
          addFailure({ id: unit.id, reason: 'video-download-exceeds-window' })
          advance()
          continue
        }
        const outcome = classifyDownload(error)
        if (outcome.kind === 'final') {
          addFailure({ id: unit.id, reason: outcome.reason === 'resource-download-failed' ? 'video-download-failed' : outcome.reason })
          advance()
          continue
        }
        if (attempt + 1 >= MAX_ATTEMPTS) {
          addFailure({ id: unit.id, reason: `transient(${outcome.detail})` })
          advance()
          continue
        }
        attempt += 1
        diagnostic = `[瞬时失败] ${unit.id} 第 ${String(attempt)} 次失败（${outcome.detail}），尝试 ${String(attempt)}/${String(MAX_ATTEMPTS)}；`
          + '用返回的 cursor 续读将重试同一位置，同一位置第 3 次失败会跳过该单元。'
        stopped = true
        break
      }
      if (extraction.kind === 'skipped') {
        if (extraction.reason === 'aborted') {
          if (ctx.caller.aborted) throw new PlanError('aborted')
          if (delivered > 0) { stopped = true; break }
          addFailure({ id: unit.id, reason: 'video-download-exceeds-window' })
        } else {
          addFailure({ id: unit.id, reason: extraction.reason })
        }
        advance()
        continue
      }
      if (extraction.frames.length === 0) {
        if (!extraction.complete) addFailure({ id: unit.id, reason: 'frame-extraction-failed' })
        advance()
        continue
      }
      addText(secondFramesNote(extraction.durationSeconds, startSecond, extraction.nextK))
      for (const frame of extraction.frames) {
        if ('failed' in frame) { addFailure({ id: `${unit.id}@${String(frame.k)}`, reason: frame.failed }); continue }
        const mediaType = detectImageMediaType(frame.data)
        if (mediaType === undefined || !limits.mediaTypes.includes(mediaType) || frame.data.byteLength > bytesLeft) {
          addFailure({ id: `${unit.id}@${String(frame.k)}`, reason: 'frame-admission-failed' })
          continue
        }
        try {
          const refs = await attachments.saveImages([{ data: frame.data, mediaType }])
          if (refs.length !== 1) throw new Error('attachment-count-mismatch')
          addText(`[t=${formatTime(frame.timeSeconds)}]`)
          parts.push({ type: 'image', attachment: refs[0]! })
          imagesLeft -= 1
          bytesLeft -= frame.data.byteLength
        } catch {
          addFailure({ id: `${unit.id}@${String(frame.k)}`, reason: 'frame-admission-failed' })
        }
      }
      delivered += 1
      if (extraction.complete) {
        advance()
      } else {
        // The window ended before the video did: resume at the next whole second.
        videoProgress = extraction.nextK
        attempt = 0
        stopped = true
        break
      }
    }
    if (skippedImages + skippedVideos > 0) addText(describeSkippedMedia(skippedImages, skippedVideos))
    return { units, kind, ...(topic === undefined ? {} : { topic }), parts, delivered, failed, position, progress: videoProgress, attempt, stopped, ...(diagnostic === undefined ? {} : { diagnostic }) }
  }

  /** The ledger text of one page; its size is covered by the fixed reserve. */
  const ledgerText = (outcome: PageOutcome, cumulativeFailed: number, cursor: string | undefined): string => {
    const complete = cursor === undefined && cumulativeFailed === 0
    return [
      `[读取账本] 本页交付 ${String(outcome.delivered)} 个单元；本页新记失败 ${String(outcome.failed.length)} 项；累计失败 ${String(cumulativeFailed)} 项。`,
      ...outcome.failed.map(failureLine),
      ...(outcome.diagnostic === undefined ? [] : [outcome.diagnostic]),
      cursor !== undefined
        ? `[续读] 后面还有内容：用同一工具传入 cursor=${cursor} 继续读完；读完之前不得声称已读完。`
        : complete
          ? '[读完] 全部单元已交付，无失败项。'
          : '[读取已结束] 没有后续内容，但存在失败项（见上）；如实说明未读到的部分，不得声称已读完全部内容。',
    ].join('\n')
  }

  /** Map a read failure to the port vocabulary; anything unknown is rethrown. */
  const failedPage = (error: unknown): LocusPageResult => {
    if (error instanceof PlanError) {
      return {
        kind: 'failed',
        reason: error.reason,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
        ...(error.platformCode === undefined ? {} : { platformCode: error.platformCode }),
        ...(error.bytes === undefined ? {} : { bytes: error.bytes }),
      }
    }
    throw error
  }

  /**
   * A failure BEFORE a plan exists. A transient platform error (timeout, crashed
   * CLI, page deadline) is a ledger result — no cursor, the call can be repeated
   * as is; every other failure is a deterministic refusal.
   */
  const planFailure = (error: unknown, messageId: string, caller: AbortSignal): LocusPageResult => {
    if (error instanceof PlanError && !caller.aborted) {
      const transient = (error.reason === 'platform-read-failed' && error.platformCode === undefined) || error.reason === 'aborted'
      if (transient) {
        const detail = error.reason === 'aborted' ? 'page-deadline' : (error.detail ?? 'platform-read-failed')
        const failure: LocusPageFailure = { id: error.step ?? `container@${messageId}`, reason: `transient(${detail})` }
        return {
          kind: 'ok',
          complete: false,
          delivered: 0,
          failed: [failure],
          parts: [{
            type: 'text',
            text: `[读取未建立] ${failure.id} 瞬时失败（${detail}），未读到任何内容、没有 cursor；可原样重发同一调用。\n${failureLine(failure)}`,
          }],
        }
      }
    }
    return failedPage(error)
  }


  /** Facts a link read carries from its first call into every continuation. */
  interface LinkMeta { readonly linkIndex: number; readonly linkCount: number; readonly source: { readonly chatId: string; readonly name?: string } }

  /** The links of the carrier message, proven to be in the entrance chat. */
  const readCarrierLinks = async (messageId: string, chatId: string, signal: AbortSignal): Promise<readonly string[]> => {
    const envelope = await readEnvelope(['api', 'GET', `/open-apis/im/v1/messages/${messageId}`, '--as', 'bot'], signal, `container@${messageId}`)
    const items = recordOf(envelope['data'])?.['items']
    if (!Array.isArray(items) || items.length === 0) throw new PlanError('envelope-invalid')
    const carrier = treeNode(items[0])
    if (carrier.id !== messageId) throw new PlanError('message-mismatch')
    if (carrier.chatId !== chatId) throw new PlanError('chat-mismatch')
    if (carrier.deleted) throw new PlanError('message-deleted')
    return extractMessageLinksFromRaw(carrier.msgType, typeof carrier.content === 'string' ? carrier.content : '')
  }

  /** `message_links/query`: authorization, the root id and the chat facts; never the content. */
  const resolveLinkRoot = async (url: string, messageId: string, signal: AbortSignal): Promise<{
    readonly rootId: string
    readonly chatId: string
    readonly name?: string
  }> => {
    const envelope = await readEnvelope([
      'api', 'POST', '/open-apis/im/v1/message_links/query', '--as', 'bot', '--data', JSON.stringify({ message_link_url: url }),
    ], signal, `link-query@${messageId}`, code => (code === 99991672
      ? new PlanError('link-scope-missing', undefined, code)
      : new PlanError('link-unresolved', undefined, code)))
    const data = recordOf(envelope['data'])
    const chatInfo = recordOf(data?.['chat_info'])
    if (chatInfo?.['is_authorized'] !== true) throw new PlanError('link-unauthorized')
    const chatId = chatInfo['chat_id']
    const messages = data?.['messages']
    const rootId = Array.isArray(messages) ? recordOf(recordOf(messages[0])?.['message'])?.['message_id'] : undefined
    if (typeof chatId !== 'string' || !/^oc_[A-Za-z0-9_-]{1,128}$/.test(chatId)) throw new PlanError('link-unresolved')
    if (typeof rootId !== 'string' || !MESSAGE_ID_PATTERN.test(rootId)) throw new PlanError('link-unresolved')
    const name = typeof chatInfo['name'] === 'string' ? labelOf(chatInfo['name'], LINK_SOURCE_NAME_CHARS) : undefined
    return { rootId, chatId, ...(name === undefined || name === '' ? {} : { name }) }
  }

  /** One page of a plain or linked read; a `cursor` continues from its snapshot only. */
  const readPaged = async (request: LocusLinkedPageInput, linked: boolean): Promise<LocusPageResult> => {
    if (!MESSAGE_ID_PATTERN.test(request.messageId) || request.chatId.trim() === '') {
      return { kind: 'failed', reason: 'invalid-message-id' }
    }
    if (request.linkIndex !== undefined && (!Number.isSafeInteger(request.linkIndex) || request.linkIndex < 1)) {
      return { kind: 'failed', reason: 'invalid-message-id' }
    }
    if (request.signal.aborted) return { kind: 'failed', reason: 'aborted' }
    const deadline = AbortSignal.timeout(pageDeadlineMs)
    const signal = AbortSignal.any([request.signal, deadline])
    let run: PageRun
    let failedBefore = 0
    let link: LinkMeta | undefined
    if (request.cursor !== undefined) {
      const resolved = cursors.resolve(request.cursor, {
        caller: request.caller,
        messageId: request.messageId,
        ...(linked && request.linkIndex !== undefined ? { linkIndex: request.linkIndex } : {}),
      })
      if (resolved.kind === 'failed') return { kind: 'failed', reason: resolved.reason }
      const snapshot = resolved.snapshot
      // A cursor belongs to the tool that issued it.
      if ((snapshot.link !== undefined) !== linked) return { kind: 'failed', reason: 'cursor-mismatch' }
      run = {
        units: snapshot.units as readonly PlanUnit[],
        position: snapshot.position,
        progress: snapshot.progress ?? 0,
        attempt: snapshot.attempt,
        kind: snapshot.kind,
        ...(snapshot.topic === undefined ? {} : { topic: snapshot.topic as TopicState }),
      }
      failedBefore = snapshot.failedCount
      if (snapshot.link !== undefined && snapshot.linkIndex !== undefined) link = { linkIndex: snapshot.linkIndex, ...snapshot.link }
    } else {
      try {
        if (linked) {
          const index = request.linkIndex ?? 1
          const links = await readCarrierLinks(request.messageId, request.chatId, signal)
          const url = links[index - 1]
          if (url === undefined) throw new PlanError('link-not-found')
          const root = await resolveLinkRoot(url, request.messageId, signal)
          let plan: Awaited<ReturnType<typeof buildPlan>>
          try {
            plan = await buildPlan(root.rootId, root.chatId, signal, { source: root.name })
          } catch (error) {
            throw error instanceof PlanError && error.reason === 'chat-mismatch' ? new PlanError('link-mismatch') : error
          }
          run = plan.threadId === undefined
            ? { units: plan.units, position: 0, progress: 0, attempt: 0, kind: plan.kind }
            : {
              // A link into a topic reads the whole topic; the root plan is its fallback.
              units: [],
              position: 0,
              progress: 0,
              attempt: 0,
              kind: 'topic',
              topic: {
                state: initialTopicState,
                threadId: plan.threadId,
                chatId: root.chatId,
                linkedMessageId: root.rootId,
                ...(root.name === undefined ? {} : { sourceName: root.name }),
                fallback: plan.units,
                done: false,
              },
            }
          link = { linkIndex: index, linkCount: links.length, source: { chatId: root.chatId, ...(root.name === undefined ? {} : { name: root.name }) } }
        } else {
          const plan = await buildPlan(request.messageId, request.chatId, signal)
          run = { units: plan.units, position: 0, progress: 0, attempt: 0, kind: plan.kind }
        }
      } catch (error) {
        return planFailure(error, request.messageId, request.signal)
      }
    }
    let outcome: PageOutcome
    try {
      outcome = await runPage(run, {
        wrapper: linked ? 'linked-message' : 'message-body',
        caller: request.signal,
        deadline,
        signal,
        canViewImages: request.canViewImages,
      })
    } catch (error) {
      return failedPage(error)
    }
    if (request.isCurrent !== undefined && !request.isCurrent()) return { kind: 'failed', reason: 'caller-changed' }
    const failedCount = failedBefore + outcome.failed.length
    const cursor = outcome.stopped
      ? cursors.issue({
        caller: request.caller,
        containerId: request.messageId,
        ...(link === undefined ? {} : { linkIndex: link.linkIndex, link: { linkCount: link.linkCount, source: link.source } }),
        kind: outcome.kind,
        ...(outcome.topic === undefined ? {} : { topic: outcome.topic }),
        units: outcome.units,
        position: outcome.position,
        progress: outcome.progress,
        attempt: outcome.attempt,
        failedCount,
      })
      : undefined
    return {
      kind: 'ok',
      complete: cursor === undefined && failedCount === 0,
      delivered: outcome.delivered,
      failed: outcome.failed,
      ...(cursor === undefined ? {} : { cursor }),
      parts: [...outcome.parts, { type: 'text', text: ledgerText(outcome, failedCount, cursor) }],
      ...(link === undefined ? {} : { source: link.source, linkIndex: link.linkIndex, linkCount: link.linkCount }),
    }
  }

  return {
    available: true,
    readMessagePage: request => readPaged(request, false),
    readLinkedPage: request => readPaged(request, true),
    async admitCurrentImage(request) {
      if (request.signal.aborted) return { kind: 'unavailable', reason: 'aborted', content: [] }
      let parsed: ParsedMessageResources
      try {
        const result = await runner(binary, petCliArgs([
          'im', '+messages-mget', '--as', 'bot', '--message-ids', request.messageId,
          '--no-reactions', '--format', 'json',
        ]), { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 })
        parsed = parseSingleMessageResources(parseJsonSuffix(result.stdout), request.messageId)
      } catch {
        return { kind: 'unavailable', reason: 'platform-read-failed', content: [] }
      }
      const metadata = unsupportedContent(parsed.unsupported, request.messageId)
      if (parsed.imageKeys.length === 0) return { kind: 'none', content: metadata }
      if (parsed.imageKeys.length > limits.maxImagesPerMessage) {
        return { kind: 'unavailable', reason: 'image-count-exceeded', content: metadata }
      }

      const saveInputs: SaveImageAttachment[] = []
      let totalBytes = 0
      try {
        for (const imageKey of parsed.imageKeys) {
          if (request.signal.aborted) return { kind: 'unavailable', reason: 'aborted', content: metadata }
          const remaining = limits.maxMessageImageBytes - totalBytes
          if (remaining < 1) throw new Error('message-images-too-large')
          const maxBytes = Math.min(limits.maxImageBytes, remaining)
          const image = await downloadImageBytes({
            binary,
            spoolRoot,
            messageId: request.messageId,
            key: imageKey,
            maxBytes,
            timeoutMs,
            signal: request.signal,
            limits,
          })
          totalBytes += image.data.byteLength
          if (totalBytes > limits.maxMessageImageBytes) throw new Error('message-images-too-large')
          saveInputs.push(image)
        }
        if (!await request.fenceBeforeSave()) {
          return { kind: 'unavailable', reason: 'stale-delivery', content: metadata }
        }
        const refs = await attachments.saveImages(saveInputs)
        if (refs.length !== saveInputs.length) throw new Error('attachment-count-mismatch')
        return {
          kind: 'ready',
          content: [...metadata, ...refs.map(attachment => ({ type: 'image' as const, attachment }))],
        }
      } catch (error) {
        return {
          kind: 'unavailable',
          reason: request.signal.aborted ? 'aborted' : error instanceof Error && error.message === 'download-timeout'
            ? 'timeout' : 'image-download-or-admission-failed',
          content: metadata,
        }
      }
    },
  }
}
