import { describe, expect, it, vi } from 'vitest'
import { CarrierError } from '../src/host/carrier/http.js'
import { waitForRc2Readiness } from '../src/host/connectivity.js'

const supported = {
  compatibility: 'SUPPORTED' as const,
  version: '0.0.1',
  capabilities: new Set(),
  diagnostic: 'fixture supported',
}

describe('catchable shutdown is terminal', () => {
  it('stops reconnecting and spawns no further owned ssh children after a signal', async () => {
    const { bindCatchableShutdown } = await import('../src/host/node-lifecycle.js')
    let disposedAll = 0
    let aborted = false
    // Models the production pair: the signal disposer must reach the whole
    // connection lifecycle, not just the tunnel manager, or the per-node
    // reconnect loop keeps launching new ssh children after cleanup ran.
    const connections = {
      tunnels: { disposeAll: async () => { disposedAll += 1 } },
      dispose: async () => { aborted = true },
    }
    const listeners = new Map<string, (() => void)[]>()
    const source = {
      on(signal: 'SIGINT' | 'SIGTERM', listener: () => void) {
        listeners.set(signal, [...(listeners.get(signal) ?? []), listener])
      },
      off(signal: 'SIGINT' | 'SIGTERM', listener: () => void) {
        listeners.set(signal, (listeners.get(signal) ?? []).filter(entry => entry !== listener))
      },
    }

    const unbind = bindCatchableShutdown(connections as never, source)
    for (const listener of listeners.get('SIGTERM') ?? []) listener()
    await vi.waitFor(() => {
      expect(aborted).toBe(true)
      expect(disposedAll).toBe(1)
    })

    // Idempotent: a second signal must not repeat disposal.
    for (const listener of listeners.get('SIGTERM') ?? []) listener()
    expect(disposedAll).toBe(1)

    unbind()
    expect(listeners.get('SIGTERM')).toEqual([])
    expect(listeners.get('SIGINT')).toEqual([])
  })
})

describe('startup-window signal safety', () => {
  it('releases already-spawned tunnels and keeps the latch armed while the owner is still starting', async () => {
    const { bindCatchableShutdown } = await import('../src/host/node-lifecycle.js')
    let disposeAllCalls = 0
    let ownerDisposed = 0
    let ownerExists = false
    const listeners: (() => void)[] = []
    const source = {
      on: (_signal: 'SIGINT' | 'SIGTERM', listener: () => void) => { listeners.push(listener) },
      off: () => {},
    }

    bindCatchableShutdown({
      tunnels: { disposeAll: async () => { disposeAllCalls += 1 } },
      ready: () => ownerExists,
      dispose: async () => { ownerDisposed += 1 },
    }, source)

    // A signal inside the startup window must still release spawned children.
    listeners[0]!()
    await vi.waitFor(() => expect(disposeAllCalls).toBe(1))
    expect(ownerDisposed).toBe(0)

    // Critically, that no-op-owner signal must NOT consume the one-shot latch:
    // otherwise every later signal is silently ignored.
    ownerExists = true
    listeners[0]!()
    await vi.waitFor(() => {
      expect(ownerDisposed).toBe(1)
      expect(disposeAllCalls).toBe(2)
    })
  })
})

describe('rc.2 tunnel readiness', () => {
  it('waits through an initial transport refusal while the owned SSH listener starts', async () => {
    let attempts = 0
    const result = await waitForRc2Readiness(new URL('http://127.0.0.1:49152'), new AbortController().signal, {
      retryDelayMs: 1,
      probe: async () => {
        attempts += 1
        if (attempts === 1) throw new CarrierError('Transport', 'fetch failed', true)
        return supported
      },
    })
    expect(attempts).toBe(2)
    expect(result).toMatchObject({ ok: true, state: 'READY' })
  })

  it('fails immediately on protocol faults instead of retrying an unrelated service', async () => {
    let attempts = 0
    const result = await waitForRc2Readiness(new URL('http://127.0.0.1:49152'), new AbortController().signal, {
      retryDelayMs: 1,
      probe: async () => {
        attempts += 1
        throw new CarrierError('Protocol', 'response envelope mismatch', false)
      },
    })
    expect(attempts).toBe(1)
    expect(result).toMatchObject({ ok: false, state: 'NON_DSH_SERVICE', diagnostic: 'response envelope mismatch' })
  })
})
