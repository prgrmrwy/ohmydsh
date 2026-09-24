/**
 * Crash and restart reconciliation across the two-system boundary.
 *
 * Pet storage and DSH session persistence have no shared transaction, so
 * every fixture here simulates a crash at a specific point and asserts that
 * recovery either PROVES the other side or reports uncertainty — never that
 * it optimistically reports success.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetChangeFeed } from '../src/host/changes.js'
import { reconcileCreatingExecutors } from '../src/host/executor.js'
import { emptyMedium, openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('Task persisted before executor creation', () => {
  it('fails the Task when the preallocated session never materialized', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'creating-executor' }))
    await first.close()

    harness = await openPetHarness(medium)
    const outcomes = await reconcileCreatingExecutors(harness.repository, () => false)

    expect(outcomes[0]?.kind).toBe('failed')
    const task = harness.repository.getTask('task-1')
    expect(task?.status).toBe('failed')
    // Explicitly NOT idle: uncertain work is never reported as ready.
    expect(task?.diagnostic).toContain('never created')
  })
})

describe('executor created before association commit', () => {
  it('commits the Task once the session is proven to exist', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'creating-executor' }))
    await first.close()

    harness = await openPetHarness(medium)
    // The session survived the crash; the association can be completed.
    const outcomes = await reconcileCreatingExecutors(
      harness.repository,
      id => id === 'exec-1',
    )

    expect(outcomes[0]?.kind).toBe('committed')
    expect(harness.repository.getTask('task-1')?.status).toBe('idle')
    expect(harness.repository.findTaskByExecutor('exec-1')?.id).toBe('task-1')
  })
})

describe('prompt dispatch uncertainty', () => {
  it('recovers a recovering Invocation from the durable record', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'recovering' }))
    await first.repository.appendInvocation(testInvocation())
    await first.repository.setInvocationStatus('inv-1', 'recovering')
    await first.close()

    harness = await openPetHarness(medium)

    // The uncertain state survives the restart for explicit diagnosis.
    expect(harness.repository.getTask('task-1')?.status).toBe('recovering')
    expect(harness.repository.getInvocation('inv-1')?.status).toBe('recovering')
  })

  it('does not treat a recovering Invocation as the resolvable current one', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation())
    await repo.setInvocationStatus('inv-1', 'recovering')

    // `recovering` is neither running nor waiting-user, so trusted context
    // resolution fails closed rather than handing back a stale snapshot.
    expect(repo.findCurrentInvocation('task-1')).toBeUndefined()
    // It still occupies the slot, so nothing else starts behind it.
    expect(repo.isSlotFree('task-1')).toBe(false)
  })
})

describe('queue recovery', () => {
  it('restores durable queue order after a restart', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask())
    await first.repository.appendInvocation(testInvocation({ id: 'inv-1' }))
    await first.repository.appendInvocation(testInvocation({ id: 'inv-2' }))
    await first.repository.appendInvocation(testInvocation({ id: 'inv-3' }))
    await first.repository.setInvocationStatus('inv-1', 'running')
    await first.close()

    harness = await openPetHarness(medium)
    const repo = harness.repository

    expect(repo.listInvocations('task-1').map(item => item.id)).toEqual([
      'inv-1',
      'inv-2',
      'inv-3',
    ])
    expect(repo.findCurrentInvocation('task-1')?.id).toBe('inv-1')
    expect(repo.nextQueued('task-1')?.id).toBe('inv-2')
  })

})

describe('browser closure during execution', () => {
  it('leaves Host-side execution state untouched', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'running' }))
    await first.repository.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      capturedAt: 1,
    })
    await first.repository.appendInvocation(testInvocation())
    await first.repository.setInvocationStatus('inv-1', 'running')
    // The browser closing is not a Host event at all; reopening simply reads
    // the same durable state.
    await first.close()

    harness = await openPetHarness(medium)
    const repo = harness.repository

    expect(repo.getTask('task-1')?.status).toBe('running')
    expect(repo.getInvocation('inv-1')?.status).toBe('running')
    expect(repo.getSnapshot('snap-1')?.sourceSessionId).toBe('src-1')
  })
})

describe('change feed replaces polling', () => {
  it('advances a monotonic generation on every publish', () => {
    const feed = new PetChangeFeed()
    const seen: number[] = []
    feed.subscribe(generation => seen.push(generation))

    feed.publish()
    feed.publish()

    expect(seen).toEqual([2, 3])
    expect(feed.generation).toBe(3)
  })

  it('reports staleness so a reconnect reloads a complete snapshot', () => {
    const feed = new PetChangeFeed()
    const adopted = feed.generation
    feed.publish()

    expect(feed.isStale(adopted)).toBe(true)
    expect(feed.isStale(feed.generation)).toBe(false)
  })

  it('survives a throwing listener without stalling the feed', () => {
    const feed = new PetChangeFeed()
    const good = vi.fn()
    feed.subscribe(() => {
      throw new Error('bad subscriber')
    })
    feed.subscribe(good)

    feed.publish()

    expect(good).toHaveBeenCalledWith(2)
    expect(feed.generation).toBe(2)
  })

  it('stops notifying a disposed subscriber', () => {
    const feed = new PetChangeFeed()
    const listener = vi.fn()
    const dispose = feed.subscribe(listener)

    dispose()
    feed.publish()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('in-flight work is reconciled on restart', () => {
  it('marks a running Task recovering instead of reporting it still running', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'running' }))
    await first.repository.appendInvocation(testInvocation())
    await first.repository.setInvocationStatus('inv-1', 'running')
    await first.close()

    harness = await openPetHarness(medium)
    const outcomes = await reconcileCreatingExecutors(harness.repository, () => true)

    // No Agent is driving this any more, so "running" would be a false claim.
    expect(outcomes).toHaveLength(1)
    const task = harness.repository.getTask('task-1')
    expect(task?.status).toBe('recovering')
    expect(task?.diagnostic).toContain('outcome is unknown')
    expect(harness.repository.getInvocation('inv-1')?.status).toBe('recovering')
  })

  it('reconciles a waiting-user Task the same way', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'waiting-user' }))
    await first.close()

    harness = await openPetHarness(medium)
    await reconcileCreatingExecutors(harness.repository, () => true)

    expect(harness.repository.getTask('task-1')?.status).toBe('recovering')
  })

  it('leaves settled and archived Tasks untouched', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.repository.createTask(testTask({ status: 'idle' }))
    await first.repository.createTask(
      testTask({ id: 'task-2', scopeKey: 'session:src-2', sourceId: 'src-2', executorSessionId: 'exec-2', status: 'idle' }),
    )
    await first.repository.archiveTask('task-2')
    await first.close()

    harness = await openPetHarness(medium)
    const outcomes = await reconcileCreatingExecutors(harness.repository, () => true)

    expect(outcomes).toEqual([])
    expect(harness.repository.getTask('task-1')?.status).toBe('idle')
    expect(harness.repository.getTask('task-2')?.archivedAt).toBeTypeOf('number')
  })
})

describe('a Task stranded in recovering is released', () => {
  it('frees the slot when the executor session still exists', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask({
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      executorSessionId: 'exec-1',
    } as never)
    const stalled = await harness.repository.appendInvocation({
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

    // `recovering` occupies the Invocation slot, so every later capability
    // queues behind it forever. The session is alive, so the work can simply
    // be re-invoked — stranding the Task helps nobody.
    await reconcileCreatingExecutors(harness.repository, () => true)

    expect(harness.repository.getTask(task.id)?.status).toBe('idle')
    expect(harness.repository.getInvocation(stalled.id)?.status).toBe('failed')
  })

  it('settles it as failed when the session is gone', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask({
      scopeKey: 'session:src-2',
      sourceKind: 'session',
      sourceId: 'src-2',
      executorSessionId: 'exec-2',
    } as never)
    await harness.repository.setTaskStatus(task.id, 'recovering', 'stranded')

    // A missing session is exactly the case that can never resume, so the
    // Task must settle rather than hold its slot forever. `sessions.get` only
    // finds a LIVE session, so an archived executor arrives here too.
    await reconcileCreatingExecutors(harness.repository, () => false)

    expect(harness.repository.getTask(task.id)?.status).toBe('failed')
  })
})
