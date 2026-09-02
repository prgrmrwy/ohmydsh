/**
 * Bounded capability adapters: `create-mr` and `send-cr`.
 *
 * Every case drives a deterministic fake runner, so no real merge request is
 * opened and no real message is sent. The assertions focus on the security
 * boundary: the target and the destination come from trusted context and
 * bindings, never from model-supplied arguments.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult, CommandRunner } from '../src/host/bounded-command.js'
import { createMrDiagnostic, extractMrUrl, runCreateMr } from '../src/host/create-mr.js'
import { renderCrMessage, runSendCr, sendCrDiagnostic } from '../src/host/send-cr.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/** A runner that records argv and answers with a scripted result. */
function fakeRunner(
  result: Partial<CommandResult> = {},
  options: { available?: boolean } = {},
): CommandRunner & { calls: { file: string; args: string[]; cwd?: string }[] } {
  const calls: { file: string; args: string[]; cwd?: string }[] = []
  const runner = vi.fn(async (file: string, args: readonly string[], opts?: { cwd?: string }) => {
    // Availability probes must succeed unless a case disables the tool.
    if (file === 'command' || file === 'which') {
      return { code: options.available === false ? 1 : 0, stdout: '', stderr: '' }
    }
    calls.push({ file, args: [...args], ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}) })
    return { code: 0, stdout: '', stderr: '', ...result }
  })
  return Object.assign(runner as unknown as CommandRunner, { calls })
}

/** Seed a running Invocation with a session snapshot. */
async function seed(
  snapshot: Partial<Parameters<PetHarness['repository']['putSnapshot']>[0]> = {},
): Promise<PetHarness> {
  const created = await openPetHarness()
  await created.repository.createTask(testTask())
  await created.repository.putSnapshot({
    id: 'snap-1',
    invocationId: 'inv-1',
    sourceKind: 'session',
    sourceSessionId: 'src-1',
    sessionTitle: 'Fix login timeout',
    cwd: '/repo',
    capturedAt: 1,
    ...snapshot,
  })
  await created.repository.appendInvocation(testInvocation())
  await created.repository.setInvocationStatus('inv-1', 'running')
  return created
}

describe('create-mr availability', () => {
  it('disables the capability when bytedcli is absent', async () => {
    const diagnostic = await createMrDiagnostic(fakeRunner({}, { available: false }))
    expect(diagnostic).toContain('bytedcli')
    expect(diagnostic).toContain('not installed')
  })

  it('reports available when the CLI resolves', async () => {
    expect(await createMrDiagnostic(fakeRunner())).toBeUndefined()
  })

  it('refuses to run at all when the CLI is missing', async () => {
    harness = await seed()
    await expect(
      runCreateMr({
        repository: harness.repository,
        executorSessionId: 'exec-1',
        request: { title: 'Fix' },
        runner: fakeRunner({}, { available: false }),
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})

describe('create-mr resolves its target from trusted context', () => {
  it('runs in the repository root from the snapshot', async () => {
    harness = await seed()
    const runner = fakeRunner({ stdout: 'https://code.example.com/mr/42' })

    const outcome = await runCreateMr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      request: { title: 'Fix login timeout' },
      runner,
    })

    expect(outcome.status).toBe('created')
    expect(runner.calls[0]?.cwd).toBe('/repo')
    expect(runner.calls[0]?.file).toBe('bytedcli')
    expect(runner.calls[0]?.args.slice(0, 3)).toEqual(['codebase', 'mr', 'create'])
  })

  it('prefers the managed worktree execution root and its branch', async () => {
    harness = await seed({
      worktree: { executionRoot: '/repo/.worktrees/task', branch: 'ws/task' },
    })
    const runner = fakeRunner()

    await runCreateMr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      request: { title: 'Fix' },
      runner,
    })

    // The managed execution root differs from the header cwd by design.
    expect(runner.calls[0]?.cwd).toBe('/repo/.worktrees/task')
    expect(runner.calls[0]?.args).toContain('--head')
    expect(runner.calls[0]?.args).toContain('ws/task')
  })

  it('passes model content as separate argv entries, never a shell string', async () => {
    harness = await seed()
    const runner = fakeRunner()

    await runCreateMr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      // Shell metacharacters must stay inert data.
      request: { title: 'Fix; rm -rf /', body: '`whoami`' },
      runner,
    })

    const args = runner.calls[0]?.args ?? []
    expect(args[args.indexOf('--title') + 1]).toBe('Fix; rm -rf /')
    expect(args[args.indexOf('--body') + 1]).toBe('`whoami`')
  })

  it('fails closed for a non-Pet caller', async () => {
    harness = await seed()
    await expect(
      runCreateMr({
        repository: harness.repository,
        executorSessionId: 'ordinary-session',
        request: { title: 'Fix' },
        runner: fakeRunner(),
      }),
    ).rejects.toThrow(/not bound to a Pet Task/)
  })

  it('requires a repository root in the snapshot', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask())
    await harness.repository.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      capturedAt: 1,
    })
    await harness.repository.appendInvocation(testInvocation())
    await harness.repository.setInvocationStatus('inv-1', 'running')

    await expect(
      runCreateMr({
        repository: harness.repository,
        executorSessionId: 'exec-1',
        request: { title: 'Fix' },
        runner: fakeRunner(),
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_REQUIRED' })
  })

  it('rejects an empty or oversize title before touching the CLI', async () => {
    harness = await seed()
    const runner = fakeRunner()

    await expect(
      runCreateMr({
        repository: harness.repository,
        executorSessionId: 'exec-1',
        request: { title: '   ' },
        runner,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(runner.calls).toEqual([])
  })

  it('surfaces a CLI refusal verbatim instead of retrying', async () => {
    harness = await seed()
    const runner = fakeRunner({ code: 1, stderr: 'target branch is protected' })

    const outcome = await runCreateMr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      request: { title: 'Fix' },
      runner,
    })

    expect(outcome.status).toBe('refused')
    expect(outcome.reason).toContain('protected')
    expect(runner.calls).toHaveLength(1)
  })

  it('extracts the MR url from CLI output', () => {
    expect(extractMrUrl('created: https://code.example.com/x/mr/7 ok')).toBe(
      'https://code.example.com/x/mr/7',
    )
    expect(extractMrUrl('no url here')).toBeUndefined()
  })
})

