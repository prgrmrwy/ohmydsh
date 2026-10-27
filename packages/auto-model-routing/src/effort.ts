export type Tier = 'simple' | 'standard' | 'complex' | 'escalated'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Reason = 'jev' | 'continued' | 'no-effort-support' | 'jev-failed'

export const tiers: readonly Tier[] = ['simple', 'standard', 'complex', 'escalated']

import { registry } from './strategies/index.js'
const OFFSET: Readonly<Record<Tier, number>> = { simple: -1, standard: 0, complex: 1, escalated: 2 }
/** Automatic routing never goes above xhigh: `max` stays a manual choice. */
const automatic: readonly Effort[] = ['low', 'medium', 'high', 'xhigh']

/** Target effort before clamping to what the model supports (also used for sub-agents, unclamped). */
export function targetEffort(model: string, tier: Tier, cap: Effort = 'xhigh'): Effort {
  const start = automatic.indexOf(registry.effortStart(model) ?? 'medium')
  const ceiling = cap === 'max' ? automatic.length - 1 : automatic.indexOf(cap)
  return automatic[Math.max(0, Math.min(ceiling, start + OFFSET[tier]))]!
}

/** Undefined when the model supports none of low..xhigh: the request is then left as is. */
export function mapEffort(model: string, tier: Tier, supported: readonly Effort[], cap: Effort = 'xhigh'): Effort | undefined {
  const target = targetEffort(model, tier, cap)
  const candidates = automatic.filter(effort => supported.includes(effort) && automatic.indexOf(effort) <= (cap === 'max' ? automatic.length - 1 : automatic.indexOf(cap)))
  return candidates.filter(effort => automatic.indexOf(effort) <= automatic.indexOf(target)).at(-1) ?? candidates[0]
}

export type ChildProvider = 'claude' | 'codex'
/** Sub-agent models by tier (design D9); the single source for `route_subagent`. Effort comes from `targetEffort`. */
export const CHILD_MODELS: Readonly<Record<ChildProvider, readonly [simple: string, standard: string, complex: string, escalated: string]>> = {
  claude: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-5'],
  codex: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-sol', 'gpt-6.1-sol'],
}
