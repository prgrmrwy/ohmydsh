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
  /** Open id: `ou_` + 32 hex. */
  senderOpenId: 'ou_00000000000000000000000000000001',
  /** The Pet bot's own open id, which must never be treated as a sender. */
  botOpenId: 'ou_00000000000000000000000000000002',
} as const

/**
 * A group-level mention, the shape that opens a group locus.
 * Structural fact: no `thread_id`, and `parent_id`/`root_id` are absent.
 */
export const REAL_GROUP_MENTION = {
  message_id: REAL_ID_SHAPES.messageId,
  chat_id: REAL_ID_SHAPES.groupChatId,
  chat_type: 'group',
  message_type: 'text',
  sender_open_id: REAL_ID_SHAPES.senderOpenId,
  mentions: [{ key: '@_user_1', id: { open_id: REAL_ID_SHAPES.botOpenId } }],
  content: '{"text":"@_user_1 <redacted>"}',
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
