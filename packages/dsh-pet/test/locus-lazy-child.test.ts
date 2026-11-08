import { describe, expect, it, vi } from 'vitest'
import { createLocusChildAdapter, type LocusChildPorts, type LocusLiveParent } from '../src/host/locus/child.js'
import {
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_FULL_ACCESS_TOOL_NAMES,
  LOCUS_SAFE_TOOL_NAMES,
  type LocusCandidateAgent,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'
import type { LocusAccessModeV20 } from '../src/host/locus/contract-v20.js'
import { createFirstDeliveryPublication } from '../src/host/locus/first-delivery-publication.js'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'
import { createLocusLazyChildCreator, type LocusLazyChildInput } from '../src/host/locus/lazy-child.js'
import {
  createPrepublicationCompositionLookup,
  LocusPrepublicationStagingRegistry,
} from '../src/host/locus/prepublication-staging.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import { firstPublicationRepo, type FakeRow } from './support/first-publication-repo.js'
import { FakeOfficialRuntime, type FakeAgentCreated } from './support/official-subagent.js'

const LOCUS_MAIN = 'session-locus-main'
const FIRST_PROMPT = '## 当前 unified locus 投递（caller-bound）\n\n请回答：发布流程怎么走？'

/**
 * The official runtime, the REAL staging registry, composer, adapter, creator,
 * first-prompt registry and first-delivery publication, wired the way
 * `index.ts` wires them. The durable writes are the contract-faithful fake of
 * owner A's port; the Host seams that reach into DSH (policy, surface, preset
 * reads) are stand-ins.
 */
function world(options: {
  activeLimit?: number
  spawnIndependent?: boolean
  presetDeclared?: boolean
  row?: Partial<FakeRow>
} = {}) {
  const runtime = new FakeOfficialRuntime({
    ...(options.activeLimit === undefined ? {} : { activeLimit: options.activeLimit }),
    ...(options.spawnIndependent === undefined ? {} : { spawnIndependent: options.spawnIndependent }),
  })
  const locusMain = runtime.addParent(LOCUS_MAIN)
  const repo = firstPublicationRepo(options.row)
  let nextReservation = 1
  const reserveChildSessionId = () => `session-reserved-${String(nextReservation++)}`
  const staging = new LocusPrepublicationStagingRegistry()
  const firstPrompts = createFirstPromptRegistry()
  runtime.onClaim = ({ childId, messageId }) => { firstPrompts.resolve({ childSessionId: childId, messageId }) }

  const applied: { id: string; mode: LocusAccessModeV20 }[] = []
  const visible = new Set<string>()
  const compositionPorts: LocusCompositionPorts = {
    lookup: createPrepublicationCompositionLookup({ durable: { find: () => undefined }, staging }),
    parentPreset: () => LOCUS_BASE_PRESET,
    childPreset: () => 'locus-child',
    writeEnabled: true,
    surface: {
      install: vi.fn(),
      applyAccessMode: vi.fn((_agent, mode: LocusAccessModeV20) => {
        visible.clear()
        for (const name of [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS]) visible.add(name)
        if (mode === 'danger-full-access') for (const name of LOCUS_FULL_ACCESS_TOOL_NAMES) visible.add(name)
      }),
      installOutboundGuard: vi.fn(),
      visibleTools: () => [...visible],
    },
    policy: {
      apply: (id, mode) => { applied.push({ id, mode }) },
      resolve: id => applied.findLast(item => item.id === id)?.mode,
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
  const creator = createLocusLazyChildCreator({
    staging,
    createAdapter: () => createLocusChildAdapter(ports),
    presetDeclared: () => options.presetDeclared ?? true,
    log: vi.fn(),
  })
  const publication = createFirstDeliveryPublication({ repository: repo.repository, firstPrompts, reserveChildSessionId, now: () => 10 })

  /** One first-creation request built from the row AS IT IS NOW, for one current Delivery. */
  let executions = 0
  const request = (deliveryId: string, overrides: Partial<LocusLazyChildInput> = {}): LocusLazyChildInput => {
    const locus = { locusId: repo.row.locusId, sessionId: repo.row.sessionId, revision: repo.row.revision, endpoint: { chatId: 'oc_dev' } }
    return {
      sessionId: repo.row.sessionId,
      locusMainSessionId: LOCUS_MAIN,
      workspaceId: 'workspace-1',
      locusId: repo.row.locusId,
      revision: repo.row.revision,
      accessMode: repo.row.accessMode,
      label: 'Locus · dev group',
      endpoint: { chatId: 'oc_dev' },
      prompt: [{ type: 'text', text: FIRST_PROMPT }],
      ...publication({ locus, deliveryId, executionId: `execution-${String(++executions)}` }),
      ...overrides,
    }
  }
  return { runtime, locusMain, staging, creator, repo, request, compose, compositionPorts, applied, firstPrompts }
}

describe('首条消息即首个 prompt', () => {
  it('首条消息即首个 prompt', async () => {
    const { runtime, creator, repo, request, staging } = world()
    repo.accept('delivery-1')

    const result = await creator.create(request('delivery-1'))

    expect(result).toMatchObject({ ok: true, childSessionId: 'session-reserved-0' })
    // Exactly one creation, carrying the delivery's prompt.
    expect(runtime.startCalls).toHaveLength(1)
    expect(runtime.startCalls[0]!.childId).toBe('session-reserved-0')
    expect(runtime.startCalls[0]!.request.prompt).toEqual([{ type: 'text', text: FIRST_PROMPT }])
    expect(runtime.startCalls[0]!.provider).toBe('spawn')
    expect(runtime.startCalls[0]!.request.parent).toBe(runtime.agents.get(LOCUS_MAIN))
    expect(runtime.queueCalls).toEqual([])
    // The row went active under the id it reserved before creation.
    expect(repo.row).toMatchObject({ state: 'active', sessionId: 'session-reserved-0', revision: 1 })
    expect(repo.calls).toEqual(['publishFirstDelivery', 'commitFirstDelivery'])
    expect(staging.activeCount).toBe(0)
  })
})

describe('API 返回前首轮已能解析身份', () => {
  it('API 返回前首轮已能解析身份', async () => {
    const { runtime, creator, repo, request, staging, firstPrompts } = world()
    repo.accept('delivery-1')
    let resolvedAtFirstTool: ReturnType<typeof firstPrompts.resolve>
    // The first turn is claimed BEFORE startActivation returns.
    runtime.onClaim = ({ childId, messageId }) => {
      expect(staging.activeCount).toBe(0)
      resolvedAtFirstTool = firstPrompts.resolve({ childSessionId: childId, messageId })
    }

    const result = await creator.create(request('delivery-1'))

    expect(result).toMatchObject({ ok: true, childSessionId: 'session-reserved-0' })
    expect(resolvedAtFirstTool).toMatchObject({
      deliveryId: 'delivery-1',
      correlation: { locusId: 'locus-1', sessionId: 'session-reserved-0' },
    })
    expect(runtime.milestones).toEqual([
      'created:session-reserved-0:startup',
      'claimed:session-reserved-0',
      'returned:session-reserved-0',
    ])
    expect(runtime.queueCalls).toEqual([])
  })

  it('does not run the first turn when the durable publication is refused', async () => {
    const { runtime, creator, repo, request } = world()
    repo.accept('delivery-1')
    const input = request('delivery-1')
    repo.row.revision += 1 // someone else moved the row: the publish fence fails

    const result = await creator.create(input)

    expect(result).toMatchObject({ ok: false })
    expect(runtime.milestones.some(item => item.startsWith('claimed:'))).toBe(false)
  })
})

describe('回调内发布后创建被拒时回滚', () => {
  it('回调内发布后创建被拒时回滚', async () => {
    const { runtime, creator, repo, request, staging } = world()
    repo.accept('delivery-1')
    runtime.failAfterCreated = new Error('creation rejected after publish')

    const result = await creator.create(request('delivery-1'))

    expect(result).toMatchObject({ ok: false, reason: 'create-failed' })
    // Published, then reverted in ONE write that also rotates and settles.
    expect(repo.calls).toEqual(['publishFirstDelivery', 'revertFirstDelivery'])
    expect(repo.row).toMatchObject({ state: 'not-created', sessionId: 'session-reserved-1', revision: 2 })
    expect(repo.deliveries.get('delivery-1')).toMatchObject({ status: 'failed', sessionId: 'session-reserved-0' })
    expect(staging.activeCount).toBe(0)

    // The next at creates with the new reservation.
    runtime.failAfterCreated = undefined
    repo.accept('delivery-2')
    expect(await creator.create(request('delivery-2'))).toMatchObject({ ok: true, childSessionId: 'session-reserved-1' })
    expect(repo.row).toMatchObject({ state: 'active', sessionId: 'session-reserved-1', revision: 2 })
  })

  it('reports an incomplete rollback instead of claiming a clean failure', async () => {
    const { runtime, creator, repo, request } = world()
    repo.accept('delivery-1')
    runtime.failAfterCreated = new Error('creation rejected after publish')
    const input = request('delivery-1')
    const unpublish = input.unpublish
    const result = await creator.create({ ...input, unpublish: async id => { await unpublish(id); throw new Error('revert failed') } })

    expect(result).toMatchObject({ ok: false, reason: 'rollback-failed' })
  })
})

describe('创建失败不推进代际', () => {
  it('创建失败不推进代际', async () => {
    const { runtime, creator, repo, request, compositionPorts, staging } = world()
    repo.accept('delivery-1')
    const backlog = repo.accept('delivery-2')
    expect(backlog).toMatchObject({ status: 'accepted', sessionId: 'session-reserved-0' })
    // The agent/created readback disagrees (non-capacity).
    const policy = compositionPorts.policy!
    compositionPorts.policy = { apply: policy.apply, resolve: () => 'danger-full-access' }

    const result = await creator.create(request('delivery-1'))

    expect(result).toMatchObject({ ok: false, reason: 'create-failed' })
    // Nothing was published: a single settle-and-rotate write.
    expect(repo.calls).toEqual(['failFirstDeliveryCreation'])
    expect(repo.deliveries.get('delivery-1')).toMatchObject({ status: 'failed', sessionId: 'session-reserved-0' })
    expect(repo.row).toMatchObject({ locusId: 'locus-1', state: 'not-created', accessMode: 'read-only', sessionId: 'session-reserved-1', revision: 2 })
    expect(backlog.sessionId).toBe('session-reserved-1')
    expect(staging.activeCount).toBe(0)
    expect(runtime.milestones.some(item => item.startsWith('claimed:'))).toBe(false)

    // The next at (the retargeted backlog) creates with C1; C0 is never reused.
    compositionPorts.policy = policy
    backlog.status = 'current'
    expect(await creator.create(request('delivery-2'))).toMatchObject({ ok: true, childSessionId: 'session-reserved-1' })
    expect(runtime.startCalls.map(call => call.childId)).toEqual(['session-reserved-0', 'session-reserved-1'])
  })
})

describe('名额不足时保留原请求', () => {
  it('名额不足时保留原请求', async () => {
    const { runtime, creator, repo, request, staging } = world({ activeLimit: 1 })
    runtime.agents.set('session-other', {
      id: 'session-other',
      ctx: { agentId: 'session-other' },
      parentId: LOCUS_MAIN,
      inbox: [],
      turnOpen: false,
    })
    repo.accept('delivery-1')
    const input = request('delivery-1')

    const refused = await creator.create(input)

    // Retryable and NOT a failure: no durable write at all, the reservation stands.
    expect(refused).toMatchObject({ ok: false, reason: 'capacity', retryable: true })
    expect(repo.calls).toEqual([])
    expect(repo.row).toMatchObject({ state: 'not-created', sessionId: 'session-reserved-0', revision: 1 })
    expect(repo.deliveries.get('delivery-1')).toMatchObject({ status: 'current' })
    expect(staging.activeCount).toBe(0)

    // The slot frees; the SAME request and reserved id create exactly once.
    runtime.release('session-other')
    expect(await creator.create(input)).toMatchObject({ ok: true, childSessionId: 'session-reserved-0' })
    expect(runtime.startCalls.map(call => call.childId)).toEqual(['session-reserved-0', 'session-reserved-0'])
    expect(repo.calls).toEqual(['publishFirstDelivery', 'commitFirstDelivery'])
  })
})

describe('首次创建按行上的 accessMode 组装', () => {
  it('首次创建按行上的 accessMode 组装', async () => {
    // Changed while not-created: the first creation must compose THAT value.
    const ok = world({ row: { accessMode: 'danger-full-access' } })
    ok.repo.accept('delivery-1')
    expect(await ok.creator.create(ok.request('delivery-1'))).toMatchObject({ ok: true })
    expect(ok.applied.map(item => item.mode)).toEqual(['danger-full-access'])
    expect(ok.compositionPorts.surface?.applyAccessMode).toHaveBeenCalledWith(expect.anything(), 'danger-full-access')

    // A readback mismatch fails like any creation failure, and never retries read-only.
    const bad = world({ row: { accessMode: 'danger-full-access' } })
    bad.repo.accept('delivery-1')
    const policy = bad.compositionPorts.policy!
    bad.compositionPorts.policy = { apply: policy.apply, resolve: () => 'read-only' }
    expect(await bad.creator.create(bad.request('delivery-1'))).toMatchObject({ ok: false, reason: 'create-failed' })
    expect(bad.applied.map(item => item.mode)).toEqual(['danger-full-access'])
    expect(bad.repo.deliveries.get('delivery-1')).toMatchObject({ status: 'failed' })
    expect(bad.repo.row).toMatchObject({ accessMode: 'danger-full-access', sessionId: 'session-reserved-1', revision: 2 })
  })
})

describe('provider 不能证明独立上下文', () => {
  it('provider 不能证明独立上下文', async () => {
    const { runtime, creator, repo, request, staging } = world({ spawnIndependent: false })
    repo.accept('delivery-1')

    const result = await creator.create(request('delivery-1'))

    expect(result).toMatchObject({ ok: false, reason: 'independent-context-unproven' })
    expect(runtime.startCalls).toHaveLength(0)
    expect(repo.calls).not.toContain('publishFirstDelivery')
    expect(staging.activeCount).toBe(0)
  })

  it('spec Scenario "无法证明独立能力时拒绝创建"', async () => {
    const { runtime, creator, repo, request } = world({ spawnIndependent: false })
    repo.accept('delivery-1')

    const result = await creator.create(request('delivery-1'))

    // Reported as a capability fact, not a retry and not "established".
    expect(result).toMatchObject({ ok: false, reason: 'independent-context-unproven', retryable: false })
    // No fallback to a provider that copies the parent's history.
    expect(runtime.startCalls).toEqual([])
    expect(repo.row.state).toBe('not-created')
    expect(repo.deliveries.get('delivery-1')).toMatchObject({ status: 'failed' })
  })

  it('refuses before reserving anything when the locus-base preset is not declared', async () => {
    const { runtime, creator, repo, request, staging } = world({ presetDeclared: false })
    repo.accept('delivery-1')

    expect(await creator.create(request('delivery-1'))).toMatchObject({ ok: false, reason: 'preset-missing' })
    expect(runtime.startCalls).toHaveLength(0)
    expect(staging.activeCount).toBe(0)
  })
})
