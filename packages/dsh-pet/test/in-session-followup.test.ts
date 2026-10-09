/**
 * In-session follow-up Invocations.
 *
 * The regression under test is the real one: a Pet Task settles, the user
 * replies in the executor session it owns, and the round used to reach the
 * model with no Invocation at all while `pet_context` failed closed. These
 * cases pin the registration, its exclusions, its timing and its serial
 * consequences.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { resolveTrustedContext } from '../src/host/capture.js'
import { SourceContextRegistry, type SourceResolver } from '../src/host/capture.js'
import { PetCoordinator, type PromptDispatcher } from '../src/host/coordinator.js'
import { PetError } from '../src/host/errors.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { FollowupCoordinator, isClientUserMessage } from '../src/host/followup.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { installTestSkill, openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'
import { SESSION_MESSAGE_CAPABILITY_ID } from '../src/wire.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const resolver: SourceResolver = {
  getSession: id =>
    id.startsWith('src') ? { id, title: `Session ${id}`, cwd: '/repo', asOfSeq: 7 } : undefined,
  getWorkspace: id => (id.startsWith('ws') ? { id, title: `Workspace ${id}` } : undefined),
}

interface Fixture {
  readonly coordinator: PetCoordinator
  readonly followups: FollowupCoordinator
  readonly harness: PetHarness
  readonly dispatched: { session: string; text: string }[]
}

interface FixtureOptions {
  readonly locator?: (workspaceId: string) => string | undefined
  readonly hasPendingUserTurn?: (executorSessionId: string) => boolean
  readonly waitMs?: number
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const created = await openPetHarness()
  harness = created
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)

  const dispatched: { session: string; text: string }[] = []
  const dispatcher: PromptDispatcher = {
    dispatch: vi.fn(async (session: string, text: string) => {
      dispatched.push({ session, text })
    }),
  }
  const agents: AgentRegistryLike = {
    create: vi.fn(async (opts: { sessionId: string }) => ({
      agent: { id: opts.sessionId },
      dispose: async () => undefined,
    })),
    get: () => undefined,
  } as unknown as AgentRegistryLike

  const coordinator = new PetCoordinator({
    repository: created.repository,
    capabilities: new CapabilityRegistry(),
    agents,
    dispatcher,
    resolver,
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
    ...(options.hasPendingUserTurn !== undefined
      ? { hasPendingUserTurn: options.hasPendingUserTurn }
      : {}),
    ...(options.locator !== undefined ? { workspaceLocator: options.locator } : {}),
  })

  const followups = new FollowupCoordinator(
    {
      resolveTask: executorSessionId => created.repository.findTaskByExecutor(executorSessionId),
      findByMessage: messageId => created.repository.findInvocationByFollowupMessage(messageId),
      register: input => coordinator.startFollowupInvocation(input),
    },
    options.waitMs === undefined ? {} : { waitMs: options.waitMs },
  )

  return { coordinator, followups, harness: created, dispatched }
}

/** A message shaped exactly as the Web client's prompt submission is. */
function clientMessage(text: string, id = 'msg-1'): unknown {
  return {
    id,
    source: { kind: 'user', rpcId: `rpc-${id}`, clientTimeZone: 'Asia/Shanghai' },
    content: [{ type: 'text', text }],
  }
}

