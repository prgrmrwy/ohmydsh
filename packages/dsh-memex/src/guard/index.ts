import type { ScopeResolution, ScopeService } from '../scope/types.js'

export interface GuardCard {
  readonly slug: string
  readonly title?: string
  readonly body: string
}

export interface GuardDecision {
  readonly allowed: boolean
  readonly rules: readonly string[]
  /**
   * Rules that could not run because their input was unavailable. They never
   * reject on their own: a rule with no data is inactive, not a violation.
   */
  readonly warnings: readonly string[]
}

const PRIVATE_IPV4 = /\b(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|169\.254(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})\b/
const PRIVATE_IPV6 = /(?:^|[\s[(])(?:::1|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]?:)[0-9a-f:]*(?=$|[\s\])},])/i
const INTERNAL_REMOTE = /(?:ssh:\/\/(?:[^@\s/]+@)?|git@)?code\.byted\.org(?::|\/)[^\s]+/i
const INTERNAL_DOMAIN = /\b(?:[a-z0-9-]+\.)*(?:byted\.org|bytedance\.net)\b/i

function asciiBoundary(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:$|[^A-Za-z0-9_-])`, 'i')
}

export function evaluateCrossWrite(
  card: GuardCard,
  target: ScopeResolution,
  resolver: ScopeService,
  workspacePaths: readonly string[] = [],
): GuardDecision {
  // An undetermined publish direction is the only state that cannot be judged
  // at all, so it is the one that fails closed.
  if (!target.publishKnown) return { allowed: false, rules: ['configuration:publish-unknown'], warnings: [] }
  if (target.publish === 'internal') return { allowed: true, rules: [], warnings: [] }

  const text = `${card.slug}\n${card.title ?? ''}\n${card.body}`
  const rules: string[] = []
  const warnings: string[] = []

  const knownScopes = resolver.list()
  if (knownScopes.some(scope => !scope.publishKnown)) rules.push('configuration:known-scope-publish-unknown')
  const internalScopes = knownScopes.filter(scope => scope.publishKnown && scope.publish === 'internal')
  for (const scope of internalScopes) {
    if (scope.scope.length >= 4 && asciiBoundary(scope.scope).test(text)) rules.push(`deny-term:${scope.scope}`)
  }

  // The workspace-path rule needs paths derived from real workspaces. When none
  // is known yet it stays inactive and says so, rather than blocking every
  // write: a missing input is not evidence of a leak.
  const knownPaths = [...new Set([...workspacePaths, ...internalScopes.flatMap(scope => scope.workspacePaths)])]
  if (knownPaths.length === 0) warnings.push('structural:workspace-path-rule-inactive')
  for (const path of knownPaths) {
    if (path && text.toLowerCase().includes(path.toLowerCase())) {
      rules.push('structural:workspace-path')
      break
    }
  }

  if (PRIVATE_IPV4.test(text) || PRIVATE_IPV6.test(text)) rules.push('structural:private-ip')
  if (INTERNAL_REMOTE.test(text)) rules.push('structural:internal-remote')
  if (INTERNAL_DOMAIN.test(text)) rules.push('structural:internal-domain')
  return { allowed: rules.length === 0, rules, warnings }
}
