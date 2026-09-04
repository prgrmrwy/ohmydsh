/**
 * Guard rules and constants: the policy knobs of dsh-home-network-model-guard.
 *
 * Everything in this module is framework-free and constant-driven so the
 * policy surface stays reviewable in one place and unit-testable offline.
 *
 * @module dsh-home-network-model-guard/rules
 */
import type { NetworkVerdict } from './contract.js'

/**
 * Classify one resolved egress country/region against the blocklist.
 *
 * Blocklist semantics: ONLY an explicit hit counts as blocked. A successful
 * resolution that is not in the blocklist is `'allowed'`; the caller maps any
 * failed/absent resolution to `'unknown'` (fail closed for Claude) elsewhere.
 *
 * @param country - ISO 3166-1 alpha-2 country code from a Geo service.
 * @param blocked - blocklist of country codes (default at least `CN`).
 * @returns `'blocked'` iff `country` is in `blocked`, else `'allowed'`.
 */
export function classifyCountry(country: string, blocked: readonly string[]): NetworkVerdict {
  return blocked.includes(country.toUpperCase()) ? 'blocked' : 'allowed'
}

/**
 * Whether a provider/model selection belongs to the Claude family.
 *
 * Reads BOTH fields (never the model name alone): the subscriptions plugin
 * routes Claude as its own provider id (`claude`) with anthropic model ids,
 * and the api-key route uses `anthropic` — matching only the model name would
 * misroute both. Same dual-field discipline as sidebar-session-provider-icon
 * (`brandKeyOf(provider, model)`).
 *
 * @param provider - the selected provider route id.
 * @param model - the selected model id.
 * @returns true for Claude-family selections.
 */
export function isClaudeFamily(provider: string, model: string): boolean {
  const p = provider.trim().toLowerCase()
  const m = model.trim().toLowerCase()
  if (p === 'claude' || p === 'anthropic' || p.startsWith('claude/') || p.startsWith('anthropic/')) return true
  return m.startsWith('claude') || m.startsWith('anthropic')
}