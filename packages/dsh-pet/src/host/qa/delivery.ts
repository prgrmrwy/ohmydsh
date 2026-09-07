/**
 * QA delivery: one admitted group message becomes one child turn.
 *
 * This is the QA counterpart of the phase-one dispatch path, and it is
 * deliberately NOT built on it. A phase-one trigger creates an executor and
 * queues an Invocation through Pet's own serial machinery; a QA trigger has
 * nowhere to create anything — its "executor" is a fork child that already
 * exists and already holds the context that makes the group worth having.
 * So the message goes straight into that child's inbox, and the ordering Pet
 * would otherwise impose is left to the inbox's own FIFO.
 *
 * Three invariants shape everything here:
 *
 * 1. Acceptance is not completion. `queuePrompt` resolving means the inbox
 *    took the message — not that a turn ran, finished, or persisted. Terminal
 *    state comes only from the settlement observer.
 * 2. The parent must be an exact live Agent. A group message can arrive long
 *    after the source session stopped being resident, so resolving the parent
 *    (resuming it when needed) is part of every delivery, not a one-off.
 * 3. A source session that cannot be revived is permanent. That invalidates
 *    the binding and — unlike every other refusal in this channel — says so
 *    in the group, because the bot has been answering there publicly and
 *    silence would just look broken.
 */

import { markInProgress, settleFeedback } from '../channel/feedback.js'
import type { LarkClient } from '../channel/lark.js'
import type { LarkInboundEvent } from '../channel/event.js'
import { renderQaPrompt } from './prompt.js'
import { resolveLiveParent, type SubagentSeam } from './subagents.js'
import type { PetRepository } from '../repository.js'
import type { PetChatBinding } from '../spec.js'
import { randomUUID } from 'node:crypto'

/** Notice posted once when a binding's source session is gone. */
const INVALIDATED_NOTICE =
  '这个答疑群绑定的源会话已不可用，我无法再基于它回答问题了。' +
  '需要继续的话，请在 DSH 里重新发起一个答疑群。'

/**
 * What one QA delivery attempt produced.
 *
 * Shaped to the pipeline's `IntakeOutcome` so QA reports through the same
 * diagnostics surface as every other inbound message.
 */
export type QaDeliveryOutcome =
  | { readonly kind: 'accepted'; readonly invocationId: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string }

/** Everything QA delivery needs from its Host. */
export interface QaDeliveryDeps {
  readonly repository: PetRepository
  readonly client: LarkClient
  readonly seam: SubagentSeam
  /** Structured logging sink. */
  readonly log?: (message: string) => void
  /** Notified when durable state changed, so the UI can refresh. */
  readonly onChange?: () => void
}

/**
 * Delivers admitted QA messages into their group's child.
 *
 * An object rather than a function because it owns the settlement
 * subscription, which must outlive any single message.
 */
export class QaDelivery {
  private readonly unsubscribe: () => void

