/**
 * Bounded scene-keyframe extraction from one already-downloaded video.
 *
 * SECURITY POSTURE. `ffmpeg`/`ffprobe` parse an untrusted container and codec.
 * Pet narrows what it can, and says plainly what it cannot:
 *
 * - narrowed: only the local `file` protocol is allowed, stdin is closed, the
 *   input is a relative name inside the call's own 0700 directory, the
 *   container must be on a short allow-list, byte size, duration and wall-clock
 *   time are bounded, and the whole process group is killed on timeout/abort;
 * - NOT narrowed: the programs run with the Host user's rights. There is no OS
 *   sandbox (macOS has no low-cost process-level one). Removing `ffmpeg` from
 *   the machine returns every video to cover-only.
 *
 * Frame timestamps come ONLY from `showinfo` lines on stderr and are paired
 * with the output files one-to-one. Anything short of a perfect pairing drops
 * the whole batch: a time is never computed from a frame's index, because scene
 * selection is not uniform sampling.
 */

import { execFile } from 'node:child_process'
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { runBoundedTool } from './media-process.js'

const execFileAsync = promisify(execFile)

/** Deployment limits of the video path. All exported so tests and README can cite them. */
export const LOCUS_VIDEO_LIMITS = Object.freeze({
  /** Largest video downloaded; the download is killed mid-way past this. */
  maxBytes: 64 * 1024 * 1024,
  /** Longest video that is framed, by the container's own duration. */
  maxDurationSeconds: 300,
  /** Most keyframes returned per video (also capped by the remaining image quota). */
  maxFrames: 8,
  /** Longest edge of a returned frame; smaller frames are never enlarged. */
  maxEdge: 1024,
  /** Wall-clock budget for ffprobe and ffmpeg TOGETHER. */
  toolTimeoutMs: 30_000,
  /** `select` scene-change threshold; the first frame is always included. */
  sceneThreshold: 0.08,
})

export type VideoLimits = { -readonly [K in keyof typeof LOCUS_VIDEO_LIMITS]: number }

/** Containers Pet frames. Every name the probe reports must be on this list. */
export const VIDEO_CONTAINER_FORMATS: ReadonlySet<string> = new Set([
  'mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm',
])

/** Resolved, process-fixed absolute paths of the two programs. */
export interface FrameTools {
  readonly ffmpeg: string
  readonly ffprobe: string
}

/** Closed vocabulary of why a video was not framed; shown to the model verbatim. */
export type VideoSkipReason =
  | 'frame-tools-unavailable'
  | 'image-quota-exhausted'
  | 'video-download-failed'
  | 'video-download-timeout'
  | 'video-too-large'
  | 'video-too-long'
  | 'video-format-unsupported'
  | 'video-probe-failed'
  | 'frame-extraction-failed'
  | 'frame-extraction-timeout'
  | 'frame-timestamps-unavailable'
  | 'frame-admission-failed'
  | 'aborted'

/** One extracted frame with the time its own `showinfo` line reported. */
export interface KeyframeCandidate {
  /** Raw bytes; the caller proves the media type from them and runs attachment admission. */
  readonly data: Uint8Array
  readonly timeSeconds: number
}

export type FrameExtraction =
  | { readonly kind: 'frames'; readonly durationSeconds: number; readonly frames: readonly KeyframeCandidate[] }
  | { readonly kind: 'skipped'; readonly reason: VideoSkipReason; readonly durationSeconds?: number }

/** Search PATH for an absolute, executable file; relative PATH entries are ignored. */
function resolveOnPath(name: string, pathValue: string | undefined): string | undefined {
  for (const entry of (pathValue ?? '').split(delimiter)) {
    if (entry === '' || !isAbsolute(entry)) continue
    const candidate = join(entry, name)
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch { /* not here */ }
  }
  return undefined
}

async function reportsVersion(binary: string, banner: string): Promise<boolean> {
  try {
    const result = await execFileAsync(binary, ['-version'], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 })
    return String(result.stdout).trimStart().startsWith(`${banner} version`)
  } catch {
    return false
  }
}

/**
 * Probe the two programs once, at Host start, and fix their absolute paths.
 *
 * The result is NOT re-resolved per call, so a later PATH change cannot swap in
 * a different binary. Either program missing or not reporting its banner means
 * frame extraction is unavailable and every video stays cover-only.
 * @param options - `env`/`probe` seams for tests.
 * @returns the fixed tools, or undefined when either is unusable.
 */
