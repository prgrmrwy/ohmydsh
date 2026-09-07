/**
 * End-to-end intake: one inbound line to one Invocation.
 *
 * These exercise the joins the unit tests cannot: that a refusal leaves NO
 * durable trace and sends nothing to Lark, that the reply binding is written
 * before the work runs, and that a message arriving during a wait becomes the
 * answer instead of queued work.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from '../src/host/capture.js'
import { InboundPipeline } from '../src/host/channel/pipeline.js'
import type { LarkChatBot, LarkClient } from '../src/host/channel/lark.js'
import type { WorkspaceLocator } from '../src/host/channel/route.js'
import { PetCoordinator, type PromptDispatcher } from '../src/host/coordinator.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { qaScopeKeyOf } from '../src/host/qa/occupancy.js'
import { scopeKeyOf } from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const BOT = 'ou_023b15a8d3e5de253ffc32182a7dde35'
const OWNER = 'ou_322ec1d3cd062f04bc2b1f4ba1eff8e9'
const STRANGER = 'ou_stranger00000000000000000000'
const GROUP = 'oc_group0000000000000000000000000'
const P2P = 'oc_p2p00000000000000000000000000'

interface Fixture {
  readonly pipeline: InboundPipeline
  readonly client: LarkClient
  readonly harness: PetHarness
  readonly dispatched: { session: string; text: string }[]
  readonly reactions: { messageId: string; emoji: string }[]
  readonly coordinator: PetCoordinator
}

async function fixture(
  options: { defaultWorkspace?: string; chatBots?: readonly LarkChatBot[] } = {},
): Promise<Fixture> {
  const chatBots = options.chatBots ?? [{ appId: 'cli_test', openId: BOT, name: '小小芒果' }]
  const created = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))

  await created.repository.putChannelConfig({
    enabled: true,
    botAppId: 'cli_test',
    botOpenId: BOT,
    allowOpenIds: [OWNER],
    ...(options.defaultWorkspace === undefined
      ? { defaultWorkspaceId: 'ws-nexus' }
      : { defaultWorkspaceId: options.defaultWorkspace }),
    updatedAt: 1,
  })

  const dispatched: { session: string; text: string }[] = []
  const dispatcher: PromptDispatcher = {
    dispatch: vi.fn(async (session: string, text: string) => {
      dispatched.push({ session, text })
    }),
  }
  const agents: AgentRegistryLike = {
    create: vi.fn(async (opts: { sessionId: string }) => ({ session: { id: opts.sessionId } })),
    get: () => ({}),
  } as AgentRegistryLike
  const resolver: SourceResolver = {
    getSession: () => undefined,
    getWorkspace: id => ({ id, title: id }),
  }

  const coordinator = new PetCoordinator({
    repository: created.repository,
    capabilities: new CapabilityRegistry(),
    agents,
    dispatcher,
    resolver,
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  })

  const reactions: { messageId: string; emoji: string }[] = []
  const client: LarkClient = {
    addReaction: vi.fn(async (messageId: string, emoji: string) => {
      reactions.push({ messageId, emoji })
      return 'reaction-1'
    }),
    removeReaction: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => []),
    listChatBots: vi.fn(async () => chatBots),
    chatName: vi.fn(async () => undefined),
    botReady: vi.fn(async () => true),
    reply: vi.fn(async () => undefined),
  }
  const locator: WorkspaceLocator = {
    locate: id => (id === 'ws-nexus' ? target : undefined),
  }

  const pipeline = new InboundPipeline({
    repository: created.repository,
    coordinator,
    client,
    locator,
    watermark: () => 1000,
  })
  return { pipeline, harness: created, dispatched, reactions, coordinator, client }
}

/** A p2p message line as the consumer would emit it. */
function p2pLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'im.message.receive_v1',
    message_id: 'om_1',
    chat_id: P2P,
    chat_type: 'p2p',
    message_type: 'text',
    content: '构建为什么慢',
    create_time: '2000',
    sender_id: OWNER,
    sender_type: 'user',
    ...overrides,
  })
}

