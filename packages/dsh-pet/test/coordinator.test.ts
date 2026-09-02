import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from '../src/host/capture.js'
import { PetCoordinator, type PromptDispatcher } from '../src/host/coordinator.js'
import { PetError } from '../src/host/errors.js'
import { renderEnvelope } from '../src/host/envelope.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { openPetHarness, testInvocation, testTask, type PetHarness,
  installTestSkill,
} from './harness.js'
import type { PetInvocationCapture } from '../src/wire.js'

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
  readonly harness: PetHarness
  readonly dispatched: { session: string; text: string }[]
  readonly capabilities: CapabilityRegistry
}

async function fixture(options: { dispatchFails?: boolean } = {}): Promise<Fixture> {
  const created = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)

  // Two enabled Pet skills so capability resolution succeeds.
  for (const name of ['create-mr', 'send-cr']) {
    await created.repository.putSkillRevision({
      skillName: name,
      sourcePath: `/tmp/pet-test-skills/${name}`,
      description: name,
      // Capabilities are derived from registered Skills, so the Skill carries
      // its own context requirement exactly as its frontmatter would.
      pet: { context: 'session-required' },
      provenance: { kind: 'local-link', installedAt: 1 },
      fileCount: 1,
      totalBytes: 1,
    })
    await created.repository.putSkillSelection({
      skillName: name,
      enabled: true,
      showAsShortcut: true,
    })
  }

  const capabilities = new CapabilityRegistry()

  const dispatched: { session: string; text: string }[] = []
  const dispatcher: PromptDispatcher = {
    dispatch: vi.fn(async (session: string, text: string) => {
      if (options.dispatchFails === true) throw new Error('host unreachable')
      dispatched.push({ session, text })
    }),
  }
  const agents: AgentRegistryLike = {
    create: vi.fn(async (opts: { sessionId: string }) => ({ session: { id: opts.sessionId } })),
    get: () => ({}),
  } as AgentRegistryLike

  const coordinator = new PetCoordinator({
    repository: created.repository,
    capabilities,
    agents,
    dispatcher,
    resolver,
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  })
  return { coordinator, harness: created, dispatched, capabilities }
}

function capture(overrides: Partial<PetInvocationCapture> = {}): PetInvocationCapture {
  return {
    clientInvocationId: `inv-${Math.random().toString(36).slice(2, 10)}`,
    capabilityId: 'create-mr',
    sourceKind: 'session',
    sourceSessionId: 'src-1',
    ...overrides,
  }
}

describe('create-or-reuse Task', () => {
  it('creates one Task and executor for the first Invocation', async () => {
    const f = await fixture()
    harness = f.harness

    const result = await f.coordinator.accept(capture())

    expect(result.started).toBe(true)
    expect(result.task.scopeKey).toBe('session:src-1')
    expect(f.dispatched).toHaveLength(1)
  })

  it('reuses one Task and executor across several capabilities', async () => {
    const f = await fixture()
    harness = f.harness

    const first = await f.coordinator.accept(capture({ capabilityId: 'create-mr' }))
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))

    expect(second.task.id).toBe(first.task.id)
    expect(second.task.executorSessionId).toBe(first.task.executorSessionId)
    expect(f.harness.repository.listInvocations(first.task.id)).toHaveLength(2)
  })

  it('keeps different sources on separate Tasks', async () => {
    const f = await fixture()
    harness = f.harness

    const a = await f.coordinator.accept(capture({ sourceSessionId: 'src-1' }))
    const b = await f.coordinator.accept(capture({ sourceSessionId: 'src-2' }))

    expect(b.task.id).not.toBe(a.task.id)
    expect(b.task.executorSessionId).not.toBe(a.task.executorSessionId)
  })

  it('creates a new epoch instead of reactivating an archived Task', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })
    await f.harness.repository.archiveTask(first.task.id)

    const second = await f.coordinator.accept(capture())

    expect(second.task.id).not.toBe(first.task.id)
    expect(second.task.epoch).toBe(first.task.epoch + 1)
    // The old Task remains read-only history.
    expect(f.harness.repository.getTask(first.task.id)?.archivedAt).toBeTypeOf('number')
  })

  it('is idempotent for a repeated client invocation id', async () => {
    const f = await fixture()
    harness = f.harness
    const request = capture()

    const first = await f.coordinator.accept(request)
    const second = await f.coordinator.accept(request)

    expect(second.invocation.id).toBe(first.invocation.id)
    expect(f.harness.repository.listInvocations(first.task.id)).toHaveLength(1)
  })

  it('rejects an unknown capability', async () => {
    const f = await fixture()
    harness = f.harness

    await expect(f.coordinator.accept(capture({ capabilityId: 'ghost' }))).rejects.toMatchObject({
      code: 'UNKNOWN_CAPABILITY',
    })
  })

  it('rejects a capability whose Skill is not enabled', async () => {
    const f = await fixture()
    harness = f.harness
    // Never installed: there is no such capability to invoke.

    await expect(
      f.coordinator.accept(capture({ capabilityId: 'clean-worktree' })),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CAPABILITY' })
  })
})

