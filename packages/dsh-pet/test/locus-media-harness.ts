/**
 * Shared harness for the paged media-read tests (change `locus-read-referenced-chats`).
 *
 * - {@link pathCli}: a stand-in for the official `lark-cli` download mode with
 *   per-key behaviour (valid PNG, `234003` on stderr, silent exit, hang). It logs
 *   every download so a test can prove WHICH message id a key was fetched with.
 * - {@link scriptedRunner}: the `api`/`+messages-mget`/`+threads-messages-list`
 *   calls, answered from tables, with failures in the real CLI shape (non-zero
 *   exit, envelope on stderr, empty stdout).
 * - {@link blockText}: pulls the platform text back out of the Host's escaped
 *   JSON data blocks.
 */

import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { LarkCliRunner, LocusMessagePart, LocusPageResult } from '../src/host/channel/media.js'

export interface PathCli {
  readonly root: string
  readonly spool: string
  readonly binary: string
  calls(): Promise<readonly { readonly type: string; readonly fileKey: string; readonly messageId: string }[]>
  spoolEntries(): string[]
}

/**
 * Fake `lark-cli +messages-resources-download`.
 *
 * By file-key substring: `234003` → failure envelope on STDERR, exit 1 (the real
 * shape); `exit` → exit 3 with nothing printed; `hang` → partial file, never
 * exits; otherwise a PNG whose last byte is the trailing digits of the key.
 */
export async function pathCli(options: { readonly videoFixture?: string } = {}): Promise<PathCli> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-path-cli-'))
  const spool = join(root, 'media-spool')
  await mkdir(spool)
  const binary = join(root, 'fake-lark-cli.mjs')
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
const root = dirname(fileURLToPath(import.meta.url))
if (!args.includes('+messages-resources-download')) process.exit(90)
const target = resolve(process.cwd(), value('--output'))
const key = value('--file-key')
appendFileSync(join(root, 'calls.log'), JSON.stringify({ type: value('--type'), fileKey: key, messageId: value('--message-id') }) + '\\n')
const write = data => { writeFileSync(target + '.tmp', data); renameSync(target + '.tmp', target) }
if (key.includes('234003')) {
  process.stderr.write(JSON.stringify({ ok: false, identity: 'bot', error: { type: 'api_error', code: 234003, message: 'File not in msg' } }) + '\\n')
  process.exit(1)
}
if (key.includes('exit')) process.exit(3)
// slow<N>: the download takes N * 100 ms.
const slow = key.match(/slow(\\d+)/)
if (slow) await new Promise(resolve => setTimeout(resolve, Number(slow[1]) * 100))
// flaky<N>: the first N attempts at this key exit silently (a transient failure), then it succeeds.
const flaky = key.match(/flaky(\\d)/)
if (flaky) {
  const counter = join(root, 'attempts-' + key)
  let seen = 0
  try { seen = Number(readFileSync(counter, 'utf8')) } catch {}
  writeFileSync(counter, String(seen + 1))
  if (seen < Number(flaky[1])) process.exit(3)
}
if (key.includes('hang')) { write(Buffer.from([0x89, 0x50])); setInterval(() => {}, 1000) }
else {
  const tag = Number(key.match(/(\\d+)$/)?.[1] ?? 1) & 0xff
  const data = value('--type') === 'file'
    ? (existsSync(join(root, 'video.bin')) ? readFileSync(join(root, 'video.bin')) : Buffer.alloc(64, 0x41))
    : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag])
  write(data)
  process.stdout.write(JSON.stringify({ ok: true, data: { saved_path: target, size_bytes: data.length } }))
}
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  if (options.videoFixture !== undefined) await copyFile(options.videoFixture, join(root, 'video.bin'))
  return {
    root,
    spool,
    binary,
    async calls() {
      const path = join(root, 'calls.log')
      if (!existsSync(path)) return []
      return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    },
    spoolEntries: () => readdirSync(spool),
  }
}

export interface FailReply {
  readonly fail: { readonly stdout?: string; readonly stderr?: string; readonly code?: number | string }
}
export type Reply = unknown | FailReply | ((args: readonly string[]) => unknown)

export interface RunnerScript {
  /** Raw `api GET /open-apis/im/v1/messages/<id>` by message id. */
  readonly raw?: Record<string, Reply>
  /** `+messages-mget` by message id. */
  readonly mget?: Record<string, Reply>
  /** `api POST …/message_links/query`; receives the submitted URL. */
  readonly query?: (url: string) => Reply
  /** `+threads-messages-list`; receives the argv. */
  readonly topic?: (args: readonly string[]) => Reply
}

export interface RunnerCall {
  readonly kind: 'raw' | 'mget' | 'query' | 'topic'
  readonly id?: string
  readonly args: readonly string[]
}

