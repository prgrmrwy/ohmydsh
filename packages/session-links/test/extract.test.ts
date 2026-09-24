import { describe, expect, it } from 'vitest'
import { extractSession } from '../src/host/extract.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function userMessage(seq: number, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: seq * 1_000,
    data: { content: [{ type: 'text', text }], source: { kind: 'human' } },
  } as unknown as SessionEvent
}

function assistantMessage(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: seq * 1_000,
    data: {
      turn: 1,
      step: 1,
      message: {
        content: [
          { type: 'text', text },
          { type: 'reasoning', text: 'https://reasoning.example.com/x' },
          { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"url":"https://tool.example.com/x"}' },
        ],
      },
    },
  } as unknown as SessionEvent
}

function toolCall(seq: number, callId: string, name: string, argsRaw: string): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: seq * 1_000,
    data: { turn: 1, step: 1, callId, name, arguments: argsRaw },
  } as unknown as SessionEvent
}

function toolResult(seq: number, callId: string, isError = false): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: seq * 1_000,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `m${seq}`,
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: callId, content: [], isError }],
        source: { kind: 'tool', callId },
      },
    },
  } as unknown as SessionEvent
}

const noView = (): undefined => undefined

describe('extractSession (links)', () => {
  it('collects user and assistant visible text with seq/time/role', () => {
    const { entries, maxSeq } = extractSession(
      [userMessage(1, 'MR https://gitlab.com/a/b/merge_requests/3'), assistantMessage(2, '部署完成 https://deploy.example.com/app/1')],
      noView,
    )
    expect(maxSeq).toBe(2)
    expect(entries).toHaveLength(2)
    const byUrl = new Map(entries.map((e) => [e.url, e]))
    expect(byUrl.get('https://gitlab.com/a/b/merge_requests/3')).toMatchObject({ category: 'mr', role: 'user', seq: 1 })
    expect(byUrl.get('https://deploy.example.com/app/1')).toMatchObject({ category: 'deploy', role: 'assistant', seq: 2 })
  })

  it('excludes reasoning and tool-call payloads', () => {
    const { entries } = extractSession([assistantMessage(1, '正常文本 https://good.example.com')], noView)
    expect(entries.map((e) => e.url)).toEqual(['https://good.example.com'])
  })

  it('dedupes repeated URLs keeping the latest occurrence and count', () => {
    const { entries } = extractSession([userMessage(1, 'https://example.com/x'), assistantMessage(2, '又提 https://example.com/x')], noView)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ count: 2, seq: 2, role: 'assistant' })
  })

  it('skips non-message events and unknown events safely', () => {
    const { entries, maxSeq } = extractSession(
      [
        { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as unknown as SessionEvent,
        { type: 'tool/result', seq: 2, time: 2, data: {} } as unknown as SessionEvent,
        userMessage(3, 'https://example.com/kept'),
      ],
      noView,
    )
    expect(maxSeq).toBe(3)
    expect(entries.map((e) => e.url)).toEqual(['https://example.com/kept'])
  })
})

describe('extractSession (produced)', () => {
  const diffView = (paths: string[]) => ({
    card: 'diff' as const,
    title: 'Write',
    diffs: paths.map((p) => ({ path: p, oldText: null, newText: 'x' })),
    locations: paths.map((p) => ({ path: p })),
  })

  it('collects diff and generic-edit mutations, first-seen per path', () => {
    const { produced } = extractSession(
      [
        toolCall(1, 'c1', 'write', '{"path":"src/a.ts"}'),
        toolResult(2, 'c1'),
        toolCall(3, 'c2', 'edit', '{"file_path":"src/a.ts"}'),
        toolResult(4, 'c2'),
        toolCall(5, 'c3', 'read', '{"path":"src/b.ts"}'),
      ],
      (name) => {
        if (name === 'write' || name === 'edit') return diffView(['src/a.ts'])
        if (name === 'read') return { card: 'generic', title: 'Read', kind: 'read', locations: [{ path: 'src/b.ts' }] }
        return undefined
      },
    )
    expect(produced).toEqual([{ path: 'src/a.ts', time: 1_000, seq: 1 }])
  })

  it('withdraws mutations whose result failed', () => {
    const { produced } = extractSession(
      [
        toolCall(1, 'c1', 'write', '{"path":"src/fail.ts"}'),
        toolResult(2, 'c1', true),
        toolCall(3, 'c2', 'write', '{"path":"src/ok.ts"}'),
        toolResult(4, 'c2'),
      ],
      (name, argsRaw) => {
        if (name !== 'write') return undefined
        const { path } = JSON.parse(argsRaw) as { path: string }
        return diffView([path])
      },
    )
    expect(produced.map((f) => f.path)).toEqual(['src/ok.ts'])
  })

  it('soft-falls when the presenter throws or the tool is unknown', () => {
    const { produced } = extractSession(
      [toolCall(1, 'c1', 'write', 'not-json'), toolCall(2, 'c2', 'ghost', '{}')],
      (name) => {
        if (name === 'write') throw new Error('boom')
        return undefined
      },
    )
    expect(produced).toEqual([])
  })
})