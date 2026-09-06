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
  type ChannelStatus,
} from '../src/host/channel/subscription.js'

/** A child process stand-in with controllable streams. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void }
  readonly stderr = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void }
  exitCode: number | null = null
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

  /** Emit the readiness marker lark-cli writes to stderr. */
  ready(): void {
    this.stderr.emit('data', '[event] ready event_key=im.message.receive_v1\n')
  }

  /** Emit stdout content. */
  out(text: string): void {
    this.stdout.emit('data', text)
  }

  /** End the process. */
  end(code: number | null, signal: string | null = null): void {
    this.exitCode = code
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
}

function harness(options: { maxFailures?: number } = {}): Harness {
  const children: FakeChild[] = []
  const lines: string[] = []
  const statuses: ChannelStatus[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const commands: { command: string; args: readonly string[] }[] = []

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
  })
  return { subscription, children, lines, statuses, timers, commands }
}

describe('starting the consumer', () => {
  it('runs lark-cli with bot identity', () => {
    const h = harness()

    h.subscription.start()

    // Bot identity throughout: user identity would read with the operator's
    // own visibility and reply as the person.
    expect(h.commands[0]?.command).toBe('lark-cli')
    expect(h.commands[0]?.args).toEqual([
      'event',
      'consume',
      'im.message.receive_v1',
      '--as',
      'bot',
    ])
  })

  it('is not connected until the readiness marker arrives', () => {
    const h = harness()

    h.subscription.start()

    // A started process is not an attached subscription.
    expect(h.subscription.current.phase).toBe('starting')

    h.children[0]?.ready()

    expect(h.subscription.current.phase).toBe('connected')
    expect(h.subscription.watermark).toBeGreaterThan(0)
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

  it('lengthens the delay on repeated failure', () => {
    const h = harness()
    h.subscription.start()

    h.children[0]?.end(1)
    h.timers[0]?.fn()
    h.children[1]?.end(1)

    expect(h.timers[1]?.ms).toBe(20)
  })

  it('declares the channel down once attempts are exhausted', () => {
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
  it('terminates with SIGTERM, never SIGKILL', () => {
    const h = harness()
    h.subscription.start()
    h.children[0]?.ready()

    h.subscription.stop()

    // lark-cli warns that a hard kill skips cleanup and can leak the
    // server-side subscription.
    expect(h.children[0]?.signals).toEqual(['SIGTERM'])
    expect(h.children[0]?.signals).not.toContain('SIGKILL')
    expect(h.subscription.current.phase).toBe('stopped')
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
