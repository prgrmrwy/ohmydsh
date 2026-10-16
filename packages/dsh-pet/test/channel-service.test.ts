/**
 * The assembled channel service.
 *
 * Covers what only the assembly can prove: that the channel stays off until
 * configuration says otherwise, that a settled Invocation produces its
 * terminal feedback, and that a Lark failure during feedback cannot escape
 * into the caller — the projection that calls it also settles Pet's own
 * state, and an exception there would strand the Task.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry } from '../src/host/capture.js'
import { ChannelService, safeIgnoredReason } from '../src/host/channel/service.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import { PetCoordinator } from '../src/host/coordinator.js'
import { openPetHarness, type PetHarness } from './harness.js'
import { compactCommentEvent, compactImMessage, SUBSCRIBE_STDERR } from './fixtures/lark-subscribe.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

interface Fixture {
  readonly service: ChannelService
  readonly harness: PetHarness
  readonly client: LarkClient
  readonly coordinator: PetCoordinator
  readonly added: { messageId: string; emoji: string }[]
  readonly replies: { messageId: string; text: string }[]
  readonly changes: number[]
  readonly logs: string[]
}

/** A lark-cli stand-in that reports one canned outcome. */
function fakeCli(output: string, exitCode: number): ChildProcess {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>
  const stdout = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
  const stderr = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
  stdout.setEncoding = () => undefined
  stderr.setEncoding = () => undefined
  child['stdout'] = stdout
  child['stderr'] = stderr
  child['stdin'] = { end: () => undefined }
  child['exitCode'] = null
  child['kill'] = () => true
  queueMicrotask(() => {
    stdout.emit('data', output)
    child.emit('exit', exitCode)
  })
  return child as unknown as ChildProcess
}

async function fixture(
  options: {
    failing?: boolean
    cliOutput?: string
    cliExit?: number
    commentIntake?: (line: string) => Promise<void>
    subscriptionSpawnProcess?: (command: string, args: readonly string[]) => ChildProcess
    imPreconditions?: () => Promise<{ readonly blocked: readonly string[] } | undefined>
    knownWorkspaces?: readonly string[]
  } = {},
): Promise<Fixture> {
  const created = await openPetHarness()
  const added: { messageId: string; emoji: string }[] = []
  const replies: { messageId: string; text: string }[] = []
  const changes: number[] = []
  const logs: string[] = []

  const client: LarkClient = {
    addReaction: vi.fn(async (messageId: string, emoji: string) => {
      if (options.failing === true) throw new Error('lark is down')
      added.push({ messageId, emoji })
      return 'reaction-1'
    }),
    removeReaction: vi.fn(async () => {
      if (options.failing === true) throw new Error('lark is down')
    }),
    listMessages: vi.fn(async () => []),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => undefined),
    cliVersion: vi.fn(async () => ({ supported: true, version: '1.0.97' })),
    eventConnectionCount: vi.fn(async () => ({ kind: 'count' as const, count: 0 })),
    imPreconditions: vi.fn(options.imPreconditions ?? (async () => ({ blocked: [] }))),
    botReady: vi.fn(async () => true),
    botIdentity: vi.fn(async expectedAppId => ({
      kind: 'ready' as const,
      identity: {
        appId: expectedAppId,
        openId: 'ou_petbot00000000000000000000000',
        name: 'Pet Bot',
      },
    })),
    reply: vi.fn(async (messageId: string, text: string) => {
      if (options.failing === true) throw new Error('lark is down')
      replies.push({ messageId, text })
    }),
  }

  const coordinator = new PetCoordinator({
    repository: created.repository,
    capabilities: new CapabilityRegistry(),
    agents: {
      create: async (opts: { sessionId: string }) => ({ agent: { id: opts.sessionId }, dispose: async () => {} }),
      get: () => ({ id: 'service-test' }),
    } as never,
    dispatcher: { dispatch: async () => {} },
    resolver: { getSession: () => undefined, getWorkspace: () => undefined },
    contextProviders: new SourceContextRegistry(),
    workspacePath: '/tmp/pet',
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  } as never)

  const service = new ChannelService({
    repository: created.repository,
    coordinator,
    locator: { locate: (id: string) => (options.knownWorkspaces === undefined || options.knownWorkspaces.includes(id) ? '/repos/acme' : undefined) },
    client,
    unifiedLocusReadiness: {
      childSession: 'verified',
      defaultPermission: 'read',
      readVerification: 'verified',
    },
    ...(options.commentIntake === undefined ? {} : { commentIntake: options.commentIntake }),
    ...(options.subscriptionSpawnProcess === undefined ? {} : { subscriptionSpawnProcess: options.subscriptionSpawnProcess }),
    spawnProcess: () => fakeCli(options.cliOutput ?? 'App ID: cli_bound01\n', options.cliExit ?? 0),
    onChange: () => changes.push(Date.now()),
    log: message => logs.push(message),
  })
  return { service, harness: created, client, coordinator, added, replies, changes, logs }
}

