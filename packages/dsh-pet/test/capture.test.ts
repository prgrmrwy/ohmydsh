import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SourceContextRegistry,
  resolveTrustedContext,
  validateCapture,
  type SourceResolver,
} from '../src/host/capture.js'
import { executePetContext } from '../src/host/context-tool.js'
import { createWorktreeProvider } from '../src/host/worktree-adapter.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'
import type { PetInvocationCapture, PetSourceSnapshot } from '../src/wire.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const resolver: SourceResolver = {
  getSession: id =>
    id === 'src-1'
      ? { id: 'src-1', title: 'Fix login timeout', cwd: '/repo', asOfSeq: 42 }
      : undefined,
  getWorkspace: id => (id === 'ws-1' ? { id: 'ws-1', title: 'My Repo', path: '/repo' } : undefined),
}

function capture(overrides: Partial<PetInvocationCapture> = {}): PetInvocationCapture {
  return {
    clientInvocationId: 'inv-1',
    capabilityId: 'create-mr',
    sourceKind: 'session',
    sourceSessionId: 'src-1',
    ...overrides,
  }
}

describe('browser capture validation', () => {
  it('builds a snapshot from Host-proven facts', async () => {
    const result = await validateCapture(
      capture(),
      'session-required',
      resolver,
      new SourceContextRegistry(),
    )

    expect(result.scopeKey).toBe('session:src-1')
    expect(result.snapshot.sessionTitle).toBe('Fix login timeout')
    expect(result.snapshot.cwd).toBe('/repo')
    // The durable event anchor proves where the snapshot was taken.
    expect(result.snapshot.asOfSeq).toBe(42)
  })

  it('prefers Host-proven titles over browser-supplied display strings', async () => {
    const result = await validateCapture(
      capture({ sessionTitle: 'Spoofed title' }),
      'optional',
      resolver,
      new SourceContextRegistry(),
    )

    expect(result.snapshot.sessionTitle).toBe('Fix login timeout')
  })

  it('rejects an unknown session before any prompt can be queued', async () => {
    await expect(
      validateCapture(
        capture({ sourceSessionId: 'ghost' }),
        'session-required',
        resolver,
        new SourceContextRegistry(),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
  })

  it('blocks a session-required capability with no session', async () => {
    await expect(
      validateCapture(
        capture({ sourceKind: 'none', sourceSessionId: undefined }),
        'session-required',
        resolver,
        new SourceContextRegistry(),
      ),
    ).rejects.toMatchObject({ code: 'CONTEXT_REQUIRED' })
  })

  it('creates an independent scope for a none source', async () => {
    const result = await validateCapture(
      capture({ sourceKind: 'none', sourceSessionId: undefined }),
      'none',
      resolver,
      new SourceContextRegistry(),
    )

    expect(result.scopeKey).toBe('independent:web:default')
    expect(result.snapshot.sourceKind).toBe('none')
    // Never fabricate a source for an independent Task.
    expect(result.snapshot.sourceSessionId).toBeUndefined()
    expect(result.snapshot.sessionTitle).toBeUndefined()
  })

  it('honors an explicitly removed optional source', async () => {
    // The user removed the current session before running an optional capability.
    const result = await validateCapture(
      capture({ sourceKind: 'none', sourceSessionId: undefined }),
      'optional',
      resolver,
      new SourceContextRegistry(),
    )

    // The removed session's context must not leak into the snapshot.
    expect(result.snapshot.sourceSessionId).toBeUndefined()
    expect(result.snapshot.cwd).toBeUndefined()
  })

  it('resolves a workspace source', async () => {
    const result = await validateCapture(
      capture({ sourceKind: 'workspace', sourceSessionId: undefined, sourceWorkspaceId: 'ws-1' }),
      'workspace-required',
      resolver,
      new SourceContextRegistry(),
    )

    expect(result.scopeKey).toBe('workspace:ws-1')
    expect(result.snapshot.workspaceTitle).toBe('My Repo')
  })
})

describe('source context providers', () => {
  it('merges optional worktree facts', async () => {
    const registry = new SourceContextRegistry()
    registry.register(
      createWorktreeProvider({
        sessionStatus: async () => ({
          bound: true,
          worktreePath: '/repo/.worktrees/task',
          taskBranch: 'ws/task',
          dependencyMode: 'lean',
          lifecycle: 'admitted',
        }),
      }),
    )

    const result = await validateCapture(capture(), 'session-required', resolver, registry)

    // The managed execution root differs from the header cwd by design.
    expect(result.snapshot.cwd).toBe('/repo')
    expect(result.snapshot.worktree?.executionRoot).toBe('/repo/.worktrees/task')
    expect(result.snapshot.worktree?.branch).toBe('ws/task')
  })

  it('omits worktree fields when the plugin is not installed', async () => {
    const result = await validateCapture(
      capture(),
      'session-required',
      resolver,
      new SourceContextRegistry(),
    )

    expect(result.snapshot.worktree).toBeUndefined()
  })

  it('never infers a managed execution root from cwd when unbound', async () => {
    const registry = new SourceContextRegistry()
    registry.register(createWorktreeProvider({ sessionStatus: async () => ({ bound: false }) }))

    const result = await validateCapture(capture(), 'session-required', resolver, registry)

    expect(result.snapshot.worktree).toBeUndefined()
    expect(result.snapshot.cwd).toBe('/repo')
  })

  it('surfaces a provider failure instead of silently omitting facts', async () => {
    const registry = new SourceContextRegistry()
    registry.register(
      createWorktreeProvider({
        sessionStatus: async () => {
          throw new Error('worktree state unreadable')
        },
      }),
    )

    await expect(
      validateCapture(capture(), 'session-required', resolver, registry),
    ).rejects.toThrow(/worktree-session.*worktree state unreadable/)
  })

  it('supports registration and disposal', () => {
    const registry = new SourceContextRegistry()
    const dispose = registry.register({ name: 'p', enrich: async () => undefined })
    expect(registry.names).toEqual(['p'])
    dispose()
    expect(registry.names).toEqual([])
  })
})

describe('snapshot immutability across page switches', () => {
  it('keeps the Invocation bound to its snapshot after the browser moves on', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    const snapshot: PetSourceSnapshot = {
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      sessionTitle: 'Session A',
      capturedAt: 1_700_000_000_000,
    }
    await repo.putSnapshot(snapshot)
    await repo.appendInvocation(testInvocation())
    await repo.setInvocationStatus('inv-1', 'running')

    // The browser is now on Session B; resolution must still yield Session A.
    const context = resolveTrustedContext(repo, 'exec-1')

    expect(context.snapshot.sourceSessionId).toBe('src-1')
    expect(context.snapshot.sessionTitle).toBe('Session A')
  })

  it('gives a later Invocation a fresh snapshot on the same Task', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      asOfSeq: 10,
      capturedAt: 1,
    })
    await repo.appendInvocation(testInvocation())
    await repo.setInvocationStatus('inv-1', 'succeeded')

    await repo.putSnapshot({
      id: 'snap-2',
      invocationId: 'inv-2',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      asOfSeq: 99,
      capturedAt: 2,
    })
    await repo.appendInvocation(testInvocation({ id: 'inv-2', snapshotId: 'snap-2' }))
    await repo.setInvocationStatus('inv-2', 'running')

    const context = resolveTrustedContext(repo, 'exec-1')

    // The second capability observes the evolved source, not the first snapshot.
    expect(context.invocationId).toBe('inv-2')
    expect(context.snapshot.asOfSeq).toBe(99)
  })
})

