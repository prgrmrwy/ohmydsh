/** Host-owned, caller-bound Lark image admission for one durable Delivery. */

import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
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
  extractKeyframes,
  LOCUS_VIDEO_LIMITS,
  type FrameExtraction,
  type FrameTools,
  type VideoLimits,
  type VideoSkipReason,
} from './media-video.js'
import { meetsPetLarkCliFloor } from './lark-cli-compat.js'
import { extractMessageLinksFromRaw } from '../locus/message-link.js'
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
/** Random token length of one spool entry, in bytes (32 hex characters). */
const SPOOL_TOKEN_BYTES = 16
/** Bound on the platform-formatted body the single-message read returns. */
export const LOCUS_MESSAGE_MAX_BODY_CHARS = 4_000

/** Limits of ONE single-message or linked-message read, as a whole. */
export interface LocusCallBudgetLimits {
  /** Resource download attempts; failures and timeouts count too. */
  readonly maxAttempts: number
  /** Wall-clock bound of the whole call, platform reads included. */
  readonly deadlineMs: number
  /** Serialized body plus every note the call returns. */
  readonly maxChars: number
}

/** Owner-approved defaults (change `locus-read-referenced-chats`, 2026-11-12). */
export const LOCUS_CALL_BUDGET: LocusCallBudgetLimits = Object.freeze({ maxAttempts: 12, deadlineMs: 90_000, maxChars: 16_000 })

/** At most this many merge-forward children are shown and searched for media. */
export const LOCUS_MERGE_MAX_CHILDREN = 30

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

/** One message the caller-bound `pet_locus_message` tool is allowed to show. */
export interface LocusReadMessage {
  readonly messageId: string
  readonly chatId: string
  readonly msgType: string
  /** ISO 8601 with the host offset, when the platform reported a usable time. */
  readonly createTime?: string
  readonly senderName?: string
  readonly threadId?: string
  /** Platform-formatted body, bounded by {@link LOCUS_MESSAGE_MAX_BODY_CHARS}. */
  readonly text: string
  readonly textTruncated: boolean
}

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

export type LocusMessageReadResult =
  | { readonly kind: 'ok'; readonly message: LocusReadMessage; readonly media: readonly LocusMessagePart[] }
  | { readonly kind: 'failed'; readonly reason: LocusMessageReadFailure }

export interface LocusMessageReadInput {
  readonly messageId: string
  /** The caller's entrance chat id; a topic entrance passes its GROUP chat id. */
  readonly chatId: string
  readonly signal: AbortSignal
  /**
   * Whether the calling model route accepts image input. Consulted after the
   * platform read and chat check but BEFORE any media byte is downloaded.
   */
  readonly canViewImages: () => Promise<boolean> | boolean
}

/** Why a linked-message read produced nothing, beyond the single-message vocabulary. */
export type LocusLinkedReadFailure =
  | LocusMessageReadFailure
  | 'link-not-found'
  | 'link-unauthorized'
  | 'link-unresolved'
  | 'link-scope-missing'
  | 'link-mismatch'

export type LocusLinkedReadResult =
  | {
    readonly kind: 'ok'
    readonly message: LocusReadMessage
    readonly media: readonly LocusMessagePart[]
    /** Platform facts about the source chat; `name` is unsanitized platform text. */
    readonly source: { readonly chatId: string; readonly name?: string }
    readonly linkIndex: number
    readonly linkCount: number
  }
  | { readonly kind: 'failed'; readonly reason: LocusLinkedReadFailure }

export interface LocusLinkedReadInput {
  /** A message of the caller's entrance that carries the link. */
  readonly messageId: string
  /** 1-based index among the message's extractable links. */
  readonly linkIndex: number
  /** The caller's entrance chat id; a topic entrance passes its GROUP chat id. */
  readonly chatId: string
  readonly signal: AbortSignal
  readonly canViewImages: () => Promise<boolean> | boolean
}

