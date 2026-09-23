/**
 * The browse-address extension point and the launcher that drives it.
 *
 * The rule worth guarding: a registrant's failure MUST NOT fall back to the
 * local address. That fallback looks harmless but is the exact bug the
 * extension point exists to remove — in a cross-machine deployment
 * `localhost:<port>` resolves on the *user's* machine and silently opens
 * whatever happens to listen there.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createBrowseAddressRegistry,
  localBrowseAddress,
  type MemexBrowseAddressRegistry,
} from '../src/client/browse-address.js'
import { launcherScope, runLauncher, type LauncherDeps } from '../src/client/launcher.js'

function depsWith(options: {
  browse?: unknown
  browseError?: Error
  addresses?: MemexBrowseAddressRegistry
}): LauncherDeps {
  return {
    request: async () => {
      if (options.browseError !== undefined) throw options.browseError
      return options.browse
    },
    addresses: options.addresses ?? createBrowseAddressRegistry(),
  }
}

describe('browse address registry', () => {
  it('gives the local address when nothing is registered', async () => {
    const registry = createBrowseAddressRegistry()
    await expect(registry.resolve({ scope: 'personal', port: 3939 })).resolves.toBe('http://localhost:3939')
    expect(localBrowseAddress(3939)).toBe('http://localhost:3939')
  })

  it('prefers a registrant, including one that registers later', async () => {
    const registry = createBrowseAddressRegistry()
    // Resolution is read at call time, so a registrant that loads after the
    // page still takes effect for subsequent opens.
    registry.register(async ({ port }) => `http://127.0.0.1:${port + 1000}`)
    await expect(registry.resolve({ scope: 'personal', port: 3939 })).resolves.toBe('http://127.0.0.1:4939')
  })

  it('restores the default after the registrant is removed', async () => {
    const registry = createBrowseAddressRegistry()
    const dispose = registry.register(async () => 'http://host.example:1')
    await expect(registry.resolve({ scope: 'p', port: 10 })).resolves.toBe('http://host.example:1')
    dispose()
    await expect(registry.resolve({ scope: 'p', port: 10 })).resolves.toBe('http://localhost:10')
  })

  it('a stale disposer does not disable a newer registrant', async () => {
    const registry = createBrowseAddressRegistry()
    const disposeFirst = registry.register(async () => 'http://first:1')
    registry.register(async () => 'http://second:2')
    disposeFirst()
    await expect(registry.resolve({ scope: 'p', port: 10 })).resolves.toBe('http://second:2')
  })

  it('propagates a registrant failure instead of using the local address', async () => {
    const registry = createBrowseAddressRegistry()
    registry.register(async () => { throw new Error('no route from this browser') })
    await expect(registry.resolve({ scope: 'p', port: 10 })).rejects.toThrow('no route from this browser')

    const empty = createBrowseAddressRegistry()
    empty.register(async () => '')
    await expect(empty.resolve({ scope: 'p', port: 10 })).rejects.toThrow(/could not be resolved/)
  })
})

describe('launcher route', () => {
  it('recognizes only its own hash route', () => {
    expect(launcherScope('#/dsh-memex/browse/personal')).toBe('personal')
    expect(launcherScope('#/dsh-memex/browse/with%20space')).toBe('with space')
    expect(launcherScope('#/dsh-memex/browse/')).toBeUndefined()
    expect(launcherScope('#/settings')).toBeUndefined()
    expect(launcherScope('')).toBeUndefined()
  })
})

describe('launcher run', () => {
  it('resolves an address once the host reports a port', async () => {
    const outcome = await runLauncher('personal', depsWith({ browse: { status: 'ok', port: 3939, scope: 'personal' } }))
    expect(outcome).toEqual({ status: 'ready', address: 'http://localhost:3939' })
  })

  it('passes the registrant address through', async () => {
    const addresses = createBrowseAddressRegistry()
    addresses.register(async ({ scope, port }) => `http://127.0.0.1:54321/?from=${scope}&p=${port}`)
    const outcome = await runLauncher('personal', depsWith({
      browse: { status: 'ok', port: 3939, scope: 'personal' },
      addresses,
    }))
    expect(outcome.status).toBe('ready')
    expect(outcome.address).toBe('http://127.0.0.1:54321/?from=personal&p=3939')
  })

  it('surfaces a host refusal verbatim and navigates nowhere', async () => {
    const outcome = await runLauncher('personal', depsWith({
      browse: { status: 'refused', reason: 'memory-off', message: 'Memory is off for this workspace; turn it back on in Settings → 记忆.' },
    }))
    expect(outcome.status).toBe('failed')
    expect(outcome.address).toBeUndefined()
    expect(outcome.message).toMatch(/Memory is off/)
  })

  it('never yields the local address when the registrant fails', async () => {
    const addresses = createBrowseAddressRegistry()
    addresses.register(async () => { throw new Error('the forward could not be established') })
    const outcome = await runLauncher('personal', depsWith({
      browse: { status: 'ok', port: 3939, scope: 'personal' },
      addresses,
    }))
    expect(outcome.status).toBe('failed')
    expect(outcome.address).toBeUndefined()
    // The whole point: no localhost address leaks out on this path.
    expect(JSON.stringify(outcome)).not.toContain('localhost')
    expect(outcome.message).toMatch(/forward could not be established/)
  })

  it('reports an unreachable host as a failure, not a refusal', async () => {
    const outcome = await runLauncher('personal', depsWith({ browseError: new Error('channel unavailable') }))
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(outcome.message).toMatch(/channel unavailable/)
  })

  it('does not trust a malformed answer', async () => {
    for (const browse of [undefined, null, 'nope', {}]) {
      const outcome = await runLauncher('personal', depsWith({ browse }))
      expect(outcome.status).toBe('failed')
      expect(outcome.address).toBeUndefined()
    }
  })

  it('asks the host before resolving an address', async () => {
    const order: string[] = []
    const addresses = createBrowseAddressRegistry()
    addresses.register(async () => { order.push('resolve'); return 'http://host:1' })
    await runLauncher('personal', {
      request: async () => { order.push('host'); return { status: 'ok', port: 1, scope: 'personal' } },
      addresses,
    })
    expect(order).toEqual(['host', 'resolve'])
  })
})

describe('launcher deps', () => {
  it('unwraps the channel envelope and turns a rejection into an error', async () => {
    const { createLauncherDeps } = await import('../src/client/launcher.js')
    const ok = createLauncherDeps({ call: vi.fn(async () => ({ ok: true, value: { status: 'ok', port: 7 } })) }, createBrowseAddressRegistry())
    await expect(ok.request('browse', {})).resolves.toEqual({ status: 'ok', port: 7 })

    const bad = createLauncherDeps({ call: vi.fn(async () => ({ ok: false, error: { message: 'boom' } })) }, createBrowseAddressRegistry())
    await expect(bad.request('browse', {})).rejects.toThrow('boom')
  })
})
