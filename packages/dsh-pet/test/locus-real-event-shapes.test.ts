import { describe, expect, it } from 'vitest'
import type { LarkInboundEvent } from '../src/host/channel/event.js'
import {
  admitLocusEvent,
  extractLocusEndpoint,
  locusEndpointKey,
  type LocusAdmissionContext,
} from '../src/host/locus/admission.js'
import { admitNormalizedLocusEvent } from '../src/host/channel/locus-controller.js'
import { parseBotAddedEvent } from '../src/host/channel/bot-lifecycle.js'
import {
  REAL_BOT_ADDED_LINE,
  REAL_CHAINED_GROUP_REPLY,
  REAL_GROUP_MENTION,
  REAL_ID_SHAPES,
  REAL_QUOTED_GROUP_MENTION,
  REAL_QUOTED_GROUP_MENTION_WITH_BAD_REPLY,
  REAL_TOPIC_MENTION,
  REAL_TOPIC_REPLY_MENTION,
} from './fixtures/real-lark-events.js'

/**
 * Task 1.4: exercise the admission seams against REDACTED REAL event shapes.
 *
 * The existing suites use hand-written placeholders (`oc_project`, `om_root`).
 * Those satisfy the prefix validators but are much shorter than real ids and
 * never reproduce the `om_x…` message form, so they cannot catch a length or
 * form assumption. These samples keep the real prefixes, length classes and
 * the `x` marker while replacing every tenant-identifying body.
 */
describe('admission accepts the real observed event shapes', () => {
  it('derives a group endpoint from a real group mention', () => {
    const result = extractLocusEndpoint(REAL_GROUP_MENTION as unknown as LarkInboundEvent)

    expect(result).toEqual({
      ok: true,
      endpoint: {
        chatId: REAL_ID_SHAPES.groupChatId,
        key: locusEndpointKey(REAL_ID_SHAPES.groupChatId),
      },
    })
  })

  it('derives a topic endpoint from a real topic mention', () => {
    // T3-C1 confirmed against live events that a real topic message carries a
    // non-empty `thread_id`, and that this id is the stable entry identity.
    const result = extractLocusEndpoint(REAL_TOPIC_MENTION as unknown as LarkInboundEvent)

    expect(result).toEqual({
      ok: true,
      endpoint: {
        chatId: REAL_ID_SHAPES.groupChatId,
        threadId: REAL_ID_SHAPES.threadId,
        key: locusEndpointKey(REAL_ID_SHAPES.groupChatId, REAL_ID_SHAPES.threadId),
      },
    })
  })

  it('keeps the group and topic entries of one chat distinct', () => {
    // The real ids differ in length class (chat 32 hex vs thread 16 hex); a key
    // built by naive concatenation could collide across those shapes.
    const group = extractLocusEndpoint(REAL_GROUP_MENTION as unknown as LarkInboundEvent)
    const topic = extractLocusEndpoint(REAL_TOPIC_MENTION as unknown as LarkInboundEvent)

    expect(group.ok && topic.ok && group.endpoint.key).not.toBe(topic.ok && topic.endpoint.key)
  })

  it('keeps a quoted timeline message on the group entry when thread_id is absent', () => {
    // Measured 2026-09-16: on a regular group (`chat_mode: group`) a quote sets
    // `root_id` and `parent_id` to the quoted message and sets NO `thread_id`,
    // and the tenant's thread listing proved such a message is not inside the
    // topic it references. The endpoint is therefore the GROUP entry — the
    // previous fail-closed reading of these facts silently dropped the most
    // common way a person asks the bot something.
    expect(extractLocusEndpoint(REAL_QUOTED_GROUP_MENTION as unknown as LarkInboundEvent))
      .toEqual({
        ok: true,
        endpoint: {
          chatId: REAL_ID_SHAPES.groupChatId,
          key: locusEndpointKey(REAL_ID_SHAPES.groupChatId),
        },
      })
  })

  it('keeps a chained timeline reply on the group entry when root and parent differ', () => {
    expect(extractLocusEndpoint(REAL_CHAINED_GROUP_REPLY as unknown as LarkInboundEvent))
      .toEqual({
        ok: true,
        endpoint: {
          chatId: REAL_ID_SHAPES.groupChatId,
          key: locusEndpointKey(REAL_ID_SHAPES.groupChatId),
        },
      })
  })

  it('does not drop a valid quote because its optional reply id is unusable', () => {
    expect(
      extractLocusEndpoint(REAL_QUOTED_GROUP_MENTION_WITH_BAD_REPLY as unknown as LarkInboundEvent),
    ).toEqual({
      ok: true,
      endpoint: {
        chatId: REAL_ID_SHAPES.groupChatId,
        key: locusEndpointKey(REAL_ID_SHAPES.groupChatId),
      },
    })
  })

  it('still fails closed on a real-shaped message whose thread_id is unusable', () => {
    // The identity fact keeps its teeth: a present-but-corrupt `thread_id`
    // cannot prove an entry, so the event must not be widened to the group.
    const corrupted = { ...REAL_TOPIC_MENTION, thread_id: 'omt_bad thread' }

    expect(extractLocusEndpoint(corrupted as unknown as LarkInboundEvent))
      .toEqual({ ok: false, reason: 'invalid-thread' })
  })

  it('parses a real bot-added event from its V2 envelope line', () => {
    // The real payload nests its facts under `header`/`event` inside a
    // `schema: '2.0'` envelope and arrives as a JSONL line. A flat object —
    // which is what one would write from memory — is correctly rejected.
    const parsed = parseBotAddedEvent(REAL_BOT_ADDED_LINE)

    expect(parsed).toMatchObject({
      type: 'im.chat.member.bot.added_v1',
      chatId: REAL_ID_SHAPES.groupChatId,
      operatorOpenId: REAL_ID_SHAPES.senderOpenId,
    })
  })

  it('rejects a flat bot-added object that omits the V2 envelope', () => {
    const flat = JSON.stringify({
      event_type: 'im.chat.member.bot.added_v1',
      event_id: '00000000000000000000000000000001',
      chat_id: REAL_ID_SHAPES.groupChatId,
    })

    expect(parseBotAddedEvent(flat)).toBeUndefined()
  })
})

