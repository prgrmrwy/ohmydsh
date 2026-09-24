/**
 * Copy dictionaries for the guard's composer-block reason and settings page.
 *
 * One namespace with zh/en, following the dsh-system-clock locale pattern:
 * the key union is the type-level source of truth, `en` is the reference set,
 * and `zh` is type-checked to the same key set so they can never drift apart.
 *
 * @module dsh-home-network-model-guard/client/locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'homeNetworkModelGuard'

/** Keys of the guard copy (this plugin's whole dictionary). */
export type GuardKey =
  | 'homeNetworkClaudeBlocked'
  | 'settingsNav'
  | 'statusTitle'
  | 'verdict'
  | 'source'
  | 'country'
  | 'degraded'
  | 'configTitle'
  | 'blockedLabel'
  | 'endpointsLabel'
  | 'save'
  | 'saved'
  | 'saveFailed'
  | 'refresh'

/** English strings (reference key set). */
export const en: Record<GuardKey, string> = {
  homeNetworkClaudeBlocked: 'Sending is disabled: egress country is restricted',
  settingsNav: 'Egress Guard',
  statusTitle: 'Current verdict',
  verdict: 'Verdict',
  source: 'Source',
  country: 'Country',
  degraded: 'Degraded',
  configTitle: 'Configuration',
  blockedLabel: 'Blocked countries (ISO alpha-2, comma-separated)',
  endpointsLabel: 'Geo endpoints (primary, fallback)',
  save: 'Save & apply',
  saved: 'Saved; verdict will refresh automatically',
  saveFailed: 'Save failed:',
  refresh: 'Refresh',
}

/** Chinese strings, type-checked against the same key set. */
export const zh: Record<GuardKey, string> = {
  homeNetworkClaudeBlocked: '当前出口位于受限地区，已禁用 Claude 发送',
  settingsNav: '出口守卫',
  statusTitle: '当前判定',
  verdict: '判定',
  source: '来源',
  country: '国家/地区',
  degraded: '降级',
  configTitle: '配置',
  blockedLabel: '阻断国家/地区（ISO alpha-2，逗号分隔）',
  endpointsLabel: 'Geo 端点（主，备）',
  save: '保存并应用',
  saved: '已保存；判定将自动刷新',
  saveFailed: '保存失败：',
  refresh: '刷新',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The guard composer-block reason copy. */
    [NS]: GuardKey
  }
}