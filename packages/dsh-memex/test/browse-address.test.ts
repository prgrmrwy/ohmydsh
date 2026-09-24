/**
 * The browse-address extension point and the open flow that drives it.
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
import { openBrowseTab, type BrowseOpenDeps, type OpenedTab } from '../src/client/browse-open.js'

/** A stand-in for the blank tab opened inside the click. */
function fakeTab(): OpenedTab & { navigated: string[]; painted: string[]; closedFlag: boolean } {
  const tab = {
    navigated: [] as string[],
    painted: [] as string[],
    closedFlag: false,
    location: { replace(url: string) { tab.navigated.push(url) } },
    get closed() { return tab.closedFlag },
    document: { body: { style: { cssText: '' }, set textContent(v: string) { tab.painted.push(v) }, get textContent() { return '' } } } as unknown as Document,
  }
  return tab
}

function depsWith(options: {
  browse?: unknown
  browseError?: Error
  addresses?: MemexBrowseAddressRegistry
  tab?: OpenedTab | null
}): BrowseOpenDeps {
  return {
    request: async () => {
      if (options.browseError !== undefined) throw options.browseError
      return options.browse
    },
    addresses: options.addresses ?? createBrowseAddressRegistry(),
    openTab: () => (options.tab === undefined ? fakeTab() : options.tab),
    t: (key, params) => `${key}:${params?.scope ?? ''}`,
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


describe('open browse tab', () => {
  it('opens the tab before any await, so the popup is not blocked', async () => {
    // The tab must be requested synchronously inside the click; if it were
    // opened after resolving, the browser would have dropped the activation.
    const order: string[] = []
    const tab = fakeTab()
    await openBrowseTab('personal', {
      request: async () => { order.push('host'); return { status: 'ok', port: 3939, scope: 'personal' } },
      addresses: createBrowseAddressRegistry(),
      openTab: () => { order.push('open'); return tab },
      t: key => key,
    })
    expect(order).toEqual(['open', 'host'])
    expect(tab.navigated).toEqual(['http://localhost:3939'])
  })

  it('navigates the tab to a registrant-provided address', async () => {
    const addresses = createBrowseAddressRegistry()
    addresses.register(async ({ scope, port }) => `http://127.0.0.1:54321/?s=${scope}&p=${port}`)
    const tab = fakeTab()
    const outcome = await openBrowseTab('personal', depsWith({
      browse: { status: 'ok', port: 3939, scope: 'personal' },
      addresses,
      tab,
    }))
    expect(outcome.status).toBe('opened')
    expect(tab.navigated).toEqual(['http://127.0.0.1:54321/?s=personal&p=3939'])
  })

  it('reports a host refusal into the tab and navigates nowhere', async () => {
    const tab = fakeTab()
    const outcome = await openBrowseTab('personal', depsWith({
      browse: { status: 'refused', reason: 'memory-off', message: 'Memory is off for this workspace.' },
      tab,
    }))
    expect(outcome.status).toBe('failed')
    expect(tab.navigated).toEqual([])
    expect(tab.painted.join('\n')).toMatch(/Memory is off/)
  })

  it('never navigates to the local address when the registrant fails', async () => {
    // The whole reason the registrant exists: on another machine the local
    // address resolves against the USER's machine.
    const addresses = createBrowseAddressRegistry()
    addresses.register(async () => { throw new Error('cockpit port forward is unavailable') })
    const tab = fakeTab()
    const outcome = await openBrowseTab('personal', depsWith({
      browse: { status: 'ok', port: 3939, scope: 'personal' },
      addresses,
      tab,
    }))
    expect(outcome.status).toBe('failed')
    expect(tab.navigated).toEqual([])
    expect(JSON.stringify(tab.painted)).not.toContain('localhost')
    expect(tab.painted.join('\n')).toMatch(/unavailable/)
  })

  it('reports a blocked popup instead of failing silently', async () => {
    const outcome = await openBrowseTab('personal', depsWith({
      browse: { status: 'ok', port: 3939, scope: 'personal' },
      tab: null,
    }))
    expect(outcome).toMatchObject({ status: 'blocked' })
  })

  it('does not navigate a tab the user already closed', async () => {
    const tab = fakeTab()
    tab.closedFlag = true
    const outcome = await openBrowseTab('personal', depsWith({
      browse: { status: 'ok', port: 3939, scope: 'personal' },
      tab,
    }))
    expect(outcome.status).toBe('failed')
    expect(tab.navigated).toEqual([])
  })

  it('does not trust a malformed answer', async () => {
    for (const browse of [undefined, null, 'nope', {}]) {
      const tab = fakeTab()
      const outcome = await openBrowseTab('personal', depsWith({ browse, tab }))
      expect(outcome.status).toBe('failed')
      expect(tab.navigated).toEqual([])
    }
  })
})
