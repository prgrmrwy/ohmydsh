/**
 * Conversational Invocations: work raised by an inbound channel message
 * rather than by clicking a capability.
 *
 * These pin the two properties the channel design depends on — several
 * messages queue behind one another over a single executor session, and a
 * message arriving while the Agent waits becomes that Agent's answer rather
 * than a competing run — plus the trust-carrying fact that such an Invocation
 * pins no Skill and so emits no injection token.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from '../src/host/capture.js'
import {
  PetCoordinator,
  type ConversationRequest,
  type PromptDispatcher,
} from '../src/host/coordinator.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { scopeKeyOf } from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const resolver: SourceResolver = {
  getSession: () => undefined,
  getWorkspace: id => ({ id, title: `Workspace ${id}` }),
}

interface Fixture {
  readonly coordinator: PetCoordinator
  readonly harness: PetHarness
  readonly dispatched: { session: string; text: string }[]
  readonly target: string
}

async function fixture(): Promise<Fixture> {
  const created = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  const target = await mkdtemp(path.join(tmpdir(), 'nexus-'))

  const dispatched: { session: string; text: string }[] = []
  const dispatcher: PromptDispatcher = {
    dispatch: vi.fn(async (session: string, text: string) => {
      dispatched.push({ session, text })
    }),
  }
  const agents: AgentRegistryLike = {
    create: vi.fn(async (opts: { sessionId: string }) => ({ session: { id: opts.sessionId } })),
    get: () => ({}),
  } as AgentRegistryLike

  const coordinator = new PetCoordinator({
    repository: created.repository,
    capabilities: new CapabilityRegistry(),
    agents,
    dispatcher,
    resolver,
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
    // Present on purpose: a conversational Invocation pins no Skill, so this
    // must never be consulted. Throwing proves it is not.
    verifySkill: async name => {
      throw new Error(`verifySkill must not run for a conversational Invocation (got ${name})`)
    },
  })
  return { coordinator, harness: created, dispatched, target }
}

function request(f: Fixture, overrides: Partial<ConversationRequest> = {}): ConversationRequest {
  return {
    invocationId: `inv-${Math.random().toString(36).slice(2, 10)}`,
    scopeKey: scopeKeyOf('chat', 'oc_group'),
    chatId: 'oc_group',
    chatName: 'Nexus 前端团队',
    workspaceId: 'ws-nexus',
    workspacePath: f.target,
    prompt: '为什么构建变慢了？',
    ...overrides,
  }
}

describe('admitting an inbound message', () => {
  it('creates a workspace-resident Task and dispatches immediately', async () => {
    const f = await fixture()
    harness = f.harness

    const result = await f.coordinator.acceptConversation(request(f))

    expect(result.started).toBe(true)
    expect(result.task.scopeKey).toBe('chat:oc_group')
    expect(result.task.residentWorkspaceId).toBe('ws-nexus')
    expect(f.dispatched).toHaveLength(1)
    expect(f.dispatched[0]?.text).toContain('为什么构建变慢了？')
  })

  it('pins no Skill and emits no injection token', async () => {
    const f = await fixture()
    harness = f.harness

    const result = await f.coordinator.acceptConversation(request(f))

    // The fixture's verifySkill throws; reaching dispatch proves it was
    // never consulted, because there is no pinned Skill to verify.
    expect(result.invocation.skillName).toBeUndefined()
    expect(f.dispatched[0]?.text).not.toContain('/undefined')
    expect(f.dispatched[0]?.text.split('\n')[0]).not.toMatch(/^\//)
  })

  it('reuses the chat Task and its one executor for later messages', async () => {
    const f = await fixture()
    harness = f.harness

    const first = await f.coordinator.acceptConversation(request(f))
    // Settle the first so the serial slot frees up.
    await f.harness.repository.setInvocationStatus(first.invocation.id, 'succeeded')
    await f.harness.repository.setTaskStatus(first.task.id, 'idle')
    const second = await f.coordinator.acceptConversation(request(f))

    expect(second.task.id).toBe(first.task.id)
    expect(second.task.executorSessionId).toBe(first.task.executorSessionId)
    expect(f.dispatched).toHaveLength(2)
  })

  it('keeps two chats on independent Tasks even when routed alike', async () => {
    const f = await fixture()
    harness = f.harness

    const a = await f.coordinator.acceptConversation(request(f))
    const b = await f.coordinator.acceptConversation(
      request(f, { scopeKey: scopeKeyOf('chat', 'oc_other'), chatId: 'oc_other' }),
    )

    expect(b.task.id).not.toBe(a.task.id)
    expect(b.task.executorSessionId).not.toBe(a.task.executorSessionId)
  })

  it('is idempotent for a redelivered message', async () => {
    const f = await fixture()
    harness = f.harness
    const fixed = request(f, { invocationId: 'inv-fixed' })

    const first = await f.coordinator.acceptConversation(fixed)
    const again = await f.coordinator.acceptConversation(fixed)

    // Lark redelivers unacknowledged events after a reconnect; running the
    // user's request twice is the failure this prevents.
    expect(again.invocation.id).toBe(first.invocation.id)
    expect(f.dispatched).toHaveLength(1)
  })
})

describe('serial queue across inbound messages', () => {
  it('queues a second message behind the running one', async () => {
    const f = await fixture()
    harness = f.harness

    const first = await f.coordinator.acceptConversation(request(f))
    const second = await f.coordinator.acceptConversation(request(f))

    expect(first.started).toBe(true)
    expect(second.started).toBe(false)
    expect(second.invocation.status).toBe('queued')
    // One dispatch only: the queued message must not run concurrently over
    // the same executor session.
    expect(f.dispatched).toHaveLength(1)
  })

  it('starts the next message once the current one settles', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.acceptConversation(request(f))
    const second = await f.coordinator.acceptConversation(request(f))

    await f.harness.repository.setInvocationStatus(first.invocation.id, 'succeeded')
    await f.coordinator.pump(first.task.id)

    expect(f.harness.repository.getInvocation(second.invocation.id)?.status).not.toBe('queued')
    expect(f.dispatched).toHaveLength(2)
  })

  it('preserves arrival order across three messages', async () => {
    const f = await fixture()
    harness = f.harness

    const first = await f.coordinator.acceptConversation(request(f, { prompt: 'one' }))
    const second = await f.coordinator.acceptConversation(request(f, { prompt: 'two' }))
    const third = await f.coordinator.acceptConversation(request(f, { prompt: 'three' }))

    await f.harness.repository.setInvocationStatus(first.invocation.id, 'succeeded')
    await f.coordinator.pump(first.task.id)
    await f.harness.repository.setInvocationStatus(second.invocation.id, 'succeeded')
    await f.coordinator.pump(first.task.id)

    expect(f.dispatched.map(entry => entry.text.includes('one'))).toEqual([true, false, false])
    expect(f.dispatched[1]?.text).toContain('two')
    expect(f.dispatched[2]?.text).toContain('three')
    expect(third.invocation.status).toBe('queued')
  })

  it('does not preempt an Invocation that is waiting for the user', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.acceptConversation(request(f))
    await f.harness.repository.setInvocationStatus(first.invocation.id, 'waiting-user')

    const second = await f.coordinator.acceptConversation(request(f))

    // waiting-user still holds the serial slot: the answer belongs to the
    // Invocation that asked the question.
    expect(second.invocation.status).toBe('queued')
    expect(f.dispatched).toHaveLength(1)
  })
})

describe('answering a waiting Invocation from the channel', () => {
  it('continues the waiting Invocation instead of starting queued work', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.acceptConversation(request(f))
    await f.harness.repository.setInvocationStatus(first.invocation.id, 'waiting-user')
    await f.harness.repository.setTaskStatus(first.task.id, 'waiting-user')

    await f.coordinator.answer(first.task.id, '用的是 pnpm')

    // The answer reaches the same executor session as ordinary continuation,
    // and the waiting Invocation resumes rather than a new one starting.
    expect(f.dispatched).toHaveLength(2)
    expect(f.dispatched[1]?.text).toBe('用的是 pnpm')
    expect(f.harness.repository.getInvocation(first.invocation.id)?.status).toBe('running')
  })

  it('refuses an answer when nothing is waiting', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.acceptConversation(request(f))

    await expect(f.coordinator.answer(first.task.id, 'hello')).rejects.toThrow(
      /not waiting for an answer/,
    )
  })
})

describe('healing a stale active-Task pointer', () => {
  it('creates a new Task epoch after the previous one is archived', async () => {
    const f = await fixture()
    harness = f.harness
    const first = await f.coordinator.acceptConversation(request(f))
    await f.harness.repository.setInvocationStatus(first.invocation.id, 'succeeded')
    // Archiving requires a terminal Task, which is the existing invariant:
    // work in flight is never silently discarded.
    await f.harness.repository.setTaskStatus(first.task.id, 'failed')
    await f.harness.repository.archiveTask(first.task.id)

    const second = await f.coordinator.acceptConversation(request(f))

    // An archived Task never accepts new work; the chat must still be usable.
    expect(second.task.id).not.toBe(first.task.id)
    expect(second.task.epoch).toBe(first.task.epoch + 1)
    expect(second.started).toBe(true)
  })
})
