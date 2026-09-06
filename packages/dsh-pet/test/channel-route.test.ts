/**
 * Chat-to-workspace routing.
 *
 * The property that matters most here is what happens when routing CANNOT be
 * resolved: Pet must raise no work rather than pick some other workspace,
 * because running the user's request against an unintended repository is worse
 * than not running it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { routeChat, type WorkspaceLocator } from '../src/host/channel/route.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const GROUP = 'oc_group0000000000000000000000000'
const P2P = 'oc_p2p00000000000000000000000000'

/** Locator that knows two workspaces. */
const locator: WorkspaceLocator = {
  locate: id =>
    id === 'ws-nexus' ? '/repos/nexus' : id === 'ws-infra' ? '/repos/dev-infra-server' : undefined,
}

describe('routing through the default workspace', () => {
  it('routes an unbound chat to the default and writes the binding back', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    const decision = await routeChat(repo, locator, {
      chatId: GROUP,
      chatType: 'group',
      chatName: 'Nexus 前端团队',
    })

    expect(decision).toMatchObject({ routed: true, workspaceId: 'ws-nexus', workspacePath: '/repos/nexus' })
    // Written back so the chat is visible and re-bindable in Settings.
    const stored = repo.getChatBinding(GROUP)
    expect(stored?.workspaceId).toBe('ws-nexus')
    expect(stored?.boundBy).toBe('auto')
    expect(stored?.chatName).toBe('Nexus 前端团队')
  })

  it('records a p2p chat the same way', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    await routeChat(repo, locator, { chatId: P2P, chatType: 'p2p' })

    // An inbound message is the ONLY way a p2p chat id is ever learned: bot
    // identity may not list private conversations.
    expect(repo.getChatBinding(P2P)?.chatType).toBe('p2p')
  })
})

describe('routing through an explicit binding', () => {
  it('prefers the binding over the default', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })
    await repo.putChatBinding({
      chatId: GROUP,
      chatType: 'group',
      workspaceId: 'ws-infra',
      boundBy: 'user',
      boundAt: 1,
    })

    const decision = await routeChat(repo, locator, { chatId: GROUP, chatType: 'group' })

    expect(decision).toMatchObject({ routed: true, workspaceId: 'ws-infra' })
  })

  it('does not rewrite a user binding on later messages', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })
    await repo.putChatBinding({
      chatId: GROUP,
      chatType: 'group',
      workspaceId: 'ws-infra',
      boundBy: 'user',
      boundAt: 1,
    })

    await routeChat(repo, locator, { chatId: GROUP, chatType: 'group' })

    expect(repo.getChatBinding(GROUP)?.boundBy).toBe('user')
    expect(repo.getChatBinding(GROUP)?.workspaceId).toBe('ws-infra')
  })
})

describe('naming the conversation', () => {
  /** A namer that reports one known group name. */
  const namer = { chatName: async (id: string) => (id === GROUP ? 'Pet 测试群' : undefined) }

  it('records the chat name when the row is created', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    await routeChat(repo, locator, { chatId: GROUP, chatType: 'group' }, namer)

    // Without this the settings list and every prompt would identify the
    // conversation as a bare `oc_…`.
    expect(repo.getChatBinding(GROUP)?.chatName).toBe('Pet 测试群')
  })

  it('backfills a row created before the name could be read', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChatBinding({
      chatId: GROUP,
      chatType: 'group',
      workspaceId: 'ws-nexus',
      boundBy: 'auto',
      boundAt: 1,
    })

    const decision = await routeChat(repo, locator, { chatId: GROUP, chatType: 'group' }, namer)

    expect(repo.getChatBinding(GROUP)?.chatName).toBe('Pet 测试群')
    expect(decision).toMatchObject({ routed: true, workspaceId: 'ws-nexus' })
  })

  it('routes normally when the name cannot be read', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })

    const decision = await routeChat(
      repo,
      locator,
      { chatId: P2P, chatType: 'p2p' },
      { chatName: async () => undefined },
    )

    // A missing name is cosmetic; it must never block the work.
    expect(decision.routed).toBe(true)
    expect(repo.getChatBinding(P2P)?.chatName).toBeUndefined()
  })
})

describe('routing fails closed', () => {
  it('refuses when no binding exists and no default is configured', async () => {
    harness = await openPetHarness()

    const decision = await routeChat(harness.repository, locator, {
      chatId: GROUP,
      chatType: 'group',
    })

    expect(decision.routed).toBe(false)
    expect(decision.routed === false && decision.reason).toMatch(/no default workspace/)
    // Nothing is written when routing fails.
    expect(harness.repository.getChatBinding(GROUP)).toBeUndefined()
  })

  it('refuses when the bound workspace no longer exists', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-nexus',
      updatedAt: 1,
    })
    await repo.putChatBinding({
      chatId: GROUP,
      chatType: 'group',
      workspaceId: 'ws-deleted',
      boundBy: 'user',
      boundAt: 1,
    })

    const decision = await routeChat(repo, locator, { chatId: GROUP, chatType: 'group' })

    // Falling back to the default here would run the request in a repository
    // the user did not choose for this chat.
    expect(decision.routed).toBe(false)
    expect(decision.routed === false && decision.reason).toMatch(/no longer registered/)
    expect(repo.getChatBinding(GROUP)?.workspaceId).toBe('ws-deleted')
  })

  it('refuses when the default workspace no longer exists', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChannelConfig({
      enabled: true,
      allowOpenIds: [],
      defaultWorkspaceId: 'ws-deleted',
      updatedAt: 1,
    })

    const decision = await routeChat(repo, locator, { chatId: GROUP, chatType: 'group' })

    expect(decision.routed).toBe(false)
    expect(harness.repository.getChatBinding(GROUP)).toBeUndefined()
  })
})
