/**
 * Comment intake: scope from the queried `is_whole`, bounded cancellable retry
 * (openspec pet-locus-doc-comments, requirement 「文档评论按全文/划词同构映射…」).
 */

import { describe, expect, it } from 'vitest'
import type { DocCommentQuery } from '../src/host/channel/lark.js'
import type { NormalizedLocusAdmission } from '../src/host/channel/locus-controller.js'
import {
  createDocCommentIntake,
  DOC_COMMENT_QUERY_RETRY_MS,
  type DocCommentIntakeOutcome,
} from '../src/host/channel/doc-comment-intake.js'
import { compactCommentEvent, DOC_IDS } from './fixtures/lark-subscribe.js'

const ROOT = `doc:docx:${DOC_IDS.docToken}`
const ok = (isWhole: boolean, quote?: string): DocCommentQuery => ({
  kind: 'ok', isWhole, ...(quote === undefined ? {} : { quote }), replies: [],
  trigger: { replyId: DOC_IDS.wholeRootReplyId, text: '问题' },
})

function harness(answers: readonly (DocCommentQuery | Error)[], options: { stopAfterSleep?: number } = {}) {
  const calls: string[][] = []
  const sleeps: number[] = []
  const admissions: NormalizedLocusAdmission[] = []
  const outcomes: DocCommentIntakeOutcome[] = []
  const controller = new AbortController()
  let active = true
  let index = 0
  const intake = createDocCommentIntake({
    client: {
      queryDocComment: async (token, commentId, replyId) => {
        calls.push([token, commentId, replyId])
        const answer = answers[Math.min(index, answers.length - 1)]!
        index += 1
        if (answer instanceof Error) throw answer
        return answer
      },
    },
    admissionContext: () => ({
      botOpenId: DOC_IDS.botOpenId, allowOpenIds: [DOC_IDS.ownerOpenId], watermark: 0,
      isDuplicate: () => false, authorizationState: 'uninitialized',
    }),
    handleAdmission: async admission => {
      admissions.push(admission)
      return { kind: 'accepted', deliveryId: 'd', executionId: 'e', locusId: 'l', generation: 1 }
    },
    active: () => active,
    signal: () => controller.signal,
    sleep: async (ms, signal) => {
      sleeps.push(ms)
      if (options.stopAfterSleep === sleeps.length) {
        active = false
        controller.abort()
      }
      if (signal.aborted) throw new Error('aborted')
    },
    onOutcome: outcome => outcomes.push(outcome),
  })
  return { intake, calls, sleeps, admissions, outcomes, stop: () => { active = false; controller.abort() } }
}

