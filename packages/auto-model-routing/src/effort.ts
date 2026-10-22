export type Tier = 'simple' | 'standard' | 'complex' | 'escalated'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Reason = 'jev' | 'continued' | 'no-effort-support' | 'jev-failed'

export const tiers: readonly Tier[] = ['simple', 'standard', 'complex', 'escalated']

/** Official starting points (design D9; sources in eval/README.md). Unlisted models start at medium. */
const STARTING_POINTS: Readonly<Record<string, Effort>> = {
  'claude-opus-5-5': 'medium',
  'claude-sonnet-5-5': 'medium',
  'claude-haiku-5-5': 'medium',
  'gpt-6.1-sol': 'medium',
  'claude-fable-5-1': 'high',
  'gpt-6-luna': 'high',
  'gpt-6-astra': 'low',
}
const OFFSET: Readonly<Record<Tier, number>> = { simple: -1, standard: 0, complex: 1, escalated: 2 }
/** Automatic routing never goes above xhigh: `max` stays a manual choice. */
const automatic: readonly Effort[] = ['low', 'medium', 'high', 'xhigh']

/** Target effort before clamping to what the model supports (also used for sub-agents, unclamped). */
export function targetEffort(model: string, tier: Tier): Effort {
  const start = automatic.indexOf(STARTING_POINTS[model] ?? 'medium')
  return automatic[Math.max(0, Math.min(automatic.length - 1, start + OFFSET[tier]))]!
}

/** Undefined when the model supports none of low..xhigh: the request is then left as is. */
export function mapEffort(model: string, tier: Tier, supported: readonly Effort[]): Effort | undefined {
  const target = targetEffort(model, tier)
  const candidates = automatic.filter(effort => supported.includes(effort))
  return candidates.filter(effort => automatic.indexOf(effort) <= automatic.indexOf(target)).at(-1) ?? candidates[0]
}

export type ChildProvider = 'claude' | 'codex'
/** Sub-agent table (design D9); the single source used by `route_subagent`. */
export const CHILD_TABLE: Readonly<Record<Tier, Readonly<Record<ChildProvider, readonly [model: string, effort: Effort]>>>> = {
  simple: { claude: ['claude-haiku-5-5', 'low'], codex: ['gpt-6-luna', 'medium'] },
  standard: { claude: ['claude-sonnet-5-5', 'medium'], codex: ['gpt-6.1-sol', 'medium'] },
  complex: { claude: ['claude-opus-5-5', 'xhigh'], codex: ['gpt-6.1-sol', 'xhigh'] },
  escalated: { claude: ['claude-fable-5-1', 'high'], codex: ['gpt-6-astra', 'medium'] },
}