/** A group message line mentioning the bot. */
function groupLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'im.message.receive_v1',
    message_id: 'om_g1',
    chat_id: GROUP,
    chat_type: 'group',
    message_type: 'text',
    content: '@小小芒果 看看这个',
    create_time: '2000',
    sender_id: OWNER,
    sender_type: 'user',
    mentions: [{ id: BOT, key: '@_user_1', name: '小小芒果' }],
    ...overrides,
  })
}

describe('accepting an inbound message', () => {
  it('creates work and marks the message in progress', async () => {
    const f = await fixture()
    harness = f.harness

    const outcome = await f.pipeline.handleLine(p2pLine())

    expect(outcome.kind).toBe('accepted')
    expect(f.dispatched).toHaveLength(1)
    expect(f.dispatched[0]?.text).toContain('构建为什么慢')
    expect(f.reactions).toEqual([{ messageId: 'om_1', emoji: 'OnIt' }])
    // Applied BEFORE dispatch: a fast turn settles inside acceptConversation,
    // so reacting afterwards would show the working mark after the fact.
    expect(f.reactions[0]).toBeDefined()
  })

  it('records the reply binding before the work runs', async () => {
    const f = await fixture()
    harness = f.harness

    const outcome = await f.pipeline.handleLine(p2pLine())

    // The binding is the only authority for where an answer may go, so work
    // must never outrun it.
    const invocationId = outcome.kind === 'accepted' ? outcome.invocationId : ''
    const binding = f.harness.repository.getInvocationChannel(invocationId)
    expect(binding).toMatchObject({
      chatId: P2P,
      triggerMessageId: 'om_1',
      senderOpenId: OWNER,
      reactionId: 'reaction-1',
    })
  })

  it('accepts a group message that mentions the bot', async () => {
    const f = await fixture()
    harness = f.harness

    const outcome = await f.pipeline.handleLine(groupLine())

    expect(outcome.kind).toBe('accepted')
    expect(f.harness.repository.getChatBinding(GROUP)?.boundBy).toBe('auto')
  })
})

describe('refusals leave no trace', () => {
  it('ignores a stranger without reacting or storing anything', async () => {
    const f = await fixture()
    harness = f.harness

    const outcome = await f.pipeline.handleLine(p2pLine({ sender_id: STRANGER }))

    expect(outcome).toEqual({ kind: 'ignored', reason: 'not-allowed-sender' })
    // Silence is the contract: no reaction reveals that an agent is behind
    // the bot, and no binding row appears for a chat that never routed.
    expect(f.reactions).toEqual([])
    expect(f.dispatched).toEqual([])
    expect(f.harness.repository.getChatBinding(P2P)).toBeUndefined()
    expect(f.harness.repository.listTasks()).toHaveLength(0)
  })

  it('ignores a group message that mentions someone else', async () => {
    const f = await fixture()
    harness = f.harness

    const outcome = await f.pipeline.handleLine(
      groupLine({ mentions: [{ id: 'ou_other00000000000000000000000', name: 'Aily' }] }),
    )

    expect(outcome).toEqual({ kind: 'ignored', reason: 'no-mention' })
    expect(f.reactions).toEqual([])
  })

  it('ignores everything while the channel is disabled', async () => {
    const f = await fixture()
    harness = f.harness
    const config = f.harness.repository.getChannelConfig()
    await f.harness.repository.putChannelConfig({ ...config, enabled: false })

    const outcome = await f.pipeline.handleLine(p2pLine())

    expect(outcome).toEqual({ kind: 'ignored', reason: 'disabled' })
    expect(f.dispatched).toEqual([])
  })

  it('ignores a redelivered message', async () => {
    const f = await fixture()
    harness = f.harness

    await f.pipeline.handleLine(p2pLine())
    const again = await f.pipeline.handleLine(p2pLine())

    expect(again).toEqual({ kind: 'ignored', reason: 'duplicate' })
    // One dispatch only: a reconnect must not run the request twice.
    expect(f.dispatched).toHaveLength(1)
  })

  it('ignores a redelivery even after the dedup window is lost', async () => {
    const f = await fixture()
    harness = f.harness
    await f.pipeline.handleLine(p2pLine())

    // A fresh pipeline models a Host restart: the in-memory window is empty,
    // and only the durable binding can catch the repeat.
    const restarted = new InboundPipeline({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      client: {
        addReaction: vi.fn(async () => 'r'),
        removeReaction: vi.fn(async () => undefined),
        listMessages: vi.fn(async () => []),
        listChatBots: vi.fn(async () => []),
        chatName: vi.fn(async () => undefined),
        botReady: vi.fn(async () => true),
        reply: vi.fn(async () => undefined),
      },
      locator: { locate: () => '/repos/nexus' },
      watermark: () => 1000,
    })

    expect(await restarted.handleLine(p2pLine())).toEqual({ kind: 'ignored', reason: 'duplicate' })
  })

  it('ignores an unparsable line', async () => {
    const f = await fixture()
    harness = f.harness

    expect(await f.pipeline.handleLine('[event] ready event_key=x')).toEqual({
      kind: 'ignored',
      reason: 'unparsable',
    })
  })
})

