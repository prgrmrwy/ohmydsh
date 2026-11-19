/**
 * Merge-forward expansion in `pet_locus_message`'s port read
 * (change `locus-read-referenced-chats`, requirement 「合并转发按子消息展开」).
 *
 * Envelopes are the redacted shapes measured 2026-11-13
 * (`fixtures/lark-merge-forward-envelopes.ts`); downloads go through the fake
 * official CLI into a real spool, frames through the fake ffmpeg/ffprobe.
 */

import { readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocusMediaPort, type LarkCliRunner, type LocusMessageReadResult } from '../src/host/channel/media.js'
import { FIXTURE_CHAT, FIXTURE_IDS, rawApiEnvelope, MGET_TEXT } from './fixtures/lark-message-envelopes.js'
import {
  MERGE_KEYS,
  MERGE_OUTER_ID,
  childId,
  mergeBlock,
  mgetMergeEnvelope,
  nestedChild,
  rawMergeEnvelope,
  textChild,
  videoChild,
  type MergeChild,
} from './fixtures/lark-merge-forward-envelopes.js'
import {
  fakeMediaCli,
  installFakeFrameTools,
  type FakeFrameConfig,
  type FakeFrameTools,
  type FakeMediaCli,
} from './support/fake-media-cli.js'

let cli: FakeMediaCli | undefined
let tools: FakeFrameTools | undefined
afterEach(async () => {
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  if (tools !== undefined) await rm(tools.root, { recursive: true, force: true })
  cli = undefined
  tools = undefined
})

function store() {
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({
      attachmentId: `att-${String(saveImages.mock.calls.length)}-${String(index)}` as never,
      mediaType: item.mediaType, bytes: item.data.byteLength, width: 1, height: 1,
    })))
  return {
    saveImages,
    store: {
      imageLimits: {
        maxImageBytes: 4096, maxImagesPerMessage: 8, maxMessageImageBytes: 65_536,
        maxImagePixels: 1_000_000, maxImageDimension: 1_000, mediaTypes: ['image/png'] as const,
      },
      saveImages,
    } as never,
  }
}

async function harness(raw: Record<string, unknown>, mget: Record<string, unknown>, frames?: FakeFrameConfig) {
  cli = await fakeMediaCli()
  tools = await installFakeFrameTools()
  if (frames !== undefined) await tools.configure(frames)
  const saved = store()
  const runner = vi.fn<LarkCliRunner>(async (_binary, args) => ({
    stdout: JSON.stringify(args.includes('+messages-mget') ? mget : raw),
  }))
  const port = createLocusMediaPort({
    attachments: saved.store,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner,
    ...(frames === undefined ? {} : { frameTools: { ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe } }),
  })
  const read = (messageId = MERGE_OUTER_ID) => port.readMessage({
    messageId, chatId: FIXTURE_CHAT, signal: new AbortController().signal, canViewImages: async () => true,
  })
  return { read, runner, cli, saved }
}

function okOf(result: LocusMessageReadResult) {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.reason}`)
  return result
}

const entriesOf = (children: readonly MergeChild[]) => children.map((child, index) => ({
  body: child.msgType === 'post' ? `夹具视频说明\n[Media: ${MERGE_KEYS.video}]` : `夹具子消息 ${String(index + 1)}`,
}))

describe('merge-forward expansion', () => {
  it('expands merge-forward children and downloads child video via outer id', async () => {
    const children = [textChild(1), videoChild(2), textChild(3)]
    const h = await harness(
      rawMergeEnvelope(children),
      mgetMergeEnvelope(mergeBlock(entriesOf(children))),
      { probe: { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '9.7' }, ffmpeg: { frames: [0, 2.5] } },
    )
    const result = okOf(await h.read())
    expect(result.message.msgType).toBe('merge_forward')
    // All three children, in platform order, with sender and time.
    for (const text of ['夹具子消息 1', '夹具视频说明', '夹具子消息 3', '夹具用户']) expect(result.message.text).toContain(text)
    expect(result.message.text.indexOf('夹具子消息 1')).toBeLessThan(result.message.text.indexOf('夹具子消息 3'))
    // The second child's video: cover plus sampled keyframes.
    expect(result.media.filter(part => part.type === 'image')).toHaveLength(3)
    expect(result.media.some(part => part.type === 'text' && part.text.includes('抽样'))).toBe(true)
    // Every download goes through the OUTER id with the child's own keys.
    expect(await h.cli.calls()).toEqual([
      { type: 'image', fileKey: MERGE_KEYS.cover, messageId: MERGE_OUTER_ID },
      { type: 'file', fileKey: MERGE_KEYS.video, messageId: MERGE_OUTER_ID },
    ])
    expect(readdirSync(h.cli.spool)).toEqual([])
  })

  it('child with foreign upper_message_id fails envelope-invalid without download', async () => {
    const children = [textChild(1), { ...videoChild(2), upper: childId(99) }]
    const h = await harness(rawMergeEnvelope(children), mgetMergeEnvelope(mergeBlock(entriesOf(children))))
    expect(await h.read()).toEqual({ kind: 'failed', reason: 'envelope-invalid' })
    const missing = { ...videoChild(3), upper: '' }
    const h2 = await harness(rawMergeEnvelope([missing]), mgetMergeEnvelope(mergeBlock(entriesOf([missing]))))
    expect(await h2.read()).toEqual({ kind: 'failed', reason: 'envelope-invalid' })
    expect([...await h.cli.calls(), ...await h2.cli.calls()]).toEqual([])
  })

  it('caps children and states the omitted count', async () => {
    const children = Array.from({ length: 35 }, (_, index) => textChild(index + 1))
    const h = await harness(rawMergeEnvelope(children), mgetMergeEnvelope(mergeBlock(entriesOf(children))))
    const result = okOf(await h.read())
    expect(result.message.text).toContain('夹具子消息 30')
    expect(result.message.text).not.toContain('夹具子消息 31')
    expect(result.message.text).toContain('另有 5 条子消息未显示')
  })

  it('nested merge-forward returns metadata only', async () => {
    const children = [textChild(1), nestedChild(2)]
    const h = await harness(
      rawMergeEnvelope(children),
      mgetMergeEnvelope(mergeBlock([{ body: '夹具子消息 1' }, { body: '[Merged forward]' }])),
    )
    const result = okOf(await h.read())
    // No further platform read and no download for the nested one.
    expect(h.runner).toHaveBeenCalledTimes(2)
    expect(await h.cli.calls()).toEqual([])
    expect(result.media.some(part => part.type === 'text' && part.text.includes('嵌套合并转发'))).toBe(true)
  })

  it('non-merge multi-item response is message-not-unique', async () => {
    const single = rawApiEnvelope({ messageId: FIXTURE_IDS.text, msgType: 'text', content: '{"text":"x"}' })
    const items = (single['data'] as { items: unknown[] }).items
    const doubled = { ...single, data: { items: [...items, { ...(items[0] as object), message_id: childId(1), upper_message_id: FIXTURE_IDS.text }] } }
    const h = await harness(doubled, MGET_TEXT)
    expect(await h.read(FIXTURE_IDS.text)).toEqual({ kind: 'failed', reason: 'message-not-unique' })
    expect(await h.cli.calls()).toEqual([])
  })
})
