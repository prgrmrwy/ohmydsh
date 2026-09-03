/**
 * Pet's `DSH_PET_*` contribution to the shell environment.
 *
 * These tests drive the contributor the way the real registry does: they call
 * `resolve(execution)` and then check the returned keys against the
 * contributor's own `variables` declaration, because DSH's registry THROWS on
 * an undeclared key and that throw would abort the user's shell call.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { openPetHarness, testTask, type PetHarness } from './harness.js'
import { createPetEnvContributor, PET_ENV_PREFIX } from '../src/host/shell-env.js'
import { renderEnvelope } from '../src/host/envelope.js'
import { PET_ENV_GLOBAL_SCOPE } from '../src/host/spec.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/** An execution as the agent loop presents it. */
function execution(sessionId: string | undefined): {
  agent?: { session: { header: { id: string } } }
} {
  return sessionId === undefined ? {} : { agent: { session: { header: { id: sessionId } } } }
}

/**
 * Seed a Task whose current Invocation points at `workspaceId`.
 * @returns the executor session id to resolve from.
 */
async function seedTask(
  h: PetHarness,
  options: { workspaceId?: string } = {},
): Promise<string> {
  const executorSessionId = 'exec-1'
  await h.repository.createTask(
    testTask({ id: 'task-1', executorSessionId, status: 'idle' }),
  )
  await h.repository.putSnapshot({
    id: 'snap-1',
    invocationId: 'inv-1',
    sourceKind: options.workspaceId === undefined ? 'none' : 'workspace',
    ...(options.workspaceId === undefined ? {} : { sourceWorkspaceId: options.workspaceId }),
    capturedAt: 1,
  })
  await h.repository.appendInvocation({
    id: 'inv-1',
    taskId: 'task-1',
    capabilityId: 'send-cr',
    skillName: 'send-cr',
    skillSourcePath: '/tmp/send-cr',
    skillSetGeneration: 1,
    snapshotId: 'snap-1',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
  })
  return executorSessionId
}

async function put(h: PetHarness, scope: string, key: string, value: string): Promise<void> {
  await h.repository.putEnvEntry({ scope, key, value, updatedAt: 1 })
}

describe('injection resolves from the calling executor session', () => {
  it('injects the workspace value, overriding a same-named global one', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default')
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_project_a')

    const contributor = createPetEnvContributor(harness.repository)
    const values = contributor.resolve(execution(sessionId))

    expect(values).toEqual({ [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_project_a' })
  })

  it('falls back to the global value', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default')

    const contributor = createPetEnvContributor(harness.repository)

    expect(contributor.resolve(execution(sessionId))).toEqual({
      [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_default',
    })
  })

  it('gives an independent Task the global set only', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness)
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default')
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_project_a')

    const contributor = createPetEnvContributor(harness.repository)

    // No workspace on the snapshot: it must never inherit some other
    // workspace's value.
    expect(contributor.resolve(execution(sessionId))).toEqual({
      [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_default',
    })
  })

  it('omits a variable neither scope configures', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })

    const contributor = createPetEnvContributor(harness.repository)

    // Absent rather than empty-valued: the Skill is expected to notice and
    // stop, and Pet invents no default.
    expect(contributor.resolve(execution(sessionId))).toEqual({})
  })
})

describe('non-Pet callers contribute nothing', () => {
  it('returns empty for a session with no Pet Task', async () => {
    harness = await openPetHarness()
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default')

    const contributor = createPetEnvContributor(harness.repository)

    // This runs for EVERY shell call in the Host. Throwing here would break
    // ordinary sessions that have nothing to do with Pet.
    expect(contributor.resolve(execution('some-other-session'))).toEqual({})
  })

  it('returns empty when there is no agent at all', async () => {
    harness = await openPetHarness()
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default')

    const contributor = createPetEnvContributor(harness.repository)

    expect(contributor.resolve(execution(undefined))).toEqual({})
  })

  it('returns empty when the Task has no current Invocation', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(
      testTask({ id: 'task-1', executorSessionId: 'exec-1', status: 'idle' }),
    )
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default')

    const contributor = createPetEnvContributor(harness.repository)

    expect(contributor.resolve(execution('exec-1'))).toEqual({})
  })
})

