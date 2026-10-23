import { expect, it } from 'vitest'
import { CHILD_MODELS, mapEffort, tiers } from '../src/effort.js'

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
it('defaults_respect_cap_without_exceeding_it_for_model_minimum', () => {
 expect(tiers.map(t => mapEffort('claude-opus-5-5', t, all, 'medium'))).toEqual(['low', 'medium', 'medium', 'medium'])
 expect(mapEffort('claude-fable-5-1', 'standard', all, 'low')).toBe('low')
 expect(mapEffort('gpt-6-astra', 'simple', ['high', 'xhigh'], 'medium')).toBeUndefined()
})
it('child_models_match_design_and_family', () => {
 expect(CHILD_MODELS).toEqual({
  claude: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-5'],
  codex: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-sol', 'gpt-6.1-sol'],
 })
 for (const model of CHILD_MODELS.claude) expect(model).toMatch(/^claude-/)
 for (const model of CHILD_MODELS.codex) expect(model).not.toMatch(/^claude-/)
})
