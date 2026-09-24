/**
 * Resolving a source session from the prefix someone typed in a group chat.
 *
 * This is the only new input surface `/bind` opens, so it is deliberately
 * narrow: the prefix is used to LOOK UP a session and for nothing else, and
 * the two ways of failing are made indistinguishable.
 *
 * That last part is the point. If "no match" and "several matches" produced
 * different answers, the command would become an oracle: an attacker could
 * probe prefixes and learn which session ids exist without ever binding
 * anything. `/bind` is already limited to the allowlist, so the exposure is
 * small — but a distinction with no upside is not worth keeping, and the
 * caller has nothing to do with the count anyway (the remedy is the same
 * either way: give a longer prefix).
 */

import { shortIdOf } from '../workspace.js'

/**
 * Shortest accepted prefix.
 *
 * Matches the short id shown on the session badge in the UI, so a user can
 * read one off the screen and type it verbatim. Longer prefixes are accepted
 * — that is how a collision is resolved.
 */
export const MIN_PREFIX_LENGTH = 6

/** A session this resolver may bind to. */
export interface BindableSession {
  readonly id: string
  readonly title?: string
  /** Present when the session is a subagent child; such sessions are excluded. */
  readonly parentSession?: string
  /** True when the session is archived; archived sessions cannot be forked. */
  readonly archived?: boolean
}

/** Outcome of resolving one prefix. */
export type SessionResolution =
  | { readonly resolved: true; readonly session: BindableSession }
  /**
   * Not resolvable, for a reason the caller MUST NOT differentiate.
   *
   * `too-short` is safe to report precisely — it is a property of the input
   * the user just typed, not of the session store. `not-unique` covers both
   * "nothing matched" and "several matched", deliberately fused.
   */
  | { readonly resolved: false; readonly reason: 'too-short' | 'not-unique' }

/**
 * Normalize a session id for prefix comparison.
 *
 * Sessions are stored as `session-<uuid>`; the badge shows the first six
 * characters of the uuid. Comparing against the raw id would make a user's
 * on-screen prefix never match.
 * @param id - Session id.
 * @returns the comparable form.
 */
function comparableId(id: string): string {
  return id.replace(/^(task|session)-/, '').toLowerCase()
}

/**
 * Resolve a session from a user-typed prefix.
 *
 * @param prefix - The prefix as typed, case-insensitive.
 * @param sessions - Candidate sessions to search.
 * @returns the unique match, or an indistinguishable refusal.
 */
export function resolveSessionByPrefix(
  prefix: string,
  sessions: readonly BindableSession[],
): SessionResolution {
  const needle = prefix.trim().toLowerCase()
  if (needle.length < MIN_PREFIX_LENGTH) return { resolved: false, reason: 'too-short' }

  const matches = sessions.filter(session => {
    // Archived sessions cannot be forked, and a subagent child must not become
    // the source of another fork — binding a QA group to a QA child would
    // nest one answering context inside another.
    if (session.archived === true) return false
    if (session.parentSession !== undefined) return false
    return comparableId(session.id).startsWith(needle)
  })

  // Exactly one, or nothing the caller may distinguish. `matches.length` is
  // deliberately not reported.
  const only = matches.length === 1 ? matches[0] : undefined
  if (only === undefined) return { resolved: false, reason: 'not-unique' }
  return { resolved: true, session: only }
}

/**
 * The short id to display for a session, matching the UI badge.
 * @param id - Session id.
 * @returns the six-character short id.
 */
export function displayShortId(id: string): string {
  return shortIdOf(id)
}
