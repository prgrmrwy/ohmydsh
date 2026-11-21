/**
 * Video cover + scene-keyframe reading through the media port.
 *
 * Everything external is a REAL process: the download is the fake official CLI
 * (`support/fake-media-cli.ts`) and `ffprobe`/`ffmpeg` are scripts whose output
 * the test scripts (`installFakeFrameTools`). Process-group termination, cwd
 * confinement and spool cleanup are therefore observed, not asserted from
 * source. The real-ffmpeg size/scale checks live in
 * `locus-media-video.ffmpeg.test.ts`.
 */

import { readdirSync } from 'node:fs'
import { access, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocusMediaPort,
  type LarkCliRunner,
  type LocusMessagePart,
  type LocusMessageReadResult,
} from '../src/host/channel/media.js'
import { LOCUS_VIDEO_LIMITS } from '../src/host/channel/media-video.js'
import {
  FIXTURE_CHAT,
  FIXTURE_IDS,
  FIXTURE_KEYS,
  mgetEnvelope,
  rawApiEnvelope,
} from './fixtures/lark-message-envelopes.js'
import {
  fakeMediaCli,
  installFakeFrameTools,
  type FakeFrameConfig,
  type FakeFrameTools,
  type FakeMediaCli,
} from './support/fake-media-cli.js'

const MP4 = 'mov,mp4,m4a,3gp,3g2,mj2'
const OK_PROBE = { formatName: MP4, duration: '19.0' } as const

function attachments(imageLimits: Record<string, unknown> = {}) {
  const limits = {
    maxImageBytes: 4096,
    maxImagesPerMessage: 8,
    maxMessageImageBytes: 65_536,
    maxImagePixels: 1_000_000,
    maxImageDimension: 1_000,
    mediaTypes: ['image/png'] as const,
    ...imageLimits,
  }
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({
      attachmentId: `attachment-${String(saveImages.mock.calls.length)}-${String(index)}` as never,
      mediaType: item.mediaType,
      bytes: item.data.byteLength,
      width: 1,
      height: 1,
    })))
  return { saveImages, store: { imageLimits: limits, saveImages } as never }
}

/** A post carrying one video whose bytes the fake CLI serves by file-key substring. */
function videoMessage(fileKey: string = FIXTURE_KEYS.video, coverKey: string | null = FIXTURE_KEYS.cover) {
  const element = { tag: 'media', file_key: fileKey, ...(coverKey === null ? {} : { image_key: coverKey }) }
  return {
    raw: rawApiEnvelope({
      messageId: FIXTURE_IDS.postMedia,
      msgType: 'post',
      content: JSON.stringify({ title: '', content: [[element]] }),
    }),
    mget: mgetEnvelope({ messageId: FIXTURE_IDS.postMedia, msgType: 'post', content: `[Media: ${fileKey}]` }),
  }
}

let cli: FakeMediaCli | undefined
let tools: FakeFrameTools | undefined
afterEach(async () => {
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  if (tools !== undefined) await rm(tools.root, { recursive: true, force: true })
  cli = undefined
  tools = undefined
})

interface HarnessOptions {
  readonly fileKey?: string
  readonly coverKey?: string | null
  readonly tools?: FakeFrameConfig | 'absent'
  readonly imageLimits?: Record<string, unknown>
  readonly video?: Partial<typeof LOCUS_VIDEO_LIMITS>
  readonly timeoutMs?: number
}

