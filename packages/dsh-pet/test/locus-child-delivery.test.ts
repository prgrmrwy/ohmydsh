import { describe, expect, it, vi } from 'vitest'
import { createLocusChildDelivery } from '../src/host/locus/child-delivery.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'

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

/** A v20 active row as the delivery path sees it (group M resolved onto it). */
function locus(id: string) {
  return {
    locusId: `locus-${id}`,
    state: 'active' as const,
    locusMainSessionId: 'main-shared',
    sessionId: `child-${id}`,
    revision: 1,
    accessMode: 'read-only' as const,
    workspaceId: 'workspace-1',
    endpoint: { chatId: `oc_${id}` },
  }
}

describe('multi-locus child delivery', () => {
  it('owns one adapter per child instead of serialising every locus through one singleton', async () => {
    const calls: string[] = []
    let created = 0
    const port = createLocusChildDelivery({
      parentPreset: () => LOCUS_BASE_PRESET,
      createAdapter: () => adapter(String(++created), calls) as never,
    })

    const first = await port.ensureChild(locus('a'), signal)
    const second = await port.ensureChild(locus('b'), signal)
    await expect(port.queueChild({
      locus: locus('a'), child: first, deliveryId: 'd-a', executionId: 'e-a', content: [{ type: 'text', text: 'A' }], signal,
    })).resolves.toEqual({ accepted: true, executionId: 'e-a', inboxMessageId: 'message-1' })
    await port.queueChild({
      locus: locus('b'), child: second, deliveryId: 'd-b', executionId: 'e-b', content: [{ type: 'text', text: 'B' }], signal,
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
      parentPreset: () => LOCUS_BASE_PRESET,
      createAdapter: () => adapter(String(++created), calls) as never,
    })
    const target = locus('a')

    const first = await port.ensureChild(target, signal)
    await port.ensureChild(target, signal)
    await port.queueChild({
      locus: target, child: first, deliveryId: 'd', executionId: 'e', content: [{ type: 'text', text: 'hello' }], signal,
    })

    expect(created).toBe(1)
  })

  it('never queues through an adapter that did not prove adoption', async () => {
    const calls: string[] = []
    const port = createLocusChildDelivery({ parentPreset: () => LOCUS_BASE_PRESET, createAdapter: () => adapter('1', calls) as never })

    await expect(port.queueChild({
      locus: locus('a'),
      child: { parentSessionId: 'main-shared', childSessionId: 'child-a' },
      deliveryId: 'd', executionId: 'e', content: [{ type: 'text', text: 'hello' }], signal,
    })).resolves.toEqual({ accepted: false, reason: 'child-not-adopted' })
    expect(calls).toEqual([])
  })

  it('disposes every child adapter exactly once', async () => {
    const calls: string[] = []
    let created = 0
    const port = createLocusChildDelivery({
      parentPreset: () => LOCUS_BASE_PRESET,
      createAdapter: () => adapter(String(++created), calls) as never,
    })
    await port.ensureChild(locus('a'), signal)
    await port.ensureChild(locus('b'), signal)

    port.dispose()

    expect(calls.filter(item => item.startsWith('dispose:')).sort())
      .toEqual(['dispose:1', 'dispose:2'])
  })
})

