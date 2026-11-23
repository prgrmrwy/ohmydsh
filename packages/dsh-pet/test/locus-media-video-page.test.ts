/**
 * Video units at the paged port level (change `locus-read-referenced-chats`,
 * R6, R17 video row, R25 rows 4–6): how the page budget, the cursor and the
 * ledger treat a video. The extraction itself is covered by
 * `locus-media-video.test.ts` / `.ffmpeg.test.ts`; here a REAL `ffmpeg` frames a
 * generated clip that the fake CLI "downloads".
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { LocusPageResult } from '../src/host/channel/media.js'
import { createCursorStore } from '../src/host/locus/media-cursor.js'
import { resolveFrameTools } from '../src/host/channel/media-video.js'
import { FIXTURE_IDS, mgetEnvelope, rawApiEnvelope } from './fixtures/lark-message-envelopes.js'
import { imagesOf, pageText, pagedHarness, type PagedHarness } from './locus-media-harness.js'

const run = promisify(execFile)
const tools = await resolveFrameTools()
if (tools === undefined) console.warn('[skip] locus-media-video-page: ffmpeg/ffprobe not found on PATH')

const POST_ID = FIXTURE_IDS.text
let root = ''
let clip5 = ''
let clip19 = ''

beforeAll(async () => {
  if (tools === undefined) return
  root = await mkdtemp(join(tmpdir(), 'dsh-pet-video-page-'))
  const make = async (name: string, seconds: number): Promise<string> => {
    const path = join(root, name)
    await run(tools.ffmpeg, [
      '-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=64x48:r=10:d=${String(seconds)}`, '-pix_fmt', 'yuv420p', '-y', path,
    ])
    return path
  }
  clip5 = await make('five.mp4', 5)
  clip19 = await make('nineteen.mp4', 19)
})
afterAll(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true })
})

const harnesses: PagedHarness[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

/** A post with a text line and one video; `cover` is optional. */
function videoPost(fileKey: string, cover?: string) {
  const paragraphs = [
    [{ tag: 'text', text: '视频说明', style: [] }],
    [{ tag: 'media', file_key: fileKey, ...(cover === undefined ? {} : { image_key: cover }) }],
  ]
  return {
    raw: rawApiEnvelope({ messageId: POST_ID, msgType: 'post', content: JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs }) }),
    mget: mgetEnvelope({ messageId: POST_ID, msgType: 'post', content: `视频说明\n[Media: ${fileKey}]` }),
  }
}

async function harness(options: {
  readonly fileKey?: string
  readonly cover?: string
  readonly clip: string
  readonly port?: Parameters<typeof pagedHarness>[0]['port']
}): Promise<PagedHarness> {
  const post = videoPost(options.fileKey ?? 'file_v3_0001', options.cover)
  const h = await pagedHarness({
    script: { raw: { [POST_ID]: post.raw }, mget: { [POST_ID]: post.mget } },
    messageId: POST_ID,
    videoFixture: options.clip,
    port: { frameTools: tools!, ...options.port },
  })
  harnesses.push(h)
  return h
}

const ok = (page: LocusPageResult) => {
  if (page.kind !== 'ok') throw new Error(`expected ok, got ${page.reason}`)
  return page
}
const times = (pages: readonly LocusPageResult[]): number[] =>
  pages.flatMap(page => (page.kind === 'ok' ? page.parts.flatMap(part => (part.type === 'text' ? [...part.text.matchAll(/\[t=([0-9.]+)s\]/g)].map(m => Number(m[1])) : [])) : []))

