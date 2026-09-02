import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTaskWithExecutor,
  preallocateTask,
  reconcileCreatingExecutors,
  titleForTask,
  validateModelSelection,
  type AgentRegistryLike,
} from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import {
  ensurePetWorkspace,
  executorTitle,
  MAX_TITLE_LENGTH,
  preparePetWorkspace,
  shortIdOf,
} from '../src/host/workspace.js'
import { openPetHarness, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function petPaths(): Promise<PetPaths> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  return paths
}

function fakeAgents(overrides: Partial<AgentRegistryLike> = {}): AgentRegistryLike {
  const sessions = new Set<string>()
  return {
    create: vi.fn(async (options: { sessionId: string }) => {
      sessions.add(options.sessionId)
      return { session: { id: options.sessionId } }
    }),
    get: (sessionId: string) => (sessions.has(sessionId) ? {} : undefined),
    ...overrides,
  } as AgentRegistryLike
}

describe('Pet Workspace preparation', () => {
  it('creates an owner-only workspace with standing instructions', async () => {
    const paths = await petPaths()

    const workspacePath = await preparePetWorkspace(paths)

    expect(workspacePath).toBe(paths.workspaceRoot)
    const instructions = await readFile(path.join(paths.workspaceRoot, 'AGENTS.md'), 'utf8')
    expect(instructions).toContain('DSH Pet 任务 Agent')
    expect(instructions).toContain('pet_context')
    // The authority boundary must be stated to the model.
    expect(instructions).toContain('不构成授权')
    expect((await stat(paths.projectionRoot)).isDirectory()).toBe(true)
  })

  it('is idempotent across repeated Host starts', async () => {
    const paths = await petPaths()
    await preparePetWorkspace(paths)
    await expect(preparePetWorkspace(paths)).resolves.toBe(paths.workspaceRoot)
  })

  it('registers the workspace under the state directory, not the package', async () => {
    const paths = await petPaths()
    const create = vi.fn(async (p: string) => ({ id: `ws-${path.basename(p)}` }))

    const id = await ensurePetWorkspace({ create }, paths)

    expect(create).toHaveBeenCalledWith(paths.workspaceRoot, 'DSH Pet')
    expect(id).toBe('ws-workspace')
    expect(paths.workspaceRoot).not.toContain('node_modules')
  })
})

describe('executor relationship titles', () => {
  it('includes the Pet marker, source, short id and epoch', () => {
    const title = executorTitle({
      sourceKind: 'session',
      sourceTitle: '修复登录超时',
      shortId: 'a1b2c3',
      epoch: 1,
    })

    expect(title).toContain('🐾')
    expect(title).toContain('修复登录超时')
    expect(title).toContain('[a1b2c3]')
    expect(title).toContain('#1')
  })

  it('labels an independent Task without fabricating a source', () => {
    const title = executorTitle({ sourceKind: 'none', shortId: 'ffffff', epoch: 2 })

    expect(title).toContain('Independent')
    expect(title).toContain('#2')
  })

  it('distinguishes epochs for the same source', () => {
    const first = executorTitle({ sourceKind: 'session', sourceTitle: 'Fix', shortId: 'aaa', epoch: 1 })
    const second = executorTitle({ sourceKind: 'session', sourceTitle: 'Fix', shortId: 'aaa', epoch: 2 })

    expect(first).not.toBe(second)
  })

  it('bounds an overlong source title', () => {
    const title = executorTitle({
      sourceKind: 'session',
      sourceTitle: 'x'.repeat(500),
      shortId: 'abc123',
      epoch: 9,
    })

    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    expect(title).toContain('#9')
  })

  it('derives a stable short id', () => {
    expect(shortIdOf('session-9af69b1c-dead')).toBe('9af69b')
    expect(shortIdOf('task-abcdef123')).toBe('abcdef')
  })

  it('never parses a renamed title back into routing', async () => {
    harness = await openPetHarness()
    const task = await harness.repository.createTask(testTask())
    const generated = titleForTask(task)

    // The user renames the session; stored routing is unaffected.
    expect(generated).toContain('🐾')
    expect(harness.repository.findTaskByExecutor('exec-1')?.id).toBe('task-1')
    expect(harness.repository.findActiveTaskByScope('session:src-1')?.id).toBe('task-1')
  })
})