describe('first-message creation through the delivery port', () => {
  const notCreated = {
    locusId: 'locus-new',
    state: 'not-created' as const,
    locusMainSessionId: 'main-locus',
    // The id the row reserved; Deliveries already correlate by it.
    sessionId: 'child-reserved',
    revision: 4,
    accessMode: 'read-only' as const,
    workspaceId: 'workspace-1',
    endpoint: { chatId: 'oc_group' },
  }

  function lazyPort(create: ReturnType<typeof vi.fn>) {
    const createAdapter = vi.fn(() => adapter('unused', []) as never)
    const publication = vi.fn(() => ({ publish: vi.fn(), unpublish: vi.fn() }))
    const port = createLocusChildDelivery({
      parentPreset: () => LOCUS_BASE_PRESET,
      createAdapter,
      lazy: { creator: { create } as never, publication, label: () => 'Locus · group' },
    })
    return { port, createAdapter, publication }
  }

  const queueInput = (port: ReturnType<typeof lazyPort>['port'], overrides: Record<string, unknown> = {}) => port.queueChild({
    locus: notCreated,
    child: { parentSessionId: 'main-locus', childSessionId: 'child-reserved' },
    deliveryId: 'delivery-1',
    executionId: 'execution-1',
    content: [{ type: 'text', text: 'first message' }],
    replyTarget: {} as never,
    signal,
    ...overrides,
  })

  it('adopts nothing for a generation whose child does not exist yet', async () => {
    const { port, createAdapter } = lazyPort(vi.fn())

    await expect(port.ensureChild(notCreated, signal)).resolves.toEqual({
      parentSessionId: 'main-locus',
      childSessionId: 'child-reserved',
    })
    expect(createAdapter).not.toHaveBeenCalled()
  })

  it('creates the child with the delivery as its first prompt and reports the runtime message id', async () => {
    const create = vi.fn(async () => ({ ok: true as const, childSessionId: 'child-reserved', messageId: 'message-9' }))
    const { port, publication } = lazyPort(create)

    const result = await queueInput(port)

    expect(result).toEqual({ accepted: true, executionId: 'execution-1', inboxMessageId: 'message-9' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'child-reserved',
      locusMainSessionId: 'main-locus',
      workspaceId: 'workspace-1',
      locusId: 'locus-new',
      revision: 4,
      accessMode: 'read-only',
      label: 'Locus · group',
      prompt: [{ type: 'text', text: 'first message' }],
    }))
    expect(publication).toHaveBeenCalledWith({
      locus: { locusId: 'locus-new', sessionId: 'child-reserved', revision: 4, endpoint: { chatId: 'oc_group' } },
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
    })
  })

  it('spec Scenario "首次创建按行上的 accessMode 组装" (delivery seam): a changed not-created row creates with its value, not a default', async () => {
    const create = vi.fn(async () => ({ ok: true as const, childSessionId: 'child-reserved', messageId: 'message-9' }))
    const { port } = lazyPort(create)

    await queueInput(port, { locus: { ...notCreated, accessMode: 'danger-full-access' } })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ accessMode: 'danger-full-access' }))
  })

  it('keeps a capacity refusal distinguishable so the Delivery can wait', async () => {
    const { port } = lazyPort(vi.fn(async () => ({ ok: false as const, reason: 'capacity' as const, retryable: true })))

    await expect(queueInput(port)).resolves.toEqual({ accepted: false, reason: 'child-capacity-exhausted' })
  })

  it('reports every other creation failure as a definite refusal', async () => {
    for (const reason of ['create-failed', 'preset-missing', 'independent-context-unproven', 'rollback-failed', 'image-route-unsupported'] as const) {
      const { port } = lazyPort(vi.fn(async () => ({ ok: false as const, reason, retryable: false })))
      const result = await queueInput(port)
      expect(result).toEqual({
        accepted: false,
        reason: reason === 'image-route-unsupported' ? 'image-route-unsupported' : `child-${reason}`,
      })
    }
  })

  it('does not create anything when the Delivery is no longer the exact current', async () => {
    const create = vi.fn()
    const { port } = lazyPort(create)

    await expect(queueInput(port, { fenceBeforeQueue: () => false })).resolves.toEqual({ accepted: false, reason: 'stale-delivery' })
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses to create under a locus main that left the pinned preset', async () => {
    const create = vi.fn()
    const port = createLocusChildDelivery({
      parentPreset: () => 'standard',
      createAdapter: () => adapter('unused', []) as never,
      lazy: { creator: { create } as never, publication: () => ({ publish: vi.fn(), unpublish: vi.fn() }) },
    })

    await expect(port.ensureChild(notCreated, signal)).rejects.toThrow('locus-main-preset-mismatch')
    await expect(queueInput(port)).resolves.toEqual({ accepted: false, reason: 'locus-main-preset-mismatch' })
    expect(create).not.toHaveBeenCalled()
  })

  it('has no way to create a first child without the creation port', async () => {
    const port = createLocusChildDelivery({
      parentPreset: () => LOCUS_BASE_PRESET,
      createAdapter: () => adapter('unused', []) as never,
    })
    await expect(queueInput(port)).resolves.toEqual({ accepted: false, reason: 'child-creation-unavailable' })
  })
})
