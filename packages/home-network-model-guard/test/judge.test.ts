import { describe, expect, it } from 'vitest'
import { judge } from '../src/judge.js'

const CLAUDE = { provider: 'claude', model: 'claude-sonnet-4-5' }
const DEEPSEEK = { provider: 'deepseek', model: 'deepseek-chat' }

describe('judge (spec scenario table)', () => {
  it('home + Claude → block', () => {
    expect(judge({ network: 'home', routable: true, selection: CLAUDE })).toBe('block')
  })

  it('home + non-Claude → none', () => {
    expect(judge({ network: 'home', routable: true, selection: DEEPSEEK })).toBe('none')
  })

  it('not-home + Claude → none', () => {
    expect(judge({ network: 'not-home', routable: true, selection: CLAUDE })).toBe('none')
  })

  it('unknown network (fail open) + Claude → none', () => {
    expect(judge({ network: 'unknown', routable: true, selection: CLAUDE })).toBe('none')
  })

  it('no selection yet (current null) → none even at home', () => {
    expect(judge({ network: 'home', routable: true, selection: null })).toBe('none')
  })

  it('official non-routable block always yields, regardless of network/selection', () => {
    expect(judge({ network: 'home', routable: false, selection: CLAUDE })).toBe('yield-official')
    expect(judge({ network: 'unknown', routable: false, selection: null })).toBe('yield-official')
  })
})