import { describe, expect, it } from 'vitest'
import type { LarkInboundEvent } from '../src/host/channel/event.js'
import { admitNormalizedLocusEvent } from '../src/host/channel/locus-controller.js'
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

/** A v20 store: rows by endpoint key, and the W behind each M. */
function v20Store(rows: Record<string, Record<string, unknown>>, mains: Record<string, string> = { M1: 'W1' }) {
  return {
    getRow: (endpoint: { chatId: string; threadId?: string }) =>
      rows[endpoint.threadId === undefined ? endpoint.chatId : `${endpoint.chatId}#${endpoint.threadId}`] as never,
    findMain: (id: string) => (mains[id] === undefined ? undefined : { workSessionId: mains[id] }) as never,
  }
}

function groupRow(state: string, extra: Record<string, unknown> = {}) {
  return { endpoint: { chatId: GROUP }, locusId: 'locus-group', sessionId: 's-g', state, accessMode: 'read-only', revision: 1, locusMainSessionId: 'M1', workspaceId: 'ws', ...extra }
}

describe('durable production authorization resolver', () => {
  it('maps only a serving row to authorized, and separates owner exits from Host judgements', () => {
    const byState = (state: 'not-created' | 'active' | 'invalid' | 'stopped') =>
      createDurableLocusAuthorizationResolver(v20Store({ [GROUP]: groupRow(state) }))({ chatId: GROUP, key: GROUP })

    expect(byState('active')).toMatchObject({ state: 'authorized', locusId: 'locus-group' })
    expect(byState('not-created')).toMatchObject({ state: 'authorized' })
    // Owner decision: stays terminal for ordinary work.
    expect(byState('stopped')).toBe('retired')
    // Host judgement: the next authorized @ rebuilds in place (D7).
    expect(byState('invalid')).toBe('unusable')
  })

  it('spec Scenario "文档与群标识不串键": key, authorization lookup and correlation never cross categories', () => {
    const token = 'Dx0000000000000000000000001'
    const docRoot = `doc:docx:${token}`
    const seen: string[] = []
    const resolver = createDurableLocusAuthorizationResolver({
      getRow: (endpoint: { chatId: string; threadId?: string }) => {
        seen.push(endpoint.chatId)
        return (endpoint.chatId === docRoot ? { ...groupRow('active'), endpoint: { chatId: docRoot } } : undefined) as never
      },
      findMain: () => ({ workSessionId: 'W1' }) as never,
    })

    expect(resolver({ chatId: docRoot, key: docRoot })).toMatchObject({ state: 'authorized' })
    expect(resolver({ chatId: token, key: token })).toBe('uninitialized')
    expect(seen).toEqual([docRoot, token])
  })

  // D7: an archived W takes the entry out of service without rewriting `state`.
  it('treats an archived work session as an owner action, never as Host-replaceable', () => {
    const byState = (state: 'active' | 'invalid', archived: boolean) =>
      createDurableLocusAuthorizationResolver(
        v20Store({ [GROUP]: groupRow(state, state === 'invalid' ? { invalidReason: 'lost' } : {}) }),
        id => archived && id === 'W1',
      )({ chatId: GROUP, key: GROUP })

    expect(byState('active', true)).toMatchObject({ state: 'retired', reason: 'source-archived' })
    expect(byState('invalid', true)).toMatchObject({ state: 'retired', reason: 'source-archived' })
    expect(byState('active', false)).toMatchObject({ state: 'authorized' })
    expect(byState('invalid', false)).toBe('unusable')

    // A topic row reads its W through the GROUP row's M.
    const topic = createDurableLocusAuthorizationResolver(
      v20Store({
        [GROUP]: groupRow('active'),
        [`${GROUP}#${THREAD}`]: { endpoint: { chatId: GROUP, threadId: THREAD }, locusId: 'locus-t', sessionId: 's-t', state: 'active', accessMode: 'read-only', revision: 1 },
      }),
      id => id === 'W1',
    )
    expect(topic({ chatId: GROUP, threadId: THREAD, key: locusEndpointKey(GROUP, THREAD) }))
      .toMatchObject({ state: 'retired', reason: 'source-archived' })

    // A probe that cannot answer must never take a working endpoint down.
    expect(createDurableLocusAuthorizationResolver(
      v20Store({ [GROUP]: groupRow('active') }),
      () => { throw new Error('registry unavailable') },
    )({ chatId: GROUP, key: GROUP })).toMatchObject({ state: 'authorized' })
  })

  it('distinguishes never-created entries and propagates lookup failures', () => {
    const fresh = createDurableLocusAuthorizationResolver(v20Store({}))
    const unresolved = createDurableLocusAuthorizationResolver({
      getRow: () => { throw new Error('storage unavailable') },
      findMain: () => undefined,
    })

    expect(fresh({ chatId: GROUP, key: GROUP })).toBe('uninitialized')
    expect(() => unresolved({ chatId: GROUP, key: GROUP })).toThrow('storage unavailable')
    const topicFromActiveGroup = createDurableLocusAuthorizationResolver(v20Store({ [GROUP]: groupRow('active') }))
    expect(topicFromActiveGroup({ chatId: GROUP, threadId: THREAD, key: locusEndpointKey(GROUP, THREAD) }))
      .toEqual({ state: 'authorized', locusId: 'locus-group', needsInitialization: true })
    expect(admitLocusEvent(groupEvent({ thread_id: THREAD }), context({
      authorization: topicFromActiveGroup,
      allowOpenIds: [],
    }))).toMatchObject({ admit: true, authorization: 'authorized', needsInitialization: true })

    // Regression: a brand-new group resolves to the BARE STRING 'uninitialized'
    // (no stored row). Reading only an object flag made needsInitialization
    // false, so `resolveLocus` refused to bootstrap and the admitted @bot was
    // dropped as `locus-unavailable` with no diagnostic — observed live on
    // devbox. The state itself must carry the bootstrap intent.
    expect(admitLocusEvent(
      groupEvent({ sender_id: OWNER, content: '@Pet 你好' }),
      context({ authorization: () => 'uninitialized' }),
    )).toMatchObject({ admit: true, authorization: 'uninitialized', needsInitialization: true })

    // A Host-invalidated generation bootstraps exactly like a never-seen
    // endpoint. Observed on devbox: the only locus went `invalid` after a
    // restart (`child-session-access-failed`), was then reported as `retired`,
    // and every @bot was refused with "rebuild it" — while the rebuild itself
    // could not run, because the parent that generation recorded had been
    // archived. The owner never exited anything, so there is no exit to honour.
    expect(admitLocusEvent(
      groupEvent({ sender_id: OWNER, content: '@Pet 你好' }),
      context({ authorization: () => 'unusable' }),
    )).toMatchObject({ admit: true, authorization: 'unusable', needsInitialization: true })

    // The allowlist gate is unchanged: an ordinary member still cannot
    // bootstrap a replacement for an invalidated endpoint.
    expect(admitLocusEvent(
      groupEvent({ content: '@Pet 你好' }),
      context({ authorization: () => 'unusable', allowOpenIds: [] }),
    )).toMatchObject({ admit: false, reason: 'not-allowed-sender' })

    // An owner-exited endpoint is still terminal for ordinary work.
    expect(admitLocusEvent(
      groupEvent({ sender_id: OWNER, content: '@Pet 你好' }),
      context({ authorization: () => 'retired' }),
    )).toMatchObject({ admit: false, reason: 'retired-endpoint' })

    expect(admitLocusEvent(groupEvent(), context({ authorization: unresolved }))).toMatchObject({
      admit: false,
      reason: 'authorization-unresolved',
    })
  })
})

