/**
 * Topic list reader (change `locus-read-referenced-chats`, D6; spec "链接指向话题
 * 消息时返回整个话题", "话题分页合约与终止", "话题列表失败的回退与去重"; tasks 8,
 * test-plan R13–R15, R17 list failures, R19 stop-read).
 *
 * The reader is pure over an injected runner: every test scripts the runner's
 * answers page by page and asserts what the reader hands back, never a process.
 */

import { describe, expect, it } from 'vitest'
import {
  initialTopicState,
  readTopicPage,
  type TopicPageResult,
  type TopicReaderState,
  type TopicRunner,
  type TopicRunnerResult,
} from '../src/host/locus/topic-reader.js'
import {
  FAILURE_CODES,
  failureEnvelope,
  TOPIC_CHAT,
  TOPIC_OTHER_CHAT,
  TOPIC_OTHER_THREAD,
  TOPIC_THREAD,
  TOPIC_TOKENS,
  topicItem,
  topicItems,
  topicMessageId,
  topicPageEnvelope,
} from './fixtures/lark-thread-list-envelopes.js'

function ok(envelope: unknown): TopicRunnerResult {
  return { ok: true, envelope }
}

/** A runner that answers from a script in order and records every argv. */
function scripted(...answers: TopicRunnerResult[]): { runner: TopicRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = []
  const queue = [...answers]
  const runner: TopicRunner = async (args) => {
    calls.push(args)
    const next = queue.shift()
    if (next === undefined) throw new Error('runner script exhausted')
    return next
  }
  return { runner, calls }
}

function read(
  runner: TopicRunner,
  state: TopicReaderState = initialTopicState,
  linkedIndex = 3,
): Promise<TopicPageResult> {
  return readTopicPage({
    runner,
    threadId: TOPIC_THREAD,
    chatId: TOPIC_CHAT,
    linkedMessageId: topicMessageId(linkedIndex),
    state,
  })
}

/** Reads until the reader reports an end, returning every result. */
async function readAll(runner: TopicRunner, linkedIndex = 3): Promise<TopicPageResult[]> {
  const results: TopicPageResult[] = []
  let state = initialTopicState
  for (let guard = 0; guard < 20; guard += 1) {
    const result = await read(runner, state, linkedIndex)
    results.push(result)
    if (result.kind === 'retry') { state = result.state; continue }
    if (result.kind !== 'page' || result.done) return results
    state = result.state
  }
  throw new Error('reader did not terminate')
}

function pageOf(result: TopicPageResult) {
  if (result.kind !== 'page') throw new Error(`expected a page, got ${result.kind}`)
  return result
}