export async function resolveFrameTools(options: {
  readonly env?: NodeJS.ProcessEnv
  readonly probe?: (binary: string, banner: 'ffmpeg' | 'ffprobe') => Promise<boolean>
} = {}): Promise<FrameTools | undefined> {
  const pathValue = (options.env ?? process.env)['PATH']
  const probe = options.probe ?? reportsVersion
  const ffmpeg = resolveOnPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', pathValue)
  const ffprobe = resolveOnPath(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe', pathValue)
  if (ffmpeg === undefined || ffprobe === undefined) return undefined
  if (!await probe(ffmpeg, 'ffmpeg') || !await probe(ffprobe, 'ffprobe')) return undefined
  return { ffmpeg, ffprobe }
}

/**
 * The `-vf` graph: scene-change selection, then a bounded proportional scale,
 * then `showinfo`. `showinfo` is LAST so its `pts_time` belongs to a frame that
 * was really selected, and its `n` counts selected frames from 0.
 *
 * The scale box is `min(edge, iw) × min(edge, ih)` with
 * `force_original_aspect_ratio=decrease`, so the longest edge is at most `edge`,
 * nothing is enlarged, and `force_divisible_by=2` only ever rounds down.
 * @param limits - Edge and scene threshold.
 * @returns the filtergraph string (quoted for ffmpeg's own parser, not a shell).
 */
export function buildFrameFilter(limits: Pick<VideoLimits, 'maxEdge' | 'sceneThreshold'>): string {
  const edge = String(Math.trunc(limits.maxEdge))
  return `select='eq(n,0)+gt(scene,${String(limits.sceneThreshold)})',`
    + `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,`
    + 'showinfo'
}

const SHOWINFO_LINE = /Parsed_showinfo\S*\s+@\s+\S+\]\s+n:\s*(\d+)\s+pts:\s*\S+\s+pts_time:\s*(\S+)/

/** Bounded stderr consumer keeping only the per-frame `showinfo` records. */
function showinfoCollector(max: number): {
  readonly onLine: (line: string) => void
  readonly records: () => readonly { readonly n: number; readonly time: number }[]
} {
  const records: { n: number; time: number }[] = []
  return {
    onLine(line) {
      if (records.length >= max) return
      const match = SHOWINFO_LINE.exec(line)
      if (match === null) return
      records.push({ n: Number(match[1]), time: Number(match[2]) })
    },
    records: () => records,
  }
}

interface Probe { readonly durationSeconds: number }

async function probeVideo(input: {
  readonly tools: FrameTools
  readonly dir: string
  readonly fileName: string
  readonly limits: VideoLimits
  readonly signal: AbortSignal
  readonly remainingMs: () => number
}): Promise<Probe | { readonly skip: VideoSkipReason; readonly durationSeconds?: number }> {
  const result = await runBoundedTool({
    binary: input.tools.ffprobe,
    args: [
      '-v', 'error',
      '-protocol_whitelist', 'file',
      '-show_entries', 'format=duration,format_name',
      '-of', 'json',
      `./${input.fileName}`,
    ],
    cwd: input.dir,
    timeoutMs: input.remainingMs(),
    signal: input.signal,
    maxStdoutBytes: 16 * 1024,
  })
  if (result.kind === 'aborted') return { skip: 'aborted' }
  if (result.kind === 'timeout') return { skip: 'frame-extraction-timeout' }
  if (result.kind !== 'exited' || result.code !== 0) return { skip: 'video-probe-failed' }
  let format: Record<string, unknown> | undefined
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    const candidate = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['format'] : undefined
    format = typeof candidate === 'object' && candidate !== null ? candidate as Record<string, unknown> : undefined
  } catch { format = undefined }
  const duration = Number(format?.['duration'])
  const names = typeof format?.['format_name'] === 'string' ? format['format_name'].split(',').map(name => name.trim()) : []
  if (format === undefined || !Number.isFinite(duration) || duration < 0 || names.length === 0 || names.some(name => name === '')) {
    return { skip: 'video-probe-failed' }
  }
  if (!names.every(name => VIDEO_CONTAINER_FORMATS.has(name))) return { skip: 'video-format-unsupported', durationSeconds: duration }
  if (duration > input.limits.maxDurationSeconds) return { skip: 'video-too-long', durationSeconds: duration }
  return { durationSeconds: duration }
}