/**
 * The channel controller re-gates what admission already decided, so a state
 * that admission admits can still be dropped one layer later.
 *
 * That is exactly what happened when `unusable` was introduced: the tests above
 * passed (admission admitted it), but the controller still carried a local
 * `'authorized' | 'uninitialized'` allowlist and rejected the message as
 * `authorization-unresolved`. The deadlock the new state existed to remove
 * survived, wearing a different reason code, and both machines' bots went
 * silent. These cases pin the END-TO-END outcome, not just admission's.
 */
describe('normalized channel admission outcome', () => {
  const outcome = (authorization: () => unknown) => admitNormalizedLocusEvent(
    groupEvent({ sender_id: OWNER, content: '@Pet 你好' }),
    context({ authorization: authorization as never }),
  )

  it('accepts an existing locus', () => {
    expect(outcome(() => 'authorized')).toMatchObject({
      kind: 'accepted',
      authorization: 'authorized',
    })
  })

  it('accepts a never-seen endpoint for bootstrap', () => {
    expect(outcome(() => 'uninitialized')).toMatchObject({
      kind: 'accepted',
      authorization: 'uninitialized',
      needsInitialization: true,
    })
  })

  // The regression: a generation the Host invalidated carries no owner
  // decision, so it must bootstrap exactly like a never-seen endpoint. It was
  // admitted by `admitLocusEvent` and then rejected right here.
  it('accepts a Host-invalidated generation for bootstrap', () => {
    expect(outcome(() => 'unusable')).toMatchObject({
      kind: 'accepted',
      authorization: 'unusable',
      needsInitialization: true,
    })
  })

  it('still refuses an owner-exited endpoint', () => {
    expect(outcome(() => 'retired')).toMatchObject({ kind: 'rejected', reason: 'retired-endpoint' })
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

  // A quote/reply on a regular group's timeline sets `root_id`/`reply_to` to
  // the quoted message and sets NO `thread_id` (measured 2026-09-16). Those are
  // message-level facts, so such a message still belongs to the CHAT entry;
  // reading them as thread evidence is what silently dropped every quoted
  // question.
  it('keeps a quoted group message on the chat entry', () => {
    expect(extractLocusEndpoint(groupEvent({ root_id: ROOT }))).toEqual({
      ok: true,
      endpoint: { chatId: GROUP, key: locusEndpointKey(GROUP) },
    })
    expect(extractLocusEndpoint(groupEvent({ reply_to: 'om_reply_without_thread' }))).toEqual({
      ok: true,
      endpoint: { chatId: GROUP, key: locusEndpointKey(GROUP) },
    })
  })

  it('keeps a chained timeline reply on the chat entry when root and parent differ', () => {
    expect(
      extractLocusEndpoint(groupEvent({ root_id: ROOT, reply_to: 'om_other_root' })),
    ).toEqual({ ok: true, endpoint: { chatId: GROUP, key: locusEndpointKey(GROUP) } })
  })

  it('drops an unusable optional reply fact instead of the whole message', () => {
    expect(
      extractLocusEndpoint(groupEvent({ root_id: ROOT, reply_to: ' om_bad' })),
    ).toEqual({ ok: true, endpoint: { chatId: GROUP, key: locusEndpointKey(GROUP) } })
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
    ['@Pet /access read', { kind: 'access', mode: 'read-only' }],
    ['@Pet /access full', { kind: 'access', mode: 'danger-full-access' }],
    ['@Pet -a FULL', { kind: 'access', mode: 'danger-full-access' }],
    ['@Pet --access read', { kind: 'access', mode: 'read-only' }],
    ['@Pet --access=full', { kind: 'access', mode: 'danger-full-access' }],
    ['@Pet /unbind', { kind: 'unbind' }],
  ] as const)('recognizes %s', (text, expected) => {
    expect(parseLocusControlCommand(text)).toEqual(expected)
  })

  // spec Scenario "旧命令不再改变状态" (parser half; the receipt is control.ts, owner B):
  // the old tier verbs stay on the control surface, so they never reach the
  // work path, but parse to a kind that carries no mode at all.
  it.each([
    ['@Pet /scope write', '/scope write'],
    ['@Pet -s write', '-s write'],
    ['@Pet --scope=read', '--scope=read'],
    ['@Pet /tools shell', '/tools shell'],
    ['@Pet -t shell', '-t shell'],
    ['@Pet --tools=safe', '--tools=safe'],
    ['@Pet -s', '-s'],
    ['@Pet -t admin', '-t admin'],
  ] as const)('parses the removed tier command %s as deprecated-tier', (text, original) => {
    expect(parseLocusControlCommand(text)).toEqual({ kind: 'deprecated-tier', original })
  })

  it('keeps malformed control verbs on the control surface', () => {
    expect(parseLocusControlCommand('@Pet /bind')).toEqual({ kind: 'bind-missing-prefix' })
    expect(parseLocusControlCommand('@Pet /access')).toEqual({ kind: 'access-missing-mode' })
    expect(parseLocusControlCommand('@Pet -a write')).toEqual({ kind: 'access-invalid', value: 'write' })
    expect(parseLocusControlCommand('@Pet /access full now')).toEqual({ kind: 'access-invalid', value: 'full now' })
    expect(parseLocusControlCommand('@Pet --access=')).toEqual({ kind: 'access-invalid', value: '' })
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

  it('enforces owner-only admission for full-access entries and leaves allowlisted senders admitted', () => {
    expect(admitLocusEvent(groupEvent(), context({
      authorizedChats: [GROUP],
      accessMode: endpoint => endpoint.chatId === GROUP ? 'danger-full-access' : 'read-only',
    }))).toMatchObject({ admit: false, reason: 'owner-only-tier', authorization: 'authorized' })
    expect(admitLocusEvent(groupEvent({ sender_id: OWNER }), context({
      authorizedChats: [GROUP],
      accessMode: () => 'danger-full-access',
    }))).toMatchObject({ admit: true, authorization: 'authorized' })
  })

  it.each(['not-created', 'active'] as const)('spec Scenario "完全访问入口拒绝非 allowlist 成员" (%s)', state => {
    // The production resolver answers accessMode from the row in EVERY state.
    const rows: Record<string, Record<string, unknown>> = { [GROUP]: groupRow(state, { accessMode: 'danger-full-access' }) }
    const resolver = createDurableLocusAuthorizationResolver(v20Store(rows))
    expect(resolver.accessMode?.({ chatId: GROUP, key: GROUP })).toBe('danger-full-access')
    const member = () => admitLocusEvent(groupEvent({ content: '@Pet 帮我看看' }), context({
      authorization: resolver,
      accessMode: resolver.accessMode,
      allowOpenIds: [OWNER],
    }))
    // No Delivery is created: admission refuses with the owner-only reason.
    expect(member()).toMatchObject({ admit: false, reason: 'owner-only-tier' })
    // Back to read-only: the same member's at is admitted again.
    rows[GROUP] = groupRow(state, { accessMode: 'read-only' })
    expect(member()).toMatchObject({ admit: true, authorization: 'authorized' })
  })

  it('does not let a non-allowlisted sender run access or deprecated tier control commands', () => {
    expect(admitLocusEvent(groupEvent({ content: '@Pet /access full' }), context({ authorizedChats: [GROUP] })))
      .toMatchObject({ admit: false, reason: 'control-not-allowed' })
    expect(admitLocusEvent(groupEvent({ content: '@Pet -t shell' }), context({ authorizedChats: [GROUP] })))
      .toMatchObject({ admit: false, reason: 'control-not-allowed' })
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
  ] as const)('does not fall through a %s endpoint', (state, reason) => {
    expect(
      admitLocusEvent(groupEvent({ sender_id: OWNER }), context({ authorizationState: state })),
    ).toMatchObject({ admit: false, reason, authorization: state })
  })

  it.each(['retired'] as const)(
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
