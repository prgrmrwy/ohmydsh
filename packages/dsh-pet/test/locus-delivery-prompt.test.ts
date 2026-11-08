/**
 * Delivery-prompt position and fact assembly.
 *
 * The full routing preamble must be sent when (and only when) the Host cannot
 * prove the child already received it. Delivery is durable proof only once the
 * content is bound into the child's inbox, so the position is derived from that
 * fact — never from rendering order or a runtime counter (the regression this
 * test exists to prevent: the current Delivery counted itself as history).
 */

import { describe, expect, it } from 'vitest'
import {
  locusDeliveryPromptContext,
  preamblePosition,
  renderLocusDeliveryFor,
  type LocusPromptDeliveryFacts,
  type LocusPromptMessageFacts,
  type LocusPromptRecordFacts,
} from '../src/host/locus/context.js'

const CHILD = 'session-child-1'

function delivery(
  deliveryId: string,
  options: { readonly sessionId?: string; readonly inboxMessageId?: string } = {},
): LocusPromptDeliveryFacts {
  return {
    deliveryId,
    sessionId: options.sessionId ?? CHILD,
    ...(options.inboxMessageId === undefined ? {} : { inboxMessageId: options.inboxMessageId }),
  }
}

function record(overrides: Partial<LocusPromptRecordFacts> = {}): LocusPromptRecordFacts {
  return {
    locusId: 'locus-1',
    endpoint: { chatId: 'oc_group', chatType: 'group' },
    locusMainSessionId: 'session-main-1',
    sessionId: CHILD,
    workspaceId: 'workspace-1',
    state: 'active',
    revision: 2,
    accessMode: 'read-only',
    ...overrides,
  }
}

function message(overrides: Partial<LocusPromptMessageFacts> = {}): LocusPromptMessageFacts {
  return {
    messageId: 'om_request-1',
    senderOpenId: 'ou_requester',
    text: '把这个群最近的上下文整理一下',
    replyTarget: { chatId: 'oc_group', messageId: 'om_request-1' },
    ...overrides,
  }
}

describe('delivery prompt position', () => {
  it('is the first delivery when the child has no durable Delivery at all', () => {
    expect(preamblePosition({ deliveries: [], sessionId: CHILD })).toBe('first')
  })

  it('is still first while every prior Delivery is accepted-only', () => {
    // Acceptance is durable admission, not proof that content reached the
    // child's inbox: a render that never queued must not consume the preamble.
    expect(preamblePosition({
      deliveries: [delivery('delivery-1'), delivery('delivery-2')],
      sessionId: CHILD,
    })).toBe('first')
  })

  it('is subsequent once a prior Delivery is bound into the child inbox', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      sessionId: CHILD,
    })).toBe('subsequent')
  })

  it('excludes the Delivery being rendered from the proof', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      sessionId: CHILD,
      currentDeliveryId: 'delivery-1',
    })).toBe('first')
  })

  it('does not count another child\'s Delivery as proof', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { sessionId: 'session-other', inboxMessageId: 'inbox-1' })],
      sessionId: CHILD,
    })).toBe('first')
  })

  it('treats an empty binding as no proof', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { inboxMessageId: '' })],
      sessionId: CHILD,
    })).toBe('first')
  })

  it('keeps a bound prior Delivery as proof when a later one is still queued', () => {
    expect(preamblePosition({
      deliveries: [
        delivery('delivery-1', { inboxMessageId: 'inbox-1' }),
        delivery('delivery-2'),
      ],
      sessionId: CHILD,
      currentDeliveryId: 'delivery-2',
    })).toBe('subsequent')
  })
})

