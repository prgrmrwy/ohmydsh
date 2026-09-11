import { describe, expect, it } from 'vitest'
import type { LarkInboundEvent } from '../src/host/channel/event.js'
import {
  admitLocusEvent,
  createDurableLocusAuthorizationResolver,
  extractLocusEndpoint,
  locusEndpointKey,
  LocusMessageDedup,
  parseLocusControlCommand,
  resolveLocusAuthorization,
  type LocusAdmissionContext,
} from '../src/host/locus/admission.js'

const BOT = 'ou_pet_bot'
const OWNER = 'ou_owner'
const MEMBER = 'ou_member'
const STRANGER = 'ou_stranger'
const GROUP = 'oc_project'
const P2P = 'oc_private'
const THREAD = 'omt_review'
const ROOT = 'om_root'

function groupEvent(overrides: Partial<LarkInboundEvent> = {}): LarkInboundEvent {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_message',
    chat_id: GROUP,
    chat_type: 'group',
    message_type: 'text',
    content: '@Pet investigate this',
    create_time: '2000',
    sender_id: MEMBER,
    sender_type: 'user',
    mentions: [{ id: BOT, name: 'Pet' }],
    ...overrides,
  }
}

function p2pEvent(overrides: Partial<LarkInboundEvent> = {}): LarkInboundEvent {
  return {
    ...groupEvent(),
    message_id: 'om_private_message',
    chat_id: P2P,
    chat_type: 'p2p',
    content: '@Pet hello',
    sender_id: OWNER,
    ...overrides,
  }
}

function context(overrides: Partial<LocusAdmissionContext> = {}): LocusAdmissionContext {
  return {
    botOpenId: BOT,
    allowOpenIds: [OWNER],
    watermark: 1000,
    isDuplicate: () => false,
    ...overrides,
  }
}

describe('durable production authorization resolver', () => {
  it('maps only an active current generation to authorized', () => {
    const byState = (state: 'active' | 'switching' | 'invalid' | 'retired' | 'stopped') =>
      createDurableLocusAuthorizationResolver(
        { getLatestLocusByEndpoint: () => ({ state }) },
        { find: () => undefined },
      )({ chatId: GROUP, key: GROUP })

    expect(byState('active')).toMatchObject({ state: 'authorized' })
    expect(byState('switching')).toBe('retired')
    expect(byState('invalid')).toBe('retired')
    expect(byState('retired')).toBe('retired')
    expect(byState('stopped')).toBe('retired')
  })

  it('distinguishes never-created from legacy and propagates lookup failures', () => {
    const fresh = createDurableLocusAuthorizationResolver(
      { getLatestLocusByEndpoint: () => undefined },
      { find: () => undefined },
    )
    const legacy = createDurableLocusAuthorizationResolver(
      { getLatestLocusByEndpoint: () => undefined },
      { find: () => ({ historical: true }) },
    )
    const unresolved = createDurableLocusAuthorizationResolver(
      { getLatestLocusByEndpoint: () => { throw new Error('storage unavailable') } },
      { find: () => undefined },
    )

    expect(fresh({ chatId: GROUP, key: GROUP })).toBe('uninitialized')
    expect(legacy({ chatId: GROUP, key: GROUP })).toBe('legacy')
    expect(() => unresolved({ chatId: GROUP, key: GROUP })).toThrow('storage unavailable')
    const topicFromActiveGroup = createDurableLocusAuthorizationResolver(
      {
        getLatestLocusByEndpoint: endpoint => endpoint.threadId === undefined
          ? { id: 'locus-group', state: 'active' }
          : undefined,
      },
      { find: () => undefined },
    )
    expect(topicFromActiveGroup({ chatId: GROUP, threadId: THREAD, key: `${GROUP}\u0000${THREAD}` }))
      .toEqual({ state: 'authorized', locusId: 'locus-group', needsInitialization: true })
    expect(admitLocusEvent(groupEvent({ thread_id: THREAD }), context({
      authorization: topicFromActiveGroup,
      allowOpenIds: [],
    }))).toMatchObject({ admit: true, authorization: 'authorized', needsInitialization: true })

    expect(admitLocusEvent(groupEvent(), context({ authorization: unresolved }))).toMatchObject({
      admit: false,
      reason: 'authorization-unresolved',
    })
  })
})