describe('lifecycle', () => {
  it('spec Scenario "升级后默认不消费事件": stays stopped while the channel is disabled', async () => {
    const f = await fixture()
    harness = f.harness

    f.service.start()

    // Upgrading Pet must not silently begin consuming Lark events.
    expect(f.service.status().phase).toBe('stopped')
  })

  it('spec Scenario "单连接同时承载群消息与评论": one +subscribe carries both, never a separate bot-added consumer', async () => {
    const children: Array<{ args: readonly string[]; child: EventEmitter & Record<string, unknown>; stdout: EventEmitter }> = []
    const spawnConsumer = (_command: string, args: readonly string[]): ChildProcess => {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>
      const stdout = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
      const stderr = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
      stdout.setEncoding = () => undefined
      stderr.setEncoding = () => undefined
      child['stdout'] = stdout
      child['stderr'] = stderr
      child['stdin'] = { end: () => undefined }
      child['exitCode'] = null
      child['signalCode'] = null
      child['kill'] = vi.fn(() => true)
      children.push({ args, child, stdout })
      return child as unknown as ChildProcess
    }
    const commentLines: string[] = []
    const f = await fixture({
      subscriptionSpawnProcess: spawnConsumer,
      commentIntake: async line => { commentLines.push(line) },
    })
    harness = f.harness
    f.service.start()
    expect(children).toHaveLength(0)

    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })
    await f.service.setEnabled(true)

    // A second subscription for the same app would split events (spike E3).
    await vi.waitFor(() => expect(children).toHaveLength(1))
    expect(children[0]?.args).toContain('+subscribe')
    expect(children[0]?.args.join(' ')).toContain('im.message.receive_v1,drive.notice.comment_add_v1')
    expect(children.some(item => item.args.includes('im.chat.member.bot.added_v1'))).toBe(false)
    // Structural half of 入群不建自动主会话: nothing even subscribes to bot-join.

    // A comment line reaches the comment path and is not mistaken for a group
    // message: it creates no Task or Invocation on the IM pipeline.
    const commentLine = compactCommentEvent()
    children[0]!.stdout.emit('data', commentLine + '\n')
    await vi.waitFor(() => expect(commentLines).toEqual([commentLine]))
    expect(f.harness.repository.listTasks()).toHaveLength(0)
    expect(f.harness.repository.listInvocations()).toHaveLength(0)
  })

  it('spec Scenario "启用时 IM 前置条件被阻断": enable is refused with lark-cli\'s reason and nothing is spawned', async () => {
    const spawned: string[][] = []
    const f = await fixture({
      imPreconditions: async () => ({ blocked: ['scopes_granted'] }),
      subscriptionSpawnProcess: (_command, args) => {
        spawned.push([...args])
        return fakeCli('', 0)
      },
    })
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    await expect(f.service.setEnabled(true)).rejects.toThrow(/scopes_granted/)
    expect(spawned).toHaveLength(0)
  })

  it('spec Scenario "dry-run 报告 unknown 时照常启用": unknown is not blocked', async () => {
    const spawned: string[][] = []
    const f = await fixture({
      imPreconditions: async () => ({ blocked: [] }),
      subscriptionSpawnProcess: (_command, args) => {
        spawned.push([...args])
        return fakeCli('', 0)
      },
    })
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    await f.service.setEnabled(true)
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
  })

  it('spec Scenario "Host 启动恢复已启用 channel 时执行 dry-run": dry-run on restore, never on supervisor restarts', async () => {
    const children: Array<EventEmitter & Record<string, unknown>> = []
    const f = await fixture({
      subscriptionSpawnProcess: () => {
        const child = fakeCli('', 1) as unknown as EventEmitter & Record<string, unknown>
        children.push(child)
        return child as unknown as ChildProcess
      },
    })
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    // Host start restores an already-enabled channel.
    f.service.start()
    await vi.waitFor(() => expect(children.length).toBeGreaterThanOrEqual(1))
    expect(f.client.imPreconditions).toHaveBeenCalledTimes(1)
    // The fake child exits immediately: the supervisor restarts it with backoff
    // (real timers here), and those restarts never re-run the dry-run.
    await vi.waitFor(() => expect(children.length).toBeGreaterThanOrEqual(2), { timeout: 3_000 })
    expect(f.client.imPreconditions).toHaveBeenCalledTimes(1)
  })

  it('spec Scenario "评论事件未开通不影响 IM": no comment probe gates the start; group lines still reach the IM pipeline', async () => {
    const children: Array<{ stdout: EventEmitter; stderr: EventEmitter }> = []
    const handled: string[] = []
    const f = await fixture({
      subscriptionSpawnProcess: () => {
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>
        const stdout = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
        const stderr = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
        stdout.setEncoding = () => undefined
        stderr.setEncoding = () => undefined
        Object.assign(child, { stdout, stderr, stdin: { end: () => undefined }, exitCode: null, signalCode: null, kill: () => true })
        children.push({ stdout, stderr })
        return child as unknown as ChildProcess
      },
    })
    harness = f.harness
    const pipeline = (f.service as unknown as { pipeline: { handleEvent(event: unknown): Promise<unknown> } }).pipeline
    const original = pipeline.handleEvent.bind(pipeline)
    pipeline.handleEvent = async event => {
      handled.push((event as { message_id: string }).message_id)
      return original(event)
    }
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    await f.service.setEnabled(true)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0]!.stderr.emit('data', SUBSCRIBE_STDERR.sdkConnected)
    expect(f.service.status().phase).toBe('connected')

    children[0]!.stdout.emit('data', compactImMessage({ message_id: 'om_x100b_group_1' }) + '\n')
    await vi.waitFor(() => expect(handled).toEqual(['om_x100b_group_1']))
  })

  it('spec Scenario "default 不可用": enabling is refused with the reason and no consumer starts', async () => {
    const spawned: string[][] = []
    const f = await fixture({
      knownWorkspaces: ['ws-acme'],
      subscriptionSpawnProcess: (_command, args) => { spawned.push([...args]); return fakeCli('', 0) },
    })
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      // No such workspace: the locator cannot resolve it.
      defaultWorkspaceId: 'ws-gone',
      updatedAt: 1,
    })

    await expect(f.service.setEnabled(true)).rejects.toThrow(/default workspace/)
    expect(spawned).toHaveLength(0)
  })

  it('rejects enabling on a lark-cli older than the +subscribe floor', async () => {
    const f = await fixture()
    harness = f.harness
    ;(f.client.cliVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ supported: false, version: '1.0.96' })
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    await expect(f.service.setEnabled(true)).rejects.toThrow(/upgrade to 1\.0\.97 or later/)
  })

  it('does not start after disable wins an in-flight identity probe', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })
    let release: ((value: Awaited<ReturnType<NonNullable<LarkClient['botIdentity']>>>) => void) | undefined
    vi.mocked(f.client.botIdentity!).mockImplementation(
      async () => new Promise(resolve => { release = resolve }),
    )

    const enabling = f.service.setEnabled(true)
    await f.service.setEnabled(false)
    await f.harness.repository.updateChannelConfig(current => ({ ...current, enabled: false }))
    release?.({
      kind: 'ready',
      identity: {
        appId: 'cli_bound01',
        openId: 'ou_petbot00000000000000000000000',
      },
    })
    await enabling

    expect(f.service.status().phase).toBe('stopped')
  })

  it('reports a stopped channel rather than failing', async () => {
    const f = await fixture()
    harness = f.harness

    expect(f.service.status()).toEqual({
      phase: 'stopped',
      unifiedLocus: {
        childSession: 'verified',
        defaultPermission: 'read',
        readVerification: 'verified',
      },
    })
    expect(f.service.bindState()).toBeUndefined()
  })

  it('stops cleanly even when never started', async () => {
    const f = await fixture()
    harness = f.harness

    expect(() => f.service.stop()).not.toThrow()
  })
})

