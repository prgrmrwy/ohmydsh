import { describe, expect, it } from 'vitest'
import { producedFromNode } from '../src/client/produces.js'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

// 0.1.2 note: transcript nodes no longer carry a host-computed `callView`;
// producedFromNode reads the call head (name + argsRaw) with the official
// deliverables mutation vocabulary. The scenarios below keep the original
// expectations: successful mutations produce, reads/deletes/failures do not.
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
    subCalls: [],
    ...over,
  } as ToolResultNode
}

describe('producedFromNode', () => {
  it('collects a successful write call as a produced file', () => {
    const node = toolResult({
      call: { name: 'write', argsRaw: JSON.stringify({ file_path: 'a/foo.ts', content: 'x' }) },
    })
    expect(producedFromNode(node)).toEqual([{ path: 'a/foo.ts', time: 10_000, seq: 10 }])
  })

  it('collects a successful edit call as a produced file', () => {
    const node = toolResult({
      call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'b/bar.ts', old_string: 'a', new_string: 'b' }) },
    })
    expect(producedFromNode(node)).toEqual([{ path: 'b/bar.ts', time: 10_000, seq: 10 }])
  })

  it('collects mutating str_replace_editor commands', () => {
    const create = toolResult({
      call: { name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'create', path: 'c/new.ts', file_text: 'x' }) },
    })
    expect(producedFromNode(create)).toEqual([{ path: 'c/new.ts', time: 10_000, seq: 10 }])
    const view = toolResult({
      call: { name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'view', path: 'c/new.ts' }) },
    })
    expect(producedFromNode(view)).toEqual([])
  })

  it('excludes reads, deletes, searches, executes and unknown tools', () => {
    for (const [name, args] of [
      ['read', { file_path: 'x' }],
      ['bash', { command: 'rm x' }],
      ['grep', { pattern: 'x' }],
      ['glob', { pattern: '*' }],
      ['fetch', { url: 'https://x' }],
    ] as const) {
      const node = toolResult({ call: { name, argsRaw: JSON.stringify(args) } })
      expect(producedFromNode(node)).toEqual([])
    }
  })

  it('excludes failed calls, null call heads, and malformed args', () => {
    expect(producedFromNode(toolResult({
      isError: true,
      call: { name: 'write', argsRaw: JSON.stringify({ file_path: 'x', content: 'y' }) },
    }))).toEqual([])
    expect(producedFromNode(toolResult({ call: null }))).toEqual([])
    expect(producedFromNode(toolResult({ call: { name: 'write', argsRaw: '{not json' } }))).toEqual([])
    // An edit whose old and new strings are identical mutates nothing.
    expect(producedFromNode(toolResult({
      call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'x', old_string: 'a', new_string: 'a' }) },
    }))).toEqual([])
  })
})