/**
 * The same real shapes, carried through admission and message normalization.
 *
 * Endpoint extraction is only half the contract: what the controller consumes
 * is the normalized message, whose reply target decides where the answer goes.
 */
describe('admission and reply targets for the real observed shapes', () => {
  const context: LocusAdmissionContext = {
    botOpenId: REAL_ID_SHAPES.botOpenId,
    allowOpenIds: [REAL_ID_SHAPES.senderOpenId],
    watermark: 0,
    isDuplicate: () => false,
  }

  it('admits a quoted timeline message onto the group entry', () => {
    const decision = admitLocusEvent(REAL_QUOTED_GROUP_MENTION as unknown as LarkInboundEvent, context)

    expect(decision).toMatchObject({
      admit: true,
      endpoint: { chatId: REAL_ID_SHAPES.groupChatId },
      senderId: REAL_ID_SHAPES.senderOpenId,
    })
    expect(decision.admit && decision.endpoint.threadId).toBeUndefined()
  })

  it('keeps a quoted timeline message reply target free of any thread/root claim', () => {
    // `root_id` on the timeline is the root of a REPLY CHAIN, not a thread
    // root. Recording it as `rootMessageId` would both mislabel the Delivery
    // and make the child prompt claim a thread that does not exist.
    const admission = admitNormalizedLocusEvent(
      REAL_QUOTED_GROUP_MENTION as unknown as LarkInboundEvent,
      context,
    )

    expect(admission.kind).toBe('accepted')
    if (admission.kind !== 'accepted') throw new Error('expected an accepted admission')
    expect(admission.message.replyTarget).toEqual({
      chatId: REAL_ID_SHAPES.groupChatId,
      messageId: REAL_ID_SHAPES.nextMessageId,
    })
    expect(admission.message.replyToMessageId).toBe(REAL_ID_SHAPES.quotedMessageId)
  })

  it('keeps a topic reply on its topic entry and records the topic root', () => {
    const admission = admitNormalizedLocusEvent(
      REAL_TOPIC_REPLY_MENTION as unknown as LarkInboundEvent,
      context,
    )

    expect(admission.kind).toBe('accepted')
    if (admission.kind !== 'accepted') throw new Error('expected an accepted admission')
    expect(admission.message.endpoint).toEqual({
      chatId: REAL_ID_SHAPES.groupChatId,
      threadId: REAL_ID_SHAPES.threadId,
    })
    expect(admission.message.replyTarget).toEqual({
      chatId: REAL_ID_SHAPES.groupChatId,
      threadId: REAL_ID_SHAPES.threadId,
      messageId: REAL_ID_SHAPES.topicReplyMessageId,
      rootMessageId: REAL_ID_SHAPES.messageId,
    })
  })
})
