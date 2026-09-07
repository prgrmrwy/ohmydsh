/**
 * The inbound pipeline: one Lark event to one Invocation.
 *
 * This is the join between the pure decisions (parse, admit, route, render)
 * and Pet's durable model. It stays deliberately linear — every stage may
 * refuse, and a refusal always ends the event quietly rather than partially
 * applying it.
 */

import { randomUUID } from 'node:crypto'
import { captureChatContext, renderChannelPrompt } from './context.js'
import {
  admitInboundEvent,
  MessageDedup,
  parseInboundLine,
  type AdmissionRefusal,
  type LarkInboundEvent,
} from './event.js'
import { markInProgress } from './feedback.js'
import type { LarkClient } from './lark.js'
import { routeChat, type WorkspaceLocator } from './route.js'
import type { PetCoordinator } from '../coordinator.js'
import type { PetRepository } from '../repository.js'
import type { PetChannelConfig, PetChatBinding } from '../spec.js'
import { scopeKeyOf } from '../../wire.js'

/** What happened to one inbound line. */
export type IntakeOutcome =
  | {
      readonly kind: 'ignored'
      readonly reason: AdmissionRefusal | 'unparsable' | 'disabled' | string
    }
  | { readonly kind: 'unroutable'; readonly reason: string }
  | { readonly kind: 'accepted'; readonly invocationId: string; readonly taskId?: string }
  | { readonly kind: 'answered'; readonly taskId: string }
  | { readonly kind: 'error'; readonly reason: string }

/** Delivers a QA group's messages into its fork child. */
export interface QaDeliveryPort {
  /**
   * @param event - The admitted event.
   * @param text - Admitted message text.
   * @param binding - The qa binding this chat routed to.
   * @returns what happened, in the pipeline's vocabulary.
   */
  deliver(
    event: LarkInboundEvent,
    text: string,
    binding: PetChatBinding,
  ): Promise<IntakeOutcome>
}

/** Everything the pipeline needs from its Host. */
export interface PipelineDeps {
  readonly repository: PetRepository
  readonly coordinator: PetCoordinator
  readonly client: LarkClient
  readonly locator: WorkspaceLocator
  /** Replay watermark: messages older than this are redeliveries. */
  readonly watermark: () => number
  /**
   * QA delivery, when this Host composed it.
   *
   * Absent on a Host without the subagent seam. A qa binding then refuses
   * rather than falling through to workspace dispatch: that would run a
   * group's question in a fresh executor with none of the inherited context
   * the group exists for.
   */
  readonly qaDelivery?: QaDeliveryPort
  /** Reports an outcome for diagnostics. */
  readonly onOutcome?: (outcome: IntakeOutcome, event?: LarkInboundEvent) => void
}

/**
 * Consumes inbound lines and turns the admissible ones into work.
 *
 * Holds the dedup window, which is why it is an object rather than a function:
 * the window must survive across events.
 */
export class InboundPipeline {
  private readonly dedup = new MessageDedup()

  /**
   * @param deps - Host collaborators.
   */
  constructor(private readonly deps: PipelineDeps) {}

  /**
   * Process one NDJSON line from the consumer.
   * @param line - The raw line.
   * @returns what happened, for diagnostics.
   */
  async handleLine(line: string): Promise<IntakeOutcome> {
    const event = parseInboundLine(line)
    if (event === undefined) return this.report({ kind: 'ignored', reason: 'unparsable' })
    return this.handleEvent(event)
  }

