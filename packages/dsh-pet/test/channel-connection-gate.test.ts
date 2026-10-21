/**
 * The connection-exclusivity gate (openspec pet-locus-doc-comments,
 * "事件连接独占在拉起订阅前被证明").
 *
 * Every scenario is driven through a fake gate port and fake timers so the
 * 2 s polling and the 40 s ceiling are exact, and through the real
 * `ChannelSubscription` where the scenario is about spawning.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  GATE_POLL_MS,
  GATE_WAIT_MS,
  RELOGIN_DIAGNOSTIC,
  runConnectionGate,
  versionAtLeast,
  type ConnectionCountRead,
  type ConnectionGatePort,
} from '../src/host/channel/connection-gate.js'
import { ChannelSubscription } from '../src/host/channel/subscription.js'
import { SUBSCRIBE_STDERR } from './fixtures/lark-subscribe.js'

/** A gate port whose answers are scripted and whose sleep is instant but recorded. */
function scriptedPort(input: {
  version?: string | undefined
  counts: readonly ConnectionCountRead[]
  onSleep?: (elapsed: number) => void
}): ConnectionGatePort & { calls: { version: number; count: number; slept: number } } {
  const calls = { version: 0, count: 0, slept: 0 }
  let index = 0
  return {
    calls,
    async cliVersion() {
      calls.version += 1
      return 'version' in input ? input.version : '1.0.97'
    },
    async connectionCount() {
      calls.count += 1
      const read = input.counts[Math.min(index, input.counts.length - 1)]!
      index += 1
      return read
    },
    async sleep(ms, signal) {
      calls.slept += ms
      input.onSleep?.(calls.slept)
      if (signal.aborted) throw new Error('aborted')
    },
  }
}

const count = (value: number): ConnectionCountRead => ({ kind: 'count', count: value })

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void }
  readonly stderr = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void }
  exitCode: number | null = null
  signalCode: string | null = null
  readonly pid = 7000
  constructor() {
    super()
    this.stdout.setEncoding = () => undefined
    this.stderr.setEncoding = () => undefined
  }
  kill(): boolean {
    return true
  }
  end(code: number): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

