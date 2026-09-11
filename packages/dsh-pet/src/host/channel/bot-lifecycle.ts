/**
 * Bot-membership lifecycle intake for unified locus initialization.
 *
 * lark-cli 1.0.94 catalog/schema evidence (2026-09-11):
 * EventKey `im.chat.member.bot.added_v1`, bot auth, scope
 * `im:chat.members:bot_access`, V2 envelope with jq root `.event` and fields
 * `header.event_id`, `event.chat_id`, `event.operator_id.open_id`.
 *
 * An operator id is authorization evidence only when it is a current global
 * allowlist member. Missing/unknown operator facts remain unverified and never
 * initialize or authorize a chat. First allowlist @ remains the fallback.
 */

export const BOT_ADDED_EVENT_KEY = 'im.chat.member.bot.added_v1'

export interface BotAddedEvent {
  readonly type: typeof BOT_ADDED_EVENT_KEY
  readonly eventId: string
  readonly chatId: string
  readonly operatorOpenId?: string
  readonly createdAt?: number
}

export interface BotLifecycleInitializer {
  /** Ensure only the chat-level structure. Must not create a Delivery or queue work. */
  ensureAuthorizedChat(input: {
    readonly chatId: string
    readonly eventId: string
    readonly operatorOpenId: string
  }): PromiseLike<void> | void
}

export type BotLifecycleOutcome =
  | { readonly kind: 'initialized'; readonly eventId: string }
  | { readonly kind: 'duplicate'; readonly eventId: string }
  | { readonly kind: 'unverified'; readonly eventId: string }
  | { readonly kind: 'invalid' }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Parse only the catalog-declared V2 bot-added shape; missing facts fail closed. */
export function parseBotAddedEvent(line: string): BotAddedEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!record(value) || value.schema !== '2.0' || !record(value.header) || !record(value.event)) {
    return undefined
  }
  const eventType = text(value.header.event_type)
  const eventId = text(value.header.event_id)
  const chatId = text(value.event.chat_id)
  if (eventType !== BOT_ADDED_EVENT_KEY || eventId === undefined || chatId === undefined) return undefined
  const operator = record(value.event.operator_id) ? text(value.event.operator_id.open_id) : undefined
  const rawTime = text(value.header.create_time)
  const parsedTime = rawTime === undefined ? undefined : Number(rawTime)
  return {
    type: BOT_ADDED_EVENT_KEY,
    eventId,
    chatId,
    ...(operator === undefined ? {} : { operatorOpenId: operator }),
    ...(parsedTime !== undefined && Number.isFinite(parsedTime) ? { createdAt: parsedTime } : {}),
  }
}

/**
 * Idempotent, authorization-first lifecycle handler.
 *
 * Duplicate ids are bounded in memory; durable idempotency comes from the
 * initializer's chat ensure/conditional commit, so replay after restart still
 * cannot create a second group main session or locus.
 */
export class BotLifecycleIntake {
  private readonly seen = new Set<string>()
  private readonly order: string[] = []

  constructor(private readonly options: {
    readonly allowOpenIds: () => readonly string[]
    readonly initializer: BotLifecycleInitializer
    readonly maxSeen?: number
  }) {}

  async handleLine(line: string): Promise<BotLifecycleOutcome> {
    const event = parseBotAddedEvent(line)
    if (event === undefined) return { kind: 'invalid' }
    if (this.seen.has(event.eventId)) return { kind: 'duplicate', eventId: event.eventId }
    this.remember(event.eventId)
    if (
      event.operatorOpenId === undefined ||
      !this.options.allowOpenIds().includes(event.operatorOpenId)
    ) {
      return { kind: 'unverified', eventId: event.eventId }
    }
    try {
      await this.options.initializer.ensureAuthorizedChat({
        chatId: event.chatId,
        eventId: event.eventId,
        operatorOpenId: event.operatorOpenId,
      })
    } catch (error) {
      // `seen` is an in-flight/idempotency fence, not a durable success claim.
      // A transient DSH/storage failure must remain retryable when Lark replays
      // the same event; the initializer's conditional commit handles a retry
      // whose first attempt actually committed before its response was lost.
      this.forget(event.eventId)
      throw error
    }
    return { kind: 'initialized', eventId: event.eventId }
  }

  private remember(eventId: string): void {
    this.seen.add(eventId)
    this.order.push(eventId)
    const max = this.options.maxSeen ?? 1_024
    while (this.order.length > max) {
      const oldest = this.order.shift()
      if (oldest !== undefined) this.seen.delete(oldest)
    }
  }

  private forget(eventId: string): void {
    this.seen.delete(eventId)
    const index = this.order.indexOf(eventId)
    if (index >= 0) this.order.splice(index, 1)
  }
}