describe('Locus endpoint extraction', () => {
  it('uses the stable thread id and keeps chat-only and topic keys distinct', () => {
    const topic = extractLocusEndpoint(groupEvent({ thread_id: THREAD }))
    const chat = extractLocusEndpoint(groupEvent({ thread_id: undefined }))

    expect(topic).toEqual({
      ok: true,
      endpoint: { chatId: GROUP, threadId: THREAD, key: locusEndpointKey(GROUP, THREAD) },
    })
    expect(chat).toEqual({
      ok: true,
      endpoint: { chatId: GROUP, key: locusEndpointKey(GROUP) },
    })
    expect(topic.ok && chat.ok && topic.endpoint.key).not.toBe(chat.ok && chat.endpoint.key)
  })

  it('fails closed when only root_id or reply_to is available', () => {
    expect(extractLocusEndpoint(groupEvent({ root_id: ROOT }))).toEqual({
      ok: false,
      reason: 'ambiguous-thread',
    })
    expect(extractLocusEndpoint(groupEvent({ reply_to: 'om_reply_without_thread' }))).toEqual({
      ok: false,
      reason: 'ambiguous-thread',
    })
  })

  it('refuses conflicting fallback thread facts', () => {
    expect(
      extractLocusEndpoint(groupEvent({ root_id: ROOT, reply_to: 'om_other_root' })),
    ).toEqual({ ok: false, reason: 'ambiguous-thread' })
  })

  it('does not let an incidental root message override a canonical thread id', () => {
    expect(
      extractLocusEndpoint(groupEvent({ thread_id: THREAD, root_id: ROOT, reply_to: 'om_parent' })),
    ).toEqual({
      ok: true,
      endpoint: { chatId: GROUP, threadId: THREAD, key: locusEndpointKey(GROUP, THREAD) },
    })
  })

  it('fails closed for malformed chat or thread identifiers', () => {
    expect(extractLocusEndpoint(groupEvent({ chat_id: ' oc_bad' }))).toEqual({
      ok: false,
      reason: 'invalid-chat',
    })
    expect(extractLocusEndpoint(groupEvent({ thread_id: 'bad thread' }))).toEqual({
      ok: false,
      reason: 'invalid-thread',
    })
  })
})

describe('control command parsing', () => {
  it.each([
    ['@Pet /bind abc123', { kind: 'bind', prefix: 'abc123' }],
    ['@Pet -b abc123', { kind: 'bind', prefix: 'abc123' }],
    ['@Pet --bind abc123', { kind: 'bind', prefix: 'abc123' }],
    ['@Pet --bind=abc123', { kind: 'bind', prefix: 'abc123' }],
    ['@Pet -s read', { kind: 'scope', mode: 'read' }],
    ['@Pet --scope write', { kind: 'scope', mode: 'write' }],
    ['@Pet --scope=read', { kind: 'scope', mode: 'read' }],
    ['@Pet /unbind', { kind: 'unbind' }],
  ] as const)('recognizes %s', (text, expected) => {
    expect(parseLocusControlCommand(text)).toEqual(expected)
  })

  it('keeps malformed control verbs on the control surface', () => {
    expect(parseLocusControlCommand('@Pet /bind')).toEqual({ kind: 'bind-missing-prefix' })
    expect(parseLocusControlCommand('@Pet -s')).toEqual({ kind: 'scope-missing-mode' })
    expect(parseLocusControlCommand('@Pet --scope execute')).toEqual({
      kind: 'scope-invalid',
      value: 'execute',
    })
    expect(parseLocusControlCommand('@Pet /unbind now')).toEqual({ kind: 'unbind-invalid' })
    expect(parseLocusControlCommand('@Pet /bind abc123 extra')).toEqual({ kind: 'bind-invalid' })
  })

  it('does not treat ordinary prose as a command', () => {
    expect(parseLocusControlCommand('@Pet please bind abc123')).toEqual({ kind: 'none' })
    expect(parseLocusControlCommand('a /bind abc123')).toEqual({ kind: 'none' })
  })
})

