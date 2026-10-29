import type { Capability, Depth } from './jev.js'
import { AUTO_EFFORTS, type AutomaticEffort, type RoutingCatalog } from './settings-contract.js'
import { registry as builtin, type Registry } from './strategies/index.js'

type Allowed = readonly { provider: string; model: string }[]
const listed = (list: Allowed, provider: string, model: string) => list.some(m => m.provider === provider && m.model === model)

/** Whether a route is usable now: live catalog, enabled official allowlist, captured allowlist (if any) and the effort cap. */
export function routeUsable(catalog: RoutingCatalog, provider: string, model: string, effort: string, cap: AutomaticEffort, captured?: Allowed): boolean {
  const entry = catalog.models.find(m => m.provider === provider && m.model === model)
  return !!entry && model.length <= 128 && AUTO_EFFORTS.includes(effort as AutomaticEffort) && AUTO_EFFORTS.indexOf(effort as AutomaticEffort) <= AUTO_EFFORTS.indexOf(cap)
    && entry.reasoningEfforts.includes(effort) && catalog.childAllowlist.status === 'enabled' && listed(catalog.childAllowlist.allowedModels, provider, model)
    && (!captured || listed(captured, provider, model))
}
/** Bound routes are re-checked on every request; any gate failure rejects that request. */
export function validatePolicyRoute(catalog: RoutingCatalog, provider: string, model: string, effort: string, cap: AutomaticEffort, captured?: Allowed): void {
  if (!routeUsable(catalog, provider, model, effort, cap, captured)) throw new Error('子任务路由不在当前目录/允许列表或 effort 上限内；拒绝本次请求')
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
export type RouteFallback = 'no-usable-route' | 'explicit-unavailable'
export interface ChildRouteInput {
  provider: string
  parent: { model?: string | undefined; reasoningEffort?: string | undefined }
  explicit: { model?: string | undefined; reasoningEffort?: string | undefined }
  capability: Capability
  depth: Depth
  catalog: RoutingCatalog
  cap: AutomaticEffort
  captured?: Allowed | undefined
}
/**
 * Fallback chain: capability slot → keep model with depth effort → parent effort (automatic effort only) → no rewrite.
 * Provider never changes; explicit dimensions are never replaced.
 */
export function chooseChildRoute(input: ChildRouteInput, registry: Registry = builtin): { route: PolicyRoute } | { fallback: RouteFallback } {
  const { provider, parent, explicit, depth, catalog, cap, captured } = input
  const entry = (model: string) => catalog.models.find(m => m.provider === provider && m.model === model)
  const depthEffort = (model: string) => { try { const e = entry(model); return e ? policyEffort(model, depth, e.reasoningEfforts, cap, e.defaultEffort, registry) : undefined } catch { return undefined } }
  const take = (model: string | undefined, effort: string | undefined) => model && effort && routeUsable(catalog, provider, model, effort, cap, captured) ? { route: { provider, model, reasoningEffort: effort as AutomaticEffort } } : undefined
  const family = parent.model ? registry.familyOfMainModel(parent.model)?.id : undefined
  if (!explicit.model && family && parent.model) {
    const slot = registry.resolveSlot(family, input.capability, parent.model, catalog.models.filter(m => m.provider === provider).map(m => m.model))
    const hit = slot && take(slot, explicit.reasoningEffort ?? depthEffort(slot))
    if (hit) return hit
  }
  const model = explicit.model ?? parent.model
  const kept = model && take(model, explicit.reasoningEffort ?? depthEffort(model))
  if (kept) return kept
  const inherited = !explicit.reasoningEffort && take(model, parent.reasoningEffort)
  if (inherited) return inherited
  return { fallback: explicit.model || explicit.reasoningEffort ? 'explicit-unavailable' : 'no-usable-route' }
}
