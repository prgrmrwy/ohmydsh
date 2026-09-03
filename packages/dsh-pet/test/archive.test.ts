import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveTaskFromPet,
  reconcileArchives,
  registerArchiveObserver,
} from '../src/host/archive.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

function sink(): { archiveSession: ReturnType<typeof vi.fn> } {
  return { archiveSession: vi.fn(async () => {}) }
}

describe('source session archival', () => {
  it('updates display availability without archiving the Task', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask())

    const outcomes = await reconcileArchives(harness.repository, new Set(['src-1']))

    expect(outcomes).toEqual([{ taskId: 'task-1', action: 'source-archived' }])
    const task = harness.repository.getTask('task-1')
    expect(task?.sourceAvailability).toBe('archived')
    // The Task itself stays active with its executor and history intact.
    expect(task?.archivedAt).toBeUndefined()
    expect(task?.executorSessionId).toBe('exec-1')
  })

  it('is idempotent across repeated startup reconciliation', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask())
    await reconcileArchives(harness.repository, new Set(['src-1']))
    const afterFirst = harness.repository.getTask('task-1')?.revision

    const second = await reconcileArchives(harness.repository, new Set(['src-1']))

    expect(second).toEqual([])
    expect(harness.repository.getTask('task-1')?.revision).toBe(afterFirst)
  })
})

describe('executor session archived externally', () => {
  it('archives the Task when the executor is terminal', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))

    const outcomes = await reconcileArchives(harness.repository, new Set(['exec-1']))

    expect(outcomes).toEqual([{ taskId: 'task-1', action: 'task-archived' }])
    expect(harness.repository.getTask('task-1')?.archivedAt).toBeTypeOf('number')
  })

  it('keeps a running Task active and never infers cancellation', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'running' }))

    const outcomes = await reconcileArchives(harness.repository, new Set(['exec-1']))

    expect(outcomes[0]?.action).toBe('kept-active')
    const task = harness.repository.getTask('task-1')
    expect(task?.archivedAt).toBeUndefined()
    expect(task?.status).toBe('running')
    expect(task?.diagnostic).toContain('no unarchive operation')
  })

  it('keeps a waiting-user Task visible and diagnosable', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'waiting-user' }))

    const outcomes = await reconcileArchives(harness.repository, new Set(['exec-1']))

    expect(outcomes[0]?.action).toBe('kept-active')
    expect(harness.repository.getTask('task-1')?.status).toBe('waiting-user')
  })

  it('does not rewrite an identical diagnostic on every pass', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'running' }))
    await reconcileArchives(harness.repository, new Set(['exec-1']))
    const revision = harness.repository.getTask('task-1')?.revision

    await reconcileArchives(harness.repository, new Set(['exec-1']))

    // Loop prevention: a stable condition must not churn revisions forever.
    expect(harness.repository.getTask('task-1')?.revision).toBe(revision)
  })

  it('leaves an already-archived Task untouched', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask())
    await harness.repository.archiveTask('task-1')
    const revision = harness.repository.getTask('task-1')?.revision

    await reconcileArchives(harness.repository, new Set(['exec-1']))

    expect(harness.repository.getTask('task-1')?.revision).toBe(revision)
  })
})

describe('archiving from the Pet panel', () => {
  it('archives a terminal Task and syncs its executor session', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask(testTask({ status: 'idle' }))
    const target = sink()

    const archived = await archiveTaskFromPet(harness.repository, target, 'task-1', task.revision)

    expect(archived.archivedAt).toBeTypeOf('number')
    expect(target.archiveSession).toHaveBeenCalledWith('exec-1')
  })

  it('refuses to archive a waiting-user Task without explicit cancellation', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'waiting-user' }))
    const target = sink()

    await expect(
      archiveTaskFromPet(harness.repository, target, 'task-1'),
    ).rejects.toMatchObject({ code: 'ARCHIVE_BLOCKED' })

    expect(target.archiveSession).not.toHaveBeenCalled()
    expect(harness.repository.getTask('task-1')?.archivedAt).toBeUndefined()
  })

  it('records a diagnostic when session archival fails', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))
    const target = {
      archiveSession: vi.fn(async () => {
        throw new Error('session busy')
      }),
    }

    const archived = await archiveTaskFromPet(harness.repository, target, 'task-1')

    expect(archived.archivedAt).toBeTypeOf('number')
    expect(archived.diagnostic).toContain('session busy')
  })

  it('is idempotent for an already-archived Task', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))
    const target = sink()
    const first = await archiveTaskFromPet(harness.repository, target, 'task-1')

    const second = await archiveTaskFromPet(harness.repository, target, 'task-1')

    expect(second.archivedAt).toBe(first.archivedAt)
    expect(target.archiveSession).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown Task', async () => {
    harness = await openPetHarness()

    await expect(
      archiveTaskFromPet(harness.repository, sink(), 'ghost'),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
  })
})

