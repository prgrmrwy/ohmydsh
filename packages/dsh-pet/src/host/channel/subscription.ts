/**
 * The `lark-cli event +subscribe` subscription, supervised.
 *
 * Pet runs exactly ONE `+subscribe --compact` for both group messages and doc
 * comments. A Feishu long connection is cluster-mode: with a second connection
 * for the same app (a bus `event consume`, another `+subscribe`) each event goes
 * to one of them at random and the other side silently loses it (spike E3,
 * openspec change pet-locus-doc-comments). `drive.notice.comment_add_v1` is not
 * a `consume` EventKey, so the whole intake lives on this one connection.
 *
 * Shape-defining facts, all measured against lark-cli v1.0.97 source:
 * - Readiness is the SDK's `connected to wss://` line. The `Connected.` banner
 *   is printed BEFORE the handshake and is not proof of anything.
 * - That SDK line carries `access_key` / `ticket` in its query string: stderr
 *   is pattern-matched only and never stored, logged or surfaced.
 * - The npm shim runs the native binary without forwarding signals, so the
 *   child runs in its own process group and stop signals the GROUP; signalling
 *   only the shim orphans a native process that keeps the connection and lock.
 * - `+subscribe` holds a per-app lock; losing it is a configuration conflict,
 *   not a transient failure, so it goes `down` without retry.
 * Pet never runs `event stop` and never touches lark-cli's shared bus daemon.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { PET_CLI_PROFILE, petCliArgs } from './cli.js'
import type { GateOutcome } from './connection-gate.js'

/** Event types carried on Pet's single connection. */
export const SUBSCRIBED_EVENT_TYPES = ['im.message.receive_v1', 'drive.notice.comment_add_v1'] as const

/** The SDK prints this once a socket is actually up (oapi-sdk-go ws/client.go). */
const READY_MARKER = 'connected to wss://'
/** `+subscribe`'s per-app lock refusal (lark-cli shortcuts/event/subscribe.go). */
const LOCK_HELD_MARKER = 'another event +subscribe instance is already running'
/** How long a stopped group gets before SIGKILL. */
const STOP_GRACE_MS = 5_000
/** A child that has not connected by then is reclaimed and retried. */
const READY_TIMEOUT_MS = 30_000

/** Connection state, reported independently of Pet's own lifecycle. */
export type ChannelPhase = 'stopped' | 'starting' | 'connected' | 'reconnecting' | 'down'

/** Current channel state for diagnostics. */
export interface ChannelStatus {
  readonly phase: ChannelPhase
  /** Present whenever the phase is `down` or `reconnecting`. */
  readonly diagnostic?: string
  /** Consecutive failed starts; resets once a subscription is ready. */
  readonly failures: number
  /** When the running consumer became ready, for the watermark. */
  readonly readyAt?: number
}

/** What the supervisor needs from its Host. */
export interface SubscriptionOptions {
  /** lark-cli executable; overridable for tests. */
  readonly binary?: string
  /** Stable lark-cli profile selected for the consumer. */
  readonly profile?: string
  /** Receives one parsed NDJSON line at a time. */
  readonly onLine: (line: string) => void
  /** Notified on every state change. */
  readonly onStatus?: (status: ChannelStatus) => void
  /** Backoff schedule in milliseconds; the last entry repeats until the cap. */
  readonly backoffMs?: readonly number[]
  /** Consecutive failures tolerated before the channel is declared down. */
  readonly maxFailures?: number
  /** Injectable spawn, for tests. */
  readonly spawnProcess?: (command: string, args: readonly string[]) => ChildProcess
  /** Injectable timer, for tests. */
  readonly schedule?: (fn: () => void, ms: number) => void
  /** Injectable process-group signal, for tests. */
  readonly signalGroup?: (child: ChildProcess, signal: NodeJS.Signals) => void
  /** Injectable timer for the SIGKILL escalation, for tests. */
  readonly scheduleKill?: (fn: () => void, ms: number) => void
  /** Injectable clock, for tests. */
  readonly now?: () => number
  /**
   * Run before EVERY spawn (first start, reconnect, supervisor restart). The
   * signal aborts when stop/disable/reconnect supersedes this attempt; a
   * cancelled or refused gate never spawns.
   */
  readonly gate?: (signal: AbortSignal) => Promise<GateOutcome>
  /** A child that never prints the SDK connection line is reclaimed after this. */
  readonly readyTimeoutMs?: number
  /** Injectable timer for the ready timeout, for tests. */
  readonly scheduleReadyTimeout?: (fn: () => void, ms: number) => void
}

const DEFAULT_BACKOFF = [1_000, 2_000, 5_000, 15_000, 30_000] as const

/**
 * Supervises one long-running `lark-cli event +subscribe` child.
 *
 * The supervisor owns restart policy and status reporting only; deciding what
 * an event means belongs to the caller's `onLine`.
 */
