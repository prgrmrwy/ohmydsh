/**
 * Real `ffmpeg`/`ffprobe` against generated videos.
 *
 * The scripted-process tests prove the Host's handling of what the tools print;
 * only a real run proves the filtergraph itself: that `scale` bounds the LONGEST
 * edge (a width-only scale fails portrait video), that one `select` really picks
 * the first frame of every whole second, that the input seek with `-copyts`
 * keeps the source timeline, that `showinfo` emits `pts_time` at the log level
 * Pet asks for, and that those times pair with the output files. Skipped, with
 * the reason printed, on a machine without both programs; the verify step must
 * run it where they exist.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  extractSecondFrames,
  LOCUS_VIDEO_LIMITS,
  resolveFrameTools,
  type FrameTools,
  type SecondFrame,
  type SecondFrameExtraction,
} from '../src/host/channel/media-video.js'

const run = promisify(execFile)
const tools: FrameTools | undefined = await resolveFrameTools()
if (tools === undefined) console.warn('[skip] locus-media-video.ffmpeg: ffmpeg/ffprobe not found on PATH')

let root = ''

async function frameSize(path: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run(tools!.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', path])
  const stream = (JSON.parse(stdout) as { streams: { width: number; height: number }[] }).streams[0]!
  return { width: stream.width, height: stream.height }
}

/** Generate a clip with `ffmpeg` (extra input/output args by the caller) in its own directory. */
async function generate(name: string, input: readonly string[], output: readonly string[] = [], fileName = 'in.mp4') {
  const dir = join(root, name)
  await mkdir(dir)
  await run(tools!.ffmpeg, ['-v', 'error', ...input, ...output, '-pix_fmt', 'yuv420p', '-y', join(dir, fileName)])
  return { dir, fileName }
}

type Window = { dir: string; fileName: string }
function extract(window: Window, fromSecond: number, maxFrames = 8, maxFrameBytes = 10 * 1024 * 1024): Promise<SecondFrameExtraction> {
  return extractSecondFrames({
    tools: tools!, dir: window.dir, fileName: window.fileName, fromSecond, maxFrames, maxFrameBytes,
    signal: new AbortController().signal,
  })
}

function delivered(result: SecondFrameExtraction): Extract<SecondFrame, { data: Uint8Array }>[] {
  if (result.kind !== 'frames') throw new Error(`expected frames, got ${result.reason}`)
  return result.frames.filter((frame): frame is Extract<SecondFrame, { data: Uint8Array }> => 'data' in frame)
}

/** Read every page of a video the way the Host does: each page starts at the previous `nextK`. */
async function readAllPages(window: Window, maxFrames = 8): Promise<{ pages: SecondFrame[][]; durationSeconds: number }> {
  const pages: SecondFrame[][] = []
  let k = 0
  let durationSeconds = 0
  for (let guard = 0; guard < 200; guard += 1) {
    const result = await extract(window, k, maxFrames)
    if (result.kind !== 'frames') throw new Error(`page ${String(pages.length)} skipped: ${result.reason}`)
    durationSeconds = result.durationSeconds
    if (result.frames.length > 0) pages.push([...result.frames])
    expect(result.nextK, 'k only moves forward').toBeGreaterThanOrEqual(k)
    k = result.nextK
    if (result.complete) return { pages, durationSeconds }
  }
  throw new Error('did not terminate')
}

