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
import { bindExistingGroup, unbindGroup, type BindDeps } from '../src/host/qa/bind.js'
import {
  PREFIX_UNRESOLVED_TEXT,
  renderBindReceipt,
  renderUnbindReceipt,
} from '../src/host/qa/bind-receipt.js'
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

  it('records the group\u2019s real name, never one Pet invents', async () => {
    harness = await openPetHarness()
    const client = larkStub()
    vi.mocked(client.chatName).mockResolvedValue('Nexus 前端讨论')
    const d = await deps(harness, { client })

    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    // A `/bind` group belongs to someone else. Storing an invented name would
    // make Settings show something nobody sees in Lark, and would contradict
    // the standing rule that Pet manages nothing in such a group.
    expect(harness.repository.getChatBinding(CHAT)?.chatName).toBe('Nexus 前端讨论')
  })

  it('stores no name at all when Lark will not say', async () => {
    harness = await openPetHarness()
    const client = larkStub()
    vi.mocked(client.chatName).mockResolvedValue(undefined)
    const d = await deps(harness, { client })

    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    // Absent beats fabricated: the settings list falls back to the chat id,
    // which is at least true.
    expect(harness.repository.getChatBinding(CHAT)?.chatName).toBeUndefined()
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

describe('unbinding a group', () => {
  it('releases a group that /bind attached', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    const bound = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })
    expect(bound.ok).toBe(true)
    if (!bound.ok) return

    const outcome = await unbindGroup({ repository: harness.repository }, CHAT)

    expect(outcome.ok).toBe(true)
    // Archiving is the one mechanism underneath, the same the panel uses, so
    // there is still only one notion of "this pairing is over".
    expect(harness.repository.getTask(bound.taskId)?.archivedAt).toBeDefined()
  })

  it('keeps the child and its history', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    const bound = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })
    if (!bound.ok) return

    await unbindGroup({ repository: harness.repository }, CHAT)

    // Matching what invalidation does: the conversation stays readable in the
    // GUI, it simply stops receiving the group's messages.
    expect(harness.repository.getChatBinding(CHAT)?.qaChildSessionId).toBe(bound.childSessionId)
  })

  it('frees both sides so the group can be bound again', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    await unbindGroup({ repository: harness.repository }, CHAT)
    const again = await bindExistingGroup(d, { chatId: CHAT, prefix: 'def456' })

    expect(again.ok).toBe(true)
  })

  it('refuses to unbind a group Pet created', async () => {
    harness = await openPetHarness()
    // A `created` group is entered from the GUI and must end there; undoing it
    // from inside the chat would strand a group Pet owns with nothing pointing
    // at it.
    await harness.repository.putChatBinding({
      chatId: CHAT,
      chatType: 'group',
      kind: 'qa',
      qaChildSessionId: 'session-child',
      qaParentSessionId: TARGET,
      qaOrigin: 'created',
      boundBy: 'user',
      boundAt: 1,
    })

    const outcome = await unbindGroup({ repository: harness.repository }, CHAT)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('not-unbindable')
    expect(renderUnbindReceipt(outcome)).toContain('Pet 面板归档')
  })

  it('refuses while the child is mid-answer', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    const bound = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })
    if (!bound.ok) return
    await harness.repository.updateTask(bound.taskId, undefined, task => ({
      ...task,
      status: 'running',
    }))

    const outcome = await unbindGroup({ repository: harness.repository }, CHAT)

    // Refusing beats interrupting an agent that may be part-way through
    // writing files; this is not an urgent operation.
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('busy')
    expect(harness.repository.getTask(bound.taskId)?.archivedAt).toBeUndefined()
  })

  it('reports an unbound group as nothing to undo', async () => {
    harness = await openPetHarness()

    const outcome = await unbindGroup({ repository: harness.repository }, CHAT)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('not-bound')
  })

  it('treats an already-archived pairing as success', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    const bound = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })
    if (!bound.ok) return
    await harness.repository.archiveTask(bound.taskId)

    const outcome = await unbindGroup({ repository: harness.repository }, CHAT)

    // The user asked for a state that already holds; inventing an error for
    // that would be pedantic.
    expect(outcome.ok).toBe(true)
  })
})

describe('replies never carry a full session id', () => {
  /** A full id looks like `session-<uuid>`; the short form is six chars. */
  const FULL_ID = /session-[0-9a-f]{8}-[0-9a-f]{4}/i

  it('uses the short id in a success receipt', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const text = renderBindReceipt(outcome)
    // The reply lands in a GROUP: everyone present would see an internal
    // identifier they have no use for and no business holding.
    expect(text).not.toMatch(FULL_ID)
    expect(outcome.sourceShortId).toHaveLength(6)
  })

  it('does not echo the bound session id when the group is taken', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    const second = await bindExistingGroup(d, { chatId: CHAT, prefix: 'def456' })

    expect(second.ok).toBe(false)
    expect(JSON.stringify(second)).not.toMatch(FULL_ID)
    expect(renderBindReceipt(second)).not.toMatch(FULL_ID)
  })

  it('names no chat id when the session is taken', async () => {
    harness = await openPetHarness()
    const d = await deps(harness)
    await bindExistingGroup(d, { chatId: CHAT, prefix: 'abc123d' })

    const other = await bindExistingGroup(d, {
      chatId: 'oc_another000000000000000000000000'.slice(0, 33),
      prefix: 'abc123d',
    })

    expect(other.ok).toBe(false)
    // Printing the other group's raw chat id into THIS group's transcript
    // would leak across conversations.
    expect(renderBindReceipt(other)).not.toMatch(/oc_[A-Za-z0-9]{10,}/)
  })

  it('falls back to a short id when a session has no title', async () => {
    harness = await openPetHarness()
    const stub = seamStub({ resumeFails: true })
    stub.seam.agents.get = () => undefined
    const d = await deps(harness, {
      seam: stub.seam,
      listSessions: () => [{ id: 'session-99887766-0000-0000-0000-00000000000a' }],
    })

    const outcome = await bindExistingGroup(d, { chatId: CHAT, prefix: '998877' })

    expect(outcome.ok).toBe(false)
    expect(renderBindReceipt(outcome)).not.toMatch(FULL_ID)
  })
})
