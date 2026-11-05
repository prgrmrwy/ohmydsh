import { describe, expect, it, vi } from 'vitest'
import { createLocusChildAdapter, type LocusChildPorts, type LocusLiveParent } from '../src/host/locus/child.js'
import {
  composeLocusChild,
  type LocusCandidateAgent,
  type LocusChildComposition,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'
import { createLocusLazyChildCreator, type LocusLazyChildInput } from '../src/host/locus/lazy-child.js'
import {
  createPrepublicationCompositionLookup,
  LocusPrepublicationStagingRegistry,
} from '../src/host/locus/prepublication-staging.js'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import { FakeOfficialRuntime, type FakeAgentCreated } from './support/official-subagent.js'

const LOCUS_MAIN = 'session-locus-main'
const FIRST_PROMPT = '## 当前 unified locus 投递（caller-bound）\n\n请回答：发布流程怎么走？'

/**
 * The official runtime, the REAL staging registry, the REAL composer and the
 * REAL adapter, wired the way `index.ts` wires them. Only the Host seams that
 * reach into DSH (policy, surface, preset reads) are stand-ins.
 */
function world(options: { activeLimit?: number; spawnIndependent?: boolean; presetDeclared?: boolean } = {}) {
  const runtime = new FakeOfficialRuntime({
    ...(options.activeLimit === undefined ? {} : { activeLimit: options.activeLimit }),
    ...(options.spawnIndependent === undefined ? {} : { spawnIndependent: options.spawnIndependent }),
  })
  const locusMain = runtime.addParent(LOCUS_MAIN)
  const staging = new LocusPrepublicationStagingRegistry({ createChildSessionId: (() => {
    let next = 1
    return () => `session-child-${String(next++)}`
  })() })
  const applied = new Map<string, 'read' | 'write'>()
  const compositionPorts: LocusCompositionPorts = {
    lookup: createPrepublicationCompositionLookup({ durable: { find: () => undefined }, staging }),
    parentPreset: () => LOCUS_BASE_PRESET,
    childPreset: () => 'locus-child',
    surface: {
      install: vi.fn(),
      setToolTier: vi.fn(),
      installOutboundGuard: vi.fn(),
      visibleTools: () => ['read', 'read_image', 'glob', 'grep', 'web_search', 'pet_context', 'pet_locus_finish'],
    },
    policy: {
      apply: (id, permission) => { applied.set(id, permission) },
      resolve: id => applied.get(id),
    },
  }
  /** What `index.ts`' `agent/created` listener does for a locus candidate. */
  const compose = vi.fn(async (event: FakeAgentCreated) => {
    const candidate: LocusCandidateAgent = { id: event.agent.id, scope: event.agent.ctx as never }
    const result = composeLocusChild(candidate, compositionPorts)
    if (result.composed) await staging.publishClaimed(event.agent.id)
  })
  runtime.agentCreatedListeners.push(compose)

  const ports: LocusChildPorts = {
    parent: {
      get: id => runtime.agents.get(id) as unknown as LocusLiveParent | undefined,
      resume: async () => undefined,
    },
    subagent: {
      startActivation: spec => runtime.startActivation(spec as never),
      getProvider: name => runtime.getProvider(name),
    },
  }
  const log = vi.fn()
  const creator = createLocusLazyChildCreator({
    staging,
    createAdapter: () => createLocusChildAdapter(ports),
    presetDeclared: () => options.presetDeclared ?? true,
    log,
  })

  const published = new Map<string, LocusChildComposition>()
  const publish = vi.fn((childSessionId: string, composition: LocusChildComposition) => {
    published.set(childSessionId, composition)
  })
  const unpublish = vi.fn((childSessionId: string, _composition?: LocusChildComposition) => { published.delete(childSessionId) })
  const request = (overrides: Partial<LocusLazyChildInput> = {}): LocusLazyChildInput => ({
    parentSessionId: LOCUS_MAIN,
    workspaceId: 'workspace-1',
    locusId: 'locus-1',
    generation: 1,
    label: 'Locus · dev group',
    endpoint: { chatId: 'oc_dev' },
    permission: 'read',
    prompt: [{ type: 'text', text: FIRST_PROMPT }],
    publish,
    unpublish,
    ...overrides,
  })
  return { runtime, locusMain, staging, creator, publish, unpublish, published, request, log, compose, compositionPorts }
}

describe('首条消息即首个 prompt', () => {
  it('首条消息即首个 prompt', async () => {
    const { runtime, creator, publish, published, request, staging } = world()

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: true, childSessionId: 'session-child-1' })
    // Exactly one creation, carrying the delivery's prompt: no idle child, no
    // later `sendMessage`/queue for the same message.
    expect(runtime.startCalls).toHaveLength(1)
    expect(runtime.startCalls[0]!.request.prompt).toEqual([{ type: 'text', text: FIRST_PROMPT }])
    expect(runtime.startCalls[0]!.provider).toBe('spawn')
    expect(runtime.startCalls[0]!.request.parent).toBe(runtime.agents.get(LOCUS_MAIN))
    expect(runtime.startCalls[0]).not.toHaveProperty('settlementNotice')
    expect(runtime.queueCalls).toEqual([])
    // The generation becomes active carrying the tier3 marker.
    expect(publish).toHaveBeenCalledTimes(1)
    expect(published.get('session-child-1')).toMatchObject({
      childComposition: 'tier3',
      locusId: 'locus-1',
      generation: 1,
      parentSessionId: LOCUS_MAIN,
      endpoint: { chatId: 'oc_dev' },
    })
    // The pre-publication reservation was handed over, leaving nothing live.
    expect(staging.activeCount).toBe(0)
  })
})