describe('settling an Invocation', () => {
  /** Register a channel binding for one Invocation. */
  async function bind(f: Fixture, chatType: 'p2p' | 'group'): Promise<void> {
    await f.harness.repository.putInvocationChannel({
      invocationId: 'inv-1',
      chatId: chatType === 'p2p' ? 'oc_p2p00000000000000000000000000' : 'oc_group0000000000000000000000000',
      chatType,
      triggerMessageId: 'om_trigger',
      senderOpenId: 'ou_owner000000000000000000000000',
      reactionId: 'reaction-in-progress',
      createdAt: 1,
    })
  }

  it('marks success without sending any text', async () => {
    const f = await fixture()
    harness = f.harness
    await bind(f, 'p2p')

    await f.service.settle('inv-1', 'succeeded')

    // Legacy Feishu Invocation feedback is retired; ordinary wheel settlement
    // must not consume an invocation_channel row.
    expect(f.added).toEqual([])
    expect(f.replies).toEqual([])
  })

  it('marks a group success without sending text', async () => {
    const f = await fixture()
    harness = f.harness
    await bind(f, 'group')

    await f.service.settle('inv-1', 'succeeded')

    expect(f.added).toEqual([])
    expect(f.replies).toEqual([])
  })

  it('marks a failure without posting the error', async () => {
    const f = await fixture()
    harness = f.harness
    await bind(f, 'p2p')

    await f.service.settle('inv-1', 'failed')

    expect(f.added).toEqual([])
    expect(f.replies).toEqual([])
  })

  it('ignores an Invocation that has no channel binding', async () => {
    const f = await fixture()
    harness = f.harness

    await f.service.settle('inv-overlay', 'succeeded')

    // Capability Invocations from the overlay settle through the same path.
    expect(f.added).toEqual([])
  })

  it('never throws when Lark is unreachable', async () => {
    const f = await fixture({ failing: true })
    harness = f.harness
    await bind(f, 'p2p')

    // The caller is the event projection that also settles Pet's own state;
    // an exception here would strand the Task.
    await expect(f.service.settle('inv-1', 'succeeded')).resolves.toBeUndefined()
  })
})

