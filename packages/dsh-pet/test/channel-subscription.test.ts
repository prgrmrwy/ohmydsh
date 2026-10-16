/**
 * Subscription supervision.
 *
 * The load-bearing behaviours: readiness comes from lark-cli's marker rather
 * than from "the process started", termination uses SIGTERM because a hard
 * kill can leak the server-side subscription, and repeated failure lands in a
 * diagnosable `down` state instead of an endless retry loop.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  ChannelSubscription,
  signalProcessGroup,
  type ChannelStatus,
} from '../src/host/channel/subscription.js'
import { STDERR_SECRETS, SUBSCRIBE_STDERR } from './fixtures/lark-subscribe.js'

let nextPid = 4242

/** A child process stand-in with controllable streams. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void }
  readonly stderr = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void }
  exitCode: number | null = null
  signalCode: string | null = null
  readonly pid = nextPid++
  readonly signals: string[] = []

  constructor() {
    super()
    this.stdout.setEncoding = () => undefined
    this.stderr.setEncoding = () => undefined
  }

  kill(signal: string): boolean {
    this.signals.push(signal)
    return true
  }

  /** Emit the SDK connection line `+subscribe` writes once the socket is up. */
  ready(): void {
    this.stderr.emit('data', SUBSCRIBE_STDERR.sdkConnected)
  }

  /** Emit raw stderr text. */
  err(text: string): void {
    this.stderr.emit('data', text)
  }

  /** Emit stdout content. */
  out(text: string): void {
    this.stdout.emit('data', text)
  }

  /** End the process. */
  end(code: number | null, signal: string | null = null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

interface Harness {
  readonly subscription: ChannelSubscription
  readonly children: FakeChild[]
  readonly lines: string[]
  readonly statuses: ChannelStatus[]
  readonly timers: { fn: () => void; ms: number }[]
  readonly commands: { command: string; args: readonly string[] }[]
  /** Signals delivered to whole process groups, by child pid. */
  readonly groupSignals: { pid: number; signal: string }[]
  /** Kill-escalation timers (separate from restart timers). */
  readonly killTimers: { fn: () => void; ms: number }[]
  /** Settable clock. */
  readonly clock: { now: number }
}

function harness(options: { maxFailures?: number } = {}): Harness {
  const children: FakeChild[] = []
  const lines: string[] = []
  const statuses: ChannelStatus[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const commands: { command: string; args: readonly string[] }[] = []
  const groupSignals: { pid: number; signal: string }[] = []
  const killTimers: { fn: () => void; ms: number }[] = []
  const clock = { now: 1_000 }

  const subscription = new ChannelSubscription({
    onLine: line => lines.push(line),
    onStatus: status => statuses.push(status),
    backoffMs: [10, 20],
    ...(options.maxFailures !== undefined ? { maxFailures: options.maxFailures } : {}),
    spawnProcess: (command, args) => {
      commands.push({ command, args })
      const child = new FakeChild()
      children.push(child)
      return child as unknown as ChildProcess
    },
    schedule: (fn, ms) => {
      timers.push({ fn, ms })
    },
    signalGroup: (child, signal) => {
      groupSignals.push({ pid: child.pid ?? -1, signal })
    },
    scheduleKill: (fn, ms) => {
      killTimers.push({ fn, ms })
    },
    now: () => clock.now,
  })
  return { subscription, children, lines, statuses, timers, commands, groupSignals, killTimers, clock }
}

describe('starting the consumer', () => {
  it('spec Scenario "启用 channel 后启动订阅": exactly one +subscribe for IM and comments, bot identity, no consume', () => {
    const h = harness()

    h.subscription.start()

    // One connection per app: a second consumer (bus `consume` or another
    // `+subscribe`) makes Feishu split events between them silently (spike E3).
    expect(h.commands).toHaveLength(1)
    expect(h.commands[0]?.command).toBe('lark-cli')
    expect(h.commands[0]?.args).toEqual([
      '--profile',
      'dsh-pet',
      'event',
      '+subscribe',
      '--as',
      'bot',
      '--compact',
      '--event-types',
      'im.message.receive_v1,drive.notice.comment_add_v1',
    ])
    expect(h.commands[0]?.args).not.toContain('consume')
    expect(h.commands[0]?.args).not.toContain('--force')
    expect(h.commands[0]?.args).not.toContain('--quiet')
  })

  it('is connected only after the SDK connection line, not the early banner', () => {
    const h = harness()

    h.subscription.start()
    expect(h.subscription.current.phase).toBe('starting')

    // `Connected.` is printed before the handshake (subscribe.go L283).
    h.children[0]?.err(SUBSCRIBE_STDERR.connecting)
    h.children[0]?.err(SUBSCRIBE_STDERR.connectedBanner)
    expect(h.subscription.current.phase).toBe('starting')

    h.children[0]?.ready()

    expect(h.subscription.current.phase).toBe('connected')
    expect(h.subscription.watermark).toBe(1_000)
  })

  it('recognises the SDK line even when stderr splits it across chunks', () => {
    const h = harness()
    h.subscription.start()
    const line = SUBSCRIBE_STDERR.sdkConnected

    h.children[0]?.err(line.slice(0, 20))
    expect(h.subscription.current.phase).toBe('starting')
    h.children[0]?.err(line.slice(20))

    expect(h.subscription.current.phase).toBe('connected')
  })

  it('spec Scenario "内部重连不推进水位": the watermark latches once per child', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.ready()
    expect(h.subscription.watermark).toBe(1_000)

    // The SDK reconnects inside the same process and prints the line again.
    h.clock.now = 9_000
    h.children[0]?.ready()

    expect(h.subscription.watermark).toBe(1_000)
    expect(h.subscription.current.phase).toBe('connected')
  })

  it('spec Scenario "stderr 原文不落盘": no status or diagnostic carries stderr text', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.err(SUBSCRIBE_STDERR.connecting)
    h.children[0]?.ready()
    h.children[0]?.err(SUBSCRIBE_STDERR.notFoundHandler)
    h.children[0]?.end(1)

    const published = JSON.stringify(h.statuses)
    for (const secret of STDERR_SECRETS) expect(published).not.toContain(secret)
    expect(published).not.toContain('not found handler')
  })

  it('keeps stdin open so an unbounded consumer is not told to shut down', async () => {
    // Regression: `stdio: ['ignore', ...]` closes stdin immediately, and an
    // unbounded `event consume` treats stdin EOF as a shutdown signal (its
    // own help notes that only BOUNDED runs ignore EOF). The consumer then
    // exited with code 0 the moment it attached, which the supervisor read as
    // a healthy start followed by an unexpected exit: an invisible restart
    // loop that left `Active consumers: 0` while the status looked fine.
    //
    // Asserted on source because the guarantee lives in the DEFAULT spawn,
    // which every other test replaces with an injected fake.
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const source = await readFile(
      nodePath.resolve(__dirname, '..', 'src', 'host', 'channel', 'subscription.ts'),
      'utf8',
    )

    expect(source).toContain("stdio: ['pipe', 'pipe', 'pipe']")
    expect(source).not.toContain("stdio: ['ignore'")
  })

  it('ignores a second start while already running', () => {
    const h = harness()

    h.subscription.start()
    h.subscription.start()

    expect(h.children).toHaveLength(1)
  })
})