describe('unroutable chats', () => {
  it('raises no work when the default workspace does not resolve', async () => {
    const f = await fixture({ defaultWorkspace: 'ws-missing' })
    harness = f.harness

    const outcome = await f.pipeline.handleLine(p2pLine())

    expect(outcome.kind).toBe('unroutable')
    expect(f.dispatched).toEqual([])
    expect(f.harness.repository.listTasks()).toHaveLength(0)
  })
})

describe('answering a waiting Agent', () => {
  it('routes a follow-up message into the waiting Invocation', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.pipeline.handleLine(p2pLine())
    const invocationId = first.kind === 'accepted' ? first.invocationId : ''
    await f.harness.repository.setInvocationStatus(invocationId, 'waiting-user')
    const task = f.harness.repository.findActiveTaskByScope(scopeKeyOf('chat', P2P))
    await f.harness.repository.setTaskStatus(task?.id ?? '', 'waiting-user')

    const second = await f.pipeline.handleLine(
      p2pLine({ message_id: 'om_2', content: '用的是 pnpm' }),
    )

    // Queueing it would leave the Agent waiting for something the user
    // believes they already sent.
    expect(second.kind).toBe('answered')
    expect(f.dispatched).toHaveLength(2)
    expect(f.dispatched[1]?.text).toBe('用的是 pnpm')
  })
})

describe('remembering who asked', () => {
  it('caches the sender display name for the settings list', async () => {
    const f = await fixture()
    harness = f.harness
    // History resolves sender names; the inbound event carries only an id.
    f.client.listMessages = vi.fn(async () => [
      { messageId: 'om_1', senderName: '张勇', text: '构建为什么慢', createTime: '', position: 5 },
    ])

    await f.pipeline.handleLine(p2pLine({ message_id: 'om_1' }))

    expect(f.harness.repository.getChannelConfig().knownNames?.[OWNER]).toBe('张勇')
  })

  it('records nothing when the name is unknown', async () => {
    const f = await fixture()
    harness = f.harness

    await f.pipeline.handleLine(p2pLine())

    // An `unknown` placeholder is worse than no name at all.
    expect(f.harness.repository.getChannelConfig().knownNames ?? {}).toEqual({})
  })
})

