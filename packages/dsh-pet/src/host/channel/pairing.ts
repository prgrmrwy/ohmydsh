/**
 * Ephemeral single-chat pairing for the Lark sender allowlist.
 *
 * The one-time code is a bearer capability. It lives only in this Host object:
 * no repository schema can persist it, and public terminal states never carry
 * it. Pairing consumes control-plane `/pair` attempts before the ordinary
 * channel pipeline so a wrong or group-scoped attempt can never reach an Agent.
 */

import { randomBytes as secureRandomBytes } from 'node:crypto'
import { PET_OPEN_ID_PATTERN } from '../spec.js'
import type { PetRepository } from '../repository.js'
import type { PetPairingState } from '../../wire.js'
import type { LarkInboundEvent } from './event.js'
import type { LarkClient } from './lark.js'

export const PAIRING_CODE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'
const CODE_SYMBOLS = 8
export const PAIRING_TTL_MS = 5 * 60 * 1_000
const SUCCESS_TEXT = 'Pet 配对成功。你现在已加入允许触发的成员。'

interface PrivateAttempt {
  readonly generation: number
  readonly code: string
  phase: 'starting' | 'waiting' | 'claiming'
  activatedAt?: number
  expiresAt?: number
  timer?: ReturnType<typeof setTimeout>
}

export interface PairingControllerOptions {
  readonly repository: PetRepository
  readonly client: LarkClient
  readonly now?: () => number
  readonly randomBytes?: (size: number) => Uint8Array
  readonly schedule?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  readonly onChange?: () => void
  readonly onRunReasonChange?: () => void
  readonly log?: (reason: string) => void
}

/** Generate a uniform eight-symbol code rendered as `xxxx-xxxx`. */
export function generatePairingCode(
  bytes: Uint8Array = secureRandomBytes(CODE_SYMBOLS),
): string {
  if (bytes.length < CODE_SYMBOLS) throw new Error('Pairing random source returned too few bytes.')
  // The alphabet has exactly 32 symbols, so a five-bit mask is unbiased.
  const symbols = Array.from(bytes.slice(0, CODE_SYMBOLS), byte => PAIRING_CODE_ALPHABET[byte & 31]!)
  return `${symbols.slice(0, 4).join('')}-${symbols.slice(4).join('')}`
}

/** One Host's in-memory pairing state machine. */
export class PairingController {
  private generation = 0
  private attempt: PrivateAttempt | undefined
  private terminal: PetPairingState | undefined

  constructor(private readonly options: PairingControllerOptions) {}

  /** State safe for the authenticated Settings response. */
  get publicState(): PetPairingState | undefined {
    const current = this.attempt
    if (current?.phase === 'starting') return { phase: 'starting' }
    if (current?.phase === 'waiting' && current.expiresAt !== undefined) {
      return {
        phase: 'waiting',
        command: `/pair ${current.code}`,
        expiresAt: current.expiresAt,
      }
    }
    if (current?.phase === 'claiming' && current.expiresAt !== undefined) {
      return { phase: 'claiming', expiresAt: current.expiresAt }
    }
    return this.terminal
  }

  /** Whether pairing independently requires the shared event consumer. */
  get requiresConsumer(): boolean {
    return this.attempt !== undefined
  }

  /** Replace any prior attempt with a fresh, hidden-until-ready code. */
  start(): void {
    this.clearAttempt()
    this.generation += 1
    const random = this.options.randomBytes ?? secureRandomBytes
    this.attempt = {
      generation: this.generation,
      code: generatePairingCode(random(CODE_SYMBOLS)),
      phase: 'starting',
    }
    this.terminal = undefined
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
  }

  /** Publish the command only once the consumer is actually attached. */
  activate(): void {
    const current = this.attempt
    if (current === undefined || current.phase !== 'starting') return
    const now = this.now()
    const expiresAt = now + PAIRING_TTL_MS
    current.phase = 'waiting'
    current.activatedAt = now
    current.expiresAt = expiresAt
    const schedule = this.options.schedule ?? ((fn: () => void, delay: number) => setTimeout(fn, delay))
    current.timer = schedule(() => this.expire(current.generation), PAIRING_TTL_MS)
    current.timer.unref?.()
    this.options.onChange?.()
  }

  /**
   * Cancel a code that has not yet been claimed.
   *
   * Once `claiming`, the bearer was already consumed and a durable write is in
   * flight. Pretending cancellation succeeded there would create a hidden
   * authorization after the UI had reported cancellation, so callers must
   * refuse and wait for the terminal result instead.
   */
  cancel(): boolean {
    if (this.attempt?.phase === 'claiming') return false
    if (this.attempt === undefined && this.terminal === undefined) return true
    this.generation += 1
    this.clearAttempt()
    this.terminal = undefined
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
    return true
  }