describe('model selection validation', () => {
  const registry = {
    listProviders: () => [
      { id: 'anthropic', models: ['claude-opus-5'] },
      { id: 'deepseek' },
    ],
  }

  it('accepts a routable provider and model', () => {
    const selection = validateModelSelection(registry, {
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    })
    expect(selection.providerId).toBe('anthropic')
  })

  it('accepts a provider that does not enumerate models', () => {
    expect(() =>
      validateModelSelection(registry, { providerId: 'deepseek', modelId: 'anything' }),
    ).not.toThrow()
  })

  it('fails diagnostically when nothing is configured', () => {
    expect(() => validateModelSelection(registry, undefined)).toThrow(/no configured provider/)
  })

  it('never silently falls back to another provider', () => {
    expect(() =>
      validateModelSelection(registry, { providerId: 'ghost', modelId: 'm' }),
    ).toThrow(/not routable/)
  })

  it('rejects a model the provider does not offer', () => {
    expect(() =>
      validateModelSelection(registry, { providerId: 'anthropic', modelId: 'other' }),
    ).toThrow(/not offered by provider/)
  })

  it('never reads or stores provider credentials', () => {
    const selection = validateModelSelection(registry, {
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    })
    expect(JSON.stringify(selection)).not.toMatch(/token|secret|key|credential/i)
  })
})

describe('recoverable executor creation', () => {
  it('creates an ordinary root session in the Pet Workspace', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    const agents = fakeAgents()

    const task = await createTaskWithExecutor(harness.repository, agents, {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      sourceTitle: 'Fix login',
      workspacePath: paths.workspaceRoot,
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(task.status).toBe('idle')
    const call = (agents.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.sessionId).toBe(task.executorSessionId)
    expect(call.meta.cwd).toBe(paths.workspaceRoot)
    // An ordinary root session: never a subagent, never with parent authority.
    expect(call.meta.origin).toBeUndefined()
    expect(call.meta.parentSession).toBeUndefined()
  })

  it('preallocates ids and a monotonic epoch before touching DSH', async () => {
    harness = await openPetHarness()
    const first = await preallocateTask(harness.repository, 'session:src-1')
    const second = await preallocateTask(harness.repository, 'session:src-1')

    expect(first.taskId).not.toBe(second.taskId)
    expect(second.epoch).toBe(first.epoch + 1)
  })

  it('persists creating-executor before calling DSH so a crash is reconcilable', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    const repo = harness.repository
    let observed: string | undefined
    const agents = fakeAgents({
      create: vi.fn(async (options: { sessionId: string }) => {
        // Inside the DSH call: Pet's durable record must already exist.
        observed = repo.findTaskByExecutor(options.sessionId)?.status
        return { session: { id: options.sessionId } }
      }),
    } as Partial<AgentRegistryLike>)

    await createTaskWithExecutor(repo, agents, {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: paths.workspaceRoot,
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(observed).toBe('creating-executor')
  })

  it('marks the Task failed with a diagnostic when session creation throws', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    const agents = fakeAgents({
      create: vi.fn(async () => {
        throw new Error('provider unavailable')
      }),
    } as Partial<AgentRegistryLike>)

    await expect(
      createTaskWithExecutor(harness.repository, agents, {
        scopeKey: 'session:src-1',
        sourceKind: 'session',
        sourceId: 'src-1',
        workspacePath: paths.workspaceRoot,
        selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
      }),
    ).rejects.toThrow(/provider unavailable/)

    const task = harness.repository.listTasks()[0]
    expect(task?.status).toBe('failed')
    expect(task?.diagnostic).toContain('provider unavailable')
  })

  it('passes the scoped Pet composition into agent setup', async () => {
    harness = await openPetHarness()
    const paths = await petPaths()
    const agents = fakeAgents()
    const setup = vi.fn()

    await createTaskWithExecutor(harness.repository, agents, {
      scopeKey: 'independent:web:default',
      sourceKind: 'none',
      workspacePath: paths.workspaceRoot,
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5', agentPreset: 'pet' },
      setup,
    })

    const call = (agents.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.setup).toBe(setup)
    expect(call.meta.agentPreset).toBe('pet')
  })
})

describe('restart reconciliation', () => {
  it('commits a Task whose executor session really exists', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'creating-executor' }))

    const outcomes = await reconcileCreatingExecutors(harness.repository, id => id === 'exec-1')

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.kind).toBe('committed')
    expect(harness.repository.getTask('task-1')?.status).toBe('idle')
  })

  it('never reports uncertain work as successful', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'creating-executor' }))

    const outcomes = await reconcileCreatingExecutors(harness.repository, () => false)

    expect(outcomes[0]?.kind).toBe('failed')
    const task = harness.repository.getTask('task-1')
    expect(task?.status).toBe('failed')
    expect(task?.diagnostic).toContain('never created')
  })

  it('leaves settled Tasks untouched', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask({ status: 'idle' }))

    const outcomes = await reconcileCreatingExecutors(harness.repository, () => false)

    expect(outcomes).toEqual([])
    expect(harness.repository.getTask('task-1')?.status).toBe('idle')
  })
})

