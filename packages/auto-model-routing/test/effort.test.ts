import { expect, it } from 'vitest'
import { CHILD_TABLE, mapEffort } from '../src/effort.js'

it('maps_tier_to_effort', () => {
 expect(mapEffort('claude-opus-5-5', 'standard', ['low', 'medium', 'xhigh', 'max'])).toBe('medium')
 expect(mapEffort('claude-opus-5-5', 'complex', ['low', 'medium', 'xhigh', 'max'])).toBe('xhigh')
 expect(mapEffort('gpt-6-astra', 'escalated', ['low', 'medium', 'high'])).toBe('high')
})
it('clamps_unsupported_effort', () => {
 expect(mapEffort('claude-opus-5-5', 'complex', ['low', 'medium', 'high', 'max'])).toBe('high')
 expect(mapEffort('gpt-6-astra', 'simple', ['medium', 'high'])).toBe('medium')
 expect(mapEffort('other', 'standard', [])).toBeUndefined()
})
it('child_table_matches_design_and_family', () => {
 expect(CHILD_TABLE).toEqual({
  simple: { claude: ['claude-haiku-5-5', 'low'], codex: ['gpt-6-luna', 'medium'] },
  standard: { claude: ['claude-sonnet-5-5', 'medium'], codex: ['gpt-6.1-sol', 'medium'] },
  complex: { claude: ['claude-opus-5-5', 'xhigh'], codex: ['gpt-6.1-sol', 'xhigh'] },
  escalated: { claude: ['claude-fable-5-1', 'high'], codex: ['gpt-6-astra', 'medium'] },
 })
 for (const row of Object.values(CHILD_TABLE)) {
  expect(row.claude[0]).toMatch(/^claude-/)
  expect(row.codex[0]).not.toMatch(/^claude-/)
 }
})
