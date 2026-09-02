import { describe, expect, it } from 'vitest'
import { SessionLinksStore, type SnapshotSource } from '../src/client/collector.js'
import type { ConversationSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

/** A minimal mutable snapshot source standing in for a session's ObservableSnapshot. */
class FakeSource implements SnapshotSource {
  private snapshot: ConversationSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(nodes: ConversationNode[]) {
    this.snapshot = { sessionId: 's1', nodes } as ConversationSnapshot
  }

  getSnapshot(): ConversationSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Update the snapshot and notify subscribers (one listener per FakeSource). */
  push(nodes: ConversationNode[]): void {
    this.snapshot = { sessionId: 's1', nodes } as ConversationSnapshot
    for (const l of [...this.listeners]) l()
  }
}

function userNode(seq: number, text: string): ConversationNode {
  return {
    kind: 'user',
    seq,
    time: seq * 1_000,
    content: [{ type: 'text', text }],
    source: null,
  } as ConversationNode
}

describe('SessionLinksStore', () => {
  it('collects the full snapshot on first observe', () => {
    const source = new FakeSource([
      userNode(1, 'MR https://gitlab.com/a/b/merge_requests/3 部署 https://deploy.example.com/app/1'),
    ])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    const entries = store.entriesOf('s1')
    expect(entries.map((e) => e.category)).toEqual(expect.arrayContaining(['mr', 'deploy']))
    expect(store.countOf('s1')).toBe(2)
    store.dispose()
  })

  it('increments on new messages without rescanning history', () => {
    const source = new FakeSource([userNode(1, 'https://example.com/one')])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    expect(store.countOf('s1')).toBe(1)

    const existing = store.entriesOf('s1')
    // Update: same first node object identity (history unchanged) + one new node.
    source.push([userNode(1, 'https://example.com/one'), userNode(2, 'https://example.com/two')])
    expect(store.countOf('s1')).toBe(2)
    expect(store.entriesOf('s1').map((e) => e.url)).toEqual(
      expect.arrayContaining(['https://example.com/one', 'https://example.com/two']),
    )
    expect(existing).not.toBe(store.entriesOf('s1'))
    store.dispose()
  })

  it('dedupes repeated URLs keeping the latest occurrence and counting', () => {
    const source = new FakeSource([userNode(1, 'https://example.com/x')])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    source.push([userNode(1, 'https://example.com/x'), userNode(2, '又提一次 https://example.com/x')])
    const entries = store.entriesOf('s1')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.count).toBe(2)
    expect(entries[0]!.seq).toBe(2)
    store.dispose()
  })

  it('ignores older messages appended to the head (loadOlder) without losing collected state', () => {
    const source = new FakeSource([userNode(5, 'https://example.com/current')])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    source.push([userNode(0, 'https://example.com/old'), userNode(1, 'https://example.com/older'), userNode(5, 'https://example.com/current')])
    expect(store.entriesOf('s1').map((e) => e.url)).toEqual(['https://example.com/current'])
    store.dispose()
  })

  it('re-observing the same session id is idempotent (no rebuild loops)', () => {
    const store = new SessionLinksStore()
    store.observe('s1', new FakeSource([userNode(1, 'https://example.com/a')]))
    const first = store.entriesOf('s1')
    // Effect re-runs must never rebuild the state: identity preserved,
    // no double ingest, the first source stays authoritative.
    store.observe('s1', new FakeSource([userNode(1, 'https://example.com/b')]))
    expect(store.entriesOf('s1')).toBe(first)
    expect(store.countOf('s1')).toBe(1)
    expect(store.entriesOf('s1').map((e) => e.url)).toEqual(['https://example.com/a'])
    store.dispose()
  })

  it('upgrades a source-less state when a real source arrives later', () => {
    const store = new SessionLinksStore()
    store.observe('s1', undefined)
    expect(store.countOf('s1')).toBe(0)
    store.observe('s1', new FakeSource([userNode(1, 'https://example.com/x')]))
    expect(store.countOf('s1')).toBe(1)
    expect(store.entriesOf('s1').map((e) => e.url)).toEqual(['https://example.com/x'])
    store.dispose()
  })

  it('release then observe rebuilds (session switching)', () => {
    const store = new SessionLinksStore()
    store.observe('s1', new FakeSource([userNode(1, 'https://example.com/a')]))
    expect(store.countOf('s1')).toBe(1)
    store.release('s1')
    expect(store.countOf('s1')).toBe(0)
    store.observe('s1', new FakeSource([userNode(1, 'https://example.com/b')]))
    expect(store.entriesOf('s1').map((e) => e.url)).toEqual(['https://example.com/b'])
    store.dispose()
  })

  it('release drops the session state and its subscription', () => {
    const source = new FakeSource([userNode(1, 'https://example.com/a')])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    expect(store.countOf('s1')).toBe(1)
    store.release('s1')
    expect(store.countOf('s1')).toBe(0)
    expect(store.entriesOf('s1')).toEqual([])
    // No throw when pushing after release (listener already removed).
    source.push([userNode(2, 'https://example.com/b')])
    store.dispose()
  })

  it('observe without a source yields an empty state (safe degradation)', () => {
    const store = new SessionLinksStore()
    store.observe('s1', undefined)
    expect(store.countOf('s1')).toBe(0)
    expect(store.entriesOf('s1')).toEqual([])
    store.dispose()
  })

  it('keeps snapshot identity stable for useSyncExternalStore (no React #185 loops)', () => {
    const store = new SessionLinksStore()
    const before = store.entriesOf('s1')
    expect(store.entriesOf('s1')).toBe(before) // no state -> shared EMPTY_ENTRIES
    expect(store.entriesOf('s2')).toBe(before)

    const source = new FakeSource([userNode(1, 'https://example.com/a')])
    store.observe('s1', source)
    const first = store.entriesOf('s1')
    expect(first).toHaveLength(1)
    expect(store.entriesOf('s1')).toBe(first) // cached sorted projection
    store.dispose()
  })

  it('applies the host baseline (watermark jump, dedupe merge, idempotent)', () => {
    const source = new FakeSource([userNode(30, 'https://example.com/new-after-baseline')])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    store.applyBaseline('s1', [
      { url: 'https://example.com/old', category: 'other', time: 1, seq: 1, role: 'user', title: 't', count: 2 },
    ], [{ path: 'a/old.ts', time: 1, seq: 1 }], 10)
    expect(store.countOf('s1')).toBe(2)
    expect(store.producedOf('s1').map((f) => f.path)).toEqual(['a/old.ts'])
    // Baseline idempotent: a second application (e.g. effect re-run) must not duplicate.
    store.applyBaseline('s1', [
      { url: 'https://example.com/old', category: 'other', time: 1, seq: 1, role: 'user', title: 't', count: 2 },
    ], [{ path: 'a/old.ts', time: 1, seq: 1 }], 10)
    expect(store.countOf('s1')).toBe(2)
    expect(store.producedOf('s1').map((f) => f.path)).toEqual(['a/old.ts'])
    // The snapshot increment continues from the baseline watermark (seq > 10).
    source.push([userNode(30, 'https://example.com/new-after-baseline'), userNode(11, 'https://example.com/below-watermark')])
    expect(store.entriesOf('s1').map((e) => e.url)).toEqual(
      expect.arrayContaining(['https://example.com/old', 'https://example.com/new-after-baseline']),
    )
    expect(store.entriesOf('s1').map((e) => e.url)).not.toContain('https://example.com/below-watermark')
    store.dispose()
  })

  it('baseline arriving after release is a no-op (no state leak)', () => {
    const store = new SessionLinksStore()
    store.observe('s1', new FakeSource([]))
    store.release('s1')
    expect(() => store.applyBaseline('s1', [], [], 0)).not.toThrow()
    expect(store.countOf('s1')).toBe(0)
    store.dispose()
  })

  it('collects produced files from tool-result nodes (first-seen per path)', () => {
    const source = new FakeSource([
      {
        kind: 'tool-result',
        seq: 20,
        time: 20_000,
        callId: 'c1',
        call: { name: 'write', argsRaw: '{}' },
        callTime: 19_900,
        content: [],
        isError: false,
        callView: { card: 'diff', title: 'Write', diffs: [], locations: [{ path: 'a/foo.ts' }] },
        resultView: null,
        subCalls: [],
      } as unknown as ConversationNode,
      {
        kind: 'tool-result',
        seq: 21,
        time: 21_000,
        callId: 'c2',
        call: { name: 'edit', argsRaw: '{}' },
        callTime: 20_900,
        content: [],
        isError: false,
        callView: { card: 'generic', title: 'Edit', kind: 'edit', locations: [{ path: 'a/foo.ts' }] },
        resultView: null,
        subCalls: [],
      } as unknown as ConversationNode,
      {
        kind: 'tool-result',
        seq: 22,
        time: 22_000,
        callId: 'c3',
        call: { name: 'read', argsRaw: '{}' },
        callTime: 21_900,
        content: [],
        isError: false,
        callView: { card: 'generic', title: 'Read', kind: 'read', locations: [{ path: 'b/read.ts' }] },
        resultView: null,
        subCalls: [],
      } as unknown as ConversationNode,
    ])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    const produced = store.producedOf('s1')
    expect(produced).toHaveLength(1)
    expect(produced[0]).toMatchObject({ path: 'a/foo.ts', time: 20_000 }) // first-seen kept
    // stable identity
    expect(store.producedOf('s1')).toBe(produced)
    store.dispose()
  })

  it('notifies subscribers through the debounced emit', async () => {
    const source = new FakeSource([])
    const store = new SessionLinksStore()
    store.observe('s1', source)
    let notified = 0
    const unsub = store.subscribe(() => {
      notified++
    })
    source.push([userNode(1, 'https://example.com/x')])
    expect(notified).toBe(0) // debounced
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(notified).toBe(1)
    unsub()
    source.push([userNode(2, 'https://example.com/y')])
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(notified).toBe(1)
    store.dispose()
  })
})