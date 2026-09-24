import { describe, expect, it } from 'vitest'
import { judge } from '../src/judge.js'

const CLAUDE = { provider: 'claude', model: 'claude-sonnet-4-5' }
const DEEPSEEK = { provider: 'deepseek', model: 'deepseek-chat' }

describe('judge (spec scenario table)', () => {
  it('allowed egress + Claude → none (permitted)', () => {
    expect(judge({ network: 'allowed', routable: true, selection: CLAUDE })).toBe('none')
  })

  it('blocked egress + Claude → block', () => {
    expect(judge({ network: 'blocked', routable: true, selection: CLAUDE })).toBe('block')
  })

  it('unknown egress + Claude → block (fail closed)', () => {
    expect(judge({ network: 'unknown', routable: true, selection: CLAUDE })).toBe('block')
  })

  it('restricted egress + non-Claude → none', () => {
    expect(judge({ network: 'blocked', routable: true, selection: DEEPSEEK })).toBe('none')
    expect(judge({ network: 'unknown', routable: true, selection: DEEPSEEK })).toBe('none')
  })

  it('no selection yet → none even when restricted', () => {
    expect(judge({ network: 'blocked', routable: true, selection: null })).toBe('none')
    expect(judge({ network: 'unknown', routable: true, selection: null })).toBe('none')
  })

  it('official non-routable block always yields, regardless of network/selection', () => {
    expect(judge({ network: 'allowed', routable: false, selection: CLAUDE })).toBe('yield-official')
    expect(judge({ network: 'unknown', routable: false, selection: null })).toBe('yield-official')
  })
})