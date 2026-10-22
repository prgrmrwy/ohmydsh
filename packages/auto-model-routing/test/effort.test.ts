import { expect, it } from 'vitest'
import { CHILD_TABLE, mapEffort, tiers } from '../src/effort.js'

const all = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const row = (model: string, supported: readonly string[] = all) => tiers.map(t => mapEffort(model, t, supported as never))

it('maps_tier_to_effort', () => {
 expect(row('claude-opus-5-5')).toEqual(['low', 'medium', 'high', 'xhigh'])
})
it('starting_points_float_and_cap_at_xhigh', () => {
 expect(row('claude-fable-5-1')).toEqual(['medium', 'high', 'xhigh', 'xhigh'])
 expect(row('gpt-6-luna')).toEqual(['medium', 'high', 'xhigh', 'xhigh'])
 expect(row('gpt-6-astra')).toEqual(['low', 'low', 'medium', 'high'])
 expect(row('unknown-model')).toEqual(['low', 'medium', 'high', 'xhigh'])
 for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-6.1-sol']) expect(row(model)).toEqual(['low', 'medium', 'high', 'xhigh'])
 for (const model of ['claude-opus-5-5', 'claude-fable-5-1', 'gpt-6-luna', 'gpt-6-astra', 'x']) expect(row(model)).not.toContain('max')
})
it('clamps_unsupported_effort', () => {
 expect(mapEffort('claude-opus-5-5', 'escalated', ['low', 'medium', 'high', 'max'])).toBe('high')
 expect(mapEffort('gpt-6-astra', 'simple', ['medium', 'high'])).toBe('medium')
 expect(mapEffort('other', 'standard', [])).toBeUndefined()
 expect(mapEffort('other', 'escalated', ['max'])).toBeUndefined()
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