describe('serial queue', () => {
  it('queues a second Invocation behind running work', async () => {
    const f = await fixture()
    harness = f.harness

    const first = await f.coordinator.accept(capture())
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))

    expect(second.started).toBe(false)
    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).toBe('queued')
    // The first Invocation remains the single current one.
    expect(f.harness.repository.findCurrentInvocation(first.task.id)?.id).toBe(first.invocation.id)
    expect(f.dispatched).toHaveLength(1)
  })

  it('does not let queued work preempt a waiting-user Invocation', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'waiting-user' })

    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))

    expect(second.started).toBe(false)
    expect(f.harness.repository.findCurrentInvocation(first.task.id)?.id).toBe(first.invocation.id)
  })

  it('starts the next Invocation only after terminal settlement', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))

    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })

    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).toBe('running')
    expect(f.harness.repository.findCurrentInvocation(first.task.id)?.id).toBe(second.invocation.id)
    expect(f.dispatched).toHaveLength(2)
  })

  it('routes an answer to the current Invocation, not the queue', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'waiting-user' })

    await f.coordinator.answer(first.task.id, 'use main branch')

    expect(f.dispatched.at(-1)?.text).toBe('use main branch')
    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).toBe('queued')
    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('running')
  })

  it('advances the queue after cancellation', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))

    await f.coordinator.cancel(first.task.id)

    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('cancelled')
    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).toBe('running')
  })
})

describe('state projection from Agent events', () => {
  it('projects success with a result summary', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())

    await f.coordinator.onAgentEvent(first.task.executorSessionId, {
      kind: 'turn-complete',
      summary: 'MR !42 created',
    })

    const settled = f.harness.repository.getInvocation(first.invocation.id)
    expect(settled?.status).toBe('succeeded')
    expect(settled?.resultSummary).toBe('MR !42 created')
    expect(f.harness.repository.getTask(first.task.id)?.status).toBe('idle')
  })

  it('projects a failure with a bounded error summary', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())

    await f.coordinator.onAgentEvent(first.task.executorSessionId, {
      kind: 'turn-error',
      message: 'target branch missing',
    })

    expect(f.harness.repository.getInvocation(first.invocation.id)?.errorSummary).toBe(
      'target branch missing',
    )
  })

  it('records a settled run per attempt', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-error', message: 'x' })

    const runs = f.harness.repository.listRuns(first.invocation.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('failed')
    expect(runs[0]?.settledAt).toBeTypeOf('number')
  })

  it('ignores events from sessions that are not Pet executors', async () => {
    const f = await fixture()
    harness = f.harness
    await f.coordinator.accept(capture())

    await expect(
      f.coordinator.onAgentEvent('some-ordinary-session', { kind: 'turn-complete' }),
    ).resolves.toBeUndefined()
  })

  it('marks recovering rather than failed when dispatch outcome is uncertain', async () => {
    const f = await fixture({ dispatchFails: true })
    harness = f.harness

    const result = await f.coordinator.accept(capture())

    // Never report uncertain work as a definite failure.
    expect(f.harness.repository.getInvocation(result.invocation.id)?.status).toBe('recovering')
    expect(f.harness.repository.getTask(result.task.id)?.status).toBe('recovering')
  })
})