describe.skipIf(tools === undefined)('whole-second frames from real video', () => {
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-pet-ffmpeg-it-')) })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('output frame sizes for landscape, portrait, narrow and small sources', async () => {
    const cases = [
      { name: 'landscape', size: '1920x1080', expected: { width: 1024, height: 576 } },
      { name: 'portrait', size: '1080x1920', expected: { width: 576, height: 1024 } },
      { name: 'narrow', size: '200x3000', expected: { width: 68, height: 1024 } },
      { name: 'small', size: '640x360', expected: { width: 640, height: 360 } },
    ] as const
    for (const item of cases) {
      const clip = await generate(item.name, ['-f', 'lavfi', '-i', `testsrc=size=${item.size}:rate=10:duration=2`])
      const result = await extract(clip, 0)
      expect(result.kind, item.name).toBe('frames')
      const frames = delivered(result)
      expect(frames.length, item.name).toBeGreaterThanOrEqual(1)
      const files = readdirSync(clip.dir).filter(file => file.startsWith('f_')).sort()
      expect(files.length).toBe(frames.length)
      for (const file of files) {
        expect(file, 'six-digit names').toMatch(/^f_\d{6}\.jpg$/)
        const actual = await frameSize(join(clip.dir, file))
        expect(actual, `${item.name} ${file}`).toEqual(item.expected)
        expect(actual.width % 2).toBe(0)
        expect(actual.height % 2).toBe(0)
        expect(Math.max(actual.width, actual.height)).toBeLessThanOrEqual(LOCUS_VIDEO_LIMITS.maxEdge)
      }
      // Frames are JPEG by magic bytes, whatever the extension says.
      for (const frame of frames) expect([...frame.data.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    }
  })

  it('19 s static fixture: time set exactly {0..18}', async () => {
    const clip = await generate('static19', ['-f', 'lavfi', '-i', 'color=c=gray:size=320x240:rate=30:duration=19'])
    const { pages, durationSeconds } = await readAllPages(clip)
    expect(durationSeconds).toBeCloseTo(19, 1)
    const times = pages.flat().map(frame => frame.timeSeconds)
    expect(times).toEqual(Array.from({ length: 19 }, (_, index) => index))
  })

  it('19 s with 8 frames per page reads 8, 8, 3 with strictly increasing times and no gap', async () => {
    const clip = await generate('paged19', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=19'], ['-g', '100'])
    const { pages } = await readAllPages(clip, 8)
    expect(pages.map(page => page.length)).toEqual([8, 8, 3])
    expect(pages[1]![0]!.k, 'the second page starts where the first ended').toBe(8)
    expect(pages[2]![0]!.k).toBe(16)
    const times = pages.flat().map(frame => frame.timeSeconds)
    expect(times).toEqual(Array.from({ length: 19 }, (_, index) => index))
    for (let index = 1; index < times.length; index += 1) expect(times[index]!).toBeGreaterThan(times[index - 1]!)
  })

  it('start_time 2.0 and VFR give one frame per whole second, no duplicated source frame', async () => {
    // 30 fps source with irregular frame gaps (frames n where n % 7 >= 4 are dropped), shifted by 2 s
    // so the stream's start_time is 2.0: the normalised times must still be 0, 1, 2 … plus the VFR gap.
    const kept = (n: number): boolean => n % 7 < 4
    const clip = await generate(
      'vfr-offset',
      ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=8'],
      ['-vf', 'select=lt(mod(n\\,7)\\,4)', '-fps_mode', 'vfr', '-output_ts_offset', '2', '-g', '60'],
      'in.mkv',
    )
    const { stdout } = await run(tools!.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', join(clip.dir, clip.fileName)])
    expect(Number(stdout.trim())).toBeCloseTo(2, 3)

    // Oracle: for every whole second s, the first kept source frame at or after s (n / 30).
    const expected = Array.from({ length: 8 }, (_, second) => {
      let n = second * 30
      while (!kept(n)) n += 1
      return n / 30
    })
    const { pages } = await readAllPages(clip, 5)
    const frames = pages.flat()
    expect(frames).toHaveLength(8)
    expect(frames.map(frame => frame.k)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    frames.forEach((frame, index) => expect(frame.timeSeconds, `second ${String(index)}`).toBeCloseTo(expected[index]!, 3))
    expect(new Set(frames.map(frame => frame.timeSeconds)).size, 'no source frame is selected twice').toBe(frames.length)

    // A deep window keeps the normalised axis: from second 5 on, the same frames as the full read.
    const deep = await extract(clip, 5, 8)
    expect(deep.kind).toBe('frames')
    expect(delivered(deep).map(frame => frame.k)).toEqual([5, 6, 7])
    delivered(deep).forEach((frame, index) => expect(frame.timeSeconds).toBeCloseTo(expected[5 + index]!, 3))
  })

  /** Black 320x240 clip with white full-frame flashes of 0.2 s starting at each given time. */
  function flashClip(name: string, duration: number, flashes: readonly number[]) {
    const enable = flashes.map(start => `between(t\\,${String(start)}\\,${String(start + 0.2)})`).join('+')
    return generate(
      name,
      ['-f', 'lavfi', '-i', `color=c=black:size=320x240:rate=30:duration=${String(duration)}`],
      ['-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${enable}'`, '-g', '60'],
    )
  }

  it('a 0.2 s flash at 1.5 s yields a frame between 1 s and 2 s with its showinfo time', async () => {
    const clip = await flashClip('flash', 4, [1.5])
    const { pages } = await readAllPages(clip)
    const times = pages.flat().map(frame => frame.timeSeconds)
    // Whole-second frames are all still there …
    for (const second of [0, 1, 2, 3]) expect(times, `second ${String(second)}`).toContain(second)
    // … and the sub-second change is no longer missed: a frame between 1 and 2 s that is not the whole-second one.
    const between = times.filter(time => time > 1 && time < 2)
    expect(between.length).toBeGreaterThanOrEqual(1)
    expect(between.some(time => Math.abs(time - 1.5) < 0.1)).toBe(true)
    for (const frame of pages.flat()) expect(frame.k).toBe(Math.floor(frame.timeSeconds + 0.001))
  })

  /**
   * Page through a video the way the Host does (each page starts at the previous `nextK`) and return what was
   * delivered. `finished` is true only when a page reported `complete` — a runaway cursor must not pass silently.
   */
  async function readPaged(clip: Window, quota: number): Promise<{ times: number[]; pages: number; finished: boolean; failed: number }> {
    const times: number[] = []
    let failed = 0
    let k = 0
    let pages = 0
    let finished = false
    for (let guard = 0; guard < 100; guard += 1) {
      const result = await extract(clip, k, quota)
      if (result.kind !== 'frames') throw new Error(`skipped: ${result.reason}`)
      pages += 1
      expect(result.frames.filter(frame => 'data' in frame).length, 'a page never exceeds the quota').toBeLessThanOrEqual(quota)
      for (const frame of result.frames) {
        expect(frame.k, 'a frame belongs to this page window').toBeGreaterThanOrEqual(k)
        expect(frame.k, 'and ends before the next cursor').toBeLessThan(Math.max(result.nextK, k + 1))
        if ('data' in frame) times.push(frame.timeSeconds)
        else failed += 1
      }
      if (!result.complete) expect(result.nextK, 'k strictly increases').toBeGreaterThan(k)
      k = Math.max(result.nextK, k)
      if (result.complete) { finished = true; break }
    }
    return { times, pages, finished, failed }
  }

  it('paging a video with sub-second changes: k strictly increases and the concatenated pages equal one whole read', async () => {
    const clip = await flashClip('flashes', 12, [1.5, 3.2, 3.6, 6.4, 9.1])
    const whole = await extract(clip, 0, 200)
    expect(whole.kind).toBe('frames')
    const wholeTimes = delivered(whole).map(frame => frame.timeSeconds)
    expect(wholeTimes.length, 'whole seconds plus scene frames').toBeGreaterThan(12)

    // The busiest second (3 s: 3.0, 3.2, 3.43, 3.6, 3.83) fits both quotas, so nothing may be lost.
    for (const quota of [5, 7]) {
      const { times, pages, finished } = await readPaged(clip, quota)
      expect(finished, `quota ${String(quota)}: paging terminated with complete`).toBe(true)
      expect(pages, `quota ${String(quota)} needs several pages`).toBeGreaterThan(2)
      expect(times, `quota ${String(quota)}: pages joined equal one whole read`).toEqual(wholeTimes)
      expect(new Set(times).size, 'no frame twice').toBe(times.length)
    }
  })

  /** Gray levels whose successive jumps all differ by more than the 0.08 scene threshold (about 20 of 255 levels). */
  const SCENE_LEVELS = [20, 230, 60, 200, 100, 250, 10, 180, 90, 240, 30, 160, 120, 220, 40, 190, 70, 210]

  /**
   * A clip whose frames sit at exactly the given times (whole milliseconds, ascending; Matroska counts in ms).
   * Frame `i` is a flat gray of level `levels[i]`; the default levels make every frame a scene change.
   */
  function framesAt(name: string, millis: readonly number[], levels: readonly number[] = SCENE_LEVELS, offsetSeconds = 0) {
    const last = millis.at(-1)!
    const select = millis.map(ms => `eq(n\\,${String(ms)})`).join('+')
    const lum = levels.slice(0, millis.length).map((level, index) => `if(eq(N\\,${String(index)})\\,${String(level)}\\,`).join('') + '0' + ')'.repeat(millis.length)
    return generate(
      name,
      ['-f', 'lavfi', '-i', `color=c=black:size=64x64:rate=1000:duration=${String((last + 10) / 1000)}`],
      ['-vf', `select='${select}',geq=lum='${lum}':cb=128:cr=128`, '-fps_mode', 'vfr', ...(offsetSeconds === 0 ? [] : ['-output_ts_offset', String(offsetSeconds)])],
      'in.mkv',
    )
  }

  it('sparse VFR: a gap longer than 1 s before k does not change what paged reading selects (oracle: one whole read)', async () => {
    // t=0 black, t=3 gray, t=3.1 white with equal steps: in one read 3.1 scores min(d, |d - d|) = 0 and is not
    // selected. A page that starts at k=3 and only sees frames from 2 s on has no frame before 3.0, so 3.1 would
    // score min(d, |d - 0|) = d against an empty history and be selected as an extra.
    const clip = await framesAt('sparse-gap', [0, 3000, 3100], [16, 126, 235])
    const wholeTimes = delivered(await extract(clip, 0, 200)).map(frame => frame.timeSeconds)
    expect(wholeTimes, 'one whole read').toEqual([0, 3])
    for (const quota of [1, 2, 3, 8]) {
      const { times, finished, failed } = await readPaged(clip, quota)
      expect(finished, `quota ${String(quota)} terminated`).toBe(true)
      expect(times, `quota ${String(quota)}: paged equals whole`).toEqual(wholeTimes)
      expect(failed, `quota ${String(quota)}: no single-second overflow is logged`).toBe(0)
    }
    // A page that starts in the middle of the gap, and one right at the frame, both agree with the whole read.
    for (const from of [2, 3]) expect(delivered(await extract(clip, from, 8)).map(frame => frame.timeSeconds), `from ${String(from)}`).toEqual([3])
  })

  it('sparse VFR with a 40 s gap: the page seeks back until a frame precedes the first selected one', async () => {
    const clip = await framesAt('sparse-long-gap', [0, 40_000, 40_100, 40_200, 55_000, 55_100], [16, 126, 235, 126, 16, 126])
    const wholeTimes = delivered(await extract(clip, 0, 200)).map(frame => frame.timeSeconds)
    expect(wholeTimes, 'equal steps: only the first frame of each second').toEqual([0, 40, 55])
    for (const quota of [1, 2, 8]) {
      const { times, finished, failed } = await readPaged(clip, quota)
      expect(finished, `quota ${String(quota)} terminated`).toBe(true)
      expect(times, `quota ${String(quota)}: paged equals whole`).toEqual(wholeTimes)
      expect(failed, `quota ${String(quota)}: no single-second overflow is logged`).toBe(0)
    }
    for (const from of [20, 40, 41, 50, 55]) {
      const page = delivered(await extract(clip, from, 8)).map(frame => frame.timeSeconds)
      expect(page, `from ${String(from)}`).toEqual(wholeTimes.filter(time => time >= from))
    }
  })

  /**
   * Frames hugging whole seconds from below (x.999 starts second x+1; 6.998 still belongs to second 6), at most two per second. Neighbours stay >= 40 ms apart:
   * the JPEG output runs on a 1/25 s time base and ffmpeg silently drops frames that collide there. Every quota used
   * below fits the densest second, so nothing may be lost or counted as over budget — and quota 2 puts a page
   * boundary right in front of an x.999 frame.
   */
  const boundaryMillis = [0, 999, 1500, 1999, 2500, 2999, 3500, 3999, 4500, 4999, 5500, 5999, 6998, 7500]

  async function expectPagedEqualsWhole(clip: Window): Promise<number[]> {
    const wholeTimes = delivered(await extract(clip, 0, 200)).map(frame => frame.timeSeconds)
    expect(new Set(wholeTimes).size, 'no frame twice in the whole read').toBe(wholeTimes.length)
    for (const quota of [2, 3, 4, 5, 8]) {
      const { times, finished, failed } = await readPaged(clip, quota)
      expect(finished, `quota ${String(quota)} terminated`).toBe(true)
      expect(times, `quota ${String(quota)}: paged equals whole`).toEqual(wholeTimes)
      expect(failed, `quota ${String(quota)}: nothing counted as over budget`).toBe(0)
    }
    return wholeTimes
  }

  it('frames just below a whole second (1.999 and similar) belong to the next second, paged equals whole, no drop or duplicate', async () => {
    const times = await expectPagedEqualsWhole(await framesAt('second-boundary', boundaryMillis))
    expect(times).toContain(0.999)
    expect(times).toContain(1.999)
    expect(times).toContain(6.998)
  })

  it('the same frames on timelines that start at 100 s / 12345 s / 100000 s (showinfo prints only 6 significant digits of the raw time)', async () => {
    // Before the second was computed from pts and the time base, paged reading silently dropped x.999 frames here:
    // the printed time and the filter's own `t - start + eps` disagreed about which second they belong to.
    for (const offset of [100, 12_345, 100_000]) {
      const times = await expectPagedEqualsWhole(await framesAt(`second-boundary-${String(offset)}`, boundaryMillis, undefined, offset))
      expect(times, `offset ${String(offset)}`).toContain(0.999)
      expect(times, `offset ${String(offset)}`).toContain(1.999)
      expect(times, `offset ${String(offset)}`).toContain(6.998)
    }
  }, 60_000)

  it('a second with more scene frames than the page quota delivers the quota and counts the rest as one failure; k advances', async () => {
    const clip = await flashClip('crowded', 6, [3.2, 3.6])
    const whole = delivered(await extract(clip, 0, 200)).map(frame => frame.timeSeconds)
    const seconds3 = whole.filter(time => time >= 3 && time < 4)
    expect(seconds3.length, 'second 3 holds 3.0, 3.2, 3.43, 3.6, 3.83').toBeGreaterThanOrEqual(4)
    const quota = seconds3.length - 1
    const page = await extract(clip, 3, quota)
    if (page.kind !== 'frames') throw new Error(page.reason)
    expect(delivered(page).map(frame => frame.timeSeconds)).toEqual(seconds3.slice(0, quota))
    expect(page.frames.filter(frame => 'failed' in frame)).toEqual([
      expect.objectContaining({ k: 3, failed: 'scene-frames-over-budget' }),
    ])
    expect(page.nextK).toBe(4)
    expect(page.complete).toBe(false)
  })

  it('150 frames pair correctly with six-digit names', async () => {
    const clip = await generate('long150', ['-f', 'lavfi', '-i', 'color=c=blue:size=64x64:rate=1:duration=150'])
    const result = await extract(clip, 0, 150)
    const frames = delivered(result)
    expect(frames).toHaveLength(150)
    expect(frames.map(frame => frame.k)).toEqual(Array.from({ length: 150 }, (_, index) => index))
    expect(frames.map(frame => frame.timeSeconds)).toEqual(Array.from({ length: 150 }, (_, index) => index))
    expect(readdirSync(clip.dir).filter(file => file.startsWith('f_')).sort().at(-1)).toBe('f_000150.jpg')
  })

  it('a 20 minute video is framed from a deep seek without a size or duration skip', async () => {
    const clip = await generate('long1200', ['-f', 'lavfi', '-i', 'color=c=red:size=64x64:rate=1:duration=1200'], ['-g', '30'])
    const started = Date.now()
    const result = await extract(clip, 600)
    expect(result.kind).toBe('frames')
    if (result.kind !== 'frames') return
    expect(result.durationSeconds).toBeCloseTo(1200, 0)
    expect(result.frames.map(frame => frame.k)).toEqual(Array.from({ length: 8 }, (_, index) => 600 + index))
    expect(result).toMatchObject({ nextK: 608, complete: false })
    // The seek, not a full decode, is what keeps a late page cheap.
    expect(Date.now() - started).toBeLessThan(20_000)
  })

  it('seeking beyond the last frame is an empty, complete window', async () => {
    const clip = await generate('past-end', ['-f', 'lavfi', '-i', 'color=c=gray:size=64x64:rate=10:duration=3'])
    const result = await extract(clip, 10)
    expect(result).toMatchObject({ kind: 'frames', frames: [], nextK: 10, complete: true })
  })

  it('refuses a file that is not a video without producing frames', async () => {
    const dir = join(root, 'garbage')
    await mkdir(dir)
    await run('/bin/sh', ['-c', 'head -c 4096 /dev/zero > in.mp4'], { cwd: dir })
    const result = await extract({ dir, fileName: 'in.mp4' }, 0, 8, 1024 * 1024)
    expect(result).toMatchObject({ kind: 'skipped', reason: 'video-probe-failed' })
    expect(readdirSync(dir).filter(file => file.startsWith('f_'))).toEqual([])
  })
})