describe('learning the bot open_id, proven by app id', () => {
  /** A fixture whose bound bot has an app id but no known open_id yet. */
  async function unknownBotFixture(
    chatBots?: readonly LarkChatBot[],
  ): Promise<Fixture> {
    const f = await fixture(chatBots === undefined ? {} : { chatBots })
    const config = f.harness.repository.getChannelConfig()
    await f.harness.repository.putChannelConfig({
      ...config,
      botAppId: 'cli_test',
      botOpenId: undefined as unknown as string,
    })
    return f
  }

  it('learns the open_id when the member list ties it to the bound app', async () => {
    const f = await unknownBotFixture()
    harness = f.harness

    const outcome = await f.pipeline.handleLine(groupLine())

    // Receiving a group message proves the bot is in that group, which makes
    // the member list — and therefore the app_id proof — available.
    expect(f.harness.repository.getChannelConfig().botOpenId).toBe(BOT)
    expect(outcome.kind).toBe('accepted')
  })

  it('refuses an impostor who merely copied the display name', async () => {
    // The mention names our bot, but the member list says that open_id
    // belongs to a different app. A name can be copied; an app id cannot.
    const f = await unknownBotFixture([
      { appId: 'cli_someone_else', openId: 'ou_impostor0000000000000000000', name: '小小芒果' },
      { appId: 'cli_test', openId: BOT, name: '小小芒果' },
    ])
    harness = f.harness

    const outcome = await f.pipeline.handleLine(
      groupLine({
        mentions: [{ id: 'ou_impostor0000000000000000000', key: '@_user_1', name: '小小芒果' }],
      }),
    )

    expect(f.harness.repository.getChannelConfig().botOpenId).toBeUndefined()
    expect(outcome).toEqual({ kind: 'ignored', reason: 'no-mention' })
  })

  it('stays fail-closed when our app is not in the chat at all', async () => {
    const f = await unknownBotFixture([
      { appId: 'cli_other', openId: 'ou_other00000000000000000000000', name: 'Aily' },
    ])
    harness = f.harness

    const outcome = await f.pipeline.handleLine(groupLine())

    expect(f.harness.repository.getChannelConfig().botOpenId).toBeUndefined()
    expect(outcome).toEqual({ kind: 'ignored', reason: 'no-mention' })
  })

  it('stays fail-closed when the member list cannot be read', async () => {
    const f = await unknownBotFixture([])
    harness = f.harness

    const outcome = await f.pipeline.handleLine(groupLine())

    // No proof, no identity: an unreadable member list must not degrade into
    // trusting the mention.
    expect(f.harness.repository.getChannelConfig().botOpenId).toBeUndefined()
    expect(outcome).toEqual({ kind: 'ignored', reason: 'no-mention' })
  })

  it('does not learn from a mention of some other bot', async () => {
    const f = await unknownBotFixture()
    harness = f.harness

    await f.pipeline.handleLine(
      groupLine({ mentions: [{ id: 'ou_other00000000000000000000000', name: 'Aily' }] }),
    )

    // Our bot is in the chat, but this message was not addressed to it.
    expect(f.harness.repository.getChannelConfig().botOpenId).toBeUndefined()
  })

  it('does not learn without a bound app id', async () => {
    const f = await fixture()
    harness = f.harness
    const config = f.harness.repository.getChannelConfig()
    await f.harness.repository.putChannelConfig({
      ...config,
      botAppId: undefined as unknown as string,
      botOpenId: undefined as unknown as string,
    })

    await f.pipeline.handleLine(groupLine())

    expect(f.harness.repository.getChannelConfig().botOpenId).toBeUndefined()
  })

  it('does not learn from a p2p message', async () => {
    const f = await unknownBotFixture()
    harness = f.harness

    await f.pipeline.handleLine(p2pLine())

    // p2p events carry no mentions, so there is no candidate to prove.
    expect(f.harness.repository.getChannelConfig().botOpenId).toBeUndefined()
  })

  it('leaves an already-known open_id untouched', async () => {
    const f = await fixture()
    harness = f.harness

    await f.pipeline.handleLine(groupLine())

    expect(f.harness.repository.getChannelConfig().botOpenId).toBe(BOT)
  })
})

/**
 * Create a LIVE qa pairing: the binding row plus the unarchived Task that
 * makes the group actually served.
 *
 * Both halves matter. `/unbind` archives the Task and keeps the row — so a
 * fixture that writes only the row describes a released group, and any test
 * built on it would pass even after the group stopped being served.
 */
