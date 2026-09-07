/**
 * `/bind`: attaching an existing group to an existing session.
 *
 * The tests that matter here are the refusals. The happy path is largely the
 * create path with one step removed, but the 1:1 invariant and the
 * non-disclosure property are new — and both are the kind of thing that
 * silently degrades into "works, but leaks" if only the success case is
 * covered.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindExistingGroup, type BindDeps } from '../src/host/qa/bind.js'
import { PREFIX_UNRESOLVED_TEXT, renderBindReceipt } from '../src/host/qa/bind-receipt.js'
import { qaScopeKeyOf } from '../src/host/qa/occupancy.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import type { BindableSession } from '../src/host/qa/resolve-session.js'
import type { LiveAgentLike, SubagentSeam } from '../src/host/qa/subagents.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const CHAT = 'oc_existing00000000000000000000000'.slice(0, 33)
const TARGET = 'session-abc123de-0000-0000-0000-000000000001'
const SESSIONS: BindableSession[] = [
  { id: TARGET, title: '排查登录失败' },
  { id: 'session-abc123ff-0000-0000-0000-000000000002', title: '同前缀的另一个' },
  { id: 'session-def456aa-0000-0000-0000-000000000003', title: '唯一的 def456' },
]

/** A seam whose fork each test can observe. */
function seamStub(options: { resumeFails?: boolean } = {}) {
  const started: { childId?: string }[] = []
  const drained: string[] = []
  const seam: SubagentSeam = {
    agents: {
      get: (id: string) => ({ session: { id } }) as LiveAgentLike,
      resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
        if (options.resumeFails === true) throw new Error('cannot resume')
        return { agent: { session: { id: resumeSessionId } } as LiveAgentLike }
      }),
    },
    subagents: {
      startContinuable: vi.fn(async (spec: { childId?: string }) => {
        started.push({ ...(spec.childId !== undefined ? { childId: spec.childId } : {}) })
        return { childId: spec.childId ?? 'child' }
      }),
      drainContinuableChildren: vi.fn(async (_p: LiveAgentLike, ids: readonly string[]) => {
        drained.push(...ids)
      }),
      listChildren: vi.fn(async () => []),
    },
    queuePrompt: vi.fn(async () => 'm'),
    onChildSettled: () => () => undefined,
  }
  return { seam, started, drained }
}

function larkStub(): LarkClient {
  return {
    addReaction: vi.fn(async () => 'r'),
    removeReaction: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => []),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => '项目讨论群'),
    botReady: vi.fn(async () => true),
    reply: vi.fn(async () => undefined),
    createChat: vi.fn(async () => CHAT),
    sendToChat: vi.fn(async () => undefined),
  }
}

async function deps(h: PetHarness, overrides: Partial<BindDeps> = {}): Promise<BindDeps> {
  const stub = seamStub()
  return {
    repository: h.repository,
    client: larkStub(),
    seam: stub.seam,
    listSessions: () => SESSIONS,
    ...overrides,
  } as BindDeps
}

describe('binding an existing group', () => {
  it('forks the target session and writes a bound qa row', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    expect(outcome.ok).toBe(true)
    const binding = harness.repository.getChatBinding(CHAT)
    expect(binding?.kind).toBe('qa')
    expect(binding?.qaParentSessionId).toBe(TARGET)
    // The marker that keeps Settings honest: Pet joined this group, it did
    // not create it, and it owns nothing here.
    expect(binding?.qaOrigin).toBe('bound')
    expect(binding?.boundBy).toBe('user')
  })

  it('reports the source and the blast radius for the receipt', async () => {
    harness = await openPetHarness()
    const d = await deps(harness, { memberCount: async () => 12 })

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.sourceTitle).toBe('排查登录失败')
    expect(outcome.memberCount).toBe(12)
    // Shown at the moment the choice is made: from now on 12 people can put
    // work into a real repository through this bot.
    expect(renderBindReceipt(outcome)).toContain('12 人')
  })

  it('carries the execution root into the binding', async () => {
    harness = await openPetHarness()
    const d = await deps(harness, {
      resolveWorktree: async () => ({
        executionRoot: '/repo/.worktrees/x',
        branch: 'ws/x',
        repositoryRoot: '/repo',
      }),
    })

    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    // Same field the create path writes: every later question restates it.
    expect(harness.repository.getChatBinding(CHAT)?.qaExecutionRoot).toBe('/repo/.worktrees/x')
  })
})