describe('API 返回前首轮已能解析身份', () => {
  it('API 返回前首轮已能解析身份', async () => {
    const { runtime, creator, publish, published, request, staging } = world()
    const firstPrompt = createFirstPromptRegistry()
    // Publication (inside agent/created) registers which Delivery this prompt carries.
    publish.mockImplementation((childSessionId, composition) => {
      published.set(childSessionId, composition)
      firstPrompt.expect(childSessionId, {
        deliveryId: 'delivery-1',
        executionId: 'execution-1',
        correlation: {
          endpoint: { chatId: 'oc_dev' },
          locusId: 'locus-1',
          generation: 1,
          childSessionId,
        },
      })
    })
    let resolvedAtFirstTool: ReturnType<typeof firstPrompt.resolve>
    // The first caller-bound tool call (`pet_context`) runs inside the first
    // turn, which the runtime claims BEFORE `startActivation` returns, so the
    // durable (child, message) binding cannot exist yet.
    runtime.onClaim = ({ childId, messageId }) => {
      expect(staging.activeCount).toBe(0)
      resolvedAtFirstTool = firstPrompt.resolve({ childSessionId: childId, messageId })
    }

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: true, childSessionId: 'session-child-1' })
    expect(resolvedAtFirstTool).toMatchObject({ deliveryId: 'delivery-1', correlation: { locusId: 'locus-1', childSessionId: 'session-child-1' } })
    // The id the runtime returns is the one the claim bound: nothing to re-send.
    expect(result.ok && result.messageId).toBe(firstPrompt.claimedMessageId('session-child-1'))
    // Created -> published -> claimed -> returned, and no second delivery path.
    expect(runtime.milestones).toEqual([
      'created:session-child-1:startup',
      'claimed:session-child-1',
      'returned:session-child-1',
    ])
    expect(runtime.queueCalls).toEqual([])
    // Only the first message id is ever bound to the expectation.
    expect(firstPrompt.resolve({ childSessionId: 'session-child-1', messageId: 'another-message' })).toBeUndefined()
    // An unexpected child never resolves.
    expect(firstPrompt.resolve({ childSessionId: 'session-other', messageId: 'message-1' })).toBeUndefined()
  })

  it('does not run the first turn when the publication callback fails', async () => {
    const { runtime, creator, publish, request } = world()
    publish.mockImplementationOnce(() => { throw new Error('store unavailable') })

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: false, reason: 'create-failed' })
    expect(runtime.milestones.some(item => item.startsWith('claimed:'))).toBe(false)
  })
})

describe('回调内发布后创建被拒时回滚', () => {
  it('回调内发布后创建被拒时回滚', async () => {
    const { runtime, creator, publish, unpublish, published, request, staging } = world()
    // The marker and current were published inside the callback; the rest of
    // creation is then rejected.
    runtime.failAfterCreated = new Error('creation rejected after publish')

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: false, reason: 'create-failed' })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(unpublish).toHaveBeenCalledTimes(1)
    expect(unpublish).toHaveBeenCalledWith('session-child-1', expect.objectContaining({ childComposition: 'tier3' }))
    // No servable active generation or current is left behind.
    expect(published.size).toBe(0)
    expect(staging.activeCount).toBe(0)
    expect(runtime.agents.has('session-child-1')).toBe(false)

    // The next message may create again, with a fresh reserved identity.
    runtime.failAfterCreated = undefined
    const retry = await creator.create(request())
    expect(retry).toMatchObject({ ok: true, childSessionId: 'session-child-2' })
    expect(published.has('session-child-2')).toBe(true)
  })

  it('reports an incomplete rollback instead of claiming a clean failure', async () => {
    const { runtime, creator, unpublish, request } = world()
    runtime.failAfterCreated = new Error('creation rejected after publish')
    unpublish.mockImplementationOnce(() => { throw new Error('revert failed') })

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: false, reason: 'rollback-failed' })
  })
})