async function liveQaPairing(
  f: Fixture,
  chatId: string,
  sourceSessionId: string,
  origin: 'created' | 'bound' = 'created',
): Promise<string> {
  const scopeKey = qaScopeKeyOf(sourceSessionId)
  const task = await f.harness.repository.createTask({
    id: `task-${chatId.slice(3, 11)}`,
    scopeKey,
    epoch: await f.harness.repository.allocateEpoch(scopeKey),
    sourceKind: 'qa-chat',
    sourceId: chatId,
    sourceAvailability: 'available',
    executorSessionId: `session-child-${chatId.slice(3, 9)}`,
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
  })
  await f.harness.repository.putChatBinding({
    chatId,
    chatType: 'group',
    kind: 'qa',
    chatName: '答疑 · 测试',
    qaChildSessionId: task.executorSessionId,
    qaParentSessionId: sourceSessionId,
    qaOrigin: origin,
    activeTaskId: task.id,
    boundBy: 'user',
    boundAt: 1,
  })
  return task.id
}

describe('QA group bindings in the intake path', () => {
  const QA_CHAT = 'oc_qagroup00000000000000000000000'

  /** A group line in the QA chat, mentioning the bot. */
  function qaLine(overrides: Record<string, unknown> = {}): string {
    return groupLine({ chat_id: QA_CHAT, message_id: 'om_qa1', ...overrides })
  }

  /** Bind the QA chat to a child, so the intake path sees a qa route. */
  async function bindQa(f: Fixture): Promise<void> {
    // A SERVED group is a row plus a live Task. Writing the row alone would
    // reproduce the bug this fixture is meant to exercise around: after
    // `/unbind` the row survives and only the Task is archived.
    await liveQaPairing(f, QA_CHAT, 'session-source')
  }

  it('admits a sender outside the allowlist', async () => {
    const f = await fixture()
    harness = f.harness
    await bindQa(f)
    const delivered: string[] = []
    const withQa = new InboundPipeline({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      client: f.client,
      locator: { locate: () => undefined },
      watermark: () => 1000,
      qaDelivery: {
        deliver: async event => {
          delivered.push(event.message_id)
          return { kind: 'accepted', invocationId: 'qa-1' }
        },
      },
    })

    const outcome = await withQa.handleLine(qaLine({ sender_id: STRANGER }))

    // Membership is the credential: the owner pulled this person into a group
    // the Host itself created.
    expect(outcome.kind).toBe('accepted')
    expect(delivered).toEqual(['om_qa1'])
  })

  it('does not extend that exemption to other chats', async () => {
    const f = await fixture()
    harness = f.harness
    await bindQa(f)

    const outcome = await f.pipeline.handleLine(groupLine({ sender_id: STRANGER }))

    // Same sender, ordinary group: judged by the allowlist as always.
    expect(outcome).toEqual({ kind: 'ignored', reason: 'not-allowed-sender' })
  })

  it('still requires a mention in a QA group', async () => {
    const f = await fixture()
    harness = f.harness
    await bindQa(f)

    const outcome = await f.pipeline.handleLine(
      qaLine({ sender_id: STRANGER, mentions: [], content: '随口一说' }),
    )

    // Only the sender gate is exempted; a QA group is still a conversation
    // people hold without addressing the bot.
    expect(outcome).toEqual({ kind: 'ignored', reason: 'no-mention' })
  })

  it('refuses rather than falling back when QA delivery is absent', async () => {
    const f = await fixture()
    harness = f.harness
    await bindQa(f)

    const outcome = await f.pipeline.handleLine(qaLine())

    // Falling through to workspace dispatch would answer the group from a
    // fresh executor holding none of the inherited context.
    expect(outcome.kind).toBe('unroutable')
    expect(f.dispatched).toHaveLength(0)
  })

  it('never rewrites a qa binding through default routing', async () => {
    const f = await fixture()
    harness = f.harness
    await bindQa(f)
    const withQa = new InboundPipeline({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      client: f.client,
      locator: { locate: () => undefined },
      watermark: () => 1000,
      qaDelivery: { deliver: async () => ({ kind: 'accepted', invocationId: 'qa-1' }) },
    })

    await withQa.handleLine(qaLine())

    const binding = f.harness.repository.getChatBinding(QA_CHAT)
    expect(binding?.kind).toBe('qa')
    expect(binding?.workspaceId).toBeUndefined()
    expect(binding?.boundBy).toBe('user')
  })
})