describe('retry semantics', () => {
  it('retries a failed Invocation on the same snapshot', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    const originalSnapshot = first.invocation.snapshotId
    await f.coordinator.onAgentEvent(first.task.executorSessionId, {
      kind: 'turn-error',
      message: 'transient',
    })

    const retried = await f.coordinator.retry(first.invocation.id)

    // Same Invocation, same snapshot, a second run.
    expect(retried.id).toBe(first.invocation.id)
    expect(retried.snapshotId).toBe(originalSnapshot)
    expect(f.harness.repository.listRuns(first.invocation.id)).toHaveLength(2)
    expect(retried.errorSummary).toBeUndefined()
  })

  it('creates a NEW Invocation and snapshot for a fresh user gesture', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })

    const second = await f.coordinator.accept(capture())

    expect(second.invocation.id).not.toBe(first.invocation.id)
    expect(second.invocation.snapshotId).not.toBe(first.invocation.snapshotId)
  })

  it('refuses to retry a non-failed Invocation', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())

    await expect(f.coordinator.retry(first.invocation.id)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    })
  })
})

describe('envelope rendering', () => {
  it('leads with the skill token and defers authority to pet_context', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask(testTask())
    await harness.repository.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      sessionTitle: 'Fix login',
      cwd: '/repo',
      asOfSeq: 12,
      capturedAt: 1_700_000_000_000,
    })
    const invocation = await harness.repository.appendInvocation(testInvocation())

    const text = renderEnvelope({
      task,
      invocation,
      snapshot: harness.repository.getSnapshot('snap-1')!,
      isFirst: true,
    })

    expect(text.startsWith('/create-mr')).toBe(true)
    expect(text).toContain('task-1')
    expect(text).toContain('inv-1')
    expect(text).toContain('Fix login')
    expect(text).toContain('seq 12')
    expect(text).toContain('pet_context')
    expect(text).toContain('display only and carry no authority')
    expect(text).toContain('does not end the Task')
  })

  it('labels an independent task without fabricating a source', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask(
      testTask({ scopeKey: 'independent:web:default', sourceKind: 'none', sourceId: undefined }),
    )
    await harness.repository.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'none',
      capturedAt: 1,
    })
    const invocation = await harness.repository.appendInvocation(testInvocation())

    const text = renderEnvelope({
      task,
      invocation,
      snapshot: harness.repository.getSnapshot('snap-1')!,
      isFirst: true,
    })

    expect(text).toContain('independent task')
    expect(text).not.toContain('Repository root')
  })

  it('marks a subsequent Invocation with its own snapshot anchor', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask(testTask())
    await harness.repository.putSnapshot({
      id: 'snap-2',
      invocationId: 'inv-2',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      capturedAt: 2,
    })
    const invocation = await harness.repository.appendInvocation(
      testInvocation({ id: 'inv-2', snapshotId: 'snap-2', skillName: 'send-cr' }),
    )

    const text = renderEnvelope({
      task,
      invocation,
      snapshot: harness.repository.getSnapshot('snap-2')!,
      isFirst: false,
    })

    expect(text.startsWith('/send-cr')).toBe(true)
    expect(text).toContain('Next Pet Invocation')
    expect(text).toContain('snap-2')
  })
})

