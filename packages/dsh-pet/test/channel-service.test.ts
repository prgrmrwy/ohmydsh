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
import { ChannelService } from '../src/host/channel/service.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import { PetCoordinator } from '../src/host/coordinator.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

interface Fixture {
  readonly service: ChannelService
  readonly harness: PetHarness
  readonly client: LarkClient
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
  options: { failing?: boolean; cliOutput?: string; cliExit?: number } = {},
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
    cliVersion: vi.fn(async () => ({ supported: true, version: '1.0.93' })),
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
      create: async (opts: { sessionId: string }) => ({ session: { id: opts.sessionId } }),
      get: () => ({}),
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
    locator: { locate: () => '/repos/nexus' },
    client,
    spawnProcess: () => fakeCli(options.cliOutput ?? 'App ID: cli_bound01\n', options.cliExit ?? 0),
    onChange: () => changes.push(Date.now()),
    log: message => logs.push(message),
  })
  return { service, harness: created, client, added, replies, changes, logs }
}

describe('lifecycle', () => {
  it('stays stopped while the channel is disabled', async () => {
    const f = await fixture()
    harness = f.harness

    f.service.start()

    // Upgrading Pet must not silently begin consuming Lark events.
    expect(f.service.status().phase).toBe('stopped')
  })

  it('does not start after disable wins an in-flight identity probe', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-nexus',
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

    expect(f.service.status()).toEqual({ phase: 'stopped' })
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

    // The agent replies; the Host only reflects state.
    expect(f.added).toEqual([{ messageId: 'om_trigger', emoji: 'DONE' }])
    expect(f.replies).toEqual([])
  })

  it('marks a group success without sending text', async () => {
    const f = await fixture()
    harness = f.harness
    await bind(f, 'group')

    await f.service.settle('inv-1', 'succeeded')

    expect(f.added).toEqual([{ messageId: 'om_trigger', emoji: 'DONE' }])
    expect(f.replies).toEqual([])
  })

  it('marks a failure without posting the error', async () => {
    const f = await fixture()
    harness = f.harness
    await bind(f, 'p2p')

    await f.service.settle('inv-1', 'failed')

    expect(f.added).toEqual([{ messageId: 'om_trigger', emoji: 'CRY' }])
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

describe('safe intake diagnostics', () => {
  it('logs a low-cardinality reason without event identifiers or content', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_bound01',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: ['ou_allowed0000000000000000000000'],
      defaultWorkspaceId: 'ws-nexus',
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

    expect(f.logs).toContain('dsh-pet channel: inbound ignored: not-allowed-sender')
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
      defaultWorkspaceId: 'ws-nexus',
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
