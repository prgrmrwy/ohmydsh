/** Bounded Host projection of structured inbound mention facts. */

export const MAX_ADDRESSING_OCCURRENCES = 32
const MAX_DISPLAY_NAME_LENGTH = 128
const MAX_STABLE_ID_LENGTH = 256

export type AddressingOccurrenceKind = 'self-bot' | 'other-bot' | 'human' | 'unknown'

/**
 * Stable identifiers are retained only for Host audit/revalidation. Prompt
 * rendering deliberately projects only `kind` and `displayName`.
 */
export interface AddressingOccurrence {
  readonly kind: AddressingOccurrenceKind
  readonly displayName: string
  readonly stableId?: string
  readonly mentionKey?: string
}

export interface DeliveryAddressingProjection {
  /** `unknown` also represents historical rows which predate this field. */
  readonly status: 'known' | 'unknown'
  readonly occurrences: readonly AddressingOccurrence[]
  readonly selfMentioned: boolean
  readonly otherBotCount: number
  /** False when the transport could not prove occurrence ordering. */
  readonly orderKnown: boolean
}

export interface AddressingMentionInput {
  readonly id?: string
  readonly key?: string
  readonly name?: string
}

export interface AddressingBotInput {
  readonly openId: string
}

function bounded(value: string | undefined, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized === '') return undefined
  return normalized.slice(0, maximum)
}

/**
 * Classify ordered event mentions using a complete, successfully-read chat bot
 * membership snapshot. When that snapshot is unavailable, only the known self
 * id can be classified; every other occurrence remains unknown.
 */
export function projectDeliveryAddressing(input: {
  readonly mentions: readonly AddressingMentionInput[]
  readonly selfOpenId?: string
  readonly chatBots?: readonly AddressingBotInput[]
  readonly orderKnown?: boolean
}): DeliveryAddressingProjection {
  const selfOpenId = bounded(input.selfOpenId, MAX_STABLE_ID_LENGTH)
  const botIds = input.chatBots === undefined
    ? undefined
    : new Set(input.chatBots.map(bot => bounded(bot.openId, MAX_STABLE_ID_LENGTH)).filter((id): id is string => id !== undefined))
  const occurrences = input.mentions.slice(0, MAX_ADDRESSING_OCCURRENCES).map(mention => {
    const stableId = bounded(mention.id, MAX_STABLE_ID_LENGTH)
    const mentionKey = bounded(mention.key, MAX_STABLE_ID_LENGTH)
    const displayName = bounded(mention.name, MAX_DISPLAY_NAME_LENGTH) ?? ''
    const kind: AddressingOccurrenceKind = stableId !== undefined && selfOpenId !== undefined && stableId === selfOpenId
      ? 'self-bot'
      : stableId === undefined || botIds === undefined
        ? 'unknown'
        : botIds.has(stableId)
          ? 'other-bot'
          : 'human'
    return Object.freeze({
      kind,
      displayName,
      ...(stableId === undefined ? {} : { stableId }),
      ...(mentionKey === undefined ? {} : { mentionKey }),
    })
  })
  return Object.freeze({
    status: input.chatBots === undefined ? 'unknown' : 'known',
    occurrences: Object.freeze(occurrences),
    selfMentioned: occurrences.some(occurrence => occurrence.kind === 'self-bot'),
    otherBotCount: occurrences.filter(occurrence => occurrence.kind === 'other-bot').length,
    orderKnown: input.orderKnown !== false,
  })
}

/** Explicit compatibility projection for historical Delivery rows. */
export function historicalUnknownAddressing(): DeliveryAddressingProjection {
  return Object.freeze({
    status: 'unknown',
    occurrences: Object.freeze([]),
    selfMentioned: false,
    otherBotCount: 0,
    orderKnown: false,
  })
}