describe('every returned key is declared', () => {
  it('declares each key it returns, so the registry cannot reject the call', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })
    await put(harness, PET_ENV_GLOBAL_SCOPE, 'NOTIFY_CHANNEL', 'oc_notify')
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_project_a')

    const contributor = createPetEnvContributor(harness.repository)
    const values = contributor.resolve(execution(sessionId))

    // This mirrors the registry's own check: an undeclared key makes it throw
    // and the user's shell call fails.
    for (const key of Object.keys(values)) {
      expect(Object.hasOwn(contributor.variables, key)).toBe(true)
      expect(contributor.variables[key]?.description ?? '').not.toBe('')
    }
    expect(Object.keys(values).sort()).toEqual([
      `${PET_ENV_PREFIX}CR_GROUP`,
      `${PET_ENV_PREFIX}NOTIFY_CHANNEL`,
    ])
  })

  it('stops advertising a key the user removed', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_project_a')

    const contributor = createPetEnvContributor(harness.repository)
    contributor.resolve(execution(sessionId))
    expect(Object.keys(contributor.variables)).toEqual([`${PET_ENV_PREFIX}CR_GROUP`])

    await harness.repository.deleteEnvEntry('ws-a', 'CR_GROUP')
    const after = contributor.resolve(execution(sessionId))

    // The declaration is rebuilt each time, so a deleted key leaves no phantom
    // entry behind in `list()`.
    expect(after).toEqual({})
    expect(Object.keys(contributor.variables)).toEqual([])
  })

  it('picks up a key added after registration', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })

    const contributor = createPetEnvContributor(harness.repository)
    expect(contributor.resolve(execution(sessionId))).toEqual({})

    // Configuration changes at runtime; a fixed declaration made at
    // registration time could never serve this.
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_late')
    const after = contributor.resolve(execution(sessionId))

    expect(after).toEqual({ [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_late' })
    expect(Object.hasOwn(contributor.variables, `${PET_ENV_PREFIX}CR_GROUP`)).toBe(true)
  })
})

describe('values never enter model-visible text', () => {
  it('keeps the configured value out of the dispatched envelope', async () => {
    harness = await openPetHarness()
    const sessionId = await seedTask(harness, { workspaceId: 'ws-a' })
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_secret_group')

    const contributor = createPetEnvContributor(harness.repository)
    expect(contributor.resolve(execution(sessionId))).toEqual({
      [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_secret_group',
    })

    // The envelope is the only text Pet dispatches into the executor session.
    // The value rides the separate `dshEnv` channel to the child process, so
    // it must appear nowhere in that text.
    const task = harness.repository.getTask('task-1')!
    const invocation = harness.repository.getInvocation('inv-1')!
    const snapshot = harness.repository.getSnapshot('snap-1')!
    const text = renderEnvelope({ task, invocation, snapshot, isFirst: true })

    expect(text).not.toContain('oc_secret_group')
    expect(text).not.toContain('CR_GROUP')
  })
})

describe('concurrent Tasks stay isolated', () => {
  it('never leaks one workspace value into another workspace call', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(
      testTask({ id: 'task-a', scopeKey: 'workspace:ws-a', executorSessionId: 'exec-a' }),
    )
    await harness.repository.createTask(
      testTask({ id: 'task-b', scopeKey: 'workspace:ws-b', executorSessionId: 'exec-b' }),
    )
    for (const [task, ws] of [
      ['task-a', 'ws-a'],
      ['task-b', 'ws-b'],
    ] as const) {
      await harness.repository.putSnapshot({
        id: `snap-${ws}`,
        invocationId: `inv-${ws}`,
        sourceKind: 'workspace',
        sourceWorkspaceId: ws,
        capturedAt: 1,
      })
      await harness.repository.appendInvocation({
        id: `inv-${ws}`,
        taskId: task,
        capabilityId: 'send-cr',
        skillName: 'send-cr',
        skillSourcePath: '/tmp/send-cr',
        skillSetGeneration: 1,
        snapshotId: `snap-${ws}`,
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
        revision: 0,
      })
    }
    await put(harness, 'ws-a', 'CR_GROUP', 'oc_a')
    await put(harness, 'ws-b', 'CR_GROUP', 'oc_b')

    const contributor = createPetEnvContributor(harness.repository)

    expect(contributor.resolve(execution('exec-a'))).toEqual({
      [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_a',
    })
    expect(contributor.resolve(execution('exec-b'))).toEqual({
      [`${PET_ENV_PREFIX}CR_GROUP`]: 'oc_b',
    })
  })
})

describe('registration must not be wrapped in an extra effect', () => {
  it('calls register directly, so it cannot run twice', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const entry = await readFile(
      path.resolve(__dirname, '..', 'src', 'index.ts'),
      'utf8',
    )

    // `register` already runs inside its own effect. Wrapping it in another
    // `ctx.effect` lets it run a second time, and the duplicate throws
    // `contributor "..." is already registered` — which aborted the rest of
    // Pet's initialization and left executors with no `bash`, `read` or
    // `write`, only the handful of tools other plugins contributed.
    const wrapped = /ctx\.effect\(\s*\(\)\s*=>\s*shellEnv\.register/.test(entry)
    expect(wrapped).toBe(false)
    expect(entry).toContain('shellEnv.register(createPetEnvContributor(repository)')
  })

  it('contains a registration failure instead of degrading the executor', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const entry = await readFile(
      path.resolve(__dirname, '..', 'src', 'index.ts'),
      'utf8',
    )

    // Optional convenience must never cost Pet its Agent tools.
    const guarded = /try\s*\{[\s\S]{0,200}shellEnv\.register[\s\S]{0,400}catch/.test(entry)
    expect(guarded).toBe(true)
  })
})
