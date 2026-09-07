/**
 * The QA 1:1 invariant, from both directions.
 *
 * The Q&A action only ever exercised the session side, because its chat does
 * not exist yet when it checks. `/bind` arrives with a chat that may already
 * be spoken for, so the group side has to hold up on its own — including the
 * case that decides whether a dead pairing blocks its group forever.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { chatOccupancy, qaScopeKeyOf, sessionOccupancy } from '../src/host/qa/occupancy.js'
import type { PetChatBinding } from '../src/host/spec.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const CHAT = 'oc_qagroup00000000000000000000000'
const SESSION = 'session-source'

/** A qa binding paired with a live Task, as a healthy pairing looks. */
async function pair(
  h: PetHarness,
  overrides: Partial<PetChatBinding> = {},
): Promise<{ taskId: string }> {
  const scopeKey = qaScopeKeyOf(SESSION)
  const task = await h.repository.createTask({
    id: `task-${Math.random().toString(16).slice(2)}`,
    scopeKey,
    epoch: await h.repository.allocateEpoch(scopeKey),
    sourceKind: 'qa-chat',
    sourceId: CHAT,
    sourceAvailability: 'available',
    executorSessionId: 'session-child',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
  })
  await h.repository.putChatBinding({
    chatId: CHAT,
    chatType: 'group',
    kind: 'qa',
    qaChildSessionId: 'session-child',
    qaParentSessionId: SESSION,
    qaOrigin: 'created',
    activeTaskId: task.id,
    boundBy: 'user',
    boundAt: 1,
    ...overrides,
  })
  return { taskId: task.id }
}

describe('both sides free', () => {
  it('reports neither side held', async () => {
    harness = await openPetHarness()

    expect(sessionOccupancy(harness.repository, SESSION).held).toBe(false)
    expect(chatOccupancy(harness.repository, CHAT).held).toBe(false)
  })

  it('treats a non-qa binding as no occupant of the qa relation', async () => {
    harness = await openPetHarness()
    await harness.repository.putChatBinding({
      chatId: CHAT,
      chatType: 'group',
      kind: 'workspace',
      qaOrigin: 'created',
      workspaceId: 'ws-nexus',
      boundBy: 'auto',
      boundAt: 1,
    })

    // A workspace-routed chat is a different relation entirely; it must not
    // block a qa binding, and `/bind` decides that case on its own terms.
    expect(chatOccupancy(harness.repository, CHAT).held).toBe(false)
  })
})

describe('a live pairing holds both sides', () => {
  it('reports the session side held', async () => {
    harness = await openPetHarness()
    const { taskId } = await pair(harness)

    const occupancy = sessionOccupancy(harness.repository, SESSION)

    expect(occupancy.held).toBe(true)
    if (occupancy.held) expect(occupancy.occupant.task.id).toBe(taskId)
  })

  it('reports the group side held', async () => {
    harness = await openPetHarness()
    const { taskId } = await pair(harness)

    const occupancy = chatOccupancy(harness.repository, CHAT)

    expect(occupancy.held).toBe(true)
    if (occupancy.held) expect(occupancy.occupant.task.id).toBe(taskId)
  })
})

describe('a dead pairing holds nothing', () => {
  it('frees both sides once the binding is invalidated', async () => {
    harness = await openPetHarness()
    const { taskId } = await pair(harness)
    await harness.repository.invalidateQaBinding(CHAT, '源会话已不可用')

    const bySession = sessionOccupancy(harness.repository, SESSION)
    const byChat = chatOccupancy(harness.repository, CHAT)

    // An invalidated binding is kept on purpose so its child's history stays
    // readable. Counting it as occupied would strand the group forever.
    expect(bySession.held).toBe(false)
    expect(byChat.held).toBe(false)
    // Both report the stale Task so the caller can retire it before building
    // a working pair.
    if (!bySession.held) expect(bySession.staleTaskId).toBe(taskId)
    if (!byChat.held) expect(byChat.staleTaskId).toBe(taskId)
  })

  it('frees the group side once its Task is archived', async () => {
    harness = await openPetHarness()
    const { taskId } = await pair(harness)
    await harness.repository.archiveTask(taskId)

    // Archiving is the one documented way to release a side.
    expect(chatOccupancy(harness.repository, CHAT).held).toBe(false)
    expect(sessionOccupancy(harness.repository, SESSION).held).toBe(false)
  })

  it('frees the session side when the binding row vanished', async () => {
    harness = await openPetHarness()
    const { taskId } = await pair(harness)
    await harness.repository.deleteChatBinding(CHAT)

    const occupancy = sessionOccupancy(harness.repository, SESSION)

    expect(occupancy.held).toBe(false)
    if (!occupancy.held) expect(occupancy.staleTaskId).toBe(taskId)
  })
})
