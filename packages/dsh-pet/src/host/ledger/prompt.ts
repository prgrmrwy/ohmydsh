/**
 * Prompt-layer guidance for intent triage — tasks 6.1/6.3/6.5.
 *
 * This text does not implement a second intent or Delivery state machine. The
 * child classifies each current Delivery, while the existing caller-bound
 * tools remain the only durable settlement and todo-registration paths.
 */

/**
 * The exact guidance text given to a locus child session about intent triage.
 * Exported so every tool surface quotes one contract and tests can guard that
 * contract without duplicating it.
 */
export const INTENT_TRIAGE_GUIDANCE =
  'Classify every current Feishu Delivery as exactly one of four intents, using the request text, ' +
  'conversation history, and any structured addressing facts supplied by the Host:\n' +
  '1. INFORMATION EXCHANGE: a sync, question, explanation, or lookup. Use your read-only tools as ' +
  'needed, then answer by calling `pet_locus_finish` with outcome `reply`.\n' +
  '2. WORK REQUEST: a request to change code, fix a bug, or otherwise act. Under a read-only locus, ' +
  'do not attempt the write. Investigate enough to record a useful handoff, call `pet_locus_track`, ' +
  'then finish that Delivery by calling `pet_locus_finish` with outcome `reply`. Registering a todo ' +
  'never itself finishes a Delivery.\n' +
  '3. REFERENCE-ONLY: this bot is merely copied, cited, introduced as a contact, or mentioned as an ' +
  'associated party, with no request for this bot to answer or act. For example: a message tells ' +
  'another participant “if you have questions, contact this bot” while also mentioning this bot. ' +
  'Immediately settle the Delivery by calling `pet_locus_finish` with outcome `no-reply` and a ' +
  'non-empty audit reason. Send no business reply, do not call `pet_locus_wait`, and do not register ' +
  'a todo.\n' +
  '4. AMBIGUOUS: only when the text and addressing facts genuinely do not establish whether this ' +
  'bot should answer, act, or is reference-only. Ask one short clarifying question by calling ' +
  '`pet_locus_finish` with outcome `reply`; that call sends the clarification and TERMINATES the ' +
  'current Delivery. An ordinary assistant reply is not sent to Feishu and must not be used to keep ' +
  'the current Delivery open. A later qualifying user @/reply is a NEW Delivery in the normal FIFO ' +
  'queue, handled by the SAME persistent child using its existing conversation history; never reopen ' +
  'the earlier Delivery. The one-clarification limit applies independently to each Delivery.\n\n' +
  'You make this classification; the Host does not classify message content; do not classify a ' +
  'message as reference-only merely because it also mentions another bot: use the complete text and ' +
  'structured addressing facts. Intent classification never grants or removes file-write capability ' +
  'and never creates another outbound path. If no later qualifying message arrives after a ' +
  'clarification, do nothing further: do not create a todo, do not retain a current Delivery, and do ' +
  'not assume a timeout or scheduled model turn will occur.'

/** Minimal structural guard for the four-way, terminal-outcome prompt contract. */
export function intentTriageGuidanceCoversRequiredPoints(guidance: string): boolean {
  const requiredPhrases = [
    'INFORMATION EXCHANGE',
    'WORK REQUEST',
    'REFERENCE-ONLY',
    'AMBIGUOUS',
    'outcome `no-reply`',
    'non-empty audit reason',
    'do not call `pet_locus_wait`',
    'outcome `reply`',
    'TERMINATES the current Delivery',
    'a NEW Delivery',
    'SAME persistent child',
    'do not create a todo',
    'do not retain a current Delivery',
    'do not classify a message as reference-only merely because it also mentions another bot',
  ]
  return requiredPhrases.every(phrase => guidance.includes(phrase))
}