const isFail = (reply: unknown): reply is FailReply =>
  typeof reply === 'object' && reply !== null && 'fail' in reply

/** A runner answering from tables; unknown ids are a CLI failure with no envelope. */
export function scriptedRunner(script: RunnerScript): { readonly runner: LarkCliRunner; readonly calls: RunnerCall[] } {
  const calls: RunnerCall[] = []
  const answer = (reply: Reply, args: readonly string[]): { stdout: string } => {
    const value = typeof reply === 'function' ? (reply as (a: readonly string[]) => unknown)(args) : reply
    if (isFail(value)) {
      throw Object.assign(new Error('Command failed'), {
        code: value.fail.code ?? 1, stdout: value.fail.stdout ?? '', stderr: value.fail.stderr ?? '',
      })
    }
    return { stdout: JSON.stringify(value) }
  }
  const runner = vi.fn<LarkCliRunner>(async (_binary, fullArgs) => {
    // Every Pet call is `--profile <name> …`; the table is keyed on the command itself.
    const args = fullArgs[0] === '--profile' ? fullArgs.slice(2) : fullArgs
    const at = (flag: string): string | undefined => args[args.indexOf(flag) + 1]
    if (args[0] === 'api' && args[1] === 'GET') {
      const id = String(args[2]).split('/').pop() ?? ''
      calls.push({ kind: 'raw', id, args })
      return answer(script.raw?.[id] ?? { fail: {} }, args)
    }
    if (args.includes('+messages-mget')) {
      const id = at('--message-ids') ?? ''
      calls.push({ kind: 'mget', id, args })
      return answer(script.mget?.[id] ?? { fail: {} }, args)
    }
    if (args[0] === 'api' && args[1] === 'POST') {
      const url = (JSON.parse(at('--data') ?? '{}') as { message_link_url?: string }).message_link_url ?? ''
      calls.push({ kind: 'query', id: url, args })
      return answer(script.query?.(url) ?? { fail: {} }, args)
    }
    if (args.includes('+threads-messages-list')) {
      calls.push({ kind: 'topic', args })
      return answer(script.topic?.(args) ?? { fail: {} }, args)
    }
    throw new Error(`unexpected CLI call: ${args.join(' ')}`)
  })
  return { runner, calls }
}

/** An `AttachmentStore` whose refs are content-addressed, like the real one's. */
export function contentStore(overrides: Partial<Record<'maxImageBytes' | 'maxImagesPerMessage' | 'maxMessageImageBytes', number>> = {}) {
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map(item => ({
      attachmentId: `att-${createHash('sha1').update(item.data).digest('hex').slice(0, 12)}` as never,
      mediaType: item.mediaType,
      bytes: item.data.byteLength,
      width: 1,
      height: 1,
    })))
  return {
    saveImages,
    store: {
      imageLimits: {
        maxImageBytes: overrides.maxImageBytes ?? 4096,
        maxImagesPerMessage: overrides.maxImagesPerMessage ?? 8,
        maxMessageImageBytes: overrides.maxMessageImageBytes ?? 65_536,
        maxImagePixels: 1_000_000,
        maxImageDimension: 1_000,
        mediaTypes: ['image/png', 'image/jpeg'] as const,
      },
      saveImages,
    } as never,
  }
}

const BLOCK = /<(?:message-body|linked-message)>\n([\s\S]*?)\n<\/(?:message-body|linked-message)>/g

/** Every Host data block of a page, parsed. Fails if a block is not valid JSON. */
export function dataBlocks(parts: readonly LocusMessagePart[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const part of parts) {
    if (part.type !== 'text') continue
    for (const match of part.text.matchAll(BLOCK)) out.push(JSON.parse(match[1]!) as Record<string, unknown>)
  }
  return out
}

/** The platform text of a page: every `text` segment of its data blocks, joined in order. */
export function blockText(parts: readonly LocusMessagePart[]): string {
  return dataBlocks(parts).map(block => (typeof block['text'] === 'string' ? block['text'] : '')).join('')
}

/** All Host-written text of a page (blocks included), for "does it contain …" assertions. */
export function pageText(page: LocusPageResult): string {
  return page.kind === 'ok'
    ? page.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
    : ''
}

export const imagesOf = (parts: readonly LocusMessagePart[]) => parts.filter(part => part.type === 'image')

// ---------------------------------------------------------------------------
// Message builders and a paged-port harness
// ---------------------------------------------------------------------------

import { rm } from 'node:fs/promises'
import { createLocusMediaPort, type CreateLocusMediaPortInput, type LocusMediaPort, type LocusPageInput } from '../src/host/channel/media.js'
import { FIXTURE_CHAT, mgetEnvelope, rawApiEnvelope } from './fixtures/lark-message-envelopes.js'
import { NESTED_IDS, imageContent, rawTreeEnvelope, textContent, type NestedNode } from './fixtures/lark-merge-forward-nested-envelopes.js'