/** A message shaped exactly as Pet's own envelope dispatch is. */
function envelopeMessage(text = '/ws clean'): unknown {
  return { id: 'msg-envelope', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

/** Seed a Task with one settled Invocation, the state the bug starts from. */
async function seedSettledTask(
  created: PetHarness,
  overrides: Partial<Parameters<PetHarness['repository']['createTask']>[0]> = {},
): Promise<{ taskId: string; snapshotId: string }> {
  await created.repository.createTask(
    testTask({ id: 'task-f', scopeKey: 'session:src-1', executorSessionId: 'exec-1', ...overrides }),
  )
  await created.repository.putSnapshot({
    id: 'snap-old',
    invocationId: 'inv-old',
    sourceKind: 'session',
    sourceSessionId: 'src-1',
    cwd: '/repo',
    capturedAt: 1,
  })
  await created.repository.appendInvocation(
    testInvocation({
      id: 'inv-old',
      taskId: 'task-f',
      capabilityId: 'create-mr',
      snapshotId: 'snap-old',
      status: 'succeeded',
    }),
  )
  return { taskId: 'task-f', snapshotId: 'snap-old' }
}

describe('in-session follow-up registration', () => {
  it('turns a client message typed after settlement into a live Invocation', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)
    // The exact failure: pet_context could not resolve anything for this turn.
    expect(() => resolveTrustedContext(f.harness.repository, 'exec-1')).toThrow(PetError)

    f.followups.observe('exec-1', clientMessage('放弃这个分支把'))
    await f.followups.waitForRegistration('exec-1')

    const invocations = f.harness.repository.listInvocations('task-f')
    expect(invocations).toHaveLength(2)
    const followup = invocations[1]!
    expect(followup.capabilityId).toBe(SESSION_MESSAGE_CAPABILITY_ID)
    expect(followup.status).toBe('running')
    expect(followup.followupMessageId).toBe('msg-1')
    expect(followup.request).toBe('放弃这个分支把')
    expect(f.harness.repository.getTask('task-f')?.status).toBe('running')

    // The trusted context now resolves THIS turn, against a FRESH snapshot.
    const context = resolveTrustedContext(f.harness.repository, 'exec-1')
    expect(context.invocationId).toBe(followup.id)
    expect(context.snapshot.id).not.toBe('snap-old')
    expect(context.snapshot.sourceSessionId).toBe('src-1')
  })

  it('never registers Pet’s own dispatch envelope', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)

    f.followups.observe('exec-1', envelopeMessage())
    await f.followups.waitForRegistration('exec-1')

    expect(f.harness.repository.listInvocations('task-f')).toHaveLength(1)
  })

  it('skips host-injected context and non-user sources', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)

    f.followups.observe('exec-1', {
      id: 'msg-memex',
      source: { kind: 'plugin:dsh-memex', form: 'instructions' },
      content: [{ type: 'text', text: '## Memex Memory System Active' }],
    })
    f.followups.observe('exec-1', {
      id: 'msg-time',
      source: { kind: 'time-context', form: 'snapshot' },
      content: [{ type: 'text', text: 'Time sampled' }],
    })
    await f.followups.waitForRegistration('exec-1')

    expect(f.harness.repository.listInvocations('task-f')).toHaveLength(1)
  })

  it('registers one Invocation for one message, however often it is observed', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)

    // Splice and claim both observe the same message; a replayed event may too.
    f.followups.observe('exec-1', clientMessage('继续'))
    f.followups.observe('exec-1', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-1')
    f.followups.observe('exec-1', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-1')

    expect(f.harness.repository.listInvocations('task-f')).toHaveLength(2)
  })

  it('refuses an archived Task', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)
    await f.harness.repository.archiveTask('task-f')

    f.followups.observe('exec-1', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-1')

    expect(f.harness.repository.listInvocations('task-f')).toHaveLength(1)
    expect(f.harness.repository.findInvocationByFollowupMessage('msg-1')).toBeUndefined()
  })

  it('refuses the fork-child (qa-chat) form', async () => {
    const f = await fixture()
    await f.harness.repository.createTask(
      testTask({
        id: 'task-qa',
        scopeKey: 'qa:src-1',
        sourceKind: 'qa-chat',
        sourceId: 'oc-chat',
        executorSessionId: 'exec-qa',
        status: 'idle',
      }),
    )

    f.followups.observe('exec-qa', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-qa')

    expect(f.harness.repository.listInvocations('task-qa')).toHaveLength(0)
  })

  it('never touches a session an external observer proves to be a locus child', async () => {
    const created = await openPetHarness()
    harness = created
    const registered: unknown[] = []
    const followups = new FollowupCoordinator({
      resolveTask: () => testTask({ id: 'task-locus', executorSessionId: 'exec-locus' }),
      findByMessage: () => undefined,
      register: async input => {
        registered.push(input)
        return { ok: true as const, invocationId: 'inv-x' }
      },
      isLocusChild: executorSessionId => executorSessionId === 'exec-locus',
    })

    followups.observe('exec-locus', clientMessage('继续'))
    await followups.waitForRegistration('exec-locus')

    expect(registered).toHaveLength(0)
  })

  it('classifies client submissions by source, not by text', () => {
    expect(isClientUserMessage(clientMessage('hi'))).toBe(true)
    expect(isClientUserMessage(envelopeMessage())).toBe(false)
    expect(isClientUserMessage({ source: { kind: 'user', rpcId: '' } })).toBe(false)
    expect(isClientUserMessage({ source: { kind: 'user', rpcId: 42 } })).toBe(false)
    expect(isClientUserMessage({ source: { kind: 'plugin:dsh-memex' } })).toBe(false)
    expect(isClientUserMessage({})).toBe(false)
    expect(isClientUserMessage(undefined)).toBe(false)
  })
})