describe('capability projection', () => {
  it('lets an optional Host probe annotate a Skill-derived entry', async () => {
    const f = await fixture()
    harness = f.harness

    // A probe may only ANNOTATE an entry that a Skill already created; it can
    // never invent a capability of its own. Missing organization tooling is
    // normally the Skill's own concern, but a Host peer that can genuinely
    // prove absence may still disable the entry.
    f.capabilities.register({
      id: 'send-cr',
      label: 'Send CR',
      description: 'Send a review request',
      skillName: 'send-cr',
      contextRequirement: 'session-required',
      probe: () => 'lark-cli is not installed',
    })
    const projection = f.capabilities.project(f.harness.repository)

    expect(projection.find(item => item.id === 'send-cr')?.available).toBe(false)
    expect(projection.find(item => item.id === 'send-cr')?.diagnostic).toContain('lark-cli')
    expect(projection.find(item => item.id === 'create-mr')?.available).toBe(true)
  })

  it('ignores a Host declaration with no installed Skill behind it', async () => {
    const f = await fixture()
    harness = f.harness

    f.capabilities.register({
      id: 'ghost',
      label: 'Ghost',
      description: 'No Skill installed',
      skillName: 'ghost',
      contextRequirement: 'none',
    })

    // Pet-side code cannot conjure a capability; only an install can.
    expect(f.capabilities.project(f.harness.repository).find(i => i.id === 'ghost')).toBeUndefined()
  })

  it('drops a capability whose Skill is disabled', async () => {
    const f = await fixture()
    harness = f.harness
    await installTestSkill(harness!, 'clean-worktree', { context: 'session-required' })

    // Disabling removes the enabled digest, so the Skill stops being a
    // capability at all rather than lingering as an unavailable entry.
    await f.harness.repository.putSkillSelection({
      skillName: 'clean-worktree',
      showAsShortcut: true,
    })
    const projection = f.capabilities.project(f.harness.repository)

    expect(projection.find(item => item.id === 'clean-worktree')).toBeUndefined()
  })
})

describe('explicit injection boundary at dispatch', () => {
  it('fails the Invocation instead of dispatching an unresolvable revision', async () => {
    const f = await fixture()
    harness = f.harness
    const coordinator = new PetCoordinator({
      repository: f.harness.repository,
      capabilities: f.capabilities,
      agents: {
        create: vi.fn(async (o: { sessionId: string }) => ({ session: { id: o.sessionId } })),
        get: () => ({}),
      } as never,
      dispatcher: { dispatch: vi.fn(async () => {}) },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: '/tmp/pet-workspace',
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      verifySkill: async () => {
        throw new PetError('SKILL_DIGEST_MISMATCH', 'revision no longer matches its digest')
      },
    })

    const result = await coordinator.accept(capture())

    // Fail closed: never send a `/<name>` envelope for a Skill the Agent
    // cannot legitimately load.
    expect(result.started).toBe(false)
    const stored = f.harness.repository.getInvocation(result.invocation.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.errorSummary).toContain('no longer matches its digest')
    expect(f.dispatched).toEqual([])
  })

  it('leaves the Task idle so later work can still run', async () => {
    const f = await fixture()
    harness = f.harness
    let fail = true
    const coordinator = new PetCoordinator({
      repository: f.harness.repository,
      capabilities: f.capabilities,
      agents: {
        create: vi.fn(async (o: { sessionId: string }) => ({ session: { id: o.sessionId } })),
        get: () => ({}),
      } as never,
      dispatcher: { dispatch: vi.fn(async () => {}) },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: '/tmp/pet-workspace',
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      verifySkill: async () => {
        if (fail) throw new PetError('SKILL_DISABLED', 'Pet Skill create-mr is not enabled')
      },
    })

    const blocked = await coordinator.accept(capture())
    expect(blocked.started).toBe(false)
    expect(f.harness.repository.getTask(blocked.task.id)?.status).toBe('idle')

    // Re-enabling lets the next Invocation proceed on the same Task.
    fail = false
    const ok = await coordinator.accept(capture({ capabilityId: 'send-cr' }))
    expect(ok.started).toBe(true)
  })

  it('dispatches normally when the Skill resolves', async () => {
    const f = await fixture()
    harness = f.harness
    const verifySkill = vi.fn(async () => {})
    const coordinator = new PetCoordinator({
      repository: f.harness.repository,
      capabilities: f.capabilities,
      agents: {
        create: vi.fn(async (o: { sessionId: string }) => ({ session: { id: o.sessionId } })),
        get: () => ({}),
      } as never,
      dispatcher: { dispatch: vi.fn(async () => {}) },
      resolver,
      contextProviders: new SourceContextRegistry(),
      workspacePath: '/tmp/pet-workspace',
      selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
      verifySkill,
    })

    const result = await coordinator.accept(capture())

    expect(result.started).toBe(true)
    // Verified against the Skill the Invocation named.
    expect(verifySkill).toHaveBeenCalledWith('create-mr')
  })
})