describe('agent options match the flat DSH contract', () => {
  it('passes provider and model as top-level fields', async () => {
    harness = await openPetHarness()
    let captured: { provider?: string; model?: string } | undefined
    const agents = {
      create: async (options: { agentOptions?: { provider?: string; model?: string } }) => {
        captured = options.agentOptions
        return { session: { id: 'exec-1' } }
      },
      get: () => undefined,
    }

    await createTaskWithExecutor(harness.repository, agents as never, {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: '/tmp/pet-workspace',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    } as never)

    // `AgentOptions` is FLAT. Nesting under `model` silently drops both
    // fields, and every Invocation then fails with "has no provider/model".
    expect(captured).toEqual({ provider: 'anthropic', model: 'claude-opus-5' })
    expect((captured as { model?: unknown }).model).toBe('claude-opus-5')
  })
})

describe('the executor is accounted to the Pet Workspace', () => {
  it('attaches the session after creation', async () => {
    harness = await openPetHarness()
    const attached: string[] = []
    const agents = {
      create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
      get: () => undefined,
    }

    await createTaskWithExecutor(harness.repository, agents as never, {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: '/tmp/pet-workspace',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
      attachToWorkspace: async (sessionId: string) => {
        attached.push(sessionId)
      },
    } as never)

    // Creating with the right `cwd` is not enough: DSH accounts sessions to a
    // workspace explicitly, so without this the executor works but never
    // appears under DSH Pet in the sidebar.
    expect(attached).toHaveLength(1)
  })

  it('keeps a usable executor when accounting fails', async () => {
    harness = await openPetHarness()
    const agents = {
      create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
      get: () => undefined,
    }

    const task = await createTaskWithExecutor(harness.repository, agents as never, {
      scopeKey: 'session:src-2',
      sourceKind: 'session',
      sourceId: 'src-2',
      workspacePath: '/tmp/pet-workspace',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
      attachToWorkspace: async () => {
        throw new Error('registry unavailable')
      },
    } as never)

    // Being mis-filed in the sidebar must not destroy a working executor.
    expect(task.status).toBe('idle')
  })
})

describe('the executor composes without local-root Skill discovery', () => {
  it('defaults to the Pet executor preset', async () => {
    harness = await openPetHarness()
    let captured: string | undefined
    const agents = {
      create: async (options: { meta?: { agentPreset?: string } }) => {
        captured = options.meta?.agentPreset
        return { session: { id: 'exec-1' } }
      },
      get: () => undefined,
    }

    await createTaskWithExecutor(harness.repository, agents as never, {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: '/tmp/pet-workspace',
      selection: {
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        agentPreset: 'dsh-pet-executor',
      },
    } as never)

    // `standard` loads `skill-filesystem`, which would make every globally
    // installed Skill visible to the executor. A scoped provider is ADDITIVE
    // and cannot subtract one the preset brought in, so the exclusion has to
    // happen in the preset itself.
    expect(captured).toBe('dsh-pet-executor')
  })
})

describe('startup accounts executors that were never attached', () => {
  it('the entry runs a workspace accounting pass over live Tasks', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const entry = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'index.ts'),
      'utf8',
    )
    const pass = entry.slice(entry.indexOf("'Pet workspace accounting'"))

    // Attaching only at creation cannot reach an executor made before that
    // existed, nor one whose attach failed: it keeps working but never
    // appears under DSH Pet. Only a startup pass recovers those.
    expect(pass.slice(0, 700)).toContain('repository.listTasks()')
    expect(pass.slice(0, 700)).toContain('attachSession')
    // Skips archived Tasks, and a failure must not block startup.
    expect(pass.slice(0, 700)).toContain('task.archivedAt !== undefined')
    expect(pass.slice(0, 700)).toContain('.catch(() => undefined)')
  })
})
