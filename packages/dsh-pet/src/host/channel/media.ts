/** Host-owned, caller-bound Lark image admission for one durable Delivery. */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
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

/** Runtime-attested patched CLI capability. A mere executable path is insufficient. */
export interface BoundedFdLarkDownloader {
  readonly binary: string
  readonly supportsBoundedFdDownload: true
  readonly upstreamVersion: '1.0.94'
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

function receiptSize(stdout: string): number | undefined {
  const envelope = recordOf(parseJsonSuffix(stdout))
  const receipt = envelope?.['ok'] === true ? recordOf(envelope['data']) : envelope
  if (receipt?.['output_fd'] !== 3) return undefined
  const value = receipt['size_bytes']
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined
}

function killProcessTree(child: ChildProcess): void {
  child.stdio[3]?.destroy()
  if (child.pid !== undefined && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* process may already have exited */ }
  }
  try { child.kill('SIGKILL') } catch { /* process may already have exited */ }
}

async function downloadOnInheritedFd(input: {
  readonly binary: string
  readonly args: readonly string[]
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<Uint8Array> {
  if (input.signal.aborted) throw new Error('download-aborted')
  const child = spawn(input.binary, [...input.args, '--output-fd', '3', '--max-bytes', String(input.maxBytes)], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  })
  const output = child.stdio[3]
  if (output === null || output === undefined) {
    killProcessTree(child)
    throw new Error('download-fd-unavailable')
  }

  const chunks: Buffer[] = []
  let byteLength = 0
  let stdout = ''
  let stderrBytes = 0
  let failure: Error | undefined
  const fail = (error: Error): void => {
    if (failure !== undefined) return
    failure = error
    killProcessTree(child)
  }
  const onAbort = () => fail(new Error('download-aborted'))
  input.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => fail(new Error('download-timeout')), input.timeoutMs)
  timer.unref?.()

  output.on('data', (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += data.byteLength
    if (byteLength > input.maxBytes) {
      fail(new Error('download-byte-limit-exceeded'))
      return
    }
    chunks.push(data)
  })
  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const currentBytes = Buffer.byteLength(stdout)
    if (data.byteLength > MAX_RECEIPT_BYTES - currentBytes) {
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
    if (failure !== undefined) throw failure
    if (code !== 0 || signal !== null) throw new Error('download-process-failed')
    const declaredSize = receiptSize(stdout)
    if (declaredSize === undefined || declaredSize !== byteLength) throw new Error('download-receipt-size-mismatch')
    return new Uint8Array(Buffer.concat(chunks, byteLength))
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onAbort)
    output.destroy()
  }
}

export const LOCUS_MEDIA_UNAVAILABLE_REASON = 'bounded-fd-media-download-unavailable'

export interface CreateLocusMediaPortInput {
  readonly attachments?: AttachmentStore
  /** Resolved only by the exact pinned-runtime compat capability probe. */
  readonly download?: BoundedFdLarkDownloader
  /** Ordinary runner remains sufficient for metadata-only mget. */
  readonly runner?: LarkCliRunner
  readonly timeoutMs?: number
}

/** Create the bounded no-path media port; absent compat capability performs no I/O. */
export function createLocusMediaPort(input: CreateLocusMediaPortInput): LocusMediaPort {
  if (
    input.attachments === undefined
    || input.download?.supportsBoundedFdDownload !== true
    || input.download.upstreamVersion !== '1.0.94'
    || input.download.binary.trim() === ''
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
          const data = await downloadOnInheritedFd({
            binary,
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
