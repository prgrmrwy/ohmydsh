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
 * Whether this call must obey the host's egress policy.
 *
 * Exemption matches the ACTUAL provider route id exactly: Magpie's UI groups
 * (Claude/GPT) are one route (`dsh-magpie-connector`), so display names, model ids and
 * prefixes never grant an exemption. Claude-family classification is unchanged
 * by an exemption, so other senders still see the same selection.
 *
 * @param provider - the request's provider route id.
 * @param model - the request's model id.
 * @param exemptProviders - exact route ids exempt from this host's egress gate.
 * @returns true when the gate must decide this call.
 */
export function requiresEgressGuard(provider: string, model: string, exemptProviders: readonly string[] = []): boolean {
  return !exemptProviders.includes(provider) && isClaudeFamily(provider, model)
}

/** Validate a bounded list without normalizing provider identities. */
export function isProviderList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(entry =>
    typeof entry === 'string' && entry.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(entry))
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