/**
 * Extract scene keyframes from `<dir>/<fileName>`.
 *
 * Runs INSIDE the caller's spool directory callback: the video and the frames
 * only exist while the caller's `finally` has not yet removed the directory,
 * and the returned candidates are in-memory copies.
 * @param input - Directory, file, tools, limits, the frame budget and an abort signal.
 * @returns frames paired with their reported times, or a deterministic skip reason.
 */
export async function extractKeyframes(input: {
  readonly tools: FrameTools
  readonly dir: string
  readonly fileName: string
  readonly limits: VideoLimits
  /** Frames wanted: `min(limits.maxFrames, remaining image quota)`; callers pass ≥ 1. */
  readonly maxFrames: number
  /** Per-frame byte ceiling from the attachment deployment limits. */
  readonly maxFrameBytes: number
  readonly signal: AbortSignal
}): Promise<FrameExtraction> {
  const deadline = Date.now() + input.limits.toolTimeoutMs
  const remainingMs = (): number => deadline - Date.now()
  const probe = await probeVideo({ ...input, remainingMs })
  if ('skip' in probe) {
    return { kind: 'skipped', reason: probe.skip, ...(probe.durationSeconds === undefined ? {} : { durationSeconds: probe.durationSeconds }) }
  }

  const collector = showinfoCollector(input.maxFrames)
  const run = await runBoundedTool({
    binary: input.tools.ffmpeg,
    args: [
      '-nostdin', '-hide_banner', '-nostats',
      // `showinfo` per-frame records are info-level; `error` would filter them out.
      '-loglevel', 'info',
      '-protocol_whitelist', 'file',
      '-i', `./${input.fileName}`,
      '-vf', buildFrameFilter(input.limits),
      '-fps_mode', 'vfr',
      '-frames:v', String(input.maxFrames),
      '-q:v', '4',
      './f_%02d.jpg',
    ],
    cwd: input.dir,
    timeoutMs: remainingMs(),
    signal: input.signal,
    maxStdoutBytes: 4 * 1024,
    onStderrLine: collector.onLine,
  })
  const durationSeconds = probe.durationSeconds
  if (run.kind === 'aborted') return { kind: 'skipped', reason: 'aborted', durationSeconds }
  if (run.kind === 'timeout') return { kind: 'skipped', reason: 'frame-extraction-timeout', durationSeconds }
  if (run.kind !== 'exited' || run.code !== 0) return { kind: 'skipped', reason: 'frame-extraction-failed', durationSeconds }

  let names: string[]
  try {
    names = readdirSync(input.dir).filter(name => /^f_\d{2}\.jpg$/.test(name)).sort()
  } catch {
    return { kind: 'skipped', reason: 'frame-extraction-failed', durationSeconds }
  }
  if (names.length === 0) return { kind: 'skipped', reason: 'frame-extraction-failed', durationSeconds }

  // One-to-one pairing, or nothing: the k-th selected frame (`n:k`) is `f_{k+1}.jpg`.
  const records = collector.records()
  const paired = records.length === names.length
    && names.every((name, index) => name === `f_${String(index + 1).padStart(2, '0')}.jpg`)
    && records.every((record, index) =>
      record.n === index
      && Number.isFinite(record.time)
      && record.time >= 0
      && (index === 0 || record.time >= records[index - 1]!.time))
  if (!paired) return { kind: 'skipped', reason: 'frame-timestamps-unavailable', durationSeconds }

  const frames: KeyframeCandidate[] = []
  for (const [index, name] of names.entries()) {
    const path = join(input.dir, name)
    let size: number
    try { size = statSync(path).size } catch { return { kind: 'skipped', reason: 'frame-extraction-failed', durationSeconds } }
    if (size < 1 || size > input.maxFrameBytes) return { kind: 'skipped', reason: 'frame-admission-failed', durationSeconds }
    frames.push({ data: new Uint8Array(readFileSync(path)), timeSeconds: records[index]!.time })
  }
  return { kind: 'frames', durationSeconds, frames }
}
