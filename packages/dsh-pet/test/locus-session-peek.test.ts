/**
 * The management peek reads a session title from DSH's projection cache. A value
 * it cannot parse must NOT be reported as "title known, untitled" (that rendered
 * non-archived locus mains as 未命名); it must fall back to a full inspect.
 */
import { describe, expect, it } from 'vitest'
import { peekTitleFromProjection } from '../src/host/locus/session-peek.js'

const snapshot = { title: '[locus] 协作工作会话 · Aily 研发助手', messageSeqs: [], source: { kind: 'user' }, eventSeq: 7, updatedAt: 1 }

describe('peekTitleFromProjection', () => {
  it('a plain string is the title', () => {
    expect(peekTitleFromProjection({ title: '研发主会话' })).toEqual({ titleKnown: true, title: '研发主会话' })
  })

  it('the real title snapshot object (title + envelope facts) yields its title', () => {
    expect(peekTitleFromProjection({ title: snapshot })).toEqual({ titleKnown: true, title: snapshot.title })
  })

  it('null is the cache saying "no title yet": known, untitled', () => {
    expect(peekTitleFromProjection({ title: null })).toEqual({ titleKnown: true })
  })

  it.each([
    ['absent key', {}],
    ['no values at all', undefined],
    ['a number', { title: 3 }],
    ['an object without a string title', { title: { eventSeq: 1 } }],
    ['an array', { title: ['x'] }],
  ])('%s cannot be parsed: unknown, so the caller inspects', (_name, values) => {
    expect(peekTitleFromProjection(values as never)).toEqual({ titleKnown: false })
  })
})
