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
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocusMediaPort,
  type LarkCliRunner,
  type LocusMessagePart,
} from '../src/host/channel/media.js'
import {
  extractSecondFrames,
  LOCUS_VIDEO_LIMITS,
  type ExtractSecondFramesInput,
  type SecondFrame,
  type SecondFrameExtraction,
} from '../src/host/channel/media-video.js'
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
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true })
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
  return { store, cli: fakeCli, tools: fakeTools, runner, port }
}

/** One paged read of the video post through the harness port. */
function readPage(port: ReturnType<typeof createLocusMediaPort>) {
  return port.readMessagePage({
    messageId: FIXTURE_IDS.postMedia,
    chatId: FIXTURE_CHAT,
    caller: "caller-video",
    signal: new AbortController().signal,
    canViewImages: async () => true,
  })
}

/** Whole seconds `start` .. `start + count - 1`, one scripted frame each. */
function seconds(count: number, start = 0): number[] {
  return Array.from({ length: count }, (_, index) => start + index)
}

/** Directories a scripted test created; removed after every test. */
const scratch: string[] = []

/** Overrides of one scripted `extractSecondFrames` window. */
interface WindowOverrides {
  readonly fromSecond?: number
  readonly maxFrames?: number
  readonly maxFrameBytes?: number
  readonly limits?: Partial<typeof LOCUS_VIDEO_LIMITS>
}

/**
 * Run `extractSecondFrames` over a scripted window: the fake ffprobe/ffmpeg are
 * configured by `config`, and the source file is a placeholder the probe reads.
 */
async function window(config: FakeFrameConfig, overrides: WindowOverrides = {}, signal?: AbortSignal) {
  tools = await installFakeFrameTools()
  const fake = tools
  await fake.configure(config)
  const dir = await mkdtemp(join(tmpdir(), "video-window-"))
  await writeFile(join(dir, "video.mp4"), new Uint8Array(16))
  const input: ExtractSecondFramesInput = {
    tools: { ffmpeg: fake.ffmpeg, ffprobe: fake.ffprobe, binary: fake.ffmpeg, version: "fake" } as never,
    dir,
    fileName: "video.mp4",
    fromSecond: overrides.fromSecond ?? 0,
    maxFrames: overrides.maxFrames ?? 8,
    maxFrameBytes: overrides.maxFrameBytes ?? 4096,
    signal: signal ?? new AbortController().signal,
    ...(overrides.limits === undefined ? {} : { limits: overrides.limits }),
  }
  const result: SecondFrameExtraction = await extractSecondFrames(input)
  return { result, fake, dir }
}

function framesOf(result: SecondFrameExtraction): readonly SecondFrame[] {
  if (result.kind !== "frames") throw new Error(`expected frames, got ${result.reason}`)
  return result.frames
}

function failedOf(frames: readonly SecondFrame[]): Extract<SecondFrame, { failed: unknown }>[] {
  return frames.filter((frame): frame is Extract<SecondFrame, { failed: unknown }> => "failed" in frame)
}

function delivered(frames: readonly SecondFrame[]): Extract<SecondFrame, { data: Uint8Array }>[] {
  return frames.filter((frame): frame is Extract<SecondFrame, { data: Uint8Array }> => "data" in frame)
}

