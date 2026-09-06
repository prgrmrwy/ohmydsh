/**
 * Inbound Lark event parsing and the admission gauntlet.
 *
 * Everything here is a pure decision over one already-received event: parse,
 * then decide whether it may raise work. The gauntlet is deliberately
 * fail-closed and SILENT — an event that does not pass leaves no trace in the
 * conversation, so a bot sitting in an unrelated group never reveals that an
 * agent stands behind it.
 */

/** One inbound message as emitted by `lark-cli event consume`. */
export interface LarkInboundEvent {
  readonly type: string
  /** Recommended idempotency key; `event_id` explicitly is NOT one. */
  readonly message_id: string
  readonly chat_id: string
  readonly chat_type: 'p2p' | 'group'
  readonly message_type: string
  /** Pre-rendered human-readable text for ordinary message types. */
  readonly content?: string
  readonly create_time?: string
  readonly sender_id?: string
  readonly sender_type?: string
  readonly root_id?: string
  readonly reply_to?: string
  readonly thread_id?: string
  readonly mentions?: readonly { id?: string; key?: string; name?: string }[]
}

/**
 * Parse one NDJSON line into an inbound event.
 *
 * Returns `undefined` for anything that is not a usable message event rather
 * than throwing: the stream also carries other shapes, and one unexpected line
 * must not take the subscription down.
 * @param line - A single NDJSON line from the consumer.
 * @returns the parsed event, or `undefined` when the line is not one.
 */
export function parseInboundLine(line: string): LarkInboundEvent | undefined {
  const trimmed = line.trim()
  if (trimmed === '' || !trimmed.startsWith('{')) return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['type'] !== 'im.message.receive_v1') return undefined
  const messageId = record['message_id']
  const chatId = record['chat_id']
  const chatType = record['chat_type']
  if (typeof messageId !== 'string' || messageId === '') return undefined
  if (typeof chatId !== 'string' || chatId === '') return undefined
  if (chatType !== 'p2p' && chatType !== 'group') return undefined
  return record as unknown as LarkInboundEvent
}

/** Why an event was refused, for diagnostics only. */
export type AdmissionRefusal =
  | 'not-a-message'
  | 'bot-sender'
  | 'not-allowed-sender'
  | 'no-mention'
  | 'duplicate'
  | 'before-watermark'
  | 'unsupported-message-type'
  | 'empty-content'

/** Outcome of the admission gauntlet. */
export type AdmissionDecision =
  | { readonly admit: true; readonly text: string }
  | { readonly admit: false; readonly reason: AdmissionRefusal }

/** Everything the gauntlet needs to judge one event. */
export interface AdmissionContext {
  /** Resolved open_ids permitted to trigger work. */
  readonly allowOpenIds: readonly string[]
  /** The bound bot's own open_id; required for group mention filtering. */
  readonly botOpenId?: string
  /** Milliseconds; messages created before this are replays. */
  readonly watermark: number
  /** Whether this message id was already seen inside the dedup window. */
  readonly isDuplicate: (messageId: string) => boolean
}

/** Message types Pet can act on. Others are refused rather than guessed at. */
const SUPPORTED_MESSAGE_TYPES = new Set(['text', 'post'])

/**
 * Decide whether one event may raise work.
 *
 * Order is deliberate: identity before content, and cheap local checks before
 * anything else. Every refusal is silent by contract — the caller logs and
 * drops, and MUST NOT react, reply or otherwise disclose the bot's backing
 * agent to a conversation that was not authorised to reach it.
 * @param event - The parsed inbound event.
 * @param context - Configuration and the replay/dedup probes.
 * @returns admission with the extracted text, or a refusal reason.
 */
export function admitInboundEvent(
  event: LarkInboundEvent,
  context: AdmissionContext,
): AdmissionDecision {
  if (event.type !== 'im.message.receive_v1') return { admit: false, reason: 'not-a-message' }

  // Never answer another bot. Two bots in one group could otherwise volley
  // messages at each other indefinitely, each one triggering the other.
  if (event.sender_type !== undefined && event.sender_type !== 'user') {
    return { admit: false, reason: 'bot-sender' }
  }

  // Identity gate. An empty allowlist admits NOBODY: an unconfigured channel
  // must not be an open one.
  const sender = event.sender_id ?? ''
  if (sender === '' || !context.allowOpenIds.includes(sender)) {
    return { admit: false, reason: 'not-allowed-sender' }
  }

  // Group messages must mention this bot specifically. Without the bot's own
  // open_id the filter cannot be evaluated, so it fails closed rather than
  // treating every mention as ours — a real group carries mentions of other
  // bots and people constantly.
  if (event.chat_type === 'group') {
    const botOpenId = context.botOpenId
    if (botOpenId === undefined || botOpenId === '') return { admit: false, reason: 'no-mention' }
    const mentioned = (event.mentions ?? []).some(mention => mention.id === botOpenId)
    if (!mentioned) return { admit: false, reason: 'no-mention' }
  }

  // Replay defences. Lark redelivers unacknowledged events after a reconnect,
  // and a restarted consumer may see messages from before it started.
  if (context.isDuplicate(event.message_id)) return { admit: false, reason: 'duplicate' }
  const createdAt = Number(event.create_time ?? '0')
  if (Number.isFinite(createdAt) && createdAt > 0 && createdAt < context.watermark) {
    return { admit: false, reason: 'before-watermark' }
  }

  if (!SUPPORTED_MESSAGE_TYPES.has(event.message_type)) {
    return { admit: false, reason: 'unsupported-message-type' }
  }
  const text = (event.content ?? '').trim()
  if (text === '') return { admit: false, reason: 'empty-content' }

  return { admit: true, text }
}

/**
 * Bounded message-id dedup with a sliding time window.
 *
 * Keyed on `message_id` rather than `event_id`: the event schema states
 * outright that the delivery id is not a deduplication key, because one
 * message can be delivered under several of them.
 */
export class MessageDedup {
  private readonly seen = new Map<string, number>()

  /**
   * @param windowMs - How long a message id stays remembered.
   */
  constructor(private readonly windowMs = 60_000) {}

  /**
   * Record a message id and report whether it was already known.
   * @param messageId - Lark message id.
   * @param now - Current time in milliseconds.
   * @returns whether the id was seen inside the window.
   */
  check(messageId: string, now = Date.now()): boolean {
    for (const [key, at] of this.seen) {
      if (now - at > this.windowMs) this.seen.delete(key)
    }
    if (this.seen.has(messageId)) return true
    this.seen.set(messageId, now)
    return false
  }
}