  /**
   * Host teardown invalidates an unclaimed bearer. A claim already inside its
   * durable write remains observable until it settles; clearing it here could
   * hide an authorization that the storage backend still commits.
   */
  stop(): boolean {
    if (this.attempt?.phase === 'claiming') return false
    this.generation += 1
    this.clearAttempt()
    this.terminal = undefined
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
    return true
  }

  /** Fail a nonterminal attempt without exposing its code. */
  fail(diagnostic: string): boolean {
    if (this.attempt?.phase === 'claiming') return false
    if (this.attempt === undefined) return true
    this.generation += 1
    this.clearAttempt()
    this.terminal = { phase: 'failed', diagnostic }
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
    return true
  }

  /**
   * Consume a pairing command when one is active.
   *
   * Returns true for every `/pair`-shaped attempt while pairing is active,
   * including invalid ones, so none can fall through to an Agent.
   */
  async handle(event: LarkInboundEvent): Promise<boolean> {
    const text = (event.content ?? '').trim()
    if (!/^\/pair(?:\s|$)/iu.test(text)) return false
    // `/pair` is a reserved Host control command. Even with no active attempt
    // it must never fall through to the ordinary Agent pipeline.
    const current = this.attempt
    if (current === undefined) return true

    if (
      current.phase !== 'waiting' ||
      event.type !== 'im.message.receive_v1' ||
      event.sender_type !== 'user' ||
      event.chat_type !== 'p2p' ||
      event.message_type !== 'text' ||
      event.sender_id === undefined ||
      !PET_OPEN_ID_PATTERN.test(event.sender_id) ||
      text !== `/pair ${current.code}`
    ) return true

    const createdAt = Number(event.create_time)
    if (
      current.activatedAt === undefined ||
      current.expiresAt === undefined ||
      !Number.isFinite(createdAt) ||
      createdAt <= 0 ||
      createdAt < current.activatedAt
    ) return true
    if (this.now() >= current.expiresAt) {
      this.expire(current.generation)
      return true
    }

    // Synchronous compare-and-set before the first await: only one line wins.
    current.phase = 'claiming'
    const generation = current.generation
    const openId = event.sender_id
    this.options.onChange?.()

    const name = await this.resolveName(event.chat_id, event.message_id)
    if (!this.isClaiming(generation)) return true

    let committed = false
    try {
      await this.options.repository.updateChannelConfig(latest => {
        if (!this.isClaiming(generation)) return latest
        committed = true
        const allowOpenIds = latest.allowOpenIds.includes(openId)
          ? [...latest.allowOpenIds]
          : [...latest.allowOpenIds, openId]
        return {
          ...latest,
          allowOpenIds,
          ...(name === undefined
            ? {}
            : { knownNames: { ...(latest.knownNames ?? {}), [openId]: name } }),
          updatedAt: this.now(),
        }
      })
    } catch {
      if (this.isClaiming(generation)) this.failClaim(generation, '无法保存允许成员，请重新生成配对码。')
      return true
    }
    if (!committed || !this.isClaiming(generation)) return true

    this.finishSuccess(generation, openId, name)
    try {
      const reply = this.options.client.replyStrict ?? this.options.client.reply
      await reply.call(this.options.client, event.message_id, SUCCESS_TEXT)
    } catch {
      // Authorization is already durable; a receipt outage must not roll it back.
      this.options.log?.('pairing-reply-failed')
    }
    return true
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private isClaiming(generation: number): boolean {
    return this.attempt?.generation === generation && this.attempt.phase === 'claiming'
  }

  private async resolveName(chatId: string, messageId: string): Promise<string | undefined> {
    try {
      const messages = await this.options.client.listMessages(chatId, 10)
      const found = messages.find(message => message.messageId === messageId)?.senderName
      return found === undefined || found === '' || found === 'unknown' ? undefined : found
    } catch {
      return undefined
    }
  }

  private expire(generation: number): void {
    if (this.attempt?.generation !== generation || this.attempt.phase !== 'waiting') return
    this.generation += 1
    this.clearAttempt()
    this.terminal = { phase: 'expired' }
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
  }

  private finishSuccess(generation: number, openId: string, name?: string): void {
    if (!this.isClaiming(generation)) return
    this.clearAttempt()
    this.terminal = {
      phase: 'succeeded',
      openId,
      ...(name === undefined ? {} : { name }),
    }
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
  }

  private failClaim(generation: number, diagnostic: string): void {
    if (!this.isClaiming(generation)) return
    this.clearAttempt()
    this.terminal = { phase: 'failed', diagnostic }
    this.options.onRunReasonChange?.()
    this.options.onChange?.()
  }

  private clearAttempt(): void {
    if (this.attempt?.timer !== undefined) clearTimeout(this.attempt.timer)
    this.attempt = undefined
  }
}
