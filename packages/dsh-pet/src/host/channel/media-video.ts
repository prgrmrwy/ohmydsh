/**
 * Bounded whole-second + scene-change frame extraction from one already-downloaded video.
 *
 * EXPORTS (change `locus-read-referenced-chats`, design D10, tasks group 9):
 *
 * ```ts
 * // Closed vocabulary of why a video (or one frame slot) was not delivered.
 * type VideoSkipReason = … | 'frame-extraction-timeout' | 'frame-timestamps-unavailable' | …
 * type SecondFrameFailure = 'frame-file-missing' | 'frame-admission-failed' | 'scene-frames-over-budget'
 *
 * // One slot of the window. `k` is the whole second the slot stands for
 * // (floor of the normalised time); `timeSeconds` is the normalised showinfo time.
 * type SecondFrame =
 *   | { k: number; timeSeconds: number; data: Uint8Array }              // delivered
 *   | { k: number; timeSeconds: number; failed: SecondFrameFailure }    // this slot only
 *
 * type SecondFrameExtraction =
 *   | { kind: 'frames'; durationSeconds: number; frames: readonly SecondFrame[]
 *       nextK: number      // next whole second to read; strictly > fromSecond unless nothing was read; failed slots advance it too
 *       complete: boolean }// true: nothing left after nextK (no cursor needed)
 *   | { kind: 'skipped'; reason: VideoSkipReason; durationSeconds?: number }
 *
 * extractSecondFrames(input: {
 *   tools: FrameTools; dir: string; fileName: string   // video is `<dir>/<fileName>`
 *   fromSecond: number        // k: first whole second wanted (integer ≥ 0)
 *   maxFrames: number         // page quota (whole-second AND scene frames together), ≥ 1
 *   maxFrameBytes: number     // per-frame byte ceiling (over → slot 'frame-admission-failed')
 *   signal: AbortSignal       // page-wide abort; also bounds the decode window
 *   limits?: Partial<VideoLimits>   // maxEdge / decodeWindowMs / probeTimeoutMs overrides
 * }): Promise<SecondFrameExtraction>
 * ```
 *
 * Contract the caller (media.ts) relies on:
 * - ONE decode pass per page: input-seek to `k-1` (so the first frame of the
 *   window has a predecessor for the scene score; if none was decoded — a
 *   sparse VFR gap longer than 1 s — the pass is repeated seeking 2 s, 4 s …
 *   back, down to the file start, see design D10), source timeline kept
 *   (`-copyts`), a single `select` keeps the FIRST frame of every whole second
 *   `≥ k` plus every scene-change frame (`gt(scene, sceneThreshold)`) `≥ k`, in
 *   time order; a frame that is both is selected once. No `fps` resampling.
 *   The position stays an integer second: a page covers `[k, k+n)`.
 * - Quota: whole-second and scene frames share `maxFrames`. ffmpeg is asked for
 *   `maxFrames + 1` frames; the extra one only says "the window is over-full".
 *   Over-full → the window shrinks to the seconds BEFORE the extra frame's
 *   second `s` (`nextK = s`, those frames are re-selected next page, none is
 *   dropped). If all of them sit in one second, that second delivers its first
 *   `maxFrames` frames, one `scene-frames-over-budget` slot is counted for the
 *   rest, and `nextK = s + 1`: the cursor always advances.
 * - `timeSeconds` is the showinfo time minus the video stream's `start_time`
 *   (−1 ms or less below zero reads as 0). The time and the whole second `k`
 *   come from the integer `pts` and the printed time base, evaluated like the
 *   filter's own `t` (the printed `pts_time` keeps only 6 significant digits).
 *   Never computed from a frame's index.
 * - The caller still owns magic-MIME proof and `AttachmentStore` admission of
 *   `data`; a slot that fails there is simply treated as `failed` by the caller
 *   and `nextK` is NOT rewound (failed slots advance `k` like delivered ones).
 * - No duration or byte cut-off here: a 20-minute video is framed.
 * - `skipped` reasons: `frame-tools-unavailable` is the caller's; this function
 *   returns `video-probe-failed`, `video-format-unsupported`,
 *   `frame-extraction-failed`, `frame-extraction-timeout` (decode window hit
 *   and nothing is deliverable), `frame-timestamps-unavailable` (a file
 *   without a record voids the whole window), `aborted`.
 * - Timeout/kill with a deliverable verified prefix is `kind: 'frames'` with
 *   `complete: false`; the largest existing file (possibly truncated) and every
 *   later slot are re-selected on the next page, and so is every slot sharing
 *   the second of that largest file (later scene frames of that second may not
 *   have been decoded yet, so a second is never split across pages).
 *
 * ---- security posture (applies to every ffmpeg/ffprobe call) ----
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
import { accessSync, constants, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
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
  /** `select` scene-change threshold (kept from the original scene sampler); whole-second frames are selected regardless. */
  sceneThreshold: 0.08,
  /** Wall-clock budget of ONE decode window (ffmpeg only). */
  decodeWindowMs: 30_000,
  /** Wall-clock budget of ffprobe. */
  probeTimeoutMs: 10_000,
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
  | 'video-download-exceeds-window'
  | 'video-too-large'
  | 'video-too-long'
  | 'video-format-unsupported'
  | 'video-probe-failed'
  | 'frame-extraction-failed'
  | 'frame-extraction-timeout'
  | 'frame-timestamps-unavailable'
  | 'frame-admission-failed'
  | 'aborted'

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

