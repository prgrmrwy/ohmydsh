/**
 * Recognising `/bind` in an inbound message.
 *
 * This is the only slash command Pet accepts, and it is deliberately narrow:
 * an explicit verb, recognised only in groups that have no QA binding yet.
 * Once a group is bound, the same text is just conversation again — otherwise
 * someone discussing a session id in a working QA group would keep tripping
 * a command that cannot apply anyway.
 *
 * Recognition happens AFTER the existing admission gauntlet, never instead of
 * it: mention, dedup, watermark and message type all still decide first. The
 * command is not a bypass, it is a destination.
 */

/** The command verbs, matched at the start of the message body. */
const BIND_VERB = '/bind'
const UNBIND_VERB = '/unbind'

/** What one message turned out to be. */
export type CommandParse =
  | { readonly kind: 'bind'; readonly prefix: string }
  | { readonly kind: 'bind-missing-prefix' }
  | { readonly kind: 'unbind' }
  | { readonly kind: 'none' }

/**
 * Strip the leading mentions from a group message body.
 *
 * A group trigger never starts with the verb: the body arrives with the
 * mention still in it, so a naive `startsWith` never fires.
 *
 * The shape of that mention is NOT `@_user_N` in practice. Real inbound
 * bodies carry the DISPLAY NAME — `@小小芒果 /bind abc123` — and a placeholder
 * pattern silently matched nothing, which is exactly how `/bind` fell through
 * to workspace routing and created a session in the wrong place. So this
 * strips leading `@token` runs generically rather than guessing one encoding,
 * and only at the START: an `@` inside the argument is left alone.
 * @param text - Raw message text.
 * @returns the text with its leading mentions removed.
 */
function withoutMentions(text: string): string {
  // `@` followed by anything that is not whitespace, repeatedly, anchored at
  // the front. Covers `@_user_1`, `@显示名`, `@all` and any future spelling.
  return text.replace(/^(?:\s*@\S+)+/, '').replace(/\s+/g, ' ').trim()
}

/**
 * Parse one admitted message body as a possible command.
 *
 * @param text - The admitted message text.
 * @returns what it is; `none` for ordinary questions.
 */
export function parseCommand(text: string): CommandParse {
  const cleaned = withoutMentions(text)
  const lowered = cleaned.toLowerCase()

  // Checked BEFORE `/bind`, because `/unbind` starts with neither the same
  // letters nor a prefix relationship — but ordering it first keeps the
  // intent obvious to a reader and immune to a future rename that does
  // introduce one.
  if (lowered.startsWith(UNBIND_VERB)) {
    const rest = cleaned.slice(UNBIND_VERB.length)
    if (rest !== '' && !/^\s/.test(rest)) return { kind: 'none' }
    // Takes no argument: the group already knows what it is bound to, and
    // accepting one would invite "unbind someone else's group".
    return { kind: 'unbind' }
  }

  if (!lowered.startsWith(BIND_VERB)) return { kind: 'none' }

  const rest = cleaned.slice(BIND_VERB.length)
  // `/bindings are hard` is prose, not a command: the verb must be a whole
  // token. Requiring the boundary keeps ordinary sentences out.
  if (rest !== '' && !/^\s/.test(rest)) return { kind: 'none' }

  const prefix = rest.trim().split(/\s+/)[0] ?? ''
  if (prefix === '') return { kind: 'bind-missing-prefix' }
  return { kind: 'bind', prefix }
}
