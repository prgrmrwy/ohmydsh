import { describe, expect, it, vi } from 'vitest'
import {
  COCKPIT_PORT_FORWARD_SERVICE,
  MEMEX_BROWSE_ADDRESS_SERVICE,
  apply,
  browseChannelId,
} from '../src/client/index.ts'

type Listener = (name: string, value: unknown) => void

function fixture() {
  const services = new Map<string, unknown>()
  const listeners = new Set<Listener>()
  let cleanup: (() => void) | undefined
  const reads: string[] = []
  const ctx = {
    get(name: string) {
      reads.push(name)
      return services.get(name)
    },
    on(name: string, listener: Listener) {
      expect(name).toBe('internal/service')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    effect(callback: () => () => void) {
      cleanup = callback()
    },
  }
  const provide = (name: string, value: unknown) => {
    if (value === undefined) services.delete(name)
    else services.set(name, value)
    for (const listener of listeners) listener(name, value)
  }
  return { ctx, provide, reads, cleanup: () => cleanup?.() }
}

function registryFixture() {
  let resolver: ((target: { scope: string; port: number }) => Promise<string>) | undefined
  const unregister = vi.fn(() => { resolver = undefined })
  return {
    registry: {
      register: vi.fn((next: (target: { scope: string; port: number }) => Promise<string>) => {
        resolver = next
        return unregister
      }),
    },
    unregister,
    resolve: (scope: string, port: number) => {
      if (resolver === undefined) throw new Error('no resolver registered')
      return resolver({ scope, port })
    },
    registered: () => resolver !== undefined,
  }
}

function forwardFixture(url = 'http://127.0.0.1:54321') {
  const calls: Array<[string, number?]> = []
  return {
    calls,
    forward: {
      register: vi.fn(async (channelId: string, devicePort: number) => { calls.push([channelId, devicePort]) }),
      publish: vi.fn(async (channelId: string) => { calls.push([channelId]); return { url } }),
    },
  }
}

describe('browseChannelId', () => {
  it('gives each library its own channel', () => {
    expect(browseChannelId('personal')).toBe('memex-browse-personal')
    expect(browseChannelId('aiby-dev-infra-server')).toBe('memex-browse-aiby-dev-infra-server')
    expect(browseChannelId('personal')).not.toBe(browseChannelId('other'))
  })

  it('keeps distinct names distinct after sanitizing', () => {
    // Replacing rather than dropping unusual characters is what stops two
    // different libraries from collapsing onto one forward.
    expect(browseChannelId('a/b')).not.toBe(browseChannelId('ab'))
    expect(browseChannelId('a/b')).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})

describe('cockpit memex browse shim', () => {
  it('does nothing while only one side exists', () => {
    const f = fixture()
    const registry = registryFixture()
    apply(f.ctx as never)
    expect(registry.registered()).toBe(false)

    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, registry.registry)
    expect(registry.registry.register).not.toHaveBeenCalled()
    f.cleanup()
  })

  it('wires both sides once each is live, in either order', async () => {
    const f = fixture()
    const registry = registryFixture()
    const forward = forwardFixture()

    apply(f.ctx as never)
    // Cockpit side first, memex side later: load order must not matter.
    f.provide(COCKPIT_PORT_FORWARD_SERVICE, forward.forward)
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, registry.registry)

    expect(registry.registry.register).toHaveBeenCalledTimes(1)
    await expect(registry.resolve('personal', 3940)).resolves.toBe('http://127.0.0.1:54321')
    // Declare then publish, both for this library's own channel.
    expect(forward.calls).toEqual([['memex-browse-personal', 3940], ['memex-browse-personal']])
    f.cleanup()
  })

  it('reads each service by its full dotted name in one call', () => {
    const f = fixture()
    apply(f.ctx as never)
    // ctx.get('a').b would be rerouted through the context proxy and enforce
    // inject, turning this optional seam into an uncaught rejection.
    expect(f.reads).toContain(MEMEX_BROWSE_ADDRESS_SERVICE)
    expect(f.reads).toContain(COCKPIT_PORT_FORWARD_SERVICE)
    expect(f.reads.some(name => name === 'cockpitBridge' || name === 'dshMemex')).toBe(false)
    f.cleanup()
  })

  it('detaches when either side goes away', () => {
    const f = fixture()
    const registry = registryFixture()
    const forward = forwardFixture()
    apply(f.ctx as never)
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, registry.registry)
    f.provide(COCKPIT_PORT_FORWARD_SERVICE, forward.forward)
    expect(registry.registered()).toBe(true)

    f.provide(COCKPIT_PORT_FORWARD_SERVICE, undefined)
    expect(registry.unregister).toHaveBeenCalledTimes(1)
    expect(registry.registered()).toBe(false)
    f.cleanup()
  })

  it('fails the resolution instead of answering once the bridge is gone', async () => {
    const f = fixture()
    const registry = registryFixture()
    const forward = forwardFixture()
    apply(f.ctx as never)
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, registry.registry)
    f.provide(COCKPIT_PORT_FORWARD_SERVICE, forward.forward)

    const resolver = registry.registry.register.mock.calls[0]![0]
    // Simulate the service vanishing between registration and the click
    // WITHOUT the removal event reaching us: the resolver must still refuse.
    f.provide(COCKPIT_PORT_FORWARD_SERVICE, undefined)
    await expect(resolver({ scope: 'personal', port: 3940 })).rejects.toThrow(/unavailable/)
    f.cleanup()
  })

  it('propagates a cockpit failure rather than inventing an address', async () => {
    const f = fixture()
    const registry = registryFixture()
    const failing = {
      register: vi.fn(async () => { throw new Error('too many publishable channels') }),
      publish: vi.fn(),
    }
    apply(f.ctx as never)
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, registry.registry)
    f.provide(COCKPIT_PORT_FORWARD_SERVICE, failing)

    await expect(registry.resolve('personal', 3940)).rejects.toThrow(/too many publishable channels/)
    expect(failing.publish).not.toHaveBeenCalled()
    f.cleanup()
  })

  it('unregisters on dispose', () => {
    const f = fixture()
    const registry = registryFixture()
    const forward = forwardFixture()
    apply(f.ctx as never)
    f.provide(MEMEX_BROWSE_ADDRESS_SERVICE, registry.registry)
    f.provide(COCKPIT_PORT_FORWARD_SERVICE, forward.forward)

    f.cleanup()
    expect(registry.unregister).toHaveBeenCalled()
  })
})