describe('the /bind command in the intake path', () => {
  const PLAIN = 'oc_plaingroup00000000000000000000'

  /** A pipeline with bind wired, recording what reached the command port. */
  function withBind(f: Fixture): {
    pipeline: InboundPipeline
    handled: { chatId: string; prefix: string }[]
  } {
    const handled: { chatId: string; prefix: string }[] = []
    const pipeline = new InboundPipeline({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      client: f.client,
      locator: { locate: () => undefined },
      watermark: () => 1000,
      bindCommand: {
        handle: async (event, prefix) => {
          handled.push({ chatId: event.chat_id, prefix })
          return { kind: 'accepted', invocationId: 'bind-1' }
        },
        unbind: async () => ({ kind: 'accepted', invocationId: 'unbind-1' }),
      },
    })
    return { pipeline, handled }
  }

  /** A group line carrying a bind command. */
  function bindLine(overrides: Record<string, unknown> = {}): string {
    return groupLine({
      chat_id: PLAIN,
      message_id: 'om_bind1',
      content: '@小小芒果 /bind abc123',
      ...overrides,
    })
  }

  it('routes an allowlist member\u2019s command to the bind flow', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, handled } = withBind(f)

    const outcome = await pipeline.handleLine(bindLine())

    expect(outcome.kind).toBe('accepted')
    expect(handled).toEqual([{ chatId: PLAIN, prefix: 'abc123' }])
    // It must not also fall through to workspace dispatch.
    expect(f.dispatched).toHaveLength(0)
  })

  it('silently drops a command from a non-allowlist sender', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, handled } = withBind(f)

    const outcome = await pipeline.handleLine(bindLine({ sender_id: STRANGER }))

    // The question exemption does NOT extend to binding: an existing group's
    // members were never vetted for this. And the refusal stays silent —
    // answering "you may not" would confirm an agent stands behind the bot.
    expect(outcome).toEqual({ kind: 'ignored', reason: 'not-allowed-sender' })
    expect(handled).toHaveLength(0)
  })

  it('does not bypass the mention gate', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, handled } = withBind(f)

    const outcome = await pipeline.handleLine(
      bindLine({ mentions: [], content: '/bind abc123' }),
    )

    expect(outcome).toEqual({ kind: 'ignored', reason: 'no-mention' })
    expect(handled).toHaveLength(0)
  })

  it('does not bypass the start-up watermark', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, handled } = withBind(f)

    const outcome = await pipeline.handleLine(bindLine({ create_time: '500' }))

    expect(outcome).toEqual({ kind: 'ignored', reason: 'before-watermark' })
    expect(handled).toHaveLength(0)
  })

  it('does not bypass deduplication', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, handled } = withBind(f)

    await pipeline.handleLine(bindLine())
    const second = await pipeline.handleLine(bindLine())

    expect(second).toEqual({ kind: 'ignored', reason: 'duplicate' })
    expect(handled).toHaveLength(1)
  })

  it('stops recognising the command once the group is bound', async () => {
    const f = await fixture()
    harness = f.harness
    await liveQaPairing(f, PLAIN, 'session-plain', 'bound')
    const delivered: string[] = []
    const pipeline = new InboundPipeline({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      client: f.client,
      locator: { locate: () => undefined },
      watermark: () => 1000,
      qaDelivery: {
        deliver: async event => {
          delivered.push(event.message_id)
          return { kind: 'accepted', invocationId: 'qa-1' }
        },
      },
      bindCommand: {
        handle: async () => {
          throw new Error('bind must not run in an already-bound group')
        },
        unbind: async () => ({ kind: 'accepted', invocationId: 'unbind-1' }),
      },
    })

    const outcome = await pipeline.handleLine(bindLine())

    // In a working QA group the same text is conversation again; re-parsing
    // it would hijack an ordinary question.
    expect(outcome.kind).toBe('accepted')
    expect(delivered).toEqual(['om_bind1'])
  })

  it('leaves non-command messages in unbound groups untouched', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, handled } = withBind(f)

    await pipeline.handleLine(groupLine({ chat_id: PLAIN, content: '@小小芒果 看看这个' }))

    expect(handled).toHaveLength(0)
  })
})

