/**
 * Inbound event parsing and the admission gauntlet.
 *
 * The gauntlet is the channel's whole trust boundary, so these tests exercise
 * each defence separately AND assert the silence contract: a refused event
 * produces a reason for the log and nothing else.
 */

import { describe, expect, it } from 'vitest'
import {
  admitInboundEvent,
  MessageDedup,
  parseInboundLine,
  type AdmissionContext,
  type LarkInboundEvent,
} from '../src/host/channel/event.js'

const BOT = 'ou_023b15a8d3e5de253ffc32182a7dde35'
const OWNER = 'ou_322ec1d3cd062f04bc2b1f4ba1eff8e9'
const STRANGER = 'ou_stranger00000000000000000000'

/** A group message that mentions the bot, overridable per test. */
function groupEvent(overrides: Partial<LarkInboundEvent> = {}): LarkInboundEvent {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_1',
    chat_id: 'oc_group',
    chat_type: 'group',
    message_type: 'text',
    content: '@小小芒果 为什么构建变慢了？',
    create_time: '2000',
    sender_id: OWNER,
    sender_type: 'user',
    mentions: [{ id: BOT, key: '@_user_1', name: '小小芒果' }],
    ...overrides,
  }
}

/** A p2p message, overridable per test. */
function p2pEvent(overrides: Partial<LarkInboundEvent> = {}): LarkInboundEvent {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_2',
    chat_id: 'oc_p2p',
    chat_type: 'p2p',
    message_type: 'text',
    content: 'hi',
    create_time: '2000',
    sender_id: OWNER,
    sender_type: 'user',
    ...overrides,
  }
}

function context(overrides: Partial<AdmissionContext> = {}): AdmissionContext {
  return {
    allowOpenIds: [OWNER],
    botOpenId: BOT,
    watermark: 1000,
    isDuplicate: () => false,
    ...overrides,
  }
}

describe('parsing NDJSON lines', () => {
  it('parses a real message event', () => {
    // Shape taken from an actual `lark-cli event consume` line.
    const line = JSON.stringify({
      type: 'im.message.receive_v1',
      event_id: 'f6ee',
      message_id: 'om_x100b66e0c9f0ccacc3a7b71e53ba541',
      chat_id: 'oc_ab9e035ed781e2b2e563127192bb5854',
      chat_type: 'p2p',
      message_type: 'text',
      content: 'hi',
      create_time: '1788692595942',
      sender_id: OWNER,
      sender_type: 'user',
    })

    expect(parseInboundLine(line)?.message_id).toBe('om_x100b66e0c9f0ccacc3a7b71e53ba541')
  })

  it('ignores stderr-style progress lines and blanks', () => {
    // The consumer interleaves human-readable markers with NDJSON.
    expect(parseInboundLine('[event] ready event_key=im.message.receive_v1')).toBeUndefined()
    expect(parseInboundLine('')).toBeUndefined()
    expect(parseInboundLine('   ')).toBeUndefined()
  })

  it('ignores malformed JSON rather than throwing', () => {
    // One bad line must not take the whole subscription down.
    expect(parseInboundLine('{"type":')).toBeUndefined()
  })

  it('ignores events of another type', () => {
    expect(parseInboundLine(JSON.stringify({ type: 'im.message.reaction.created_v1' }))).toBeUndefined()
  })

  it('ignores a message event missing the fields routing depends on', () => {
    expect(
      parseInboundLine(JSON.stringify({ type: 'im.message.receive_v1', chat_id: 'oc_x' })),
    ).toBeUndefined()
    expect(
      parseInboundLine(
        JSON.stringify({ type: 'im.message.receive_v1', message_id: 'om_x', chat_id: 'oc_x' }),
      ),
    ).toBeUndefined()
  })
})

describe('sender admission', () => {
  it('admits an allowlisted user in p2p without any mention', () => {
    // p2p carries no mentions at all; the allowlist is the whole gate.
    const decision = admitInboundEvent(p2pEvent(), context())

    expect(decision).toEqual({ admit: true, text: 'hi' })
  })

  it('refuses a sender who is not on the allowlist', () => {
    const decision = admitInboundEvent(p2pEvent({ sender_id: STRANGER }), context())

    expect(decision).toEqual({ admit: false, reason: 'not-allowed-sender' })
  })

  it('refuses everyone when the allowlist is empty', () => {
    // An unconfigured channel must not be an open one.
    const decision = admitInboundEvent(p2pEvent(), context({ allowOpenIds: [] }))

    expect(decision).toEqual({ admit: false, reason: 'not-allowed-sender' })
  })

  it('refuses a message from another bot', () => {
    // Two bots in a group would otherwise trigger each other indefinitely.
    const decision = admitInboundEvent(
      groupEvent({ sender_type: 'bot', sender_id: OWNER }),
      context(),
    )

    expect(decision).toEqual({ admit: false, reason: 'bot-sender' })
  })
})

