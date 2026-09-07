/**
 * The QA group transaction: fork, create, bind — or leave nothing behind.
 *
 * These pin the failure paths rather than the happy one, because that is
 * where the design's promises live: a binding must never exist without its
 * child, and a group must never be exempt from the allowlist before all three
 * steps have landed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQaGroup, qaGroupName } from '../src/host/qa/action.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import type { LiveAgentLike, SubagentSeam } from '../src/host/qa/subagents.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const OWNER = 'ou_322ec1d3cd062f04bc2b1f4ba1eff8e9'
const SOURCE_SESSION = 'session-source'
const CREATED_CHAT = 'oc_created000000000000000000000000'

/** A live parent Agent as the seam hands it around. */
function liveAgent(id = SOURCE_SESSION): LiveAgentLike {
  return { session: { id } }
}

interface SeamStub {
  readonly seam: SubagentSeam
  readonly started: { childId?: string; label: string }[]
  readonly drained: string[]
  settleListener?: (info: { id: string; stopReason?: string }) => void
}

/** A seam whose behaviour each test can bend. */
function seamStub(
  options: {
    resident?: boolean
    resumeFails?: boolean
    startFails?: Error
  } = {},
): SeamStub {
  const started: { childId?: string; label: string }[] = []
  const drained: string[] = []
  const stub: SeamStub = {
    started,
    drained,
    seam: {
      agents: {
        get: (id: string) => (options.resident === false ? undefined : liveAgent(id)),
        resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
          if (options.resumeFails === true) throw new Error('cannot resume')
          return { agent: liveAgent(resumeSessionId) }
        }),
      },
      subagents: {
        startContinuable: vi.fn(async (spec: { childId?: string; label: string }) => {
          if (options.startFails !== undefined) throw options.startFails
          started.push({ ...(spec.childId !== undefined ? { childId: spec.childId } : {}), label: spec.label })
          return { childId: spec.childId ?? 'child-generated' }
        }),
        drainContinuableChildren: vi.fn(async (_parent: LiveAgentLike, ids: readonly string[]) => {
          drained.push(...ids)
        }),
        listChildren: vi.fn(async () => []),
      },
      queuePrompt: vi.fn(async () => 'message-1'),
      onChildSettled: listener => {
        stub.settleListener = listener
        return () => {
          stub.settleListener = undefined
        }
      },
    },
  }
  return stub
}

/** A Lark client whose group creation each test can bend. */
function larkStub(options: { createFails?: Error } = {}): LarkClient {
  return {
    addReaction: vi.fn(async () => 'reaction-1'),
    removeReaction: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => []),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => undefined),
    botReady: vi.fn(async () => true),
    reply: vi.fn(async () => undefined),
    createChat: vi.fn(async () => {
      if (options.createFails !== undefined) throw options.createFails
      return CREATED_CHAT
    }),
    sendToChat: vi.fn(async () => undefined),
  }
}

/** A harness with a bound channel and a configured owner. */
async function ready(): Promise<PetHarness> {
  const created = await openPetHarness()
  await created.repository.putChannelConfig({
    enabled: true,
    botAppId: 'cli_test',
    botOpenId: 'ou_bot0000000000000000000000000000',
    allowOpenIds: [OWNER],
    updatedAt: 1,
  })
  return created
}

describe('the group name', () => {
  it('carries the source session title', () => {
    expect(qaGroupName('排查登录失败')).toBe('答疑 · 排查登录失败')
  })

  it('clips a long title rather than sending an unusable name', () => {
    const name = qaGroupName('x'.repeat(80))
    // Lark caps group names, and a rejected create would fail the whole
    // action for a cosmetic reason.
    expect(name.length).toBeLessThan(40)
    expect(name.endsWith('…')).toBe(true)
  })

  it('falls back when the session has no title', () => {
    expect(qaGroupName(undefined)).toBe('答疑 · DSH')
    expect(qaGroupName('   ')).toBe('答疑 · DSH')
  })
})