describe('extractSecondFrames (scripted tools)', () => {
  it('pairs each frame with its own showinfo time', async () => {
    const { result } = await window({ probe: OK_PROBE, ffmpeg: { frames: [0, 0.53, 1.27] } })
    const frames = framesOf(result)
    expect(frames.map(frame => frame.timeSeconds)).toEqual([0, 0.53, 1.27])
    expect(frames.map(frame => frame.k)).toEqual([0, 0, 1])
    // The i-th slot carries the i-th output file (the fake stamps the 1-based index into the last byte).
    expect(delivered(frames).map(frame => 'data' in frame ? frame.data.at(8) : -1)).toEqual([1, 2, 3])
    expect(result).toMatchObject({ durationSeconds: 19, nextK: 2, complete: true })
  })

  it('subtracts the stream start_time and reads 1 ms below zero as 0', async () => {
    const { result } = await window({
      probe: { formatName: MP4, duration: '21.0', startTime: '2.000000' },
      ffmpeg: { frames: [1.9995, 3.04, 4.5] },
    })
    const frames = framesOf(result)
    expect(frames.map(frame => frame.timeSeconds)).toEqual([0, 1.04, 2.5])
    expect(frames.map(frame => frame.k)).toEqual([0, 1, 2])

    // More than 1 ms before the stream starts cannot be a real frame time: nothing is invented.
    const early = await window({
      probe: { formatName: MP4, duration: '21.0', startTime: '2.000000' },
      ffmpeg: { frames: [1.9, 3] },
    })
    expect(early.result).toMatchObject({ kind: 'skipped', reason: 'frame-timestamps-unavailable' })
  })

  it('asks for one select over the source timeline, seeking to k-1, without scene or fps', async () => {
    const deep = await window({ probe: OK_PROBE, ffmpeg: { frames: [8, 9] } }, { fromSecond: 8 })
    const argv = (await deep.fake.invocations()).find(item => item.tool === 'ffmpeg')!.argv
    const seek = argv.indexOf('-ss')
    expect(argv[seek + 1]).toBe('7')
    expect(seek).toBeLessThan(argv.indexOf('-i'))
    expect(argv).toContain('-copyts')
    expect(argv[argv.indexOf('-frames:v') + 1]).toBe('8')
    expect(argv.at(-1)).toBe('./f_%06d.jpg')
    const filter = argv[argv.indexOf('-vf') + 1]!
    expect(filter.match(/select=/g)).toHaveLength(1)
    expect(filter).toContain('prev_selected_t')
    expect(filter).toContain('floor(')
    expect(filter).not.toContain('scene')
    expect(filter).not.toContain('fps=')
    expect(filter).toContain('scale=w=\'min(1024,iw)\':h=\'min(1024,ih)\'')
    // showinfo is last so `n` counts selected frames.
    expect(filter.endsWith(',showinfo')).toBe(true)

    // k = 0 and k = 1 need no seek (nothing precedes the pre-roll second).
    for (const fromSecond of [0, 1]) {
      const near = await window({ probe: OK_PROBE, ffmpeg: { frames: [fromSecond] } }, { fromSecond })
      const nearArgv = (await near.fake.invocations()).find(item => item.tool === 'ffmpeg')!.argv
      expect(nearArgv, `k=${String(fromSecond)}`).not.toContain('-ss')
    }
    // The stream start_time is baked into the select expression, so the window is on the normalised axis.
    const offset = await window(
      { probe: { formatName: MP4, duration: '21.0', startTime: '2.000000' }, ffmpeg: { frames: [5] } },
      { fromSecond: 3 },
    )
    const offsetFilter = (await offset.fake.invocations()).find(item => item.tool === 'ffmpeg')!.argv
    expect(offsetFilter[offsetFilter.indexOf('-vf') + 1]).toContain('t-(2)')
  })

  it('does not stop at a duration or a size: a 20 minute video is framed', async () => {
    const { result, fake } = await window({ probe: { formatName: MP4, duration: '1200.0' }, ffmpeg: { frames: [600, 601] } }, { fromSecond: 600 })
    expect(result).toMatchObject({ kind: 'frames', durationSeconds: 1200, complete: true })
    expect((await fake.invocations()).map(item => item.tool)).toEqual(['ffprobe', 'ffmpeg'])
  })

  it('file without record voids the window with frame-timestamps-unavailable and invents nothing', async () => {
    for (const stderr of ['missing', 'missing-line', 'unparseable', 'non-monotonic'] as const) {
      const { result, dir } = await window({ probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2], stderr } })
      expect(result, stderr).toEqual({ kind: 'skipped', reason: 'frame-timestamps-unavailable', durationSeconds: 19 })
      expect(dir).toBeTruthy()
    }
    // `n:` must run 0,1,2… with no gaps either.
    const gap = await window({ probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2], nonContiguousN: true } })
    expect(gap.result).toMatchObject({ kind: 'skipped', reason: 'frame-timestamps-unavailable' })
  })

  it('normal exit with a missing middle file fails only that slot (frame-file-missing, recorded time)', async () => {
    const { result } = await window(
      { probe: OK_PROBE, ffmpeg: { frames: seconds(10), missingFiles: [5], emptyFiles: [7] } },
      { maxFrames: 10 },
    )
    const frames = framesOf(result)
    expect(frames).toHaveLength(10)
    expect(failedOf(frames)).toEqual([
      { k: 5, timeSeconds: 5, failed: 'frame-file-missing' },
      { k: 7, timeSeconds: 7, failed: 'frame-file-missing' },
    ])
    expect(delivered(frames).map(frame => frame.k)).toEqual([0, 1, 2, 3, 4, 6, 8, 9])
    expect(result).toMatchObject({ nextK: 10 })

    // A record past the last file (an extra line) is a missing slot, not a void window.
    const extra = await window({ probe: OK_PROBE, ffmpeg: { frames: [0, 1, 2], stderr: 'extra-line' } })
    const extraFrames = framesOf(extra.result)
    expect(delivered(extraFrames)).toHaveLength(3)
    expect(failedOf(extraFrames)).toEqual([{ k: 2, timeSeconds: 2, failed: 'frame-file-missing' }])
  })

  it('one frame failing admission fails only its slot with its recorded time', async () => {
    // Slot 5 is over the per-frame byte ceiling; the other seven are fine.
    const { result } = await window({ probe: OK_PROBE, ffmpeg: { frames: seconds(8), bigFrames: [5] } })
    const frames = framesOf(result)
    expect(delivered(frames).map(frame => frame.k)).toEqual([0, 1, 2, 3, 4, 6, 7])
    expect(failedOf(frames)).toEqual([{ k: 5, timeSeconds: 5, failed: 'frame-admission-failed' }])
  })

  it('one frame save failing leaves 7 frames, one failure, and the next page continues after the last processed second', async () => {
    const first = await window({ probe: OK_PROBE, ffmpeg: { frames: seconds(8), emptyFiles: [5] } })
    const frames = framesOf(first.result)
    expect(delivered(frames)).toHaveLength(7)
    expect(failedOf(frames)).toEqual([{ k: 5, timeSeconds: 5, failed: 'frame-file-missing' }])
    // The failed slot advances k like a delivered one, so it is never selected again.
    expect(first.result).toMatchObject({ nextK: 8, complete: false })
    const second = await window({ probe: OK_PROBE, ffmpeg: { frames: seconds(3, 8) } }, { fromSecond: 8 })
    expect(framesOf(second.result).map(frame => frame.k)).toEqual([8, 9, 10])
    expect(second.result).toMatchObject({ nextK: 11 })
    // A failed LAST slot still advances k past its second.
    const lastFails = await window({ probe: OK_PROBE, ffmpeg: { frames: seconds(8), missingFiles: [7] } })
    expect(lastFails.result).toMatchObject({ nextK: 8 })
  })

  it('kill keeps the verified prefix; the largest existing file and later slots are reselected next page', async () => {
    // Records reached 6 (seven lines), only six files exist; the sixth may be truncated.
    const { result, fake } = await window(
      { probe: OK_PROBE, ffmpeg: { frames: seconds(10), hangAfter: { records: 7, files: 6 } } },
      { limits: { decodeWindowMs: 2500 } },
    )
    const frames = framesOf(result)
    expect(frames.map(frame => frame.k)).toEqual([0, 1, 2, 3, 4])
    expect(delivered(frames)).toHaveLength(5)
    expect(result).toMatchObject({ complete: false, nextK: 5 })
    // (Group termination is proven by the pure-hang case below: here the fake's delayed child may legitimately
    // fire before a window long enough for a loaded machine to start node.)
    expect((await fake.invocations()).map(item => item.tool)).toEqual(['ffprobe', 'ffmpeg'])

    // Empty verified prefix: only one file exists, and that largest file is never trusted.
    const empty = await window(
      { probe: OK_PROBE, ffmpeg: { frames: seconds(10), hangAfter: { records: 2, files: 1 } } },
      { limits: { decodeWindowMs: 2500 } },
    )
    expect(empty.result).toEqual({ kind: 'skipped', reason: 'frame-extraction-timeout', durationSeconds: 19 })
    const hung = await window({ probe: OK_PROBE, ffmpeg: { frames: [0], hang: true } }, { limits: { decodeWindowMs: 300 } })
    expect(hung.result).toMatchObject({ kind: 'skipped', reason: 'frame-extraction-timeout' })
    await delay(2000)
    await expect(access(hung.fake.escaped)).rejects.toBeDefined()
  })

  it('a file without a record also voids a killed window', async () => {
    const { result } = await window(
      { probe: OK_PROBE, ffmpeg: { frames: seconds(10), hangAfter: { records: 2, files: 5 } } },
      { limits: { decodeWindowMs: 2500 } },
    )
    expect(result).toMatchObject({ kind: 'skipped', reason: 'frame-timestamps-unavailable' })
  })

  it('150 frames pair correctly by recorded n with six-digit names', async () => {
    const { result } = await window({ probe: { formatName: MP4, duration: '150.0' }, ffmpeg: { frames: seconds(150) } }, { maxFrames: 150 })
    const frames = framesOf(result)
    expect(frames).toHaveLength(150)
    expect(frames.map(frame => frame.k)).toEqual(seconds(150))
    for (const [index, frame] of frames.entries()) {
      expect(frame.timeSeconds).toBe(index)
      // The fake stamps `(slot + 1) & 0xff`: slots 99 and 100 (the 100th and 101st files) pair with times 99 and 100.
      expect('data' in frame ? frame.data.at(8) : -1, `slot ${String(index)}`).toBe((index + 1) & 0xff)
    }
    expect(result).toMatchObject({ nextK: 150, complete: true })
  })

  it('complete says whether anything is left after nextK', async () => {
    const more = await window({ probe: OK_PROBE, ffmpeg: { frames: seconds(8) } })
    expect(more.result).toMatchObject({ nextK: 8, complete: false })
    const exact = await window({ probe: { formatName: MP4, duration: '8.0' }, ffmpeg: { frames: seconds(8) } })
    expect(exact.result).toMatchObject({ nextK: 8, complete: true })
    const fewer = await window({ probe: OK_PROBE, ffmpeg: { frames: seconds(3, 16) } }, { fromSecond: 16 })
    expect(fewer.result).toMatchObject({ nextK: 19, complete: true })
  })

  it('seeking past the last frame is an empty complete window; at k = 0 the same output is a failure', async () => {
    const past = await window({ probe: OK_PROBE, ffmpeg: { frames: [], noPackets: true } }, { fromSecond: 25 })
    expect(past.result).toEqual({ kind: 'frames', durationSeconds: 19, frames: [], nextK: 25, complete: true })
    const start = await window({ probe: OK_PROBE, ffmpeg: { frames: [], noPackets: true } })
    expect(start.result).toMatchObject({ kind: 'skipped', reason: 'frame-extraction-failed' })
    const nonZero = await window({ probe: OK_PROBE, ffmpeg: { frames: [0, 1], exit: 1 } }, { fromSecond: 3 })
    expect(nonZero.result).toMatchObject({ kind: 'skipped', reason: 'frame-extraction-failed' })
  })

  it('probe failures, unsupported containers, abort and bad arguments never run a decode', async () => {
    const avi = await window({ probe: { formatName: 'avi', duration: '3.0' }, ffmpeg: { frames: [0] } })
    expect(avi.result).toEqual({ kind: 'skipped', reason: 'video-format-unsupported', durationSeconds: 3 })
    expect((await avi.fake.invocations()).map(item => item.tool)).toEqual(['ffprobe'])
    for (const probe of [{ garbage: true }, { fail: true }] as const) {
      const bad = await window({ probe, ffmpeg: { frames: [0] } })
      expect(bad.result).toMatchObject({ kind: 'skipped', reason: 'video-probe-failed' })
    }
    const probeHang = await window({ probe: { hang: true }, ffmpeg: { frames: [0] } }, { limits: { probeTimeoutMs: 250 } })
    expect(probeHang.result).toMatchObject({ kind: 'skipped', reason: 'frame-extraction-timeout' })
    await delay(2000)
    await expect(access(probeHang.fake.escaped)).rejects.toBeDefined()

    for (const bad of [{ fromSecond: -1 }, { fromSecond: 1.5 }, { maxFrames: 0 }, { maxFrames: 2.5 }]) {
      const rejected = await window({ probe: OK_PROBE, ffmpeg: { frames: [0] } }, bad)
      expect(rejected.result, JSON.stringify(bad)).toMatchObject({ kind: 'skipped', reason: 'frame-extraction-failed' })
      expect(await rejected.fake.invocations()).toEqual([])
    }

    const aborted = new AbortController()
    aborted.abort()
    const early = await window({ probe: OK_PROBE, ffmpeg: { frames: [0] } }, {}, aborted.signal)
    expect(early.result).toMatchObject({ kind: 'skipped', reason: 'aborted' })
  })

  it('abort while the decode hangs kills the group and returns aborted', async () => {
    const fake = await installFakeFrameTools()
    await fake.configure({ probe: OK_PROBE, ffmpeg: { frames: [0], hang: true } })
    const dir = await mkdtemp(join(tmpdir(), 'dsh-pet-seconds-'))
    scratch.push(fake.root, dir)
    const controller = new AbortController()
    const pending = extractSecondFrames({
      tools: { ffmpeg: fake.ffmpeg, ffprobe: fake.ffprobe }, dir, fileName: 'in.mp4',
      fromSecond: 0, maxFrames: 8, maxFrameBytes: 4096, signal: controller.signal,
    })
    for (let index = 0; index < 300; index += 1) {
      if ((await fake.invocations()).some(item => item.tool === 'ffmpeg')) break
      await delay(10)
    }
    await delay(100)
    controller.abort()
    expect(await pending).toMatchObject({ kind: 'skipped', reason: 'aborted' })
    await delay(2000)
    await expect(access(fake.escaped)).rejects.toBeDefined()
  })
})