describe('group mention filtering', () => {
  it('admits a group message that mentions this bot', () => {
    const decision = admitInboundEvent(groupEvent(), context())

    expect(decision.admit).toBe(true)
  })

  it('refuses a group message mentioning a different bot', () => {
    // Observed on the very first real event captured during the spike: the
    // group traffic was an @ of another bot entirely.
    const decision = admitInboundEvent(
      groupEvent({ mentions: [{ id: 'ou_other0000000000000000000000', name: 'Aily' }] }),
      context(),
    )

    expect(decision).toEqual({ admit: false, reason: 'no-mention' })
  })

  it('refuses a group message with no mentions', () => {
    const decision = admitInboundEvent(groupEvent({ mentions: [] }), context())

    expect(decision).toEqual({ admit: false, reason: 'no-mention' })
  })

  it('fails closed when the bot open_id is unknown', () => {
    // Without knowing our own id, "was I mentioned" is unanswerable. Treating
    // every mention as ours would answer other people's @s.
    const decision = admitInboundEvent(groupEvent(), context({ botOpenId: undefined }))

    expect(decision).toEqual({ admit: false, reason: 'no-mention' })
  })
})

describe('replay defences', () => {
  it('refuses a message id already seen', () => {
    const decision = admitInboundEvent(p2pEvent(), context({ isDuplicate: () => true }))

    expect(decision).toEqual({ admit: false, reason: 'duplicate' })
  })

  it('refuses a message created before the consumer started', () => {
    const decision = admitInboundEvent(p2pEvent({ create_time: '500' }), context())

    expect(decision).toEqual({ admit: false, reason: 'before-watermark' })
  })

  it('admits a message created after the watermark', () => {
    expect(admitInboundEvent(p2pEvent({ create_time: '5000' }), context()).admit).toBe(true)
  })

  it('admits when the timestamp is absent or unparseable', () => {
    // A missing timestamp must not silently drop live traffic; the dedup
    // window still protects against redelivery.
    expect(admitInboundEvent(p2pEvent({ create_time: undefined }), context()).admit).toBe(true)
    expect(admitInboundEvent(p2pEvent({ create_time: 'nope' }), context()).admit).toBe(true)
  })
})

describe('content gating', () => {
  it('refuses a message type Pet cannot act on', () => {
    const decision = admitInboundEvent(p2pEvent({ message_type: 'image' }), context())

    expect(decision).toEqual({ admit: false, reason: 'unsupported-message-type' })
  })

  it('refuses an empty message', () => {
    const decision = admitInboundEvent(p2pEvent({ content: '   ' }), context())

    expect(decision).toEqual({ admit: false, reason: 'empty-content' })
  })

  it('returns the trimmed text on admission', () => {
    const decision = admitInboundEvent(p2pEvent({ content: '  构建为什么慢  ' }), context())

    expect(decision).toEqual({ admit: true, text: '构建为什么慢' })
  })
})

describe('refusals carry no side effect', () => {
  it('reports only a reason, never an action', () => {
    // The silence contract: a refused event leaves no trace in the chat, so
    // the decision object cannot carry anything to send.
    const decision = admitInboundEvent(p2pEvent({ sender_id: STRANGER }), context())

    expect(decision.admit).toBe(false)
    expect(Object.keys(decision)).toEqual(['admit', 'reason'])
  })
})

describe('message dedup window', () => {
  it('reports a repeat inside the window', () => {
    const dedup = new MessageDedup(1000)

    expect(dedup.check('om_1', 0)).toBe(false)
    expect(dedup.check('om_1', 500)).toBe(true)
  })

  it('forgets an id once the window passes', () => {
    const dedup = new MessageDedup(1000)
    dedup.check('om_1', 0)

    expect(dedup.check('om_1', 2000)).toBe(false)
  })

  it('keeps distinct ids independent', () => {
    const dedup = new MessageDedup(1000)

    expect(dedup.check('om_1', 0)).toBe(false)
    expect(dedup.check('om_2', 0)).toBe(false)
  })
})
