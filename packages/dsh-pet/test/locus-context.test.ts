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
    expect(prompt).toContain('`pet_locus_finish`')
    expect(prompt).toContain('`pet_locus_wait(')
    expect(prompt).toContain('reply` 并提供非空正文')
    expect(prompt).toContain('no-reply` 并提供非空原因')
  })

  it('keeps the exported short alias equivalent', () => {
    const context = deliveryContext()
    expect(renderLocusPrompt(context)).toBe(renderLocusDeliveryPrompt(context))
  })

  it('states the platform mention contract in both delivery variants', () => {
    // Inbound text pre-renders mentions to display names, so an agent that
    // copies that form writes plain text and nobody is notified. The prompt has
    // to state the outbound rule (and that the Host renders whole display
    // names), or the asymmetry is invisible to the model.
    const first = renderLocusDeliveryPrompt(deliveryContext())
    const subsequent = renderLocusDeliveryPrompt(deliveryContext(), { position: 'subsequent' })

    for (const prompt of [first, subsequent]) {
      expect(prompt).toContain('@对方显示名')
      expect(prompt).toContain('<at user_id="ou_…">')
      expect(prompt).toContain('渲染成真实提醒')
    }
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

describe('the routing preamble is sent once per child', () => {
  // A locus child is a continuing conversation. Repeating the full routing
  // preamble every turn spends context budget restating facts the child
  // already holds, and the spec forbids it: "后续投递只带必要请求事实和查询
  // 引导，MUST NOT 每次重复全部目录说明".
  it('keeps the full preamble on the first delivery', () => {
    const first = renderLocusDeliveryPrompt(deliveryContext(), { position: 'first' })

    expect(first).toContain('### Endpoint')
    expect(first).toContain('### Locus')
    expect(first).toContain('### Workspace')
    expect(first).toContain('### Context anchor')
    expect(first).toContain('### 按需读取')
  })

  it('defaults to the full preamble when no position is supplied', () => {
    expect(renderLocusDeliveryPrompt(deliveryContext()))
      .toEqual(renderLocusDeliveryPrompt(deliveryContext(), { position: 'first' }))
  })

  it('drops the durable routing sections on a follow-up delivery', () => {
    const next = renderLocusDeliveryPrompt(deliveryContext(), { position: 'subsequent' })

    for (const section of ['### Endpoint', '### Locus', '### Main / child', '### Workspace', '### Permission', '### Context anchor']) {
      expect(next).not.toContain(section)
    }
    // Omitted facts stay retrievable from the Host rather than inferred.
    expect(next).toContain('pet_context')
  })

  it('still carries every per-delivery fact on a follow-up', () => {
    const context = deliveryContext()
    const next = renderLocusDeliveryPrompt(context, { position: 'subsequent' })

    // The request and its reply correlation change per delivery.
    expect(next).toContain(context.request.messageId)
    expect(next).toContain(context.request.text)
    expect(next).toContain('<current-request>')
    // The reply target is delivery-bound and must never be inherited.
    expect(next).toContain('### Reply target (current delivery only)')
    expect(next).toContain('pet_locus_finish')
    expect(next).toContain('pet_locus_wait')
    expect(next).toContain('不得提供 delivery/chat/message/thread target selector')
  })

  it('materially reduces the follow-up payload', () => {
    const context = deliveryContext()
    const first = renderLocusDeliveryPrompt(context, { position: 'first' })
    const next = renderLocusDeliveryPrompt(context, { position: 'subsequent' })

    // Guards the actual goal rather than a formatting detail: a follow-up must
    // be a small fraction of the preamble-bearing delivery.
    expect(next.length).toBeLessThan(first.length / 2)
  })
})