describe('creating a QA group', () => {
  it('forks, creates the group and binds the two', async () => {
    harness = await ready()
    const seam = seamStub()
    const client = larkStub()

    const result = await createQaGroup(
      { repository: harness.repository, client, seam: seam.seam },
      { sessionId: SOURCE_SESSION, title: '排查登录失败', workspaceId: 'ws-nexus' },
    )

    expect(result.chatId).toBe(CREATED_CHAT)
    expect(seam.started).toHaveLength(1)
    // The child id is Pet-allocated, matching the phase-one habit of
    // preallocating identity before a cross-system write.
    expect(seam.started[0]?.childId).toBe(result.childSessionId)

    const binding = harness.repository.getChatBinding(CREATED_CHAT)
    expect(binding?.kind).toBe('qa')
    expect(binding?.qaChildSessionId).toBe(result.childSessionId)
    expect(binding?.qaParentSessionId).toBe(SOURCE_SESSION)
    // `user`, never `auto`: default routing must not overwrite a binding the
    // user deliberately created.
    expect(binding?.boundBy).toBe('user')

    const task = harness.repository.getTask(result.taskId)
    expect(task?.sourceKind).toBe('qa-chat')
    // The Task's "executor" IS the child: Pet created no session of its own.
    expect(task?.executorSessionId).toBe(result.childSessionId)
    expect(task?.status).toBe('idle')
  })

  it('invites the owner so the group starts as owner-plus-bot', async () => {
    harness = await ready()
    const seam = seamStub()
    const client = larkStub()

    await createQaGroup(
      { repository: harness.repository, client, seam: seam.seam },
      { sessionId: SOURCE_SESSION },
    )

    expect(client.createChat).toHaveBeenCalledWith(expect.any(String), [OWNER])
  })

  it('files the child under the source session workspace', async () => {
    harness = await ready()
    const seam = seamStub()
    const attached: { sessionId: string; workspaceId?: string }[] = []

    const result = await createQaGroup(
      {
        repository: harness.repository,
        client: larkStub(),
        seam: seam.seam,
        attachToWorkspace: async (sessionId, workspaceId) => {
          attached.push({ sessionId, ...(workspaceId !== undefined ? { workspaceId } : {}) })
        },
      },
      { sessionId: SOURCE_SESSION, workspaceId: 'ws-nexus' },
    )

    expect(attached).toEqual([{ sessionId: result.childSessionId, workspaceId: 'ws-nexus' }])
  })

  it('resumes a source session that is not resident', async () => {
    harness = await ready()
    const seam = seamStub({ resident: false })

    await createQaGroup(
      { repository: harness.repository, client: larkStub(), seam: seam.seam },
      { sessionId: SOURCE_SESSION },
    )

    expect(seam.seam.agents.resume).toHaveBeenCalledWith({ resumeSessionId: SOURCE_SESSION })
  })
})

describe('a QA group transaction that fails', () => {
  it('leaves nothing bound when the source session cannot be revived', async () => {
    harness = await ready()
    const seam = seamStub({ resident: false, resumeFails: true })

    await expect(
      createQaGroup(
        { repository: harness.repository, client: larkStub(), seam: seam.seam },
        { sessionId: SOURCE_SESSION },
      ),
    ).rejects.toThrow(/不可用/)

    expect(seam.started).toHaveLength(0)
    expect(harness.repository.listChatBindings()).toHaveLength(0)
  })

  it('releases the child when the group cannot be created', async () => {
    harness = await ready()
    const seam = seamStub()
    const client = larkStub({ createFails: new Error('lark refused') })

    await expect(
      createQaGroup(
        { repository: harness.repository, client, seam: seam.seam },
        { sessionId: SOURCE_SESSION },
      ),
    ).rejects.toThrow(/创建飞书群失败/)

    // Rollback: a child that outlived its failed transaction would sit
    // resident forever with nothing pointing at it.
    expect(seam.drained).toHaveLength(1)
    expect(harness.repository.listChatBindings()).toHaveLength(0)
    expect(harness.repository.listTasks()).toHaveLength(0)
  })

  it('names the orphan group when binding fails after creation', async () => {
    harness = await ready()
    const seam = seamStub()
    const client = larkStub()
    // Force step 3 to fail by occupying the scope the QA Task needs.
    const repository = harness.repository
    vi.spyOn(repository, 'createTask').mockRejectedValueOnce(new Error('scope taken'))

    await expect(
      createQaGroup({ repository, client, seam: seam.seam }, { sessionId: SOURCE_SESSION }),
    ).rejects.toThrow(/请手动删除该群/)

    // The group cannot be un-created, so the error must say so; the child is
    // still released, because a bound-to-nothing child is worse.
    expect(seam.drained).toHaveLength(1)
    expect(repository.getChatBinding(CREATED_CHAT)).toBeUndefined()
  })

  it('refuses when no owner is configured', async () => {
    const created = await openPetHarness()
    harness = created
    await created.repository.putChannelConfig({
      enabled: true,
      botAppId: 'cli_test',
      allowOpenIds: [],
      updatedAt: 1,
    })
    const seam = seamStub()

    await expect(
      createQaGroup(
        { repository: created.repository, client: larkStub(), seam: seam.seam },
        { sessionId: SOURCE_SESSION },
      ),
    ).rejects.toThrow(/allowlist/)

    // Nothing was forked: without a trusted owner there is nobody whose
    // invitations the admission exemption could trust.
    expect(seam.started).toHaveLength(0)
  })
})


