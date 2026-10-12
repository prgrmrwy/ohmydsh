/**
 * Delivery-prompt position and fact assembly.
 *
 * The full routing preamble must be sent when (and only when) the Host cannot
 * prove the child already received it. Delivery is durable proof only once the
 * content is bound into the child's inbox, so the position is derived from that
 * fact — never from rendering order or a runtime counter (the regression this
 * test exists to prevent: the current Delivery counted itself as history).
 */

import { describe, expect, it } from 'vitest'
import {
  locusDeliveryPromptContext,
  preamblePosition,
  renderLocusDeliveryFor,
  type LocusPromptDeliveryFacts,
  type LocusPromptMessageFacts,
  type LocusPromptRecordFacts,
} from '../src/host/locus/context.js'

const CHILD = 'session-child-1'

function delivery(
  deliveryId: string,
  options: { readonly childSessionId?: string; readonly inboxMessageId?: string } = {},
): LocusPromptDeliveryFacts {
  return {
    deliveryId,
    childSessionId: options.childSessionId ?? CHILD,
    ...(options.inboxMessageId === undefined ? {} : { inboxMessageId: options.inboxMessageId }),
  }
}

function record(overrides: Partial<LocusPromptRecordFacts> = {}): LocusPromptRecordFacts {
  return {
    id: 'locus-1',
    generation: 2,
    endpoint: { chatId: 'oc_group', chatType: 'group' },
    parentSessionId: 'session-main-1',
    childSessionId: CHILD,
    workspaceId: 'workspace-1',
    state: 'active',
    childComposition: 'safe-v2',
    toolTier: { effective: 'safe' },
    permission: { effective: 'read' },
    ...overrides,
  }
}

function message(overrides: Partial<LocusPromptMessageFacts> = {}): LocusPromptMessageFacts {
  return {
    messageId: 'om_request-1',
    senderOpenId: 'ou_requester',
    text: '把这个群最近的上下文整理一下',
    replyTarget: { chatId: 'oc_group', messageId: 'om_request-1' },
    ...overrides,
  }
}

describe('delivery prompt position', () => {
  it('is the first delivery when the child has no durable Delivery at all', () => {
    expect(preamblePosition({ deliveries: [], childSessionId: CHILD })).toBe('first')
  })

  it('is still first while every prior Delivery is accepted-only', () => {
    // Acceptance is durable admission, not proof that content reached the
    // child's inbox: a render that never queued must not consume the preamble.
    expect(preamblePosition({
      deliveries: [delivery('delivery-1'), delivery('delivery-2')],
      childSessionId: CHILD,
    })).toBe('first')
  })

  it('is subsequent once a prior Delivery is bound into the child inbox', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      childSessionId: CHILD,
    })).toBe('subsequent')
  })

  it('excludes the Delivery being rendered from the proof', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      childSessionId: CHILD,
      currentDeliveryId: 'delivery-1',
    })).toBe('first')
  })

  it('does not count another child\'s Delivery as proof', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { childSessionId: 'session-other', inboxMessageId: 'inbox-1' })],
      childSessionId: CHILD,
    })).toBe('first')
  })

  it('treats an empty binding as no proof', () => {
    expect(preamblePosition({
      deliveries: [delivery('delivery-1', { inboxMessageId: '' })],
      childSessionId: CHILD,
    })).toBe('first')
  })

  it('keeps a bound prior Delivery as proof when a later one is still queued', () => {
    expect(preamblePosition({
      deliveries: [
        delivery('delivery-1', { inboxMessageId: 'inbox-1' }),
        delivery('delivery-2'),
      ],
      childSessionId: CHILD,
      currentDeliveryId: 'delivery-2',
    })).toBe('subsequent')
  })
})

describe('delivery prompt fact assembly', () => {
  it('takes the effective tier from the durable record instead of defaulting to safe', () => {
    const prompt = renderLocusDeliveryFor({
      record: record({ toolTier: { effective: 'shell' } }),
      message: message(),
      deliveries: [],
    })

    expect(prompt).toContain('### Tool tier')
    expect(prompt).toContain('- effective：shell')
  })

  it('defaults to the safe tier when the record carries none', () => {
    const prompt = renderLocusDeliveryFor({
      record: record({ toolTier: undefined }),
      message: message(),
      deliveries: [],
    })

    expect(prompt).toContain('- effective：safe')
    expect(prompt).toContain('不提供 shell')
  })

  it('renders the full preamble with the record facts on a first delivery', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
    })

    expect(prompt).toContain('### Endpoint')
    expect(prompt).toContain('### Context anchor')
    expect(prompt).toContain('oc_group')
  })

  it('renders the compact follow-up with the tier line once delivery is proven', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
    })

    expect(prompt).not.toContain('### Endpoint')
    expect(prompt).toContain('工具档位：safe')
    expect(prompt).toContain('om_request-1')
  })

  it('assembles a context whose tier and composition match the record', () => {
    const context = locusDeliveryPromptContext({
      record: record({ toolTier: { effective: 'shell' } }),
      message: message(),
    })

    expect(context.locus.toolTier).toBe('shell')
    expect(context.locus.childComposition).toBe('safe-v2')
    expect(context.locus.generation).toBe(2)
    expect(context.request.messageId).toBe('om_request-1')
  })
})

describe('the delivery states the measured entrance readability', () => {
  it('declares readability in the preamble only for the readable state', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
      readability: 'readable',
    })

    expect(prompt).toContain('本入口读取能力（本次实测）')
    expect(prompt).toContain('已实测可读')
  })

  it('states the limit in the preamble when the read failed', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
      readability: 'unreadable',
    })

    expect(prompt).toContain('不可读')
    expect(prompt).not.toContain('已实测可读')
  })

  it('reports the measured state on a follow-up delivery too, not just the preamble', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      readability: 'readable',
    })

    expect(prompt).toContain('工具档位：safe')
    expect(prompt).toContain('本入口读取能力（本次实测）')
    expect(prompt).toContain('已实测可读')
  })

  it('never claims readability when no measurement exists', () => {
    const prompt = renderLocusDeliveryFor({
      record: record(),
      message: message(),
      deliveries: [],
    })

    expect(prompt).toContain('未确认')
    expect(prompt).not.toContain('已实测可读')
  })

  it('keeps the tier fact and the read fact separate: a shell child can face an unreadable entrance', () => {
    const prompt = renderLocusDeliveryFor({
      record: record({ toolTier: { effective: 'shell' } }),
      message: message(),
      deliveries: [delivery('delivery-1', { inboxMessageId: 'inbox-1' })],
      readability: 'unreadable',
    })

    expect(prompt).toContain('工具档位：shell')
    expect(prompt).toContain('不可读')
  })
})