describe('in-session follow-up timing and serialization', () => {
  it('defers while the serial slot is occupied, then registers on the claim', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)
    // A capability Invocation is mid-turn: the slot belongs to it.
    await f.harness.repository.appendInvocation(
      testInvocation({ id: 'inv-running', taskId: 'task-f', snapshotId: 'snap-old', status: 'running' }),
    )

    f.followups.observe('exec-1', clientMessage('顺便清理'))
    await f.followups.waitForRegistration('exec-1')
    expect(f.harness.repository.findInvocationByFollowupMessage('msg-1')).toBeUndefined()

    // That Invocation's turn ends; the user's message now gets its own turn
    // and the claim is what registers it.
    await f.coordinator.onAgentEvent('exec-1', { kind: 'turn-complete' })
    f.followups.observe('exec-1', clientMessage('顺便清理'))
    await f.followups.waitForRegistration('exec-1')

    const followup = f.harness.repository.findInvocationByFollowupMessage('msg-1')
    expect(followup?.status).toBe('running')
  })

  it('makes a queued capability wait for the in-session turn, then start it', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)
    await installTestSkill(f.harness, 'create-mr')

    f.followups.observe('exec-1', clientMessage('先聊两句'))
    await f.followups.waitForRegistration('exec-1')

    const accepted = await f.coordinator.accept({
      clientInvocationId: 'inv-cap',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })
    expect(accepted.started).toBe(false)
    expect(f.dispatched).toHaveLength(0)

    await f.coordinator.onAgentEvent('exec-1', { kind: 'turn-complete' })
    expect(f.dispatched).toHaveLength(1)
    expect(f.dispatched[0]?.text).toContain('inv-cap')
  })

  it('holds a dispatch back while the executor still queues a client message', async () => {
    let pending = true
    const f = await fixture({ hasPendingUserTurn: () => pending })
    await seedSettledTask(f.harness)
    await installTestSkill(f.harness, 'create-mr')

    const accepted = await f.coordinator.accept({
      clientInvocationId: 'inv-cap',
      capabilityId: 'create-mr',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
    })
    expect(accepted.started).toBe(false)
    expect(f.dispatched).toHaveLength(0)

    pending = false
    await f.coordinator.pump('task-f')
    expect(f.dispatched).toHaveLength(1)
  })

  it('retries a failed in-session Invocation on the same snapshot and request', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)
    f.followups.observe('exec-1', clientMessage('重跑一次'))
    await f.followups.waitForRegistration('exec-1')
    const followup = f.harness.repository.findInvocationByFollowupMessage('msg-1')!
    await f.harness.repository.setInvocationStatus(followup.id, 'failed')

    const before = f.harness.repository.getSnapshot(followup.snapshotId)
    await f.coordinator.retry(followup.id)

    expect(f.dispatched).toHaveLength(1)
    expect(f.dispatched[0]?.text).toContain('重跑一次')
    const after = f.harness.repository.getInvocation(followup.id)
    expect(after?.snapshotId).toBe(followup.snapshotId)
    expect(f.harness.repository.getSnapshot(followup.snapshotId)).toEqual(before)
  })

  it('bounds the registration wait instead of hanging a turn', async () => {
    const never = new FollowupCoordinator(
      {
        resolveTask: () => testTask({ id: 'task-slow', executorSessionId: 'exec-slow' }),
        findByMessage: () => undefined,
        register: () => new Promise(() => undefined),
      },
      { waitMs: 30 },
    )
    never.observe('exec-slow', clientMessage('继续'))
    const started = Date.now()
    await never.waitForRegistration('exec-slow')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('resolves immediately when nothing is being registered', async () => {
    const f = await fixture()
    const started = Date.now()
    await f.followups.waitForRegistration('exec-1')
    expect(Date.now() - started).toBeLessThan(50)
  })
})