  /**
   * Process one parsed event.
   * @param event - The inbound event.
   * @returns what happened, for diagnostics.
   */
  async handleEvent(event: LarkInboundEvent): Promise<IntakeOutcome> {
    const { repository } = this.deps
    let config = repository.getChannelConfig()
    if (!config.enabled) return this.report({ kind: 'ignored', reason: 'disabled' }, event)

    // A freshly created bot belongs to no group, so its open_id cannot be read
    // from a member list. It CAN be read from the first message that mentions
    // it — group triggers always carry mentions. Until then group admission
    // stays fail-closed, so learning here opens no gap.
    if (config.botOpenId === undefined && event.chat_type === 'group') {
      const learned = await this.learnBotOpenId(event, config)
      if (learned !== undefined) config = learned
    }

    const decision = admitInboundEvent(event, {
      allowOpenIds: config.allowOpenIds,
      ...(config.botOpenId !== undefined ? { botOpenId: config.botOpenId } : {}),
      watermark: this.deps.watermark(),
      isDuplicate: messageId => this.dedup.check(messageId),
      // Any qa binding exempts the allowlist, INCLUDING an invalidated one:
      // the invalidated group owes its members a bounded notice (handled by
      // the qa delivery layer), and blocking them here would silence it.
      isQaChat: chatId => repository.getChatBinding(chatId)?.kind === 'qa',
    })
    if (!decision.admit) return this.report({ kind: 'ignored', reason: decision.reason }, event)

    // Idempotency at the durable layer as well as the in-memory window: a
    // redelivery after a restart finds the window empty but the row present.
    const known = repository.findChannelByTriggerMessage(event.message_id)
    if (known !== undefined) return this.report({ kind: 'ignored', reason: 'duplicate' }, event)

    const route = await routeChat(
      repository,
      this.deps.locator,
      { chatId: event.chat_id, chatType: event.chat_type },
      this.deps.client,
    )
    if (route.routed === false) {
      return this.report({ kind: 'unroutable', reason: route.reason }, event)
    }
    if (route.routed === 'qa') {
      // QA groups have their own delivery path (a fork child fed through the
      // host queue). Without that service wired, refusing is the fail-closed
      // answer — a qa binding must never fall back to workspace dispatch.
      const qa = this.deps.qaDelivery
      if (qa === undefined) {
        return this.report(
          { kind: 'unroutable', reason: 'QA delivery is not available in this Host' },
          event,
        )
      }
      return this.report(await qa.deliver(event, decision.text, route.binding), event)
    }

    try {
      return await this.admitToWork(event, decision.text, route)
    } catch (error) {
      return this.report(
        { kind: 'error', reason: error instanceof Error ? error.message : String(error) },
        event,
      )
    }
  }

