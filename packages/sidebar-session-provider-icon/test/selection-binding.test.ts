import { describe, expect, it, vi } from 'vitest'
import {
  SelectionObservation,
  type SelectionDirectory,
} from '../src/client/selection-binding.js'
import type { ProviderProjection } from '../src/types.ts'

const CLAUDE = { provider: 'claude', model: 'claude-opus-5-5' }
const CODEX = { provider: 'codex', model: 'gpt-6.1-sol' }
const DEEPSEEK = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }

/** One fake selector directory: mutable snapshot + observable listeners. */
interface FakeDirectory {
  value: SelectionDirectory
  /** Publish a new value the way the model selector does. */
  emit(next: ProviderProjection | null): void
  /** Change the snapshot without publishing (a signal the client missed). */
  silent(next: ProviderProjection | null): void
  listeners(): number
  loads(): number
}

function directory(current: ProviderProjection | null): FakeDirectory {
  let snapshot = { current }
  const listeners = new Set<() => void>()
  let loads = 0
  return {
    value: {
      store: {
        getSnapshot: () => snapshot,
        subscribe(fn) {
          listeners.add(fn)
          return () => {
            listeners.delete(fn)
          }
        },
      },
      load: vi.fn(async () => {
        loads += 1
      }),
    },
    emit(next) {
      snapshot = { current: next }
      for (const fn of [...listeners]) fn()
    },
    silent(next) {
      snapshot = { current: next }
    },
    listeners: () => listeners.size,
    loads: () => loads,
  }
}

function harness(openSessionId: () => string | undefined, resolve: (id: string) => SelectionDirectory) {
  const observed = new Map<string, ProviderProjection>()
  const reconcile = vi.fn()
  const observation = new SelectionObservation({ openSessionId, resolve, observed, reconcile })
  return { observed, reconcile, observation }
}

describe('SelectionObservation', () => {
  it('publishes the open session current value and its later changes', () => {
    const s1 = directory(DEEPSEEK)
    const h = harness(() => 's1', () => s1.value)

    h.observation.sync()
    expect(h.observed.get('s1')).toEqual(DEEPSEEK)
    expect(h.reconcile.mock.calls.length).toBeGreaterThan(0)

    s1.emit(CODEX)
    expect(h.observed.get('s1')).toEqual(CODEX)

    h.observation.stop()
    expect(h.observed.has('s1')).toBe(false)
    expect(s1.listeners()).toBe(0)
  })

  it('re-subscribes when the runtime replaces the same session store (client generation swap)', () => {
    const first = directory(CLAUDE)
    const second = directory(CODEX)
    let current = first
    const h = harness(() => 's1', () => current.value)

    h.observation.sync()
    expect(h.observed.get('s1')).toEqual(CLAUDE)
    expect(first.listeners()).toBe(1)

    // Navigating away and back hands out a NEW directory for the SAME id; the
    // retired one never publishes again, so the badge must re-target the new one.
    current = second
    h.observation.sync()
    expect(first.listeners()).toBe(0)
    expect(second.listeners()).toBe(1)
    expect(h.observed.get('s1')).toEqual(CODEX)

    // The binding now follows the replacement store.
    second.emit(DEEPSEEK)
    expect(h.observed.get('s1')).toEqual(DEEPSEEK)
  })

  it('re-reads the live snapshot on every signal, so a missed publish heals', () => {
    const s1 = directory(CLAUDE)
    const h = harness(() => 's1', () => s1.value)
    h.observation.sync()

    // A switch the subscription never reported (the class of signal that used to
    // leave the badge stuck) is picked up by the next signal.
    s1.silent(CODEX)
    h.observation.sync()
    expect(h.observed.get('s1')).toEqual(CODEX)
  })

  it('drops the observation once the view moves to another session', () => {
    const s1 = directory(CLAUDE)
    const s2 = directory(DEEPSEEK)
    let open = 's1'
    const h = harness(() => open, (id) => (id === 's1' ? s1.value : s2.value))

    h.observation.sync()
    expect(h.observed.get('s1')).toEqual(CLAUDE)

    open = 's2'
    h.observation.sync()
    // The old session can no longer be verified from here: the durable
    // projection answers for its row instead of a frozen live value.
    expect(h.observed.has('s1')).toBe(false)
    expect(s1.listeners()).toBe(0)
    expect(h.observed.get('s2')).toEqual(DEEPSEEK)
  })

  it('drops the observation when the open session directory cannot be resolved', () => {
    const s1 = directory(CLAUDE)
    let resolvable = true
    const h = harness(() => 's1', () => {
      if (!resolvable) throw new Error('no retained client scope')
      return s1.value
    })

    h.observation.sync()
    expect(h.observed.get('s1')).toEqual(CLAUDE)

    resolvable = false
    h.observation.sync()
    expect(h.observed.has('s1')).toBe(false)
    expect(s1.listeners()).toBe(0)
  })

  it('drops everything when no session is open', () => {
    const s1 = directory(CLAUDE)
    let open: string | undefined = 's1'
    const h = harness(() => open, () => s1.value)

    h.observation.sync()
    expect(h.observed.get('s1')).toEqual(CLAUDE)

    open = undefined
    h.observation.sync()
    expect(h.observed.size).toBe(0)
    expect(s1.listeners()).toBe(0)
  })

  it('retries after a transient resolver failure on the next signal', () => {
    const s1 = directory(DEEPSEEK)
    let attempts = 0
    const h = harness(() => 's1', () => {
      attempts += 1
      if (attempts === 1) throw new Error('session scope not ready yet')
      return s1.value
    })

    expect(() => h.observation.sync()).not.toThrow()
    expect(h.observed.size).toBe(0)

    h.observation.sync()
    expect(attempts).toBe(2)
    expect(h.observed.get('s1')).toEqual(DEEPSEEK)
  })

  it('loads a directory that has no current value yet and follows it afterwards', () => {
    const s1 = directory(null)
    const h = harness(() => 's1', () => s1.value)

    h.observation.sync()
    expect(h.observed.has('s1')).toBe(false)
    expect(s1.loads()).toBe(1)

    s1.emit(DEEPSEEK)
    expect(h.observed.get('s1')).toEqual(DEEPSEEK)
  })
})