describe('in-session follow-up snapshots', () => {
  it('rebuilds the Task’s own source and ignores identifiers in the text', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)

    f.followups.observe(
      'exec-1',
      clientMessage('去 session-other 和 /Users/someone/elsewhere 上操作'),
    )
    await f.followups.waitForRegistration('exec-1')

    const followup = f.harness.repository.findInvocationByFollowupMessage('msg-1')!
    const snapshot = f.harness.repository.getSnapshot(followup.snapshotId)!
    expect(snapshot.sourceKind).toBe('session')
    expect(snapshot.sourceSessionId).toBe('src-1')
    expect(snapshot.cwd).toBe('/repo')
    expect(snapshot.asOfSeq).toBe(7)
    expect(JSON.stringify(snapshot)).not.toContain('session-other')
  })

  it('rebuilds a workspace source', async () => {
    const f = await fixture()
    await f.harness.repository.createTask(
      testTask({
        id: 'task-w',
        scopeKey: 'workspace:ws-1',
        sourceKind: 'workspace',
        sourceId: 'ws-1',
        sourceTitle: 'acme',
        executorSessionId: 'exec-w',
      }),
    )

    f.followups.observe('exec-w', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-w')

    const followup = f.harness.repository.findInvocationByFollowupMessage('msg-1')!
    const snapshot = f.harness.repository.getSnapshot(followup.snapshotId)!
    expect(snapshot.sourceKind).toBe('workspace')
    expect(snapshot.sourceWorkspaceId).toBe('ws-1')
  })

  it('keeps an independent Task genuinely sourceless', async () => {
    const f = await fixture()
    await f.harness.repository.createTask(
      testTask({
        id: 'task-n',
        scopeKey: 'independent:web:default',
        sourceKind: 'none',
        sourceId: undefined,
        executorSessionId: 'exec-n',
      }),
    )

    f.followups.observe('exec-n', clientMessage('独立任务继续'))
    await f.followups.waitForRegistration('exec-n')

    const followup = f.harness.repository.findInvocationByFollowupMessage('msg-1')!
    const snapshot = f.harness.repository.getSnapshot(followup.snapshotId)!
    expect(snapshot.sourceKind).toBe('none')
    expect(snapshot.sourceSessionId).toBeUndefined()
    expect(snapshot.sourceWorkspaceId).toBeUndefined()
  })

  it('rebuilds a resident chat source without inventing a reply target', async () => {
    const f = await fixture({ locator: id => (id === 'ws-9' ? '/work/acme' : undefined) })
    await f.harness.repository.createTask(
      testTask({
        id: 'task-c',
        scopeKey: 'chat:oc-1',
        sourceKind: 'chat',
        sourceId: 'oc-1',
        sourceTitle: 'acme 群',
        residentWorkspaceId: 'ws-9',
        executorSessionId: 'exec-c',
      }),
    )

    f.followups.observe('exec-c', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-c')

    const followup = f.harness.repository.findInvocationByFollowupMessage('msg-1')!
    const snapshot = f.harness.repository.getSnapshot(followup.snapshotId)!
    expect(snapshot.sourceKind).toBe('chat')
    expect(snapshot.sourceWorkspaceId).toBe('ws-9')
    expect(snapshot.workspaceTitle).toBe('acme 群')
    expect(snapshot.cwd).toBe('/work/acme')
    // No Lark reply may be attached to a turn the chat did not raise.
    expect(f.harness.repository.getInvocationChannel(followup.id)).toBeUndefined()
  })

  it('refuses to register when the source can no longer be re-derived', async () => {
    const f = await fixture()
    await f.harness.repository.createTask(
      testTask({
        id: 'task-c',
        scopeKey: 'chat:oc-1',
        sourceKind: 'chat',
        sourceId: 'oc-1',
        residentWorkspaceId: 'ws-gone',
        executorSessionId: 'exec-c',
      }),
    )

    f.followups.observe('exec-c', clientMessage('继续'))
    await f.followups.waitForRegistration('exec-c')

    expect(f.harness.repository.findInvocationByFollowupMessage('msg-1')).toBeUndefined()
    expect(f.harness.repository.listInvocations('task-c')).toHaveLength(0)
  })
})

describe('idle diagnosis', () => {
  it('explains that the turn owns no Invocation without leaking a snapshot', async () => {
    const f = await fixture()
    await seedSettledTask(f.harness)
    await f.coordinator.onAgentEvent('exec-1', { kind: 'turn-complete' })

    let thrown: unknown
    try {
      resolveTrustedContext(f.harness.repository, 'exec-1')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PetError)
    const error = thrown as PetError
    expect(error.code).toBe('NO_CURRENT_INVOCATION')
    expect(error.message).toContain('idle')
    expect(error.message).toContain('not part of any Invocation')
    expect(error.message).not.toContain('/repo')
    expect(error.message).not.toContain('snap-old')
  })
})
