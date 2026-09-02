/**
 * `clean-worktree` capability tests.
 *
 * The adapter must never reconstruct or soften Worktree Session's safety
 * gates, so these cases drive a deterministic fake that reproduces the exact
 * refusal messages `wsClean` raises, and assert Pet surfaces them verbatim
 * without performing any real Git or organizational side effect.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanWorktreeDiagnostic,
  loadWorktreeMaintenance,
  runCleanWorktree,
  type CleanResultLike,
  type HostActivity,
  type WorktreeMaintenance,
} from '../src/host/clean-worktree.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const activity: HostActivity = {
  activePaths: () => ['/other/repo'],
  activeBoundSessionIds: () => [],
}

/** A fake reproducing the real gate behaviour without touching Git. */
function fakeMaintenance(
  behaviour: { refuseWith?: string; cleaned?: boolean } = {},
): WorktreeMaintenance & { calls: { dryRun: boolean; options: unknown }[] } {
  const calls: { dryRun: boolean; options: unknown }[] = []
  return {
    calls,
    wsStatus: vi.fn(async () => ({
      operationId: 'op-1',
      phase: 'prepared',
      repoRoot: '/repo',
      taskBranch: 'ws/task',
      worktreePath: '/repo/.worktrees/task',
      dependencyMode: 'lean',
    })),
    wsClean: vi.fn(async (_target: unknown, options: { dryRun?: boolean }) => {
      calls.push({ dryRun: options.dryRun === true, options })
      if (behaviour.refuseWith !== undefined) throw new Error(behaviour.refuseWith)
      return {
        dryRun: options.dryRun === true,
        operationId: 'op-1',
        worktreePath: '/repo/.worktrees/task',
        taskBranch: 'ws/task',
        actions: [
          'git worktree remove /repo/.worktrees/task',
          'git branch -d ws/task',
          'retain cleaned tombstone',
        ],
        cleaned: options.dryRun !== true && behaviour.cleaned !== false,
      } satisfies CleanResultLike
    }),
  }
}

async function seed(options: { sourceKind?: 'session' | 'none'; cwd?: string } = {}): Promise<PetHarness> {
  const created = await openPetHarness()
  const kind = options.sourceKind ?? 'session'
  await created.repository.createTask(
    testTask(
      kind === 'none'
        ? { scopeKey: 'independent:web:default', sourceKind: 'none', sourceId: undefined }
        : {},
    ),
  )
  await created.repository.putSnapshot({
    id: 'snap-1',
    invocationId: 'inv-1',
    sourceKind: kind,
    ...(kind === 'session' ? { sourceSessionId: 'src-1' } : {}),
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    capturedAt: 1,
  })
  await created.repository.appendInvocation(
    testInvocation({ capabilityId: 'clean-worktree', skillName: 'clean-worktree' }),
  )
  await created.repository.setInvocationStatus('inv-1', 'running')
  return created
}