describe('topic reader: delivery (R13)', () => {
  it('returns root and 5 replies and marks the linked third reply', async () => {
    const { runner, calls } = scripted(ok(topicPageEnvelope(topicItems(0, 5))))
    const page = pageOf(await read(runner))

    expect(page.done).toBe(true)
    expect(page.failed).toBeUndefined()
    expect(page.messages.map((m) => m.messageId)).toEqual([0, 1, 2, 3, 4, 5].map(topicMessageId))
    expect(page.messages.map((m) => m.position)).toEqual([-1, 0, 1, 2, 3, 4])
    expect(page.messages.filter((m) => m.linked).map((m) => m.messageId)).toEqual([topicMessageId(3)])
    expect(page.messages[0]).toMatchObject({ senderName: '测试用户', msgType: 'text', deleted: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.arrayContaining([
      'im', '+threads-messages-list', '--thread', TOPIC_THREAD, '--as', 'bot',
      '--order', 'asc', '--page-size', '50', '--no-reactions', '--format', 'json',
    ]))
    expect(calls[0]).not.toContain('--page-token')
  })

  it('120 messages over three platform pages read in order with no gap or duplicate', async () => {
    const { runner, calls } = scripted(
      ok(topicPageEnvelope(topicItems(0, 49), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      ok(topicPageEnvelope(topicItems(50, 99), { hasMore: true, pageToken: TOPIC_TOKENS.third })),
      ok(topicPageEnvelope(topicItems(100, 119))),
    )
    const results = await readAll(runner)
    const pages = results.map(pageOf)

    expect(pages.map((p) => p.done)).toEqual([false, false, true])
    const ids = pages.flatMap((p) => p.messages.map((m) => m.messageId))
    expect(ids).toEqual(Array.from({ length: 120 }, (_, i) => topicMessageId(i)))
    expect(new Set(ids).size).toBe(120)
    // One CLI call per page; the token of page N is passed to call N+1.
    expect(calls).toHaveLength(3)
    expect(calls[1]).toEqual(expect.arrayContaining(['--page-token', TOPIC_TOKENS.second]))
    expect(calls[2]).toEqual(expect.arrayContaining(['--page-token', TOPIC_TOKENS.third]))
    expect(pages[0]?.state).toMatchObject({ pageToken: TOPIC_TOKENS.second, pageIndex: 2, attempt: 0 })
  })

  it('messages added before the last page are read; the read ends at has_more false', async () => {
    // 3 replies arrive while the read is under way: the last page is longer than planned.
    const { runner } = scripted(
      ok(topicPageEnvelope(topicItems(0, 49), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      ok(topicPageEnvelope(topicItems(50, 52))),
    )
    const pages = (await readAll(runner)).map(pageOf)

    expect(pages.at(-1)?.done).toBe(true)
    expect(pages.flatMap((p) => p.messages)).toHaveLength(53)
  })

  it('a reply with 20 images is one ordered list item and the next reply follows once', async () => {
    // Splitting the 20 images 8/8/4 is the unit packer's job (core); the reader
    // must hand the item over intact and in position order.
    const twenty = JSON.stringify({ content: [Array.from({ length: 20 }, (_, i) => ({ tag: 'img', image_key: `img_v3_0000_${String(i)}` }))] })
    const { runner } = scripted(ok(topicPageEnvelope([
      topicItem({ index: 0 }),
      topicItem({ index: 1, msgType: 'post', content: twenty }),
      topicItem({ index: 2 }),
    ])))
    const page = pageOf(await read(runner, initialTopicState, 9))

    expect(page.messages.map((m) => m.messageId)).toEqual([0, 1, 2].map(topicMessageId))
    expect(page.messages[1]).toMatchObject({ msgType: 'post', content: twenty })
    expect(page.messages.every((m) => !m.linked)).toBe(true)
  })

  it('linked target in the list is marked once; a target absent from the list is not appended', async () => {
    const { runner } = scripted(
      ok(topicPageEnvelope(topicItems(0, 4))),
      ok(topicPageEnvelope(topicItems(0, 4))),
    )
    const present = pageOf(await read(runner, initialTopicState, 2))
    expect(present.messages.filter((m) => m.linked)).toHaveLength(1)

    const absent = pageOf(await read(runner, initialTopicState, 77))
    expect(absent.messages).toHaveLength(5)
    expect(absent.messages.some((m) => m.linked)).toBe(false)
    expect(absent.messages.map((m) => m.messageId)).not.toContain(topicMessageId(77))
  })
})

describe('topic reader: pagination contract (R14)', () => {
  it('repeated page_token is pagination-loop with delivered pages kept', async () => {
    const { runner, calls } = scripted(
      ok(topicPageEnvelope(topicItems(0, 4), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      // The platform answers page 2 with the SAME token again.
      ok(topicPageEnvelope(topicItems(5, 9), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
    )
    const results = await readAll(runner)

    expect(results).toHaveLength(2)
    expect(pageOf(results[0]!).messages).toHaveLength(5)
    const last = pageOf(results[1]!)
    expect(last.done).toBe(true)
    expect(last.failed).toEqual({ id: 'topic-page@3', reason: 'pagination-loop' })
    expect(last.messages).toHaveLength(5)
    expect(calls).toHaveLength(2)
  })

  it('empty page with next token continues; three consecutive empty pages are pagination-stalled', async () => {
    const continuing = scripted(
      ok(topicPageEnvelope([], { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      ok(topicPageEnvelope(topicItems(0, 1))),
    )
    const continued = (await readAll(continuing.runner)).map(pageOf)
    expect(continued[0]).toMatchObject({ messages: [], done: false, state: { emptyStreak: 1 } })
    expect(continued[1]?.done).toBe(true)
    expect(continued[1]?.state.emptyStreak).toBe(0)

    const stalled = scripted(
      ok(topicPageEnvelope([], { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      ok(topicPageEnvelope([], { hasMore: true, pageToken: TOPIC_TOKENS.third })),
      ok(topicPageEnvelope([], { hasMore: true, pageToken: TOPIC_TOKENS.fourth })),
    )
    const results = await readAll(stalled.runner)
    const last = pageOf(results.at(-1)!)
    expect(results).toHaveLength(3)
    expect(last.done).toBe(true)
    expect(last.failed).toEqual({ id: 'topic-page@3', reason: 'pagination-stalled' })
    expect(last.messages).toEqual([])
  })

  it('foreign chat_id or thread_id item rejects the whole page', async () => {
    for (const foreign of [
      topicItem({ index: 2, chatId: TOPIC_OTHER_CHAT }),
      topicItem({ index: 2, threadId: TOPIC_OTHER_THREAD }),
    ]) {
      // First page: the list is unusable, so core falls back to the single read.
      const first = scripted(ok(topicPageEnvelope([topicItem({ index: 0 }), topicItem({ index: 1 }), foreign])))
      expect(await read(first.runner)).toEqual({
        kind: 'fallback',
        failed: { id: 'topic-list', reason: 'envelope-invalid(topic-item-foreign)' },
      })

      // Later page: nothing of that page is delivered, earlier pages stay.
      const later = scripted(
        ok(topicPageEnvelope(topicItems(0, 1), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
        ok(topicPageEnvelope([topicItem({ index: 2 }), foreign])),
      )
      const results = await readAll(later.runner)
      expect(results.at(-1)).toEqual({
        kind: 'stopped',
        failed: { id: 'topic-page@2', reason: 'envelope-invalid(topic-item-foreign)' },
      })
    }
  })

  it('230001 on a continuation is a topic-page failure with no cursor', async () => {
    const { runner } = scripted(
      ok(topicPageEnvelope(topicItems(0, 1), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      { ok: false, code: FAILURE_CODES.invalidPageToken },
    )
    const results = await readAll(runner)

    expect(pageOf(results[0]!).messages).toHaveLength(2)
    expect(results[1]).toEqual({ kind: 'stopped', failed: { id: 'topic-page@2', reason: '230001' } })
  })

  it('maps a failure envelope returned as a success transport to the same code', async () => {
    const { runner } = scripted(ok(failureEnvelope(FAILURE_CODES.noPermission)))
    expect(await read(runner)).toEqual({ kind: 'fallback', failed: { id: 'topic-list', reason: '230002' } })
  })

  it('rejects a malformed page: positions not strictly increasing, or has_more without a token', async () => {
    const backwards = scripted(ok(topicPageEnvelope([
      topicItem({ index: 1, position: 4 }),
      topicItem({ index: 2, position: 4 }),
    ])))
    expect(await read(backwards.runner)).toEqual({
      kind: 'fallback',
      failed: { id: 'topic-list', reason: 'envelope-invalid(topic-position-order)' },
    })

    const noToken = scripted(ok(topicPageEnvelope(topicItems(0, 1), { hasMore: true })))
    expect(await read(noToken.runner)).toEqual({
      kind: 'fallback',
      failed: { id: 'topic-list', reason: 'envelope-invalid(topic-page-malformed)' },
    })

    const notArray = scripted(ok({ ok: true, data: { has_more: false, messages: 'x' } }))
    expect(await read(notArray.runner)).toMatchObject({ kind: 'fallback', failed: { reason: 'envelope-invalid(topic-page-malformed)' } })
  })
})

describe('topic reader: list failure fallback (R15, R17, R19)', () => {
  it('first list page transient failure: topic-list diagnostic only, failed empty, attempt 1 cursor, no items delivered', async () => {
    const { runner } = scripted({ ok: false, detail: 'timeout' })
    const result = await read(runner)

    expect(result.kind).toBe('retry')
    if (result.kind !== 'retry') return
    expect(result.state).toEqual({ ...initialTopicState, attempt: 1 })
    expect(result.diagnostic).toContain('topic-list')
    expect(result.diagnostic).toContain('1')
    expect(result).not.toHaveProperty('failed')
    expect(result).not.toHaveProperty('messages')
  })

  it('first list page 230002 falls back to the linked single message with topic-list and no topic cursor', async () => {
    for (const code of [FAILURE_CODES.noPermission, FAILURE_CODES.scopeMissing, FAILURE_CODES.invalidPageToken]) {
      const { runner } = scripted({ ok: false, code })
      expect(await read(runner)).toEqual({ kind: 'fallback', failed: { id: 'topic-list', reason: code } })
    }
  })

  it('first page failing three times falls back; attempts 1 and 2 retry at the same position', async () => {
    const { runner } = scripted({ ok: false, detail: 'timeout' }, { ok: false, detail: 'HTTP 502' }, { ok: false, detail: 'timeout' })
    const first = await read(runner)
    if (first.kind !== 'retry') throw new Error('expected retry')
    const second = await read(runner, first.state)
    if (second.kind !== 'retry') throw new Error('expected retry')
    expect(second.state.attempt).toBe(2)
    const third = await read(runner, second.state)
    expect(third).toMatchObject({ kind: 'fallback', failed: { id: 'topic-list' } })
  })

  it('page 2 permission failure keeps page 1 and ends terminally with topic-page@2', async () => {
    const { runner } = scripted(
      ok(topicPageEnvelope(topicItems(0, 4), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      { ok: false, code: FAILURE_CODES.noPermission },
    )
    const results = await readAll(runner)

    expect(pageOf(results[0]!).messages).toHaveLength(5)
    expect(results[1]).toEqual({ kind: 'stopped', failed: { id: 'topic-page@2', reason: '230002' } })
  })

  it('topic list page failing three times ends the read with topic-page failure and no cursor', async () => {
    const { runner } = scripted(
      ok(topicPageEnvelope(topicItems(0, 4), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      { ok: false, detail: 'timeout' },
      { ok: false, detail: 'timeout' },
      { ok: false, detail: 'timeout' },
    )
    const results = await readAll(runner)

    expect(results.map((r) => r.kind)).toEqual(['page', 'retry', 'retry', 'stopped'])
    const stopped = results[3]!
    expect(stopped).toMatchObject({ kind: 'stopped', failed: { id: 'topic-page@2' } })
    // The retry cursors carry the same page and token with a growing attempt.
    expect((results[1] as { state: TopicReaderState }).state).toMatchObject({ pageIndex: 2, pageToken: TOPIC_TOKENS.second, attempt: 1 })
    expect((results[2] as { state: TopicReaderState }).state.attempt).toBe(2)
  })

  it('topic first page delivered, second page three transient failures: no cursor, topic-page@2 in failed, delivered kept', async () => {
    const { runner } = scripted(
      ok(topicPageEnvelope(topicItems(0, 49), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
      { ok: false, detail: 'timeout' },
      { ok: false, detail: 'timeout' },
      { ok: false, detail: 'timeout' },
    )
    const results = await readAll(runner)
    const delivered = results.filter((r) => r.kind === 'page').flatMap((r) => pageOf(r).messages)

    expect(delivered).toHaveLength(50)
    const last = results.at(-1)!
    expect(last.kind).toBe('stopped')
    expect(last).not.toHaveProperty('state')
  })

  it('a successful page after a transient failure resets the attempt count', async () => {
    const { runner } = scripted(
      { ok: false, detail: 'timeout' },
      ok(topicPageEnvelope(topicItems(0, 1), { hasMore: true, pageToken: TOPIC_TOKENS.second })),
    )
    const retry = await read(runner)
    if (retry.kind !== 'retry') throw new Error('expected retry')
    const page = pageOf(await read(runner, retry.state))

    expect(page.state.attempt).toBe(0)
    expect(page.state.pageIndex).toBe(2)
  })

  it('threads the abort signal into the runner and treats an aborted call as transient', async () => {
    const controller = new AbortController()
    const seen: (AbortSignal | undefined)[] = []
    const runner: TopicRunner = async (_args, signal) => {
      seen.push(signal)
      return { ok: false, detail: 'aborted' }
    }
    const result = await readTopicPage({
      runner, threadId: TOPIC_THREAD, chatId: TOPIC_CHAT, linkedMessageId: topicMessageId(1),
      state: initialTopicState, signal: controller.signal,
    })

    expect(seen[0]).toBe(controller.signal)
    expect(result.kind).toBe('retry')
  })
})