export interface LocusMediaPort {
  readonly available: boolean
  readonly diagnostic?: string
  admitCurrentImage(input: {
    readonly messageId: string
    readonly signal: AbortSignal
    /** Exact durable current fence, invoked immediately before persistence. */
    readonly fenceBeforeSave: () => Promise<boolean>
  }): Promise<LocusMediaAdmission>
  /** Read ONE message of the caller's chat; fails closed on any doubt. */
  readMessage(input: LocusMessageReadInput): Promise<LocusMessageReadResult>
  /**
   * Read the message a Feishu message link in one entrance message points at.
   * The link comes from that message's raw body; the platform's `is_authorized`
   * and a raw read of the target gate everything after resolution.
   */
  readLinkedMessage(input: LocusLinkedReadInput): Promise<LocusLinkedReadResult>
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
async function withSpoolDownload<T>(input: {
  readonly binary: string
  readonly spoolRoot: string
  readonly args: readonly string[]
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly signal: AbortSignal
}, use: (file: SpoolFile) => Promise<T>): Promise<T> {
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
  let stderrBytes = 0
  let failure: Error | undefined
  let exited = false
  const fail = (error: Error): void => {
    if (failure !== undefined) return
    failure = error
    killProcessTree(child)
  }
  const onAbort = () => fail(new Error('download-aborted'))
  input.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => fail(new Error('download-timeout')), input.timeoutMs)
  timer.unref?.()
  const poll = setInterval(() => {
    if (largestSpoolEntry(dir) > input.maxBytes) {
      fail(new Error('download-byte-limit-exceeded'))
    }
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
    stderrBytes += Buffer.byteLength(chunk)
    if (stderrBytes > MAX_STDERR_BYTES) child.stderr?.destroy()
  })
  child.on('error', error => fail(error))

  try {
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null]
    exited = true
    clearTimeout(timer)
    clearInterval(poll)
    input.signal.removeEventListener('abort', onAbort)
    if (failure !== undefined) throw failure
    if (code !== 0 || signal !== null) throw new Error('download-process-failed')

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
    return await use({ dir, name: targetName, path: target, size })
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    input.signal.removeEventListener('abort', onAbort)
    if (!exited) killProcessTree(child)
    removeSpoolDir(dir)
  }
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
const TRUNCATION_MARK = '…（已截断）'
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

export function parseRawMessage(value: unknown, expectedId: string, expectedChat: string): RawMessageFacts {
  const { item, children } = rawItems(value, expectedId, expectedChat)
  if (item['deleted'] === true) throw new MessageReadError('message-deleted')
  const msgType = bounded(item['msg_type'])
  if (msgType === undefined) throw new MessageReadError('envelope-invalid')
  const threadId = bounded(item['thread_id'])
  const createTime = formatEpochMs(item['create_time'])
  const rawBody = recordOf(item['body'])?.['content']
  const links = typeof rawBody === 'string' ? extractMessageLinksFromRaw(msgType, rawBody) : []
  const base = {
    msgType,
    links,
    ...(createTime === undefined ? {} : { createTime }),
    ...(threadId === undefined ? {} : { threadId }),
  }
  if (msgType === 'merge_forward') {
    // A child's media downloads through the OUTER id; the child's own id is refused (234003).
    const resources: RawMessageResource[] = []
    for (const child of children.slice(0, LOCUS_MERGE_MAX_CHILDREN)) {
      if (child['deleted'] === true) continue
      const childType = bounded(child['msg_type'])
      if (childType === undefined) continue
      if (childType === 'merge_forward') { resources.push({ kind: 'nested' }); continue }
      try {
        resources.push(...resourcesOf(childType, recordOf(child['body'])?.['content']))
      } catch {
        // One unreadable child body costs that child's media, not the whole read.
      }
    }
    return { ...base, resources }
  }
  return { ...base, resources: resourcesOf(msgType, recordOf(item['body'])?.['content']) }
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

function boundBody(text: string): { readonly text: string; readonly truncated: boolean } {
  const clean = text.replace(/\0/g, '')
  return clean.length <= LOCUS_MESSAGE_MAX_BODY_CHARS
    ? { text: clean, truncated: false }
    : { text: `${clean.slice(0, LOCUS_MESSAGE_MAX_BODY_CHARS)}${TRUNCATION_MARK}`, truncated: true }
}

/** Metadata-only description of resources that are not (or cannot be) shown. */
function describeResources(resources: readonly RawMessageResource[]): string {
  const count = (kind: RawMessageResource['kind']): number => resources.filter(item => item.kind === kind).length
  const parts = [
    ['图片', count('image')], ['视频', count('video')], ['文件', count('file')], ['音频', count('audio')], ['嵌套合并转发', count('nested')],
  ].filter(([, n]) => (n as number) > 0).map(([name, n]) => `${String(n)} 个${String(name)}`)
  return parts.join('、')
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
  })
  const mediaType = detectImageMediaType(data)
  if (mediaType === undefined || !input.limits.mediaTypes.includes(mediaType)) {
    throw new Error('image-mime-unsupported')
  }
  return { data, mediaType }
}


