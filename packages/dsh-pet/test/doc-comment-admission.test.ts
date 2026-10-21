/**
 * Comment admission mirrors group admission and fails closed silently
 * (openspec pet-locus-doc-comments, requirement 「评论准入与群消息准入同构且静默 fail closed」).
 *
 * `parseDocCommentEvent` checks the compact transport shape; `admitDocCommentEvent`
 * applies the comment-only preconditions and then the SAME shared rules
 * (`admitCommon`) groups use. The comment query happens between them, so
 * these tests pass the query outcome in explicitly.
 */

import { describe, expect, it } from 'vitest'
import {
  admitDocCommentEvent,
  parseDocCommentEvent,
  type DocCommentEvent,
} from '../src/host/channel/doc-comment.js'
import type { LocusAdmissionContext } from '../src/host/locus/admission.js'
import { compactCommentEvent, DOC_IDS } from './fixtures/lark-subscribe.js'

const ROOT = `doc:docx:${DOC_IDS.docToken}`

function context(overrides: Partial<LocusAdmissionContext> = {}): LocusAdmissionContext {
  return {
    botOpenId: DOC_IDS.botOpenId,
    allowOpenIds: [DOC_IDS.ownerOpenId],
    watermark: 1_000,
    isDuplicate: () => false,
    authorizationState: 'authorized',
    ...overrides,
  }
}

function event(overrides: Parameters<typeof compactCommentEvent>[0] = {}): DocCommentEvent {
  const parsed = parseDocCommentEvent(compactCommentEvent({ timestamp: '2000', ...overrides }))
  if (parsed.kind !== 'event') throw new Error(`fixture did not parse: ${parsed.reason}`)
  return parsed.event
}

const whole = { kind: 'ok' as const, isWhole: true, replies: [], trigger: { replyId: DOC_IDS.wholeRootReplyId, text: `@${DOC_IDS.botOpenId} 问一下` } }

describe('parseDocCommentEvent', () => {
  it('reads the compact GenericProcessor shape', () => {
    const parsed = parseDocCommentEvent(compactCommentEvent({ timestamp: '1792084556000' }))
    expect(parsed).toEqual({
      kind: 'event',
      event: {
        token: DOC_IDS.docToken,
        fileType: 'docx',
        commentId: DOC_IDS.wholeCommentId,
        replyId: DOC_IDS.wholeRootReplyId,
        isMentioned: true,
        senderOpenId: DOC_IDS.ownerOpenId,
        senderType: 'user',
        isFromAgent: false,
        createdAt: 1792084556000,
      },
    })
  })

  it('spec Scenario "非 docx 评论": a sheet comment is unsupported-file-type before any query', () => {
    expect(parseDocCommentEvent(compactCommentEvent({ fileType: 'sheet' }))).toEqual({ kind: 'ignored', reason: 'unsupported-file-type' })
  })

  it('spec Scenario "未 @bot 的评论": dropped before any query', () => {
    expect(parseDocCommentEvent(compactCommentEvent({ isMentioned: false }))).toEqual({ kind: 'ignored', reason: 'no-mention' })
  })

  it('skips the watermark when the top-level timestamp is missing', () => {
    const line = JSON.parse(compactCommentEvent()) as Record<string, unknown>
    delete line['timestamp']
    const parsed = parseDocCommentEvent(JSON.stringify(line))
    expect(parsed.kind === 'event' && parsed.event.createdAt).toBeUndefined()
  })
})

