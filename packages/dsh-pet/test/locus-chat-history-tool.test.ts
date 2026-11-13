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

/** A v20 resolved row, as `findBySessionId` returns it (the topic's M comes from its group). */
function row(endpoint: { chatId: string; threadId?: string }, locusId = 'locus-1') {
  return {
    row: { locusId, sessionId: CHILD, state: 'active', endpoint },
    locusMainSessionId: 'main-1',
    workspaceId: 'ws-1',
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
    loci: {
      findBySessionId: (id: string) => {
        const matches = id === CHILD ? rows : []
        if (matches.length > 1) throw new Error('ambiguous')
        return matches[0] as never
      },
    },
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

  it('rejects a cursor issued for another session or entrance', async () => {
    const cursor = createLocusHistoryCursor(Buffer.alloc(32, 7))
    const foreignSession = cursor.issue({
      locusId: 'locus-1',
      sessionId: 'session-9',
      chatId: 'oc_group',
      direction: 'older',
    })
    const foreignEntrance = cursor.issue({
      locusId: 'locus-1',
      sessionId: 'child-1',
      chatId: 'oc_other',
      direction: 'older',
    })

    for (const token of [foreignSession, foreignEntrance]) {
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
      rows = [row(GROUP, 'locus-2')]
      return { messages: [message('om_1', '2026-10-12T10:00:00+08:00')], hasMore: false }
    })
    const result = await executeLocusChatHistory({}, {
      ...deps(),
      loci: {
      findBySessionId: (id: string) => {
        const matches = id === CHILD ? rows : []
        if (matches.length > 1) throw new Error('ambiguous')
        return matches[0] as never
      },
    },
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
      sessionId: 'child-1',
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

describe('message ids on media lines', () => {
  const MEDIA_TEXTS = [
    '![Image](img_v3_x) 截图',
    '[Media: file_v3_x]',
    '[Image: img_v3_x]',
    '[Video: file_v3_x]',
    '[Audio: file_v3_x]',
    '<file key="file_v3_x" name="a.pdf"/>',
  ]

  async function lines(texts: readonly string[], overrides: Partial<LocusHistoryToolDeps> = {}) {
    const result = await executeLocusChatHistory({}, {
      ...deps(overrides),
      read: (async () => ({
        messages: texts.map((text, index) => message(`om_${String(index)}`, `2026-10-12T10:0${String(index % 10)}:00+08:00`, text)),
        hasMore: false,
      })) as never,
    })
    expect(result.ok).toBe(true)
    return { result, rows: (result.text ?? '').split('\n').filter(line => line.startsWith('- [')) }
  }

  it('appends message id to media lines within budget', async () => {
    // Every media marker form gets its own message id at the END of its line…
    const { rows } = await lines([...MEDIA_TEXTS, '没有媒体的普通消息'])
    const byId = (id: string) => rows.find(row => row.includes(`om_${id}`) || row.endsWith(`(id om_${id})`))
    for (const [index] of MEDIA_TEXTS.entries()) {
      const row = rows.find(line => line.endsWith(`(id om_${String(index)})`))
      expect(row, MEDIA_TEXTS[index]).toBeDefined()
    }
    // …and a plain line carries none.
    const plain = rows.find(row => row.includes('没有媒体的普通消息'))!
    expect(plain).not.toContain('(id ')
    expect(byId('99')).toBeUndefined()

    // The id survives body truncation (it is appended after the clamp) and follows a topic suffix.
    const long = await lines([`[Media: file_v3_x] ${'长'.repeat(LOCUS_HISTORY_MAX_BODY_CHARS * 2)}`])
    expect(long.rows[0]).toContain('…（已截断）')
    expect(long.rows[0]!.endsWith('(id om_0)')).toBe(true)
    const topic = await executeLocusChatHistory({}, {
      ...deps(),
      read: (async () => ({
        messages: [message('om_t', '2026-10-12T10:00:00+08:00', '[Media: file_v3_x]', { threadId: 'omt_a' })],
        hasMore: false,
      })) as never,
    })
    expect(topic.text).toMatch(/（话题 omt_a）\s*\(id om_t\)/)

    // Budget: ids count toward the character budget, so the same messages show fewer media lines than plain ones.
    const bodyOf = (marker: string) => `${marker} ${'字'.repeat(500)}`
    const many = 40
    const media = await lines(Array.from({ length: many }, () => bodyOf('[Media: file_v3_x]')))
    const plainRows = await lines(Array.from({ length: many }, () => bodyOf('普通文字')))
    expect(media.rows.join('\n').length).toBeLessThanOrEqual(LOCUS_HISTORY_MAX_CHARS)
    expect(plainRows.rows.join('\n').length).toBeLessThanOrEqual(LOCUS_HISTORY_MAX_CHARS)
    expect(media.result.count).toBe(media.rows.length)
    expect(media.rows.length).toBeLessThan(plainRows.rows.length)
    expect(media.result.hasMore).toBe(true)
    expect(media.rows.every(row => /\(id om_\d+\)$/.test(row))).toBe(true)
  })

  it('appends message id to message-link and merge-forward lines', async () => {
    // spec Scenario "消息链接与合并转发行带 id".
    const link = 'https://applink.larkoffice.com/client/message/link/open?token=AAAAAAAAAAAAAAAAAAAAAA%3D'
    const result = await executeLocusChatHistory({}, {
      ...deps(),
      read: (async () => ({
        messages: [
          message('om_link', '2026-10-12T10:00:00+08:00', `看下${link}`),
          message('om_merge', '2026-10-12T10:01:00+08:00', '[Merged forward]', { msgType: 'merge_forward' }),
          message('om_merge2', '2026-10-12T10:02:00+08:00', '聊天记录', { msgType: 'merge_forward' }),
          message('om_fake', '2026-10-12T10:03:00+08:00', 'https://evil.example/client/message/link/open?token=x'),
        ],
        hasMore: false,
      })) as never,
    })
    const rows = (result.text ?? '').split('\n').filter(line => line.startsWith('- ['))
    expect(rows.find(row => row.includes('看下'))!.endsWith('(id om_link)')).toBe(true)
    expect(rows.find(row => row.includes('[Merged forward]'))!.endsWith('(id om_merge)')).toBe(true)
    expect(rows.find(row => row.includes('聊天记录'))!.endsWith('(id om_merge2)')).toBe(true)
    // A look-alike host is not a message link.
    expect(rows.find(row => row.includes('evil.example'))).not.toContain('(id ')
  })

  it('plain text line without link gets no id', async () => {
    // spec Scenario "普通文字行不附 id".
    const { rows } = await lines(['只有文字', '参考 https://example.com/page'])
    expect(rows.every(row => !row.includes('(id '))).toBe(true)
  })
})