describe('pet_context fails closed', () => {
  async function seedRunning(): Promise<PetHarness> {
    const created = await openPetHarness()
    await created.repository.createTask(testTask())
    await created.repository.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      sessionTitle: 'Fix login',
      cwd: '/repo',
      capturedAt: 1_700_000_000_000,
    })
    await created.repository.appendInvocation(testInvocation())
    await created.repository.setInvocationStatus('inv-1', 'running')
    return created
  }

  it('returns trusted context for the calling executor session', async () => {
    harness = await seedRunning()

    const result = executePetContext(harness.repository, {
      agent: { session: { id: 'exec-1' } },
    })

    expect(result.taskId).toBe('task-1')
    expect(result.invocationId).toBe('inv-1')
    expect(result.source.sessionId).toBe('src-1')
    expect(result.source.repositoryRoot).toBe('/repo')
  })

  it('rejects an ordinary non-Pet session without leaking other contexts', async () => {
    harness = await seedRunning()

    expect(() =>
      executePetContext(harness!.repository, { agent: { session: { id: 'ordinary' } } }),
    ).toThrow(/not bound to a Pet Task/)
  })

  it('rejects a call with no agent binding', async () => {
    harness = await seedRunning()

    expect(() => executePetContext(harness!.repository, {})).toThrow(/must be called from a Pet/)
  })

  it('fails closed for an archived Task', async () => {
    harness = await seedRunning()
    await harness.repository.setInvocationStatus('inv-1', 'succeeded')
    await harness.repository.archiveTask('task-1')

    expect(() =>
      executePetContext(harness!.repository, { agent: { session: { id: 'exec-1' } } }),
    ).toThrow(/is archived/)
  })

  it('fails closed when there is no current Invocation', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask())

    expect(() =>
      executePetContext(harness!.repository, { agent: { session: { id: 'exec-1' } } }),
    ).toThrow(/no running or waiting Invocation/)
  })

  it('fails closed when the current Invocation is ambiguous', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation())
    await repo.appendInvocation(testInvocation({ id: 'inv-2' }))
    await repo.setInvocationStatus('inv-1', 'running')
    await repo.setInvocationStatus('inv-2', 'running')

    expect(() =>
      executePetContext(repo, { agent: { session: { id: 'exec-1' } } }),
    ).toThrow(/concurrent Invocations/)
  })

  it('accepts no arguments, so a target cannot be substituted', async () => {
    harness = await seedRunning()
    const spy = vi.spyOn(harness.repository, 'findTaskByExecutor')

    executePetContext(harness.repository, {
      // A hostile model may only influence its own session identity, which the
      // agent loop sets — there is no argument surface at all.
      agent: { session: { id: 'exec-1' } },
    })

    expect(spy).toHaveBeenCalledWith('exec-1')
  })
})
