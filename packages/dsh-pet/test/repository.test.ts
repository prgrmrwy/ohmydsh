import { afterEach, describe, expect, it } from 'vitest'
import { PetError } from '../src/host/errors.js'
import { emptyMedium, openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('active-Task uniqueness per scope', () => {
  it('reuses one unarchived Task per scope key and refuses a second', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())

    await expect(repo.createTask(testTask({ id: 'task-2', executorSessionId: 'exec-2' })))
      .rejects.toThrow(/already has an active Pet Task/)

    expect(repo.findActiveTaskByScope('session:src-1')?.id).toBe('task-1')
  })

  it('keeps different scopes independent', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.createTask(
      testTask({
        id: 'task-b',
        scopeKey: 'workspace:ws-9',
        sourceKind: 'workspace',
        sourceId: 'ws-9',
        executorSessionId: 'exec-b',
      }),
    )

    expect(repo.findActiveTaskByScope('session:src-1')?.id).toBe('task-1')
    expect(repo.findActiveTaskByScope('workspace:ws-9')?.id).toBe('task-b')
  })

  it('allows a new epoch for the same scope only after archival', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.archiveTask('task-1')

    const epoch = await repo.allocateEpoch('session:src-1')
    const next = await repo.createTask(
      testTask({ id: 'task-2', epoch, executorSessionId: 'exec-2' }),
    )

    expect(next.epoch).toBe(1)
    expect(repo.findActiveTaskByScope('session:src-1')?.id).toBe('task-2')
    // The archived Task survives as read-only history.
    expect(repo.getTask('task-1')?.archivedAt).toBeTypeOf('number')
  })
})

describe('one executor session per Task', () => {
  it('refuses to bind an executor already owned by another Task', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())

    await expect(
      repo.createTask(testTask({ id: 'task-2', scopeKey: 'workspace:w', sourceKind: 'workspace', sourceId: 'w' })),
    ).rejects.toThrow(/already bound to Task task-1/)
  })

  it('resolves the owning Task from the executor session id', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())

    expect(repo.findTaskByExecutor('exec-1')?.id).toBe('task-1')
    expect(repo.findTaskByExecutor('not-a-pet-session')).toBeUndefined()
  })
})

describe('serial Invocation queue', () => {
  it('appends invocations in durable FIFO order', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())

    const first = await repo.appendInvocation(testInvocation())
    const second = await repo.appendInvocation(testInvocation({ id: 'inv-2' }))

    expect(first.queuePosition).toBe(0)
    expect(second.queuePosition).toBe(1)
    expect(repo.listInvocations('task-1').map(item => item.id)).toEqual(['inv-1', 'inv-2'])
  })

  it('exposes exactly one current Invocation and queues the rest', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation())
    await repo.appendInvocation(testInvocation({ id: 'inv-2' }))
    await repo.setInvocationStatus('inv-1', 'running')

    expect(repo.findCurrentInvocation('task-1')?.id).toBe('inv-1')
    expect(repo.isSlotFree('task-1')).toBe(false)
    expect(repo.nextQueued('task-1')?.id).toBe('inv-2')
  })

  it('frees the slot only after terminal settlement', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation())
    await repo.setInvocationStatus('inv-1', 'waiting-user')

    // waiting-user still occupies the slot: a later Invocation must not preempt it.
    expect(repo.isSlotFree('task-1')).toBe(false)
    await repo.setInvocationStatus('inv-1', 'succeeded')
    expect(repo.isSlotFree('task-1')).toBe(true)
    expect(repo.findCurrentInvocation('task-1')).toBeUndefined()
  })

  it('refuses to resurrect a settled Invocation', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation())
    await repo.setInvocationStatus('inv-1', 'cancelled')

    await expect(repo.setInvocationStatus('inv-1', 'running')).rejects.toThrow(/already settled/)
  })
})

describe('archived Tasks reject new work', () => {
  it('refuses new Invocations on an archived Task', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.archiveTask('task-1')

    await expect(repo.appendInvocation(testInvocation())).rejects.toMatchObject({
      code: 'TASK_ARCHIVED',
    })
  })

  it('blocks archival of a non-terminal Task until cancellation settles', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask({ status: 'waiting-user' }))

    await expect(repo.archiveTask('task-1')).rejects.toMatchObject({ code: 'ARCHIVE_BLOCKED' })
    expect(repo.getTask('task-1')?.archivedAt).toBeUndefined()
  })

  it('is idempotent so bidirectional archive sync cannot loop', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    const first = await repo.archiveTask('task-1')
    const second = await repo.archiveTask('task-1')

    expect(second.archivedAt).toBe(first.archivedAt)
    expect(second.revision).toBe(first.revision)
  })

  it('keeps execution status separate from archive state', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask({ status: 'failed' }))
    const archived = await repo.archiveTask('task-1')

    expect(archived.status).toBe('failed')
    expect(archived.archivedAt).toBeTypeOf('number')
  })
})