describe('unified Locus admission', () => {
  it('requires an explicit mention in both group and p2p messages', () => {
    expect(admitLocusEvent(groupEvent({ mentions: [] }), context())).toMatchObject({
      admit: false,
      reason: 'no-mention',
    })
    expect(admitLocusEvent(p2pEvent({ mentions: [] }), context())).toMatchObject({
      admit: false,
      reason: 'no-mention',
    })
  })

  it('allows an allowlisted sender to bootstrap an uninitialized endpoint', () => {
    const result = admitLocusEvent(
      groupEvent({ sender_id: OWNER, content: '@Pet /bind abc123' }),
      context(),
    )
    expect(result).toMatchObject({
      admit: true,
      authorization: 'uninitialized',
      needsInitialization: true,
      command: { kind: 'bind', prefix: 'abc123' },
    })
  })

  it('allows non-allowlisted members to ask an authorized group locus', () => {
    const result = admitLocusEvent(groupEvent(), context({ authorizedChats: [GROUP] }))
    expect(result).toMatchObject({ admit: true, authorization: 'authorized' })
  })

  it('never lets group authorization grant control commands', () => {
    expect(
      admitLocusEvent(
        groupEvent({ content: '@Pet -s write' }),
        context({ authorizedChats: [GROUP] }),
      ),
    ).toMatchObject({ admit: false, reason: 'control-not-allowed' })
  })

  it('rejects strangers on an uninitialized endpoint without creating auth state', () => {
    expect(admitLocusEvent(groupEvent({ sender_id: STRANGER }), context())).toMatchObject({
      admit: false,
      reason: 'not-allowed-sender',
    })
  })

  it.each([
    ['retired', 'retired-endpoint'],
    ['legacy', 'legacy-endpoint'],
  ] as const)('does not fall through a %s endpoint', (state, reason) => {
    expect(
      admitLocusEvent(groupEvent({ sender_id: OWNER }), context({ authorizationState: state })),
    ).toMatchObject({ admit: false, reason, authorization: state })
  })

  it.each(['legacy', 'retired'] as const)(
    'allows only an allowlisted explicit bind through a protected %s marker',
    state => {
      expect(admitLocusEvent(
        groupEvent({ sender_id: OWNER, content: '@Pet /bind abc123' }),
        context({ authorizationState: state }),
      )).toMatchObject({
        admit: true,
        authorization: state,
        command: { kind: 'bind', prefix: 'abc123' },
      })
      expect(admitLocusEvent(
        groupEvent({ sender_id: STRANGER, content: '@Pet /bind abc123' }),
        context({ authorizationState: state }),
      )).toMatchObject({ admit: false, reason: 'control-not-allowed' })
      expect(admitLocusEvent(
        groupEvent({ sender_id: OWNER, content: '@Pet ordinary work' }),
        context({ authorizationState: state }),
      )).toMatchObject({ admit: false, reason: `${state}-endpoint` })
    },
  )

  it('uses the exact endpoint for authorization, not a broad old chat predicate', () => {
    const seen: string[] = []
    const result = admitLocusEvent(
      groupEvent({ thread_id: THREAD }),
      context({
        authorizedChats: undefined,
        authorization: endpoint => {
          seen.push(endpoint.key)
          return endpoint.threadId === THREAD ? 'authorized' : 'uninitialized'
        },
      }),
    )
    expect(seen).toEqual([locusEndpointKey(GROUP, THREAD)])
    expect(result).toMatchObject({ admit: true, authorization: 'authorized' })
  })

  it('applies duplicate, watermark, type, and content checks before admission', () => {
    expect(admitLocusEvent(groupEvent(), context({ isDuplicate: () => true }))).toMatchObject({
      admit: false,
      reason: 'duplicate',
    })
    expect(
      admitLocusEvent(groupEvent({ create_time: '500' }), context()),
    ).toMatchObject({ admit: false, reason: 'before-watermark' })
    expect(
      admitLocusEvent(groupEvent({ message_type: 'image' }), context()),
    ).toMatchObject({ admit: false, reason: 'unsupported-message-type' })
    expect(admitLocusEvent(groupEvent({ content: '  ' }), context())).toMatchObject({
      admit: false,
      reason: 'empty-content',
    })
  })

  it('returns the normalized text and exact endpoint on success', () => {
    const result = admitLocusEvent(
      groupEvent({
        thread_id: THREAD,
        content: '  @Pet  inspect the topic  ',
        sender_id: OWNER,
      }),
      context(),
    )
    expect(result).toEqual({
      admit: true,
      endpoint: { chatId: GROUP, threadId: THREAD, key: locusEndpointKey(GROUP, THREAD) },
      text: '@Pet  inspect the topic',
      senderId: OWNER,
      authorization: 'uninitialized',
      needsInitialization: true,
    })
  })
})

describe('Locus replay helper', () => {
  it('deduplicates within a window and forgets expired ids', () => {
    const dedup = new LocusMessageDedup(1_000)
    expect(dedup.check('om_1', 0)).toBe(false)
    expect(dedup.check('om_1', 500)).toBe(true)
    expect(dedup.check('om_1', 2_000)).toBe(false)
  })
})

describe('authorization snapshot lookup', () => {
  it('uses endpoint-specific state before broad chat defaults', () => {
    const endpoint = {
      chatId: GROUP,
      threadId: THREAD,
      key: locusEndpointKey(GROUP, THREAD),
    }
    expect(
      resolveLocusAuthorization(
        endpoint,
        context({
          authorizationByEndpoint: { [endpoint.key]: 'retired' },
          authorizedChats: [GROUP],
        }),
      ),
    ).toBe('retired')
  })
})