describe('shortcut visibility controls the radial menu only', () => {
  it('projects showAsShortcut from the persisted selection', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putSkillSelection({
      skillName: 'send-cr',
      enabled: true,
      showAsShortcut: false,
    })

    const projection = f.capabilities.project(f.harness.repository)
    const hidden = projection.find(item => item.id === 'send-cr')
    const shown = projection.find(item => item.id === 'create-mr')

    expect(hidden?.showAsShortcut).toBe(false)
    expect(shown?.showAsShortcut).toBe(true)
    // Hiding is presentation only: the capability stays available.
    expect(hidden?.available).toBe(true)
  })

  it('keeps a hidden capability invocable', async () => {
    const f = await fixture()
    harness = f.harness
    await f.harness.repository.putSkillSelection({
      skillName: 'send-cr',
      enabled: true,
      showAsShortcut: false,
    })

    // Visibility must never act as an authorization boundary.
    const result = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))
    expect(result.started).toBe(true)
  })

  it('defaults a freshly installed Skill to visible and available', async () => {
    const f = await fixture()
    harness = f.harness
    await installTestSkill(harness!, 'clean-worktree', { context: 'session-required' })

    const entry = f.capabilities
      .project(f.harness.repository)
      .find(item => item.id === 'clean-worktree')

    // An installed, enabled Skill needs no Pet-side code to become usable.
    expect(entry?.showAsShortcut).toBe(true)
    expect(entry?.available).toBe(true)
    expect(entry?.contextRequirement).toBe('session-required')
  })
})

describe('answering the current Invocation', () => {
  it('continues the current Invocation without starting queued work', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'waiting-user' })

    await f.coordinator.answer(first.task.id, 'use the main branch')

    // The answer is delivered to the executor session of the CURRENT work.
    expect(f.dispatched.at(-1)).toEqual({
      session: first.task.executorSessionId,
      text: 'use the main branch',
    })
    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('running')
    // Queued work must not be preempted by an answer.
    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).toBe('queued')
  })

  it('refuses an answer when nothing is waiting', async () => {
    const f = await fixture()
    harness = f.harness
    const accepted = await f.coordinator.accept(capture())

    await expect(f.coordinator.answer(accepted.task.id, 'hello')).rejects.toMatchObject({
      code: 'NO_CURRENT_INVOCATION',
    })
  })

  it('refuses an answer for an unknown Task', async () => {
    const f = await fixture()
    harness = f.harness

    await expect(f.coordinator.answer('task-ghost', 'hello')).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
    })
  })
})

describe('approval events project waiting-user', () => {
  it('marks the Invocation waiting-user when an approval is asked', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())

    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'waiting-user' })

    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('waiting-user')
    expect(f.harness.repository.getTask(first.task.id)?.status).toBe('waiting-user')
  })

  it('resumes running once the approval is decided', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'waiting-user' })

    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-start' })

    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('running')
  })

  it('does not start queued work while an approval is pending', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    const second = await f.coordinator.accept(capture({ capabilityId: 'send-cr' }))
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'waiting-user' })

    // Waiting on a human still occupies the serial slot.
    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).toBe('queued')
    expect(f.harness.repository.findCurrentInvocation(first.task.id)?.id).toBe(
      first.invocation.id,
    )
  })

  it('ignores a late decision after the Invocation already settled', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-complete' })

    // A trailing approval/decided must not resurrect settled work.
    await f.coordinator.onAgentEvent(first.task.executorSessionId, { kind: 'turn-start' })

    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('succeeded')
  })
})