/**
 * One call's shared budget. `signal` aborts on the caller's abort OR the
 * whole-call deadline; `caller` alone tells the two apart, because a
 * deadline returns what was already obtained while a caller abort returns nothing.
 */
interface CallBudget {
  readonly signal: AbortSignal
  readonly caller: AbortSignal
  readonly limits: LocusCallBudgetLimits
  attemptsLeft: number
  timedOut(): boolean
}

function createCallBudget(caller: AbortSignal, limits: LocusCallBudgetLimits): CallBudget {
  const deadline = AbortSignal.timeout(limits.deadlineMs)
  return {
    signal: AbortSignal.any([caller, deadline]),
    caller,
    limits,
    attemptsLeft: limits.maxAttempts,
    timedOut: () => deadline.aborted && !caller.aborted,
  }
}

const MERGE_ENTRY_HEADER = /^\[[^\]\n]{1,64}\] [^\n]*:$/
const MERGE_CLOSE = '</forwarded_messages>'

/**
 * Bound mget's `<forwarded_messages>` block by WHOLE child entries: at most
 * `maxEntries` children and `maxChars` characters, with the omitted count stated.
 * A block without recognizable entries falls back to a plain character bound.
 */
function boundMergeText(text: string, maxEntries: number, maxChars: number): { readonly text: string; readonly truncated: boolean } {
  const lines = text.replace(/\0/g, '').split('\n')
  const starts = lines.flatMap((line, index) => MERGE_ENTRY_HEADER.test(line) ? [index] : [])
  if (starts.length === 0) {
    return text.length <= maxChars ? { text, truncated: false } : { text: `${text.slice(0, maxChars)}${TRUNCATION_MARK}`, truncated: true }
  }
  const closed = lines[lines.length - 1] === MERGE_CLOSE
  const end = closed ? lines.length - 1 : lines.length
  const open = lines.slice(0, starts[0]).join('\n')
  const entries = starts.map((start, k) => lines.slice(start, k + 1 < starts.length ? starts[k + 1] : end).join('\n'))
  const kept: string[] = []
  // Reserve room for the omission note and the closing tag.
  let used = open.length + MERGE_CLOSE.length + 64
  for (const entry of entries) {
    if (kept.length >= maxEntries) break
    if (used + entry.length + 1 > maxChars) {
      if (kept.length === 0) kept.push(`${entry.slice(0, Math.max(0, maxChars - used - TRUNCATION_MARK.length))}${TRUNCATION_MARK}`)
      break
    }
    kept.push(entry)
    used += entry.length + 1
  }
  const omitted = entries.length - kept.length
  return {
    text: [open, ...kept, ...(omitted > 0 ? [`[另有 ${String(omitted)} 条子消息未显示：超出条数或字符上限。]`] : []), MERGE_CLOSE].join('\n'),
    truncated: omitted > 0,
  }
}