describe('immutable snapshots', () => {
  it('refuses to rewrite an existing snapshot', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    const snapshot = {
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session' as const,
      sourceSessionId: 'src-1',
      capturedAt: 1_700_000_000_000,
    }
    await repo.putSnapshot(snapshot)

    await expect(repo.putSnapshot({ ...snapshot, sourceSessionId: 'other' })).rejects.toThrow(
      /immutable and already exists/,
    )
    expect(repo.getSnapshot('snap-1')?.sourceSessionId).toBe('src-1')
  })
})

describe('optimistic revision fencing', () => {
  it('rejects a stale revision', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.setTaskStatus('task-1', 'running')

    await expect(
      repo.updateTask('task-1', 0, current => ({ ...current, status: 'idle' })),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('accepts the observed revision and advances it', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    const created = await repo.createTask(testTask())

    const next = await repo.updateTask('task-1', created.revision, current => ({
      ...current,
      status: 'running',
    }))

    expect(next.revision).toBe(created.revision + 1)
  })
})

describe('digest retention', () => {
  it('retains digests referenced by live Tasks and enabled selections', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation({ skillDigest: 'sha256-live' }))
    await repo.putSkillSelection({
      skillName: 'send-cr',
      enabledDigest: 'sha256-enabled',
      showAsShortcut: true,
    })

    const retained = repo.referencedDigests()

    expect(retained.has('create-mr@sha256-live')).toBe(true)
    expect(retained.has('send-cr@sha256-enabled')).toBe(true)
    expect(retained.has('create-mr@sha256-unused')).toBe(false)
  })

  it('keeps a digest referenced by a non-terminal Invocation of an archived Task', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation({ skillDigest: 'sha256-queued' }))
    await repo.setTaskStatus('task-1', 'idle')
    await repo.archiveTask('task-1')

    // Still queued, so its fixed revision must not be garbage collected.
    expect(repo.referencedDigests().has('create-mr@sha256-queued')).toBe(true)
  })
})

describe('restart recovery', () => {
  it('recovers Tasks, queue order and snapshots from the same medium', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask())
    await first.repository.appendInvocation(testInvocation())
    await first.repository.appendInvocation(testInvocation({ id: 'inv-2' }))
    await first.repository.setInvocationStatus('inv-1', 'running')
    await first.close()

    harness = await openPetHarness(medium)
    const repo = harness.repository

    expect(repo.getTask('task-1')?.executorSessionId).toBe('exec-1')
    expect(repo.listInvocations('task-1').map(item => item.id)).toEqual(['inv-1', 'inv-2'])
    expect(repo.findCurrentInvocation('task-1')?.id).toBe('inv-1')
  })

  it('rejects a version-mismatched medium instead of silently reinitializing', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask())
    await first.close()
    medium.version = 999

    await expect(openPetHarness(medium)).rejects.toThrow(/version-mismatch/)
  })

  it('leaves memory untouched when the medium rejects a write', async () => {
    harness = await openPetHarness(emptyMedium(), { failWrites: new Error('disk full') })

    await expect(harness.repository.createTask(testTask())).rejects.toThrow(/disk full/)
    // The durable write is awaited BEFORE memory mutates, so a failed write
    // must not leave a phantom Task readable.
    expect(harness.repository.getTask('task-1')).toBeUndefined()
  })

  it('preserves an explicit intermediate state across restart', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'creating-executor' }))
    await first.close()

    harness = await openPetHarness(medium)

    // Reconciliation must see the uncertain state rather than a success.
    expect(harness.repository.getTask('task-1')?.status).toBe('creating-executor')
  })
})

describe('epoch and skill-set generation allocation', () => {
  it('allocates monotonic epochs per scope', async () => {
    harness = await openPetHarness()
    const repo = harness.repository

    expect(await repo.allocateEpoch('session:a')).toBe(1)
    expect(await repo.allocateEpoch('session:a')).toBe(2)
    expect(await repo.allocateEpoch('session:b')).toBe(1)
  })

  it('bumps the skill-set generation on every selection change', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    const before = repo.global.skillSetGeneration

    const after = await repo.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: 'sha256-a',
      showAsShortcut: true,
    })

    expect(after).toBe(before + 1)
    expect(repo.global.skillSetGeneration).toBe(after)
  })
})

describe('error typing', () => {
  it('reports missing entities with stable codes', async () => {
    harness = await openPetHarness()
    const repo = harness.repository

    await expect(repo.updateTask('nope', undefined, task => task)).rejects.toBeInstanceOf(PetError)
    await expect(repo.updateTask('nope', undefined, task => task)).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
    })
  })
})
