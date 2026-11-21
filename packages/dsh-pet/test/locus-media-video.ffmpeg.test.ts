/**
 * Real `ffmpeg`/`ffprobe` against generated videos.
 *
 * The scripted-process tests prove the Host's handling of what the tools print;
 * only a real run proves the filtergraph itself: that `scale` bounds the LONGEST
 * edge (a width-only scale fails portrait video), that `showinfo` really emits
 * `pts_time` at the log level Pet asks for, and that those times pair with the
 * output files. Skipped, with the reason printed, on a machine without both
 * programs; the verify step must run it where they exist.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractKeyframes, LOCUS_VIDEO_LIMITS, resolveFrameTools, type FrameTools, type VideoLimits } from '../src/host/channel/media-video.js'

const run = promisify(execFile)
const tools: FrameTools | undefined = await resolveFrameTools()
if (tools === undefined) console.warn('[skip] locus-media-video.ffmpeg: ffmpeg/ffprobe not found on PATH')

const limits: VideoLimits = { ...LOCUS_VIDEO_LIMITS }
let root = ''

async function frameSize(path: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run(tools!.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', path])
  const stream = (JSON.parse(stdout) as { streams: { width: number; height: number }[] }).streams[0]!
  return { width: stream.width, height: stream.height }
}

/** Generate a short `testsrc` clip and frame it exactly like production does, in its own directory. */
async function frame(name: string, size: string, seconds = 2) {
  const dir = join(root, name)
  await mkdir(dir)
  await run(tools!.ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=${String(seconds)}`,
    '-pix_fmt', 'yuv420p', '-y', join(dir, 'in.mp4'),
  ])
  const result = await extractKeyframes({
    tools: tools!, dir, fileName: 'in.mp4', limits, maxFrames: 8, maxFrameBytes: 10 * 1024 * 1024,
    signal: new AbortController().signal,
  })
  return { dir, result }
}

describe.skipIf(tools === undefined)('keyframes from real video', () => {
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-pet-ffmpeg-it-')) })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('bounds longest edge for landscape, portrait, narrow-tall, small', async () => {
    const cases = [
      { name: 'landscape', size: '1920x1080', expected: { width: 1024, height: 576 } },
      { name: 'portrait', size: '1080x1920', expected: { width: 576, height: 1024 } },
      { name: 'narrow', size: '200x3000', expected: { width: 68, height: 1024 } },
      { name: 'small', size: '640x360', expected: { width: 640, height: 360 } },
    ] as const
    for (const item of cases) {
      const { dir, result } = await frame(item.name, item.size)
      expect(result.kind, item.name).toBe('frames')
      if (result.kind !== 'frames') continue
      expect(result.frames.length, item.name).toBeGreaterThanOrEqual(1)
      const files = readdirSync(dir).filter(file => file.startsWith('f_')).sort()
      expect(files.length).toBe(result.frames.length)
      for (const file of files) {
        const actual = await frameSize(join(dir, file))
        expect(actual, `${item.name} ${file}`).toEqual(item.expected)
        expect(actual.width % 2).toBe(0)
        expect(actual.height % 2).toBe(0)
        expect(Math.max(actual.width, actual.height)).toBeLessThanOrEqual(limits.maxEdge)
      }
      // Frames are JPEG by magic bytes, whatever the extension says.
      for (const frameData of result.frames) expect([...frameData.data.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    }
  })

  it('pairs real showinfo times with output frames at scene cuts', async () => {
    const dir = join(root, 'cuts')
    await mkdir(dir)
    // Three flat colours, one second each: cuts at 1 s and 2 s, which scene selection must find.
    await run(tools!.ffmpeg, [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=10:duration=1',
      '-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=10:duration=1',
      '-f', 'lavfi', '-i', 'color=c=green:size=640x360:rate=10:duration=1',
      '-filter_complex', 'concat=n=3:v=1:a=0', '-pix_fmt', 'yuv420p', '-y', join(dir, 'in.mp4'),
    ])
    const result = await extractKeyframes({
      tools: tools!, dir, fileName: 'in.mp4', limits, maxFrames: 8, maxFrameBytes: 10 * 1024 * 1024,
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('frames')
    if (result.kind !== 'frames') return
    expect(result.durationSeconds).toBeCloseTo(3, 0)
    const times = result.frames.map(item => item.timeSeconds)
    expect(times).toHaveLength(3)
    expect(times[0]).toBe(0)
    expect(times[1]).toBeCloseTo(1, 1)
    expect(times[2]).toBeCloseTo(2, 1)
  })

  it('refuses a file that is not a video without producing frames', async () => {
    const dir = join(root, 'garbage')
    await mkdir(dir)
    await run('/bin/sh', ['-c', 'head -c 4096 /dev/zero > in.mp4'], { cwd: dir })
    const result = await extractKeyframes({
      tools: tools!, dir, fileName: 'in.mp4', limits, maxFrames: 8, maxFrameBytes: 1024 * 1024,
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'skipped', reason: 'video-probe-failed' })
    expect(readdirSync(dir).filter(file => file.startsWith('f_'))).toEqual([])
  })
})
