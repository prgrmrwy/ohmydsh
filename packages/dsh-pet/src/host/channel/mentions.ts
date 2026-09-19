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
 * A member open id is also accepted, for the case where the agent was handed an
 * `ou_…` and no display name (the unified locus delivery prompt reports the
 * sender that way). Rendering it resolves the same person instead of publishing
 * the identifier as plain text, which notifies nobody. An id that is not a
 * member of this chat is still left as written.
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

/** A raw member open id an agent copied instead of writing a display name. */
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9_-]+/

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
 * Build the open-id to display-name index.
 *
 * Open ids identify one member each, so there is no ambiguity to guard here; a
 * member whose open id or name is unusable is simply absent.
 */
function membersByOpenId(members: readonly MentionMember[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const member of members) {
    const openId = typeof member?.openId === 'string' ? member.openId.trim() : ''
    const name = typeof member?.name === 'string' ? member.name.trim() : ''
    if (openId === '' || name === '' || name.includes('@') || name.includes('<')) continue
    if (!index.has(openId)) index.set(openId, name)
  }
  return index
}

/** One resolved reference: the member it addresses and how much text it spans. */
interface ResolvedReference {
  readonly openId: string
  readonly name: string
  readonly length: number
}

/**
 * Resolve the reference starting at one `@`.
 *
 * A display name is tried first, because that is what the delivery prompt asks
 * the agent to write. A raw open id is the fallback for an agent that was handed
 * an `ou_…` and no name; it resolves only when the id belongs to this chat.
 *
 * @param rest - Text after the `@`, bounded to the maximum name length.
 * @param text - The whole reply body, for the reference-end check.
 * @param at - Index of the `@` in `text`.
 * @param names - Unique display names, longest first.
 * @param byName - Display-name to open-id index.
 * @param byOpenId - Open-id to display-name index.
 * @returns the resolved reference, or undefined to keep the text as written.
 */
function resolveReference(
  rest: string,
  text: string,
  at: number,
  names: readonly string[],
  byName: ReadonlyMap<string, string>,
  byOpenId: ReadonlyMap<string, string>,
): ResolvedReference | undefined {
  const named = names.find(name => rest.startsWith(name) && isReferenceEnd(text, at + 1 + name.length))
  if (named !== undefined) {
    const openId = byName.get(named)
    if (openId !== undefined) return { openId, name: named, length: named.length }
  }
  const raw = OPEN_ID_PATTERN.exec(rest)?.[0]
  if (raw === undefined || !isReferenceEnd(text, at + 1 + raw.length)) return undefined
  const name = byOpenId.get(raw)
  return name === undefined ? undefined : { openId: raw, name, length: raw.length }
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
  const byOpenId = membersByOpenId(members)
  if (index.size === 0 && byOpenId.size === 0) return { text, rendered: 0, skipped: 'no-members' }

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
    const resolved = resolveReference(rest, text, at, names, index, byOpenId)
    if (resolved === undefined || rendered >= MAX_RENDERED) {
      output += text.slice(cursor, at + 1)
      cursor = at + 1
      continue
    }
    output += text.slice(cursor, at)
    output += `<at user_id="${resolved.openId}">${resolved.name}</at>`
    cursor = at + 1 + resolved.length
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
