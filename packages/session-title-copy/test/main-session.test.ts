import { describe, expect, it } from 'vitest'
import { mainSessionId } from '../src/client/main-session.js'

describe('mainSessionId', () => {
  it('reads DSH 0.1.5 SessionListState.current', () => {
    expect(mainSessionId({ current: 'session-a', byId: {} })).toBe('session-a')
  })

  it('reads the DSH 0.2.0 mainView retain reference when current is gone', () => {
    expect(mainSessionId({
      byId: {
        'session-a': { retainedBy: { sidebar: 1 } },
        'session-b': { retainedBy: { mainView: 1, sidebar: 1 } },
      },
    })).toBe('session-b')
  })

  it('reports no selection when nothing holds the main view', () => {
    expect(mainSessionId({ byId: { 'session-a': { retainedBy: { mainView: 0 } } } })).toBeUndefined()
    expect(mainSessionId(undefined)).toBeUndefined()
  })
})