describe('delivery prompt fact assembly', () => {
  it.each(['first', 'subsequent'])('spec Scenario "第二次投递不重复前言但声明档位" (render side): the %s prompt states the row accessMode and nothing pending', position => {
    for (const mode of ['read-only', 'danger-full-access'] as const) {
      const prompt = renderLocusDeliveryFor({
        record: record({ accessMode: mode }),
        message: message(),
        deliveries: position === 'first' ? [] : [delivery('prior', { inboxMessageId: 'prior-inbox' })],
      })
      expect(prompt).toContain(`访问模式：${mode}`)
      for (const gone of ['待应用', 'desired', 'generation', 'composition', 'Tool tier', '工具档位', 'Permission', 'Context anchor', 'execution root']) {
        expect(prompt).not.toContain(gone)
      }
    }
  })

  it('never renders full access for a read-only row, nor read-only for a full-access row', () => {
    const readOnly = renderLocusDeliveryFor({ record: record({ accessMode: 'read-only' }), message: message(), deliveries: [] })
    expect(readOnly).toContain('不提供 shell')
    expect(readOnly).not.toContain('可执行本机命令')
    const full = renderLocusDeliveryFor({ record: record({ accessMode: 'danger-full-access' }), message: message(), deliveries: [] })
    expect(full).toContain('可执行本机命令')
    expect(full).not.toContain('不提供 shell')
  })

  it('renders the full preamble with the record facts on a first delivery', () => {
    const prompt = renderLocusDeliveryFor({ record: record(), message: message(), deliveries: [] })
    expect(prompt).toContain('### Endpoint')
    expect(prompt).toContain('### Access mode')
    expect(prompt).toContain('oc_group')
    expect(prompt).toContain('session-main-1')
  })

  it('renders the compact follow-up with the access line once delivery is proven', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
    })
    expect(prompt).not.toContain('### Endpoint')
    expect(prompt).toContain('访问模式：read-only')
    expect(prompt).toContain('om_request-1')
  })

  it('assembles a context whose accessMode and identity match the record', () => {
    const context = locusDeliveryPromptContext({ record: record({ accessMode: 'danger-full-access' }), message: message() })
    expect(context.accessMode).toBe('danger-full-access')
    expect(context.locus).toEqual({ locusId: 'locus-1', state: 'active', revision: 2 })
    expect(context.main.sessionId).toBe('session-main-1')
    expect(context.child.sessionId).toBe(CHILD)
    expect(context.request.messageId).toBe('om_request-1')
  })
})

describe('the delivery states the measured entrance readability', () => {
  it('declares readability in the preamble only for the readable state', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
      readability: 'readable',
    })

    expect(prompt).toContain('本入口读取能力（本次实测）')
    expect(prompt).toContain('已实测可读')
  })

  it('states the limit in the preamble when the read failed', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
      readability: 'unreadable',
    })

    expect(prompt).toContain('不可读')
    expect(prompt).not.toContain('已实测可读')
  })

  it('reports the measured state on a follow-up delivery too, not just the preamble', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      readability: 'readable',
    })

    expect(prompt).toContain('访问模式：read-only')
    expect(prompt).toContain('本入口读取能力（本次实测）')
    expect(prompt).toContain('已实测可读')
  })

  it('never claims readability when no measurement exists', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
    })

    expect(prompt).toContain('未确认')
    expect(prompt).not.toContain('已实测可读')
  })

  it('keeps the access fact and the read fact separate: a full-access child can face an unreadable entrance', () => {
    const prompt = renderLocusDeliveryFor({
      record: record({ accessMode: 'danger-full-access' }),
      message: message(),
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      readability: 'unreadable',
    })

    expect(prompt).toContain('访问模式：danger-full-access')
    expect(prompt).toContain('不可读')
  })
})