describe('创建失败不推进代际', () => {
  it('创建失败不推进代际', async () => {
    const { runtime, creator, publish, unpublish, compositionPorts, request, staging } = world()
    // The composition readback disagrees: the policy resolved is not the grant.
    compositionPorts.policy = { apply: vi.fn(), resolve: () => 'write' }

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: false, reason: 'create-failed' })
    // Nothing was published, so there is nothing to revert and no generation moved.
    expect(publish).not.toHaveBeenCalled()
    expect(unpublish).not.toHaveBeenCalled()
    expect(staging.activeCount).toBe(0)
    expect(runtime.milestones.some(item => item.startsWith('claimed:'))).toBe(false)

    // The next message tries again from the same state.
    compositionPorts.policy = (() => {
      const applied = new Map<string, 'read' | 'write'>()
      return { apply: (id: string, permission: 'read' | 'write') => { applied.set(id, permission) }, resolve: (id: string) => applied.get(id) }
    })()
    const retry = await creator.create(request())
    expect(retry.ok).toBe(true)
  })
})

describe('名额不足时保留原请求', () => {
  it('名额不足时保留原请求', async () => {
    const { runtime, creator, publish, request, staging } = world({ activeLimit: 1 })
    // Another entry's child already holds the only slot.
    runtime.agents.set('session-other', {
      id: 'session-other',
      ctx: { agentId: 'session-other' },
      parentId: LOCUS_MAIN,
      inbox: [],
      turnOpen: false,
    })
    const input = request()

    const refused = await creator.create(input)

    // Retryable, distinct from a failure: nothing published, nothing reserved,
    // nothing created or marked failed.
    expect(refused).toMatchObject({ ok: false, reason: 'capacity', retryable: true })
    expect(publish).not.toHaveBeenCalled()
    expect(staging.activeCount).toBe(0)
    expect(runtime.agents.has('session-child-1')).toBe(false)

    // The slot frees; the SAME request is created exactly once.
    runtime.release('session-other')
    const created = await creator.create(input)
    expect(created).toMatchObject({ ok: true })
    expect(runtime.startCalls.filter(call => call.request.prompt[0]?.text === FIRST_PROMPT)).toHaveLength(2)
    expect(runtime.agents.size).toBe(2)
    expect(publish).toHaveBeenCalledTimes(1)
  })
})

describe('a reserved child identity', () => {
  it('creates the child under the id the generation reserved, and reuses it on a capacity retry', async () => {
    const { runtime, creator, published, request } = world({ activeLimit: 0 })
    const input = request({ childSessionId: 'session-reserved' })

    expect(await creator.create(input)).toMatchObject({ ok: false, reason: 'capacity' })
    runtime.activeLimit = Number.POSITIVE_INFINITY
    const created = await creator.create(input)

    expect(created).toMatchObject({ ok: true, childSessionId: 'session-reserved' })
    expect(runtime.startCalls.map(call => call.childId)).toEqual(['session-reserved', 'session-reserved'])
    expect(published.has('session-reserved')).toBe(true)
  })
})

describe('provider 不能证明独立上下文', () => {
  it('provider 不能证明独立上下文', async () => {
    const { runtime, creator, publish, request, staging } = world({ spawnIndependent: false })

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: false, reason: 'independent-context-unproven' })
    expect(runtime.startCalls).toHaveLength(0)
    expect(publish).not.toHaveBeenCalled()
    expect(staging.activeCount).toBe(0)
  })

  it('refuses before reserving anything when the locus-base preset is not declared', async () => {
    const { runtime, creator, request, staging } = world({ presetDeclared: false })

    const result = await creator.create(request())

    expect(result).toMatchObject({ ok: false, reason: 'preset-missing' })
    expect(runtime.startCalls).toHaveLength(0)
    expect(staging.activeCount).toBe(0)
  })
})
