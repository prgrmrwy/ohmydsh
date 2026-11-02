/**
 * Copy dictionary for the plugin's user-facing feedback.
 *
 * One `sessionIdCopy` namespace with zh/en, following the
 * `dsh-plugin-subscriptions` / `dsh-system-clock` locale pattern: the key union
 * is the type-level source of truth, `en` is the reference set, and `zh` is
 * type-checked against the same key set so the two can never drift apart.
 *
 * The badge tooltip carries a raw session id and needs no translation.
 *
 * @module dsh-session-id-copy/client/locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'sessionIdCopy'

/** Keys of the plugin copy (the whole dictionary). */
export type SessionIdCopyKey = 'copied'

/** English strings (reference key set). */
export const en: Record<SessionIdCopyKey, string> = {
  copied: 'Session ID copied',
}

/** Simplified Chinese strings (same key set). */
export const zh: Record<SessionIdCopyKey, string> = {
  copied: '会话 ID 已复制',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The session-id copy feedback strings. */
    [NS]: SessionIdCopyKey
  }
}
