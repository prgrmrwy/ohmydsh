import type { Capability, Depth } from './jev.js'
import { targetEffort, type ChildProvider } from './effort.js'
import { AUTO_EFFORTS, type AutomaticEffort, type RoutingCatalog } from './settings-contract.js'
import { MODEL_ID_PATTERN } from './settings-validation.js'
export const POLICY_PROVIDERS = ['claude', 'codex', 'dsh-magpie-connect', 'dsh-magpie-connector'] as const
export type PolicyProvider = typeof POLICY_PROVIDERS[number]
export function magpieProvider(value: string): value is 'dsh-magpie-connect' | 'dsh-magpie-connector' { return value === 'dsh-magpie-connect' || value === 'dsh-magpie-connector' }
export function policyProvider(value: string): value is PolicyProvider { return POLICY_PROVIDERS.some(provider => provider === value) }
export function modelFamily(provider: string, model: string): ChildProvider | undefined {
  if (provider === 'claude' || provider === 'codex') return provider
  if (!magpieProvider(provider)) return undefined
  const family = model.split('/')[0]
  return family === 'claude' || family === 'codex' ? family : undefined
}
export function validatePolicyRoute(catalog: RoutingCatalog, provider: string, model: string, effort: string, cap: AutomaticEffort): void {
  const entry = catalog.models.find(m => m.provider === provider && m.model === model)
  const validId = magpieProvider(provider) ? /^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)+$/.test(model) && model.length <= 128 : MODEL_ID_PATTERN.test(model)
  if (!policyProvider(provider) || !validId || !entry || !AUTO_EFFORTS.includes(effort as AutomaticEffort) || AUTO_EFFORTS.indexOf(effort as AutomaticEffort) > AUTO_EFFORTS.indexOf(cap) || !entry.reasoningEfforts.includes(effort) || catalog.childAllowlist.status !== 'enabled' || !catalog.childAllowlist.allowedModels.some(m => m.provider === provider && m.model === model)) throw new Error('策略路由不在当前目录/允许列表或 effort 上限内；暂停委派并询问用户')
}

// Versioned initial slots; Codex currently has only two approved capability models.
export const POLICY_MODELS: Readonly<Record<ChildProvider, Record<Capability, string>>> = {
  claude: { bounded: 'claude-haiku-5-5', analytical: 'claude-sonnet-5-5', frontier: 'claude-opus-5-5' },
  codex: { bounded: 'gpt-6-luna', analytical: 'gpt-6.1-sol', frontier: 'gpt-6.1-sol' },
}
export const mappingVersion = 'capability-slots-2-magpie'
export function policyEffort(model: string, depth: Depth, supported: readonly string[], cap: AutomaticEffort, defaultEffort?: string): AutomaticEffort {
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
  const known = /^(claude-(haiku|sonnet|opus)-5-5|claude-fable-5-1|gpt-6-luna|gpt-6\.1-sol|gpt-6-astra)$/.test(bare)
  const start = known ? targetEffort(bare, 'standard') : defaultEffort
  if (!start) throw new Error('unsupported：模型缺少可验证的默认 effort')
  const baseline = AUTO_EFFORTS.indexOf(start as AutomaticEffort)
  if (baseline < 0 || !supported.includes(start)) throw new Error('模型推荐 effort 起点不可验证，请先配置受支持模型')
  const candidates = AUTO_EFFORTS.filter(e => supported.includes(e))
  const index = candidates.indexOf(start as AutomaticEffort)
  const offset = depth === 'lower' ? -1 : depth === 'higher' ? 1 : 0
  const chosen = candidates[Math.max(0, Math.min(candidates.length - 1, index + offset))]!
  const allowed = candidates.filter(e => AUTO_EFFORTS.indexOf(e) <= AUTO_EFFORTS.indexOf(cap))
  if (!allowed.length) throw new Error('没有上限内的受支持 effort')
  return AUTO_EFFORTS.indexOf(chosen) > AUTO_EFFORTS.indexOf(cap) ? allowed.at(-1)! : chosen
}
export interface PolicyRoute { provider: PolicyProvider; model: string; reasoningEffort: AutomaticEffort }
export function choosePolicyRoute(provider: PolicyProvider, capability: Capability, depth: Depth, catalog: RoutingCatalog, cap: AutomaticEffort, explicit: { model?: string | undefined; reasoningEffort?: string | undefined } = {}, family?: ChildProvider): PolicyRoute {
  const selectedFamily = magpieProvider(provider) ? family : provider
  if (!explicit.model && !selectedFamily) throw new Error('unsupported：没有已定义的模型能力家族；请显式指定模型')
  const model = explicit.model ?? `${magpieProvider(provider) ? `${selectedFamily}/` : ''}${POLICY_MODELS[selectedFamily!][capability]}`
  const entry = catalog.models.find(m => m.provider === provider && m.model === model)
  const reasoningEffort = explicit.reasoningEffort ?? policyEffort(model, depth, entry?.reasoningEfforts ?? [], cap, entry?.defaultEffort)
  validatePolicyRoute(catalog, provider, model, reasoningEffort, cap)
  return { provider, model, reasoningEffort: reasoningEffort as AutomaticEffort }
}