  /** Create or continue work for an admitted message. */
  private async admitToWork(
    event: LarkInboundEvent,
    text: string,
    route: {
      readonly workspaceId: string
      readonly workspacePath: string
      readonly binding: { readonly chatName?: string | undefined }
    },
  ): Promise<IntakeOutcome> {
    const { repository, coordinator } = this.deps
    const scopeKey = scopeKeyOf('chat', event.chat_id)

    // A message arriving while the Agent is waiting for input IS the answer.
    // Queueing it instead would leave the Agent waiting for something the user
    // believes they already sent.
    const active = repository.findActiveTaskByScope(scopeKey)
    if (active !== undefined) {
      const current = repository.findCurrentInvocation(active.id)
      if (current?.status === 'waiting-user') {
        await coordinator.answer(active.id, text)
        return this.report({ kind: 'answered', taskId: active.id }, event)
      }
    }

    const invocationId = `inv-${randomUUID()}`
    // Record the reply target BEFORE the work starts: the binding is the only
    // authority for where an answer may go, and work that outran it could
    // settle with nowhere to report.
    await repository.putInvocationChannel({
      invocationId,
      chatId: event.chat_id,
      chatType: event.chat_type,
      triggerMessageId: event.message_id,
      ...(event.root_id !== undefined ? { rootMessageId: event.root_id } : {}),
      senderOpenId: event.sender_id ?? '',
      createdAt: Date.now(),
    })

    const context = await captureChatContext(this.deps.client, event.chat_id, event.message_id)
    // The asker's display name comes from the trigger's own history record:
    // the history API resolves sender names while the inbound event carries
    // only an open_id. No extra call, and no contact scope for Pet to hold.
    const resolvedSender = context.trigger?.senderName
    const senderName =
      resolvedSender !== undefined && resolvedSender !== 'unknown' ? resolvedSender : undefined
    // Remember it so Settings can show a person instead of an `ou_…`. A
    // cache only: admission never consults it.
    const sender = event.sender_id ?? ''
    if (senderName !== undefined && sender !== '') {
      const current = repository.getChannelConfig()
      if (current.knownNames?.[sender] !== senderName) {
        await repository.putChannelConfig({
          ...current,
          knownNames: { ...(current.knownNames ?? {}), [sender]: senderName },
          updatedAt: Date.now(),
        })
      }
    }
    // Probed per Invocation rather than cached: a bot login can expire between
    // one message and the next, and a stale "you can read Lark" briefing is
    // worse than none.
    const larkReady = await this.deps.client.botReady()
    const prompt = renderChannelPrompt(
      {
        chatType: event.chat_type,
        chatId: event.chat_id,
        messageId: event.message_id,
        larkReady,
        ...(route.binding.chatName !== undefined ? { chatName: route.binding.chatName } : {}),
        senderOpenId: event.sender_id ?? '',
        ...(senderName !== undefined ? { senderName } : {}),
        text,
      },
      context,
    )

    // Mark it in progress BEFORE dispatching. `acceptConversation` awaits all
    // the way through dispatch, and a fast turn settles inside that call — so
    // reacting afterwards means the working mark appears after the work is
    // already done, or never, leaving only a bare DONE on the message.
    await markInProgress(repository, this.deps.client, invocationId)

    const accepted = await this.deps.coordinator.acceptConversation({
      invocationId,
      scopeKey,
      chatId: event.chat_id,
      ...(route.binding.chatName !== undefined ? { chatName: route.binding.chatName } : {}),
      workspaceId: route.workspaceId,
      workspacePath: route.workspacePath,
      prompt,
    })

    return this.report(
      { kind: 'accepted', invocationId: accepted.invocation.id, taskId: accepted.task.id },
      event,
    )
  }

  /**
   * Learn the bound bot's own open_id, once, and PROVE it before storing.
   *
   * A freshly created bot belongs to no group, so its open_id cannot be read
   * from a member list up front. But receiving a group message proves the bot
   * is now in that group — which makes the member list available after all.
   *
   * The mention is therefore only a candidate source, never the authority:
   * the open_id is accepted solely when the chat's member list ties it to the
   * bound `app_id`. A display name can be impersonated; an app id cannot.
   * @param event - The inbound group event.
   * @param config - Current configuration.
   * @returns the updated configuration, or `undefined` when nothing was proven.
   */
  private async learnBotOpenId(
    event: LarkInboundEvent,
    config: PetChannelConfig,
  ): Promise<PetChannelConfig | undefined> {
    const appId = config.botAppId?.trim()
    // Without a bound app id there is nothing to prove an identity against.
    if (appId === undefined || appId === '') return undefined

    const mentioned = new Set(
      (event.mentions ?? [])
        .map(mention => mention.id)
        .filter((id): id is string => typeof id === 'string' && id.startsWith('ou_')),
    )
    if (mentioned.size === 0) return undefined

    const bots = await this.deps.client.listChatBots(event.chat_id)
    // Both halves matter: the app id proves which bot is us, and the mention
    // proves this message was actually addressed to that bot.
    const proven = bots.filter(bot => bot.appId === appId && mentioned.has(bot.openId))
    if (proven.length !== 1) return undefined
    const learned = proven[0]
    if (learned === undefined) return undefined

    const next: PetChannelConfig = {
      ...config,
      botOpenId: learned.openId,
      ...(config.botName === undefined && learned.name !== '' ? { botName: learned.name } : {}),
      updatedAt: Date.now(),
    }
    await this.deps.repository.putChannelConfig(next)
    return next
  }

  /** Publish an outcome and return it. */
  private report(outcome: IntakeOutcome, event?: LarkInboundEvent): IntakeOutcome {
    this.deps.onOutcome?.(outcome, event)
    return outcome
  }
}