describe('dispatch tolerates a lost slot race', () => {
  it('does not throw out of retry when the Invocation settles mid-dispatch', async () => {
    const f = await fixture()
    harness = f.harness
    const accepted = await f.coordinator.accept(capture())
    await f.coordinator.onAgentEvent(accepted.task.executorSessionId, {
      kind: 'turn-error',
      message: 'transient',
    })

    // Simulate the live race: the moment dispatch re-queues the Invocation,
    // an event observer settles it before the slot claim lands.
    const repo = f.harness.repository
    const original = repo.setInvocationStatus.bind(repo)
    let raced = false
    repo.setInvocationStatus = async (id, status) => {
      if (status === 'dispatching' && !raced) {
        raced = true
        await original(id, 'failed')
      }
      return original(id, status)
    }

    // Retry must still resolve; losing the race is not the caller's error.
    await expect(f.coordinator.retry(accepted.invocation.id)).resolves.toBeDefined()
  })

  it('reuses the same snapshot and records another run on retry', async () => {
    const f = await fixture()
    harness = f.harness
    const accepted = await f.coordinator.accept(capture())
    const snapshotId = accepted.invocation.snapshotId
    await f.coordinator.onAgentEvent(accepted.task.executorSessionId, {
      kind: 'turn-error',
      message: 'transient',
    })

    const retried = await f.coordinator.retry(accepted.invocation.id)

    // A transient retry never re-targets: same Invocation, same snapshot.
    expect(retried.id).toBe(accepted.invocation.id)
    expect(retried.snapshotId).toBe(snapshotId)
    expect(f.harness.repository.listInvocations(accepted.task.id)).toHaveLength(1)
    expect(f.harness.repository.listRuns(accepted.invocation.id)).toHaveLength(2)
  })
})

describe('concurrent invocations keep the domain invariants', () => {
  it('creates one Task with unique sequential queue positions', async () => {
    const f = await fixture()
    harness = f.harness

    // Five racing requests for the same source.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        f.coordinator.accept(capture({ clientInvocationId: `c${index}` })),
      ),
    )

    const taskIds = new Set(results.map(r => r.task.id))
    expect(taskIds.size).toBe(1)

    const invocations = f.harness.repository.listInvocations([...taskIds][0]!)
    expect(invocations).toHaveLength(5)
    // Positions must be unique and contiguous, or work would be lost or
    // dispatched twice.
    expect(invocations.map(i => i.queuePosition)).toEqual([0, 1, 2, 3, 4])
  })

  it('never runs two Invocations of one Task at once', async () => {
    const f = await fixture()
    harness = f.harness
    await Promise.all(
      Array.from({ length: 4 }, (_unused, index) =>
        f.coordinator.accept(capture({ clientInvocationId: `p${index}` })),
      ),
    )

    const task = f.harness.repository.listTasks()[0]!
    const active = f.harness.repository
      .listInvocations(task.id)
      .filter(i => i.status === 'running' || i.status === 'dispatching' || i.status === 'waiting-user')

    expect(active.length).toBeLessThanOrEqual(1)
  })

  it('keeps one unarchived Task per scope and one executor per Task', async () => {
    const f = await fixture()
    harness = f.harness
    await Promise.all([
      f.coordinator.accept(capture({ clientInvocationId: 'a1' })),
      f.coordinator.accept(capture({ clientInvocationId: 'a2', sourceSessionId: 'src-2' })),
      f.coordinator.accept(capture({ clientInvocationId: 'a3' })),
    ])

    const tasks = f.harness.repository.listTasks()
    const liveByScope = new Map<string, number>()
    const byExecutor = new Map<string, number>()
    for (const task of tasks) {
      if (task.archivedAt === undefined) {
        liveByScope.set(task.scopeKey, (liveByScope.get(task.scopeKey) ?? 0) + 1)
      }
      byExecutor.set(task.executorSessionId, (byExecutor.get(task.executorSessionId) ?? 0) + 1)
    }

    expect([...liveByScope.values()].every(count => count === 1)).toBe(true)
    expect([...byExecutor.values()].every(count => count === 1)).toBe(true)
  })
})
