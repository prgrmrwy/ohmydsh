import { describe, expect, it } from 'vitest'
import type { NetworkVerdict } from '../src/contract.js'
import { SessionBindings } from '../src/client/bindings.js'
import { ComposerGuardController, type ReasonBlock, type SessionGuardDeps } from '../src/client/guard.js'

/**
 * These cases pin the lifetime defect that shipped as "switching the model away
 * from Claude left the composer blocked until a page reload".
 *
 * The runtime replaces a session's `ModelDirectory` (and its store) whenever the
 * client Session scope is retired and materialized again — navigating away and
 * back is enough. The official composer seat re-resolves the directory on every
 * mount, so it renders the new store; a guard that resolved it once and kept the
 * old subscription stopped reacting forever. The fakes below model exactly that:
 * `retire()` drops the current scope's directory, `retain()` hands out a NEW one
 * for the same session id.
 */

const REASON = 'REASON'
const CLAUDE = { provider: 'claude', model: 'claude-opus-5-5' }
const SOL = { provider: 'codex', model: 'gpt-6.1-sol' }

interface Selection {
  provider: string
  model: string
}

/** One session's model-directory store, with the runtime's sync publish. */
class FakeStore {
  public readonly listeners = new Set<() => void>()
  public readonly history: Selection[] = []

