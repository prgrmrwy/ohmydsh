/** Continuation snapshot table (change `locus-read-referenced-chats`, tasks 3.x; R16 b–c, R21 b). */

import { describe, expect, it } from 'vitest'
import {
  createCursorStore,
  LOCUS_CURSOR_RESERVED_CHARS,
  LOCUS_CURSOR_TTL_MS,
  type CursorSnapshot,
} from '../src/host/locus/media-cursor.js'

const caller = 'session-1@entrance-1'
const snapshot = (overrides: Partial<CursorSnapshot> = {}): CursorSnapshot => ({
  caller,
  containerId: 'om_root',
  kind: 'merge',
  units: [{ id: 'om_root#t@0' }, { id: 'om_root#r0' }],
  position: 1,
  attempt: 0,
  failedCount: 0,
  ...overrides,
})
const ask = { caller, messageId: 'om_root' }

describe('media cursor snapshot table', () => {
  it('unknown, expired and pre-restart cursors are cursor-invalid with zero platform calls', () => {
    let now = 1_000
    const store = createCursorStore({ now: () => now })
    expect(store.resolve('never-issued', ask)).toEqual({ kind: 'failed', reason: 'cursor-invalid' })

    const id = store.issue(snapshot())
    expect(store.resolve(id, ask).kind).toBe('ok')

    now += LOCUS_CURSOR_TTL_MS + 1
    expect(store.resolve(id, ask)).toEqual({ kind: 'failed', reason: 'cursor-invalid' })

    // A new store models a Host restart: every earlier id is unknown.
    const restarted = createCursorStore({ now: () => now })
    expect(restarted.resolve(id, ask)).toEqual({ kind: 'failed', reason: 'cursor-invalid' })
  })

  it('foreign session, foreign messageId and linkIndex mismatch are cursor-mismatch with zero platform calls', () => {
    const store = createCursorStore()
    const id = store.issue(snapshot({ linkIndex: 2 }))
    expect(store.resolve(id, { caller: 'session-2@entrance-1', messageId: 'om_root' }))
      .toEqual({ kind: 'failed', reason: 'cursor-mismatch' })
    expect(store.resolve(id, { caller: 'session-1@entrance-2', messageId: 'om_root' }))
      .toEqual({ kind: 'failed', reason: 'cursor-mismatch' })
    expect(store.resolve(id, { caller, messageId: 'om_other' }))
      .toEqual({ kind: 'failed', reason: 'cursor-mismatch' })
    expect(store.resolve(id, { ...ask, linkIndex: 3 }))
      .toEqual({ kind: 'failed', reason: 'cursor-mismatch' })
    // A matching or omitted linkIndex is accepted.
    expect(store.resolve(id, { ...ask, linkIndex: 2 }).kind).toBe('ok')
    expect(store.resolve(id, ask).kind).toBe('ok')
  })

  it('expires entries after 30 minutes and purges them when the next cursor is issued', () => {
    let now = 0
    const store = createCursorStore({ now: () => now })
    expect(LOCUS_CURSOR_TTL_MS).toBe(30 * 60 * 1000)
    store.issue(snapshot())
    store.issue(snapshot())
    expect(store.size()).toBe(2)
    now = LOCUS_CURSOR_TTL_MS - 1
    expect(store.resolve(store.issue(snapshot()), ask).kind).toBe('ok')
    expect(store.size()).toBe(3)
    now = LOCUS_CURSOR_TTL_MS + 1
    store.issue(snapshot())
    expect(store.size()).toBe(2) // the two first entries expired; the third and the new one remain
  })

  it('any issued cursor is shorter than the reserved length', () => {
    const store = createCursorStore()
    for (let index = 0; index < 200; index += 1) {
      const id = store.issue(snapshot())
      expect(id.length).toBeLessThan(LOCUS_CURSOR_RESERVED_CHARS)
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('issues distinct 128-bit ids and entries are immutable once issued', () => {
    const store = createCursorStore()
    const ids = new Set(Array.from({ length: 50 }, () => store.issue(snapshot())))
    expect(ids.size).toBe(50)
    const id = store.issue(snapshot())
    const resolved = store.resolve(id, ask)
    expect(resolved.kind).toBe('ok')
    if (resolved.kind === 'ok') {
      expect(() => { (resolved.snapshot as { position: number }).position = 9 }).toThrow()
      expect(() => { (resolved.snapshot.units as unknown[]).push({ id: 'x' }) }).toThrow()
    }
  })
})