/** Everything {@link readMessageMedia} needs from the port that owns it. */
interface MessageMediaInput {
  readonly binary: string
  readonly spoolRoot: string
  readonly timeoutMs: number
  readonly limits: ImageAttachmentLimits
  readonly attachments: AttachmentStore
  readonly messageId: string
  readonly resources: readonly RawMessageResource[]
  /** The whole call's budget; its signal is what every download and extraction runs under. */
  readonly budget: CallBudget
  /** Fixed at Host start; absent means every video stays cover-only. */
  readonly frameTools: FrameTools | undefined
  readonly video: VideoLimits
}

/** One extracted frame that already passed every Pet-side check; the store has not seen it yet. */
interface PendingFrame {
  readonly image: SaveImageAttachment
  readonly timeSeconds: number
}

/** One slot of the output, in message order. */
type MediaSlot =
  | { readonly kind: 'image'; readonly image: SaveImageAttachment }
  | { readonly kind: 'note'; readonly text: string }
  /** Keyframes are committed as their OWN attachment batch, after the other images. */
  | { readonly kind: 'frames'; readonly durationSeconds: number; readonly frames: readonly PendingFrame[] }

function skipNote(reason: VideoSkipReason): string {
  return `[视频未抽帧：${reason}。仅提供封面与元数据。]`
}

function formatTime(seconds: number): string {
  return `${String(Number(seconds.toFixed(2)))}s`
}

function framesNote(durationSeconds: number, count: number): string {
  return `[视频关键帧：以下 ${String(count)} 帧是按场景变化抽样的结果，不是完整视频，不得声称已看过完整视频；`
    + `时长 ${durationSeconds.toFixed(1)}s，共 ${String(count)} 帧。${count < 2 ? '画面基本静止，只抽到 1 帧，未补帧。' : ''}]`
}

/**
 * Turn a message's resources into model-facing parts, in message order.
 *
 * Images are downloaded sequentially into the spool under the deployment's
 * count and byte limits and committed as ONE attachment batch. A video adds its
 * cover to that batch and, when frame tools exist, its keyframes as a batch of
 * their own: a frame failure then drops the frames and nothing else, and never
 * leaves a partial set of frame refs. A resource that cannot be shown becomes an
 * explicit note, never a silent omission.
 * @returns the parts, or `undefined` when the call was aborted.
 */
