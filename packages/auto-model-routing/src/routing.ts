import type { Capability, Depth } from './jev.js'
import { AUTO_EFFORTS, type AutomaticEffort, type RoutingCatalog } from './settings-contract.js'
import { MODEL_ID_PATTERN } from './settings-validation.js'
import { registry as builtin, type Registry } from './strategies/index.js'

/** Family of a child model on an exact transport; undefined when no registered strategy owns it. */
export function modelFamily(provider: string, model: string, registry: Registry = builtin): string | undefined {
  return registry.familyOfChild(provider, model)?.id
}
/** A transport whose model ids carry a family prefix (`<family>/<model>`), e.g. a gateway. */
function prefixedTransport(provider: string, registry: Registry): boolean {
  return registry.strategies.some(s => (s.transports[provider] ?? '') !== '')
}
export function validatePolicyRoute(catalog: RoutingCatalog, provider: string, model: string, effort: string, cap: AutomaticEffort, registry: Registry = builtin): void {
  const entry = catalog.models.find(m => m.provider === provider && m.model === model)
  const validId = prefixedTransport(provider, registry) ? /^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)+$/.test(model) && model.length <= 128 : MODEL_ID_PATTERN.test(model)
  if (!registry.hasProvider(provider) || !validId || !entry || !AUTO_EFFORTS.includes(effort as AutomaticEffort) || AUTO_EFFORTS.indexOf(effort as AutomaticEffort) > AUTO_EFFORTS.indexOf(cap) || !entry.reasoningEfforts.includes(effort) || catalog.childAllowlist.status !== 'enabled' || !catalog.childAllowlist.allowedModels.some(m => m.provider === provider && m.model === model)) throw new Error('子任务路由不在当前目录/允许列表或 effort 上限内；暂停委派并询问用户')
}

export function policyEffort(model: string, depth: Depth, supported: readonly string[], cap: AutomaticEffort, defaultEffort?: string, registry: Registry = builtin): AutomaticEffort {
  const start = registry.effortStart(model) ?? defaultEffort
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
export interface PolicyRoute { provider: string; model: string; reasoningEffort: AutomaticEffort }
/**
 * Child route: explicit dimensions are kept; otherwise the family's capability slot on this transport.
 * A transport owned by a single family (empty prefix) implies that family; others need `family`.
 */
export function choosePolicyRoute(provider: string, capability: Capability, depth: Depth, catalog: RoutingCatalog, cap: AutomaticEffort, explicit: { model?: string | undefined; reasoningEffort?: string | undefined } = {}, family?: string, registry: Registry = builtin): PolicyRoute {
  if (!registry.hasProvider(provider)) throw new Error('unsupported：provider 不在已注册家族中；暂停委派并询问用户')
  const implied = registry.familyOfChild(provider, '')?.id
  const selectedFamily = implied ?? family
  const slot = selectedFamily ? registry.childModel(selectedFamily, provider, capability) : undefined
  if (!explicit.model && !slot) throw new Error('unsupported：没有已定义的模型能力家族；请显式指定模型')
  const model = explicit.model ?? slot!
  const entry = catalog.models.find(m => m.provider === provider && m.model === model)
  const reasoningEffort = explicit.reasoningEffort ?? policyEffort(model, depth, entry?.reasoningEfforts ?? [], cap, entry?.defaultEffort, registry)
  validatePolicyRoute(catalog, provider, model, reasoningEffort, cap, registry)
  return { provider, model, reasoningEffort: reasoningEffort as AutomaticEffort }
}
