/**
 * Prompt-layer guidance for intent triage — tasks 6.3/6.4.
 *
 * These are NOT durable behaviors this module enforces; they are the exact
 * text a locus child session is told, matching how `tools.ts` documents
 * `pet_locus_finish`'s reply/no-reply contract inline in its tool
 * `description` rather than in a separate policy engine.
 *
 * Design finding (recorded here because it changes what "至多一次" means):
 * spec requires clarification to "使用当前 Delivery 的既有回复路径" — i.e. an
 * ORDINARY assistant reply that ends the turn WITHOUT calling
 * `pet_locus_finish`, after which the next matching `@` message continues the
 * SAME current Delivery (exactly the existing "决策往返" scenario already in
 * `pet-locus-collaboration`'s spec: "子会话询问方案 A/B，用户随后 at 回复
 * B，后续轮次在同一子会话继续"). Because the current Delivery's identity
 * never changes across that round-trip, "已澄清过" is something the SAME
 * conversation can already see in its own history — it needs NO new durable
 * flag on the Delivery or the locus. This is a prompt-enforced discipline,
 * not a Host-tracked state machine; the Host's only durable-state
 * responsibility here remains what it already has (queue advancement,
 * deadline, current-delivery identity) — none of that changes for this
 * change.
 */

/**
 * The exact guidance text given to a locus child session about intent
 * triage. Exported as a value (not inlined at every call site) so a single
 * change to the wording updates every tool/initialization surface that quotes
 * it, and so tests can assert on the guarantees it actually states rather
 * than re-deriving them from scattered literal strings.
 */
export const INTENT_TRIAGE_GUIDANCE =
  'Every current Feishu Delivery is either an INFORMATION EXCHANGE (a sync, a question, an ' +
  'explanation, a lookup) or a WORK REQUEST (asking you to change code, fix a bug, or otherwise ' +
  'act). You decide which, using ordinary judgment — the Host does not classify message content ' +
  'for you, and misjudging costs at most a follow-up message or an extra closeable todo; it never ' +
  'grants or removes file-write capability, which is governed entirely by the locus\'s independent ' +
  'read/write policy.\n\n' +
  'INFORMATION EXCHANGE: answer using your read-only tools, then finish with `pet_locus_finish` ' +
  '`reply`.\n\n' +
  'WORK REQUEST: you cannot write files under this locus\'s current policy. Do not attempt to. ' +
  'Investigate with your read-only tools until you have a clear location, cause, and suggested ' +
  'fix, then call `pet_locus_track` to register it as a durable todo for the owner to pick up. ' +
  'After registering, finish the SAME Delivery with `pet_locus_finish` `reply`, acknowledging that ' +
  'the request was received and recorded — registering a todo never itself finishes the Delivery.\n\n' +
  'AMBIGUOUS INTENT: if you genuinely cannot tell which of the two this is, ask the sender to ' +
  'clarify ONCE — an ordinary reply, ending your turn WITHOUT calling `pet_locus_finish` or ' +
  '`pet_locus_track`. The next matching message continues this SAME conversation and Delivery; do ' +
  'not ask a second clarifying question about the same request — check your own recent turns ' +
  'first. If the reply you get back is still not a clear answer, or none arrives before you must ' +
  'act, treat it as a WORK REQUEST and register a todo rather than silently treating it as ' +
  'information exchange — a todo the owner can close is always safer than a request that leaves no ' +
  'trace.'

/**
 * A minimal structural self-check a test (or a future prompt-assembly step)
 * can use to confirm the guidance text actually states the invariants this
 * change's spec requires, rather than trusting the prose was written
 * correctly once and never re-verified.
 */
export function intentTriageGuidanceCoversRequiredPoints(guidance: string): boolean {
  const requiredPhrases = [
    'pet_locus_finish',
    'pet_locus_track',
    'ONCE',
    'WITHOUT calling',
  ]
  return requiredPhrases.every(phrase => guidance.includes(phrase))
}
