/**
 * Workspace-resident Tasks: executors that live inside the routed target
 * workspace rather than the dedicated Pet workspace.
 *
 * The form exists so a chat bound to a repository can be worked on in that
 * repository. The trade the spec makes explicit — and these tests pin — is
 * that Pet writes NOTHING into the user's workspace and therefore does not
 * promise its Skill-allowlist projection or standing instructions there.
 */

import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskWithExecutor, type AgentRegistryLike } from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { scopeKeyOf } from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

function fakeAgents(): AgentRegistryLike {
  const sessions = new Set<string>()
  return {
    create: vi.fn(async (options: { sessionId: string }) => {
      sessions.add(options.sessionId)
      return { session: { id: options.sessionId } }
    }),
    get: (sessionId: string) => (sessions.has(sessionId) ? {} : undefined),
  }
}

describe('chat scope keys', () => {
  it('keys a chat scope by chat id, not by its route target', async () => {
    // Two chats routed to the same workspace must NOT collapse into one Task.
    // That only holds when the chat id forms the scope key.
    expect(scopeKeyOf('chat', 'oc_a')).toBe('chat:oc_a')
    expect(scopeKeyOf('chat', 'oc_b')).toBe('chat:oc_b')
    expect(scopeKeyOf('chat', 'oc_a')).not.toBe(scopeKeyOf('workspace', 'ws-nexus'))
  })

  it('keeps QA source scopes separate from workspace scopes', () => {
    expect(scopeKeyOf('qa-chat', 'source-1')).toBe('qa:source-1')
    expect(scopeKeyOf('qa-chat', 'source-1')).not.toBe(scopeKeyOf('workspace', 'source-1'))
  })

  it('refuses a chat scope with no chat id', () => {
    expect(() => scopeKeyOf('chat')).toThrow(/requires an id/)
  })

  it('keeps two chats routed to one workspace on independent Tasks', async () => {
    harness = await openPetHarness()
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))
    const agents = fakeAgents()
    const repo = harness.repository

    const first = await createTaskWithExecutor(repo, agents, {
      scopeKey: scopeKeyOf('chat', 'oc_first'),
      sourceKind: 'chat',
      sourceId: 'oc_first',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })
    const second = await createTaskWithExecutor(repo, agents, {
      scopeKey: scopeKeyOf('chat', 'oc_second'),
      sourceKind: 'chat',
      sourceId: 'oc_second',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(first.id).not.toBe(second.id)
    expect(first.executorSessionId).not.toBe(second.executorSessionId)
    expect(repo.findActiveTaskByScope('chat:oc_first')?.id).toBe(first.id)
    expect(repo.findActiveTaskByScope('chat:oc_second')?.id).toBe(second.id)
  })
})

