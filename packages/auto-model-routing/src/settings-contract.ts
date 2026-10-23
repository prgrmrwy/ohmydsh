import type { Tier } from './effort.js'

export const AUTO_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export type AutomaticEffort = typeof AUTO_EFFORTS[number]
export type RoutingProvider = 'claude' | 'codex'
export const PROVIDERS = [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'GPT' }] as const
export interface ChildRoute { model: string; reasoningEffort: AutomaticEffort }
export interface Settings {
  decisionToast: boolean
  defaultMode: 'MANUAL' | 'AUTO'
  effortCap: AutomaticEffort
  jevTimeoutMs: number
  mainEfforts?: Partial<Record<RoutingProvider, Partial<Record<Tier, AutomaticEffort>>>>
  childRoutes?: Partial<Record<RoutingProvider, Partial<Record<Tier, ChildRoute>>>>
}
export type SettingsPatch = Partial<Pick<Settings, 'decisionToast' | 'defaultMode' | 'effortCap' | 'jevTimeoutMs'>> & {
  mainEfforts?: Partial<Record<RoutingProvider, Partial<Record<Tier, AutomaticEffort | null>> | null>>
  childRoutes?: Partial<Record<RoutingProvider, Partial<Record<Tier, ChildRoute | null>>>>
}
export interface SettingsIssue { path: string; code: string; message: string }
export interface RoutingModel { provider: string; model: string; name: string; reasoningEfforts: readonly string[] }
export interface RoutingCatalog {
  models: readonly RoutingModel[]
  childAllowlist: {
    status: 'enabled' | 'disabled' | 'unavailable'
    allowedModels: readonly { provider: string; model: string }[]
  }
}
export interface SettingsRead {
  /** Invalid explicit cells are retained for diagnosis; validate before using an override. */
  settings: Settings
  issues: SettingsIssue[]
  status: 'missing' | 'ok' | 'invalid'
}
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ decisionToast: true, defaultMode: 'MANUAL', effortCap: 'xhigh', jevTimeoutMs: 3000 })
