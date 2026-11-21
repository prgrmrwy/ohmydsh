/**
 * Whole-call work budget of a single-message read
 * (change `locus-read-referenced-chats`, requirement 「单次读取的整体工作预算」):
 * 12 download attempts (failures count), 90 s for the whole call, 16 000
 * characters of text. The deadline is shortened through the port's
 * `callBudget` seam; attempts and characters use the production defaults.
 */

import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocusMediaPort,
  LOCUS_CALL_BUDGET,
  type LarkCliRunner,
  type LocusMessageReadResult,
} from '../src/host/channel/media.js'
import { FIXTURE_CHAT } from './fixtures/lark-message-envelopes.js'
import {
  MERGE_OUTER_ID,
  mergeBlock,
  mgetMergeEnvelope,
  rawMergeEnvelope,
  textChild,
  videoChild,
  type MergeChild,
} from './fixtures/lark-merge-forward-envelopes.js'
import { fakeMediaCli, type FakeMediaCli } from './support/fake-media-cli.js'

let cli: FakeMediaCli | undefined
afterEach(async () => {
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  cli = undefined
})

async function harness(children: readonly MergeChild[], options: {
  readonly deadlineMs?: number
  readonly hangPlatform?: boolean
  readonly bodies?: readonly string[]
} = {}) {
  cli = await fakeMediaCli()
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({ attachmentId: `att-${String(index)}` as never, mediaType: item.mediaType, bytes: item.data.byteLength, width: 1, height: 1 })))
  const raw = rawMergeEnvelope(children)
  const mget = mgetMergeEnvelope(mergeBlock((options.bodies ?? children.map((_, i) => `夹具子消息 ${String(i + 1)}`)).map(body => ({ body }))))
  const runner = vi.fn<LarkCliRunner>(async (_binary, args, runOptions) => {
    if (options.hangPlatform === true) {
      const signal = (runOptions as { signal?: AbortSignal } | undefined)?.signal
      await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }
    return { stdout: JSON.stringify(args.includes('+messages-mget') ? mget : raw) }
  })
  const port = createLocusMediaPort({
    attachments: {
      imageLimits: { maxImageBytes: 4096, maxImagesPerMessage: 8, maxMessageImageBytes: 65_536, maxImagePixels: 1_000_000, maxImageDimension: 1_000, mediaTypes: ['image/png'] },
      saveImages,
    } as never,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner,
    ...(options.deadlineMs === undefined ? {} : { callBudget: { deadlineMs: options.deadlineMs } }),
  })
  const controller = new AbortController()
  const read = () => port.readMessage({ messageId: MERGE_OUTER_ID, chatId: FIXTURE_CHAT, signal: controller.signal, canViewImages: async () => true })
  return { read, controller, cli, saveImages }
}

function okOf(result: LocusMessageReadResult) {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.reason}`)
  return result
}

const textIn = (result: ReturnType<typeof okOf>): string =>
  [result.message.text, ...result.media.flatMap(part => part.type === 'text' ? [part.text] : [])].join('\n')

describe('whole-call work budget', () => {
  it('declares the owner-approved defaults', () => {
    expect(LOCUS_CALL_BUDGET).toEqual({ maxAttempts: 12, deadlineMs: 90_000, maxChars: 16_000 })
  })

  it('failed downloads count toward the 12-attempt cap', async () => {
    // spec Scenario 「失败下载也消耗尝试次数」: 30 children, every cover download fails.
    const children = Array.from({ length: 30 }, (_, i) =>
      videoChild(i + 1, `img_v3_exit_${String(i).padStart(2, '0')}`, `file_v3_exit_${String(i).padStart(2, '0')}`))
    const h = await harness(children)
    const result = okOf(await h.read())
    expect(await h.cli.calls()).toHaveLength(12)
    expect(textIn(result)).toContain('18 个资源未尝试')
    expect(readdirSync(h.cli.spool)).toEqual([])
  })

  it('overall 90s deadline aborts downloads and extraction and leaves spool empty', async () => {
    // spec Scenario 「总时限到期」: a download that never ends hits the (shortened) whole-call deadline.
    const started = Date.now()
    const h = await harness([videoChild(1, 'img_v3_hang_01'), videoChild(2)], { deadlineMs: 600 })
    const result = okOf(await h.read())
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(textIn(result)).toContain('总时限')
    expect(result.message.text).toContain('夹具子消息 1')
    expect(readdirSync(h.cli.spool)).toEqual([])
    await new Promise(done => setTimeout(done, 1_500))
    expect(existsSync(h.cli.escaped)).toBe(false)

    // The deadline also covers the platform reads before any download: that is a failure, not an empty message.
    const stalled = await harness([textChild(1)], { deadlineMs: 300, hangPlatform: true })
    expect(await stalled.read()).toEqual({ kind: 'failed', reason: 'deadline-exceeded' })

    // The caller's own abort is still 'aborted', not a deadline.
    const cancelled = await harness([textChild(1)], { hangPlatform: true })
    const pending = cancelled.read()
    cancelled.controller.abort()
    expect(await pending).toEqual({ kind: 'failed', reason: 'aborted' })

    // Within budget nothing is cut and no deadline note appears.
    const fine = await harness([videoChild(1)], { deadlineMs: 30_000 })
    const ok = okOf(await fine.read())
    expect(ok.media.some(part => part.type === 'image')).toBe(true)
    expect(textIn(ok)).not.toContain('总时限')
  })

  it('serialized text stays within 16000 chars and states omissions', async () => {
    // spec Scenario 「文字预算截断」.
    const bodies = Array.from({ length: 30 }, (_, i) => `夹具子消息 ${String(i + 1)} ${'长'.repeat(800)}`)
    const h = await harness(Array.from({ length: 30 }, (_, i) => textChild(i + 1)), { bodies })
    const result = okOf(await h.read())
    expect(textIn(result).length).toBeLessThanOrEqual(16_000)
    expect(result.message.text).toContain('夹具子消息 1 ')
    expect(result.message.text).toMatch(/另有 \d+ 条子消息未显示/)
    expect(result.message.text).toContain('</forwarded_messages>')
  })
})