  /**
   * @param deps - Host collaborators.
   */
  constructor(private readonly deps: QaDeliveryDeps) {
    this.unsubscribe = deps.seam.onChildSettled(info => {
      void this.settle(info.id, info.stopReason).catch(error => {
        this.log(`qa settle failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }

  /** Release the settlement subscription. */
  dispose(): void {
    this.unsubscribe()
  }

  /**
   * Deliver one admitted message to its group's child.
   * @param event - The inbound event.
   * @param text - Admitted message text.
   * @param binding - The qa binding this chat routed to.
   * @returns what happened.
   */
  async deliver(
    event: LarkInboundEvent,
    text: string,
    binding: PetChatBinding,
  ): Promise<QaDeliveryOutcome> {
    const { repository } = this.deps
    const childId = binding.qaChildSessionId
    const parentId = binding.qaParentSessionId
    if (childId === undefined || parentId === undefined) {
      return { kind: 'error', reason: 'qa binding is missing its child or source session' }
    }

    if (binding.qaInvalidatedAt !== undefined) {
      // Already invalidated: the notice was posted when it happened, and
      // repeating it on every message would turn a dead group into a spammy
      // one. Silence from here on is the bounded half of "tell them once".
      return { kind: 'ignored', reason: 'qa binding invalidated' }
    }

    const parent = await resolveLiveParent(this.deps.seam, parentId)
    if (parent === undefined) {
      await this.invalidate(binding, '源会话已不可用（无法恢复）')
      return { kind: 'ignored', reason: 'source session unavailable' }
    }

    // Recorded BEFORE the message is queued: this row is the only authority
    // for where an answer's feedback goes, and work that outran it could
    // settle with nothing to mark.
    const deliveryId = `qa-${randomUUID()}`
    await repository.putInvocationChannel({
      invocationId: deliveryId,
      chatId: event.chat_id,
      chatType: event.chat_type,
      triggerMessageId: event.message_id,
      ...(event.root_id !== undefined ? { rootMessageId: event.root_id } : {}),
      senderOpenId: event.sender_id ?? '',
      createdAt: Date.now(),
    })

    // Marked in progress BEFORE queuing, for the same reason phase 2.1 moved
    // this ahead of dispatch: a fast turn can settle inside the queue call,
    // and a reaction applied afterwards would appear after the work is done
    // — or race the settlement into never appearing at all.
    await markInProgress(repository, this.deps.client, deliveryId)

    const senderName = await this.resolveSenderName(event)
    const larkReady = await this.deps.client.botReady()
    const prompt = renderQaPrompt({
      chatId: event.chat_id,
      ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
      messageId: event.message_id,
      senderOpenId: event.sender_id ?? '',
      ...(senderName !== undefined ? { senderName } : {}),
      text,
      larkReady,
      isFirst: false,
      // Restated on EVERY question rather than left to the seed: a standing
      // constraint mentioned once drifts out of attention exactly as the
      // conversation grows, and this one decides whether work lands in the
      // task branch or in the main checkout.
      ...(binding.qaExecutionRoot !== undefined
        ? {
            workspace: {
              executionRoot: binding.qaExecutionRoot,
              ...(binding.qaBranch !== undefined ? { branch: binding.qaBranch } : {}),
              ...(binding.qaRepositoryRoot !== undefined
                ? { repositoryRoot: binding.qaRepositoryRoot }
                : {}),
            },
          }
        : {}),
    })

    try {
      await this.deps.seam.queuePrompt(parent, childId, prompt, AbortSignal.timeout(30_000))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // A refused queue is not necessarily fatal to the binding (a transient
      // inbox failure is possible), so this settles the delivery as failed
      // rather than invalidating: the asker sees a failure mark instead of
      // silence, and the next message tries again.
      await this.settleDelivery(deliveryId, 'failed')
      return { kind: 'error', reason }
    }

    this.deps.onChange?.()
    return { kind: 'accepted', invocationId: deliveryId }
  }

  /**
   * Apply terminal feedback when one child settles a turn.
   *
   * The settlement event names the child, not the message, so the delivery it
   * belongs to is resolved by order: the child's inbox is FIFO, therefore the
   * oldest unsettled delivery of that chat is the one that just finished.
   * @param childSessionId - Child that settled.
   * @param stopReason - Terminal reason from the runtime.
   */
  private async settle(childSessionId: string, stopReason?: string): Promise<void> {
    const binding = this.deps.repository
      .listChatBindings()
      .find(row => row.kind === 'qa' && row.qaChildSessionId === childSessionId)
    // Not ours: the host emits this for every subagent, including ordinary
    // ones the user started themselves.
    if (binding === undefined) return

    const pending = this.deps.repository.findOldestPendingChannelForChat(binding.chatId)
    if (pending === undefined) {
      // A turn the group did not raise — the owner talking to the child
      // directly in the GUI, or the creation seed turn. Nothing to mark, and
      // marking anything would attach feedback to an unrelated message.
      return
    }
    await this.settleDelivery(
      pending.invocationId,
      stopReason === undefined || stopReason === 'completed' ? 'succeeded' : 'failed',
    )
  }

  /** Apply and publish one delivery's terminal feedback. */
  private async settleDelivery(
    deliveryId: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<void> {
    await settleFeedback(this.deps.repository, this.deps.client, deliveryId, outcome)
    this.deps.onChange?.()
  }

  /**
   * Invalidate a binding and tell the group once.
   *
   * The notice is the deliberate exception to this channel's "refuse in
   * silence" rule: silence protects conversations that were never authorised
   * to reach the agent, while this group has been talking to it all along.
   */
  private async invalidate(binding: PetChatBinding, reason: string): Promise<void> {
    const updated = await this.deps.repository.invalidateQaBinding(binding.chatId, reason)
    // `invalidateQaBinding` keeps the first timestamp, so a row that already
    // carried one was announced before; only a fresh invalidation speaks.
    if (updated?.qaInvalidatedAt !== undefined && binding.qaInvalidatedAt === undefined) {
      try {
        await this.deps.client.sendToChat(binding.chatId, INVALIDATED_NOTICE)
      } catch {
        // Fail-soft: the binding is invalid either way, and a Lark outage
        // must not stop that from being recorded.
      }
    }
    this.log(`qa binding ${binding.chatId} invalidated: ${reason}`)
    this.deps.onChange?.()
  }

  /** Resolve the asker's display name from the chat's recent history. */
  private async resolveSenderName(event: LarkInboundEvent): Promise<string | undefined> {
    // The inbound event carries only an open_id; the history API resolves
    // names for free, so this costs one call and no contact scope.
    try {
      const recent = await this.deps.client.listMessages(event.chat_id, 10)
      const trigger = recent.find(message => message.messageId === event.message_id)
      const name = trigger?.senderName
      return name !== undefined && name !== 'unknown' ? name : undefined
    } catch {
      return undefined
    }
  }

  /** Emit one diagnostic line. */
  private log(message: string): void {
    this.deps.log?.(message)
  }
}
