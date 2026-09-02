import { describe, expect, it } from 'vitest'
import { producedFromNode } from '../src/client/produces.js'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'

function toolResult(over: Partial<ToolResultNode>): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 10,
    time: 10_000,
    callId: 'c1',
    call: { name: 'write', argsRaw: '{}' },
    callTime: 9_900,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  } as ToolResultNode
}

describe('producedFromNode', () => {
  it('collects diff-card locations as produced files', () => {
    const node = toolResult({
      callView: {
        card: 'diff',
        title: 'Write foo.ts',
        diffs: [{ path: 'a/foo.ts', oldText: null, newText: 'x' }],
        locations: [{ path: 'a/foo.ts' }],
      },
    })
    expect(producedFromNode(node)).toEqual([{ path: 'a/foo.ts', time: 10_000, seq: 10 }])
  })

  it('collects generic edit-card locations', () => {
    const node = toolResult({
      callView: { card: 'generic', title: 'Edit', kind: 'edit', locations: [{ path: 'b/bar.ts', line: 3 }] },
    })
    expect(producedFromNode(node)).toEqual([{ path: 'b/bar.ts', time: 10_000, seq: 10 }])
  })

  it('excludes read/delete/search/execute and unknown kinds', () => {
    for (const kind of ['read', 'delete', 'search', 'execute', 'fetch', 'other'] as const) {
      const node = toolResult({
        callView: { card: 'generic', title: 'T', kind, locations: [{ path: 'x' }] },
      })
      expect(producedFromNode(node)).toEqual([])
    }
  })

  it('excludes failed calls and null views', () => {
    expect(producedFromNode(toolResult({ isError: true, callView: { card: 'diff', title: 'W', diffs: [], locations: [{ path: 'x' }] } }))).toEqual([])
    expect(producedFromNode(toolResult({ call: null }))).toEqual([])
    expect(producedFromNode(toolResult({ callView: null }))).toEqual([])
  })
})