import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry } from '../src/host/capture.js'
import { ChannelService } from '../src/host/channel/service.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import { PetCoordinator } from '../src/host/coordinator.js'
import { openPetHarness, type PetHarness } from './harness.js'

class ConsumerChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(value: string): void }
  readonly stderr = new EventEmitter() as EventEmitter & { setEncoding(value: string): void }
  exitCode: number | null = null
  readonly signals: string[] = []

  constructor() {
    super()
    this.stdout.setEncoding = () => undefined
    this.stderr.setEncoding = () => undefined
  }

  ready(): void {
    this.stderr.emit('data', '[event] ready event_key=im.message.receive_v1\n')
  }

  line(value: unknown): void {
    this.stdout.emit('data', `${JSON.stringify(value)}\n`)
  }

  kill(signal: string): boolean {
    this.signals.push(signal)
    return true
  }
}

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function fixture() {
  const created = await openPetHarness()
  harness = created
  const children: ConsumerChild[] = []
  const replies: string[] = []
  const pairingTimers: { fn: () => void; ms: number }[] = []
  const client: LarkClient = {
    cliVersion: vi.fn(async () => ({ supported: true, version: '1.0.93' })),
    botIdentity: vi.fn(async appId => ({
      kind: 'ready' as const,
      identity: { appId, openId: 'ou_petbot00000000000000000000000' },
    })),
    botReady: vi.fn(async () => true),
    listMessages: vi.fn(async () => []),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => undefined),
    addReaction: vi.fn(async () => undefined),
    removeReaction: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    replyStrict: vi.fn(async (_messageId, text) => { replies.push(text) }),
  }
  const coordinator = new PetCoordinator({
    repository: created.repository,
    capabilities: new CapabilityRegistry(),
    agents: { create: async () => ({}), get: () => ({}) } as never,
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
    subscriptionSpawnProcess: () => {
      const child = new ConsumerChild()
      children.push(child)
      return child as unknown as ChildProcess
    },
    pairing: {
      randomBytes: () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
      schedule: (fn, ms) => {
        pairingTimers.push({ fn, ms })
        return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>
      },
    },
  })
  await created.repository.putChannelConfig({
    enabled: false,
    botAppId: 'cli_bound01',
    botOpenId: 'ou_petbot00000000000000000000000',
    allowOpenIds: [],
    updatedAt: 1,
  })
  return { service, children, replies, pairingTimers, client, repository: created.repository }
}

function pairEvent(sender = 'ou_pairing0000000000000000000000') {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_pair',
    chat_id: 'oc_direct000000000000000000000000',
    chat_type: 'p2p',
    message_type: 'text',
    content: '/pair 2345-6789',
    create_time: String(Date.now()),
    sender_id: sender,
    sender_type: 'user',
  }
}

describe('pairing owns the shared consumer', () => {
  it('starts while formal channel is off and hides command until ready', async () => {
    const f = await fixture()
    await f.service.startPairing()

    expect(f.children).toHaveLength(1)
    expect(f.service.status().phase).toBe('starting')
    expect(f.service.pairingState()).toEqual({ phase: 'starting' })

    f.children[0]?.ready()
    expect(f.service.pairingState()).toMatchObject({
      phase: 'waiting',
      command: '/pair 2345-6789',
    })
  })

  it('uses the pre-dispatch path and stops pairing-only consumer after success', async () => {
    const f = await fixture()
    await f.service.startPairing()
    f.children[0]?.ready()
    f.children[0]?.line(pairEvent())
    await settle()

    expect(f.repository.getChannelConfig().allowOpenIds).toEqual([
      'ou_pairing0000000000000000000000',
    ])
    expect(f.service.pairingState()?.phase).toBe('succeeded')
    expect(f.children[0]?.signals).toEqual(['SIGTERM'])
    expect(f.replies).toHaveLength(1)
    expect(f.repository.listTasks()).toEqual([])
    expect(f.repository.listChatBindings()).toEqual([])
  })

  it('keeps one consumer when formal channel also owns it', async () => {
    const f = await fixture()
    await f.repository.updateChannelConfig(current => ({
      ...current,
      enabled: true,
      allowOpenIds: ['ou_existing000000000000000000000'],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 2,
    }))
    await f.service.setEnabled(true)
    f.children[0]?.ready()

    await f.service.startPairing()
    expect(f.children).toHaveLength(1)
    expect(f.service.pairingState()?.phase).toBe('waiting')

    f.service.cancelPairing()
    expect(f.children[0]?.signals).toEqual([])
    expect(f.service.status().phase).toBe('connected')
  })

  it('rejects pairing preflight without spawning', async () => {
    const f = await fixture()
    vi.mocked(f.client.botIdentity!).mockResolvedValue({
      kind: 'unavailable',
      diagnostic: 'wrong app',
    })

    await expect(f.service.startPairing()).rejects.toThrow('wrong app')
    expect(f.children).toEqual([])
    expect(f.service.pairingState()).toBeUndefined()
  })

  it('does not restart a formally owned subscription when pairing observes down', async () => {
    const f = await fixture()
    await f.repository.updateChannelConfig(current => ({
      ...current,
      enabled: true,
      allowOpenIds: ['ou_existing000000000000000000000'],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 2,
    }))
    await f.service.setEnabled(true)
    f.children[0]?.ready()
    await f.service.startPairing()

    ;(f.service as unknown as { onStatus(status: { phase: 'down'; failures: number; diagnostic: string }): void })
      .onStatus({ phase: 'down', failures: 8, diagnostic: 'retry cap reached' })

    expect(f.service.pairingState()).toEqual({ phase: 'failed', diagnostic: 'retry cap reached' })
    expect(f.children).toHaveLength(1)
  })

  it('expires and stops a pairing-only consumer', async () => {
    const f = await fixture()
    await f.service.startPairing()
    f.children[0]?.ready()

    f.pairingTimers[0]?.fn()

    expect(f.service.pairingState()).toEqual({ phase: 'expired' })
    expect(f.children[0]?.signals).toEqual(['SIGTERM'])
  })

  it('Host stop clears pairing and terminates with SIGTERM', async () => {
    const f = await fixture()
    await f.service.startPairing()
    f.children[0]?.ready()

    f.service.stop()

    expect(f.service.pairingState()).toBeUndefined()
    expect(f.children[0]?.signals).toEqual(['SIGTERM'])
  })

  it('stops with SIGTERM on cancel when pairing is the only owner', async () => {
    const f = await fixture()
    await f.service.startPairing()
    f.children[0]?.ready()

    f.service.cancelPairing()

    expect(f.children[0]?.signals).toEqual(['SIGTERM'])
    expect(f.service.pairingState()).toBeUndefined()
  })
})