describe('admitDocCommentEvent', () => {
  it('maps a whole-doc comment to the document root with the composite message id', () => {
    const decision = admitDocCommentEvent(event(), whole, context())

    expect(decision.kind).toBe('accepted')
    if (decision.kind !== 'accepted') return
    expect(decision.message).toMatchObject({
      source: 'doc-comment',
      endpoint: { chatId: ROOT },
      messageId: `${ROOT}/${DOC_IDS.wholeCommentId}/${DOC_IDS.wholeRootReplyId}`,
      text: `@${DOC_IDS.botOpenId} 问一下`,
      replyTarget: { chatId: ROOT, messageId: `${ROOT}/${DOC_IDS.wholeCommentId}/${DOC_IDS.wholeRootReplyId}` },
    })
    expect(decision.message.source === 'doc-comment' && decision.message.docComment).toBeUndefined()
  })

  it('maps an anchored comment to (root, comment_id) and carries the bounded quote', () => {
    const decision = admitDocCommentEvent(
      event({ commentId: DOC_IDS.anchoredCommentId, replyId: DOC_IDS.anchoredRootReplyId }),
      { kind: 'ok', isWhole: false, quote: '接口已有', replies: [], trigger: { replyId: DOC_IDS.anchoredRootReplyId, text: '为什么' } },
      context(),
    )

    expect(decision.kind).toBe('accepted')
    if (decision.kind !== 'accepted') return
    expect(decision.message.endpoint).toEqual({ chatId: ROOT, threadId: DOC_IDS.anchoredCommentId })
    expect(decision.message.source === 'doc-comment' && decision.message.docComment).toEqual({ quote: '接口已有' })
  })

  it('uses the trigger reply\'s own body, never another reply on the same comment', () => {
    const decision = admitDocCommentEvent(
      event({ commentId: DOC_IDS.anchoredCommentId, replyId: DOC_IDS.anchoredFollowupReplyId, noticeType: 'add_reply' }),
      {
        kind: 'ok', isWhole: false, quote: '接口已有',
        replies: [
          { replyId: DOC_IDS.anchoredRootReplyId, text: '根回复' },
          { replyId: DOC_IDS.anchoredFollowupReplyId, text: '追问' },
        ],
        trigger: { replyId: DOC_IDS.anchoredFollowupReplyId, text: '追问' },
      },
      context(),
    )
    expect(decision.kind === 'accepted' && decision.message.text).toBe('追问')
    expect(decision.kind === 'accepted' && decision.message.messageId)
      .toBe(`${ROOT}/${DOC_IDS.anchoredCommentId}/${DOC_IDS.anchoredFollowupReplyId}`)
  })

  it('caps the quote at 2000 units with the marker counted inside', () => {
    const decision = admitDocCommentEvent(
      event({ commentId: DOC_IDS.anchoredCommentId, replyId: DOC_IDS.anchoredRootReplyId }),
      { kind: 'ok', isWhole: false, quote: 'x'.repeat(5_000), replies: [], trigger: { replyId: DOC_IDS.anchoredRootReplyId, text: 'q' } },
      context(),
    )
    const quote = decision.kind === 'accepted' && decision.message.source === 'doc-comment' ? decision.message.docComment?.quote : undefined
    expect(quote?.length).toBe(2_000)
    expect(quote?.endsWith('…（已截断）')).toBe(true)
  })

  it('spec Scenario "非 allowlist 成员在已授权文档提问"', () => {
    const decision = admitDocCommentEvent(event({ fromOpenId: DOC_IDS.otherUserOpenId }), whole, context())
    expect(decision.kind).toBe('accepted')
  })

  it('spec Scenario "非 allowlist 成员首次 @ 未初始化文档"', () => {
    const decision = admitDocCommentEvent(
      event({ fromOpenId: DOC_IDS.otherUserOpenId }),
      whole,
      context({ authorizationState: 'uninitialized' }),
    )
    expect(decision).toMatchObject({ kind: 'rejected', reason: 'not-allowed-sender' })
  })

  it('spec Scenario "shell 档文档拒绝他人"', () => {
    const decision = admitDocCommentEvent(
      event({ fromOpenId: DOC_IDS.otherUserOpenId }),
      whole,
      context({ toolTier: () => 'shell' }),
    )
    expect(decision).toMatchObject({ kind: 'rejected', reason: 'owner-only-tier' })
  })

  it('spec Scenario "来自 agent 或 bot 的评论"', () => {
    expect(admitDocCommentEvent(event({ isFromAgent: true }), whole, context())).toMatchObject({ kind: 'rejected', reason: 'bot-sender' })
    expect(admitDocCommentEvent(event({ fromOpenId: DOC_IDS.botOpenId }), whole, context())).toMatchObject({ kind: 'rejected', reason: 'bot-sender' })
    expect(admitDocCommentEvent(event({ fromUserType: 'app' }), whole, context())).toMatchObject({ kind: 'rejected', reason: 'bot-sender' })
  })

  it('spec Scenario "同一回复重复到达": the dedup key is the composite message id, never event_id', () => {
    const seen = new Set<string>()
    const ctx = context({ isDuplicate: id => { const dup = seen.has(id); seen.add(id); return dup } })

    expect(admitDocCommentEvent(event({ eventId: 'e1' }), whole, ctx).kind).toBe('accepted')
    expect(admitDocCommentEvent(event({ eventId: 'e2' }), whole, ctx)).toMatchObject({ kind: 'rejected', reason: 'duplicate' })
    expect([...seen]).toEqual([`${ROOT}/${DOC_IDS.wholeCommentId}/${DOC_IDS.wholeRootReplyId}`])
  })

  it('rejects an event older than the subscription watermark', () => {
    expect(admitDocCommentEvent(event({ timestamp: '500' }), whole, context())).toMatchObject({ kind: 'rejected', reason: 'before-watermark' })
  })

  it('spec Scenario "无法判定全文或划词": a failed or scope-less query admits nothing', () => {
    expect(admitDocCommentEvent(event(), { kind: 'error' }, context())).toMatchObject({ kind: 'rejected', reason: 'comment-scope-unknown' })
    expect(admitDocCommentEvent(event(), { kind: 'scope-unknown' }, context())).toMatchObject({ kind: 'rejected', reason: 'comment-scope-unknown' })
  })

  it('spec Scenario "触发回复正文不可得"', () => {
    expect(admitDocCommentEvent(event(), { kind: 'reply-missing' }, context())).toMatchObject({ kind: 'rejected', reason: 'comment-reply-missing' })
  })

  it('spec Scenario "非 allowlist 控制命令": treats an allowlisted /scope command as control and a non-allowlisted one as a silent drop', () => {
    const control = { ...whole, trigger: { replyId: DOC_IDS.wholeRootReplyId, text: `@${DOC_IDS.botOpenId} /scope write` } }
    expect(admitDocCommentEvent(event(), control, context()).kind).toBe('control')
    expect(admitDocCommentEvent(event({ fromOpenId: DOC_IDS.otherUserOpenId }), control, context()))
      .toMatchObject({ kind: 'rejected', reason: 'control-not-allowed' })
  })
})
