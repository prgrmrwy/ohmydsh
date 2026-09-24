/**
 * Outbound feedback for channel-triggered work: reactions and, for direct
 * chats, the final answer.
 *
 * Every action here is driven by the HOST observing an Invocation settle, not
 * by the model choosing to act. That keeps the trigger message's visible state
 * honest even when the Agent says nothing, and means no model output can
 * decide where a message goes.
 *
 * All of it is fail-soft: reactions and replies decorate work that already
 * happened, so a Lark failure is logged and dropped rather than changing an
 * Invocation's outcome.
 */

import type { LarkClient } from './lark.js'
import type { PetRepository } from '../repository.js'

/**
 * Reaction placed while work is in flight.
 *
 * Applied to queued messages too: "received, waiting" and "working" are the
 * same thing from the sender's side, and a second symbol would only invite
 * the question of what it means.
 */
export const EMOJI_IN_PROGRESS = 'OnIt'

/** Reaction marking a successful settle. */
export const EMOJI_DONE = 'DONE'

/** Reaction marking a failed or cancelled settle. */
export const EMOJI_FAILED = 'CRY'

/** Marks a message as being worked on and records the reaction id. */
export async function markInProgress(
  repository: PetRepository,
  client: LarkClient,
  invocationId: string,
): Promise<void> {
  const binding = repository.getInvocationChannel(invocationId)
  if (binding === undefined) return
  const reactionId = await client.addReaction(binding.triggerMessageId, EMOJI_IN_PROGRESS)
  if (reactionId === undefined) return
  // Persisted because removal needs it later, and the Host may restart in
  // between.
  await repository.setInvocationReaction(invocationId, reactionId)
}

/** How an Invocation ended, as far as feedback is concerned. */
export type SettleOutcome = 'succeeded' | 'failed'

/**
 * Apply the terminal feedback for one settled Invocation.
 *
 * Order matters: the in-progress reaction is removed BEFORE the terminal one
 * is added, so a reader never sees both at once and mistake it for two
 * separate runs.
 * @param repository - Pet repository.
 * @param client - Bot-identity Lark client.
 * @param invocationId - The settled Invocation.
 * @param outcome - How it ended.
 */
export async function settleFeedback(
  repository: PetRepository,
  client: LarkClient,
  invocationId: string,
  outcome: SettleOutcome,
): Promise<void> {
  const binding = repository.getInvocationChannel(invocationId)
  if (binding === undefined) return
  // Claim it first so a second settle for the same Invocation cannot double
  // up the terminal reaction.
  await repository.markChannelSettled(invocationId)

  // The working mark is applied BEFORE dispatch, so by the time any turn can
  // settle it is already recorded — no waiting needed here.
  if (binding.reactionId !== undefined) {
    await client.removeReaction(binding.triggerMessageId, binding.reactionId)
    await repository.setInvocationReaction(invocationId, undefined)
  }
  await client.addReaction(
    binding.triggerMessageId,
    outcome === 'succeeded' ? EMOJI_DONE : EMOJI_FAILED,
  )

  // No text is sent from here. The agent owns replying: it can choose what to
  // say, when, and in what form (text or card), and it is told to reply to the
  // trigger message in the same chat.
  //
  // Two senders produced duplicates — the agent answered, then the Host posted
  // its final message again — and the Host's version could only ever be the
  // whole transcript tail, never a considered answer. Reactions stay here
  // because they are pure state, not content.
}