describe('the 1:1 invariant refuses in both directions', () => {
  it('refuses when the group is already bound', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    const second = await bindExistingGroup(d, { chatId: CHAT, prefix: 'def456' })

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('chat-occupied')
  })

  it('refuses when the session already has a group', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    const other = await bindExistingGroup(d, {
      chatId: 'oc_another000000000000000000000000'.slice(0, 33),
      prefix: 'abc123d',
    })

    expect(other.ok).toBe(false)
    if (!other.ok) expect(other.reason).toBe('session-occupied')
  })

  it('allows rebinding once the previous Task is archived', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    const first = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await harness.repository.archiveTask(first.taskId)

    const again = await bindExistingGroup(d, { chatId: CHAT, prefix: 'def456' })

    // Archiving is the one documented release, for both entry points.
    expect(again.ok).toBe(true)
  })

  it('does not count an invalidated binding as occupying the group', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })
    await harness.repository.invalidateQaBinding(CHAT, '源会话已不可用')

    const again = await bindExistingGroup(d, { chatId: CHAT, prefix: 'def456' })

    // A dead pairing must not strand the group forever.
    expect(again.ok).toBe(true)
    expect(harness.repository.getChatBinding(CHAT)?.qaParentSessionId).toBe(SESSIONS[2]!.id)
  })
})

describe('prefix failures stay indistinguishable', () => {
  it('produces the same receipt for no match and several matches', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)

    const none = await bindExistingGroup(d, { chatId: CHAT, prefix: 'ffffff' })
    const several = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123' })

    // Fused at the value level AND at the wording level: un-fusing either one
    // turns `/bind` into an oracle for which session ids exist.
    expect(none).toEqual(several)
    expect(renderBindReceipt(none)).toBe(renderBindReceipt(several))
    expect(renderBindReceipt(none)).toBe(PREFIX_UNRESOLVED_TEXT)
  })

  it('binds nothing on either failure', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)

    await bindExistingGroup(d, { chatId: CHAT, prefix: 'ffffff' })
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123' })

    expect(harness.repository.getChatBinding(CHAT)).toBeUndefined()
    expect(harness.repository.listTasks()).toHaveLength(0)
  })

  it('states a too-short prefix plainly', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc' })

    // Describes the input, not the session store — safe to be specific.
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('prefix-too-short')
    expect(renderBindReceipt(outcome)).toContain('6 位')
  })
})

describe('an unforkable source', () => {
  it('refuses without binding', async () => {
    harness = await openPetHarness()
    const stub = seamStub({ resumeFails: true })
    stub.seam.agents.get = () => undefined
    const d = await deps(harness, { seam: stub.seam })

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('source-unforkable')
    expect(harness.repository.getChatBinding(CHAT)).toBeUndefined()
  })
})

describe('a failed write releases the child', () => {
  it('rolls back the fork when the Task cannot be created', async () => {
    harness = await openPetHarness()
    const stub = seamStub()
    const d = await deps(harness, { seam: stub.seam })
    vi.spyOn(harness.repository, 'createTask').mockRejectedValueOnce(new Error('scope taken'))

    await expect(
      bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' }),
    ).rejects.toThrow(/已回收子代理/)

    // Nothing was created in Lark, so rollback is just releasing the child —
    // there is no stranded group, unlike the create path.
    expect(stub.drained).toHaveLength(1)
    expect(harness.repository.getChatBinding(CHAT)).toBeUndefined()
  })
})

describe('scope key sanity', () => {
  it('binds under the source session scope, not the chat', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    expect(outcome.ok).toBe(true)
    // Same scope the Q&A path uses, which is what makes the session side of
    // the 1:1 invariant work across both entry points.
    expect(harness.repository.findActiveTaskByScope(qaScopeKeyOf(TARGET))).toBeDefined()
  })
})