describe('reading events', () => {
  it('delivers whole lines only', () => {
    const h = harness()
    h.subscription.start()

    h.children[0]?.out('{"a":1}\n{"b":')
    h.children[0]?.out('2}\n')

    expect(h.lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('keeps running when a handler throws', () => {
    const children: FakeChild[] = []
    const subscription = new ChannelSubscription({
      onLine: () => {
        throw new Error('bad event')
      },
      spawnProcess: () => {
        const child = new FakeChild()
        children.push(child)
        return child as unknown as ChildProcess
      },
      schedule: () => undefined,
    })
    subscription.start()

    // One malformed event must never take the subscription down.
    expect(() => children[0]?.out('garbage\n')).not.toThrow()
  })
})

describe('restart policy', () => {
  it('schedules a backoff retry after an unexpected exit', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.ready()

    h.children[0]?.end(1)

    expect(h.subscription.current.phase).toBe('reconnecting')
    expect(h.timers[0]?.ms).toBe(10)

    h.timers[0]?.fn()
    expect(h.children).toHaveLength(2)
  })

  it('ignores the old child exit after explicit reconnect', () => {
    const h = harness()
    h.subscription.start()
    const old = h.children[0]

    h.subscription.reconnect()
    old?.end(null, 'SIGTERM')

    expect(h.children).toHaveLength(2)
    expect(h.timers).toHaveLength(0)
    expect(h.subscription.current.phase).toBe('starting')
  })

  it('fences a retry timer across stop and a later start', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.end(1)
    const staleRetry = h.timers[0]

    h.subscription.stop()
    h.subscription.start()
    staleRetry?.fn()

    expect(h.children).toHaveLength(2)
  })

  it('handles error plus exit only once', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.emit('error', new Error('broken'))
    h.children[0]?.end(1)

    expect(h.timers).toHaveLength(1)
    expect(h.subscription.current.failures).toBe(1)
  })

  it('lengthens the delay on repeated failure', () => {
    const h = harness()
    h.subscription.start()

    h.children[0]?.end(1)
    h.timers[0]?.fn()
    h.children[1]?.end(1)

    expect(h.timers[1]?.ms).toBe(20)
  })

  it('spec Scenario "lark-cli bot 身份不可用": declares the channel down with a re-login diagnostic once attempts are exhausted', () => {
    const h = harness({ maxFailures: 2 })
    h.subscription.start()

    h.children[0]?.end(1)
    h.timers[0]?.fn()
    h.children[1]?.end(1)

    const status = h.subscription.current
    expect(status.phase).toBe('down')
    // Actionable: the most common real cause is an expired bot login.
    expect(status.diagnostic).toMatch(/lark-cli auth status/)
    expect(h.timers).toHaveLength(1)
  })

  it('clears the failure count once a subscription becomes ready', () => {
    const h = harness({ maxFailures: 2 })
    h.subscription.start()
    h.children[0]?.end(1)
    h.timers[0]?.fn()
    h.children[1]?.ready()

    expect(h.subscription.current.failures).toBe(0)

    h.children[1]?.end(1)
    expect(h.subscription.current.phase).toBe('reconnecting')
  })

  it('retries from scratch on an explicit reconnect', () => {
    const h = harness({ maxFailures: 1 })
    h.subscription.start()
    h.children[0]?.end(1)
    expect(h.subscription.current.phase).toBe('down')

    h.subscription.reconnect()

    expect(h.subscription.current.phase).toBe('starting')
    expect(h.children).toHaveLength(2)
  })
})