const SHOWINFO_LINE = /(Parsed_showinfo\S*)\s+@\s+\S+\]\s+n:\s*(\d+)\s+pts:\s*(\S+)\s+pts_time:\s*(\S+)/
const SHOWINFO_CONFIG = /Parsed_showinfo\S*\s+@\s+\S+\]\s+config in time_base:\s*(\d+)\/(\d+)/
/** The `showinfo` that sits BEFORE `select`, so it sees every decoded frame (the second one sees only selected frames). */
const DECODED_SHOWINFO = 'Parsed_showinfo_0'

interface Probe { readonly durationSeconds: number; readonly startTime: number }

async function probeVideo(input: {
  readonly tools: FrameTools
  readonly dir: string
  readonly fileName: string
  /** Present: a container longer than this is skipped (legacy path). Absent: no duration cut-off. */
  readonly maxDurationSeconds: number | undefined
  readonly signal: AbortSignal
  readonly remainingMs: () => number
}): Promise<Probe | { readonly skip: VideoSkipReason; readonly durationSeconds?: number }> {
  const result = await runBoundedTool({
    binary: input.tools.ffprobe,
    args: [
      '-v', 'error',
      '-protocol_whitelist', 'file',
      '-select_streams', 'v:0',
      '-show_entries', 'format=duration,format_name:stream=start_time',
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
  let startTime = 0
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    const record = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
    const candidate = record?.['format']
    format = typeof candidate === 'object' && candidate !== null ? candidate as Record<string, unknown> : undefined
    const streams = record?.['streams']
    const stream = Array.isArray(streams) ? streams[0] as unknown : undefined
    // An absent or unparseable stream start_time ("N/A") means the timeline starts at 0.
    const reported = typeof stream === 'object' && stream !== null ? Number((stream as Record<string, unknown>)['start_time']) : Number.NaN
    if (Number.isFinite(reported)) startTime = reported
  } catch { format = undefined }
  const duration = Number(format?.['duration'])
  const names = typeof format?.['format_name'] === 'string' ? format['format_name'].split(',').map(name => name.trim()) : []
  if (format === undefined || !Number.isFinite(duration) || duration < 0 || names.length === 0 || names.some(name => name === '')) {
    return { skip: 'video-probe-failed' }
  }
  if (!names.every(name => VIDEO_CONTAINER_FORMATS.has(name))) return { skip: 'video-format-unsupported', durationSeconds: duration }
  if (input.maxDurationSeconds !== undefined && duration > input.maxDurationSeconds) return { skip: 'video-too-long', durationSeconds: duration }
  return { durationSeconds: duration, startTime }
}

/** Why one slot of a window has no usable frame; the rest of the window is unaffected. */
export type SecondFrameFailure = 'frame-file-missing' | 'frame-admission-failed' | 'scene-frames-over-budget'

/** One slot of a decoded window; failed slots advance `k` exactly like delivered ones. */
export type SecondFrame =
  | { readonly k: number; readonly timeSeconds: number; readonly data: Uint8Array }
  | { readonly k: number; readonly timeSeconds: number; readonly failed: SecondFrameFailure }

export type SecondFrameExtraction =
  | {
    readonly kind: 'frames'
    readonly durationSeconds: number
    readonly frames: readonly SecondFrame[]
    /** Next whole second to read. */
    readonly nextK: number
    /** True when nothing is left after `nextK`. */
    readonly complete: boolean
  }
  | { readonly kind: 'skipped'; readonly reason: VideoSkipReason; readonly durationSeconds?: number }

export interface ExtractSecondFramesInput {
  readonly tools: FrameTools
  readonly dir: string
  readonly fileName: string
  readonly fromSecond: number
  readonly maxFrames: number
  readonly maxFrameBytes: number
  readonly signal: AbortSignal
  readonly limits?: Partial<VideoLimits>
}

/** Tolerance (seconds) shared by the `select` expression and the time normalisation. */
const SECOND_EPSILON = 0.001
const NO_PACKETS = /Nothing was written into output file, because at least one of its streams received no packets/

/**
 * The `-vf` graph of one window: ONE `select` keeping, among frames at or after
 * `fromSecond`, the first frame of the window, each frame whose second differs
 * from the previously selected one, and each scene-change frame (`scene` is
 * scored against the decoded predecessor, which the seek to `k-1` provides for
 * the window's first frame). A `showinfo` BEFORE the select reports every
 * decoded frame (only the first is read: it tells whether the first selected
 * frame had a predecessor); then the bounded proportional scale, then
 * `showinfo` LAST so `n` counts selected frames.
 *
 * `t` is the source timeline (`-copyts`), so the stream's `start_time` is
 * subtracted inside the expression; the 1 ms epsilon makes a frame stamped just
 * below a whole second still belong to it, exactly like the displayed time.
 * @param input - Window start, stream start time and edge bound.
 * @returns the filtergraph string (for ffmpeg's own parser, not a shell).
 */
export function buildSecondFilter(input: {
  readonly fromSecond: number
  readonly startTime: number
  readonly maxEdge: number
  readonly sceneThreshold: number
}): string {
  const edge = String(Math.trunc(input.maxEdge))
  const second = (time: string): string => `floor(${time}-(${String(input.startTime)})+${String(SECOND_EPSILON)})`
  return `showinfo,select='gte(${second('t')},${String(input.fromSecond)})*(isnan(prev_selected_t)+gt(${second('t')},${second('prev_selected_t')})+gt(scene,${String(input.sceneThreshold)}))',`
    + `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,`
    + 'showinfo'
}

/** One selected frame as `showinfo` reports it: raw source-timeline `pts` (stream time base units) and the printed `pts_time`. */
type SecondRecord = { readonly n: number; readonly pts: number; readonly time: number }
type TimeBase = { readonly num: number; readonly den: number }

function secondFramesSkip(reason: VideoSkipReason, durationSeconds?: number): SecondFrameExtraction {
  return { kind: 'skipped', reason, ...(durationSeconds === undefined ? {} : { durationSeconds }) }
}

/**
 * Source-timeline time of a record, computed exactly the way the filter's own `t` is: `pts * (num / den)` in
 * doubles. `showinfo` prints `pts_time` with only 6 significant digits (`1000.999` prints as `1001`), so a frame
 * a hair below a whole second, or any frame of a stream whose `start_time` is large, would otherwise land in a
 * different second than the one the filter put it in. Without the time base (never the case for a real ffmpeg,
 * which always prints it) the printed `pts_time` is all there is.
 */
function sourceTime(record: SecondRecord, timeBase: TimeBase | undefined): number {
  return timeBase !== undefined && Number.isFinite(record.pts) ? record.pts * (timeBase.num / timeBase.den) : record.time
}

/** Whole second of a source time, written like the `select` expression's `floor(t-(start)+eps)` so both round alike. */
function wholeSecond(time: number, startTime: number): number {
  return Math.floor(time - startTime + SECOND_EPSILON)
}

/**
 * Pair showinfo records with output files for the first `count` slots.
 * @returns the slots, or `undefined` when the timeline cannot be trusted.
 */
function pairSlots(input: {
  readonly dir: string
  readonly records: readonly SecondRecord[]
  readonly timeBase: TimeBase | undefined
  readonly count: number
  readonly startTime: number
  readonly maxFrameBytes: number
}): SecondFrame[] | undefined {
  const slots: SecondFrame[] = []
  let previous = Number.NEGATIVE_INFINITY
  for (let index = 0; index < input.count; index += 1) {
    const record = input.records[index]!
    const source = sourceTime(record, input.timeBase)
    if (record.n !== index || !Number.isFinite(source)) return undefined
    let time = source - input.startTime
    // More than 1 ms before the stream starts is not a frame time of this stream.
    if (time < -SECOND_EPSILON) return undefined
    if (time < 0) time = 0
    time = Number(time.toFixed(6))
    if (time < previous) return undefined
    previous = time
    const k = Math.max(0, wholeSecond(source, input.startTime))
    const path = join(input.dir, `f_${String(index + 1).padStart(6, '0')}.jpg`)
    let size = 0
    try { size = statSync(path).size } catch { size = 0 }
    if (size < 1) { slots.push({ k, timeSeconds: time, failed: 'frame-file-missing' }); continue }
    if (size > input.maxFrameBytes) { slots.push({ k, timeSeconds: time, failed: 'frame-admission-failed' }); continue }
    try {
      slots.push({ k, timeSeconds: time, data: new Uint8Array(readFileSync(path)) })
    } catch {
      slots.push({ k, timeSeconds: time, failed: 'frame-file-missing' })
    }
  }
  return slots
}

/** Extract whole-second and scene-change frames from `<dir>/<fileName>`; see the file header for the contract. */
export async function extractSecondFrames(input: ExtractSecondFramesInput): Promise<SecondFrameExtraction> {
  if (!Number.isSafeInteger(input.fromSecond) || input.fromSecond < 0 || !Number.isSafeInteger(input.maxFrames) || input.maxFrames < 1) {
    return secondFramesSkip('frame-extraction-failed')
  }
  const limits: VideoLimits = { ...LOCUS_VIDEO_LIMITS, ...input.limits }
  const probeDeadline = Date.now() + limits.probeTimeoutMs
  const probe = await probeVideo({
    tools: input.tools,
    dir: input.dir,
    fileName: input.fileName,
    maxDurationSeconds: undefined,
    signal: input.signal,
    remainingMs: () => probeDeadline - Date.now(),
  })
  if ('skip' in probe) return secondFramesSkip(probe.skip, probe.durationSeconds)
  const { durationSeconds, startTime } = probe

  // One frame beyond the quota is requested: it only tells an over-full window from an exactly full one.
  const recordCap = input.maxFrames + 1
  const decodeDeadline = Date.now() + limits.decodeWindowMs

  /** One decode pass, input-seeking to `seek` seconds (no seek at 0). `undefined`: the directory cannot be prepared. */
  const decode = async (seek: number) => {
    // Frame files of an earlier window (or attempt) in the same directory would read as files without records.
    try {
      for (const name of readdirSync(input.dir)) if (/^f_\d{6}\.jpg$/.test(name)) rmSync(join(input.dir, name), { force: true })
    } catch {
      return undefined
    }
    const records: SecondRecord[] = []
    let noPackets = false
    let timeBase: TimeBase | undefined
    let firstDecoded: SecondRecord | undefined
    const run = await runBoundedTool({
      binary: input.tools.ffmpeg,
      args: [
        '-nostdin', '-hide_banner', '-nostats',
        // `showinfo` per-frame records are info-level; `error` would filter them out.
        '-loglevel', 'info',
        '-protocol_whitelist', 'file',
        // Input seek for pre-roll, source timeline kept so `t` is the container's own time.
        ...(seek > 0 ? ['-ss', String(seek)] : []),
        '-copyts',
        '-i', `./${input.fileName}`,
        '-vf', buildSecondFilter({ fromSecond: input.fromSecond, startTime, maxEdge: limits.maxEdge, sceneThreshold: limits.sceneThreshold }),
        '-fps_mode', 'vfr',
        '-frames:v', String(recordCap),
        '-q:v', '4',
        './f_%06d.jpg',
      ],
      cwd: input.dir,
      timeoutMs: Math.max(1, decodeDeadline - Date.now()),
      signal: input.signal,
      maxStdoutBytes: 4 * 1024,
      onStderrLine(line) {
        if (NO_PACKETS.test(line)) noPackets = true
        const config = SHOWINFO_CONFIG.exec(line)
        if (config !== null) {
          const num = Number(config[1])
          const den = Number(config[2])
          if (timeBase === undefined && num > 0 && den > 0) timeBase = { num, den }
          return
        }
        const match = SHOWINFO_LINE.exec(line)
        if (match === null) return
        const record = { n: Number(match[2]), pts: Number(match[3]), time: Number(match[4]) }
        if (match[1] === DECODED_SHOWINFO) {
          if (record.n === 0) firstDecoded = record
          return
        }
        if (records.length < recordCap) records.push(record)
      },
    })
    return { run, records, noPackets, timeBase, firstDecoded }
  }

  // The first selected frame of a window is always taken, but the frame AFTER it is scored against it AND against
  // its own score from the frame before it (`scene = min(mafd, |mafd - prev_mafd|)`); without a decoded frame before
  // the first selected one that history is empty and a sparse VFR video (a gap longer than the 1 s pre-roll) selects
  // frames a single whole read would not. So when nothing precedes the first selected frame, seek further back
  // (1 s, 2 s, 4 s … before `k`, down to the start of the file) until a predecessor is decoded.
  let attempt = await decode(Math.max(0, input.fromSecond - 1))
  for (let back = 2; attempt !== undefined && input.fromSecond - back / 2 > 0; back *= 2) {
    const first = attempt.records[0]
    const decoded = attempt.firstDecoded
    const lacksPredecessor = attempt.run.kind === 'exited' && attempt.run.code === 0
      && first !== undefined && decoded !== undefined
      && (Number.isFinite(first.pts) && Number.isFinite(decoded.pts) ? decoded.pts >= first.pts : decoded.time >= first.time)
    if (!lacksPredecessor) break
    attempt = await decode(Math.max(0, input.fromSecond - back))
  }
  if (attempt === undefined) return secondFramesSkip('frame-extraction-failed', durationSeconds)
  const { run, records, noPackets, timeBase } = attempt
  if (run.kind === 'aborted') return secondFramesSkip('aborted', durationSeconds)
  if (run.kind === 'failed') return secondFramesSkip('frame-extraction-failed', durationSeconds)

  let indexes: number[]
  try {
    indexes = readdirSync(input.dir)
      .map(name => /^f_(\d{6})\.jpg$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => Number(match[1]))
      .sort((a, b) => a - b)
  } catch {
    return secondFramesSkip('frame-extraction-failed', durationSeconds)
  }
  // A file without its record means the time axis cannot be paired: the whole window is void.
  const maxFile = indexes.at(-1) ?? 0
  if (maxFile > records.length) return secondFramesSkip('frame-timestamps-unavailable', durationSeconds)

  const timedOut = run.kind === 'timeout'
  if (!timedOut && run.code !== 0) {
    // Seeking past the last frame leaves ffmpeg with nothing to write: an empty, finished window — but only
    // when it says so, and never for the very first window of a video.
    if (noPackets && records.length === 0 && indexes.length === 0 && input.fromSecond > 0) {
      return { kind: 'frames', durationSeconds, frames: [], nextK: input.fromSecond, complete: true }
    }
    return secondFramesSkip('frame-extraction-failed', durationSeconds)
  }
  // Killed: the largest existing file may be truncated, so only slots before it are trusted.
  const count = timedOut ? Math.max(0, maxFile - 1) : records.length
  if (timedOut && count === 0) return secondFramesSkip('frame-extraction-timeout', durationSeconds)
  if (!timedOut && count === 0 && input.fromSecond === 0) return secondFramesSkip('frame-extraction-failed', durationSeconds)

  const slots = pairSlots({ dir: input.dir, records, timeBase, count, startTime, maxFrameBytes: input.maxFrameBytes })
  if (slots === undefined) return secondFramesSkip('frame-timestamps-unavailable', durationSeconds)

  // The window ends before the second of the first slot that cannot be delivered whole:
  // the extra (quota + 1)th frame, or — after a kill — the possibly truncated largest file,
  // whose second may still have later scene frames that were never decoded.
  let frames: SecondFrame[] = slots
  let nextK = slots.length === 0 ? input.fromSecond : Math.max(input.fromSecond, slots.at(-1)!.k + 1)
  let shrunk = false
  const boundary = timedOut ? timedOutBoundary(records, count, timeBase, startTime) : slots.length > input.maxFrames ? slots[input.maxFrames]!.k : undefined
  if (boundary !== undefined) {
    shrunk = true
    const whole = slots.filter(slot => slot.k < boundary)
    if (whole.length > 0) {
      frames = whole
      nextK = boundary
    } else if (timedOut) {
      // Everything verified sits in the one second that is still being decoded: nothing can be delivered without splitting it.
      return secondFramesSkip('frame-extraction-timeout', durationSeconds)
    } else {
      // The quota cannot hold even this one second: it delivers its first `maxFrames` frames and counts the rest.
      const extra = slots[input.maxFrames]!
      frames = [...slots.slice(0, input.maxFrames), { k: extra.k, timeSeconds: extra.timeSeconds, failed: 'scene-frames-over-budget' }]
      nextK = extra.k + 1
    }
  }
  const complete = !timedOut && !shrunk && (frames.length < input.maxFrames || nextK >= durationSeconds)
  return { kind: 'frames', durationSeconds, frames, nextK, complete }
}

/** Second of the record that follows the last trusted slot after a kill (its file may be truncated). */
function timedOutBoundary(records: readonly SecondRecord[], count: number, timeBase: TimeBase | undefined, startTime: number): number {
  const record = records[count]
  return record === undefined ? 0 : Math.max(0, wholeSecond(sourceTime(record, timeBase), startTime))
}
