import { describe, expect, it, vi } from 'vitest'
import { apply, MEMEX_BROWSE_ADDRESS_SERVICE, FORWARD_READY_TIMEOUT_MS } from '../src/client/index.ts'
import { createBrowseAddressRegistry } from '../../dsh-memex/src/client/browse-address.ts'

function fixture() {
  const services = new Map<string, unknown>()
  const listeners = new Set<(name: string) => void>()
  let cleanup: (() => void) | undefined
  const reads: string[] = []
  const ctx = {
    get(name: string) { reads.push(name); return services.get(name) },
    on(_name: string, listener: (name: string) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    effect(callback: () => () => void) { cleanup = callback() },
  }
  const provide = (name: string, value: unknown) => {
    services.set(name, value)
    for (const listener of listeners) listener(name)
  }
  const registry = createBrowseAddressRegistry()
  const resolve = (port = 3940) => registry.resolve({ scope: 'personal', port })
  return { ctx, provide, registry, resolve, reads, cleanup: () => cleanup?.() }
}

function forward(state = 'ready', url = 'http://127.0.0.1:54321') {
  const listeners = new Set<() => void>()
  const handle = {
    devicePort: 3940, holder: 'memex-browse-3940', state,
    address: state === 'ready' ? { url } : undefined as { url: string } | undefined,
    onChange: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  const service = { acquire: vi.fn(async () => handle), release: vi.fn(async () => undefined) }
  const change = (next: string, nextUrl = url) => {
    handle.state = next
    handle.address = next === 'ready' ? { url: nextUrl } : undefined
    for (const listener of [...listeners]) listener()
  }
  return { service, handle, change, listeners }
}

function wire(f: ReturnType<typeof fixture>, service: unknown) {
  apply(f.ctx as never)
  f.provide('cockpitBridge.forwards', service)
  f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, f.registry)
}

// Use the real registry: a fake that throws when unregistered hides localhost misrouting.
describe('bridge 0.6.1 forwards consumer', () => {
  it('uses the only new service rather than silently resolving remote ports to localhost', async () => {
    const f = fixture(), b = forward()
    wire(f, b.service)
    try {
      await expect(f.resolve()).resolves.toBe('http://127.0.0.1:54321')
      expect(b.service.acquire).toHaveBeenCalledWith(3940, expect.stringMatching(/^memex-browse-3940-[a-f0-9]{32}$/))
      expect(b.service.release).not.toHaveBeenCalled()
    } finally { f.cleanup() }
  })

  it('keeps memex-only deployments local and reads complete dotted names', async () => {
    const f = fixture()
    wire(f, undefined)
    await expect(f.resolve()).resolves.toBe('http://localhost:3940')
    expect(f.reads).toContain('cockpitBridge.forwards')
    expect(f.reads.some(name => name === 'cockpitBridge' || name === 'dshMemex')).toBe(false)
    f.cleanup()
  })

  it('supports memex first, then bridge', async () => {
    const f = fixture(), b = forward()
    apply(f.ctx as never)
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, f.registry)
    f.provide('cockpitBridge.forwards', b.service)
    await expect(f.resolve()).resolves.toBe(b.handle.address!.url)
    f.cleanup()
  })

  it('single-flights concurrent clicks, waits for ready and retains the holder', async () => {
    const f = fixture(), b = forward('starting')
    wire(f, b.service)
    const first = f.resolve(), second = f.resolve()
    await vi.waitFor(() => expect(b.listeners.size).toBe(2))
    expect(b.service.acquire).toHaveBeenCalledTimes(1)
    b.change('ready')
    await expect(first).resolves.toBe(b.handle.address!.url)
    await expect(second).resolves.toBe(b.handle.address!.url)
    expect(b.listeners.size).toBe(0)
    expect(b.service.release).not.toHaveBeenCalled()
    b.change('retrying')
    const reopened = f.resolve()
    await vi.waitFor(() => expect(b.listeners.size).toBe(1))
    b.change('ready', 'http://127.0.0.1:54322')
    await expect(reopened).resolves.toBe('http://127.0.0.1:54322')
    expect(b.service.acquire).toHaveBeenCalledTimes(1)
    f.cleanup()
    await vi.waitFor(() => expect(b.service.release).toHaveBeenCalledWith(b.handle))
  })

  it.each(['starting', 'retrying', 'paused'])('bounds %s waits and cleans listeners/timers', async state => {
    vi.useFakeTimers()
    const f = fixture(), b = forward(state)
    wire(f, b.service)
    try {
      const result = expect(f.resolve()).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(FORWARD_READY_TIMEOUT_MS)
      await result
      expect(b.listeners.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally { f.cleanup(); vi.useRealTimers() }
  })

  it('rejects removed without auto-acquire; explicit reopen may acquire anew', async () => {
    const f = fixture(), b = forward('starting')
    wire(f, b.service)
    const result = expect(f.resolve()).rejects.toThrow(/removed/)
    await vi.waitFor(() => expect(b.listeners.size).toBe(1))
    b.change('removed')
    await result
    expect(b.service.acquire).toHaveBeenCalledTimes(1)
    expect(b.listeners.size).toBe(0)
    b.change('ready')
    await expect(f.resolve()).resolves.toBe(b.handle.address!.url)
    expect(b.service.acquire).toHaveBeenCalledTimes(2)
    f.cleanup()
  })

  it('reacquires on the first click after an idle ready handle was removed', async () => {
    const f = fixture(), b = forward(), next = forward('ready', 'http://127.0.0.1:54322')
    wire(f, b.service)
    await f.resolve()
    b.change('removed')
    b.service.acquire.mockResolvedValue(next.handle)
    expect(b.service.acquire).toHaveBeenCalledTimes(1)
    await expect(f.resolve()).resolves.toBe('http://127.0.0.1:54322')
    expect(b.service.acquire).toHaveBeenCalledTimes(2)
    f.cleanup()
  })

  it.each(['unavailable', 'request-failed', 'device-unavailable', 'forward-limit'])('propagates %s rather than localhost', async code => {
    const f = fixture()
    const error = Object.assign(new Error(code), { name: 'CockpitForwardsError', code })
    wire(f, { acquire() { throw error }, release: vi.fn() })
    await expect(f.resolve()).rejects.toBe(error)
    f.cleanup()
  })

  it('falls back only on the new structured local-device error', async () => {
    const f = fixture()
    wire(f, { acquire() { throw Object.assign(new Error(), { name: 'CockpitForwardsError', code: 'local-device' }) } })
    await expect(f.resolve()).resolves.toBe('http://localhost:3940')
    f.provide('cockpitBridge.forwards', { acquire() { throw new Error('local-device') } })
    await expect(f.resolve()).rejects.toThrow('local-device')
    f.cleanup()
  })

  it('bridge disappearance fails closed through the real registry and cancels pending clicks', async () => {
    const f = fixture(), b = forward('starting')
    wire(f, b.service)
    const result = expect(f.resolve()).rejects.toThrow(/unavailable/)
    await vi.waitFor(() => expect(b.listeners.size).toBe(1))
    f.provide('cockpitBridge.forwards', undefined)
    await result
    await expect(f.resolve()).rejects.toThrow(/unavailable/)
    expect(b.listeners.size).toBe(0)
    await vi.waitFor(() => expect(b.service.release).toHaveBeenCalledWith(b.handle))
    f.cleanup()
  })

  it('releases late acquire through its original service on replacement', async () => {
    const f = fixture(), old = forward(), next = forward('ready', 'http://127.0.0.1:54322')
    let complete!: (handle: typeof old.handle) => void
    old.service.acquire.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    wire(f, old.service)
    const result = expect(f.resolve()).rejects.toThrow(/unavailable/)
    await vi.waitFor(() => expect(old.service.acquire).toHaveBeenCalledTimes(1))
    f.provide('cockpitBridge.forwards', next.service)
    await result
    complete(old.handle)
    await expect(f.resolve()).resolves.toBe('http://127.0.0.1:54322')
    await vi.waitFor(() => expect(old.service.release).toHaveBeenCalledWith(old.handle))
    expect(next.service.release).not.toHaveBeenCalled()
    f.cleanup()
  })

  it('registry replacement uses a distinct holder and releases old resources', async () => {
    const f = fixture(), b = forward()
    wire(f, b.service)
    await f.resolve()
    const next = createBrowseAddressRegistry()
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, next)
    await next.resolve({ scope: 'personal', port: 3940 })
    expect(b.service.acquire.mock.calls[0]).not.toEqual(b.service.acquire.mock.calls[1])
    await expect(f.resolve()).resolves.toBe('http://localhost:3940')
    await vi.waitFor(() => expect(b.service.release).toHaveBeenCalledTimes(1))
    f.cleanup()
  })

  it('dispose cancels a wait and restores the registry default; release failures are handled', async () => {
    const f = fixture(), b = forward('starting')
    b.service.release.mockRejectedValue(new Error('bridge already stopped'))
    wire(f, b.service)
    const result = expect(f.resolve()).rejects.toThrow(/unavailable/)
    await vi.waitFor(() => expect(b.listeners.size).toBe(1))
    f.cleanup()
    await result
    expect(b.listeners.size).toBe(0)
    await expect(f.resolve()).resolves.toBe('http://localhost:3940')
    await vi.waitFor(() => expect(b.service.release).toHaveBeenCalledTimes(1))
  })
})