function supervised(gate: (signal: AbortSignal) => ReturnType<typeof runConnectionGate>, maxFailures = 3) {
  const children: FakeChild[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const subscription = new ChannelSubscription({
    onLine: () => undefined,
    backoffMs: [10],
    maxFailures,
    spawnProcess: () => {
      const child = new FakeChild()
      children.push(child)
      return child as unknown as ChildProcess
    },
    schedule: (fn, ms) => {
      timers.push({ fn, ms })
    },
    scheduleReadyTimeout: () => undefined,
    signalGroup: () => undefined,
    scheduleKill: () => undefined,
    gate,
  })
  return { subscription, children, timers }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

describe('spec Requirement "事件连接独占在拉起订阅前被证明"', () => {
  it('spec Scenario "无其它连接时启动"', async () => {
    const port = scriptedPort({ counts: [count(0)] })
    const h = supervised(signal => runConnectionGate(port, signal))

    h.subscription.start()
    await flush()

    expect(h.children).toHaveLength(1)
    expect(port.calls.slept).toBe(0)
  })

  it('spec Scenario "旧 bus 在空闲期内": polls every 2s and spawns once the count reaches zero', async () => {
    // An idle legacy bus retires about 30 s after its last consumer.
    const reads = [...Array(15).fill(count(1)), count(0)]
    const port = scriptedPort({ counts: reads })

    const outcome = await runConnectionGate(port, new AbortController().signal)

    expect(outcome).toEqual({ kind: 'pass' })
    expect(port.calls.count).toBe(16)
    expect(port.calls.slept).toBe(15 * GATE_POLL_MS)
  })

  it('spec Scenario "他方持续占用连接": gives up after 40s with a diagnostic and stops nobody', async () => {
    const port = scriptedPort({ counts: [count(1)] })
    const h = supervised(signal => runConnectionGate(port, signal))

    h.subscription.start()
    await flush()

    expect(port.calls.slept).toBe(GATE_WAIT_MS)
    expect(h.children).toHaveLength(0)
    expect(h.timers).toHaveLength(0)
    const status = h.subscription.current
    expect(status.phase).toBe('down')
    expect(status.diagnostic).toMatch(/^event-connection-conflict: /)
    expect(status.diagnostic).toContain('lark-cli event status')
    expect(status.diagnostic).toContain('pgrep -fl "event +subscribe"')
    expect(status.diagnostic).not.toMatch(/event stop/)
  })

  it('spec Scenario "监督器重启时上一条连接尚未释放": the gate runs again before a supervisor restart', async () => {
    let attempt = 0
    const gateCalls: number[] = []
    const h = supervised(async signal => {
      attempt += 1
      gateCalls.push(attempt)
      // The crashed child's server-side connection drains in ~3 s.
      const port = scriptedPort({ counts: attempt === 1 ? [count(0)] : [count(1), count(0)] })
      return runConnectionGate(port, signal)
    })

    h.subscription.start()
    await flush()
    h.children[0]?.stderr.emit('data', SUBSCRIBE_STDERR.sdkConnected)
    h.children[0]?.end(1)
    expect(h.subscription.current.phase).toBe('reconnecting')

    h.timers[0]?.fn()
    await flush()

    expect(gateCalls).toEqual([1, 2])
    expect(h.children).toHaveLength(2)
    expect(h.subscription.current.phase).not.toBe('down')
  })

  it('spec Scenario "连接计数接口暂时失败时退避重试"', async () => {
    let attempt = 0
    const h = supervised(async signal => {
      attempt += 1
      const port = scriptedPort({
        counts: attempt === 1 ? [{ kind: 'error', authFailure: false }] : [count(0)],
      })
      return runConnectionGate(port, signal)
    })

    h.subscription.start()
    await flush()
    expect(h.subscription.current).toMatchObject({ phase: 'reconnecting', failures: 1 })
    expect(h.children).toHaveLength(0)

    h.timers[0]?.fn()
    await flush()
    h.children[0]?.stderr.emit('data', SUBSCRIBE_STDERR.sdkConnected)

    expect(h.children).toHaveLength(1)
    expect(h.subscription.current.phase).toBe('connected')
  })

  it('spec Scenario "连接计数接口持续失败": reconnecting until the failure cap, then down', async () => {
    const port = scriptedPort({ counts: [{ kind: 'error', authFailure: false }] })
    const h = supervised(signal => runConnectionGate(port, signal), 3)

    h.subscription.start()
    await flush()
    expect(h.subscription.current.phase).toBe('reconnecting')
    h.timers[0]?.fn()
    await flush()
    expect(h.subscription.current.phase).toBe('reconnecting')
    h.timers[1]?.fn()
    await flush()

    expect(h.children).toHaveLength(0)
    expect(h.subscription.current.phase).toBe('down')
  })

  it('reports an auth failure on the count API with the existing re-login text', async () => {
    const port = scriptedPort({ counts: [{ kind: 'error', authFailure: true }] })

    const outcome = await runConnectionGate(port, new AbortController().signal)

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'connection-check-failed', retry: true })
    expect(outcome.kind === 'refused' && outcome.diagnostic).toContain(RELOGIN_DIAGNOSTIC)
  })

  it('spec Scenario "lark-cli 版本过低"', async () => {
    const port = scriptedPort({ version: '1.0.93', counts: [count(0)] })
    const h = supervised(signal => runConnectionGate(port, signal))

    h.subscription.start()
    await flush()

    expect(port.calls.count).toBe(0)
    expect(h.children).toHaveLength(0)
    expect(h.subscription.current.phase).toBe('down')
    expect(h.subscription.current.diagnostic).toMatch(/lark-cli-too-old: found 1\.0\.93, need >= 1\.0\.97/)
  })

  it('compares versions numerically', () => {
    expect(versionAtLeast('1.0.97', '1.0.97')).toBe(true)
    expect(versionAtLeast('1.0.100', '1.0.97')).toBe(true)
    expect(versionAtLeast('1.1.0', '1.0.97')).toBe(true)
    expect(versionAtLeast('1.0.96', '1.0.97')).toBe(false)
    expect(versionAtLeast('x', '1.0.97')).toBe(false)
  })

  it('spec Scenario "门禁等待期间停用 channel": a cancelled gate never spawns', async () => {
    let stopped = false
    let subscription: ChannelSubscription | undefined
    const port = scriptedPort({
      counts: [count(1), count(1), count(1), count(1), count(1), count(0)],
      onSleep: elapsed => {
        // The user disables at 10 s; the count would reach 0 afterwards.
        if (elapsed >= 10_000 && !stopped) {
          stopped = true
          subscription?.stop()
        }
      },
    })
    const h = supervised(signal => runConnectionGate(port, signal))
    subscription = h.subscription

    h.subscription.start()
    await flush()
    await flush()

    expect(stopped).toBe(true)
    expect(h.children).toHaveLength(0)
    expect(h.subscription.current.phase).toBe('stopped')
  })

  it('spec Scenario "单实例锁被占用"', async () => {
    const port = scriptedPort({ counts: [count(0)] })
    const h = supervised(signal => runConnectionGate(port, signal))

    h.subscription.start()
    await flush()
    h.children[0]?.stderr.emit('data', SUBSCRIBE_STDERR.lockHeld)
    h.children[0]?.end(2)

    expect(h.subscription.current.phase).toBe('down')
    expect(h.subscription.current.diagnostic).toMatch(/^subscribe-lock-held: /)
    expect(h.timers).toHaveLength(0)
  })

  it('spec Scenario "就绪超时": a child that never connects is reclaimed and retried', async () => {
    const port = scriptedPort({ counts: [count(0)] })
    const groupSignals: string[] = []
    const timers: { fn: () => void; ms: number }[] = []
    const children: FakeChild[] = []
    const subscription = new ChannelSubscription({
      onLine: () => undefined,
      backoffMs: [10],
      readyTimeoutMs: 30_000,
      spawnProcess: () => {
        const child = new FakeChild()
        children.push(child)
        return child as unknown as ChildProcess
      },
      schedule: (fn, ms) => {
        timers.push({ fn, ms })
      },
      scheduleReadyTimeout: (fn, ms) => {
        timers.push({ fn, ms })
      },
      signalGroup: (_child, signal) => {
        groupSignals.push(signal)
      },
      scheduleKill: () => undefined,
      gate: signal => runConnectionGate(port, signal),
    })

    subscription.start()
    await flush()
    const readyTimer = timers.find(timer => timer.ms === 30_000)
    expect(readyTimer).toBeDefined()
    readyTimer?.fn()

    expect(groupSignals).toEqual(['SIGTERM'])
    expect(subscription.current.phase).toBe('reconnecting')
  })

  it('a ready timer is harmless once the child connected', async () => {
    const port = scriptedPort({ counts: [count(0)] })
    const timers: { fn: () => void; ms: number }[] = []
    const children: FakeChild[] = []
    const subscription = new ChannelSubscription({
      onLine: () => undefined,
      readyTimeoutMs: 30_000,
      spawnProcess: () => {
        const child = new FakeChild()
        children.push(child)
        return child as unknown as ChildProcess
      },
      schedule: (fn, ms) => {
        timers.push({ fn, ms })
      },
      scheduleReadyTimeout: (fn, ms) => {
        timers.push({ fn, ms })
      },
      signalGroup: () => undefined,
      scheduleKill: () => undefined,
      gate: signal => runConnectionGate(port, signal),
    })

    subscription.start()
    await flush()
    children[0]?.stderr.emit('data', SUBSCRIBE_STDERR.sdkConnected)
    timers.find(timer => timer.ms === 30_000)?.fn()

    expect(subscription.current.phase).toBe('connected')
  })
})