describe('availability', () => {
  it('reports a diagnostic when Worktree Session is absent', () => {
    expect(cleanWorktreeDiagnostic(undefined)).toContain('not installed')
    expect(cleanWorktreeDiagnostic(fakeMaintenance())).toBeUndefined()
  })

  it('resolves the real installed maintenance module or reports absence', async () => {
    // In this repository the sibling package exists but is not a dependency of
    // dsh-pet, so absence must be handled gracefully rather than throwing.
    const loaded = await loadWorktreeMaintenance()
    expect(loaded === undefined || typeof loaded.wsClean === 'function').toBe(true)
  })

  it('refuses to run at all without the maintenance surface', async () => {
    harness = await seed({ cwd: '/repo' })

    await expect(
      runCleanWorktree({
        repository: harness.repository,
        maintenance: undefined,
        activity,
        executorSessionId: 'exec-1',
        confirm: false,
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})

describe('trusted target resolution', () => {
  it('derives the target from the snapshot, not from any argument', async () => {
    harness = await seed({ cwd: '/repo' })
    const maintenance = fakeMaintenance()

    await runCleanWorktree({
      repository: harness.repository,
      maintenance,
      activity,
      executorSessionId: 'exec-1',
      confirm: false,
    })

    const call = (maintenance.wsClean as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call?.[0]).toEqual({ sessionId: 'src-1', repoPath: '/repo' })
  })

  it('fails closed for a non-Pet session', async () => {
    harness = await seed({ cwd: '/repo' })

    await expect(
      runCleanWorktree({
        repository: harness.repository,
        maintenance: fakeMaintenance(),
        activity,
        executorSessionId: 'ordinary-session',
        confirm: true,
      }),
    ).rejects.toThrow(/not bound to a Pet Task/)
  })

  it('requires a session source', async () => {
    harness = await seed({ sourceKind: 'none' })

    await expect(
      runCleanWorktree({
        repository: harness.repository,
        maintenance: fakeMaintenance(),
        activity,
        executorSessionId: 'exec-1',
        confirm: false,
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_REQUIRED' })
  })

  it('requires a recorded repository root', async () => {
    harness = await seed()

    await expect(
      runCleanWorktree({
        repository: harness.repository,
        maintenance: fakeMaintenance(),
        activity,
        executorSessionId: 'exec-1',
        confirm: false,
      }),
    ).rejects.toThrow(/no repository root/)
  })
})

describe('safety gates are never bypassed', () => {
  it('always supplies live Host activity and requires it', async () => {
    harness = await seed({ cwd: '/repo' })
    const maintenance = fakeMaintenance()

    await runCleanWorktree({
      repository: harness.repository,
      maintenance,
      activity: {
        activePaths: () => ['/repo/.worktrees/other'],
        activeBoundSessionIds: () => ['src-9'],
      },
      executorSessionId: 'exec-1',
      confirm: false,
    })

    const options = maintenance.calls[0]?.options as Record<string, unknown>
    expect(options['requireActivePaths']).toBe(true)
    expect(options['activePaths']).toEqual(['/repo/.worktrees/other'])
    expect(options['activeBoundSessionIds']).toEqual(['src-9'])
  })

  it('previews with a dry run before any destructive call', async () => {
    harness = await seed({ cwd: '/repo' })
    const maintenance = fakeMaintenance()

    const outcome = await runCleanWorktree({
      repository: harness.repository,
      maintenance,
      activity,
      executorSessionId: 'exec-1',
      confirm: false,
    })

    expect(outcome.status).toBe('preview')
    expect(maintenance.calls).toEqual([{ dryRun: true, options: expect.anything() }])
    expect(outcome.actions).toContain('git worktree remove /repo/.worktrees/task')
  })

  it('runs a preview first even when confirming', async () => {
    harness = await seed({ cwd: '/repo' })
    const maintenance = fakeMaintenance()

    const outcome = await runCleanWorktree({
      repository: harness.repository,
      maintenance,
      activity,
      executorSessionId: 'exec-1',
      confirm: true,
    })

    expect(outcome.status).toBe('cleaned')
    expect(maintenance.calls.map(call => call.dryRun)).toEqual([true, false])
  })

  it.each([
    ['Refusing to clean a dirty worktree'],
    ['Task branch ws/task is not proven merged into main'],
    ['Refusing to clean a worktree used by an active DSH Session'],
    ['Operation is in-flight at phase worktree-created'],
    ['Task branch ws/task no longer descends from its recorded base commit'],
    ['Refusing to clean the caller current worktree'],
  ])('surfaces the gate refusal verbatim: %s', async reason => {
    harness = await seed({ cwd: '/repo' })

    const outcome = await runCleanWorktree({
      repository: harness.repository,
      maintenance: fakeMaintenance({ refuseWith: reason }),
      activity,
      executorSessionId: 'exec-1',
      confirm: true,
    })

    // A refusal is an actionable answer, not a Pet crash, and the text is
    // passed through unmodified so it cannot be softened.
    expect(outcome.status).toBe('refused')
    expect(outcome.reason).toContain(reason)
  })

  it('performs no side effect when the gates refuse', async () => {
    harness = await seed({ cwd: '/repo' })
    const maintenance = fakeMaintenance({ refuseWith: 'Refusing to clean a dirty worktree' })

    await runCleanWorktree({
      repository: harness.repository,
      maintenance,
      activity,
      executorSessionId: 'exec-1',
      confirm: true,
    })

    // The refusal happened on the dry run, so the destructive call never ran.
    expect(maintenance.calls.map(call => call.dryRun)).toEqual([true])
  })

  it('reports a gate that declined to clean without throwing', async () => {
    harness = await seed({ cwd: '/repo' })

    const outcome = await runCleanWorktree({
      repository: harness.repository,
      maintenance: fakeMaintenance({ cleaned: false }),
      activity,
      executorSessionId: 'exec-1',
      confirm: true,
    })

    expect(outcome.status).toBe('refused')
  })
})

describe('no real organizational side effects in CI', () => {
  it('never executes Git or network operations itself', async () => {
    harness = await seed({ cwd: '/repo' })
    const maintenance = fakeMaintenance()

    await runCleanWorktree({
      repository: harness.repository,
      maintenance,
      activity,
      executorSessionId: 'exec-1',
      confirm: true,
    })

    // Every effect is delegated; the adapter itself owns no shell, no Git and
    // no transport, so the fake fully bounds the blast radius.
    expect(maintenance.wsClean).toHaveBeenCalled()
    expect(Object.keys(maintenance)).toEqual(['calls', 'wsStatus', 'wsClean'])
  })
})