describe('doc-comment delivery prompt (pet-locus-doc-comments D12)', () => {
  const ROOT = 'doc:docx:Dx0000000000000000000000001'
  const docRecord = (threadId?: string) => record({
    endpoint: threadId === undefined ? { chatId: ROOT } : { chatId: ROOT, threadId },
  })
  const docMessage = (threadId?: string) => message({
    messageId: `${ROOT}/${threadId ?? '1'}/2`,
    text: '这里为什么这样设计',
    replyTarget: { chatId: ROOT, ...(threadId === undefined ? {} : { threadId }), messageId: `${ROOT}/${threadId ?? '1'}/2` },
  })

  it('spec Scenario "划词评论进入评论级入口": an anchored comment names its kind and carries the untrusted quote', () => {
    const prompt = renderLocusDeliveryFor({
      record: docRecord('7696944637407137026'),
      message: { ...docMessage('7696944637407137026'), docComment: { quote: '接口已有' } },
      deliveries: [],
    })

    expect(prompt).toContain('飞书文档评论')
    expect(prompt).toContain('划词评论')
    expect(prompt).toMatch(/不可信[\s\S]*接口已有/)
    expect(prompt).toContain('pet_locus_doc_context')
    expect(prompt).toContain('评论区所有人')
    expect(prompt).toContain('回复会追加在该评论下')
  })

  it('a whole-doc comment says so and has no quote', () => {
    const prompt = renderLocusDeliveryFor({ record: docRecord(), message: docMessage(), deliveries: [] })

    expect(prompt).toContain('全文评论')
    expect(prompt).not.toContain('划词原文')
    // Full comments cannot be replied to: the answer is a NEW full comment that @-notifies the asker.
    expect(prompt).toContain('新的全文评论')
    expect(prompt).not.toContain('回复会追加在该评论下')
  })

  it('spec Scenario "文档 Delivery 不调用 IM 接口" (prompt side): no group-read probe text, no @ promise, no chat history tool', () => {
    for (const position of [[], [delivery('d0', { inboxMessageId: 'inbox-0' })]]) {
      const prompt = renderLocusDeliveryFor({
        record: docRecord('9'), message: { ...docMessage('9'), docComment: { quote: 'q' } }, deliveries: position,
      })
      expect(prompt).not.toContain('本入口读取能力（本次实测）')
      expect(prompt).not.toContain('pet_locus_chat_history')
      expect(prompt).not.toContain('渲染成真实提醒')
      expect(prompt).toContain('@ 不会产生提醒')
    }
  })

  it('tells the child not to paste private project content unless the asker is allowlisted', () => {
    const outsider = renderLocusDeliveryFor({
      record: docRecord(), message: { ...docMessage(), senderAllowlisted: false }, deliveries: [],
    })
    const owner = renderLocusDeliveryFor({
      record: docRecord(), message: { ...docMessage(), senderAllowlisted: true }, deliveries: [],
    })

    expect(outsider).toContain('提问者不在 allowlist')
    expect(owner).not.toContain('提问者不在 allowlist')
  })

  it('spec Scenario "IM 入口不受影响": the group prompt is unchanged', () => {
    const prompt = renderLocusDeliveryFor({ record: record(), message: message(), deliveries: [], readability: 'readable' })

    expect(prompt).toContain('本入口读取能力（本次实测）')
    expect(prompt).toContain('渲染成真实提醒')
    expect(prompt).not.toContain('飞书文档评论')
  })
})

describe('spec Scenario "触发者姓名查询失败"', () => {
  it('a doc prompt with no resolved name shows only the open id and still renders', () => {
    const ROOT = 'doc:docx:Dx0000000000000000000000001'
    const prompt = renderLocusDeliveryFor({
      record: record({ endpoint: { chatId: ROOT } }),
      message: message({ messageId: `${ROOT}/1/2`, senderOpenId: 'ou_commenter', replyTarget: { chatId: ROOT, messageId: `${ROOT}/1/2` } }),
      deliveries: [],
    })
    expect(prompt).toContain('ou_commenter')
    expect(prompt).toContain('飞书文档评论')
  })
})


// ---------------------------------------------------------------------------
// D9: the first-delivery note about a rebind (`reboundFrom` on the group row)
// ---------------------------------------------------------------------------

const REBOUND_NOTE = '本群此前由另一个已归档的会话跟进，那段上下文没有迁移'

