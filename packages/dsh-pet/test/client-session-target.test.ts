import { describe, expect, it } from 'vitest'
import { mainSessionId } from '../src/client/main-session.js'
import { sessionTargetOf } from '../src/client/session-target.js'

describe('Pet client on DSH 0.2.0 session contracts', () => {
  it('reads the main-view Session from the mainView retain reference', () => {
    expect(mainSessionId({ byId: { a: { retainedBy: { sidebar: 1 } }, b: { retainedBy: { mainView: 1 } } } })).toBe('b')
  })

  it('reports no source on a page with no main-view Session, never a recent one', () => {
    expect(mainSessionId({ byId: { a: { retainedBy: { sidebar: 2 } } } })).toBeUndefined()
  })

  it('opens a plain Session by id', () => {
    expect(sessionTargetOf({ kind: 'session', sessionId: 's1' })).toBe('s1')
  })

  it('opens a locus child through its parent as a continuable subagent address', () => {
    expect(sessionTargetOf({ kind: 'subagent', parentSessionId: 'p', childSessionId: 'c' }))
      .toEqual({ parentSessionId: 'p', childSessionId: 'c', mode: 'continuable' })
  })
})