describe('unified locus lifecycle seam', () => {
  it('surfaces a Host-provided unavailable diagnostic without enabling a controller', async () => {
    const f = await fixture()
    harness = f.harness
    const service = new ChannelService({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      locator: { locate: () => '/repos/acme' },
      client: f.client,
      locusDiagnostic: 'Unified locus child adapter is not available.',
      log: message => f.logs.push(message),
    })

    expect(service.status()).toEqual({
      phase: 'stopped',
      diagnostic: 'Unified locus child adapter is not available.',
      unifiedLocus: {
        childSession: 'unavailable',
        defaultPermission: 'read',
        readVerification: 'unavailable',
        diagnostic: 'Unified locus child adapter is not available.',
      },
    })
  })

  it('disposes the locus observer without changing channel shutdown', async () => {
    const f = await fixture()
    harness = f.harness
    const dispose = vi.fn()
    const handle = vi.fn(async () => ({ kind: 'refused' as const, reason: 'turn-correlation-unavailable' as const }))
    const service = new ChannelService({
      repository: f.harness.repository,
      coordinator: f.coordinator,
      locator: { locate: () => '/repos/acme' },
      client: f.client,
      locusController: { handle, dispose },
      log: message => f.logs.push(message),
    })

    expect(service.status().phase).toBe('stopped')
    service.stop()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(service.status().phase).toBe('stopped')
  })
})

