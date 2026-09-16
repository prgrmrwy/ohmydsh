/**
 * Redacted samples of REAL Feishu events observed during the unified-locus
 * manual acceptance (2026-09-11 .. 2026-09-13).
 *
 * Why these exist: `docs/notes/dsh-plugin-integration-pitfalls.md` §4 records
 * that event structure must be MEASURED, never inferred — inferring it once
 * cost a whole release cycle. Hand-written placeholders such as `oc_project`
 * or `om_root` satisfy the prefix validators but do not reproduce the real
 * shapes, so a test built only on them can pass while the Host fails in
 * production.
 *
 * Redaction rule: every tenant-identifying hex body is replaced with a fixed
 * synthetic body of the SAME length and alphabet, and the structural parts —
 * prefix, length class, and the `om_x` message form — are preserved exactly.
 * No real chat, user, message or thread identifier survives here, and these
 * samples carry no message text, tenant key, token or app secret.
 *
 * @module
 */

/** Observed identifier shapes, with real lengths preserved. */
export const REAL_ID_SHAPES = {
  /** Group chat: `oc_` + 32 hex. */
  groupChatId: 'oc_00000000000000000000000000000001',
  /** A second group, used for cross-entry isolation assertions. */
  otherChatId: 'oc_00000000000000000000000000000002',
  /** Topic thread: `omt_` + 16 hex. Distinctly SHORTER than a chat id. */
  threadId: 'omt_0000000000000001',
  /**
   * Message id. The real form carries an `x` after the prefix
   * (`om_x100b6551c38a98a0`) — placeholders like `om_root` never exercise it.
   */
  messageId: 'om_x000000000000001',
  /** A second message in the same thread, for FIFO ordering assertions. */
  nextMessageId: 'om_x000000000000002',
  /** A third message id: the one a timeline quote points at. */
  quotedMessageId: 'om_x000000000000003',
  /** A fourth message id: a reply posted inside a topic. */
  topicReplyMessageId: 'om_x000000000000004',
  /** Open id: `ou_` + 32 hex. */
  senderOpenId: 'ou_00000000000000000000000000000001',
  /** The Pet bot's own open id, which must never be treated as a sender. */
  botOpenId: 'ou_00000000000000000000000000000002',
} as const

/**
 * A group-level mention, the shape that opens a group locus.
 * Structural fact: no `thread_id`, and `parent_id`/`root_id` are absent.
 *
 * Field names follow the CONSUMER contract, not the raw OAPI payload:
 * `lark-cli` flattens the V2 envelope for this key, so facts sit at the top
 * level, the sender is `sender_id` (open_id only, no name), `mentions[].id` is
 * the open_id STRING, and `.content` is PRE-RENDERED text for `text`/`post`
 * (mentions already resolved to display names) rather than the raw JSON body.
 * A fixture written from the raw payload passes prefix validators while
 * describing an event the consumer never emits.
 */
export const REAL_GROUP_MENTION = {
  type: 'im.message.receive_v1',
  message_id: REAL_ID_SHAPES.messageId,
  chat_id: REAL_ID_SHAPES.groupChatId,
  chat_type: 'group',
  message_type: 'text',
  sender_id: REAL_ID_SHAPES.senderOpenId,
  sender_type: 'user',
  mentions: [{ key: '@_user_1', name: '<redacted>', id: REAL_ID_SHAPES.botOpenId }],
  content: '@<redacted bot name> <redacted>',
} as const

/**
 * A topic-level mention. Structural fact confirmed in acceptance: a real topic
 * message carries a NON-EMPTY `thread_id`, and that id — not `root_id` or
 * `parent_id` — is the stable entry identity. T3-C1 verified this against live
 * events.
 */
export const REAL_TOPIC_MENTION = {
  ...REAL_GROUP_MENTION,
  message_id: REAL_ID_SHAPES.nextMessageId,
  thread_id: REAL_ID_SHAPES.threadId,
} as const

