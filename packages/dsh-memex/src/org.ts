/**
 * Organization profile: which hosts and domains count as "internal".
 *
 * The public package ships with none. A deployment supplies them through the
 * plugin row's `config` (a private overlay patch overrides the row), so the
 * public source never names an organization's hosts.
 *
 * Two consumers:
 * - scope derivation: a repository whose `origin` host is listed in
 *   `internalHosts` derives an internal library;
 * - the cross-write guard: text naming a remote on one of `internalHosts`, or
 *   any host under `internalDomains`, is rejected from external libraries.
 *
 * @module dsh-memex/org
 */

export interface OrgProfileInput {
  /** Git hosts whose repositories are internal, e.g. `git.corp.example`. */
  readonly internalHosts?: unknown
  /** Domains (and their subdomains) whose names must not leave internal libraries. */
  readonly internalDomains?: unknown
}

export interface OrgProfile {
  readonly internalHosts: readonly string[]
  readonly internalDomains: readonly string[]
  /** Config entries that were not usable; reported, never silently dropped. */
  readonly problems: readonly string[]
}

export const EMPTY_ORG_PROFILE: OrgProfile = { internalHosts: [], internalDomains: [], problems: [] }

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function hostList(value: unknown, key: string, problems: string[]): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    problems.push(`${key} must be a list of host names`)
    return []
  }
  const out: string[] = []
  for (const [index, raw] of value.entries()) {
    const host = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^\.+|\.+$/g, '') : ''
    if (!HOSTNAME_RE.test(host)) {
      problems.push(`${key}[${index}] is not a host name`)
      continue
    }
    if (!out.includes(host)) out.push(host)
  }
  return out
}

/**
 * Normalize the plugin row config. Invalid entries are dropped and reported:
 * an unusable entry cannot mark anything internal, and the caller logs it so a
 * typo does not look like a working rule.
 */
export function parseOrgProfile(config: OrgProfileInput | undefined | null): OrgProfile {
  if (config === undefined || config === null || typeof config !== 'object') return EMPTY_ORG_PROFILE
  const problems: string[] = []
  const internalHosts = hostList(config.internalHosts, 'internalHosts', problems)
  const internalDomains = hostList(config.internalDomains, 'internalDomains', problems)
  return { internalHosts, internalDomains, problems }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches a git remote (ssh, scp-like or URL form) on one of the hosts. */
export function internalRemotePattern(profile: OrgProfile): RegExp | undefined {
  if (profile.internalHosts.length === 0) return undefined
  const hosts = profile.internalHosts.map(escape).join('|')
  return new RegExp(`(?:ssh:\\/\\/(?:[^@\\s/]+@)?|git@|https?:\\/\\/)?(?:${hosts})(?::|\\/)[^\\s]+`, 'i')
}

/** Matches a host name at or under one of the domains. */
export function internalDomainPattern(profile: OrgProfile): RegExp | undefined {
  if (profile.internalDomains.length === 0) return undefined
  const domains = profile.internalDomains.map(escape).join('|')
  return new RegExp(`(?<![a-z0-9-])(?:[a-z0-9-]+\\.)*(?:${domains})(?![a-z0-9-])`, 'i')
}
