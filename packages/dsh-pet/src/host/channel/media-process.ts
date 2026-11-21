/**
 * Bounded child-process runner for the media pipeline.
 *
 * Every external program the media port starts (the official `lark-cli`
 * downloader aside, which keeps its own spool-aware loop) goes through here so
 * that the same four guarantees hold for it:
 *
 * - it runs in its own process group with an explicit cwd, so a timeout or an
 *   abort can terminate it AND everything it forked;
 * - stdout and stderr are drained continuously and only a bounded amount is
 *   retained, so a chatty or hostile program cannot grow Host memory;
 * - stdin is closed, so it can never wait on input;
 * - nothing outlives the call: the group is killed in `finally` even when the
 *   promise is already settled.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'

/** Longest single stderr line kept for the line callback; longer ones are cut. */
const MAX_STDERR_LINE_CHARS = 2_048
/** How much raw stderr is retained for a diagnostic, from the end. */
export const STDERR_TAIL_BYTES = 4 * 1024

/**
 * Kill a child and every process in its group.
 * @param child - Process spawned with `detached` on POSIX.
 */
export function killProcessTree(child: ChildProcess): void {
  child.stdio[3]?.destroy()
  if (child.pid !== undefined && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* process may already have exited */ }
  }
  try { child.kill('SIGKILL') } catch { /* process may already have exited */ }
}

/** What one bounded run produced. */
export type RunToolResult =
  | {
    readonly kind: 'exited'
    readonly code: number | null
    readonly stdout: string
    /** Last {@link STDERR_TAIL_BYTES} of stderr, for diagnostics only. */
    readonly stderrTail: string
  }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed'; readonly reason: 'spawn-error' | 'stdout-too-large' }

export interface RunToolInput {
  readonly binary: string
  readonly args: readonly string[]
  /** The call's own exclusive directory. */
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
  /** Stdout above this many bytes kills the process. */
  readonly maxStdoutBytes: number
  /** Receives every complete stderr line (cut to a bounded length). */
  readonly onStderrLine?: (line: string) => void
}

/**
 * Run one program to completion under a timeout and an abort signal.
 * @param input - Program, arguments, directory and bounds.
 * @returns how the run ended; never throws.
 */
export async function runBoundedTool(input: RunToolInput): Promise<RunToolResult> {
  if (input.signal.aborted) return { kind: 'aborted' }
  if (input.timeoutMs <= 0) return { kind: 'timeout' }
  const child = spawn(input.binary, [...input.args], {
    windowsHide: true,
    cwd: input.cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let outcome: 'timeout' | 'aborted' | 'stdout-too-large' | 'spawn-error' | undefined
  let exited = false
  const stop = (reason: NonNullable<typeof outcome>): void => {
    if (outcome !== undefined) return
    outcome = reason
    killProcessTree(child)
  }
  const onAbort = (): void => stop('aborted')
  input.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => stop('timeout'), input.timeoutMs)
  timer.unref?.()

  let stdout = ''
  let stdoutBytes = 0
  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    stdoutBytes += data.byteLength
    if (stdoutBytes > input.maxStdoutBytes) { stop('stdout-too-large'); return }
    stdout += data.toString()
  })

  let tail = ''
  let pending = ''
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : chunk
    tail = (tail + text).slice(-STDERR_TAIL_BYTES)
    pending += text
    const lines = pending.split(/\r\n|\n|\r/)
    pending = lines.pop() ?? ''
    for (const line of lines) input.onStderrLine?.(line.slice(0, MAX_STDERR_LINE_CHARS))
    // A program that never prints a newline must not grow the buffer.
    if (pending.length > MAX_STDERR_LINE_CHARS) pending = pending.slice(-MAX_STDERR_LINE_CHARS)
  })
  child.on('error', () => stop('spawn-error'))

  try {
    const [code] = await once(child, 'close') as [number | null, NodeJS.Signals | null]
    exited = true
    if (pending !== '') input.onStderrLine?.(pending.slice(0, MAX_STDERR_LINE_CHARS))
    if (outcome === 'timeout') return { kind: 'timeout' }
    if (outcome === 'aborted') return { kind: 'aborted' }
    if (outcome === 'stdout-too-large' || outcome === 'spawn-error') {
      return { kind: 'failed', reason: outcome === 'spawn-error' ? 'spawn-error' : 'stdout-too-large' }
    }
    return { kind: 'exited', code, stdout, stderrTail: tail }
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onAbort)
    if (!exited) killProcessTree(child)
  }
}
