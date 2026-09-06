/**
 * Durable behaviour of the Lark channel tables.
 *
 * These tests pin the trust-carrying invariants rather than plain CRUD: the
 * identifier validation that keeps an unresolvable allowlist from looking
 * configured, and the trigger-message idempotency probe that stops a
 * redelivered event from running the user's request twice.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { PetChannelConfig, PetChatBinding, PetInvocationChannel } from '../src/host/spec.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/** A valid configuration, overridable per test. */
function testConfig(overrides: Partial<PetChannelConfig> = {}): PetChannelConfig {
  return {
    enabled: true,
    botAppId: 'cli_test',
    botOpenId: 'ou_bot0000000000000000000000000000',
    botName: 'Test Bot',
    allowOpenIds: ['ou_owner000000000000000000000000'],
    defaultWorkspaceId: 'ws-nexus',
    updatedAt: 1,
    ...overrides,
  }
}

/** A valid group binding, overridable per test. */
function testBinding(overrides: Partial<PetChatBinding> = {}): PetChatBinding {
  return {
    chatId: 'oc_group0000000000000000000000000',
    chatType: 'group',
    workspaceId: 'ws-nexus',
    boundBy: 'auto',
    boundAt: 1,
    ...overrides,
  }
}

/** A valid invocation channel binding, overridable per test. */
function testChannel(overrides: Partial<PetInvocationChannel> = {}): PetInvocationChannel {
  return {
    invocationId: 'inv-1',
    chatId: 'oc_group0000000000000000000000000',
    chatType: 'group',
    triggerMessageId: 'om_trigger00000000000000000000000',
    senderOpenId: 'ou_owner000000000000000000000000',
    createdAt: 1,
    ...overrides,
  }
}

describe('channel configuration', () => {
  it('reads as disabled and unbound before anything is written', async () => {
    harness = await openPetHarness()

    const config = harness.repository.getChannelConfig()

    // "No row" and "channel off" MUST look the same to callers: both mean the
    // subscription does not run, and branching on the difference would let a
    // half-configured channel start.
    expect(config.enabled).toBe(false)
    expect(config.allowOpenIds).toEqual([])
    expect(config.botOpenId).toBeUndefined()
  })

  it('round-trips a stored configuration', async () => {
    harness = await openPetHarness()
    const repo = harness.repository

    await repo.putChannelConfig(testConfig())

    expect(repo.getChannelConfig()).toMatchObject({
      enabled: true,
      botOpenId: 'ou_bot0000000000000000000000000000',
      allowOpenIds: ['ou_owner000000000000000000000000'],
      defaultWorkspaceId: 'ws-nexus',
    })
  })

  it('rejects an allowlist entry that is not a resolved open id', async () => {
    harness = await openPetHarness()

    // A username stored here could never match an inbound sender, which is a
    // channel that looks configured but admits nobody.
    await expect(
      harness.repository.putChannelConfig(testConfig({ allowOpenIds: ['zhangyong.617'] })),
    ).rejects.toThrow(/not a resolved open id/)
  })

  it('rejects a malformed bot open id', async () => {
    harness = await openPetHarness()

    // Without a real bot open_id, group mention filtering cannot tell an
    // `@us` from an `@someone-else`.
    await expect(
      harness.repository.putChannelConfig(testConfig({ botOpenId: 'bot-123' })),
    ).rejects.toThrow(/not an open id/)
  })

  it('does not store any credential-shaped field', async () => {
    harness = await openPetHarness()
    const repo = harness.repository

    await repo.putChannelConfig(testConfig())

    // The bot's secret lives in lark-cli. Pet holds identity facts only, and
    // this asserts the schema never grew a place to put a token.
    const stored = repo.getChannelConfig() as Record<string, unknown>
    for (const key of ['appSecret', 'secret', 'token', 'accessToken', 'encryptKey']) {
      expect(stored[key]).toBeUndefined()
    }
  })
})

