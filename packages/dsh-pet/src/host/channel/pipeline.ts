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
import { parseCommand } from '../qa/command.js'
import { isQaChatLive } from '../qa/occupancy.js'
import type { LarkClient, LarkPermissionDiagnostic } from './lark.js'
import { routeChat, type WorkspaceLocator } from './route.js'
import type { PetCoordinator } from '../coordinator.js'
import type { PetRepository } from '../repository.js'
import type { PetChatBinding } from '../spec.js'
import { scopeKeyOf } from '../../wire.js'

/** What happened to one inbound line. */
export type IntakeOutcome =
  | {
      readonly kind: 'ignored'
      readonly reason: AdmissionRefusal | 'unparsable' | 'disabled' | 'bot-identity-unresolved' | string
      readonly diagnostic?: LarkPermissionDiagnostic
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
  /**
   * Handles `/bind` in groups that have no QA binding yet.
   *
   * Absent on a Host without QA support, in which case the command is never
   * recognised and such groups behave exactly as before.
   */
  readonly bindCommand?: BindCommandPort
  /** Reports an outcome for diagnostics. */
  readonly onOutcome?: (outcome: IntakeOutcome, event?: LarkInboundEvent) => void
}

/** Runs one `/bind` and reports back in the pipeline's vocabulary. */
export interface BindCommandPort {
  /**
   * @param event - The admitted event carrying the command.
   * @param prefix - The session prefix as typed; empty when none was given.
   * @returns what happened, for diagnostics.
   */
  handle(event: LarkInboundEvent, prefix: string): Promise<IntakeOutcome>
  /**
   * Release a group that `/bind` attached.
   * @param event - The admitted event carrying the command.
   * @returns what happened, for diagnostics.
   */
  unbind(event: LarkInboundEvent): Promise<IntakeOutcome>
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
    const config = repository.getChannelConfig()
    if (!config.enabled) return this.report({ kind: 'ignored', reason: 'disabled' }, event)
    if (config.botOpenId === undefined) {
      return this.report({ kind: 'ignored', reason: 'bot-identity-unresolved' }, event)
    }

    const decision = admitInboundEvent(event, {
      allowOpenIds: config.allowOpenIds,
      ...(config.botOpenId !== undefined ? { botOpenId: config.botOpenId } : {}),
      watermark: this.deps.watermark(),
      isDuplicate: messageId => this.dedup.check(messageId),
      // Any qa binding exempts the allowlist, INCLUDING an invalidated one:
      // the invalidated group owes its members a bounded notice (handled by
      // the qa delivery layer), and blocking them here would silence it.
      // LIVE, not merely present: a released or invalidated binding keeps its
      // row (it points at a child whose history stays readable), and treating
      // that as a qa chat would keep exempting strangers from the allowlist
      // in a group nobody is serving any more.
      isQaChat: chatId => isQaChatLive(repository, chatId),
    })
    if (!decision.admit) return this.report({ kind: 'ignored', reason: decision.reason }, event)

    // Idempotency at the durable layer as well as the in-memory window: a
    // redelivery after a restart finds the window empty but the row present.
    const known = repository.findChannelByTriggerMessage(event.message_id)
    if (known !== undefined) return this.report({ kind: 'ignored', reason: 'duplicate' }, event)

    // Command recognition sits AFTER the whole gauntlet and BEFORE routing.
    // After, because a command is not a bypass — mention, dedup, watermark and
    // message type all still decide first. Before, because an unbound group's
    // messages would otherwise be discarded or routed to a workspace, and
    // `/bind` would never reach anything.
    //
    // Only in groups with no QA binding: once bound, the same text is
    // conversation again, and re-parsing it would hijack ordinary questions.
    const bindTarget = this.deps.bindCommand
    if (bindTarget !== undefined) {
      const parsed = parseCommand(decision.text)
      // Recognised on BOTH sides, then refused with a reason. Gating
      // recognition on the group's state instead made `/bind` in an already
      // bound group fall through as an ordinary question: the user got
      // whatever the child chose to say and never the one fact they needed
      // ("this group is already bound"), while the `chat-occupied` branch
      // became unreachable — a refusal nobody could ever see.
      //
      // An explicit verb aimed at the bot is a command attempt in any group.
      // Answering "you cannot do that here" is both more useful and more
      // honest than silently treating it as conversation.
      if (parsed.kind !== 'none') {
        // The exemption that lets any member ask questions does NOT extend to
        // binding or unbinding: an existing group's members were never vetted
        // by the owner for that. A non-allowlist sender is dropped in silence,
        // like every other refusal — answering "you may not" would confirm to
        // an unauthorised person that an agent stands behind this bot.
        const config = repository.getChannelConfig()
        const sender = event.sender_id ?? ''
        if (!config.allowOpenIds.includes(sender)) {
          return this.report({ kind: 'ignored', reason: 'not-allowed-sender' }, event)
        }
        return this.report(
          parsed.kind === 'unbind'
            ? await bindTarget.unbind(event)
            : await bindTarget.handle(event, parsed.kind === 'bind' ? parsed.prefix : ''),
          event,
        )
      }
    }

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
        await repository.updateChannelConfig(latest => ({
          ...latest,
          knownNames: { ...(latest.knownNames ?? {}), [sender]: senderName },
          updatedAt: Date.now(),
        }))
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

  /** Publish an outcome and return it. */
  private report(outcome: IntakeOutcome, event?: LarkInboundEvent): IntakeOutcome {
    this.deps.onOutcome?.(outcome, event)
    return outcome
  }
}