describe('safe intake diagnostics', () => {
  it('spec Scenario "评论范围无法判定": comment reasons keep their own diagnostic instead of "other"', () => {
    expect(safeIgnoredReason('comment-scope-unknown')).toBe('comment-scope-unknown')
    expect(safeIgnoredReason('comment-reply-missing')).toBe('comment-reply-missing')
    expect(safeIgnoredReason('unsupported-file-type')).toBe('unsupported-file-type')
  })

  it('keeps channel-state gate reasons out of the per-event ignore vocabulary', () => {
    for (const gate of ['event-connection-conflict', 'subscribe-lock-held', 'lark-cli-too-old', 'connection-check-failed']) {
      expect(safeIgnoredReason(gate)).toBe('other')
    }
  })

  it('logs a low-cardinality reason without event identifiers or content', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    const pipeline = (f.service as unknown as { pipeline: { handleLine(line: string): Promise<unknown> } })
      .pipeline
    await pipeline.handleLine(
      JSON.stringify({
        type: 'im.message.receive_v1',
        message_id: 'om_secret_message',
        chat_id: 'oc_secret_chat',
        chat_type: 'p2p',
        message_type: 'text',
        content: 'private payload',
        sender_id: 'ou_stranger_secret',
        sender_type: 'user',
      }),
    )

    expect(f.logs).toContain('dsh-pet channel: inbound unroutable: Unified locus capability is unavailable; legacy Feishu execution is retired.')
    const text = f.logs.join('\n')
    for (const forbidden of ['private payload', 'om_secret_message', 'oc_secret_chat', 'ou_stranger_secret']) {
      expect(text).not.toContain(forbidden)
    }
  })
})

describe('binding results', () => {
  it('records the app id after a successful bind', async () => {
    const f = await fixture()
    harness = f.harness

    await f.service.connectExisting('cli_bound01', 'secret')

    // Binding is committed only after the named profile proves all identity facts.
    const config = f.harness.repository.getChannelConfig()
    expect(config.botAppId).toBe('cli_bound01')
    expect(config.botOpenId).toBe('ou_petbot00000000000000000000000')
    expect(config.botName).toBe('Pet Bot')
  })

  it('resumes a pre-upgrade enabled channel after the named profile is rebuilt', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-acme',
      updatedAt: 1,
    })

    await f.service.connectExisting('cli_bound01', 'secret')

    expect(f.service.status().phase).toBe('starting')
  })

  it('writes nothing when identity verification fails', async () => {
    const f = await fixture()
    harness = f.harness
    vi.mocked(f.client.botIdentity!).mockResolvedValue({
      kind: 'unavailable',
      diagnostic: 'The Pet lark-cli profile belongs to another app.',
    })

    const state = await f.service.connectExisting('cli_bound01', 'secret')

    expect(state.phase).toBe('failed')
    const config = f.harness.repository.getChannelConfig()
    expect(config.botAppId).toBeUndefined()
    expect(config.botOpenId).toBeUndefined()
  })

  it('writes nothing when binding is rejected', async () => {
    const f = await fixture({ cliOutput: 'authorization denied\n', cliExit: 1 })
    harness = f.harness

    const state = await f.service.connectExisting('cli_bound01', 'secret')

    expect(state.phase).toBe('failed')
    expect(f.harness.repository.getChannelConfig().botAppId).toBeUndefined()
  })

  it('writes nothing when the request is malformed', async () => {
    const f = await fixture()
    harness = f.harness

    await f.service.connectExisting('', 'secret')

    expect(f.harness.repository.getChannelConfig().botAppId).toBeUndefined()
  })
})
