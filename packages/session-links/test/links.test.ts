import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  classifyUrl,
  collectLinksFromNode,
  collectLinksFromNodes,
  compareEntries,
  extractUrls,
  linkTitle,
  stripUrlTail,
  type LinkEntry,
} from '../src/shared/links.js'
import type { AssistantBlock, ContentBlock, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

describe('extractUrls', () => {
  it('picks bare URLs out of prose', () => {
    expect(extractUrls('看这里 https://example.com/a?b=1 和这个')).toEqual(['https://example.com/a?b=1'])
  })

  it('handles markdown link destinations verbatim', () => {
    expect(extractUrls('[MR 链接](https://git.example.com/team/repo/-/merge_requests/42)')).toEqual([
      'https://git.example.com/team/repo/-/merge_requests/42',
    ])
  })

  it('strips trailing sentence punctuation', () => {
    expect(extractUrls('打开 https://example.com/x。')).toEqual(['https://example.com/x'])
    expect(extractUrls('见 https://example.com/x,谢谢')).toEqual(['https://example.com/x'])
    expect(extractUrls('见 https://example.com/x。')).toEqual(['https://example.com/x'])
  })

  it('keeps balanced parens inside URLs', () => {
    expect(extractUrls('wiki https://example.com/wiki_(foo) 后文')).toEqual(['https://example.com/wiki_(foo)'])
  })

  it('strips unbalanced closers (markdown) ', () => {
    expect(extractUrls('链接 https://example.com/x).')).toEqual(['https://example.com/x'])
  })

  it('dedupes the same URL across passes and repeats', () => {
    expect(extractUrls('https://example.com/x [a](https://example.com/x) https://example.com/x')).toEqual([
      'https://example.com/x',
    ])
  })

  it('returns nothing for url-less text', () => {
    expect(extractUrls('没有链接')).toEqual([])
  })
})

describe('stripUrlTail', () => {
  it('leaves a clean URL untouched', () => {
    expect(stripUrlTail('https://example.com/a/b')).toBe('https://example.com/a/b')
  })
  it('strips trailing Chinese full stop and quotes', () => {
    expect(stripUrlTail('https://example.com/x。”')).toBe('https://example.com/x')
  })
})

describe('classifyUrl', () => {
  it('classifies meego hosts', () => {
    expect(classifyUrl('https://meego.bytedance.net/space/1/story/123')).toBe('meego')
    expect(classifyUrl('https://x.meego.bytedance.net/y')).toBe('meego')
  })

  it('classifies MR links on review hosts', () => {
    expect(classifyUrl('https://git.bytedance.org/x/y/-/merge_requests/99')).toBe('mr')
    expect(classifyUrl('https://github.com/foo/bar/pull/12')).toBe('mr')
    expect(classifyUrl('https://gitlab.com/foo/bar/merge_requests/3')).toBe('mr')
    expect(classifyUrl('https://code.byted.org/data/dsh/-/merge_requests/42')).toBe('mr')
  })

  it('does not classify plain repo pages on review hosts as MR', () => {
    expect(classifyUrl('https://github.com/foo/bar/issues/1')).not.toBe('mr')
  })

  it('classifies deploy links', () => {
    expect(classifyUrl('https://deploy.example.com/app/42')).toBe('deploy')
    expect(classifyUrl('https://gitlab.com/foo/bar/-/pipelines/123')).toBe('deploy')
    expect(classifyUrl('https://ci.example.com/job/build/7')).toBe('deploy')
  })

  it('classifies artifact links', () => {
    expect(classifyUrl('https://artifactory.example.com/artifactory/libs/foo-1.0.jar')).toBe('artifact')
    expect(classifyUrl('https://nexus.example.com/repository/maven/foo')).toBe('artifact')
    expect(classifyUrl('https://registry.npmjs.org/some-pkg')).toBe('artifact')
    expect(classifyUrl('https://example.com/artifacts/12/download')).toBe('artifact')
  })

  it('falls back to other without dropping', () => {
    expect(classifyUrl('https://example.com/whatever')).toBe('other')
    expect(classifyUrl('not a url')).toBe('other')
  })

  it('keeps every category label and order entry', () => {
    expect(CATEGORY_ORDER).toEqual(['mr', 'deploy', 'meego', 'artifact', 'other'])
    for (const c of CATEGORY_ORDER) expect(CATEGORY_LABELS[c]).toBeTruthy()
  })
})

describe('linkTitle', () => {
  it('uses host plus truncated path', () => {
    expect(linkTitle('https://meego.bytedance.net/space/1/story/123')).toBe(
      'meego.bytedance.net/space/1/story/123',
    )
    expect(linkTitle('https://www.example.com')).toBe('example.com')
  })
  it('falls back to the raw string on invalid URLs', () => {
    expect(linkTitle('xxx')).toBe('xxx')
  })
})

function textNode(partial: Partial<Pick<ConversationNode, 'kind' | 'seq' | 'time'>> & { kind: 'user' }): ConversationNode {
  return {
    kind: 'user',
    seq: partial.seq ?? 1,
    time: partial.time ?? 1_000,
    content: [{ type: 'text', text: 'https://example.com/x' } satisfies ContentBlock],
    source: null,
  }
}

describe('collectLinksFromNode', () => {
  it('collects user message links with role/time/seq', () => {
    const entries = collectLinksFromNode(textNode({ kind: 'user', seq: 7, time: 100 }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ url: 'https://example.com/x', category: 'other', role: 'user', seq: 7, time: 100 })
  })

  it('collects assistant visible text blocks only, never reasoning or tool calls', () => {
    const blocks: AssistantBlock[] = [
      { kind: 'text', text: '部署好了 https://deploy.example.com/app/1' },
      { kind: 'reasoning', text: '思考 https://should-not-appear.example.com' },
      { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{"url":"https://no-tool.example.com/x"}' },
    ] as AssistantBlock[]
    const node: ConversationNode = { kind: 'assistant', seq: 8, time: 200, turn: 1, step: 1, blocks }
    const entries = collectLinksFromNode(node)
    expect(entries.map((e) => e.url)).toEqual(['https://deploy.example.com/app/1'])
    expect(entries[0]!.role).toBe('assistant')
  })

  it('skips tool-result, compaction and unknown nodes entirely', () => {
    const nodes: ConversationNode[] = [
      { kind: 'tool-result', seq: 9, time: 300, callId: 'c1', call: null, callTime: null, content: [], isError: false },
      { kind: 'compaction', seq: 10, time: 400, summary: 's', summaryEventSeq: null, shadowedItemCount: null, shadowedTokenCount: null },
    ] as ConversationNode[]
    expect(collectLinksFromNodes(nodes)).toEqual([])
  })
})

describe('collectLinksFromNodes', () => {
  it('aggregates across messages', () => {
    const nodes: ConversationNode[] = [
      textNode({ kind: 'user', seq: 1, time: 100 }),
      {
        kind: 'assistant',
        seq: 2,
        time: 200,
        turn: 1,
        step: 1,
        blocks: [{ kind: 'text', text: 'MR: https://gitlab.com/a/b/merge_requests/5' } satisfies AssistantBlock],
      } as ConversationNode,
    ]
    const entries = collectLinksFromNodes(nodes)
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((e) => e.category))).toEqual(new Set(['other', 'mr']))
  })
})

describe('compareEntries', () => {
  function entry(over: Partial<LinkEntry>): LinkEntry {
    return { url: 'u', category: 'other', time: 0, seq: 0, role: 'user', title: 't', count: 1, ...over }
  }

  it('orders newest last-seen first', () => {
    const a = entry({ seq: 1, time: 100 })
    const b = entry({ seq: 2, time: 200 })
    expect(compareEntries(a, b)).toBeGreaterThan(0)
  })

  it('breaks equal-time ties by role (assistant first), then seq', () => {
    const assistant = entry({ role: 'assistant', seq: 5 })
    const user = entry({ role: 'user', seq: 6 })
    expect(compareEntries(assistant, user)).toBeLessThan(0)
    const newerUser = entry({ role: 'user', seq: 7, time: 100 })
    const olderUser = entry({ role: 'user', seq: 3, time: 100 })
    expect(compareEntries(newerUser, olderUser)).toBeLessThan(0)
  })
})