async function harness(options: HarnessOptions = {}) {
  cli = await fakeMediaCli()
  tools = await installFakeFrameTools()
  const fakeCli = cli
  const fakeTools = tools
  if (options.tools !== undefined && options.tools !== 'absent') await fakeTools.configure(options.tools)
  const store = attachments(options.imageLimits)
  const message = videoMessage(options.fileKey, 'coverKey' in options ? options.coverKey : FIXTURE_KEYS.cover)
  const runner = vi.fn<LarkCliRunner>(async (_binary, args) => ({
    stdout: JSON.stringify(args.includes('+messages-mget') ? message.mget : message.raw),
  }))
  const port = createLocusMediaPort({
    attachments: store.store,
    download: { binary: fakeCli.binary, version: '1.0.97', spoolRoot: fakeCli.spool },
    runner,
    ...(options.tools === 'absent' ? {} : { frameTools: { ffmpeg: fakeTools.ffmpeg, ffprobe: fakeTools.ffprobe } }),
    ...(options.video === undefined ? {} : { video: options.video }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  const read = (signal: AbortSignal = new AbortController().signal) => port.readMessage({
    messageId: FIXTURE_IDS.postMedia,
    chatId: FIXTURE_CHAT,
    signal,
    canViewImages: async () => true,
  })
  return { read, store, cli: fakeCli, tools: fakeTools, runner }
}

function mediaOf(result: LocusMessageReadResult): readonly LocusMessagePart[] {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.reason}`)
  return result.media
}

/** Text parts verbatim; every image collapsed to a marker so order is assertable. */
function outline(parts: readonly LocusMessagePart[]): readonly string[] {
  return parts.map(part => part.type === 'text' ? part.text : 'IMAGE')
}

const imagesIn = (parts: readonly LocusMessagePart[]): number => parts.filter(part => part.type === 'image').length
const textOf = (parts: readonly LocusMessagePart[]): string => outline(parts).filter(line => line !== 'IMAGE').join('\n')

describe('video cover and scene keyframes', () => {
  it('returns cover, ordered keyframes with times and sampling note', async () => {
    const h = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1.53, 4.27] } } })
    const parts = mediaOf(await h.read())

    // Cover first, then the sampling note, then every frame preceded by its own time.
    expect(imagesIn(parts)).toBe(4)
    expect(outline(parts).indexOf('IMAGE')).toBeGreaterThanOrEqual(0)
    const lines = outline(parts)
    const firstImage = lines.indexOf('IMAGE')
    expect(lines.slice(0, firstImage).join('\n')).toContain('封面')
    const afterCover = lines.slice(firstImage + 1)
    expect(afterCover[0]).toContain('抽样')
    expect(afterCover[0]).toContain('不是完整视频')
    expect(afterCover[0]).toContain('19.0s')
    expect(afterCover[0]).toContain('3 帧')
    expect(afterCover.slice(1)).toEqual(['[t=0s]', 'IMAGE', '[t=1.53s]', 'IMAGE', '[t=4.27s]', 'IMAGE'])

    // The cover is downloaded as an image, the video as a file, in that order.
    expect(await h.cli.calls()).toEqual([
      { type: 'image', fileKey: FIXTURE_KEYS.cover, messageId: FIXTURE_IDS.postMedia },
      { type: 'file', fileKey: FIXTURE_KEYS.video, messageId: FIXTURE_IDS.postMedia },
    ])
    // Cover and frames are separate attachment batches: a frame failure can then
    // never take the cover with it, nor leave a partial set of frame refs.
    expect(h.store.saveImages.mock.calls.map(call => call[0].length)).toEqual([1, 3])

    // Both programs ran confined to the call's own directory under the spool, file protocol only, no stdin.
    const invocations = await h.tools.invocations()
    expect(invocations.map(item => item.tool)).toEqual(['ffprobe', 'ffmpeg'])
    for (const item of invocations) {
      // realpath: macOS reports /private/var for a /var temp directory.
      expect(item.cwd).toContain('/media-spool/')
      expect(item.argv).toContain('-protocol_whitelist')
      expect(item.argv[item.argv.indexOf('-protocol_whitelist') + 1]).toBe('file')
    }
    const ffmpegArgs = invocations[1]!.argv
    expect(ffmpegArgs).toContain('-nostdin')
    // Default cap 8, minus the one image the cover already used.
    expect(ffmpegArgs[ffmpegArgs.indexOf('-frames:v') + 1]).toBe('7')
    expect(ffmpegArgs[ffmpegArgs.indexOf('-vf') + 1]).toContain('scale=w=\'min(1024,iw)\':h=\'min(1024,ih)\'')
    expect(readdirSync(h.cli.spool)).toEqual([])
  })

  it('pairs showinfo pts_time to output frames without interpolation', async () => {
    // Deliberately non-uniform and not index-derived: a frame-number or even-spacing guess would differ.
    const h = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1.53, 4.27, 4.28] } } })
    const lines = outline(mediaOf(await h.read()))
    const tail = lines.slice(lines.indexOf('[t=0s]'))
    expect(tail).toEqual(['[t=0s]', 'IMAGE', '[t=1.53s]', 'IMAGE', '[t=4.27s]', 'IMAGE', '[t=4.28s]', 'IMAGE'])
    // The i-th frame handed to the store is the i-th output file (the fake stamps the index into the last byte).
    const frameBatch = h.store.saveImages.mock.calls[1]![0]
    expect(frameBatch.map(item => item.data.at(8))).toEqual([1, 2, 3, 4])
  })

  it('a single frame is not padded and says so', async () => {
    const h = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0] } } })
    const parts = mediaOf(await h.read())
    expect(imagesIn(parts)).toBe(2)
    expect(textOf(parts)).toContain('1 帧')
    expect(textOf(parts)).toContain('基本静止')
  })

  it('missing or mismatched timestamps fall back to cover', async () => {
    const modes = ['missing', 'extra-line', 'missing-line', 'unparseable', 'non-monotonic'] as const
    for (const stderr of modes) {
      const h = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1.5, 3], stderr } } })
      const parts = mediaOf(await h.read())
      expect(imagesIn(parts), stderr).toBe(1)
      expect(textOf(parts), stderr).toContain('frame-timestamps-unavailable')
      expect(textOf(parts), stderr).not.toMatch(/t=\d/)
      expect(h.store.saveImages, stderr).toHaveBeenCalledTimes(1)
      expect(readdirSync(h.cli.spool), stderr).toEqual([])
      await rm(h.cli.root, { recursive: true, force: true })
      await rm(h.tools.root, { recursive: true, force: true })
    }
    // `n:` must run 0,1,2… with no gaps either.
    const gap = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1.5, 3], nonContiguousN: true } } })
    const gapParts = mediaOf(await gap.read())
    expect(imagesIn(gapParts)).toBe(1)
    expect(textOf(gapParts)).toContain('frame-timestamps-unavailable')
  })

  it('any frame admission failure returns cover only and no refs', async () => {
    // (a) bytes that are not an image
    const notImage = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2], badFrameBytes: true } } })
    const notImageParts = mediaOf(await notImage.read())
    expect(imagesIn(notImageParts)).toBe(1)
    expect(textOf(notImageParts)).toContain('frame-admission-failed')
    expect(notImage.store.saveImages).toHaveBeenCalledTimes(1)
    await rm(notImage.cli.root, { recursive: true, force: true })
    await rm(notImage.tools.root, { recursive: true, force: true })

    // (b) a frame larger than the deployment's per-image byte limit
    const tooBig = await harness({
      tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2], frameBytes: 8000 } },
    })
    const tooBigParts = mediaOf(await tooBig.read())
    expect(imagesIn(tooBigParts)).toBe(1)
    expect(textOf(tooBigParts)).toContain('frame-admission-failed')
    await rm(tooBig.cli.root, { recursive: true, force: true })
    await rm(tooBig.tools.root, { recursive: true, force: true })

    // (c) the attachment store itself rejects the frame batch: nothing from it is returned
    const rejected = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2] } } })
    let call = 0
    rejected.store.saveImages.mockImplementation(async items => {
      call += 1
      if (call === 2) throw new Error('IMAGE_TOO_MANY_PIXELS')
      return items.map((item, index) => ({
        attachmentId: `a-${String(call)}-${String(index)}` as never, mediaType: item.mediaType, bytes: item.data.byteLength, width: 1, height: 1,
      }))
    })
    const rejectedParts = mediaOf(await rejected.read())
    expect(imagesIn(rejectedParts)).toBe(1)
    expect(textOf(rejectedParts)).toContain('frame-admission-failed')
    expect(readdirSync(rejected.cli.spool)).toEqual([])
  })

  it('frames are capped by the remaining image quota', async () => {
    // Quota 3: the cover takes one, so only 2 frames may be requested and returned.
    const h = await harness({
      imageLimits: { maxImagesPerMessage: 3 },
      tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2, 3, 4] } },
    })
    const parts = mediaOf(await h.read())
    expect(imagesIn(parts)).toBe(3)
    const ffmpegArgs = (await h.tools.invocations()).find(item => item.tool === 'ffmpeg')!.argv
    expect(ffmpegArgs[ffmpegArgs.indexOf('-frames:v') + 1]).toBe('2')

    // Quota 1: the cover uses it all, so the video is never even downloaded.
    const none = await harness({
      imageLimits: { maxImagesPerMessage: 1 },
      tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1] } },
    })
    const noneParts = mediaOf(await none.read())
    expect(imagesIn(noneParts)).toBe(1)
    expect(textOf(noneParts)).toContain('image-quota-exhausted')
    expect((await none.cli.calls()).map(item => item.type)).toEqual(['image'])
  })

  it('still frames the video when the post carries no cover', async () => {
    const h = await harness({ coverKey: null, tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 2] } } })
    const parts = mediaOf(await h.read())
    expect(imagesIn(parts)).toBe(2)
    expect(textOf(parts)).toContain('没有封面')
    expect((await h.cli.calls()).map(item => item.type)).toEqual(['file'])
  })

  it('no extractor returns cover with reason', async () => {
    const h = await harness({ tools: 'absent' })
    const parts = mediaOf(await h.read())
    expect(imagesIn(parts)).toBe(1)
    expect(textOf(parts)).toContain('frame-tools-unavailable')
    // Nothing but the cover is downloaded, and no process was started.
    expect((await h.cli.calls()).map(item => item.type)).toEqual(['image'])
    expect(await h.tools.invocations()).toEqual([])
  })

  it('oversize bytes or duration skips frames with reason', async () => {
    // Bytes: the fake serves 64 bytes for a file, the limit is 32.
    const bytes = await harness({ video: { maxBytes: 32 }, tools: { probe: OK_PROBE, ffmpeg: { frames: [0] } } })
    const byteParts = mediaOf(await bytes.read())
    expect(imagesIn(byteParts)).toBe(1)
    expect(textOf(byteParts)).toContain('video-too-large')
    expect(await bytes.tools.invocations()).toEqual([])
    await rm(bytes.cli.root, { recursive: true, force: true })
    await rm(bytes.tools.root, { recursive: true, force: true })

    // Bytes, mid-download: a never-ending writer is stopped by the measurement, not by exit.
    const growing = await harness({
      fileKey: 'file_v3_grow',
      video: { maxBytes: 4096 },
      timeoutMs: 10_000,
      tools: { probe: OK_PROBE, ffmpeg: { frames: [0] } },
    })
    const started = Date.now()
    const growParts = mediaOf(await growing.read())
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(textOf(growParts)).toContain('video-too-large')
    expect(readdirSync(growing.cli.spool)).toEqual([])
    await rm(growing.cli.root, { recursive: true, force: true })
    await rm(growing.tools.root, { recursive: true, force: true })

    // Duration: the container says 301 s, the limit is 300 s: ffmpeg never runs.
    const long = await harness({ tools: { probe: { formatName: MP4, duration: '301.0' }, ffmpeg: { frames: [0] } } })
    const longParts = mediaOf(await long.read())
    expect(imagesIn(longParts)).toBe(1)
    expect(textOf(longParts)).toContain('video-too-long')
    expect((await long.tools.invocations()).map(item => item.tool)).toEqual(['ffprobe'])
    await rm(long.cli.root, { recursive: true, force: true })
    await rm(long.tools.root, { recursive: true, force: true })

    // Container outside the allow-list, and an unreadable probe, are not framed either.
    const avi = await harness({ tools: { probe: { formatName: 'avi', duration: '3.0' }, ffmpeg: { frames: [0] } } })
    expect(textOf(mediaOf(await avi.read()))).toContain('video-format-unsupported')
    expect((await avi.tools.invocations()).map(item => item.tool)).toEqual(['ffprobe'])
    await rm(avi.cli.root, { recursive: true, force: true })
    await rm(avi.tools.root, { recursive: true, force: true })
    for (const probe of [{ garbage: true }, { fail: true }] as const) {
      const bad = await harness({ tools: { probe, ffmpeg: { frames: [0] } } })
      expect(textOf(mediaOf(await bad.read()))).toContain('video-probe-failed')
      await rm(bad.cli.root, { recursive: true, force: true })
      await rm(bad.tools.root, { recursive: true, force: true })
    }
  })

  it('extractor timeout kills group and returns cover', async () => {
    const h = await harness({
      video: { toolTimeoutMs: 250 },
      tools: { probe: OK_PROBE, ffmpeg: { frames: [0], hang: true } },
    })
    const parts = mediaOf(await h.read())
    expect(imagesIn(parts)).toBe(1)
    expect(textOf(parts)).toContain('frame-extraction-timeout')
    // The hung program forked a delayed writer; killing the group must have stopped it.
    await delay(2000)
    await expect(access(h.tools.escaped)).rejects.toBeDefined()
    expect(readdirSync(h.cli.spool)).toEqual([])

    // A hung ffprobe is bounded by the same budget.
    const probeHang = await harness({
      video: { toolTimeoutMs: 250 },
      tools: { probe: { hang: true }, ffmpeg: { frames: [0] } },
    })
    const probeParts = mediaOf(await probeHang.read())
    expect(textOf(probeParts)).toContain('frame-extraction-timeout')
    await delay(2000)
    await expect(access(probeHang.tools.escaped)).rejects.toBeDefined()
    expect(readdirSync(probeHang.cli.spool)).toEqual([])
  })

  it('kills downloader or frame extractor on abort/timeout/nonzero and leaves nothing', async () => {
    // Abort while the DOWNLOAD hangs.
    const download = await harness({ fileKey: 'file_v3_hang', tools: { probe: OK_PROBE, ffmpeg: { frames: [0] } }, timeoutMs: 10_000 })
    const downloadAbort = new AbortController()
    const pendingDownload = download.read(downloadAbort.signal)
    for (let index = 0; index < 200 && !readdirSync(download.cli.spool).some(Boolean); index += 1) await delay(10)
    // Let the fake CLI write its partial file and fork its delayed child.
    await delay(100)
    downloadAbort.abort()
    expect(await pendingDownload).toEqual({ kind: 'failed', reason: 'aborted' })
    await delay(2000)
    await expect(access(download.cli.escaped)).rejects.toBeDefined()
    expect(readdirSync(download.cli.spool)).toEqual([])
    expect(download.store.saveImages).not.toHaveBeenCalled()
    await rm(download.cli.root, { recursive: true, force: true })
    await rm(download.tools.root, { recursive: true, force: true })

    // Abort while the FRAME EXTRACTOR hangs.
    const extractor = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0], hang: true } } })
    const extractorAbort = new AbortController()
    const pendingExtractor = extractor.read(extractorAbort.signal)
    for (let index = 0; index < 300; index += 1) {
      if ((await extractor.tools.invocations()).some(item => item.tool === 'ffmpeg')) break
      await delay(10)
    }
    await delay(100)
    extractorAbort.abort()
    expect(await pendingExtractor).toEqual({ kind: 'failed', reason: 'aborted' })
    await delay(2000)
    await expect(access(extractor.tools.escaped)).rejects.toBeDefined()
    expect(readdirSync(extractor.cli.spool)).toEqual([])
    expect(extractor.store.saveImages).not.toHaveBeenCalled()
    await rm(extractor.cli.root, { recursive: true, force: true })
    await rm(extractor.tools.root, { recursive: true, force: true })

    // Download timeout (the CLI hangs): cover only.
    const slow = await harness({ fileKey: 'file_v3_hang', timeoutMs: 400, tools: { probe: OK_PROBE, ffmpeg: { frames: [0] } } })
    const slowParts = mediaOf(await slow.read())
    expect(imagesIn(slowParts)).toBe(1)
    expect(textOf(slowParts)).toContain('video-download-timeout')
    await delay(2000)
    await expect(access(slow.cli.escaped)).rejects.toBeDefined()
    expect(readdirSync(slow.cli.spool)).toEqual([])
    await rm(slow.cli.root, { recursive: true, force: true })
    await rm(slow.tools.root, { recursive: true, force: true })

    // Non-zero exits: the downloader, then the frame extractor.
    const downloadFails = await harness({ fileKey: 'file_v3_exit', tools: { probe: OK_PROBE, ffmpeg: { frames: [0] } } })
    const failParts = mediaOf(await downloadFails.read())
    expect(imagesIn(failParts)).toBe(1)
    expect(textOf(failParts)).toContain('video-download-failed')
    expect(readdirSync(downloadFails.cli.spool)).toEqual([])
    await rm(downloadFails.cli.root, { recursive: true, force: true })
    await rm(downloadFails.tools.root, { recursive: true, force: true })

    const extractorFails = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1], exit: 1 } } })
    const extractorFailParts = mediaOf(await extractorFails.read())
    expect(imagesIn(extractorFailParts)).toBe(1)
    expect(textOf(extractorFailParts)).toContain('frame-extraction-failed')
    expect(readdirSync(extractorFails.cli.spool)).toEqual([])
  })

  it('leaves no video or frame files after readMessage returns', async () => {
    const h = await harness({ tools: { probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2], frameBytes: 100 } } })
    const parts = mediaOf(await h.read())
    expect(imagesIn(parts)).toBe(4)
    expect(readdirSync(h.cli.spool)).toEqual([])
    // The frames the model received exist only as attachment refs (the fake store kept the bytes in memory).
    expect(h.store.saveImages.mock.calls[1]![0]).toHaveLength(3)
  })
})
