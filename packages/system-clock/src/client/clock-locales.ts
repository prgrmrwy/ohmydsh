/**
 * Copy dictionaries for the System Clock settings section.
 *
 * One 'settings.systemClock' namespace with zh/en, following the
 * dsh-plugin-subscriptions locale pattern: the key union is the type-level
 * source of truth, `en` is the reference set, and `zh` is type-checked to the
 * same key set so they can never drift apart.
 *
 * @module dsh-system-clock/client/clock-locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'settings.systemClock'

/** Keys of the System Clock copy (the section's whole dictionary). */
export type SystemClockKey = 'nav' | 'caption' | 'unavailable' | 'unavailableDetail'

/** English strings (reference key set). */
export const en: Record<SystemClockKey, string> = {
  nav: 'System Clock',
  caption: 'DSH host',
  unavailable: 'Host clock unavailable',
  unavailableDetail: 'Could not read the DSH host time; retrying…',
}

/** Chinese strings, type-checked against the same key set. */
export const zh: Record<SystemClockKey, string> = {
  nav: '系统时钟',
  caption: 'DSH 主机',
  unavailable: '主机时钟不可用',
  unavailableDetail: '无法读取 DSH 主机时间，正在重试…',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The System Clock settings page copy. */
    [NS]: SystemClockKey
  }
}
