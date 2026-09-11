import { describe, expect, it, vi } from 'vitest'
import { createLocusChildDelivery } from '../src/host/locus/child-delivery.js'

function adapter(childId: string, calls: string[]) {
  let active: { parentSessionId: string; childSessionId: string } | undefined
  return {
    get activeChild() { return active },
    createChild: vi.fn(),
    adoptChild: vi.fn(async (input: { parentSessionId: string; childSessionId: string }) => {
      active = { parentSessionId: input.parentSessionId, childSessionId: input.childSessionId }
      calls.push(`adopt:${childId}`)
      return { ok: true as const, adopted: true, identity: active }
    }),
    queuePrompt: vi.fn(async () => {
      calls.push(`queue:${childId}`)
      return { ok: true as const, messageId: `message-${childId}` }
    }),
    dispose: vi.fn(() => { calls.push(`dispose:${childId}`) }),
  }
}

const signal = new AbortController().signal

function locus(id: string) {
  return {
    id: `locus-${id}`,
    parentSessionId: 'main-shared',
    childSessionId: `child-${id}`,
  }
}

describe('multi-locus child delivery', () => {
  it('owns one adapter per child instead of serialising every locus through one singleton', async () => {
    const calls: string[] = []
    let created = 0
    const port = createLocusChildDelivery({
      createAdapter: () => adapter(String(++created), calls) as never,
    })

    const first = await port.ensureChild(locus('a'), signal)
    const second = await port.ensureChild(locus('b'), signal)
    await port.queueChild({
      locus: locus('a'), child: first, deliveryId: 'd-a', executionId: 'e-a', prompt: 'A', signal,
    })
    await port.queueChild({
      locus: locus('b'), child: second, deliveryId: 'd-b', executionId: 'e-b', prompt: 'B', signal,
    })

    // The generic adapter intentionally owns one active child. A singleton
    // here made the second sibling fail with active-child-conflict.
    expect(created).toBe(2)
    expect(calls).toEqual(['adopt:1', 'adopt:2', 'queue:1', 'queue:2'])
  })

  it('reuses the same adapter for later turns of one child', async () => {
    const calls: string[] = []
    let created = 0
    const port = createLocusChildDelivery({
      createAdapter: () => adapter(String(++created), calls) as never,
    })
    const target = locus('a')

    const first = await port.ensureChild(target, signal)
    await port.ensureChild(target, signal)
    await port.queueChild({
      locus: target, child: first, deliveryId: 'd', executionId: 'e', prompt: 'hello', signal,
    })

    expect(created).toBe(1)
  })

  it('never queues through an adapter that did not prove adoption', async () => {
    const calls: string[] = []
    const port = createLocusChildDelivery({ createAdapter: () => adapter('1', calls) as never })

    await expect(port.queueChild({
      locus: locus('a'),
      child: { parentSessionId: 'main-shared', childSessionId: 'child-a' },
      deliveryId: 'd', executionId: 'e', prompt: 'hello', signal,
    })).resolves.toEqual({ accepted: false, reason: 'child-not-adopted' })
    expect(calls).toEqual([])
  })

  it('disposes every child adapter exactly once', async () => {
    const calls: string[] = []
    let created = 0
    const port = createLocusChildDelivery({
      createAdapter: () => adapter(String(++created), calls) as never,
    })
    await port.ensureChild(locus('a'), signal)
    await port.ensureChild(locus('b'), signal)

    port.dispose()

    expect(calls.filter(item => item.startsWith('dispose:')).sort())
      .toEqual(['dispose:1', 'dispose:2'])
  })
})
