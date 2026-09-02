import { describe, expect, it, vi } from 'vitest'
import { PetLifecycleMachine } from '../src/host/lifecycle.js'

describe('Pet Host lifecycle containment', () => {
  it('starts in `starting` and reaches `ready`', () => {
    const lifecycle = new PetLifecycleMachine()
    expect(lifecycle.state.phase).toBe('starting')
    expect(lifecycle.isReady).toBe(false)

    lifecycle.markReady()

    expect(lifecycle.state.phase).toBe('ready')
    expect(lifecycle.isReady).toBe(true)
  })

  it('contains a failed initialization step as `degraded` instead of throwing', async () => {
    const lifecycle = new PetLifecycleMachine()

    const result = await lifecycle.contain('Pet storage domain', async () => {
      throw new Error('backend unavailable')
    })

    // The contract that keeps ordinary DSH services loading: a Pet failure
    // resolves to `undefined` rather than propagating into plugin `apply`.
    expect(result).toBeUndefined()
    expect(lifecycle.state.phase).toBe('degraded')
    expect(lifecycle.state.diagnostic).toContain('Pet storage domain')
    expect(lifecycle.state.diagnostic).toContain('backend unavailable')
    expect(lifecycle.isReady).toBe(false)
  })

  it('returns the value of a successful contained step', async () => {
    const lifecycle = new PetLifecycleMachine()
    const result = await lifecycle.contain('step', async () => 42)
    expect(result).toBe(42)
    expect(lifecycle.state.phase).toBe('starting')
  })

  it('refuses to resurrect a stopping Pet from late async work', () => {
    const lifecycle = new PetLifecycleMachine()
    lifecycle.markStopping()

    lifecycle.markReady()
    lifecycle.markDegraded('late failure')

    expect(lifecycle.state.phase).toBe('stopping')
  })

  it('notifies subscribers with a monotonic generation and survives listener throws', () => {
    const lifecycle = new PetLifecycleMachine()
    const seen: string[] = []
    lifecycle.subscribe(() => {
      throw new Error('bad listener')
    })
    lifecycle.subscribe(state => {
      seen.push(state.phase)
    })

    const before = lifecycle.state.generation
    lifecycle.markReady()
    lifecycle.markDegraded('later problem')

    expect(seen).toEqual(['ready', 'degraded'])
    expect(lifecycle.state.generation).toBeGreaterThan(before)
  })

  it('does not emit a transition when nothing changed', () => {
    const lifecycle = new PetLifecycleMachine()
    const listener = vi.fn()
    lifecycle.markReady()
    lifecycle.subscribe(listener)

    lifecycle.markReady()

    expect(listener).not.toHaveBeenCalled()
  })
})
