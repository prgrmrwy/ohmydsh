import { describe, expect, it } from 'vitest'
import {
  isSafeLocusReplyTarget,
  locusEndpointKey,
  renderLocusDeliveryPrompt,
  renderLocusPrompt,
  type LocusDeliveryContext,
} from '../src/host/locus/context.js'

const endpoint = {
  chatId: 'oc_project00000000000000000000000',
  threadId: 'omt_topic000000000000000000000000',
  chatType: 'group' as const,
  chatName: '项目协作群',
}

function deliveryContext(
  overrides: Partial<LocusDeliveryContext> = {},
): LocusDeliveryContext {
  return {
    endpoint,
    locus: {
      locusId: 'locus-project-1',
      generation: 3,
      state: 'active',
    },
    main: {
      sessionId: 'session-main-1',
      title: '研发主会话',
    },
    child: {
      sessionId: 'session-child-1',
      title: '项目群子会话',
    },
    workspace: {
      workspaceId: 'workspace-1',
      title: 'repo workspace',
    },
    permission: {
      effective: 'read',
      desired: 'write',
      verifiedAt: 1_725_000_000_000,
      grantedBy: 'ou_owner',
    },
    contextAnchor: {
      status: 'confirmed',
      executionRoot: '/repo/.worktrees/project',
      constraints: ['只在确认的执行根内工作', '先确认再写入'],
      provenance: 'main-session-confirmed',
      confirmedAt: 1_725_000_000_100,
    },
    request: {
      messageId: 'om_request-1',
      senderOpenId: 'ou_requester',
      senderName: '张三',
      text: '请按需看一下这个 topic 的原始资料，并告诉我风险。',
      replyTarget: {
        chatId: endpoint.chatId,
        messageId: 'om_request-1',
        threadId: endpoint.threadId,
        rootMessageId: 'om_root-1',
      },
    },
    ...overrides,
  }
}

describe('unified locus delivery context', () => {
  it('renders the caller-bound locus facts and current request', () => {
    const prompt = renderLocusDeliveryPrompt(deliveryContext())

    for (const fact of [
      endpoint.chatId,
      endpoint.threadId,
      'locus-project-1',
      'generation：`3`',
      'session-main-1',
      'session-child-1',
      'workspace-1',
      'effective：read',
      'desired：write',
      '/repo/.worktrees/project',
      'main-session-confirmed',
      'om_request-1',
      'ou_requester',
      '请按需看一下这个 topic 的原始资料，并告诉我风险。',
    ]) {
      expect(prompt).toContain(fact)
    }

    expect(prompt).toContain('当前飞书回复 chat')
    expect(prompt).toContain('当前触发消息')
    expect(prompt).toContain('当前 thread')
    expect(prompt).toContain('om_root-1')
    expect(prompt).toContain('回复只能回到上述当前目标')
    expect(prompt).toContain('`pet_locus_reply`')
    expect(prompt).toContain('只接受 text')
  })

  it('keeps the exported short alias equivalent', () => {
    const context = deliveryContext()
    expect(renderLocusPrompt(context)).toBe(renderLocusDeliveryPrompt(context))
  })

  it('does not flatten history or invent a parent summary', () => {
    const context = deliveryContext({
      request: {
        ...deliveryContext().request,
        text: 'CURRENT_REQUEST_SENTINEL',
      },
    })
    const prompt = renderLocusDeliveryPrompt(context)

    expect(prompt).toContain('CURRENT_REQUEST_SENTINEL')
    expect(prompt).toContain('按需读取')
    expect(prompt).toContain('刻意不携带压平的聊天记录')
    expect(prompt).toContain('兄弟 child 历史')
    expect(prompt).toContain('不要自动把本 child 的结论、摘要或状态回传 main session')
    expect(prompt).not.toContain('会话上下文摘要')
    expect(prompt).not.toContain('PARENT_SUMMARY_SENTINEL')
    expect(prompt).not.toContain('HISTORY_MESSAGE_SENTINEL')
  })

  it('does not guess an unconfirmed anchor or permission', () => {
    const prompt = renderLocusDeliveryPrompt(
      deliveryContext({
        permission: { effective: 'read' },
        contextAnchor: { status: 'unknown' },
      }),
    )

    expect(prompt).toContain('effective：read')
    expect(prompt).toContain('desired：未确认')
    expect(prompt).toContain('status：unknown')
    expect(prompt).toContain('execution root：未确认')
    expect(prompt).toContain('constraints：未确认')
    expect(prompt).toContain('project resources：未确认')
    expect(prompt).toContain('send_message')
    expect(prompt).toContain('必须由所有者在管理面显式确认')
    expect(prompt).toContain('路径存在性与 sandbox 授权分离')
    expect(prompt).toContain('不自动运行 ws/sw')
    expect(prompt).not.toContain('/repo/.worktrees/project')
    expect(prompt).not.toContain('write 已生效')
  })

  it('explicitly drops reply authority for a local GUI turn', () => {
    const context = deliveryContext({
      request: {
        messageId: 'local-turn-1',
        senderOpenId: 'local-user',
        text: '在 GUI 里直接继续讨论。',
      },
    })
    const prompt = renderLocusDeliveryPrompt(context)

    expect(prompt).toContain('当前飞书回复目标：无')
    expect(prompt).toContain('不得沿用上一轮目标')
    expect(prompt).not.toContain('om_request-1')
    expect(prompt).not.toContain('om_root-1')
  })
})

describe('locus endpoint and reply target safety', () => {
  it('keeps chat-level and thread-level endpoint keys distinct', () => {
    expect(locusEndpointKey({ chatId: 'oc_chat' })).not.toBe(
      locusEndpointKey({ chatId: 'oc_chat', threadId: 'omt_thread' }),
    )
    expect(locusEndpointKey({ chatId: 'oc_chat' })).toBe(
      'oc_chat',
    )
  })

  it('accepts only a target in the caller-bound chat and thread', () => {
    const safe = {
      chatId: endpoint.chatId,
      messageId: 'om_current',
      threadId: endpoint.threadId,
    }
    expect(isSafeLocusReplyTarget(endpoint, safe)).toBe(true)
    expect(
      isSafeLocusReplyTarget(endpoint, { ...safe, chatId: 'oc_other' }),
    ).toBe(false)
    expect(
      isSafeLocusReplyTarget(endpoint, { ...safe, threadId: 'omt_other' }),
    ).toBe(false)
  })

  it('allows a current thread target for a chat-scoped locus', () => {
    expect(
      isSafeLocusReplyTarget(
        { chatId: endpoint.chatId, chatType: 'group' },
        {
          chatId: endpoint.chatId,
          messageId: 'om_current',
          threadId: 'omt_current',
        },
      ),
    ).toBe(true)
  })

  it('fails closed instead of rendering an unsafe target', () => {
    expect(() =>
      renderLocusDeliveryPrompt(
        deliveryContext({
          request: {
            ...deliveryContext().request,
            replyTarget: {
              chatId: 'oc_other',
              messageId: 'om_other',
              threadId: endpoint.threadId,
            },
          },
        }),
      ),
    ).toThrow('outside the caller-bound endpoint')
  })
})
