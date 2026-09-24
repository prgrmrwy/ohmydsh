import { describe, expect, it, vi } from 'vitest'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
} from '../src/host/locus/turn-observer.js'
import {
  PET_LOCUS_FINISH_TOOL,
  PET_LOCUS_TRACK_TOOL,
  PET_LOCUS_WAIT_TOOL,
  registerPetTools,
} from '../src/host/tools.js'

function contextRecord(current = true) {
  return {
    endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
    locus: { locusId: 'locus-1', generation: 2, source: 'automatic' as const, state: 'active' as const },
    main: { sessionId: 'parent-1' },
    child: { sessionId: 'child-1' },
    workspace: { workspaceId: 'workspace-1' },
    permission: { effective: 'read' as const },
    contextAnchor: { status: 'unknown' as const },
    ...(current
      ? {
          currentDelivery: {
            deliveryId: 'delivery-1',
            messageId: 'om-current',
            endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
            locusId: 'locus-1',
            generation: 2,
            childSessionId: 'child-1',
            status: 'current' as const,
            queueState: 'current' as const,
            replyTarget: { chatId: 'oc-1', threadId: 'omt-1', messageId: 'om-current' },
          },
        }
      : {}),
  }
}

function lifecycleTools(current = true, overrides: {
  readonly authorizeCurrentDelivery?: (input: { childSessionId: string; operation: 'finish' | 'wait'; proof?: unknown }) => unknown
  readonly currentCapability?: (childSessionId: string) => unknown
  readonly finishCurrentDelivery?: (input: unknown) => unknown
  readonly waitCurrentDelivery?: (input: unknown) => unknown
  readonly inspectCurrentCapability?: (childSessionId: string) => unknown
  readonly inspectCurrentDeliveryAuthorization?: (input: unknown) => unknown
  readonly logAuthorizationRefusal?: (input: unknown) => void
} = {}) {
  const definitions: Array<{ name: string; parameters: unknown; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
  const authorizeCurrentDelivery = overrides.authorizeCurrentDelivery ?? (() => current ? contextRecord(true) : undefined)
  const repository = {
    findByChildSessionId: () => [contextRecord(current)],
    authorizeCurrentDelivery,
  }
  const replyExact = vi.fn(async () => undefined)
  const currentCapability = overrides.currentCapability ?? (() => current ? {
    deliveryId: 'delivery-1',
    executionId: 'execution-1',
    turnId: 'child-1#0',
    source: 'delivery' as const,
  } : undefined)
  registerPetTools({ tools: { register: (definition: never) => { definitions.push(definition); return () => {} } } } as never, {
    repository: {} as never,
    locusRepository: repository,
    locusLifecycle: {
      locusRepository: repository,
      authorizeCurrentDelivery,
      lark: { reply: replyExact, replyExact },
      currentCapability,
      ...(overrides.inspectCurrentCapability === undefined ? {} : { inspectCurrentCapability: overrides.inspectCurrentCapability as never }),
      ...(overrides.inspectCurrentDeliveryAuthorization === undefined ? {} : { inspectCurrentDeliveryAuthorization: overrides.inspectCurrentDeliveryAuthorization as never }),
      ...(overrides.logAuthorizationRefusal === undefined ? {} : { logAuthorizationRefusal: overrides.logAuthorizationRefusal }),
      ...(overrides.finishCurrentDelivery === undefined ? {} : { finishCurrentDelivery: overrides.finishCurrentDelivery }),
      ...(overrides.waitCurrentDelivery === undefined ? {} : { waitCurrentDelivery: overrides.waitCurrentDelivery }),
    },
  })
  return {
    finish: definitions.find(item => item.name === PET_LOCUS_FINISH_TOOL)!,
    wait: definitions.find(item => item.name === PET_LOCUS_WAIT_TOOL)!,
    replyExact,
  }
}

const childExec = {
  agent: { id: 'child-1' },
  signal: new AbortController().signal,
}

describe('caller-bound Feishu lifecycle tools', () => {
  it('tells the model that a plain @display-name becomes a real mention', () => {
    // The tool schema travels with every turn, so this is where the outbound
    // mention contract has to be visible: inbound text shows `@名字` (platform
    // pre-rendering), and an agent that copies that form notifies nobody.
    const { finish } = lifecycleTools()

    expect(finish.description).toContain('@Display Name')
    expect(finish.description).toContain('real mention')
    expect(finish.description).toContain('<at user_id="ou_…">')
    expect(finish.description).toContain('no notification')
  })

  it('registers finish and wait, with no legacy reply alias or routing selector', () => {
    const { finish, wait } = lifecycleTools()
    expect(finish).toBeDefined()
    expect(wait).toBeDefined()
    expect(finish.parameters).toEqual({
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['reply', 'no-reply'] },
        text: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['outcome'],
    })
    expect(wait.parameters).toEqual({
      type: 'object',
      properties: { waitMinutes: { type: 'number' }, reason: { type: 'string' } },
      required: ['waitMinutes'],
    })
  })

  it('accepts reply and sends to the exact current Delivery message', async () => {
    const finishCurrentDelivery = vi.fn(async () => ({ sent: true, outcome: 'reply' as const }))
    const { finish } = lifecycleTools(true, { finishCurrentDelivery })
    await expect(finish.execute({ outcome: 'reply', text: 'answer' }, childExec)).resolves.toEqual({ sent: true, outcome: 'reply' })
    expect(finishCurrentDelivery).toHaveBeenCalledWith(expect.objectContaining({
      childSessionId: 'child-1',
      outcome: 'reply',
      text: 'answer',
    }))
  })

  it('accepts no-reply only with a non-empty reason', async () => {
    const finishCurrentDelivery = vi.fn(async () => ({ sent: false, outcome: 'no-reply' as const }))
    const { finish } = lifecycleTools(true, { finishCurrentDelivery })
    await expect(finish.execute({ outcome: 'no-reply', reason: 'not applicable' }, childExec)).resolves.toEqual({ sent: false, outcome: 'no-reply' })
    await expect(finish.execute({ outcome: 'reply', reason: 'wrong branch', text: 'answer' }, childExec)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(finish.execute({ outcome: 'no-reply', text: 'must not send' }, childExec)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(finishCurrentDelivery).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown finish keys before caller authorization or lifecycle dispatch', async () => {
    const authorize = vi.fn(async () => contextRecord(true))
    const finishCurrentDelivery = vi.fn(async () => ({ sent: true, outcome: 'reply' as const }))
    const { finish } = lifecycleTools(true, { authorizeCurrentDelivery: authorize, finishCurrentDelivery })
    await expect(finish.execute({ outcome: 'reply', text: 'answer', messageId: 'model-selector' }, childExec)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(authorize).not.toHaveBeenCalled()
    expect(finishCurrentDelivery).not.toHaveBeenCalled()
  })

  it('rejects null and non-plain finish arguments before authorization', async () => {
    const authorize = vi.fn(async () => contextRecord(true))
    const { finish } = lifecycleTools(true, { authorizeCurrentDelivery: authorize })
    await expect(finish.execute(null, childExec)).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_(REQUEST|ARGS)/) })
    await expect(finish.execute({ outcome: 'reply', text: null }, childExec)).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_(REQUEST|ARGS)/) })
    await expect(finish.execute(Object.assign(Object.create(null), { outcome: 'reply', text: 'answer' }), childExec)).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  it('never falls back to a direct Lark adapter when durable finish is absent', async () => {
    const { finish, replyExact } = lifecycleTools(true)
    await expect(finish.execute({ outcome: 'reply', text: 'answer' }, childExec)).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(replyExact).not.toHaveBeenCalled()
  })

  it('rejects unknown wait keys and invalid reason before lifecycle dispatch', async () => {
    const authorize = vi.fn(async () => contextRecord(true))
    const waitCurrentDelivery = vi.fn(async () => ({ accepted: true, deadline: 10, remainingMinutes: 10, capped: false }))
    const { wait } = lifecycleTools(true, { authorizeCurrentDelivery: authorize, waitCurrentDelivery })
    await expect(wait.execute({ waitMinutes: 5, deliveryId: 'model-selector' }, childExec)).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_(REQUEST|ARGS)/) })
    await expect(wait.execute({ waitMinutes: 5, reason: null }, childExec)).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_(REQUEST|ARGS)/) })
    expect(authorize).not.toHaveBeenCalled()
    expect(waitCurrentDelivery).not.toHaveBeenCalled()
  })

  it('refuses a GUI or initialization turn instead of reusing the prior target', async () => {
    const { finish, wait, replyExact } = lifecycleTools(false)
    await expect(finish.execute({ outcome: 'reply', text: 'must not leak' }, childExec)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(wait.execute({ waitMinutes: 10 }, childExec)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(replyExact).not.toHaveBeenCalled()
  })

  it.each(['finish', 'wait'] as const)('returns a stable non-leaking %s refusal and logs only its reason', async (operation) => {
    const logAuthorizationRefusal = vi.fn()
    const inspectCurrentCapability = vi.fn(() => ({ ok: false as const, reason: 'mixed-source' as const }))
    const tools = lifecycleTools(true, { inspectCurrentCapability, logAuthorizationRefusal })
    const call = operation === 'finish'
      ? tools.finish.execute({ outcome: 'reply', text: 'secret body' }, childExec)
      : tools.wait.execute({ waitMinutes: 5 }, childExec)
    await expect(call).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'This operation is not authorized for the current request.',
      fields: { reason: 'mixed-source' },
    })
    expect(logAuthorizationRefusal).toHaveBeenCalledWith({ operation, reason: 'mixed-source' })
    expect(String(await call.catch(error => error.message))).not.toContain('delivery-1')
  })

  it('uses the same refusal resolver for track', async () => {
    const definitions: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
    const logAuthorizationRefusal = vi.fn()
    registerPetTools({ tools: { register: (definition: never) => { definitions.push(definition); return () => {} } } } as never, {
      repository: {} as never,
      locusRepository: { findByChildSessionId: () => [] },
      intentTriage: {
        loci: { findByChildSessionId: () => [] },
        inspectCurrentCapability: () => ({ ok: false, reason: 'generation-mismatch' }),
        logAuthorizationRefusal,
        track: {
          store: { registerTodoItem: vi.fn() } as never,
          now: () => 1,
          newItemId: () => 'todo-1',
        },
      },
    })
    const track = definitions.find(item => item.name === PET_LOCUS_TRACK_TOOL)!
    await expect(track.execute({ summary: 'work', detail: 'details' }, childExec)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'This operation is not authorized for the current request.',
      fields: { reason: 'generation-mismatch' },
    })
    expect(logAuthorizationRefusal).toHaveBeenCalledWith({ operation: 'track', reason: 'generation-mismatch' })
  })

  it('sends through the original Delivery after a parent agent-message reply', async () => {
    const claimListeners: Array<(claim: LocusInboxClaim) => void> = []
    const observer = createLocusTurnObserver({
      onClaimed: listener => { claimListeners.push(listener); return () => {} },
      onTurnEnd: () => () => {},
      lookup: {
        find: ({ messageId }) => messageId === 'delivery-message'
          ? {
              deliveryId: 'delivery-1',
              executionId: 'execution-1',
              correlation: {
                endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
                locusId: 'locus-1',
                generation: 2,
                childSessionId: 'child-1',
              },
            }
          : undefined,
      },
    })
    const aggregate = {
      findByChildSession: () => ({
        id: 'locus-1', generation: 2,
        endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
        parentSessionId: 'parent-1', childSessionId: 'child-1', workspaceId: 'workspace-1',
        source: 'explicit' as const, state: 'active' as const, busy: true,
        permission: { desired: 'read' as const, effective: 'read' as const },
        createdAt: 1, updatedAt: 2,
      }),
      findCurrentDelivery: ({ executionId }: { executionId?: string }) => executionId === 'execution-1'
        ? contextRecord(true).currentDelivery
        : undefined,
    }
    const repository = asLocusContextRepository(
      aggregate,
      childSessionId => observer.currentForChild?.(childSessionId),
    )
    const definitions: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
    const reply = vi.fn(async () => undefined)
    registerPetTools({
      tools: { register: (definition: never) => { definitions.push(definition); return () => {} } },
    } as never, {
      repository: {} as never,
      locusRepository: repository,
      locusLifecycle: {
        locusRepository: repository,
        authorizeCurrentDelivery: async () => contextRecord(true),
        currentCapability: () => ({ deliveryId: 'delivery-1', executionId: 'execution-1', turnId: 'child-1#7', source: 'delivery' as const }),
        finishCurrentDelivery: async () => ({ sent: true, outcome: 'reply' as const }),
      },
    })
    const tool = definitions.find(item => item.name === PET_LOCUS_FINISH_TOOL)!
    const exec = {
      agent: { id: 'child-1' },
      signal: new AbortController().signal,
    }
    const claim = (value: LocusInboxClaim) => claimListeners.forEach(listener => listener(value))

    claim({ childSessionId: 'child-1', messageId: 'delivery-message', turn: 7, sourceKind: 'user' })
    claim({ childSessionId: 'child-1', messageId: 'parent-answer', turn: 7, sourceKind: 'agent-message' })

    await expect(tool.execute({ outcome: 'reply', text: 'MANGO-SPAWN-0914' }, exec)).resolves.toEqual({ sent: true, outcome: 'reply' })
    expect(reply).not.toHaveBeenCalled()
    observer.dispose()
  })

  it('refuses to send after the same child turn claims a Delivery and a steer', async () => {
    vi.useFakeTimers()
    try {
      const claimListeners: Array<(claim: LocusInboxClaim) => void> = []
      const observer = createLocusTurnObserver({
        onClaimed: listener => { claimListeners.push(listener); return () => {} },
        onTurnEnd: () => () => {},
        lookup: {
          find: ({ messageId }) => messageId === 'delivery-message'
            ? {
                deliveryId: 'delivery-1',
                executionId: 'execution-1',
                correlation: {
                  endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
                  locusId: 'locus-1',
                  generation: 2,
                  childSessionId: 'child-1',
                },
              }
            : undefined,
        },
      })
      const aggregate = {
        findByChildSession: () => ({
          id: 'locus-1', generation: 2,
          endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
          parentSessionId: 'parent-1', childSessionId: 'child-1', workspaceId: 'workspace-1',
          source: 'explicit' as const, state: 'active' as const, busy: true,
          permission: { desired: 'read' as const, effective: 'read' as const },
          createdAt: 1, updatedAt: 2,
        }),
        findCurrentDelivery: ({ executionId }: { executionId?: string }) => executionId === 'execution-1'
          ? contextRecord(true).currentDelivery
          : undefined,
      }
      const repository = asLocusContextRepository(
        aggregate,
        childSessionId => observer.currentForChild?.(childSessionId),
      )
      const definitions: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
      const reply = vi.fn(async () => undefined)
      registerPetTools({
        tools: { register: (definition: never) => { definitions.push(definition); return () => {} } },
      } as never, {
        repository: {} as never,
        locusRepository: repository,
        locusLifecycle: {
          locusRepository: repository,
          authorizeCurrentDelivery: async () => contextRecord(true),
          currentCapability: () => {
            const proof = observer.currentForChild?.('child-1')
            return proof === undefined
              ? undefined
              : { deliveryId: 'delivery-1', ...proof, source: 'delivery' as const }
          },
          finishCurrentDelivery: async () => ({ sent: true, outcome: 'reply' as const }),
        },
      })
      const tool = definitions.find(item => item.name === PET_LOCUS_FINISH_TOOL)!
      const exec = {
        agent: { id: 'child-1' },
        signal: new AbortController().signal,
      }
      const claim = (value: LocusInboxClaim) => claimListeners.forEach(listener => listener({ sourceKind: 'user', ...value }))

      claim({ childSessionId: 'child-1', messageId: 'delivery-message', turn: 7 })
      await expect(tool.execute({ outcome: 'reply', text: 'first' }, exec)).resolves.toEqual({ sent: true, outcome: 'reply' })
      claim({ childSessionId: 'child-1', messageId: 'gui-steer', turn: 7 })
      await expect(tool.execute({ outcome: 'reply', text: 'must not leak' }, exec))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
      await vi.runAllTimersAsync()
      await expect(tool.execute({ outcome: 'reply', text: 'still must not leak' }, exec))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
      expect(reply).not.toHaveBeenCalled()
      observer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
