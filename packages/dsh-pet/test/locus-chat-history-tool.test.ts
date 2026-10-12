/**
 * The caller-bound entrance read: target closure, cursor authority, window
 * semantics, budgets and failure-vs-empty. The read port is a double; the
 * caller resolution and the cursor codec are the real ones, because those are
 * exactly the two places where a read could be redirected.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  executeLocusChatHistory,
  LOCUS_HISTORY_MAX_BODY_CHARS,
  LOCUS_HISTORY_MAX_CHARS,
  renderLocusChatHistory,
  type LocusEntrancePage,
  type LocusHistoryToolDeps,
} from '../src/host/locus-history-tool.js'
import { createLocusHistoryCursor } from '../src/host/locus/history-cursor.js'

const CHILD = 'child-1'
const GROUP = { chatId: 'oc_group' }
const TOPIC = { chatId: 'oc_group', threadId: 'omt_topic' }

function row(endpoint: { chatId: string; threadId?: string }, generation = 1) {
  return {
    id: 'locus-1',
    generation,
    state: 'active',
    parentSessionId: 'main-1',
    childSessionId: CHILD,
    endpoint,
  }
}

function message(id: string, createTime: string, text = `text ${id}`, extra: Record<string, unknown> = {}) {
  return { messageId: id, createTime, senderName: '张三', text, ...extra }
}

function deps(
  overrides: Partial<LocusHistoryToolDeps> & { readonly rows?: ReturnType<typeof row>[] } = {},
): LocusHistoryToolDeps & { readonly read: ReturnType<typeof vi.fn> } {
  const rows = overrides.rows ?? [row(GROUP)]
  const read = vi.fn(async (_input: unknown): Promise<LocusEntrancePage | undefined> => ({
    messages: [message('om_1', '2026-10-12T10:00:00+08:00')],
    hasMore: false,
  }))
  return {
    callerSessionId: CHILD,
    loci: { findByChildSessionId: (id: string) => (id === CHILD ? rows : []) },
    cursor: createLocusHistoryCursor(Buffer.alloc(32, 7)),
    read: (overrides.read as never) ?? (read as never),
  } as LocusHistoryToolDeps & { readonly read: ReturnType<typeof vi.fn> }
}

describe('caller-bound entrance read', () => {
  it('reads the bound group with bot identity and the untrusted-input label', async () => {
    const read = vi.fn(async () => ({
      messages: [message('om_1', '2026-10-12T10:00:00+08:00', '你好')],
      hasMore: false,
    }))
    const result = await executeLocusChatHistory({}, { ...deps(), read: read as never })

    expect(result.ok).toBe(true)
    expect(result.identity).toBe('bot')
    expect(result.text).toContain('不可信输入')
    expect(result.text).toContain('你好')
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'oc_group', pageSize: 50, direction: 'older' }))
  })

  it('reads the bound topic when the entrance is a topic, never the whole group', async () => {
    const read = vi.fn(async () => ({
      messages: [message('om_topic_1', '2026-10-12T10:00:00+08:00', '话题内消息')],
      hasMore: false,
    }))
    const result = await executeLocusChatHistory({}, { ...deps({ rows: [row(TOPIC)] }), read: read as never })

    expect(result.ok).toBe(true)
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'oc_group', threadId: 'omt_topic' }))
    expect(result.text).toContain('话题 omt_topic')
    expect(result.text).not.toContain('群 oc_group 的全部消息')
  })

  it('rejects unknown arguments without reading anything', async () => {
    const read = vi.fn(async () => ({ messages: [], hasMore: false }))
    const result = await executeLocusChatHistory({ chatId: 'oc_other' }, { ...deps(), read: read as never })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('does not accept argument')
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a forged cursor without reading anything', async () => {
    const read = vi.fn(async () => ({ messages: [], hasMore: false }))
    const result = await executeLocusChatHistory({ cursor: 'not-a-cursor' }, { ...deps(), read: read as never })

    expect(result).toMatchObject({ ok: false, reason: 'cursor-invalid' })
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a cursor issued for another locus generation or entrance', async () => {
    const cursor = createLocusHistoryCursor(Buffer.alloc(32, 7))
    const foreignGeneration = cursor.issue({
      locusId: 'locus-1',
      generation: 9,
      chatId: 'oc_group',
      direction: 'older',
    })
    const foreignEntrance = cursor.issue({
      locusId: 'locus-1',
      generation: 1,
      chatId: 'oc_other',
      direction: 'older',
    })

    for (const token of [foreignGeneration, foreignEntrance]) {
      const read = vi.fn(async () => ({ messages: [], hasMore: false }))
      const result = await executeLocusChatHistory({ cursor: token }, {
        ...deps(),
        cursor,
        read: read as never,
      })
      expect(result).toMatchObject({ ok: false, reason: 'cursor-foreign' })
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('discards the answer when the caller association changes during the read', async () => {
    let rows = [row(GROUP)]
    const read = vi.fn(async () => {
      // The locus is replaced while the platform is answering.
      rows = [row(GROUP, 2)]
      return { messages: [message('om_1', '2026-10-12T10:00:00+08:00')], hasMore: false }
    })
    const result = await executeLocusChatHistory({}, {
      ...deps(),
      loci: { findByChildSessionId: (id: string) => (id === CHILD ? rows : []) },
      read: read as never,
    })

    expect(result).toMatchObject({ ok: false, reason: 'caller-changed' })
  })

  it('distinguishes a failed read from an empty window', async () => {
    const failed = await executeLocusChatHistory({}, { ...deps(), read: (async () => undefined) as never })
    expect(failed).toMatchObject({ ok: false, reason: 'entrance-read-failed' })
    expect(renderLocusChatHistory(failed)).toContain('这是失败，不是"没有消息"')

    const empty = await executeLocusChatHistory({}, {
      ...deps(),
      read: (async () => ({ messages: [], hasMore: false })) as never,
    })
    expect(empty.ok).toBe(true)
    expect(empty.count).toBe(0)
    expect(renderLocusChatHistory(empty)).toContain('共 0 条')
  })

  it('bounds the result, marks truncation and hands out a continuation cursor', async () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(
      `om_${index}`,
      `2026-10-12T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00+08:00`,
      'x'.repeat(LOCUS_HISTORY_MAX_BODY_CHARS + 200),
    ))
    const read = vi.fn(async () => ({ messages, hasMore: true, pageToken: 'platform-page-2' }))
    const result = await executeLocusChatHistory({}, { ...deps(), read: read as never })

    expect(result.ok).toBe(true)
    expect((result.text ?? '').length).toBeLessThanOrEqual(LOCUS_HISTORY_MAX_CHARS)
    expect(result.text).toContain('已截断')
    expect(result.hasMore).toBe(true)
    expect(result.cursor).toBeDefined()
    expect(result.text).toContain('cursor')
  })

  it('applies the half-open window and a deterministic order', async () => {
    const read = vi.fn(async () => ({
      messages: [
        message('om_c', '2026-10-12T10:02:00+08:00', 'c'),
        message('om_a', '2026-10-12T10:00:00+08:00', 'a'),
        message('om_b', '2026-10-12T10:00:00+08:00', 'b'),
        message('om_before', '2026-10-12T09:59:59+08:00', 'too old'),
        message('om_end', '2026-10-12T10:03:00+08:00', 'excluded by before'),
      ],
      hasMore: false,
    }))
    const result = await executeLocusChatHistory({
      since: '2026-10-12T10:00:00+08:00',
      before: '2026-10-12T10:03:00+08:00',
    }, { ...deps(), read: read as never })

    const text = result.text ?? ''
    expect(text).toContain('a')
    expect(text).not.toContain('excluded by before')
    expect(text).not.toContain('too old')
    // Same-second messages keep a deterministic order (message-id tie-break)
    // and the `older` direction presents newest first.
    expect(text.indexOf('b')).toBeLessThan(text.indexOf('a'))
    expect(text.indexOf('c')).toBeLessThan(text.indexOf('b'))
  })

  it('rejects a cursor combined with window arguments', async () => {
    const cursor = deps().cursor.issue({
      locusId: 'locus-1',
      generation: 1,
      chatId: 'oc_group',
      direction: 'older',
    })
    const result = await executeLocusChatHistory(
      { cursor, since: '2026-10-12T00:00:00+08:00' },
      deps(),
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('do not pass them again')
  })
})