export class ChannelSubscription {
  private child: ChildProcess | undefined
  private status: ChannelStatus = { phase: 'stopped', failures: 0 }
  private active = false
  /** Fences late child exits and retry timers from earlier start/stop cycles. */
  private generation = 0
  private buffer = ''
  /** Aborts the in-flight gate of the current generation. */
  private gateAbort: AbortController | undefined
  /** Unterminated stderr tail, so markers split across chunks still match. */
  private errBuffer = ''
  /** Set when the current child reported the per-app lock refusal. */
  private lockHeld = false

  /**
   * @param options - Supervision inputs.
   */
  constructor(private readonly options: SubscriptionOptions) {}

  /** Current status, safe to read at any time. */
  get current(): ChannelStatus {
    return this.status
  }

  /**
   * Timestamp the running subscription became ready.
   *
   * Used as the replay watermark: a message created before the consumer
   * attached is a redelivery of history, not live traffic.
   * @returns the ready time, or 0 when not connected.
   */
  get watermark(): number {
    return this.status.readyAt ?? 0
  }

  /** Start the subscription, or do nothing when already running. */
  start(): void {
    if (this.active) return
    this.active = true
    this.generation += 1
    this.attempt(this.generation)
  }

  /**
   * Stop the subscription and release the child.
   *
   * SIGTERM, never SIGKILL: a hard kill skips lark-cli's cleanup and can leave
   * the server-side subscription registered. The shared bus daemon is left
   * alone deliberately — it retires itself, and other lark-cli users on this
   * machine may still be attached to it.
   */
  stop(): void {
    this.active = false
    this.generation += 1
    this.gateAbort?.abort()
    this.gateAbort = undefined
    const child = this.child
    this.child = undefined
    this.buffer = ''
    this.errBuffer = ''
    if (child !== undefined) this.terminate(child)
    this.setStatus({ phase: 'stopped', failures: 0 })
  }

  /**
   * Signal the child's whole process group: SIGTERM now, SIGKILL after a grace
   * period only if this child is still alive. The SIGKILL guard matters because
   * a group id may be reused once its leader has exited. On Host exit the
   * escalation is best-effort; the synchronous SIGTERM is what counts.
   */
  private terminate(child: ChildProcess): void {
    if (!isAlive(child)) return
    const signal = this.options.signalGroup ?? signalProcessGroup
    signal(child, 'SIGTERM')
    const scheduleKill =
      this.options.scheduleKill ??
      ((fn: () => void, ms: number) => {
        setTimeout(fn, ms).unref?.()
      })
    scheduleKill(() => {
      if (isAlive(child)) signal(child, 'SIGKILL')
    }, STOP_GRACE_MS)
  }

  /** Reset the failure count and replace the active consumer immediately. */
  reconnect(): void {
    this.stop()
    this.start()
  }

  /** Publish a new status to the observer. */
  private setStatus(next: ChannelStatus): void {
    this.status = next
    this.options.onStatus?.(next)
  }

  /** Spawn one consumer attempt and wire its streams. */
  private spawnOnce(generation: number): void {
    const binary = this.options.binary ?? 'lark-cli'
    const args = petCliArgs(
      ['event', '+subscribe', '--as', 'bot', '--compact', '--event-types', SUBSCRIBED_EVENT_TYPES.join(',')],
      this.options.profile ?? PET_CLI_PROFILE,
    )
    this.errBuffer = ''
    this.lockHeld = false
    const { readyAt: _previousReady, ...rest } = this.status
    this.setStatus({ ...rest, phase: 'starting' })

    const spawnProcess =
      this.options.spawnProcess ??
      ((command: string, commandArgs: readonly string[]) =>
        // stdin is a PIPE that is deliberately never written to or closed.
        // `+subscribe` ignores stdin EOF (spike E11), but `event consume` did
        // not, and an `'ignore'` stdin once produced an invisible restart loop
        // (pitfalls §2); keep the safe default. `detached` puts the child in its
        // own process group so stop can signal the shim AND the native binary.
        spawn(command, [...commandArgs], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: true }))