describe('archival retains history and blocks new work', () => {
  it('keeps Task records, invocations and snapshots after archival', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask({ status: 'idle' }))
    await repo.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      capturedAt: 1,
    })
    await repo.appendInvocation(testInvocation())
    await repo.setInvocationStatus('inv-1', 'succeeded')

    await archiveTaskFromPet(repo, sink(), 'task-1')

    // Nothing is deleted by any archive path.
    expect(repo.getTask('task-1')).toBeDefined()
    expect(repo.listInvocations('task-1')).toHaveLength(1)
    expect(repo.getSnapshot('snap-1')).toBeDefined()
  })

  it('rejects new Invocations on an archived Task', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))
    await archiveTaskFromPet(harness.repository, sink(), 'task-1')

    await expect(
      harness.repository.appendInvocation(testInvocation({ id: 'inv-new' })),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' })
  })

  it('allows a new epoch for the same scope after archival', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask({ status: 'idle' }))
    await archiveTaskFromPet(repo, sink(), 'task-1')

    const epoch = await repo.allocateEpoch('session:src-1')
    const next = await repo.createTask(
      testTask({ id: 'task-2', epoch, executorSessionId: 'exec-2' }),
    )

    expect(next.id).toBe('task-2')
    expect(repo.findActiveTaskByScope('session:src-1')?.id).toBe('task-2')
  })
})

describe('live archive observation', () => {
  /** A context emitting the exact `domain/changed` shape DSH publishes. */
  function observerContext(): Context {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { archivedSessionIds: [], list: () => [] } as never)
    ctx.logger = { warn: () => {}, info: () => {} } as never
    return ctx
  }

  function globalPut(archivedSessionIds: string[]): unknown {
    // `table` and `key` are '' for a global-singleton write.
    return {
      domain: 'workspace',
      table: '',
      key: '',
      operation: 'put',
      value: { initialized: true, workspaceIds: [], archivedSessionIds },
    }
  }

  it('reconciles when an executor is archived natively, without a restart', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))
    const ctx = observerContext()
    registerArchiveObserver(ctx, harness.repository, sink())

    ctx.emit('domain/changed', globalPut(['exec-1']) as never)
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(harness.repository.getTask('task-1')?.archivedAt).toBeTypeOf('number')
  })

  it('marks an archived source without archiving the Task', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'running' }))
    const ctx = observerContext()
    registerArchiveObserver(ctx, harness.repository, sink())

    ctx.emit('domain/changed', globalPut(['src-1']) as never)
    await new Promise(resolve => setTimeout(resolve, 200))

    const task = harness.repository.getTask('task-1')
    expect(task?.sourceAvailability).toBe('archived')
    expect(task?.archivedAt).toBeUndefined()
  })

  it('ignores writes from other domains and non-global rows', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))
    const ctx = observerContext()
    registerArchiveObserver(ctx, harness.repository, sink())

    ctx.emit('domain/changed', {
      domain: 'dsh_pet',
      table: '',
      key: '',
      operation: 'put',
      value: { archivedSessionIds: ['exec-1'] },
    } as never)
    ctx.emit('domain/changed', {
      domain: 'workspace',
      table: 'workspaces',
      key: 'ws-1',
      operation: 'put',
      value: {},
    } as never)
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(harness.repository.getTask('task-1')?.archivedAt).toBeUndefined()
  })

  it('stops observing once disposed', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))
    const ctx = observerContext()
    const dispose = registerArchiveObserver(ctx, harness.repository, sink())

    dispose()
    ctx.emit('domain/changed', globalPut(['exec-1']) as never)
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(harness.repository.getTask('task-1')?.archivedAt).toBeUndefined()
  })
})

describe('archived source stays navigable as history', () => {
  it('keeps the source id and executor after the source is archived', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'running' }))

    await reconcileArchives(harness.repository, new Set(['src-1']))

    const task = harness.repository.getTask('task-1')
    // Display availability changes; the routing identity does not, so the
    // panel can still explain what the Task was attached to.
    expect(task?.sourceAvailability).toBe('archived')
    expect(task?.sourceId).toBe('src-1')
    expect(task?.executorSessionId).toBe('exec-1')
    expect(task?.archivedAt).toBeUndefined()
  })
})

describe('archiving the executor settles a recovering Task', () => {
  it('archives it instead of keeping it active forever', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask({
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      executorSessionId: 'exec-1',
    } as never)
    await harness.repository.appendInvocation({
      id: 'inv-a',
      taskId: task.id,
      clientInvocationId: 'client-a',
      capabilityId: 'ws',
      skillName: 'ws',
      snapshotId: 'snap-1',
      status: 'recovering',
      epoch: task.epoch,
      createdAt: Date.now(),
    } as never)
    await harness.repository.setTaskStatus(task.id, 'recovering', 'stranded')

    // The work was already unprovable and the session it would resume into is
    // gone, so nothing can advance it. Keeping it active strands the Task: its
    // slot stays occupied and later capabilities queue behind it forever.
    await reconcileArchives(harness.repository, new Set(['exec-1']))

    expect(harness.repository.getTask(task.id)?.archivedAt).toBeDefined()
    expect(harness.repository.getInvocation('inv-a')?.status).toBe('failed')
  })

  it('still keeps a running Task active when its executor is archived', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask({
      scopeKey: 'session:src-2',
      sourceKind: 'session',
      sourceId: 'src-2',
      executorSessionId: 'exec-2',
    } as never)
    await harness.repository.setTaskStatus(task.id, 'running')

    // An external archive is not proof that running work was cancelled.
    await reconcileArchives(harness.repository, new Set(['exec-2']))

    expect(harness.repository.getTask(task.id)?.archivedAt).toBeUndefined()
  })
})
