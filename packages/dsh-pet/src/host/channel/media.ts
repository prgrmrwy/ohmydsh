/** Host-owned, caller-bound Lark image admission for one durable Delivery. */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AttachmentStore,
  ImageAttachmentLimits,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { petCliArgs } from './cli.js'
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

export interface LocusMediaPort {
  readonly available: boolean
  readonly diagnostic?: string
  admitCurrentImage(input: {
    readonly messageId: string
    readonly signal: AbortSignal
    /** Exact durable current fence, invoked immediately before persistence. */
    readonly fenceBeforeSave: () => Promise<boolean>
  }): Promise<LocusMediaAdmission>
}

/**
 * The pinned official CLI plus the one directory it may write into.
 *
 * A bare executable path is not enough: the version is the contract for
 * `--output`'s allowed roots and denylist, and the spool is the only place a
 * downloaded byte may exist on disk.
 */
export interface PinnedLarkDownloader {
  readonly binary: string
  readonly pinnedVersion: '1.0.94'
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
  return { imageKeys: [...keys], unsupported: unsupported.slice(0, MAX_METADATA_ITEMS) }
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

function unsupportedContent(resources: readonly LarkMessageResource[]): ContentBlock[] {
  if (resources.length === 0) return []
  const kinds = [...new Set(resources.map(item => item.kind))].join(', ')
  return [{ type: 'text', text: `[当前消息还包含暂不支持的资源类型：${kinds || 'unknown'}；未下载、执行、解压、转码或 OCR。]` }]
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

function killProcessTree(child: ChildProcess): void {
  child.stdio[3]?.destroy()
  if (child.pid !== undefined && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* process may already have exited */ }
  }
  try { child.kill('SIGKILL') } catch { /* process may already have exited */ }
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
 */
async function downloadIntoSpool(input: {
  readonly binary: string
  readonly spoolRoot: string
  readonly args: readonly string[]
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<Uint8Array> {
  if (input.signal.aborted) throw new Error('download-aborted')
  const token = randomBytes(SPOOL_TOKEN_BYTES).toString('hex')
  const targetName = `${token}.bin`
  const dir = join(input.spoolRoot, token)
  const target = join(dir, targetName)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const child = spawn(input.binary, [...input.args, '--output', `./${targetName}`], {
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
    const data = readFileSync(target)
    if (data.byteLength > input.maxBytes) throw new Error('download-byte-limit-exceeded')
    if (data.byteLength !== size) throw new Error('download-output-changed')
    return new Uint8Array(data)
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    input.signal.removeEventListener('abort', onAbort)
    if (!exited) killProcessTree(child)
    removeSpoolDir(dir)
  }
}

export const LOCUS_MEDIA_UNAVAILABLE_REASON = 'pinned-cli-media-download-unavailable'

export interface CreateLocusMediaPortInput {
  readonly attachments?: AttachmentStore
  /** Resolved only by the pinned-official-CLI probe. */
  readonly download?: PinnedLarkDownloader
  /** Ordinary runner remains sufficient for metadata-only mget. */
  readonly runner?: LarkCliRunner
  readonly timeoutMs?: number
}

/** Create the spooled media port; an unproven CLI performs no I/O at all. */
export function createLocusMediaPort(input: CreateLocusMediaPortInput): LocusMediaPort {
  if (
    input.attachments === undefined
    || input.download?.pinnedVersion !== '1.0.94'
    || input.download.binary.trim() === ''
    || input.download.spoolRoot.trim() === ''
  ) {
    return {
      available: false,
      diagnostic: LOCUS_MEDIA_UNAVAILABLE_REASON,
      async admitCurrentImage() {
        return { kind: 'unavailable', reason: LOCUS_MEDIA_UNAVAILABLE_REASON, content: [] }
      },
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
    }
  }
  const runner = input.runner ?? run
  const timeoutMs = input.timeoutMs ?? CALL_TIMEOUT_MS
  const binary = input.download.binary
  const spoolRoot = input.download.spoolRoot

  return {
    available: true,
    async admitCurrentImage(request) {
      if (request.signal.aborted) return { kind: 'unavailable', reason: 'aborted', content: [] }
      let parsed: ParsedMessageResources
      try {
        const result = await runner(binary, petCliArgs([
          'im', '+messages-mget', '--as', 'bot', '--message-ids', request.messageId,
          '--no-reactions', '--format', 'json',
        ]), { timeout: timeoutMs, maxBuffer: 1024 * 1024 })
        parsed = parseSingleMessageResources(parseJsonSuffix(result.stdout), request.messageId)
      } catch {
        return { kind: 'unavailable', reason: 'platform-read-failed', content: [] }
      }
      const metadata = unsupportedContent(parsed.unsupported)
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
          const data = await downloadIntoSpool({
            binary,
            spoolRoot,
            args: petCliArgs([
              'im', '+messages-resources-download', '--as', 'bot',
              '--message-id', request.messageId,
              '--file-key', imageKey, '--type', 'image', '--format', 'json',
            ]),
            maxBytes,
            timeoutMs,
            signal: request.signal,
          })
          totalBytes += data.byteLength
          if (totalBytes > limits.maxMessageImageBytes) throw new Error('message-images-too-large')
          const mediaType = detectImageMediaType(data)
          if (mediaType === undefined || !limits.mediaTypes.includes(mediaType)) {
            throw new Error('image-mime-unsupported')
          }
          saveInputs.push({ data, mediaType })
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
