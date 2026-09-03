import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkVerdict } from '../src/contract.js'
import { ComposerGuardController, type ReasonBlock, type SessionGuardDeps } from '../src/client/guard.js'

/**
 * In-memory fake of the composer-block slot + wiring deps, recording every
 * setBlock call so coexistence semantics are observable.
 */
class FakeWiring {
  public readonly blocks = new Map<string, ReasonBlock | undefined>()
  public readonly setCalls: Array<{ session: string; block: ReasonBlock | undefined }> = []
  public readonly readers = new Map<string, { selection: { provider: string; model: string } | null; routable: boolean }>()
  public network: NetworkVerdict = 'unknown'

  public readonly deps: SessionGuardDeps = {
    network: () => this.network,
    read: (id) => this.readers.get(id),
    subscribeSelection: () => () => undefined,
    subscribeBlockStore: () => () => undefined,
    blockOf: (id) => this.blocks.get(id),
    setBlock: (id, block) => {
      this.setCalls.push({ session: id, block })
      if (block === undefined) this.blocks.delete(id)
      else this.blocks.set(id, block)
    },
    reason: () => 'REASON',
  }

  public guard = new ComposerGuardController(this.deps)

  public setFacts(session: string, selection: { provider: string; model: string } | null, routable = true): void {
    this.readers.set(session, { selection, routable })
    this.guard.evaluate(session)
  }

  public setNetwork(verdict: NetworkVerdict): void {
    this.network = verdict
  }
}

const CLAUDE = { provider: 'claude', model: 'claude-sonnet-4-5' }
const DEEPSEEK = { provider: 'deepseek', model: 'deepseek-chat' }

describe('ComposerGuardController', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes its own block on home + Claude, and only then', () => {
    const w = new FakeWiring()
    w.setNetwork('home')
    w.setFacts('A', CLAUDE)
    expect(w.blocks.get('A')).toEqual({ reason: 'REASON' })

    // switch to non-Claude: clears because the last write was ours
    w.setFacts('A', DEEPSEEK)
    expect(w.blocks.has('A')).toBe(false)
  })

  it('does not write anything on non-home or unknown networks (fail open)', () => {
    const w = new FakeWiring()
    w.setNetwork('not-home')
    w.setFacts('A', CLAUDE)
    expect(w.blocks.has('A')).toBe(false)

    w.setNetwork('unknown')
    w.setFacts('B', CLAUDE)
    expect(w.blocks.has('B')).toBe(false)
  })

  it('yields to the official non-routable block and never clears its slot', () => {
    const w = new FakeWiring()
    w.setNetwork('home')
    // official wrote first (its publish runs before ours on store changes)
    w.blocks.set('A', { reason: 'OFFICIAL' }) // official's own reason in the slot
    w.readers.set('A', { selection: CLAUDE, routable: false })
    w.guard.evaluate('A')

    // guard must not write and must not erase the official block
    expect(w.blocks.get('A')).toEqual({ reason: 'OFFICIAL' })
    expect(w.setCalls).toHaveLength(0)

    // once routable recovers, the guard takes over with its own block
    w.setFacts('A', CLAUDE, true)
    expect(w.blocks.get('A')).toEqual({ reason: 'REASON' })
  })

  it('clears its own block on "none" only when it owned the slot', () => {
    const w = new FakeWiring()
    w.guard.evaluate('A') // facts absent → no-op, no writes
    expect(w.setCalls).toHaveLength(0)

    // official owns the slot; our 'none' must leave it alone
    w.blocks.set('A', { reason: 'OFFICIAL' })
    w.readers.set('A', { selection: DEEPSEEK, routable: true })
    w.guard.evaluate('A')
    expect(w.blocks.get('A')).toEqual({ reason: 'OFFICIAL' })
  })

  it('re-asserts its block after an official store change cleared it (self-check)', () => {
    const w = new FakeWiring()
    w.setNetwork('home')
    w.setFacts('A', CLAUDE)
    expect(w.blocks.get('A')).toEqual({ reason: 'REASON' })

    // simulate the official publish clearing the slot (its store changed)
    w.blocks.delete('A')
    w.guard.onBlockStoreChanged('A')
    expect(w.blocks.has('A')).toBe(false) // debounced, not yet

    vi.runAllTimers()
    expect(w.blocks.get('A')).toEqual({ reason: 'REASON' })
  })

  it('does not re-assert when the block already holds our reason', () => {
    const w = new FakeWiring()
    w.setNetwork('home')
    w.setFacts('A', CLAUDE)
    const before = w.setCalls.length
    w.guard.onBlockStoreChanged('A')
    vi.runAllTimers()
    expect(w.setCalls.length).toBe(before) // idempotent: no extra writes
  })

  it('keeps sessions independent', () => {
    const w = new FakeWiring()
    w.setNetwork('home')
    w.setFacts('A', CLAUDE)
    w.setFacts('B', DEEPSEEK)
    expect(w.blocks.get('A')).toEqual({ reason: 'REASON' })
    expect(w.blocks.has('B')).toBe(false)
  })

  it('dispose clears only its own block', () => {
    const w = new FakeWiring()
    w.setNetwork('home')
    w.setFacts('A', CLAUDE)
    w.guard.dispose('A')
    expect(w.blocks.has('A')).toBe(false)

    // an official block in the slot is left untouched by dispose
    w.blocks.set('B', { reason: 'OFFICIAL' })
    w.guard.dispose('B')
    expect(w.blocks.get('B')).toEqual({ reason: 'OFFICIAL' })
  })
})