export const imageKey = (index: number, flavour = 'k'): string => `img_${flavour}_${String(index).padStart(4, '0')}`

/** A `post` message with `count` image elements; `keyOf` names each key. */
export function postWithImages(id: string, count: number, keyOf: (index: number) => string = imageKey) {
  const keys = Array.from({ length: count }, (_, index) => keyOf(index))
  const paragraphs = [[{ tag: 'text', text: '帖子正文', style: [] }], ...keys.map(key => [{ tag: 'img', image_key: key }])]
  return {
    keys,
    raw: rawApiEnvelope({ messageId: id, msgType: 'post', content: JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs }) }),
    mget: mgetEnvelope({ messageId: id, msgType: 'post', content: `帖子正文\n${keys.map(key => `![Image](${key})`).join('\n')}` }),
  }
}

/** A plain-text message. */
export function textMessage(id: string, text: string) {
  return {
    raw: rawApiEnvelope({ messageId: id, msgType: 'text', content: JSON.stringify({ text }) }),
    mget: mgetEnvelope({ messageId: id, msgType: 'text', content: text }),
  }
}

/** A merge-forward root whose children are one image node per key (platform order). */
export function mergeOfImages(rootId: string, keys: readonly string[]) {
  const nodes: NestedNode[] = [
    { id: rootId, msgType: 'merge_forward', content: 'Merged and Forwarded Message', chatId: FIXTURE_CHAT },
    ...keys.map((key, index): NestedNode => ({
      id: `om_x100b00000000000000000000008${String(index).padStart(5, '0')}`, msgType: 'image', content: imageContent(key), upper: rootId,
    })),
  ]
  return {
    raw: rawTreeEnvelope(nodes),
    mget: mgetEnvelope({ messageId: rootId, msgType: 'merge_forward', content: '<forwarded_messages>\n</forwarded_messages>', chatId: FIXTURE_CHAT }),
    nodes,
  }
}

export const ROOT_ID = NESTED_IDS.F
void textContent

export interface PagedHarness {
  readonly port: LocusMediaPort
  readonly cli: PathCli
  readonly calls: RunnerCall[]
  readonly saved: ReturnType<typeof contentStore>
  read(request?: Partial<LocusPageInput>): Promise<LocusPageResult>
  /** Follow every cursor; returns every page. */
  readAll(request?: Partial<LocusPageInput>, max?: number): Promise<LocusPageResult[]>
  dispose(): Promise<void>
}

/** A port over a scripted runner and the path-mode fake CLI. */
export async function pagedHarness(options: {
  readonly script: RunnerScript
  readonly store?: Parameters<typeof contentStore>[0]
  readonly port?: Partial<CreateLocusMediaPortInput>
  readonly messageId?: string
  readonly videoFixture?: string
}): Promise<PagedHarness> {
  const cli = await pathCli(options.videoFixture === undefined ? {} : { videoFixture: options.videoFixture })
  const saved = contentStore(options.store)
  const scripted = scriptedRunner(options.script)
  const port = createLocusMediaPort({
    attachments: saved.store,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner: scripted.runner,
    ...options.port,
  })
  const base = (request: Partial<LocusPageInput>): LocusPageInput => ({
    messageId: options.messageId ?? ROOT_ID,
    chatId: FIXTURE_CHAT,
    caller: 'caller-1',
    signal: new AbortController().signal,
    canViewImages: async () => true,
    ...request,
  })
  const read = (request: Partial<LocusPageInput> = {}) => port.readMessagePage(base(request))
  return {
    port,
    cli,
    calls: scripted.calls,
    saved,
    read,
    async readAll(request = {}, max = 300) {
      const pages: LocusPageResult[] = []
      let cursor: string | undefined = request.cursor
      do {
        const page = await read({ ...request, ...(cursor === undefined ? {} : { cursor }) })
        pages.push(page)
        cursor = page.kind === 'ok' ? page.cursor : undefined
      } while (cursor !== undefined && pages.length < max)
      return pages
    },
    dispose: () => rm(cli.root, { recursive: true, force: true }),
  }
}

/** Identity of one image part: the label line Host writes before it plus its attachment ref. */
export function imageIds(parts: readonly LocusMessagePart[]): string[] {
  return parts.flatMap(part => (part.type === 'text' ? [...part.text.matchAll(/\[图片 ([^\]]+)\]/g)].map(match => match[1]!) : []))
}

/** Characters a page costs, by its serialized text. */
export const pageChars = (page: LocusPageResult): number =>
  page.kind === 'ok' ? page.parts.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0) : 0
