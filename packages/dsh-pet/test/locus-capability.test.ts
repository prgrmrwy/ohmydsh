/** Focused tests for the production unified-locus capability boundary. */

import { describe, expect, it, vi } from 'vitest'
import {
  LOCUS_CHANNEL_CAPABILITY_SERVICE,
  createLocusChannelCapability,
  probeLocusChannelCapability,
} from '../src/host/channel/locus-capability.js'
import { InboundPipeline } from '../src/host/channel/pipeline.js'
import type { LarkInboundEvent } from '../src/host/channel/event.js'

const BOT = 'ou_pet_bot'
const OWNER = 'ou_owner'
const CHAT = 'oc_project'

function event(): LarkInboundEvent {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_message',
    chat_id: CHAT,
    chat_type: 'group',
    message_type: 'text',
    content: '@Pet inspect this',
    create_time: '2000',
    sender_id: OWNER,
    sender_type: 'user',
    mentions: [{ id: BOT, name: 'Pet' }],
  }
}

describe('production unified-locus capability boundary', () => {
  it('leaves the capability absent when the Host exposes no complete service', () => {
    const get = vi.fn((name: string) => {
      expect(name).toBe(LOCUS_CHANNEL_CAPABILITY_SERVICE)
      return undefined
    })
    expect(probeLocusChannelCapability({ get })).toBeUndefined()
    expect(get).toHaveBeenCalledOnce()
  })

  it('preserves an explicit unavailable diagnostic without publishing a controller', () => {
    const capability = {
      kind: 'unified-locus' as const,
      status: 'unavailable' as const,
      diagnostic: 'Unified locus child adapter is not available.',
    }

    expect(probeLocusChannelCapability({ get: () => capability })).toBe(capability)
  })

  it('rejects an unavailable capability with no stable diagnostic', () => {
    expect(
      probeLocusChannelCapability({
        get: () => ({ kind: 'unified-locus', status: 'unavailable', diagnostic: '  ' }),
      }),
    ).toBeUndefined()
  })

  it('returns an available Host capability unchanged', () => {
    const capability = {
      kind: 'unified-locus' as const,
      status: 'available' as const,
      controller: {
        handle: vi.fn(async () => ({ kind: 'ignored' as const, reason: 'test' })),
        dispose: vi.fn(),
      },
    }

    expect(probeLocusChannelCapability({ get: () => capability })).toBe(capability)
  })

  it('preserves legacy assembly when the Host capability is absent', async () => {
    const legacy = {
      locate: vi.fn(() => '/legacy'),
      getChatBinding: vi.fn(() => undefined),
      deliver: vi.fn(async () => ({ kind: 'accepted', invocationId: 'legacy-invocation' })),
    }
    expect(probeLocusChannelCapability({ get: () => undefined })).toBeUndefined()
    const pipeline = new InboundPipeline({
      repository: {
        getChannelConfig: () => ({ enabled: true, botOpenId: BOT, allowOpenIds: [OWNER] }),
        getChatBinding: legacy.getChatBinding,
        findChannelByTriggerMessage: vi.fn(() => undefined),
      } as never,
      coordinator: {} as never,
      client: {
        botReady: vi.fn(async () => true),
        addReaction: vi.fn(async () => 'reaction'),
        removeReaction: vi.fn(async () => undefined),
      } as never,
      locator: { locate: legacy.locate },
      watermark: () => 0,
      qaDelivery: { deliver: legacy.deliver },
    })
    const result = await pipeline.handleEvent(event())
    expect(result.kind).toBe('unroutable')
    expect(legacy.getChatBinding).toHaveBeenCalledWith(CHAT)
    expect(legacy.locate).not.toHaveBeenCalled()
  })

  it('does not publish a capability when per-turn correlation is absent', async () => {
    const capability = createLocusChannelCapability({
      locus: {} as never,
      deliveries: {} as never,
      child: {} as never,
    })

    expect(capability.status).toBe('unavailable')
    expect(capability.diagnostic).toBe(
      'Unified locus channel requires an explicit per-turn correlation observer.',
    )
    expect('controller' in capability).toBe(false)
  })

  it('accepts only a complete per-turn observer capability', () => {
    const unsubscribe = vi.fn()
    const capability = createLocusChannelCapability({
      locus: {} as never,
      deliveries: {} as never,
      child: {} as never,
      turns: {
        perTurnCorrelation: true,
        subscribe: vi.fn(() => unsubscribe),
      },
    })

    expect(capability.status).toBe('available')
    capability.controller.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