describe('first-delivery rebind note (D9)', () => {
  it.each([
    ['group', { chatId: 'oc_group', chatType: 'group' as const }],
    ['topic', { chatId: 'oc_group', chatType: 'group' as const, threadId: 'omt_1' }],
  ])('spec Scenario "改绑后的首次创建携带来历说明" (%s row)', (_kind, endpoint) => {
    const plain = renderLocusDeliveryFor({ record: record({ endpoint }), message: message({ replyTarget: { chatId: 'oc_group', messageId: 'om_request-1', ...('threadId' in endpoint ? { threadId: endpoint.threadId } : {}) } }), deliveries: [] })
    const prompt = renderLocusDeliveryFor({
      record: record({ endpoint, reboundFrom: 'session-w0' }),
      message: message({ replyTarget: { chatId: 'oc_group', messageId: 'om_request-1', ...('threadId' in endpoint ? { threadId: endpoint.threadId } : {}) } }),
      deliveries: [],
    })
    expect(prompt).toContain(REBOUND_NOTE)
    expect(prompt).toContain('`pet_locus_chat_history`')
    // Only a statement: no tool appears that the plain preamble did not name, and W0 itself is never shown.
    const tools = (text: string) => new Set(text.match(/`[a-z_]+`/g) ?? [])
    expect([...tools(prompt)].filter(name => !tools(plain).has(name))).toEqual(['`pet_locus_chat_history`'].filter(name => !tools(plain).has(name)))
    expect(prompt).not.toContain('session-w0')
  })

  it('spec Scenario "从零创建的首投前言不含来历说明"', () => {
    const prompt = renderLocusDeliveryFor({ record: record(), message: message(), deliveries: [] })
    expect(prompt).not.toContain(REBOUND_NOTE)
    // The preamble's own target-binding rules say "改绑"; no line may speak of an archived predecessor.
    expect(prompt).not.toContain('已归档')
  })

  it('spec Scenario "原地重建不追加说明"', () => {
    // An in-place rebuild is just a new not-created child: same record, a fresh session, no reboundFrom.
    const prompt = renderLocusDeliveryFor({ record: record({ sessionId: 'session-rebuilt' }), message: message(), deliveries: [] })
    expect(prompt).not.toContain(REBOUND_NOTE)
    expect(prompt).not.toMatch(/重建/)
  })

  it('spec Scenario "改绑说明在后续重建后仍然出现"', () => {
    const rebuilt = record({ sessionId: 'session-rebuilt', reboundFrom: 'session-w0' })
    const prompt = renderLocusDeliveryFor({
      record: rebuilt,
      message: message(),
      // The OLD child's bound Delivery is not proof for the new child.
      deliveries: [delivery('old', { sessionId: CHILD, inboxMessageId: 'inbox-old' })],
    })
    expect(prompt).toContain(REBOUND_NOTE)
    expect(prompt).not.toMatch(/重建/)
    // Only the first delivery carries it.
    const second = renderLocusDeliveryFor({
      record: rebuilt,
      message: message(),
      deliveries: [delivery('first', { sessionId: 'session-rebuilt', inboxMessageId: 'inbox-1' })],
    })
    expect(second).not.toContain(REBOUND_NOTE)
  })

  it('spec Scenario "文档入口的改绑说明指向文档上下文工具"', () => {
    const endpoint = { chatId: 'doc:docx:Dx1', threadId: '77' }
    const prompt = renderLocusDeliveryFor({
      record: record({ endpoint, reboundFrom: 'session-w0' }),
      message: message({ replyTarget: { chatId: 'doc:docx:Dx1', messageId: 'doc:docx:Dx1/77/1', threadId: '77' } }),
      deliveries: [],
    })
    const note = prompt.split('\n').find(line => line.includes(REBOUND_NOTE))
    expect(note).toBeDefined()
    expect(note).toContain('`pet_locus_doc_context`')
    expect(note).not.toContain('pet_locus_chat_history')
  })
})
