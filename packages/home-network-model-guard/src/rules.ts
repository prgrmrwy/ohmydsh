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
 * The single fixed egress IP query endpoint.
 *
 * Deliberately ONE endpoint: the host's egress address can rotate (large
 * NAT/load-balanced address pools rotate per request), so querying several
 * services returns mutually contradictory answers that cannot be voted on.
 * A failed query degrades to `'unknown'` (fail open); there is no fallback
 * endpoint, only retry on the next request.
 *
 * Selected empirically 2026-09-03: `api.ipify.org` was connection-refused
 * (≈66ms RST, filtered) both on the current office segment AND on the home
 * network (empty response), while `ifconfig.me/ip` answers on both. The
 * plain-text body is handled by `fetchEgressIp`.
 */
export const EGRESS_IP_ENDPOINT = 'https://ifconfig.me/ip'

/**
 * Home-network allowlist: public egress IPs that count as "home".
 *
 * Measured 2026-09-03 on the home network (task 5.1 of openspec change
 * block-claude-on-home-network): `115.197.18.69` was stable across 8
 * consecutive queries (≈1s apart) and agreed with an ipinfo.io cross-check.
 * The ISP addresses this line with a static public-like assignment. If the ISP
 * ever renumbers this line, the guard fails open (`not-home`, never a false
 * block) — re-measure and update this list.
 */
export const HOME_NETWORKS: readonly string[] = ['115.197.18.69']

/**
 * Classify one measured egress IP against the allowlist (whitelist semantics).
 *
 * Only an explicit hit counts as home; anything else (including an empty
 * allowlist) is `'not-home'`. The guard MUST NOT invert this: "did not hit a
 * known non-home set" must never imply home, because egress pools rotate.
 *
 * @param ip - a measured public egress IP.
 * @param homeSet - allowlist; defaults to {@link HOME_NETWORKS}.
 * @returns `'home'` iff `ip` is in `homeSet`, else `'not-home'`.
 */
export function classifyIp(ip: string, homeSet: readonly string[] = HOME_NETWORKS): NetworkVerdict {
  return homeSet.includes(ip) ? 'home' : 'not-home'
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