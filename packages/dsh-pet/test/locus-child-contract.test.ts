import { describe, expect, it, vi } from 'vitest'
import { LOCUS_SAFE_CHILD_COMPOSITION } from '../src/host/locus/aggregate.js'
import { createLocusChildAdapter, type LocusChildPorts, type LocusLiveParent } from '../src/host/locus/child.js'
import { createLocusChildDelivery } from '../src/host/locus/child-delivery.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import { FakeOfficialRuntime } from './support/official-subagent.js'

const LOCUS_MAIN = 'session-locus-main'
const CHILD = 'session-child-1'
const signal = new AbortController().signal

function world() {
  const runtime = new FakeOfficialRuntime()
  runtime.addParent(LOCUS_MAIN)
  runtime.agents.set(CHILD, { id: CHILD, ctx: { agentId: CHILD }, parentId: LOCUS_MAIN, inbox: [], turnOpen: false })
  const ports: LocusChildPorts = {
    parent: {
      get: id => runtime.agents.get(id) as unknown as LocusLiveParent | undefined,
      resume: async () => undefined,
    },
    subagent: {
      startContinuable: spec => runtime.startContinuable(spec as never),
      getProvider: name => runtime.getProvider(name),
    },
    inbox: {
      queuePrompt: async (parent, childId, prompt) => runtime.queuePrompt(
        parent as never,
        childId,
        prompt as never,
      ),
    },
    proof: {
      findChild: async (parentSessionId, childSessionId) =>
        runtime.listChildren(parentSessionId).some(entry => entry.id === childSessionId)
          ? { parentSessionId, childSessionId }
          : undefined,
    },
  }
  const preset = { current: LOCUS_BASE_PRESET as string | undefined }
  const log = vi.fn()
  const delivery = createLocusChildDelivery({
    createAdapter: () => createLocusChildAdapter(ports),
    parentPreset: async () => preset.current,
    log,
  })
  const target = {
    id: 'locus-1',
    parentSessionId: LOCUS_MAIN,
    childSessionId: CHILD,
    childComposition: LOCUS_SAFE_CHILD_COMPOSITION,
  }
  const queue = (child: { parentSessionId: string; childSessionId: string }) => delivery.queueChild({
    locus: target,
    child,
    deliveryId: 'delivery-1',
    executionId: 'execution-1',
    content: [{ type: 'text', text: 'hello' }],
    replyTarget: {} as never,
    signal,
  })
  return { runtime, delivery, preset, target, queue, log }
}

describe('父在 child 存活期间更改组合', () => {
  it('父在 child 存活期间更改组合', async () => {
    const { runtime, delivery, preset, target, queue, log } = world()

    // Served while the locus main still runs the pinned preset.
    const child = await delivery.ensureChild(target, signal)
    await expect(queue(child)).resolves.toMatchObject({ accepted: true })
    expect(runtime.queueCalls).toHaveLength(1)

    // The locus main's preset is changed while the child is alive.
    preset.current = 'standard'

    // Dispatch is refused with a diagnosable reason and nothing reaches the child:
    // the child must not serve under a composition other than the pinned one.
    await expect(queue(child)).resolves.toEqual({ accepted: false, reason: 'locus-main-preset-mismatch' })
    expect(runtime.queueCalls).toHaveLength(1)
    // Adoption (what the controller does first on every delivery) refuses too,
    // so the controller can treat the locus main as unavailable.
    await expect(delivery.ensureChild(target, signal)).rejects.toThrow('locus-main-preset-mismatch')
    expect(log).toHaveBeenCalledWith('locus-main-preset-mismatch')
  })

  it('refuses when the preset cannot be read instead of assuming it is unchanged', async () => {
    const { runtime, delivery, preset, target, queue } = world()
    const child = await delivery.ensureChild(target, signal)

    preset.current = undefined

    await expect(queue(child)).resolves.toEqual({ accepted: false, reason: 'locus-main-preset-unverified' })
    await expect(delivery.ensureChild(target, signal)).rejects.toThrow('locus-main-preset-unverified')
    expect(runtime.queueCalls).toHaveLength(0)
  })

  it('has no way to verify without a preset reader, and refuses', async () => {
    const delivery = createLocusChildDelivery({
      createAdapter: () => ({}) as never,
    })
    await expect(delivery.ensureChild({
      id: 'locus-1',
      parentSessionId: LOCUS_MAIN,
      childSessionId: CHILD,
      childComposition: LOCUS_SAFE_CHILD_COMPOSITION,
    }, signal)).rejects.toThrow('locus-main-preset-unverified')
  })
})
