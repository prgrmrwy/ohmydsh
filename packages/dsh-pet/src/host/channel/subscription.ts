/**
 * The `lark-cli event consume` subscription, supervised.
 *
 * Pet spawns the consumer as a child process and reads NDJSON from its stdout.
 * The consumer itself does not hold the WebSocket: it attaches to an
 * app-scoped bus daemon that lark-cli starts on demand and retires about
 * thirty seconds after its last consumer leaves.
 *
 * Two consequences shape this module. Pet terminates its consumer with
 * SIGTERM and never SIGKILL, because lark-cli warns that a hard kill skips
 * cleanup and can leak the server-side subscription. And Pet never touches the
 * daemon: it is shared with any other lark-cli use on this machine, so killing
 * it would break somebody else's tooling.
 */

import { spawn, type ChildProcess } from 'node:child_process'

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
  /** Event key to consume. */
  readonly eventKey?: string
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
}

const DEFAULT_BACKOFF = [1_000, 2_000, 5_000, 15_000, 30_000] as const

/**
 * Supervises one long-running `lark-cli event consume` child.
 *
 * The supervisor owns restart policy and status reporting only; deciding what
 * an event means belongs to the caller's `onLine`.
 */
export class ChannelSubscription {
  private child: ChildProcess | undefined
  private status: ChannelStatus = { phase: 'stopped', failures: 0 }
  private stopping = false
  private buffer = ''

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
    if (this.child !== undefined) return
    this.stopping = false
    this.spawnOnce()
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
    this.stopping = true
    const child = this.child
    this.child = undefined
    if (child !== undefined && child.exitCode === null) child.kill('SIGTERM')
    this.setStatus({ phase: 'stopped', failures: 0 })
  }

  /** Reset the failure count and try again immediately. */
  reconnect(): void {
    this.stop()
    this.setStatus({ phase: 'stopped', failures: 0 })
    this.start()
  }

  /** Publish a new status to the observer. */
  private setStatus(next: ChannelStatus): void {
    this.status = next
    this.options.onStatus?.(next)
  }

  /** Spawn one consumer attempt and wire its streams. */
  private spawnOnce(): void {
    const binary = this.options.binary ?? 'lark-cli'
    const eventKey = this.options.eventKey ?? 'im.message.receive_v1'
    const args = ['event', 'consume', eventKey, '--as', 'bot']
    this.setStatus({ ...this.status, phase: 'starting' })

    const spawnProcess =
      this.options.spawnProcess ??
      ((command: string, commandArgs: readonly string[]) =>
        // stdin is a PIPE that is deliberately never written to or closed.
        // An unbounded `event consume` treats stdin EOF as a shutdown signal
        // (its own help says only bounded runs ignore EOF), so `'ignore'`
        // makes the consumer exit with code 0 the instant it attaches — which
        // reads as a healthy subscription that immediately stops, restarts,
        // and loops forever. Holding the pipe open keeps it running.
        // See docs/notes/dsh-plugin-integration-pitfalls.md §2.
        spawn(command, [...commandArgs], { stdio: ['pipe', 'pipe', 'pipe'] }))

    let child: ChildProcess
    try {
      child = spawnProcess(binary, args)
    } catch (error) {
      this.handleExit(`Could not start ${binary}: ${describe(error)}`)
      return
    }
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.consume(chunk))

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      // The readiness marker is the only stderr line with meaning here: it is
      // how lark-cli says the subscription is actually attached, as opposed to
      // the process merely having started.
      if (chunk.includes('] ready event_key=')) {
        this.setStatus({ phase: 'connected', failures: 0, readyAt: Date.now() })
      }
    })

    child.on('error', error => this.handleExit(describe(error)))
    child.on('exit', (code, signal) => {
      this.handleExit(
        signal !== null ? `consumer terminated by ${signal}` : `consumer exited with code ${code}`,
      )
    })
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
  private handleExit(reason: string): void {
    this.child = undefined
    this.buffer = ''
    if (this.stopping) return

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
      if (!this.stopping) this.spawnOnce()
    }, delay)
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