describe('doc comment intake', () => {
  it('spec Scenario "全文评论进入文档级入口": is_whole=true goes to the root with doc:docx:D/c1/r1', async () => {
    const h = harness([ok(true)])
    await h.intake(compactCommentEvent())

    expect(h.calls).toEqual([[DOC_IDS.docToken, DOC_IDS.wholeCommentId, DOC_IDS.wholeRootReplyId]])
    expect(h.admissions).toHaveLength(1)
    expect(h.admissions[0]).toMatchObject({
      kind: 'accepted',
      needsInitialization: true,
      message: { endpoint: { chatId: ROOT }, messageId: `${ROOT}/${DOC_IDS.wholeCommentId}/${DOC_IDS.wholeRootReplyId}` },
    })
  })

  it('spec Scenario "划词评论进入评论级入口": is_whole=false goes to (root, comment_id) with the quote', async () => {
    const h = harness([ok(false, '接口已有')])
    await h.intake(compactCommentEvent({ commentId: DOC_IDS.anchoredCommentId, replyId: DOC_IDS.anchoredRootReplyId }))

    expect(h.admissions[0]).toMatchObject({
      message: {
        source: 'doc-comment',
        endpoint: { chatId: ROOT, threadId: DOC_IDS.anchoredCommentId },
        docComment: { quote: '接口已有' },
      },
    })
  })

  it('spec Scenario "划词评论下的后续回复留在同一入口": an add_reply keeps the comment endpoint with its new reply_id', async () => {
    const h = harness([ok(false, '接口已有')])
    await h.intake(compactCommentEvent({
      commentId: DOC_IDS.anchoredCommentId, replyId: DOC_IDS.anchoredFollowupReplyId, noticeType: 'add_reply',
    }))

    expect(h.admissions[0]).toMatchObject({
      message: {
        endpoint: { chatId: ROOT, threadId: DOC_IDS.anchoredCommentId },
        messageId: `${ROOT}/${DOC_IDS.anchoredCommentId}/${DOC_IDS.anchoredFollowupReplyId}`,
      },
    })
  })

  it('spec Scenario "知识库文档以底层 token 为根": the root is the event\'s obj token, never a wiki node', async () => {
    const h = harness([ok(true)])
    await h.intake(compactCommentEvent({ fileToken: 'docO0000000000000000000000' }))

    expect(h.calls[0]?.[0]).toBe('docO0000000000000000000000')
    expect(h.admissions[0]).toMatchObject({ message: { endpoint: { chatId: 'doc:docx:docO0000000000000000000000' } } })
  })

  it('spec Scenario "评论查询一次失败后重试成功"', async () => {
    const h = harness([new Error('timeout'), ok(true)])
    await h.intake(compactCommentEvent())

    expect(h.calls).toHaveLength(2)
    expect(h.sleeps).toEqual([DOC_COMMENT_QUERY_RETRY_MS[0]])
    expect(h.admissions).toHaveLength(1)
    expect(h.outcomes.some(outcome => outcome.kind === 'ignored' && outcome.reason === 'comment-scope-unknown')).toBe(false)
  })

  it('spec Scenario "无法判定全文或划词": three failed calls end in comment-scope-unknown, nothing admitted', async () => {
    const h = harness([{ kind: 'error' }])
    await h.intake(compactCommentEvent())

    expect(h.calls).toHaveLength(3)
    expect(h.sleeps).toEqual([2_000, 5_000])
    expect(h.admissions).toHaveLength(0)
    expect(h.outcomes).toEqual([{ kind: 'ignored', reason: 'comment-scope-unknown' }])
  })

  it('does not retry a definitive answer: a missing is_whole is final', async () => {
    const h = harness([{ kind: 'scope-unknown' }])
    await h.intake(compactCommentEvent())

    expect(h.calls).toHaveLength(1)
    expect(h.outcomes).toEqual([{ kind: 'ignored', reason: 'comment-scope-unknown' }])
  })

  it('spec Scenario "评论查询重试期间停用 channel": no further query, no admission', async () => {
    const h = harness([new Error('timeout'), ok(true)], { stopAfterSleep: 1 })
    await h.intake(compactCommentEvent())

    expect(h.calls).toHaveLength(1)
    expect(h.admissions).toHaveLength(0)
    expect(h.outcomes).toEqual([{ kind: 'cancelled' }])
  })

  it('discards an in-flight query that succeeds after the channel stopped', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const admissions: NormalizedLocusAdmission[] = []
    let active = true
    const controller = new AbortController()
    const intake = createDocCommentIntake({
      client: { queryDocComment: async () => { await gate; return ok(true) } },
      admissionContext: () => ({ botOpenId: DOC_IDS.botOpenId, allowOpenIds: [DOC_IDS.ownerOpenId], watermark: 0, isDuplicate: () => false }),
      handleAdmission: async admission => { admissions.push(admission); return { kind: 'ignored', reason: 'x' } },
      active: () => active,
      signal: () => controller.signal,
    })

    const running = intake(compactCommentEvent())
    active = false
    controller.abort()
    release()
    await running

    expect(admissions).toHaveLength(0)
  })

  it('spec Scenario "非 docx 评论": no comment query', async () => {
    const h = harness([ok(true)])
    await h.intake(compactCommentEvent({ fileType: 'sheet' }))

    expect(h.calls).toHaveLength(0)
    expect(h.outcomes).toEqual([{ kind: 'ignored', reason: 'unsupported-file-type' }])
  })
})
