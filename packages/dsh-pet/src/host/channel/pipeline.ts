/**
 * The inbound pipeline: one Lark event to one legacy Invocation, or one unified locus Delivery.
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
import type { LocusChannelControllerPort } from './locus-capability.js'
import type { LocusAuthorizationResolver } from '../locus/admission.js'
import type { LocusChannelEvent, LocusControllerResult } from './locus-controller.js'
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
  | {
      /** A unified locus Delivery; deliberately not represented as an Invocation. */
      readonly kind: 'locus-accepted'
      readonly deliveryId: string
      readonly executionId: string
      readonly locusId: string
      readonly generation: number
    }
  | {
      readonly kind: 'locus-duplicate'
      readonly deliveryId: string
      readonly locusId: string
      readonly generation: number
    }
  | {
      /** A control command handled without creating a Delivery. */
      readonly kind: 'control'
      readonly command: Extract<LocusControllerResult, { kind: 'control' }>['command']
      readonly ok: boolean
      readonly reason?: string
      readonly text?: string
    }
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
  /**
   * Optional unified locus channel. When supplied it is the exclusive Feishu
   * business path: legacy route/chat_bindings/Invocation/QA delivery are not
   * consulted. The controller itself fails closed when its turn observer is
   * absent.
   */
  readonly locusController?: Pick<LocusChannelControllerPort, 'handle'>
  /**
   * Breaking-cutover fence used by production. When true, an absent unified
   * controller is an unavailable channel, never permission to enter the
   * retained legacy test/migration pipeline below.
   */
  readonly requireLocus?: boolean
  /** Durable authorization lookup for the exact unified endpoint. */
  readonly locusAuthorization?: LocusAuthorizationResolver
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

    // Unified locus is an opt-in replacement, not a side route. Once composed,
    // every Feishu business event goes through the exact endpoint/locus/child
    // controller; no legacy binding, Invocation, or QA delivery lookup may
    // inspect the event. Bootstrap/subscription lifecycle remains owned by the
    // surrounding ChannelService.
    if (this.deps.locusController !== undefined) {
      // Bot auth/profile can expire after onboarding. Re-probe for every
      // unified Delivery before accepting durable work; otherwise the child
      // would be told it can read/reply while the platform identity is gone.
      if (!await this.deps.client.botReady().catch(() => false)) {
        return this.report({ kind: 'unroutable', reason: 'The Pet bot identity is unavailable.' }, event)
      }
      const authorization = this.deps.locusAuthorization
      if (authorization === undefined) {
        return this.report({ kind: 'unroutable', reason: 'Unified locus authorization is unavailable.' }, event)
      }
      try {
        const outcome = mapLocusOutcome(await this.deps.locusController.handle(event, {
          ...(config.botOpenId === undefined ? {} : { botOpenId: config.botOpenId }),
          allowOpenIds: config.allowOpenIds,
          watermark: this.deps.watermark(),
          isDuplicate: messageId => this.dedup.check(messageId),
          authorization,
        }))
        if (
          outcome.kind === 'ignored'
          && (outcome.reason === 'legacy-endpoint' || outcome.reason === 'retired-endpoint')
          && typeof event.message_id === 'string'
          && event.message_id !== ''
          && typeof event.sender_id === 'string'
          && config.allowOpenIds.includes(event.sender_id)
        ) {
          // Breaking cutover is visible rather than silently taking the old
          // endpoint under the default main. This is a bounded Host diagnostic,
          // not a business answer; failure stays fail-soft.
          await this.deps.client.reply(
            event.message_id,
            '该入口属于已退役的旧飞书模型，未接管也未迁移历史。请由允许的所有者在 Pet 管理面显式重建；新入口将从 read 权限开始。',
          ).catch(() => undefined)
        }
        return this.report(outcome, event)
      } catch (error) {
        return this.report(
          {
            kind: 'unroutable',
            reason: `Unified locus channel failed closed: ${error instanceof Error ? error.message : String(error)}`,
          },
          event,
        )
      }
    }

    if (this.deps.requireLocus === true) {
      return this.report(
        { kind: 'unroutable', reason: 'Unified locus capability is unavailable; legacy Feishu execution is retired.' },
        event,
      )
    }

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

/** Keep the public channel intake vocabulary free of Invocation semantics. */
function mapLocusOutcome(result: LocusControllerResult): IntakeOutcome {
  switch (result.kind) {
    case 'accepted':
      return {
        kind: 'locus-accepted',
        deliveryId: result.deliveryId,
        executionId: result.executionId,
        locusId: result.locusId,
        generation: result.generation,
      }
    case 'duplicate':
      return {
        kind: 'locus-duplicate',
        deliveryId: result.deliveryId,
        locusId: result.locusId,
        generation: result.generation,
      }
    case 'ignored':
      return { kind: 'ignored', reason: result.reason }
    case 'control':
      return {
        kind: 'control',
        command: result.command,
        ok: result.ok === true,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.text === undefined ? {} : { text: result.text }),
      }
    case 'refused':
      return { kind: 'unroutable', reason: result.reason }
  }
}