describe('the child is told where it may work', () => {
  const WORKTREE = {
    executionRoot: '/repo/.worktrees/pet-2',
    branch: 'ws/pet-2',
    repositoryRoot: '/repo',
  }

  it('states the managed execution root in the seed prompt', async () => {
    harness = await ready()
    const seam = seamStub()
    const prompts: string[] = []
    vi.mocked(seam.seam.subagents.startContinuable).mockImplementation(
      async (spec: { childId?: string; request: { prompt: { text: string }[] } }) => {
        prompts.push(spec.request.prompt[0]?.text ?? '')
        return { childId: spec.childId ?? 'c' }
      },
    )

    await createQaGroup(
      { repository: harness.repository, client: larkStub(), seam: seam.seam },
      { sessionId: SOURCE_SESSION, worktree: WORKTREE },
    )

    // A fork copies the parent's `cwd`, which Worktree Session keeps at the
    // REPOSITORY ROOT while the real execution root lives in a binding the
    // child does not inherit. Without this statement the child would take the
    // main checkout for its working directory.
    expect(prompts[0]).toContain('/repo/.worktrees/pet-2')
    expect(prompts[0]).toContain('ws/pet-2')
    expect(prompts[0]).toContain('不是你该干活的地方')
  })

  it('persists the execution root on the binding', async () => {
    harness = await ready()

    const result = await createQaGroup(
      { repository: harness.repository, client: larkStub(), seam: seamStub().seam },
      { sessionId: SOURCE_SESSION, worktree: WORKTREE },
    )

    // Stored rather than re-derived per question: a later message must not
    // depend on the worktree plugin still answering.
    const binding = harness.repository.getChatBinding(result.chatId)
    expect(binding?.qaExecutionRoot).toBe('/repo/.worktrees/pet-2')
    expect(binding?.qaBranch).toBe('ws/pet-2')
    expect(binding?.qaRepositoryRoot).toBe('/repo')
  })

  it('says nothing about directories for an unbound source session', async () => {
    harness = await ready()
    const seam = seamStub()
    const prompts: string[] = []
    vi.mocked(seam.seam.subagents.startContinuable).mockImplementation(
      async (spec: { childId?: string; request: { prompt: { text: string }[] } }) => {
        prompts.push(spec.request.prompt[0]?.text ?? '')
        return { childId: spec.childId ?? 'c' }
      },
    )

    const result = await createQaGroup(
      { repository: harness.repository, client: larkStub(), seam: seam.seam },
      { sessionId: SOURCE_SESSION },
    )

    // The ordinary non-worktree case: the child works where its cwd points,
    // and inventing a constraint would be wrong.
    expect(prompts[0]).not.toContain('受管执行目录')
    expect(harness.repository.getChatBinding(result.chatId)?.qaExecutionRoot).toBeUndefined()
  })
})
