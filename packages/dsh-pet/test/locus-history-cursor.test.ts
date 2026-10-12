/**
 * Host-issued continuation cursors must be unforgeable, opaque and bound to
 * the exact read they continue. Anything else reopens the target-selection
 * interface the caller-bound read tool exists to remove.
 */

import { describe, expect, it } from 'vitest'
import { createLocusHistoryCursor } from '../src/host/locus/history-cursor.js'
import type { LocusHistoryCursorPayload } from '../src/host/locus/history-cursor.js'

const payload: LocusHistoryCursorPayload = {
  locusId: 'locus-1',
  generation: 3,
  chatId: 'oc_group',
  direction: 'older',
  since: '2026-10-01T00:00:00+08:00',
  before: '2026-10-02T00:00:00+08:00',
  page: 'PLATFORM_PAGE_TOKEN',
}

describe('locus history cursor', () => {
  it('round-trips a bound payload', () => {
    const cursors = createLocusHistoryCursor()
    const token = cursors.issue(payload)

    expect(cursors.read(token)).toEqual(payload)
  })

  it('never exposes the platform page token as the cursor itself', () => {
    const cursors = createLocusHistoryCursor()
    const token = cursors.issue(payload)

    expect(token).not.toBe(payload.page)
    expect(token).not.toContain(payload.page as string)
  })

  it('rejects a mutated body', () => {
    const cursors = createLocusHistoryCursor()
    const token = cursors.issue(payload)
    const [body, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(body as string, 'base64url').toString('utf8')) as Record<string, unknown>
    const forged = Buffer.from(JSON.stringify({ ...decoded, chatId: 'oc_other' }), 'utf8').toString('base64url')

    expect(cursors.read(`${forged}.${signature}`)).toBeUndefined()
  })

  it('rejects a cursor signed by a different Host process', () => {
    const issued = createLocusHistoryCursor(Buffer.alloc(32, 1)).issue(payload)

    expect(createLocusHistoryCursor(Buffer.alloc(32, 2)).read(issued)).toBeUndefined()
  })

  it('rejects malformed, empty and oversized cursors', () => {
    const cursors = createLocusHistoryCursor()

    for (const token of ['', 'no-separator', '.', 'body.', '.signature', 'a'.repeat(4097)]) {
      expect(cursors.read(token)).toBeUndefined()
    }
  })

  it('refuses to issue a payload that is missing its binding facts', () => {
    const cursors = createLocusHistoryCursor()

    expect(() => cursors.issue({ ...payload, generation: undefined as never }))
      .toThrow('cursor payload is invalid')
  })

  it('refuses to issue a payload without a direction', () => {
    const cursors = createLocusHistoryCursor()

    expect(() => cursors.issue({ ...payload, direction: 'sideways' as never })).toThrow('cursor payload is invalid')
  })

  it('keeps a topic binding inside the cursor', () => {
    const cursors = createLocusHistoryCursor()
    const token = cursors.issue({ ...payload, threadId: 'omt_topic', page: undefined })

    expect(cursors.read(token)?.threadId).toBe('omt_topic')
  })
})