/**
 * A QUOTE/REPLY on a regular group's timeline — the shape measured on
 * 2026-09-16 (see `docs/notes/dsh-plugin-integration-pitfalls.md`).
 *
 * Structural facts, all measured on the live tenant:
 * - the group is `chat_mode: group` (NOT a topic group);
 * - quoting a message sets BOTH `root_id` and `parent_id` to the quoted
 *   message id and sets NO `thread_id`;
 * - messages inside a topic DO carry `thread_id` (see REAL_TOPIC_MENTION), and
 *   the tenant's own thread listing showed the quoted message is not in that
 *   topic — it is a chat-timeline message that happens to reference another.
 *
 * The consumer's `reply_to` is the platform's direct parent (`parent_id`); the
 * two are equal here because this message replies straight to the quoted one.
 * `REAL_CHAINED_GROUP_REPLY` is the other measured variant — a reply to the
 * second message of a reply chain, where `root_id` is the chain root and
 * `reply_to` the direct parent (different ids, still no `thread_id`).
 */
export const REAL_QUOTED_GROUP_MENTION = {
  ...REAL_GROUP_MENTION,
  message_id: REAL_ID_SHAPES.nextMessageId,
  root_id: REAL_ID_SHAPES.quotedMessageId,
  reply_to: REAL_ID_SHAPES.quotedMessageId,
} as const

/** A reply deeper in a chat-timeline reply chain: root and parent differ. */
export const REAL_CHAINED_GROUP_REPLY = {
  ...REAL_GROUP_MENTION,
  message_id: REAL_ID_SHAPES.nextMessageId,
  root_id: REAL_ID_SHAPES.quotedMessageId,
  reply_to: REAL_ID_SHAPES.messageId,
} as const

/**
 * The same quote carrying an unusable reply id (leading space).
 *
 * The consumer normalizes transport strings, so this is a MALFORMED-event
 * sample rather than an observed one: it pins the rule that a corrupted
 * OPTIONAL context fact must not be able to drop an otherwise valid request.
 */
export const REAL_QUOTED_GROUP_MENTION_WITH_BAD_REPLY = {
  ...REAL_QUOTED_GROUP_MENTION,
  reply_to: ` ${REAL_ID_SHAPES.quotedMessageId}`,
} as const

/**
 * A reply INSIDE a topic, the counterpart that must stay on the topic entry.
 *
 * Measured via the Delivery the Host durably recorded for such a message: the
 * event carried both `thread_id` (the topic) and `root_id` (that topic's root
 * message), which is exactly why `thread_id` — not `root_id` — decides the
 * entry, and why `root_id` may be recorded as the topic's root message here.
 * `reply_to` equals the root because this is the topic's first reply (the
 * tenant's thread listing shows it at `thread_position: 0`).
 */
export const REAL_TOPIC_REPLY_MENTION = {
  ...REAL_TOPIC_MENTION,
  message_id: REAL_ID_SHAPES.topicReplyMessageId,
  root_id: REAL_ID_SHAPES.messageId,
  reply_to: REAL_ID_SHAPES.messageId,
} as const

/**
 * Bot added to a chat, in the real V2 envelope.
 *
 * Structural facts that a flat hand-written object does NOT capture, and which
 * the parser enforces: the payload is a `schema: '2.0'` envelope whose facts
 * live under `header` (event_type, event_id, create_time) and `event`
 * (chat_id, operator_id) — not at the top level. The consumer receives it as a
 * JSONL LINE, so the parser takes a string, not an object.
 *
 * Only `im.chat.member.bot.added_v1` is subscribed; there is deliberately no
 * removal counterpart yet (tracked as B029), so a removal sample is absent
 * rather than invented.
 */
export const REAL_BOT_ADDED_ENVELOPE = {
  schema: '2.0',
  header: {
    event_type: 'im.chat.member.bot.added_v1',
    event_id: '00000000000000000000000000000001',
    create_time: '1789000000000',
    token: '<redacted>',
    app_id: 'cli_00000000000000',
    tenant_key: '<redacted>',
  },
  event: {
    chat_id: REAL_ID_SHAPES.groupChatId,
    operator_id: { open_id: REAL_ID_SHAPES.senderOpenId },
  },
} as const

/** The same event as the consumer actually receives it: one JSONL line. */
export const REAL_BOT_ADDED_LINE = JSON.stringify(REAL_BOT_ADDED_ENVELOPE)
