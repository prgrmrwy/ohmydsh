/**
 * Copy dictionaries for the guard's composer-block reason.
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
export type GuardKey = 'homeNetworkClaudeBlocked'

/** English strings (reference key set). */
export const en: Record<GuardKey, string> = {
  homeNetworkClaudeBlocked: 'Sending is disabled: egress country is restricted',
}

/** Chinese strings, type-checked against the same key set. */
export const zh: Record<GuardKey, string> = {
  homeNetworkClaudeBlocked: '当前出口位于受限地区，已禁用 Claude 发送',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The guard composer-block reason copy. */
    [NS]: GuardKey
  }
}