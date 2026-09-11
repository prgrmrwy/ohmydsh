import { describe, expect, it, vi } from 'vitest'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
} from '../src/host/locus/turn-observer.js'
import { PET_LOCUS_REPLY_TOOL, registerPetTools } from '../src/host/tools.js'

function contextRecord(current = true) {
  return {
    endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
    locus: { id: 'locus-1', generation: 2, source: 'automatic' as const, state: 'active' as const },
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
            replyTarget: { chatId: 'oc-1', threadId: 'omt-1', messageId: 'om-current' },
          },
        }
      : {}),
  }
}

function replyTool(current = true) {
  const definitions: Array<{ name: string; parameters: unknown; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
  const repository = { findByChildSessionId: () => [contextRecord(current)] }
  const reply = vi.fn(async () => undefined)
  registerPetTools({ tools: { register: (definition: never) => { definitions.push(definition); return () => {} } } } as never, {
    repository: {} as never,
    locusRepository: repository,
    locusReply: { locusRepository: repository, lark: { reply, replyExact: reply } },
  })
  return {
    tool: definitions.find(item => item.name === PET_LOCUS_REPLY_TOOL)!,
    reply,
  }
}

describe('caller-bound Feishu reply tool', () => {
  it('accepts only text and sends to the exact current Delivery message', async () => {
    const { tool, reply } = replyTool()
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    })
    await expect(tool.execute({ text: 'answer' }, {
      agent: { session: { id: 'child-1' } },
      signal: new AbortController().signal,
    })).resolves.toEqual({ sent: true })
    expect(reply).toHaveBeenCalledWith('om-current', 'answer')
  })

  it('does not claim success when the strict Host reply fails', async () => {
    const definitions: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
    const repository = { findByChildSessionId: () => [contextRecord(true)] }
    registerPetTools({ tools: { register: (definition: never) => { definitions.push(definition); return () => {} } } } as never, {
      repository: {} as never,
      locusRepository: repository,
      locusReply: {
        locusRepository: repository,
        lark: { reply: async () => {}, replyExact: async () => { throw new Error('send failed') } },
      },
    })
    const tool = definitions.find(item => item.name === PET_LOCUS_REPLY_TOOL)!
    await expect(tool.execute({ text: 'answer' }, {
      agent: { session: { id: 'child-1' } }, signal: new AbortController().signal,
    })).rejects.toThrow('send failed')
  })

  it('refuses a GUI or initialization turn instead of reusing the prior target', async () => {
    const { tool, reply } = replyTool(false)
    await expect(tool.execute({ text: 'must not leak' }, {
      agent: { session: { id: 'child-1' } },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(reply).not.toHaveBeenCalled()
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
        locusReply: { locusRepository: repository, lark: { reply, replyExact: reply } },
      })
      const tool = definitions.find(item => item.name === PET_LOCUS_REPLY_TOOL)!
      const exec = {
        agent: { session: { id: 'child-1' } },
        signal: new AbortController().signal,
      }
      const claim = (value: LocusInboxClaim) => claimListeners.forEach(listener => listener(value))

      claim({ childSessionId: 'child-1', messageId: 'delivery-message', turn: 7 })
      await expect(tool.execute({ text: 'first' }, exec)).resolves.toEqual({ sent: true })
      claim({ childSessionId: 'child-1', messageId: 'gui-steer', turn: 7 })
      await expect(tool.execute({ text: 'must not leak' }, exec))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
      await vi.runAllTimersAsync()
      await expect(tool.execute({ text: 'still must not leak' }, exec))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
      expect(reply).toHaveBeenCalledTimes(1)
      observer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
