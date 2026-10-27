export const AUTO_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export type AutomaticEffort = typeof AUTO_EFFORTS[number]
export interface Settings {
  decisionService?: import('./decision-service.js').DecisionConfig
  decisionToast: boolean
  defaultMode: 'MANUAL' | 'AUTO'
  effortCap: AutomaticEffort
  jevTimeoutMs: number
}
export type SettingsPatch = Partial<Settings>
/** Retired mapping keys: read and reported, never applied, dropped on the next save. */
export const DEPRECATED_KEYS = ['childRoutes', 'mainEfforts', 'policy'] as const
export interface SettingsIssue { path: string; code: string; message: string }
export interface RoutingModel { provider: string; model: string; name: string; reasoningEfforts: readonly string[]; defaultEffort?: string }
export interface RoutingCatalog {
  models: readonly RoutingModel[]
  childAllowlist: {
    status: 'enabled' | 'disabled' | 'unavailable'
    allowedModels: readonly { provider: string; model: string }[]
  }
}
export interface SettingsRead {
  settings: Settings
  issues: SettingsIssue[]
  status: 'missing' | 'ok' | 'invalid'
  /** Retired keys present in the file, alphabetical. */
  deprecated: string[]
}
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ decisionToast: true, defaultMode: 'MANUAL', effortCap: 'xhigh', jevTimeoutMs: 5000 })
