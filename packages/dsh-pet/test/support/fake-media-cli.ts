/**
 * Stand-ins for the external programs the Host media port spawns.
 *
 * - {@link fakeMediaCli}: the official `lark-cli` in path mode
 *   (`+messages-resources-download --output ./name`). It records every
 *   invocation so a test can prove that NOTHING was downloaded.
 * - {@link installFakeFrameTools}: `ffprobe` and `ffmpeg` scripts whose
 *   behaviour is read from a `config.json` the test writes, so one fixture
 *   covers success, malformed output, hangs and non-zero exits.
 *
 * They are real executables spawned by the real port: process-group
 * termination, cwd confinement and spool cleanup are therefore exercised
 * against actual processes, not asserted from source text.
 */

import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** PNG signature plus one distinguishing byte. */
export function pngBytes(tag: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag])
}

export interface FakeMediaCli {
  readonly root: string
  readonly spool: string
  readonly binary: string
  /** Every `+messages-resources-download` invocation, in order. */
  calls(): Promise<readonly { readonly type: string; readonly fileKey: string; readonly messageId: string }[]>
  /** Marker written by a grandchild that survived (must never exist). */
  readonly escaped: string
}

/**
 * Fake `lark-cli` download mode.
 *
 * Behaviour by file key substring:
 * - `exit`   → non-zero exit
 * - `hang`   → writes a partial file, spawns a delayed grandchild, never exits
 * - `grow`   → rewrites a ~1 MiB file every few ms and never exits
 * - `big`    → a `--type file` body of 4096 bytes (otherwise 64 bytes)
 * - `fakeimg`→ image type but non-image bytes
 * - anything else → a valid PNG (`--type image`) or an opaque blob (`--type file`)
 */
export async function fakeMediaCli(): Promise<FakeMediaCli> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-media-cli-'))
  const spool = join(root, 'media-spool')
  await mkdir(spool)
  const binary = join(root, 'fake-lark-cli.mjs')
  const escaped = join(root, 'escaped')
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
const root = dirname(fileURLToPath(import.meta.url))
if (!args.includes('+messages-resources-download')) process.exit(90)
if (args.includes('--output-fd')) process.exit(91)
const output = value('--output')
if (typeof output !== 'string' || !output.startsWith('./')) process.exit(92)
const target = resolve(process.cwd(), output)
const key = value('--file-key')
const type = value('--type')
appendFileSync(join(root, 'calls.log'), JSON.stringify({ type, fileKey: key, messageId: value('--message-id') }) + '\\n')
const write = data => {
  const temp = target + '.tmp-' + process.pid
  writeFileSync(temp, data)
  renameSync(temp, target)
}
if (key.includes('exit')) process.exit(3)
if (key.includes('grow')) {
  // Keeps growing and never exits: only the Host's spool measurement can stop it.
  setInterval(() => write(Buffer.alloc(1 << 20, 7)), 5)
} else if (key.includes('hang')) {
  write(Buffer.from([0x89, 0x50]))
  spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'escaped'), 1500)", join(root, 'escaped')], { stdio: 'ignore' })
  setInterval(() => {}, 1000)
} else {
  let data
  if (type === 'file') data = Buffer.alloc(key.includes('big') ? 4096 : 64, 0x41)
  else if (key.includes('fakeimg')) data = Buffer.from([1, 2, 3])
  else {
    const tag = Number(key.match(/(\\d+)$/)?.[1] ?? 1) & 0xff
    data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag])
  }
  write(data)
  process.stdout.write(JSON.stringify({ ok: true, data: { saved_path: target, size_bytes: data.length } }))
}
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  return {
    root,
    spool,
    binary,
    escaped,
    async calls() {
      const path = join(root, 'calls.log')
      if (!existsSync(path)) return []
      return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    },
  }
}

/** What the fake `ffprobe` and `ffmpeg` do; written to `config.json` per test. */
export interface FakeFrameConfig {
  readonly probe?:
    | { readonly formatName: string; readonly duration: string }
    | { readonly fail: true }
    | { readonly garbage: true }
    | { readonly hang: true }
  readonly ffmpeg?: {
    /** Frames to write as `f_01.jpg`…; each time is what showinfo reports. */
    readonly frames: readonly number[]
    /** How the stderr bookkeeping behaves. */
    readonly stderr?: 'ok' | 'missing' | 'extra-line' | 'missing-line' | 'unparseable' | 'non-monotonic'
    readonly exit?: number
    readonly hang?: boolean
    /** Write non-image bytes into the frames. */
    readonly badFrameBytes?: boolean
    /** Bytes per frame beyond the PNG signature. */
    readonly frameBytes?: number
    /** Skew `n:` numbering so it is not contiguous from 0. */
    readonly nonContiguousN?: boolean
  }
}

