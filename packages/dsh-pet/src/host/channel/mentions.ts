/**
 * Render an agent's `@display-name` references into the platform's mention
 * markup, so a reply actually notifies the person.
 *
 * Why this exists at all: the two directions of the platform contract are NOT
 * symmetric. `lark-cli event consume` PRE-RENDERS inbound mentions to display
 * names (`@小小芒果 hi`), while an outbound `text` message only becomes a
 * mention when it carries `<at user_id="ou_…">name</at>`
 * (`lark-im` → `references/lark-im-messages-reply.md` §@Mention Format). An
 * agent that copies what it saw writes plain text: no notification, no
 * clickable name, and nothing in the delivery result says so.
 *
 * This module is deliberately PURE and conservative. It translates a reference
 * the agent already wrote; it never invents, looks up, or guesses an identity.
 * Anything it cannot resolve exactly — an ambiguous display name, a name that
 * is not a member, a `@` inside a word — is left exactly as written, because a
 * wrong mention notifies the wrong person, which is worse than no mention.
 *
 * @module
 */

/** One chat member the renderer may resolve a display name to. */
export interface MentionMember {
  /** Member open id (`ou_…`). Empty/invalid entries are ignored. */
  readonly openId: string
  /** Display name as the chat reports it. */
  readonly name: string
}

/** Outcome of one rendering pass, for low-cardinality diagnostics. */
export interface MentionRenderResult {
  readonly text: string
  /** How many references became real mentions. */
  readonly rendered: number
  /**
   * Why nothing was rendered, when that is worth a diagnostic. Absent when the
   * text simply had no candidate.
   */
  readonly skipped?: 'already-marked' | 'no-members' | 'no-unique-match'
}

/** Most references rendered in one message; the rest keep their original text. */
const MAX_RENDERED = 10

/** How many characters of context to look back/forward when matching a name. */
const MAX_NAME_LENGTH = 64

/**
 * Whether the character may sit directly before an `@` starting a reference.
 *
 * ASCII word characters are refused: they are what an email local part, an npm
 * scope (`@scope/pkg`), a rate (`@2x`) or a bare handle follows, and none of
 * those address a chat member. CJK text is allowed through, because writing
 * `问下@张勇` without a space is ordinary Chinese usage and cannot be confused
 * with an address of that shape.
 */
function isReferenceStart(text: string, at: number): boolean {
  if (at === 0) return true
  const before = text[at - 1] ?? ''
  return !/[A-Za-z0-9._%+-]/.test(before)
}

/** Whether the character may sit directly after a matched display name. */
function isReferenceEnd(text: string, end: number): boolean {
  if (end >= text.length) return true
  const after = text[end] ?? ''
  // A following letter/digit continues the name, so the shorter candidate was
  // not the name that was written (`@张三丰` must not match a member `张三`).
  return !/[\p{L}\p{N}]/u.test(after)
}

/**
 * Build the unique display-name to open-id index.
 *
 * A display name that maps to more than one member is recorded as ambiguous and
 * never rendered: guessing would notify an arbitrary one of them.
 */
function uniqueMembers(members: readonly MentionMember[]): Map<string, string> {
  const seen = new Map<string, string | undefined>()
  for (const member of members) {
    const openId = typeof member?.openId === 'string' ? member.openId.trim() : ''
    const name = typeof member?.name === 'string' ? member.name.trim() : ''
    if (openId === '' || name === '' || name.includes('@') || name.includes('<')) continue
    if (!seen.has(name)) {
      seen.set(name, openId)
      continue
    }
    // A second member with the same display name makes the name unusable.
    if (seen.get(name) !== openId) seen.set(name, undefined)
  }
  return new Map([...seen].filter((entry): entry is [string, string] => entry[1] !== undefined))
}

/**
 * Whether a text could contain a plain mention reference at all.
 *
 * Cheap pre-check so the caller does not read a chat's member list for the
 * common reply that addresses nobody.
 *
 * @param text - Reply body about to be sent.
 * @returns true when a scan is worth doing.
 */
export function hasMentionCandidate(text: string): boolean {
  if (text === '' || !text.includes('@')) return false
  // Agent-authored markup is trusted as-is; nothing to resolve.
  if (text.includes('<at ') || text.includes('<at>')) return false
  return true
}

/**
 * Rewrite whole-word `@display-name` references into mention markup.
 *
 * @param text - Reply body exactly as the agent wrote it.
 * @param members - Members of the chat the reply will be sent to.
 * @returns the body to send plus how many references were rendered.
 */
export function renderMentions(
  text: string,
  members: readonly MentionMember[],
): MentionRenderResult {
  if (text === '' || !text.includes('@')) return { text, rendered: 0 }
  if (text.includes('<at ') || text.includes('<at>')) {
    return { text, rendered: 0, skipped: 'already-marked' }
  }

  const index = uniqueMembers(members)
  if (index.size === 0) return { text, rendered: 0, skipped: 'no-members' }

  // Longest name first: when one member's name is a prefix of another's, the
  // longer match is the one that was actually written.
  const names = [...index.keys()].sort((left, right) => right.length - left.length)

  let output = ''
  let cursor = 0
  let rendered = 0
  let sawCandidate = false

  while (cursor < text.length) {
    const at = text.indexOf('@', cursor)
    if (at === -1) break
    if (!isReferenceStart(text, at)) {
      output += text.slice(cursor, at + 1)
      cursor = at + 1
      continue
    }
    sawCandidate = true
    const rest = text.slice(at + 1, at + 1 + MAX_NAME_LENGTH)
    const matched = names.find(name => rest.startsWith(name) && isReferenceEnd(text, at + 1 + name.length))
    if (matched === undefined || rendered >= MAX_RENDERED) {
      output += text.slice(cursor, at + 1)
      cursor = at + 1
      continue
    }
    output += text.slice(cursor, at)
    output += `<at user_id="${index.get(matched)!}">${matched}</at>`
    cursor = at + 1 + matched.length
    rendered += 1
  }

  if (rendered === 0) {
    return {
      text,
      rendered: 0,
      ...(sawCandidate ? { skipped: 'no-unique-match' as const } : {}),
    }
  }
  return { text: output + text.slice(cursor), rendered }
}