describe.skipIf(tools === undefined)('video units through the paged port', () => {
  it('returns cover and integer-second frames with the no-sound note, empty spool', async () => {
    const h = await harness({ clip: clip5, cover: 'img_cover_0001' })
    const page = ok(await h.read())
    expect(imagesOf(page.parts)).toHaveLength(1 + 5)
    expect(times([page])).toEqual([0, 1, 2, 3, 4])
    expect(pageText(page)).toContain('没有声音')
    expect(page.failed).toEqual([])
    expect(page.complete).toBe(true)
    expect(await h.cli.calls()).toEqual([
      { type: 'image', fileKey: 'img_cover_0001', messageId: POST_ID },
      { type: 'file', fileKey: 'file_v3_0001', messageId: POST_ID },
    ])
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('19 s with 8 frames per page reads 8, 8, 3 with strictly increasing times and no gap', async () => {
    const h = await harness({ clip: clip19 })
    const pages = (await h.readAll()).map(ok)
    expect(pages.map(page => times([page]).length)).toEqual([8, 8, 3])
    expect(times(pages)).toEqual(Array.from({ length: 19 }, (_, index) => index))
    expect(pages.at(-1)?.cursor).toBeUndefined()
    expect(pages.at(-1)?.complete).toBe(true)
    // One download per page: the video is not cached across calls.
    expect((await h.cli.calls()).filter(call => call.type === 'file')).toHaveLength(3)
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('a download longer than the per-CLI timeout still succeeds inside the page budget (no separate CLI timeout)', async () => {
    // Images would time out at 300 ms; the video may use the page's remaining time.
    const h = await harness({ clip: clip5, fileKey: 'file_v3_slow10', port: { timeoutMs: 300, page: { deadlineMs: 8_000 } } })
    const page = ok(await h.read())
    expect(times([page])).toEqual([0, 1, 2, 3, 4])
    expect(page.failed).toEqual([])
  })

  it('download cut after earlier units delivered keeps the cursor on the video; as the first unit it is video-download-exceeds-window and skipped', async () => {
    const cursors = createCursorStore()
    const h = await harness({ clip: clip5, fileKey: 'file_v3_slow30', port: { page: { deadlineMs: 1_200 }, cursors } })
    const first = ok(await h.read())
    expect(first.failed).toEqual([])
    expect(first.cursor).toBeDefined()
    const resolved = cursors.resolve(first.cursor!, { caller: 'caller-1', messageId: POST_ID })
    if (resolved.kind !== 'ok') throw new Error('cursor must resolve')
    // Units: head(0), one text segment(1), the video(2); the head and text were delivered.
    expect([resolved.snapshot.position, resolved.snapshot.attempt]).toEqual([2, 0])
    const second = ok(await h.read({ cursor: first.cursor! }))
    expect(second.failed).toEqual([{ id: `${POST_ID}#v`, reason: 'video-download-exceeds-window' }])
    expect(second.cursor).toBeUndefined()
    expect(second.complete).toBe(false)
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('platform refusal fails the video unit, keeps the cover and cleans the spool', async () => {
    const h = await harness({ clip: clip5, fileKey: 'file_v3_234003', cover: 'img_cover_0001' })
    const page = ok(await h.read())
    expect(imagesOf(page.parts)).toHaveLength(1)
    expect(page.failed).toEqual([{ id: `${POST_ID}#v`, reason: 'video-download-failed' }])
    expect(page.complete).toBe(false)
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('low disk during the video download fails the video unit, keeps the cover and cleans the spool', async () => {
    let calls: () => string = () => ''
    const h = await harness({
      clip: clip5,
      fileKey: 'file_v3_slow10',
      cover: 'img_cover_0001',
      port: {
        spool: { diskReserveBytes: 1_000, freeBytes: () => (calls().includes('"type":"file"') ? 0 : 10 ** 12) },
      },
    })
    calls = () => { try { return readFileSync(join(h.cli.root, 'calls.log'), 'utf8') } catch { return '' } }
    const page = ok(await h.read())
    expect(imagesOf(page.parts)).toHaveLength(1)
    expect(page.failed).toEqual([{ id: `${POST_ID}#v`, reason: 'disk-low' }])
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('decode timeout with nothing verified is a failure of the video unit, not a cursor at the same progress', async () => {
    const h = await harness({ clip: clip5, cover: 'img_cover_0001', port: { video: { decodeWindowMs: 1 } } })
    const page = ok(await h.read())
    expect(page.failed).toEqual([{ id: `${POST_ID}#v`, reason: 'frame-extraction-timeout' }])
    expect(page.cursor).toBeUndefined()
    expect(imagesOf(page.parts)).toHaveLength(1)
  })
})