describe("video units: frame tools absent and a timeout after a verified prefix (test-plan R6, R17, R25)", () => {
  it("without frame tools only the cover is returned, with the reason, and nothing is framed", async () => {
    const h = await harness({ tools: "absent" })
    const page = await readPage(h.port)
    if (page.kind !== "ok") throw new Error(`expected ok, got ${page.reason}`)
    const notes = page.parts.flatMap(part => (part.type === "text" ? [part.text] : [])).join("\n")
    expect(notes).toContain("frame-tools-unavailable")
    expect(page.parts.filter(part => part.type === "image")).toHaveLength(1)
    expect(page.complete).toBe(true)
    expect(readdirSync(h.cli.spool)).toEqual([])
  })

  it("a decode timeout after a verified prefix keeps the verified frames and issues a cursor on the video", async () => {
    // Seven records and six files are written, then the process hangs; the 1.5 s decode window expires after the prefix.
    const h = await harness({
      tools: { ffmpeg: { frames: seconds(10), hangAfter: { records: 7, files: 6 } }, probe: OK_PROBE },
      video: { decodeWindowMs: 1500 },
    })
    const page = await readPage(h.port)
    if (page.kind !== "ok") throw new Error(`expected ok, got ${page.reason}`)
    expect(page.parts.filter(part => part.type === "image").length).toBeGreaterThan(0)
    expect(page.cursor).toEqual(expect.any(String))
    expect(readdirSync(h.cli.spool)).toEqual([])
  })
})