  public constructor(public selection: Selection, public routable = true) {
    this.history.push(selection)
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** A model switch the store publishes (the live-subscription path). */
  public select(selection: Selection): void {
    this.selection = selection
    this.history.push(selection)
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * The runtime side: at most one directory per session, replaced whenever the
 * client session generation is replaced.
 */
class FakeRuntime {
  private readonly stores = new Map<string, FakeStore>()

  /** Retire the current client scope (e.g. navigating to another session). */
  public retire(sessionId: string): void {
    this.stores.delete(sessionId)
  }

  /** Materialize a fresh scope, with a brand-new directory for the same id. */
  public retain(sessionId: string, selection: Selection, routable = true): FakeStore {
    const store = new FakeStore(selection, routable)
    this.stores.set(sessionId, store)
    return store
  }

  public tryStore(sessionId: string): FakeStore | undefined {
    return this.stores.get(sessionId)
  }

  public storeFor(sessionId: string): FakeStore {
    const store = this.stores.get(sessionId)
    if (store === undefined) throw new Error(`no retained client scope for ${sessionId}`)
    return store
  }
}

/** The guard plus the binding registry, wired the way the client plugin wires them. */
class Harness {
  public readonly runtime = new FakeRuntime()
  public readonly blocks = new Map<string, ReasonBlock | undefined>()
  public readonly blockSubscribers = new Map<string, Set<() => void>>()
  public network: NetworkVerdict = 'blocked'

  public readonly deps: SessionGuardDeps = {
    network: () => this.network,
    // `read` resolves the CURRENT directory on every call, exactly like the
    // wiring layer's `directoryFor` lookup.
    read: (id) => {
      const store = this.runtime.tryStore(id)
      if (store === undefined) return undefined
      return { selection: store.selection, routable: store.routable }
    },
    blockOf: (id) => this.blocks.get(id),
    setBlock: (id, block) => {
      const current = this.blocks.get(id)
      // The runtime registry is idempotent for an equal reason.
      if (current?.reason === block?.reason) return
      if (block === undefined) this.blocks.delete(id)
      else this.blocks.set(id, block)
      for (const listener of [...(this.blockSubscribers.get(id) ?? [])]) listener()
    },
    reason: () => REASON,
  }

  public readonly guard = new ComposerGuardController(this.deps)

  public readonly bindings = new SessionBindings({
    storeFor: (id) => this.runtime.storeFor(id),
    subscribeStore: (store, onChange) => store.subscribe(onChange),
    subscribeBlocks: (id) => {
      const listeners = this.blockSubscribers.get(id) ?? new Set<() => void>()
      this.blockSubscribers.set(id, listeners)
      const listener = (): void => this.guard.onBlockStoreChanged(id)
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    evaluate: (id) => this.guard.evaluate(id),
    dispose: (id) => this.guard.dispose(id),
  })
}

describe('SessionBindings', () => {
  it('binds a live session to its current store and blocks a Claude selection', () => {
    const h = new Harness()
    h.runtime.retain('s1', CLAUDE)

    h.bindings.sync(['s1'])

    expect(h.bindings.ids()).toEqual(['s1'])
    expect(h.blocks.get('s1')?.reason).toBe(REASON)
  })

  it('keeps following the session model after the client session generation is replaced', () => {
    const h = new Harness()
    h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])
    expect(h.blocks.get('s1')?.reason).toBe(REASON)

    // Navigating away retires the scope; the session row stays in the list.
    h.runtime.retire('s1')
    h.bindings.sync(['s1'])
    expect(h.blocks.get('s1')?.reason).toBe(REASON) // our claim is kept, not stranded

    // Coming back materializes a new scope whose store already holds the model
    // the user switched to while away.
    h.runtime.retain('s1', SOL)
    h.bindings.sync(['s1'])
    expect(h.blocks.has('s1')).toBe(false)

    // The binding now listens to the NEW store: no further sync is needed for
    // the next switch to be honoured.
    h.runtime.storeFor('s1').select(CLAUDE)
    expect(h.blocks.get('s1')?.reason).toBe(REASON)
  })

  it('re-subscribes instead of listening to the retired store', () => {
    const h = new Harness()
    const stale = h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])

    h.runtime.retire('s1')
    const fresh = h.runtime.retain('s1', SOL)
    h.bindings.sync(['s1'])

    expect(stale.listeners.size).toBe(0)
    expect(fresh.listeners.size).toBe(1)

    // A published switch on the replacement store reaches the guard.
    fresh.select(CLAUDE)
    expect(h.blocks.get('s1')?.reason).toBe(REASON)
    fresh.select(SOL)
    expect(h.blocks.has('s1')).toBe(false)
  })

  it('re-decides on every reconcile, so a change no subscription reported still heals', () => {
    const h = new Harness()
    const store = h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])
    expect(h.blocks.get('s1')?.reason).toBe(REASON)

    // An unchanged store costs one resolution and one decision, never a second
    // subscription.
    expect(h.bindings.reconsider('s1')).toBe('unchanged')
    expect(store.listeners.size).toBe(1)

    // A state change that never reached our subscription (the class of signal
    // that was dropped before) is picked up by the next reconcile.
    store.selection = SOL
    h.bindings.sync(['s1'])
    expect(h.blocks.has('s1')).toBe(false)
  })

  it('binds unavailable ids later and never subscribes to them early', () => {
    const h = new Harness()
    h.bindings.sync(['s1'])
    expect(h.bindings.ids()).toEqual([])
    expect(h.blockSubscribers.size).toBe(0)

    h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])
    expect(h.blocks.get('s1')?.reason).toBe(REASON)
  })

  it('keeps one block-slot subscription per session across generations', () => {
    const h = new Harness()
    h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])
    const listeners = h.blockSubscribers.get('s1')
    expect(listeners?.size).toBe(1)

    h.runtime.retire('s1')
    h.runtime.retain('s1', SOL)
    h.bindings.sync(['s1'])

    expect(h.blockSubscribers.get('s1')).toBe(listeners)
    expect(listeners?.size).toBe(1)
  })

  it('releases sessions that left the list, dropping our block and both subscriptions', () => {
    const h = new Harness()
    const first = h.runtime.retain('s1', CLAUDE)
    h.runtime.retain('s2', CLAUDE)
    h.bindings.sync(['s1', 's2'])
    expect(h.blocks.get('s1')?.reason).toBe(REASON)
    expect(h.blocks.get('s2')?.reason).toBe(REASON)

    h.bindings.sync(['s2'])

    expect(h.bindings.ids()).toEqual(['s2'])
    expect(first.listeners.size).toBe(0)
    expect(h.blocks.has('s1')).toBe(false)
    expect(h.blockSubscribers.get('s1')?.size ?? 0).toBe(0)
  })

  it('reverifies bound sessions when the session list cannot be read', () => {
    const h = new Harness()
    const store = h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])

    store.selection = SOL
    h.bindings.reverify()
    expect(h.blocks.has('s1')).toBe(false)
  })

  it('stop() releases every binding', () => {
    const h = new Harness()
    const store = h.runtime.retain('s1', CLAUDE)
    h.bindings.sync(['s1'])

    h.bindings.stop()

    expect(h.bindings.ids()).toEqual([])
    expect(store.listeners.size).toBe(0)
    expect(h.blocks.has('s1')).toBe(false)
  })
})