describe('workspace-resident executors', () => {
  it('creates the session inside the routed workspace', async () => {
    harness = await openPetHarness()
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))
    const agents = fakeAgents()

    const task = await createTaskWithExecutor(harness.repository, agents, {
      scopeKey: scopeKeyOf('chat', 'oc_group'),
      sourceKind: 'chat',
      sourceId: 'oc_group',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    const call = (agents.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.meta.cwd).toBe(target)
    expect(task.residentWorkspaceId).toBe('ws-nexus')
    expect(task.status).toBe('idle')
  })

  it('records the resident workspace so the form is inspectable', async () => {
    harness = await openPetHarness()
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))

    const task = await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: scopeKeyOf('chat', 'oc_group'),
      sourceKind: 'chat',
      sourceId: 'oc_group',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    // Diagnostics must be able to tell the two forms apart and report the
    // trust source honestly, which requires the field to survive storage.
    expect(harness.repository.getTask(task.id)?.residentWorkspaceId).toBe('ws-nexus')
  })

  it('writes nothing into the target workspace', async () => {
    harness = await openPetHarness()
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))
    const before = await readdir(target)

    await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: scopeKeyOf('chat', 'oc_group'),
      sourceKind: 'chat',
      sourceId: 'oc_group',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      // Supplied on purpose: even when a repair hook is available it MUST NOT
      // run for a resident Task, because repair writes Pet's own AGENTS.md and
      // skill projection into whatever workspace it is handed.
      ensureWorkspace: async () => [],
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(await readdir(target)).toEqual(before)
    expect(await readdir(target)).toEqual([])
  })

  it('never invokes workspace repair for a resident Task', async () => {
    harness = await openPetHarness()
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))
    const ensureWorkspace = vi.fn(async () => [] as readonly string[])

    await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: scopeKeyOf('chat', 'oc_group'),
      sourceKind: 'chat',
      sourceId: 'oc_group',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      ensureWorkspace,
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(ensureWorkspace).not.toHaveBeenCalled()
  })

  it('still repairs the Pet Workspace for an ordinary Task', async () => {
    harness = await openPetHarness()
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const ensureWorkspace = vi.fn(async () => [] as readonly string[])

    await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: paths.workspaceRoot,
      ensureWorkspace,
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    // The resident skip must be narrow: ordinary Tasks still depend on their
    // standing instructions being present.
    expect(ensureWorkspace).toHaveBeenCalledTimes(1)
  })

  it('leaves ordinary Tasks without a resident workspace id', async () => {
    harness = await openPetHarness()
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)

    const task = await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: paths.workspaceRoot,
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(task.residentWorkspaceId).toBeUndefined()
  })
})

describe('resident Tasks follow their workspace, not Pet', () => {
  it('files the session under the routed workspace', async () => {
    harness = await openPetHarness()
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))
    const attached: { sessionId: string; workspaceId?: string }[] = []

    await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: scopeKeyOf('chat', 'oc_group'),
      sourceKind: 'chat',
      sourceId: 'oc_group',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      attachToWorkspace: async (sessionId, workspaceId) => {
        attached.push({ sessionId, ...(workspaceId !== undefined ? { workspaceId } : {}) })
      },
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    // Right `cwd` is not enough: DSH files sessions explicitly, so without
    // the target id the session shows up unfiled instead of under nexus.
    expect(attached).toHaveLength(1)
    expect(attached[0]?.workspaceId).toBe('ws-nexus')
  })

  it('files an ordinary Task with no target so it lands under Pet', async () => {
    harness = await openPetHarness()
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const attached: (string | undefined)[] = []

    await createTaskWithExecutor(harness.repository, fakeAgents(), {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: paths.workspaceRoot,
      attachToWorkspace: async (_sessionId, workspaceId) => {
        attached.push(workspaceId)
      },
      selection: { providerId: 'anthropic', modelId: 'claude-opus-5' },
    })

    expect(attached).toEqual([undefined])
  })

  it('runs the standard preset instead of the Pet executor preset', async () => {
    harness = await openPetHarness()
    const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))
    const agents = fakeAgents()

    await createTaskWithExecutor(harness.repository, agents, {
      scopeKey: scopeKeyOf('chat', 'oc_group'),
      sourceKind: 'chat',
      sourceId: 'oc_group',
      workspacePath: target,
      residentWorkspaceId: 'ws-nexus',
      selection: {
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        agentPreset: 'dsh-pet-executor',
      },
    })

    // That preset exists to EXCLUDE local Skill discovery so the surface is
    // exactly Pet's allowlist — the opposite of what a resident Task wants.
    // `standard` is named explicitly: an omitted preset is not recorded on
    // the session header, leaving the session with no visible mode.
    const call = (agents.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.meta.agentPreset).toBe('standard')
  })

  it('still applies the preset to an ordinary Task', async () => {
    harness = await openPetHarness()
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const agents = fakeAgents()

    await createTaskWithExecutor(harness.repository, agents, {
      scopeKey: 'session:src-1',
      sourceKind: 'session',
      sourceId: 'src-1',
      workspacePath: paths.workspaceRoot,
      selection: {
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        agentPreset: 'dsh-pet-executor',
      },
    })

    // The exemption must be narrow: Pet's own executors still need it.
    const call = (agents.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.meta.agentPreset).toBe('dsh-pet-executor')
  })
})
