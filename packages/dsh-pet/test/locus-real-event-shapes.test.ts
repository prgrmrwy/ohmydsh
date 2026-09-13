import { describe, expect, it } from 'vitest'
import type { LarkInboundEvent } from '../src/host/channel/event.js'
import { extractLocusEndpoint, locusEndpointKey } from '../src/host/locus/admission.js'
import { parseBotAddedEvent } from '../src/host/channel/bot-lifecycle.js'
import {
  REAL_BOT_ADDED_LINE,
  REAL_GROUP_MENTION,
  REAL_ID_SHAPES,
  REAL_TOPIC_MENTION,
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

  it('fails closed on a real-shaped topic message whose thread_id is missing', () => {
    // T3-C4 stayed manual because a malformed event cannot be injected into a
    // real tenant. This is the automated counterpart, on real-shaped input.
    const withoutThread = { ...REAL_TOPIC_MENTION, thread_id: undefined, root_id: REAL_ID_SHAPES.messageId }

    expect(extractLocusEndpoint(withoutThread as unknown as LarkInboundEvent))
      .toMatchObject({ ok: false, reason: 'ambiguous-thread' })
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
