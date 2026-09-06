/**
 * Outbound feedback: reaction lifecycle and direct-chat replies.
 *
 * The invariants under test are about AUTHORITY and HONESTY: the reply
 * destination comes only from the stored binding, group chats get no text at
 * all in this change, and a Lark failure never rewrites an Invocation's
 * outcome.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  markInProgress,
  settleFeedback,
  EMOJI_DONE,
  EMOJI_FAILED,
  EMOJI_IN_PROGRESS,
} from '../src/host/channel/feedback.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import type { PetInvocationChannel } from '../src/host/spec.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

interface Recorder {
  readonly client: LarkClient
  readonly added: { messageId: string; emoji: string }[]
  readonly removed: { messageId: string; reactionId: string }[]
  readonly replies: { messageId: string; text: string }[]
}

function recorder(options: { addFails?: boolean } = {}): Recorder {
  const added: { messageId: string; emoji: string }[] = []
  const removed: { messageId: string; reactionId: string }[] = []
  const replies: { messageId: string; text: string }[] = []
  return {
    added,
    removed,
    replies,
    client: {
      addReaction: vi.fn(async (messageId: string, emoji: string) => {
        added.push({ messageId, emoji })
        return options.addFails === true ? undefined : 'reaction-1'
      }),
      removeReaction: vi.fn(async (messageId: string, reactionId: string) => {
        removed.push({ messageId, reactionId })
      }),
      listMessages: vi.fn(async () => []),
      listChatBots: vi.fn(async () => []),
      chatName: vi.fn(async () => undefined),
      botReady: vi.fn(async () => true),
      reply: vi.fn(async (messageId: string, text: string) => {
        replies.push({ messageId, text })
      }),
    },
  }
}

function binding(overrides: Partial<PetInvocationChannel> = {}): PetInvocationChannel {
  return {
    invocationId: 'inv-1',
    chatId: 'oc_p2p00000000000000000000000000',
    chatType: 'p2p',
    triggerMessageId: 'om_trigger',
    senderOpenId: 'ou_owner000000000000000000000000',
    createdAt: 1,
    ...overrides,
  }
}

describe('marking work in progress', () => {
  it('adds the in-progress reaction and stores its id', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding())
    const rec = recorder()

    await markInProgress(repo, rec.client, 'inv-1')

    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_IN_PROGRESS }])
    // Persisted because removal needs it and the Host may restart in between.
    expect(repo.getInvocationChannel('inv-1')?.reactionId).toBe('reaction-1')
  })

  it('tolerates a failed reaction call', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding())

    await expect(markInProgress(repo, recorder({ addFails: true }).client, 'inv-1')).resolves
      .toBeUndefined()

    expect(repo.getInvocationChannel('inv-1')?.reactionId).toBeUndefined()
  })

  it('does nothing for an Invocation with no channel binding', async () => {
    harness = await openPetHarness()
    const rec = recorder()

    await markInProgress(harness.repository, rec.client, 'inv-none')

    // A capability Invocation from the overlay has no chat to react in.
    expect(rec.added).toEqual([])
  })
})

describe('settling feedback', () => {
  it('removes the in-progress reaction before adding the terminal one', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding({ reactionId: 'reaction-1' }))
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    // Seeing both at once would read as two separate runs.
    expect(rec.removed).toEqual([{ messageId: 'om_trigger', reactionId: 'reaction-1' }])
    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_DONE }])
    expect(repo.getInvocationChannel('inv-1')?.reactionId).toBeUndefined()
  })

  it('marks a failure with the failure reaction', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding({ reactionId: 'reaction-1' }))
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'failed')

    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_FAILED }])
    // Error detail is never auto-posted into a chat.
    expect(rec.replies).toEqual([])
  })

  it('sends no text in a direct chat either', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding())
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    // Replying belongs to the agent, which can choose what to say and in what
    // form. Two senders produced duplicate answers in practice.
    expect(rec.replies).toEqual([])
    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_DONE }])
  })

  it('sends no text into a group chat', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(
      binding({ chatId: 'oc_group0000000000000000000000000', chatType: 'group' }),
    )
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    // Group replies belong to the follow-up change that adds a model-driven
    // reply tool; this one gives groups reactions only.
    expect(rec.replies).toEqual([])
    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_DONE }])
  })

  it('reacts on the stored trigger message, never elsewhere', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding({ triggerMessageId: 'om_real' }))
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    // Reactions remain Host-owned state, so their target still comes only
    // from the stored binding.
    expect(rec.added[0]?.messageId).toBe('om_real')
  })

  it('does nothing for an Invocation with no channel binding', async () => {
    harness = await openPetHarness()
    const rec = recorder()

    await settleFeedback(harness.repository, rec.client, 'inv-none', 'succeeded')

    expect(rec.added).toEqual([])
    expect(rec.replies).toEqual([])
  })
})

describe('the working mark is in place before any settle', () => {
  it('removes whatever mark the intake recorded', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    // The intake applies the reaction BEFORE dispatch, so by the time a turn
    // can settle the id is already recorded — this is the normal case.
    await repo.putInvocationChannel(binding({ reactionId: 'reaction-1' }))
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    expect(rec.removed).toEqual([{ messageId: 'om_trigger', reactionId: 'reaction-1' }])
    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_DONE }])
  })

  it('settles cleanly when the mark could not be applied at all', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    // Reactions are fail-soft: a Lark hiccup during intake leaves no id, and
    // settling must still mark the outcome rather than stall.
    await repo.putInvocationChannel(binding())
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    expect(rec.removed).toEqual([])
    expect(rec.added).toEqual([{ messageId: 'om_trigger', emoji: EMOJI_DONE }])
  })

  it('marks the binding settled so a repeat does nothing', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(binding({ reactionId: 'reaction-1' }))
    const rec = recorder()

    await settleFeedback(repo, rec.client, 'inv-1', 'succeeded')

    expect(repo.getInvocationChannel('inv-1')?.settledAt).toBeGreaterThan(0)
    expect(repo.findPendingChannelFeedback('inv-1')).toBeUndefined()
  })
})