    let child: ChildProcess
    try {
      child = spawnProcess(binary, args)
    } catch (error) {
      this.handleExit(generation, undefined, `Could not start ${binary}: ${describe(error)}`)
      return
    }
    if (!this.active || generation !== this.generation) {
      this.terminate(child)
      return
    }
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (generation === this.generation && child === this.child) this.consume(chunk)
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (generation === this.generation && child === this.child) this.classifyStderr(chunk)
    })

    const scheduleReady =
      this.options.scheduleReadyTimeout ??
      ((fn: () => void, ms: number) => {
        setTimeout(fn, ms).unref?.()
      })
    scheduleReady(() => {
      if (generation !== this.generation || child !== this.child || this.status.readyAt !== undefined) return
      this.terminate(child)
      this.handleExit(generation, child, 'lark-cli did not connect within the ready timeout')
    }, this.options.readyTimeoutMs ?? READY_TIMEOUT_MS)

    let settled = false
    const finish = (reason: string): void => {
      if (settled) return
      settled = true
      this.handleExit(generation, child, reason)
    }
    child.on('error', error => finish(describe(error)))
    child.on('exit', (code, signal) => {
      finish(signal !== null ? `consumer terminated by ${signal}` : `consumer exited with code ${code}`)
    })
  }

  /**
   * Pattern-match stderr. Nothing from stderr is ever stored or published:
   * the SDK's readiness line carries connection credentials.
   */
  private classifyStderr(chunk: string): void {
    const text = this.errBuffer + chunk
    // Keep only the trailing partial line; a marker is never split across a newline.
    const lastNewline = text.lastIndexOf('\n')
    const complete = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
    this.errBuffer = lastNewline >= 0 ? text.slice(lastNewline + 1) : text
    const scan = complete + '\n' + this.errBuffer
    if (scan.includes(LOCK_HELD_MARKER)) this.lockHeld = true
    if (scan.includes(READY_MARKER)) {
      this.errBuffer = ''
      // Latch once per child: an SDK-internal reconnect prints the line again,
      // and moving the watermark would drop events redelivered after it.
      if (this.status.readyAt === undefined) {
        this.setStatus({ phase: 'connected', failures: 0, readyAt: (this.options.now ?? Date.now)() })
      }
    }
  }

  /** Split incoming stdout into whole lines. */
  private consume(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      // A malformed line is the caller's problem to ignore; one bad event
      // must never take the subscription down.
      try {
        this.options.onLine(line)
      } catch {
        // Swallowed on purpose: see above.
      }
      newline = this.buffer.indexOf('\n')
    }
  }

  /** Apply restart policy after the child goes away. */
  private handleExit(
    generation: number,
    child: ChildProcess | undefined,
    reason: string,
  ): void {
    if (generation !== this.generation || !this.active) return
    if (child !== undefined && child !== this.child) return
    this.child = undefined
    this.buffer = ''
    this.errBuffer = ''

    if (this.lockHeld) {
      this.setStatus({
        phase: 'down',
        failures: this.status.failures + 1,
        diagnostic:
          'subscribe-lock-held: another `lark-cli event +subscribe` already holds this app. ' +
          'One app supports one event connection; stop the other subscriber (`pgrep -fl "event +subscribe"`) and reconnect.',
      })
      return
    }

    const failures = this.status.failures + 1
    const backoff = this.options.backoffMs ?? DEFAULT_BACKOFF
    const maxFailures = this.options.maxFailures ?? backoff.length + 3

    if (failures >= maxFailures) {
      this.setStatus({
        phase: 'down',
        failures,
        diagnostic:
          `Lark subscription stopped after ${failures} failed attempts (${reason}). ` +
          'Check `lark-cli auth status` for the bot identity, then reconnect.',
      })
      return
    }

    this.setStatus({ phase: 'reconnecting', failures, diagnostic: reason })
    const delay = backoff[Math.min(failures - 1, backoff.length - 1)] ?? 1_000
    const schedule =
      this.options.schedule ??
      ((fn: () => void, ms: number) => {
        const timer = setTimeout(fn, ms)
        // Never hold the process open for a retry.
        timer.unref?.()
      })
    schedule(() => {
      if (this.active && generation === this.generation && this.child === undefined) {
        this.attempt(generation)
      }
    }, delay)
  }

  /** Gate, then spawn; both fenced by generation. */
  private attempt(generation: number): void {
    const gate = this.options.gate
    if (gate === undefined) {
      this.spawnOnce(generation)
      return
    }
    const { readyAt: _previousReady, ...rest } = this.status
    this.setStatus({ ...rest, phase: 'starting' })
    const controller = new AbortController()
    this.gateAbort = controller
    void gate(controller.signal).then(
      outcome => this.afterGate(generation, controller, outcome),
      error => this.afterGate(generation, controller, {
        kind: 'refused',
        reason: 'connection-check-failed',
        retry: true,
        diagnostic: `connection-check-failed: ${describe(error)}`,
      }),
    )
  }

  /** Apply a gate outcome if it still belongs to the live generation. */
  private afterGate(generation: number, controller: AbortController, outcome: GateOutcome): void {
    if (this.gateAbort === controller) this.gateAbort = undefined
    if (controller.signal.aborted || !this.active || generation !== this.generation) return
    if (outcome.kind === 'cancelled') return
    if (outcome.kind === 'pass') {
      this.spawnOnce(generation)
      return
    }
    if (!outcome.retry) {
      this.setStatus({ phase: 'down', failures: this.status.failures + 1, diagnostic: outcome.diagnostic })
      return
    }
    this.handleExit(generation, undefined, outcome.diagnostic)
  }
}

/**
 * Render an unknown thrown value for a diagnostic.
 * @param error - The thrown value.
 * @returns a human-readable description.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether a child has neither exited nor been terminated by a signal. */
function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

/** Signal a detached child's whole process group; fall back to the child. */
export function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  try {
    if (pid === undefined) throw new Error('no pid')
    process.kill(-pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}