describe('chat bindings', () => {
  it('round-trips and lists bindings', async () => {
    harness = await openPetHarness()
    const repo = harness.repository

    await repo.putChatBinding(testBinding())
    await repo.putChatBinding(
      testBinding({ chatId: 'oc_p2p00000000000000000000000000', chatType: 'p2p' }),
    )

    expect(repo.listChatBindings()).toHaveLength(2)
    expect(repo.getChatBinding('oc_group0000000000000000000000000')?.workspaceId).toBe('ws-nexus')
  })

  it('rejects a malformed chat id', async () => {
    harness = await openPetHarness()

    await expect(
      harness.repository.putChatBinding(testBinding({ chatId: 'group-1' })),
    ).rejects.toThrow(/not a chat id/)
  })

  it('updates the active Task pointer without touching the route', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChatBinding(testBinding({ boundBy: 'user', workspaceId: 'ws-infra' }))

    await repo.setChatActiveTask('oc_group0000000000000000000000000', 'task-7')

    const updated = repo.getChatBinding('oc_group0000000000000000000000000')
    expect(updated?.activeTaskId).toBe('task-7')
    // Healing a stale pointer MUST NOT rewrite where the chat routes or who
    // bound it.
    expect(updated?.workspaceId).toBe('ws-infra')
    expect(updated?.boundBy).toBe('user')
  })

  it('clears the active Task pointer when the Task is gone', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChatBinding(testBinding({ activeTaskId: 'task-7' }))

    await repo.setChatActiveTask('oc_group0000000000000000000000000', undefined)

    expect(repo.getChatBinding('oc_group0000000000000000000000000')?.activeTaskId).toBeUndefined()
  })

  it('reports whether a delete removed anything', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putChatBinding(testBinding())

    expect(await repo.deleteChatBinding('oc_group0000000000000000000000000')).toBe(true)
    expect(await repo.deleteChatBinding('oc_group0000000000000000000000000')).toBe(false)
  })
})

describe('invocation channel bindings', () => {
  it('round-trips a reply target', async () => {
    harness = await openPetHarness()
    const repo = harness.repository

    await repo.putInvocationChannel(testChannel({ rootMessageId: 'om_root0000000000000000000' }))

    expect(repo.getInvocationChannel('inv-1')).toMatchObject({
      chatId: 'oc_group0000000000000000000000000',
      triggerMessageId: 'om_trigger00000000000000000000000',
      rootMessageId: 'om_root0000000000000000000',
    })
  })

  it('finds an existing binding by trigger message', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(testChannel())

    // This is the idempotency probe: Lark redelivers unacknowledged events
    // after a reconnect, and a second Invocation would run the request twice.
    const found = repo.findChannelByTriggerMessage('om_trigger00000000000000000000000')

    expect(found?.invocationId).toBe('inv-1')
    expect(repo.findChannelByTriggerMessage('om_never000000000000000000')).toBeUndefined()
  })

  it('rejects a sender that is not a resolved open id', async () => {
    harness = await openPetHarness()

    await expect(
      harness.repository.putInvocationChannel(testChannel({ senderOpenId: 'someone' })),
    ).rejects.toThrow(/not a resolved open id/)
  })

  it('attaches a reaction id after the binding already exists', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(testChannel())

    // The reaction call is fail-soft and lands after the Invocation is
    // already created, so it is written as a separate step.
    await repo.setInvocationReaction('inv-1', 'reaction-abc')

    expect(repo.getInvocationChannel('inv-1')?.reactionId).toBe('reaction-abc')
  })

  it('tolerates a reaction update for an Invocation with no binding', async () => {
    harness = await openPetHarness()

    // A floating-point failure in fail-soft reaction work must not throw.
    await expect(harness.repository.setInvocationReaction('inv-none', 'r')).resolves.toBeUndefined()
  })

  it('clears the reaction id once the reaction is removed', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.putInvocationChannel(testChannel({ reactionId: 'reaction-abc' }))

    await repo.setInvocationReaction('inv-1', undefined)

    expect(repo.getInvocationChannel('inv-1')?.reactionId).toBeUndefined()
  })
})