describe('send-cr never accepts a model-provided destination', () => {
  it('resolves the group from the trusted workspace binding', async () => {
    harness = await seed({ sourceWorkspaceId: 'ws-1' })
    await harness.repository.putWorkspaceBinding({
      workspaceId: 'ws-1',
      crGroupId: 'oc_trusted',
      updatedAt: 1,
    })
    const runner = fakeRunner()

    const outcome = await runSendCr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      request: { mrUrl: 'https://code.example.com/mr/1' },
      runner,
    })

    expect(outcome.status).toBe('sent')
    expect(outcome.chatId).toBe('oc_trusted')
    const args = runner.calls[0]?.args ?? []
    expect(args[args.indexOf('--chat-id') + 1]).toBe('oc_trusted')
  })

  it('fails with a binding error when no destination is configured', async () => {
    harness = await seed({ sourceWorkspaceId: 'ws-1' })
    const runner = fakeRunner()

    await expect(
      runSendCr({
        repository: harness.repository,
        executorSessionId: 'exec-1',
        request: { mrUrl: 'https://code.example.com/mr/1' },
        runner,
      }),
    ).rejects.toMatchObject({ code: 'BINDING_INVALID' })
    // Nothing is sent anywhere.
    expect(runner.calls).toEqual([])
  })

  it('fails when the source has no workspace at all', async () => {
    harness = await seed()

    await expect(
      runSendCr({
        repository: harness.repository,
        executorSessionId: 'exec-1',
        request: { mrUrl: 'https://code.example.com/mr/1' },
        runner: fakeRunner(),
      }),
    ).rejects.toMatchObject({ code: 'BINDING_INVALID' })
  })

  it('rejects a non-http MR reference', async () => {
    harness = await seed({ sourceWorkspaceId: 'ws-1' })
    await harness.repository.putWorkspaceBinding({
      workspaceId: 'ws-1',
      crGroupId: 'oc_trusted',
      updatedAt: 1,
    })
    const runner = fakeRunner()

    await expect(
      runSendCr({
        repository: harness.repository,
        executorSessionId: 'exec-1',
        request: { mrUrl: 'oc_injected_target' },
        runner,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(runner.calls).toEqual([])
  })

  it('binds the send to the Invocation so a retry cannot double-post', async () => {
    harness = await seed({ sourceWorkspaceId: 'ws-1' })
    await harness.repository.putWorkspaceBinding({
      workspaceId: 'ws-1',
      crGroupId: 'oc_trusted',
      updatedAt: 1,
    })
    const runner = fakeRunner()

    await runSendCr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      request: { mrUrl: 'https://code.example.com/mr/1' },
      runner,
    })

    const args = runner.calls[0]?.args ?? []
    expect(args[args.indexOf('--idempotency-key') + 1]).toBe('pet-inv-1')
  })

  it('surfaces a send refusal verbatim', async () => {
    harness = await seed({ sourceWorkspaceId: 'ws-1' })
    await harness.repository.putWorkspaceBinding({
      workspaceId: 'ws-1',
      crGroupId: 'oc_trusted',
      updatedAt: 1,
    })

    const outcome = await runSendCr({
      repository: harness.repository,
      executorSessionId: 'exec-1',
      request: { mrUrl: 'https://code.example.com/mr/1' },
      runner: fakeRunner({ code: 1, stderr: 'bot is not a member of the chat' }),
    })

    expect(outcome.status).toBe('refused')
    expect(outcome.reason).toContain('not a member')
  })

  it('disables the capability when lark-cli is absent', async () => {
    const diagnostic = await sendCrDiagnostic(fakeRunner({}, { available: false }))
    expect(diagnostic).toContain('lark-cli')
  })
})

describe('the CR message uses a fixed template', () => {
  it('carries the source, MR and origin', () => {
    const text = renderCrMessage({
      sourceTitle: 'Fix login timeout',
      mrUrl: 'https://code.example.com/mr/1',
      note: 'please review today',
    })

    expect(text).toContain('Fix login timeout')
    expect(text).toContain('https://code.example.com/mr/1')
    expect(text).toContain('please review today')
    // Always identifies its origin; the model cannot restyle it away.
    expect(text).toContain('DSH Pet')
  })

  it('omits an empty note without leaving a dangling label', () => {
    const text = renderCrMessage({
      sourceTitle: 'Fix',
      mrUrl: 'https://code.example.com/mr/1',
      note: '   ',
    })
    expect(text).not.toContain('说明：')
  })
})