describe('the /unbind command in the intake path', () => {
  const BOUND = 'oc_boundgroup00000000000000000000'

  /** Bind the group so `/unbind` has something to act on. */
  async function bindGroup(f: Fixture): Promise<void> {
    await liveQaPairing(f, BOUND, 'session-source', 'bound')
  }

  function withCommands(f: Fixture): {
    pipeline: InboundPipeline
    unbound: string[]
    delivered: string[]
  } {
    const unbound: string[] = []
    const delivered: string[] = []
    const pipeline = new InboundPipeline({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      client: f.client,
      locator: { locate: () => undefined },
      watermark: () => 1000,
      qaDelivery: {
        deliver: async event => {
          delivered.push(event.message_id)
          return { kind: 'accepted', invocationId: 'qa-1' }
        },
      },
      bindCommand: {
        handle: async () => ({ kind: 'accepted', invocationId: 'bind-1' }),
        unbind: async event => {
          unbound.push(event.chat_id)
          return { kind: 'accepted', invocationId: 'unbind-1' }
        },
      },
    })
    return { pipeline, unbound, delivered }
  }

  it('is recognised in a bound group', async () => {
    const f = await fixture()
    harness = f.harness
    await bindGroup(f)
    const { pipeline, unbound, delivered } = withCommands(f)

    await pipeline.handleLine(
      groupLine({ chat_id: BOUND, message_id: 'om_u1', content: '@小小芒果 /unbind' }),
    )

    // The two verbs live on opposite sides of the same condition.
    expect(unbound).toEqual([BOUND])
    expect(delivered).toHaveLength(0)
  })

  it('is ordinary text in an unbound group', async () => {
    const f = await fixture()
    harness = f.harness
    const { pipeline, unbound } = withCommands(f)

    await pipeline.handleLine(
      groupLine({ chat_id: 'oc_nothingbound0000000000000000', content: '@小小芒果 /unbind' }),
    )

    expect(unbound).toHaveLength(0)
  })

  it('silently drops a non-allowlist sender', async () => {
    const f = await fixture()
    harness = f.harness
    await bindGroup(f)
    const { pipeline, unbound } = withCommands(f)

    const outcome = await pipeline.handleLine(
      groupLine({
        chat_id: BOUND,
        message_id: 'om_u2',
        content: '@小小芒果 /unbind',
        sender_id: STRANGER,
      }),
    )

    // Asking questions is exempt from the allowlist in a QA group; ending the
    // binding is not.
    expect(outcome).toEqual({ kind: 'ignored', reason: 'not-allowed-sender' })
    expect(unbound).toHaveLength(0)
  })

  it('leaves ordinary questions in a bound group alone', async () => {
    const f = await fixture()
    harness = f.harness
    await bindGroup(f)
    const { pipeline, unbound, delivered } = withCommands(f)

    await pipeline.handleLine(
      groupLine({ chat_id: BOUND, message_id: 'om_q9', content: '@小小芒果 这个怎么解' }),
    )

    expect(unbound).toHaveLength(0)
    expect(delivered).toEqual(['om_q9'])
  })
})
