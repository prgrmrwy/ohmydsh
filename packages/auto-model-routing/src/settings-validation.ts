import { AUTO_EFFORTS, type AutomaticEffort, type RoutingCatalog, type RoutingModel, type SettingsIssue } from './settings-contract.js'

export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}(?![\s\S])/
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function issue(path: string, code: string, message: string): SettingsIssue { return { path, code, message } }
export function supportedAutomaticEfforts(model: RoutingModel, cap: AutomaticEffort): AutomaticEffort[] {
  return AUTO_EFFORTS.filter((effort, index) => index <= AUTO_EFFORTS.indexOf(cap) && model.reasoningEfforts.includes(effort))
}
export function selectableModels(catalog: RoutingCatalog, provider: string, kind: 'main' | 'child'): RoutingModel[] {
  return catalog.models.filter(model => model.provider === provider && (kind === 'main' || (
    catalog.childAllowlist.status === 'enabled' && catalog.childAllowlist.allowedModels.some(route => route.provider === provider && route.model === model.model)
  )))
}
export function supportedFamilyEfforts(catalog: RoutingCatalog, provider: string, cap: AutomaticEffort): AutomaticEffort[] {
  const models = selectableModels(catalog, provider, 'main')
  return models.length ? AUTO_EFFORTS.filter((effort, index) => index <= AUTO_EFFORTS.indexOf(cap) && models.every(model => model.reasoningEfforts.includes(effort))) : []
}
export function validateFamilyMainEffort(catalog: RoutingCatalog, provider: string, effort: unknown, cap: AutomaticEffort, path = ''): SettingsIssue[] {
  if (!['claude', 'codex'].includes(provider)) return [issue(path, 'invalid-route', 'Invalid provider')]
  if (!AUTO_EFFORTS.includes(effort as AutomaticEffort)) return [issue(path, 'invalid-effort', 'Choose an automatic effort from low through xhigh')]
  if (AUTO_EFFORTS.indexOf(effort as AutomaticEffort) > AUTO_EFFORTS.indexOf(cap)) return [issue(path, 'effort-cap', '超过推理强度上限')]
  if (!selectableModels(catalog, provider, 'main').length) return [issue(path, 'model-unavailable', '该体系没有当前可用模型')]
  if (!supportedFamilyEfforts(catalog, provider, cap).includes(effort as AutomaticEffort)) return [issue(path, 'unsupported-effort', '此推理等级并非该体系所有模型共同支持')]
  return []
}
export function validateMainRoute(catalog: RoutingCatalog, provider: string, model: string, effort: unknown, cap: AutomaticEffort, path = ''): SettingsIssue[] {
  if (!['claude', 'codex'].includes(provider) || !MODEL_ID_PATTERN.test(model)) return [issue(path, 'invalid-route', 'Invalid provider or model id')]
  if (!AUTO_EFFORTS.includes(effort as AutomaticEffort)) return [issue(path, 'invalid-effort', 'Choose an automatic effort from low through xhigh')]
  if (AUTO_EFFORTS.indexOf(effort as AutomaticEffort) > AUTO_EFFORTS.indexOf(cap)) return [issue(path, 'effort-cap', '超过推理强度上限')]
  const entry = catalog.models.find(entry => entry.provider === provider && entry.model === model)
  if (!entry) return [issue(path, 'model-unavailable', '模型不在当前可用目录中')]
  if (!entry.reasoningEfforts.includes(effort as string)) return [issue(path, 'unsupported-effort', '模型不支持此推理等级')]
  return []
}
export function validateChildRoute(catalog: RoutingCatalog, provider: string, route: unknown, cap: AutomaticEffort, path = ''): SettingsIssue[] {
  if (!isRecord(route) || typeof route.model !== 'string' || typeof route.reasoningEffort !== 'string' || Object.keys(route).some(key => !['model', 'reasoningEffort'].includes(key))) {
    return [issue(path, 'invalid-route', '子会话推荐必须包含完整的模型和推理等级')]
  }
  const errors = validateMainRoute(catalog, provider, route.model, route.reasoningEffort, cap, path)
  if (errors.length) return errors
  if (catalog.childAllowlist.status !== 'enabled') return [issue(path, 'allowlist-unavailable', '无法读取已启用的子智能体允许列表')]
  if (!catalog.childAllowlist.allowedModels.some(entry => entry.provider === provider && entry.model === route.model)) return [issue(path, 'route-not-allowed', '模型不在子智能体允许列表中')]
  return []
}
