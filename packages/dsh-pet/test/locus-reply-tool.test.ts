import { describe, expect, it, vi } from 'vitest'
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
})
