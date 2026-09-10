/**
 * Channel management routes, driven through their real handlers.
 *
 * Two things are proven here rather than assumed: a credential can never
 * appear in a response (the view is assembled from fields that cannot hold
 * one), and the channel refuses to arm itself while it would admit nobody.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { PetChangeFeed } from '../src/host/changes.js'
import { SourceContextRegistry } from '../src/host/capture.js'
import { PetCoordinator } from '../src/host/coordinator.js'
import { PetLifecycleMachine } from '../src/host/lifecycle.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import { createPetRoutes, type ChannelControl } from '../src/host/routes.js'
import {
  ROUTES,
  type PetBindState,
  type PetChannelView,
  type PetPairingState,
} from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

const SECRET = 'secret-must-never-surface'
const OWNER = 'ou_owner000000000000000000000000'
const CHAT = 'oc_group0000000000000000000000000'

let harness: PetHarness | undefined

interface Route {
  readonly path: string
  readonly handler: (req: never, res: never) => void | Promise<void>
}

interface Reply {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
}

let routes: readonly Route[]
let paths: PetPaths
let channel: ChannelControl
let calls: string[]
let bindState: PetBindState | undefined
let pairingState: PetPairingState | undefined

async function call(routePath: string, body: unknown): Promise<Reply> {
  const route = routes.find(item => item.path === routePath)
  if (route === undefined) throw new Error(`route ${routePath} is not registered`)
  const req = {
    method: 'POST',
    headers: { host: '127.0.0.1:3080' },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from(JSON.stringify(body)))
      if (event === 'end') cb()
    },
    destroy: () => {},
  }
  let payload: unknown
  const res = {
    writeHead() {
      return this
    },
    end(text: string) {
      payload = JSON.parse(text)
    },
  }
  await route.handler(req as never, res as never)
  return payload as Reply
}

beforeEach(async () => {
  harness = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-channel-routes-'))
  paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)

  const lifecycle = new PetLifecycleMachine()
  lifecycle.markReady()
  const capabilities = new CapabilityRegistry()
  const coordinator = new PetCoordinator({
    repository: harness.repository,
    capabilities,
    agents: {
      create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
      get: () => ({}),
    } as never,
    dispatcher: { dispatch: async () => {} },
    resolver: { getSession: () => undefined, getWorkspace: () => undefined },
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  } as never)

  calls = []
  bindState = undefined
  pairingState = undefined
  channel = {
    status: () => ({ phase: 'connected' }),
    setEnabled: vi.fn(async (enabled: boolean) => {
      calls.push(`setEnabled:${enabled}`)
    }),
    reconnect: vi.fn(async () => {
      calls.push('reconnect')
    }),
    pairingState: () => pairingState,
    startPairing: vi.fn(async () => {
      calls.push('startPairing')
      pairingState = { phase: 'waiting', command: '/pair 2345-6789', expiresAt: 301_000 }
    }),
    cancelPairing: vi.fn(() => {
      calls.push('cancelPairing')
      pairingState = undefined
    }),
    workspaceAvailable: workspaceId => workspaceId === 'ws-nexus',
    bindState: () => bindState,
    beginCreate: vi.fn(async () => {
      calls.push('beginCreate')
      bindState = { phase: 'awaiting-authorization', verificationUrl: 'https://accounts/x' }
      return bindState
    }),
    connectExisting: vi.fn(async (appId: string, appSecret: string) => {
      // Recorded WITHOUT the secret: even the test double refuses to keep it.
      calls.push(`connectExisting:${appId}:${appSecret.length}`)
      bindState = { phase: 'bound', appId }
      return bindState
    }),
    cancelBind: vi.fn(() => {
      calls.push('cancelBind')
    }),
  }

  routes = createPetRoutes({
    repository: harness.repository,
    capabilities,
    coordinator,
    lifecycle,
    paths,
    packageVersion: '0.1.0',
    changes: new PetChangeFeed(),
    archiveSink: async () => {},
    channel,
  } as never)
})

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('reading the channel view', () => {
  it('reports an unbound, disabled channel before anything is configured', async () => {
    const reply = await call(ROUTES.channel, {})

    const view = reply.data as unknown as PetChannelView
    expect(view.enabled).toBe(false)
    expect(view.bot).toBeUndefined()
    expect(view.allowOpenIds).toEqual([])
    expect(view.routes).toEqual([])
    expect(view.onboarding.ready).toBe(false)
    expect(view.onboarding.blockers.map(item => item.code)).toEqual([
      'bot-unbound',
      'allowlist-empty',
      'default-workspace-missing',
    ])
  })

  it('never exposes a credential-shaped field', async () => {
    await harness?.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_test',
      botOpenId: 'ou_bot0000000000000000000000000000',
      botName: 'Pet Bot',
      allowOpenIds: [OWNER],
      updatedAt: 1,
    })

    const reply = await call(ROUTES.channel, {})

    // The stored configuration has no field that could hold a secret, so
    // there is no branch here that could emit one.
    const serialized = JSON.stringify(reply)
    for (const forbidden of ['appSecret', 'secret', 'token', 'encryptKey']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('lists chat routes and the pending queue depth', async () => {
    await harness?.repository.putChatBinding({
      chatId: CHAT,
      chatType: 'group',
      workspaceId: 'ws-nexus',
      boundBy: 'auto',
      boundAt: 1,
    })

    const view = (await call(ROUTES.channel, {})).data as unknown as PetChannelView

    expect(view.routes).toHaveLength(1)
    expect(view.routes[0]?.workspaceId).toBe('ws-nexus')
    expect(view.connection).toMatchObject({ phase: 'connected', queueDepth: 0 })
  })
})

describe('pairing an allowed member', () => {
  it('starts and cancels pairing through action-only bodies', async () => {
    const started = await call(ROUTES.channelMutate, { action: 'pair-start' })
    expect(started.ok).toBe(true)
    expect((started.data as unknown as PetChannelView).pairing).toEqual({
      phase: 'waiting',
      command: '/pair 2345-6789',
      expiresAt: 301_000,
    })
    expect(calls).toContain('startPairing')

    const cancelled = await call(ROUTES.channelMutate, { action: 'pair-cancel' })
    expect(cancelled.ok).toBe(true)
    expect((cancelled.data as unknown as PetChannelView).pairing).toBeUndefined()
    expect(calls).toContain('cancelPairing')
  })

  it.each(['code', 'senderOpenId', 'expiresAt', 'chatId'])(
    'rejects caller-controlled pairing field %s',
    async field => {
      const reply = await call(ROUTES.channelMutate, { action: 'pair-start', [field]: 'forged' })
      expect(reply.ok).toBe(false)
      expect(calls).not.toContain('startPairing')
    },
  )

  it('never exposes a command in terminal pairing states', async () => {
    pairingState = { phase: 'succeeded', openId: OWNER, name: 'Owner' }
    const view = (await call(ROUTES.channel, {})).data as unknown as PetChannelView
    expect(view.pairing).toEqual({ phase: 'succeeded', openId: OWNER, name: 'Owner' })
    expect(JSON.stringify(view.pairing)).not.toContain('/pair')
  })
})

describe('enabling the channel', () => {
  it('refuses while no bot is bound', async () => {
    const reply = await call(ROUTES.channelMutate, { action: 'set-enabled', enabled: true })

    // An enabled channel with no identity could not tell an @us from an
    // @someone-else, so it would admit nobody while looking configured.
    expect(reply.ok).toBe(false)
    expect(reply.message).toMatch(/Bind a Lark bot/)
    expect(calls).toEqual([])
  })

  it('refuses while the allowlist is empty', async () => {
    await harness?.repository.putChannelConfig({
      enabled: false,
      botAppId: 'cli_test',
      botOpenId: 'ou_petbot00000000000000000000000',
      defaultWorkspaceId: 'ws-nexus',
      allowOpenIds: [],
      updatedAt: 1,
    })

    const reply = await call(ROUTES.channelMutate, { action: 'set-enabled', enabled: true })

    expect(reply.ok).toBe(false)
    expect(reply.message).toMatch(/permitted sender/)
  })

  it('enables once a bot and a sender are configured', async () => {
    await harness?.repository.putChannelConfig({
      enabled: false,
      botAppId: 'cli_test',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: [OWNER],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    const reply = await call(ROUTES.channelMutate, { action: 'set-enabled', enabled: true })

    expect(reply.ok).toBe(true)
    expect(harness?.repository.getChannelConfig().enabled).toBe(true)
    expect(calls).toContain('setEnabled:true')
  })

  it('refuses while the bot identity is unresolved', async () => {
    await harness?.repository.putChannelConfig({
      enabled: false,
      botAppId: 'cli_test',
      allowOpenIds: [OWNER],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    const reply = await call(ROUTES.channelMutate, { action: 'set-enabled', enabled: true })

    expect(reply.ok).toBe(false)
    expect(reply.message).toMatch(/Confirm the Lark bot identity/)
  })

  it('refuses while the default workspace is missing', async () => {
    await harness?.repository.putChannelConfig({
      enabled: false,
      botAppId: 'cli_test',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: [OWNER],
      updatedAt: 1,
    })

    const reply = await call(ROUTES.channelMutate, { action: 'set-enabled', enabled: true })

    expect(reply.ok).toBe(false)
    expect(reply.message).toMatch(/default workspace/)
  })

  it('always allows disabling', async () => {
    const reply = await call(ROUTES.channelMutate, { action: 'set-enabled', enabled: false })

    expect(reply.ok).toBe(true)
    expect(calls).toContain('setEnabled:false')
  })
})

describe('configuring routing and senders', () => {
  it('rejects an allowlist entry that is not an open id', async () => {
    const reply = await call(ROUTES.channelMutate, {
      action: 'set-allowlist',
      allowOpenIds: ['zhangyong.617'],
    })

    // Stored as-is it would match no inbound sender: configured-looking, yet
    // admitting nobody.
    expect(reply.ok).toBe(false)
    expect(harness?.repository.getChannelConfig().allowOpenIds).toEqual([])
  })

  it('stores a resolved allowlist', async () => {
    const reply = await call(ROUTES.channelMutate, {
      action: 'set-allowlist',
      allowOpenIds: [OWNER],
    })

    expect(reply.ok).toBe(true)
    expect(harness?.repository.getChannelConfig().allowOpenIds).toEqual([OWNER])
  })

  it('refuses to clear active readiness prerequisites', async () => {
    await harness?.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_test',
      botOpenId: 'ou_petbot00000000000000000000000',
      allowOpenIds: [OWNER],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    const allowlist = await call(ROUTES.channelMutate, {
      action: 'set-allowlist',
      allowOpenIds: [],
    })
    const workspace = await call(ROUTES.channelMutate, {
      action: 'set-default-workspace',
    })
    const unavailableWorkspace = await call(ROUTES.channelMutate, {
      action: 'set-default-workspace',
      defaultWorkspaceId: 'ws-missing',
    })

    expect(allowlist.ok).toBe(false)
    expect(workspace.ok).toBe(false)
    expect(unavailableWorkspace.ok).toBe(false)
    expect(harness?.repository.getChannelConfig().allowOpenIds).toEqual([OWNER])
    expect(harness?.repository.getChannelConfig().defaultWorkspaceId).toBe('ws-nexus')
  })

  it('rebinds a chat and marks it as a user decision', async () => {
    await harness?.repository.putChatBinding({
      chatId: CHAT,
      chatType: 'group',
      workspaceId: 'ws-nexus',
      boundBy: 'auto',
      boundAt: 1,
    })

    await call(ROUTES.channelMutate, {
      action: 'rebind-chat',
      chatId: CHAT,
      workspaceId: 'ws-infra',
    })

    // `user` provenance stops a later default-routed message from silently
    // overwriting a deliberate choice.
    const binding = harness?.repository.getChatBinding(CHAT)
    expect(binding?.workspaceId).toBe('ws-infra')
    expect(binding?.boundBy).toBe('user')
  })

  it('refuses to rebind a chat that has no route', async () => {
    const reply = await call(ROUTES.channelMutate, {
      action: 'rebind-chat',
      chatId: CHAT,
      workspaceId: 'ws-infra',
    })

    expect(reply.ok).toBe(false)
  })

  it('removes a chat route', async () => {
    await harness?.repository.putChatBinding({
      chatId: CHAT,
      chatType: 'group',
      workspaceId: 'ws-nexus',
      boundBy: 'auto',
      boundAt: 1,
    })

    await call(ROUTES.channelMutate, { action: 'remove-chat', chatId: CHAT })

    expect(harness?.repository.getChatBinding(CHAT)).toBeUndefined()
  })

  it('drives an explicit reconnect', async () => {
    await call(ROUTES.channelMutate, { action: 'reconnect' })

    expect(calls).toContain('reconnect')
  })

  it('rejects an unknown action', async () => {
    expect((await call(ROUTES.channelMutate, { action: 'drop-tables' })).ok).toBe(false)
  })

  it('rejects an undeclared field', async () => {
    const reply = await call(ROUTES.channelMutate, {
      action: 'set-enabled',
      enabled: false,
      appSecret: SECRET,
    })

    // The strict body allowlist is what stops a caller from smuggling a field
    // the route never declared.
    expect(reply.ok).toBe(false)
  })
})

describe('binding a bot', () => {
  it('starts a create flow without waiting for the browser', async () => {
    const reply = await call(ROUTES.channelBind, { action: 'create' })

    // Creating blocks until the user authorizes; the response must come back
    // immediately so the UI can show the link.
    expect(reply.ok).toBe(true)
    expect(calls).toContain('beginCreate')
  })

  it('passes an existing secret through without echoing it', async () => {
    const reply = await call(ROUTES.channelBind, {
      action: 'connect',
      appId: 'cli_existing01',
      appSecret: SECRET,
    })

    expect(reply.ok).toBe(true)
    // Length, not content: proves the secret arrived intact at the CLI
    // boundary without this test itself retaining it.
    expect(calls).toContain(`connectExisting:cli_existing01:${SECRET.length}`)
    // The response is assembled from stored identity facts only.
    expect(JSON.stringify(reply)).not.toContain(SECRET)
  })

  it('requires a non-empty secret to connect', async () => {
    const reply = await call(ROUTES.channelBind, {
      action: 'connect',
      appId: 'cli_existing01',
      appSecret: '   ',
    })

    expect(reply.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('cancels an in-flight flow', async () => {
    await call(ROUTES.channelBind, { action: 'cancel' })

    expect(calls).toContain('cancelBind')
  })

  it('rejects an unknown bind action', async () => {
    expect((await call(ROUTES.channelBind, { action: 'exfiltrate' })).ok).toBe(false)
  })
})