export interface FakeFrameTools {
  readonly root: string
  readonly ffmpeg: string
  readonly ffprobe: string
  configure(config: FakeFrameConfig): Promise<void>
  /** argv arrays of every ffprobe/ffmpeg invocation, in order. */
  invocations(): Promise<readonly { readonly tool: 'ffprobe' | 'ffmpeg'; readonly argv: readonly string[]; readonly cwd: string }[]>
  readonly escaped: string
}

/** Install fake `ffprobe`/`ffmpeg` executables into a fresh directory. */
export async function installFakeFrameTools(): Promise<FakeFrameTools> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-frame-tools-'))
  const shared = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
const argv = process.argv.slice(2)
const record = tool => appendFileSync(join(root, 'invocations.log'), JSON.stringify({ tool, argv, cwd: process.cwd() }) + '\\n')
const hang = () => {
  spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'escaped'), 1500)", join(root, 'escaped')], { stdio: 'ignore' })
  setInterval(() => {}, 1000)
}
const requireArg = (flag, expected) => {
  const at = argv.indexOf(flag)
  if (at < 0 || (expected !== undefined && argv[at + 1] !== expected)) process.exit(97)
}
`
  const ffprobe = join(root, 'ffprobe')
  const ffmpeg = join(root, 'ffmpeg')
  await writeFile(ffprobe, `#!/usr/bin/env node
${shared}
record('ffprobe')
requireArg('-protocol_whitelist', 'file')
if (!argv.at(-1).startsWith('./')) process.exit(98)
const probe = config.probe
if (probe?.hang) hang()
else if (probe?.fail) process.exit(1)
else if (probe?.garbage) process.stdout.write('not json')
else process.stdout.write(JSON.stringify({ format: { format_name: probe.formatName, duration: probe.duration } }))
`, { mode: 0o700 })
  await writeFile(ffmpeg, `#!/usr/bin/env node
${shared}
record('ffmpeg')
requireArg('-nostdin')
requireArg('-protocol_whitelist', 'file')
requireArg('-fps_mode', 'vfr')
requireArg('-loglevel', 'info')
const input = argv[argv.indexOf('-i') + 1]
if (typeof input !== 'string' || !input.startsWith('./')) process.exit(98)
const out = argv.at(-1)
if (!/^\\.\\/f_%02d\\.jpg$/.test(out)) process.exit(99)
const limit = Number(argv[argv.indexOf('-frames:v') + 1])
const spec = config.ffmpeg
if (spec.hang) { hang() } else {
  const frames = spec.frames.slice(0, limit)
  const lines = []
  frames.forEach((time, index) => {
    const n = spec.nonContiguousN ? index * 2 : index
    lines.push('[Parsed_showinfo_2 @ 0x600001234000] n:' + String(n).padStart(4) + ' pts:' + String(Math.round(time * 1000)).padStart(8) + ' pts_time:' + (spec.stderr === 'unparseable' ? 'N/A' : String(time)) + '       duration:1 duration_time:0.04 fmt:yuv420p')
  })
  if (spec.stderr === 'extra-line') lines.push(lines.at(-1).replace('n:' + String(frames.length - 1).padStart(4), 'n:' + String(frames.length).padStart(4)))
  if (spec.stderr === 'missing-line') lines.pop()
  if (spec.stderr === 'non-monotonic' && lines.length > 1) lines.reverse()
  process.stderr.write('ffmpeg version fake\\nInput #0, mov,mp4\\n')
  if (spec.stderr !== 'missing') for (const line of lines) process.stderr.write(line + '\\n')
  frames.forEach((_time, index) => {
    const name = 'f_' + String(index + 1).padStart(2, '0') + '.jpg'
    const head = spec.badFrameBytes ? [1, 2, 3] : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, index + 1]
    writeFileSync(name, Buffer.concat([Buffer.from(head), Buffer.alloc(spec.frameBytes ?? 0, 7)]))
  })
  process.exit(spec.exit ?? 0)
}
`, { mode: 0o700 })
  await chmod(ffprobe, 0o700)
  await chmod(ffmpeg, 0o700)
  const configure = async (config: FakeFrameConfig): Promise<void> => {
    await writeFile(join(root, 'config.json'), JSON.stringify(config))
  }
  await configure({})
  return {
    root,
    ffmpeg,
    ffprobe,
    configure,
    escaped: join(root, 'escaped'),
    async invocations() {
      const path = join(root, 'invocations.log')
      if (!existsSync(path)) return []
      return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    },
  }
}