describe('stopping', () => {
  it('spec Scenario "停止时回收整个进程组": SIGTERM goes to the whole group, synchronously', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.ready()
    const child = h.children[0]

    h.subscription.stop()

    // The npm shim does not forward signals: signalling only the shim leaves
    // the native process orphaned, holding the connection and lock (spike E12).
    expect(h.groupSignals).toEqual([{ pid: child?.pid, signal: 'SIGTERM' }])
    expect(child?.signals).toEqual([])
    expect(h.subscription.current.phase).toBe('stopped')
    expect(h.killTimers.map(timer => timer.ms)).toEqual([5_000])
  })

  it('the default signal targets the negative pid (the group), not the shim alone', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = new FakeChild()
    try {
      signalProcessGroup(child as unknown as ChildProcess, 'SIGTERM')
      expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')
      expect(child.signals).toEqual([])
    } finally {
      kill.mockRestore()
    }
  })

  it('falls back to signalling the child when the group cannot be signalled', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const child = new FakeChild()
    try {
      signalProcessGroup(child as unknown as ChildProcess, 'SIGTERM')
      expect(child.signals).toEqual(['SIGTERM'])
    } finally {
      kill.mockRestore()
    }
  })

  it('spawns detached by default so the child leads its own process group', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const source = await readFile(nodePath.resolve(__dirname, '..', 'src', 'host', 'channel', 'subscription.ts'), 'utf8')
    expect(source).toContain("stdio: ['pipe', 'pipe', 'pipe'], detached: true")
  })

  it('escalates to SIGKILL on the group only when the child is still alive after 5s', () => {
    const h = harness()
    h.subscription.start()
    const alive = h.children[0]
    h.subscription.stop()

    h.killTimers[0]?.fn()

    expect(h.groupSignals).toEqual([
      { pid: alive?.pid, signal: 'SIGTERM' },
      { pid: alive?.pid, signal: 'SIGKILL' },
    ])
  })

  it('does not SIGKILL a group whose child already exited', () => {
    const h = harness()
    h.subscription.start()
    const child = h.children[0]
    h.subscription.stop()
    child?.end(null, 'SIGTERM')

    h.killTimers[0]?.fn()

    // The pgid may already be reused: never signal a group we no longer own.
    expect(h.groupSignals).toEqual([{ pid: child?.pid, signal: 'SIGTERM' }])
  })

  it('goes down without retry when another +subscribe holds the app lock', () => {
    const h = harness()
    h.subscription.start()

    h.children[0]?.err(SUBSCRIBE_STDERR.lockHeld)
    h.children[0]?.end(2)

    expect(h.subscription.current.phase).toBe('down')
    expect(h.subscription.current.diagnostic).toMatch(/subscribe-lock-held/)
    expect(h.timers).toHaveLength(0)
  })

  it('does not restart after a deliberate stop', () => {
    const h = harness()
    h.subscription.start()

    h.subscription.stop()
    h.children[0]?.end(null, 'SIGTERM')

    expect(h.timers).toHaveLength(0)
    expect(h.subscription.current.phase).toBe('stopped')
  })

  it('reports a spawn failure as a restartable condition', () => {
    const statuses: ChannelStatus[] = []
    const subscription = new ChannelSubscription({
      onLine: () => undefined,
      onStatus: status => statuses.push(status),
      backoffMs: [10],
      spawnProcess: () => {
        throw new Error('lark-cli not found')
      },
      schedule: () => undefined,
    })

    subscription.start()

    expect(subscription.current.phase).toBe('reconnecting')
    expect(subscription.current.diagnostic).toMatch(/lark-cli not found/)
  })
})