async function readMessageMedia(input: MessageMediaInput): Promise<readonly LocusMessagePart[] | undefined> {
  const { limits } = input
  const slots: MediaSlot[] = []
  let images = 0
  let bytes = 0
  let omitted = 0
  const quotaLeft = (): boolean => images < limits.maxImagesPerMessage && limits.maxMessageImageBytes - bytes >= 1
  const { budget } = input
  const signal = budget.signal
  let stop: 'attempts' | 'deadline' | undefined
  let notTried = 0
  /** Spend one download attempt; false (and counted as not tried) once the call's budget is gone. */
  const attempt = (): boolean => {
    if (stop === undefined && budget.timedOut()) stop = 'deadline'
    if (stop === undefined && budget.attemptsLeft <= 0) stop = 'attempts'
    if (stop !== undefined) { notTried += 1; return false }
    budget.attemptsLeft -= 1
    return true
  }
  /** After a failed step: false = caller abort (give up), true = carry on (deadline recorded). */
  const survive = (): boolean => {
    if (budget.caller.aborted) return false
    if (budget.timedOut()) stop = 'deadline'
    return true
  }

  /** Download one image resource into `slots`; false when the call was aborted. */
  const takeImage = async (key: string): Promise<boolean> => {
    if (!quotaLeft()) { omitted += 1; return true }
    if (!attempt()) return true
    try {
      const image = await downloadImageBytes({
        binary: input.binary,
        spoolRoot: input.spoolRoot,
        messageId: input.messageId,
        key,
        maxBytes: Math.min(limits.maxImageBytes, limits.maxMessageImageBytes - bytes),
        timeoutMs: input.timeoutMs,
        signal,
        limits,
      })
      images += 1
      bytes += image.data.byteLength
      slots.push({ kind: 'image', image })
    } catch (error) {
      if (!survive()) return false
      if (stop === 'deadline') return true
      slots.push({
        kind: 'note',
        text: `[图片未能读取：${error instanceof Error && error.message === 'download-timeout' ? 'timeout' : 'image-download-or-admission-failed'}。]`,
      })
    }
    return true
  }

  /** Download and frame one video in place; false when the call was aborted. */
  const takeFrames = async (fileKey: string): Promise<boolean> => {
    if (input.frameTools === undefined) { slots.push({ kind: 'note', text: skipNote('frame-tools-unavailable') }); return true }
    const maxFrames = Math.min(input.video.maxFrames, limits.maxImagesPerMessage - images)
    const bytesLeft = limits.maxMessageImageBytes - bytes
    if (maxFrames < 1 || bytesLeft < 1) { slots.push({ kind: 'note', text: skipNote('image-quota-exhausted') }); return true }
    if (!attempt()) return true
    const tools = input.frameTools
    let extraction: FrameExtraction
    try {
      extraction = await withSpoolDownload({
        binary: input.binary,
        spoolRoot: input.spoolRoot,
        args: petCliArgs([
          'im', '+messages-resources-download', '--as', 'bot',
          '--message-id', input.messageId,
          '--file-key', fileKey, '--type', 'file', '--format', 'json',
        ]),
        maxBytes: input.video.maxBytes,
        timeoutMs: input.timeoutMs,
        signal,
      }, file => extractKeyframes({
        tools,
        dir: file.dir,
        fileName: file.name,
        limits: input.video,
        maxFrames,
        maxFrameBytes: Math.min(limits.maxImageBytes, bytesLeft),
        signal,
      }))
    } catch (error) {
      if (!survive()) return false
      if (stop === 'deadline') return true
      const message = error instanceof Error ? error.message : ''
      slots.push({
        kind: 'note',
        text: skipNote(message === 'download-byte-limit-exceeded' ? 'video-too-large'
          : message === 'download-timeout' ? 'video-download-timeout' : 'video-download-failed'),
      })
      return true
    }
    if (extraction.kind === 'skipped') {
      if (extraction.reason === 'aborted' || signal.aborted) return survive()
      slots.push({ kind: 'note', text: skipNote(extraction.reason) })
      return true
    }
    // Pet-side admission of the whole batch before the store sees any of it.
    const pending: PendingFrame[] = []
    let frameBytes = 0
    for (const frame of extraction.frames) {
      const mediaType = detectImageMediaType(frame.data)
      frameBytes += frame.data.byteLength
      if (mediaType === undefined || !limits.mediaTypes.includes(mediaType) || frameBytes > bytesLeft) {
        slots.push({ kind: 'note', text: skipNote('frame-admission-failed') })
        return true
      }
      pending.push({ image: { data: frame.data, mediaType }, timeSeconds: frame.timeSeconds })
    }
    images += pending.length
    bytes += frameBytes
    slots.push({ kind: 'frames', durationSeconds: extraction.durationSeconds, frames: pending })
    return true
  }

  for (const resource of input.resources) {
    if (budget.caller.aborted) return undefined
    if (stop !== undefined && (resource.kind === 'image' || resource.kind === 'video')) {
      notTried += resource.kind === 'image' ? 1 : (resource.coverKey === undefined ? 0 : 1) + (input.frameTools === undefined ? 0 : 1)
      continue
    }
    if (resource.kind === 'nested') {
      slots.push({ kind: 'note', text: '[嵌套合并转发：仅元数据，未展开其内容。]' })
    } else if (resource.kind === 'file') {
      slots.push({ kind: 'note', text: `[文件${resource.name === undefined ? '' : ` ${resource.name}`}：仅元数据，未下载、解析或执行。]` })
    } else if (resource.kind === 'audio') {
      slots.push({ kind: 'note', text: '[音频：仅元数据，未下载或转写。]' })
    } else if (resource.kind === 'video') {
      if (resource.coverKey === undefined) {
        slots.push({ kind: 'note', text: '[视频：消息没有封面图。]' })
      } else {
        slots.push({ kind: 'note', text: `[视频封面${resource.name === undefined ? '' : `（${resource.name}）`}：]` })
        if (!await takeImage(resource.coverKey)) return undefined
      }
      if (!await takeFrames(resource.fileKey)) return undefined
    } else if (!await takeImage(resource.key)) return undefined
  }
  if (omitted > 0) slots.push({ kind: 'note', text: `[另有 ${String(omitted)} 张图片未读取：超出单条消息图片数或字节上限。]` })
  if (stop === 'deadline') {
    slots.push({ kind: 'note', text: `[已达单次读取总时限 ${String(Math.round(budget.limits.deadlineMs / 1000))}s，进行中的下载已终止，另有 ${String(notTried)} 个资源未尝试。]` })
  } else if (stop === 'attempts') {
    slots.push({ kind: 'note', text: `[已达单次读取的下载尝试上限 ${String(budget.limits.maxAttempts)} 次（失败也计入），另有 ${String(notTried)} 个资源未尝试。]` })
  }

  const noteParts = (): LocusMessagePart[] =>
    slots.flatMap(slot => slot.kind === 'note' ? [{ type: 'text' as const, text: slot.text }] : [])
  const downloaded = slots.flatMap(slot => slot.kind === 'image' ? [slot.image] : [])
  let refs: readonly ImageAttachmentRef[] = []
  if (downloaded.length > 0) {
    try {
      refs = await input.attachments.saveImages(downloaded)
      if (refs.length !== downloaded.length) throw new Error('attachment-count-mismatch')
    } catch {
      return [{ type: 'text', text: '[图片未通过部署校验，未返回任何图片。]' }, ...noteParts()]
    }
  }

  const parts: LocusMessagePart[] = []
  let next = 0
  for (const slot of slots) {
    if (slot.kind === 'note') parts.push({ type: 'text', text: slot.text })
    else if (slot.kind === 'image') parts.push({ type: 'image', attachment: refs[next++]! })
    else {
      let frameRefs: readonly ImageAttachmentRef[] | undefined
      try {
        frameRefs = await input.attachments.saveImages(slot.frames.map(frame => frame.image))
        if (frameRefs.length !== slot.frames.length) frameRefs = undefined
      } catch { frameRefs = undefined }
      if (frameRefs === undefined) {
        parts.push({ type: 'text', text: skipNote('frame-admission-failed') })
        continue
      }
      parts.push({ type: 'text', text: framesNote(slot.durationSeconds, slot.frames.length) })
      for (const [index, frame] of slot.frames.entries()) {
        parts.push({ type: 'text', text: `[t=${formatTime(frame.timeSeconds)}]` })
        parts.push({ type: 'image', attachment: frameRefs[index]! })
      }
    }
  }
  return parts
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
  /** Overrides of {@link LOCUS_CALL_BUDGET}; non-positive or non-finite values are ignored. */
  readonly callBudget?: Partial<LocusCallBudgetLimits>
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
      async readMessage() { return { kind: 'failed', reason: 'media-unavailable' } },
      async readLinkedMessage() { return { kind: 'failed', reason: 'media-unavailable' } },
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
      async readMessage() { return { kind: 'failed', reason: 'media-unavailable' } },
      async readLinkedMessage() { return { kind: 'failed', reason: 'media-unavailable' } },
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

  const callLimits: LocusCallBudgetLimits = { ...LOCUS_CALL_BUDGET }
  for (const [name, value] of Object.entries(input.callBudget ?? {})) {
    if (name in callLimits && typeof value === 'number' && Number.isFinite(value) && value > 0) {
      (callLimits as unknown as Record<string, number>)[name] = value
    }
  }
  /** Why a platform step produced nothing, once its own error is not a parse failure. */
  const stepFailure = (budget: CallBudget): 'aborted' | 'deadline-exceeded' | undefined =>
    budget.caller.aborted ? 'aborted' : budget.timedOut() ? 'deadline-exceeded' : undefined

  const callOptions = (signal: AbortSignal) => ({ windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, signal })

  /** One message, proven to be in `expectedChat`, with its media. */
  const readOne = async (request: {
    readonly messageId: string
    readonly expectedChat: string
    readonly budget: CallBudget
    readonly canViewImages: () => Promise<boolean> | boolean
  }): Promise<
    | { readonly kind: 'ok'; readonly message: LocusReadMessage; readonly media: readonly LocusMessagePart[]; readonly links: readonly string[] }
    | { readonly kind: 'failed'; readonly reason: LocusMessageReadFailure }
  > => {
    if (!MESSAGE_ID_PATTERN.test(request.messageId) || request.expectedChat.trim() === '') {
      return { kind: 'failed', reason: 'invalid-message-id' }
    }
    const { budget } = request
    const early = stepFailure(budget)
    if (early !== undefined) return { kind: 'failed', reason: early }
    let raw: RawMessageFacts
    let formatted: ReturnType<typeof parseFormattedMessage>
    try {
      // Raw first: it carries the authoritative chat id, so a foreign message is
      // refused before its body is fetched at all.
      const rawResult = await runner(binary, petCliArgs([
        'api', 'GET', `/open-apis/im/v1/messages/${request.messageId}`, '--as', 'bot',
      ]), callOptions(budget.signal))
      raw = parseRawMessage(parseJsonSuffix(rawResult.stdout), request.messageId, request.expectedChat)
      const formattedResult = await runner(binary, petCliArgs([
        'im', '+messages-mget', '--as', 'bot', '--message-ids', request.messageId,
        '--no-reactions', '--format', 'json',
      ]), callOptions(budget.signal))
      formatted = parseFormattedMessage(parseJsonSuffix(formattedResult.stdout), request.messageId, request.expectedChat)
    } catch (error) {
      if (error instanceof MessageReadError) return { kind: 'failed', reason: error.reason }
      return { kind: 'failed', reason: stepFailure(budget) ?? 'platform-read-failed' }
    }
    // A merge-forward's body is mget's whole `<forwarded_messages>` block, bounded by child entries.
    const body = raw.msgType === 'merge_forward'
      ? boundMergeText(formatted.text, LOCUS_MERGE_MAX_CHILDREN, budget.limits.maxChars - 1_000)
      : boundBody(formatted.text)
    const threadId = raw.threadId ?? formatted.threadId
    const message: LocusReadMessage = {
      messageId: request.messageId,
      chatId: request.expectedChat,
      msgType: raw.msgType,
      ...(raw.createTime === undefined ? {} : { createTime: raw.createTime }),
      ...(formatted.senderName === undefined ? {} : { senderName: formatted.senderName }),
      ...(threadId === undefined ? {} : { threadId }),
      text: body.text,
      textTruncated: body.truncated,
    }
    if (raw.resources.length === 0) return { kind: 'ok', message, media: [], links: raw.links }

    let viewable = false
    try { viewable = await request.canViewImages() } catch { viewable = false }
    if (!viewable) {
      return {
        kind: 'ok',
        message,
        links: raw.links,
        media: [{ type: 'text', text: `[当前模型无法查看图片，未下载任何媒体。消息含：${describeResources(raw.resources)}。]` }],
      }
    }
    const media = await readMessageMedia({
      binary, spoolRoot, timeoutMs, limits, attachments, messageId: request.messageId, resources: raw.resources, budget,
      frameTools: input.frameTools, video,
    })
    if (media === undefined) return { kind: 'failed', reason: 'aborted' }
    // The whole call's text budget: notes first, the body gives way.
    const noteChars = media.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length + 1 : 0), 0)
    const room = budget.limits.maxChars - noteChars
    const fitted = message.text.length <= room ? message : {
      ...message,
      text: `${message.text.slice(0, Math.max(0, room - TRUNCATION_MARK.length))}${TRUNCATION_MARK}`,
      textTruncated: true,
    }
    return { kind: 'ok', message: fitted, media, links: raw.links }
  }

  /** Resolve one link through `message_links/query`; only an authorized, single, consistent answer passes. */
  const resolveLink = async (url: string, budget: CallBudget): Promise<
    | { readonly kind: 'ok'; readonly chatId: string; readonly name?: string; readonly messageId: string }
    | { readonly kind: 'failed'; readonly reason: LocusLinkedReadFailure }
  > => {
    let stdout: string
    try {
      stdout = (await runner(binary, petCliArgs([
        'api', 'POST', '/open-apis/im/v1/message_links/query', '--as', 'bot',
        '--data', JSON.stringify({ message_link_url: url }),
      ]), callOptions(budget.signal))).stdout
    } catch (error) {
      const stopped = stepFailure(budget)
      if (stopped !== undefined) return { kind: 'failed', reason: stopped }
      // A non-zero exit still carries the CLI's JSON error envelope on stdout.
      const out = recordOf(error)?.['stdout']
      if (typeof out !== 'string') return { kind: 'failed', reason: 'link-unresolved' }
      stdout = out
    }
    const envelope = recordOf(parseJsonSuffix(stdout))
    if (envelope?.['ok'] !== true) {
      const code = recordOf(envelope?.['error'])?.['code']
      return { kind: 'failed', reason: code === 99991672 ? 'link-scope-missing' : 'link-unresolved' }
    }
    const data = recordOf(envelope['data'])
    const chatInfo = recordOf(data?.['chat_info'])
    if (chatInfo?.['is_authorized'] !== true) return { kind: 'failed', reason: 'link-unauthorized' }
    const chatId = chatInfo['chat_id']
    const messages = data?.['messages']
    if (typeof chatId !== 'string' || !/^oc_[A-Za-z0-9_-]{1,128}$/.test(chatId)) return { kind: 'failed', reason: 'link-unresolved' }
    if (!Array.isArray(messages) || messages.length !== 1) return { kind: 'failed', reason: 'link-unresolved' }
    const snapshot = recordOf(recordOf(messages[0])?.['message'])
    const messageId = snapshot?.['message_id']
    if (typeof messageId !== 'string' || !MESSAGE_ID_PATTERN.test(messageId) || snapshot?.['chat_id'] !== chatId) {
      return { kind: 'failed', reason: 'link-unresolved' }
    }
    const name = typeof chatInfo['name'] === 'string' ? chatInfo['name'] : undefined
    return { kind: 'ok', chatId, messageId, ...(name === undefined ? {} : { name }) }
  }

  return {
    available: true,
    async readMessage(request) {
      const read = await readOne({
        messageId: request.messageId,
        expectedChat: request.chatId,
        budget: createCallBudget(request.signal, callLimits),
        canViewImages: request.canViewImages,
      })
      return read.kind === 'ok' ? { kind: 'ok', message: read.message, media: read.media } : read
    },
    async readLinkedMessage(request) {
      if (!Number.isSafeInteger(request.linkIndex) || request.linkIndex < 1) return { kind: 'failed', reason: 'invalid-message-id' }
      // One budget for the whole call: carrier read, resolution, target read and its media.
      const budget = createCallBudget(request.signal, callLimits)
      // The carrier is read WITHOUT media: only its chat and its raw links matter here.
      const carrier = await readOne({
        messageId: request.messageId, expectedChat: request.chatId, budget, canViewImages: () => false,
      })
      if (carrier.kind === 'failed') return carrier
      const url = carrier.links[request.linkIndex - 1]
      if (url === undefined) return { kind: 'failed', reason: 'link-not-found' }
      const resolved = await resolveLink(url, budget)
      if (resolved.kind === 'failed') return resolved
      const target = await readOne({
        messageId: resolved.messageId, expectedChat: resolved.chatId, budget, canViewImages: request.canViewImages,
      })
      if (target.kind === 'failed') return { kind: 'failed', reason: target.reason === 'chat-mismatch' ? 'link-mismatch' : target.reason }
      return {
        kind: 'ok',
        message: target.message,
        media: target.media,
        source: { chatId: resolved.chatId, ...(resolved.name === undefined ? {} : { name: resolved.name }) },
        linkIndex: request.linkIndex,
        linkCount: carrier.links.length,
      }
    },
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
