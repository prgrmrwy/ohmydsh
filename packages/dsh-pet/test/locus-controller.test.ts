/** Focused control-plane tests for the standalone unified locus controller. */

import { describe, expect, it, vi } from 'vitest'
import {
  LocusController,
  LocusControllerError,
  locusEndpointKey,
  renderAutomaticReplacementWarning,
  type LocusControllerDeps,
  type LocusGroupRecord,
  type LocusRecord,
  type LocusRepository,
  type ProvisionedSession,
} from '../src/host/locus/controller.js'
import { LOCUS_MAIN_PRESET } from '../src/host/locus/aggregate.js'

/**
 * A main session as the real Host reports it.
 *
 * `agentPreset` is part of that shape, not decoration: `resolveMainParent`
 * refuses to let an owner NAME a main that is not running
 * `LOCUS_MAIN_PRESET`, because the locus child inherits its composition from
 * the main's preset. A double omitting it describes a session the real Host
 * never returns for a Pet-created main, and would make every explicit-bind
 * test assert against an unreachable state.
 */
function parent(
  id: string,
  workspaceId = 'ws-default',
  title = id,
  agentPreset: string | undefined = LOCUS_MAIN_PRESET,
): ProvisionedSession & {
  readonly workspaceId: string
  readonly title: string
} {
  return { id, workspaceId, title, ...(agentPreset === undefined ? {} : { agentPreset }) }
}

class MemoryLocusRepository implements LocusRepository {
  readonly groups = new Map<string, LocusGroupRecord>()
  readonly loci = new Map<string, LocusRecord>()
  readonly defaults = new Map<string, string>()
  readonly provisioning: string[] = []
  readonly committed: string[] = []
  readonly failed: string[] = []
  readonly resources: { provisioningId: string; resource: Record<string, string> }[] = []
  readonly notices = new Map<string, { endpoint: { chatId: string; threadId?: string }; text: string }>()
  idle = true

  async findGroup(chatId: string): Promise<LocusGroupRecord | undefined> {
    return this.groups.get(chatId)
  }

  async findActive(endpoint: { chatId: string; threadId?: string }): Promise<LocusRecord | undefined> {
    const key = locusEndpointKey(endpoint)
    return [...this.loci.values()]
      .filter(locus => locusEndpointKey(locus.endpoint) === key)
      .sort((left, right) => right.generation - left.generation)[0]
  }

  async findDefaultQa(parentSessionId: string): Promise<LocusRecord | undefined> {
    const locusId = this.defaults.get(parentSessionId)
    return locusId === undefined ? undefined : this.loci.get(locusId)
  }

  async isLocusIdle(): Promise<boolean> {
    return this.idle
  }

  async beginProvisioning(input: { provisioningId: string }): Promise<void> {
    this.provisioning.push(input.provisioningId)
  }

  async recordProvisioningResource(
    provisioningId: string,
    resource: { readonly mainSessionId?: string; readonly childSessionId?: string; readonly chatId?: string },
  ): Promise<void> {
    this.resources.push({ provisioningId, resource: { ...resource } })
  }

  async completeProvisioning(): Promise<void> {}

  async failProvisioning(provisioningId: string): Promise<void> {
    this.failed.push(provisioningId)
  }

  async findSwitchNotice(locusId: string, generation: number) {
    return this.notices.get(`${locusId}\u0000${String(generation)}`)
  }

  async acknowledgeSwitchNotice(locusId: string, generation: number): Promise<void> {
    this.notices.delete(`${locusId}\u0000${String(generation)}`)
  }

  async commitProvisioning(input: {
    provisioningId: string
    group?: LocusGroupRecord
    locus: LocusRecord
    defaultQaForParentSessionId?: string
    replace?: { oldLocusId: string; noticeText: string }
    rebuild?: { oldLocusId: string; predecessorDisposition?: 'archived-parent' }
  }): Promise<void> {
    this.committed.push(input.provisioningId)
    if (input.rebuild !== undefined) {
      // Mirrors the durable guard, because a fixture that does not enforce it
      // cannot catch a controller that stops proving what the guard requires:
      // every controller test passed while the real rebuild failed on exactly
      // this rule ("predecessor … is not unavailable"), and only production
      // showed it.
      const predecessor = this.loci.get(input.rebuild.oldLocusId)
      const unavailable = predecessor !== undefined &&
        (predecessor.state === 'stopped' || predecessor.state === 'invalid' || predecessor.state === 'retired')
      if (!unavailable && input.rebuild.predecessorDisposition !== 'archived-parent') {
        throw new Error(`Rebuild predecessor ${String(input.rebuild.oldLocusId)} is not unavailable`)
      }
    }
    if (input.replace !== undefined) {
      const old = this.loci.get(input.replace.oldLocusId)
      if (old !== undefined) this.loci.set(old.locusId, { ...old, state: 'retired', retiredAt: 99 })
      this.notices.set(`${input.locus.locusId}\u0000${String(input.locus.generation)}`, {
        endpoint: input.locus.endpoint,
        text: input.replace.noticeText,
      })
    }
    if (input.rebuild !== undefined) {
      const old = this.loci.get(input.rebuild.oldLocusId)
      if (old !== undefined && old.state !== 'retired') this.loci.set(old.locusId, old)
    }
    if (input.group !== undefined) this.groups.set(input.group.chatId, input.group)
    this.loci.set(input.locus.locusId, input.locus)
    if (input.defaultQaForParentSessionId !== undefined) {
      this.defaults.set(input.defaultQaForParentSessionId, input.locus.locusId)
    }
  }
}

interface FakeHost {
  readonly deps: LocusControllerDeps
  readonly repository: MemoryLocusRepository
  readonly createdMains: { workspaceId: string; chatId: string; label: string }[]
  readonly createdChildren: { parentSessionId: string; endpoint: { chatId: string; threadId?: string } }[]
  readonly released: string[]
  readonly sentWarnings: string[]
  failCommit?: boolean
  failGroup?: boolean
  failChildCommit?: boolean
  failNotification?: boolean
}

function fakeHost(options: {
  defaultWorkspace?: string
  /**
   * Session ids the Host reports as archived.
   *
   * Modelled on the harness rather than on a mutable probe so a test states the
   * archive fact once and every reader — the parent resolver, the rebuild gate,
   * the session-level replacement — sees the same answer, which is the whole
   * point of the gate.
   */
  readonly archived?: readonly string[]
} = {}): FakeHost {
  const repository = new MemoryLocusRepository()
  const createdMains: { workspaceId: string; chatId: string }[] = []
  const createdChildren: { parentSessionId: string; endpoint: { chatId: string; threadId?: string } }[] = []
  const released: string[] = []
  const sentWarnings: string[] = []
  let sequence = 0
  let failGroup = false
  let failChildCommit = false
  let failNotification = false
  const sessions = new Map<string, ProvisionedSession & { workspaceId: string; title: string }>([
    ['source-1', parent('source-1', 'ws-source', '研发主会话')],
    ['source-2', parent('source-2', 'ws-other', '另一个主会话')],
    ['child-only', { ...parent('child-only'), parentSessionId: 'source-1' }],
  ])
  const deps: LocusControllerDeps = {
    repository,
    dsh: {
      resolveSession: async id => {
        const session = sessions.get(id)
        if (session === undefined) return undefined
        return options.archived?.includes(id) === true
          ? { ...session, state: 'archived' as const }
          : session
      },
      resolveDefaultWorkspace: async () =>
        options.defaultWorkspace === undefined
          ? { id: 'ws-default', title: '默认工作区' }
          : options.defaultWorkspace === ''
            ? undefined
            : { id: options.defaultWorkspace },
      createMainSession: async input => {
        if (options.defaultWorkspace === 'fail-main') throw new Error('main failed')
        const session = parent(`main-${++sequence}`, input.workspaceId, `群主会话 ${input.chatId}`)
        sessions.set(session.id, session)
        createdMains.push({ workspaceId: input.workspaceId, chatId: input.chatId, label: input.label })
        return {
          ...session,
          rollback: async () => {
            released.push(session.id)
            sessions.delete(session.id)
          },
        }
      },
      createChildSession: async input => {
        const session = {
          id: `child-${++sequence}`,
          parentSessionId: input.parentSessionId,
          workspaceId: sessions.get(input.parentSessionId)?.workspaceId ?? 'ws-default',
          childComposition: 'safe-v1' as const,
          commit: async () => {
            if (failChildCommit) throw new Error('child finalize failed')
          },
        }
        createdChildren.push({ parentSessionId: input.parentSessionId, endpoint: input.endpoint })
        return session
      },
      // Production provides this, and it only DETACHES: the session leaves its
      // workspace and reappears in the ungrouped bucket, which is exactly the
      // stray the owner saw after a failed replacement. `rollback` (below) is
      // the creator-held hook that also disposes the agent, so a caller must
      // prefer it.
      releaseSession: async id => {
        released.push(id)
      },
    },
    lark: {
      createGroup: async input => {
        if (failGroup) throw new Error('lark refused')
        return { chatId: `oc-${++sequence}`, chatName: input.name }
      },
      sendControlMessage: async input => {
        if (failNotification) throw new Error('notification failed')
        sentWarnings.push(input.text)
      },
      deleteGroup: async id => {
        released.push(`chat:${id}`)
      },
    },
    id: () => `id-${++sequence}`,
    now: () => 100,
  }
  return {
    deps,
    repository,
    createdMains,
    createdChildren,
    released,
    sentWarnings,
    get failCommit() {
      return false
    },
    set failCommit(value: boolean) {
      if (value) {
        vi.spyOn(repository, 'commitProvisioning').mockRejectedValueOnce(new Error('commit failed'))
      }
    },
    get failGroup() {
      return failGroup
    },
    set failGroup(value: boolean) {
      failGroup = value
    },
    get failChildCommit() {
      return failChildCommit
    },
    set failChildCommit(value: boolean) {
      failChildCommit = value
    },
    get failNotification() {
      return failNotification
    },
    set failNotification(value: boolean) {
      failNotification = value
    },
  }
}

function controller(host: FakeHost): LocusController {
  return new LocusController(host.deps)
}

describe('unified locus hierarchy', () => {
  it('creates one automatic main per group in the default workspace', async () => {
    const host = fakeHost()
    const first = await controller(host).ensureGroup({ chatId: 'oc-project', chatName: 'Project' })
    const second = await controller(host).ensureGroup({ chatId: 'oc-other', chatName: 'Other' })

    expect(host.createdMains.map(entry => ({ workspaceId: entry.workspaceId, chatId: entry.chatId }))).toEqual([
      { workspaceId: 'ws-default', chatId: 'oc-project' },
      { workspaceId: 'ws-default', chatId: 'oc-other' },
    ])
    expect(first.group.mainSessionId).not.toBe(second.group.mainSessionId)
    expect(first.locus.permission).toBe('read')
    expect(first.locus.source).toBe('auto')
  })

  it('fails closed when automatic main creation has no default workspace', async () => {
    const host = fakeHost({ defaultWorkspace: '' })
    await expect(controller(host).ensureGroup({ chatId: 'oc-no-default' })).rejects.toMatchObject({
      code: 'DEFAULT_WORKSPACE_UNAVAILABLE',
    })
    expect(host.createdMains).toHaveLength(0)
    expect(host.repository.loci).toHaveLength(0)
  })

  it('ensures a group before a topic and uses explicit topic parent precedence', async () => {
    const host = fakeHost()
    const result = await controller(host).ensureTopic({
      chatId: 'oc-project',
      threadId: 'omt-topic',
      parentSessionId: 'source-1',
    })

    expect(result.groupCreated).toBe(true)
    expect(result.group.mainSource).toBe('auto')
    expect(result.locus.parentSessionId).toBe('source-1')
    expect(result.locus.source).toBe('explicit')
    expect(host.createdChildren.map(item => item.parentSessionId)).toEqual([
      result.group.mainSessionId,
      'source-1',
    ])
  })

  it('keeps concurrent first topics on one automatic group main', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const [left, right] = await Promise.all([
      locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-a' }),
      locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-b' }),
    ])

    expect(left.group.mainSessionId).toBe(right.group.mainSessionId)
    expect(host.createdMains).toHaveLength(1)
    expect(host.createdChildren).toHaveLength(3)
  })

  it('rejects a child session as an explicit parent', async () => {
    const host = fakeHost()
    await expect(
      controller(host).ensureGroup({ chatId: 'oc-project', parentSessionId: 'child-only' }),
    ).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED' })
  })

  it('refuses to bind a main running another preset, naming the preset in the reason', async () => {
    const host = fakeHost()
    // A user's own work session: real, resolvable, not a child, workspace fine
    // — and running the shipped `standard` preset. Binding it would hand the
    // locus child a composition whose delegation rows sit in the child's OWN
    // scope, where the inherited-plane tool filter cannot remove them.
    host.deps.dsh.resolveSession = async () =>
      ({ id: 'user-work', workspaceId: 'ws-source', title: '用户工作会话', agentPreset: 'standard' })

    await expect(
      controller(host).ensureGroup({ chatId: 'oc-project', parentSessionId: 'user-work' }),
    ).rejects.toMatchObject({
      code: 'PARENT_NOT_ALLOWED',
      // The owner must be told WHICH preset is wrong and what to do instead;
      // a generic refusal is what previously surfaced as `locus-unavailable`.
      message: expect.stringContaining('standard'),
    })
  })

  it('refuses a main whose header records no preset at all', async () => {
    const host = fakeHost()
    // Absent is not "probably fine": the header proves nothing about what the
    // child would inherit, so it fails exactly as firmly as a mismatch.
    host.deps.dsh.resolveSession = async () =>
      ({ id: 'legacy-main', workspaceId: 'ws-source', title: '旧主会话' })

    await expect(
      controller(host).ensureGroup({ chatId: 'oc-project', parentSessionId: 'legacy-main' }),
    ).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED', message: expect.stringContaining('未记录') })
  })

  it('still resolves an ALREADY-established main that lacks the preset', async () => {
    // The gate guards naming a main, not serving one. A generation accepted
    // under the previous rule must keep working: refusing here would take a
    // live endpoint offline over a binding decision made long ago, and those
    // rows are already handled by the composition attestation.
    const host = fakeHost()
    const locus = controller(host)
    const established = await locus.ensureGroup({ chatId: 'oc-project' })

    host.deps.dsh.resolveSession = async id =>
      ({ id, workspaceId: 'ws-default', title: '既有主会话' })

    const topic = await locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-after' })
    expect(topic.locus.parentSessionId).toBe(established.group.mainSessionId)
  })

  it('does not cascade a stopped group to an existing topic and blocks new topics', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const existing = await locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-existing' })
    const group = host.repository.groups.get('oc-project')
    const groupLocus = [...host.repository.loci.values()].find(item => item.endpoint.threadId === undefined)
    if (group === undefined || groupLocus === undefined) throw new Error('group fixture missing')
    host.repository.groups.set('oc-project', { ...group, state: 'stopped', updatedAt: 200 })
    host.repository.loci.set(groupLocus.locusId, { ...groupLocus, state: 'stopped' })

    await expect(locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-existing' }))
      .resolves.toMatchObject({ reused: true, locus: { locusId: existing.locus.locusId, state: 'active' } })
    await expect(locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-new' }))
      .rejects.toMatchObject({ code: 'GROUP_UNAVAILABLE' })
    expect(host.createdChildren.filter(item => item.endpoint.threadId === 'omt-new')).toHaveLength(0)
  })
})

describe('existing topic explicit bind', () => {
  it('replaces an idle inherited topic with a fresh explicit read generation without changing the group', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const first = await locus.ensureTopic({ chatId: 'oc-topic-bind', threadId: 'omt-review' })
    const groupBefore = { ...first.group }

    const replaced = await locus.ensureTopic({
      chatId: 'oc-topic-bind',
      threadId: 'omt-review',
      parentSessionId: 'source-1',
    })

    expect(replaced).toMatchObject({ created: true, reused: false, groupCreated: false })
    expect(replaced.locus).toMatchObject({
      generation: first.locus.generation + 1,
      parentSessionId: 'source-1',
      source: 'explicit',
      permission: 'read',
      replacesLocusId: first.locus.locusId,
      parentLocusId: first.locus.parentLocusId,
    })
    expect(host.repository.loci.get(first.locus.locusId)?.state).toBe('retired')
    expect(host.repository.groups.get('oc-topic-bind')).toEqual(groupBefore)
    expect(host.sentWarnings.at(-1)).toContain('上下文来源发生变化')
  })

  it('reuses an inherited topic when the explicit target is already its parent', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const first = await locus.ensureTopic({ chatId: 'oc-topic-same', threadId: 'omt-review' })
    const childCount = host.createdChildren.length

    const retried = await locus.ensureTopic({
      chatId: 'oc-topic-same',
      threadId: 'omt-review',
      parentSessionId: first.locus.parentSessionId,
    })

    expect(retried).toMatchObject({ created: false, reused: true })
    expect(retried.locus.locusId).toBe(first.locus.locusId)
    expect(host.createdChildren).toHaveLength(childCount)
  })

  it('rejects replacing an existing explicit topic with a different explicit parent', async () => {
    const host = fakeHost()
    const locus = controller(host)
    await locus.ensureTopic({
      chatId: 'oc-topic-conflict', threadId: 'omt-review', parentSessionId: 'source-1',
    })
    const childCount = host.createdChildren.length

    await expect(locus.ensureTopic({
      chatId: 'oc-topic-conflict', threadId: 'omt-review', parentSessionId: 'source-2',
    })).rejects.toMatchObject({ code: 'EXPLICIT_PARENT_CONFLICT' })
    expect(host.createdChildren).toHaveLength(childCount)
  })

  it('rejects replacing an inherited topic while it has accepted or running work', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const first = await locus.ensureTopic({ chatId: 'oc-topic-busy', threadId: 'omt-review' })
    host.repository.idle = false

    await expect(locus.ensureTopic({
      chatId: 'oc-topic-busy', threadId: 'omt-review', parentSessionId: 'source-1',
    })).rejects.toMatchObject({ code: 'BUSY' })
    expect((await host.repository.findActive(first.locus.endpoint))?.locusId).toBe(first.locus.locusId)
  })

  it('keeps the committed topic replacement paused on notification failure and retries without a child', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const first = await locus.ensureTopic({ chatId: 'oc-topic-notice', threadId: 'omt-review' })
    host.failNotification = true

    await expect(locus.ensureTopic({
      chatId: 'oc-topic-notice', threadId: 'omt-review', parentSessionId: 'source-1',
    })).rejects.toMatchObject({ code: 'NOTIFICATION_FAILED' })
    const current = await host.repository.findActive(first.locus.endpoint)
    expect(current).toMatchObject({ generation: 2, source: 'explicit', parentSessionId: 'source-1' })
    expect(host.repository.notices.size).toBe(1)
    const childCount = host.createdChildren.length

    host.failNotification = false
    const retried = await locus.ensureTopic({
      chatId: 'oc-topic-notice', threadId: 'omt-review', parentSessionId: 'source-1',
    })
    expect(retried).toMatchObject({ created: false, reused: true })
    expect(retried.locus.locusId).toBe(current?.locusId)
    expect(host.createdChildren).toHaveLength(childCount)
    expect(host.repository.notices.size).toBe(0)
  })
})

describe('default Q&A', () => {
  it('creates once, then opens the same default group', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const first = await locus.createOrOpenDefaultQa({ parentSessionId: 'source-1', ownerId: 'ou-owner' })
    const second = await locus.createOrOpenDefaultQa({ parentSessionId: 'source-1', ownerId: 'ou-owner' })

    expect(first.created).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.locus.locusId).toBe(first.locus.locusId)
    expect(host.createdChildren).toHaveLength(1)
  })

  it('reuses Q&A while issue entries remain independent children of the same main', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const defaultQa = await locus.createOrOpenDefaultQa({ parentSessionId: 'source-1', ownerId: 'ou-owner' })
    const issueA = await locus.ensureTopic({ chatId: 'oc-issue-a', threadId: 'omt-1', parentSessionId: 'source-1' })
    const issueB = await locus.ensureGroup({ chatId: 'oc-issue-b', parentSessionId: 'source-1' })
    const opened = await locus.createOrOpenDefaultQa({ parentSessionId: 'source-1', ownerId: 'ou-owner' })

    expect(opened.locus.locusId).toBe(defaultQa.locus.locusId)
    expect([defaultQa.locus, issueA.locus, issueB.locus].map(item => item.parentSessionId))
      .toEqual(['source-1', 'source-1', 'source-1'])
    expect(new Set([defaultQa.locus, issueA.locus, issueB.locus].map(item => item.childSessionId)).size).toBe(3)
  })
})

describe('provisioning rollback', () => {
  it('releases created sessions when repository publication fails', async () => {
    const host = fakeHost()
    host.failCommit = true

    await expect(controller(host).ensureGroup({ chatId: 'oc-rollback' })).rejects.toMatchObject({
      code: 'PROVISIONING_FAILED',
    })
    expect(host.released.filter(id => id.startsWith('child-'))).toHaveLength(1)
    expect(host.released.filter(id => id.startsWith('main-'))).toHaveLength(1)
    expect(host.repository.loci).toHaveLength(0)
    expect(host.repository.failed).toHaveLength(1)
  })

  it('releases the child when Q&A group creation fails', async () => {
    const host = fakeHost()
    host.failGroup = true

    await expect(
      controller(host).createOrOpenDefaultQa({ parentSessionId: 'source-1', ownerId: 'ou-owner' }),
    ).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' })
    expect(host.released.some(id => id.startsWith('child-'))).toBe(true)
    expect(host.repository.loci).toHaveLength(0)
  })

  it('keeps a published group and committed operation when child finalize fails', async () => {
    const host = fakeHost()
    host.failChildCommit = true

    await expect(controller(host).ensureGroup({ chatId: 'oc-published-group' })).rejects.toMatchObject({
      code: 'PROVISIONING_FAILED',
      message: expect.stringContaining('已持久化发布'),
    })

    expect(host.repository.groups.get('oc-published-group')?.state).toBe('active')
    expect([...host.repository.loci.values()]).toContainEqual(expect.objectContaining({
      endpoint: { chatId: 'oc-published-group' },
      state: 'active',
    }))
    expect(host.repository.committed).toHaveLength(1)
    expect(host.repository.failed).toHaveLength(0)
    expect(host.released).toHaveLength(0)
  })

  it('keeps a published topic child and committed operation when child finalize fails', async () => {
    const host = fakeHost()
    const locus = controller(host)
    await locus.ensureGroup({ chatId: 'oc-published-topic' })
    host.repository.committed.splice(0)
    host.released.splice(0)
    host.failChildCommit = true

    await expect(locus.ensureTopic({
      chatId: 'oc-published-topic',
      threadId: 'omt-finalize-failure',
    })).rejects.toMatchObject({
      code: 'PROVISIONING_FAILED',
      message: expect.stringContaining('已持久化发布'),
    })

    expect([...host.repository.loci.values()]).toContainEqual(expect.objectContaining({
      endpoint: { chatId: 'oc-published-topic', threadId: 'omt-finalize-failure' },
      state: 'active',
    }))
    expect(host.repository.committed).toHaveLength(1)
    expect(host.repository.failed).toHaveLength(0)
    expect(host.released).toHaveLength(0)
  })

  it('keeps a published Q&A group, child, default pointer and committed operation when child finalize fails', async () => {
    const host = fakeHost()
    host.failChildCommit = true

    await expect(controller(host).createOrOpenDefaultQa({
      parentSessionId: 'source-1',
      ownerId: 'ou-owner',
    })).rejects.toMatchObject({
      code: 'PROVISIONING_FAILED',
      message: expect.stringContaining('已持久化发布'),
    })

    const defaultLocusId = host.repository.defaults.get('source-1')
    expect(defaultLocusId).toBeDefined()
    expect(host.repository.loci.get(defaultLocusId!)?.state).toBe('active')
    expect(host.repository.groups.size).toBe(1)
    expect(host.repository.committed).toHaveLength(1)
    expect(host.repository.failed).toHaveLength(0)
    expect(host.released).toHaveLength(0)
  })
})

describe('automatic to explicit replacement', () => {
  it('creates a read child, sends warning, and retires only the old group locus', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const old = await locus.ensureGroup({ chatId: 'oc-project' })
    const replacement = await locus.replaceAutomaticGroupParent({
      chatId: 'oc-project',
      parentSessionId: 'source-1',
    })

    expect(replacement.created).toBe(true)
    expect(replacement.locus.parentSessionId).toBe('source-1')
    expect(replacement.locus.permission).toBe('read')
    expect(replacement.previousLocus.locusId).toBe(old.locus.locusId)
    expect(host.repository.loci.get(old.locus.locusId)?.state).toBe('retired')
    expect(host.sentWarnings[0]).toContain('上下文来源发生变化')
    expect(host.sentWarnings[0]).toContain('旧对话历史未自动合并')
  })

  it('keeps existing topics on S0 while new topics inherit S1, all new generations read', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const group = await locus.ensureGroup({ chatId: 'oc-project' })
    const oldTopic = await locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-old' })
    const replacement = await locus.replaceAutomaticGroupParent({
      chatId: 'oc-project',
      parentSessionId: 'source-1',
    })
    const newTopic = await locus.ensureTopic({ chatId: 'oc-project', threadId: 'omt-new' })

    expect(oldTopic.locus.parentSessionId).toBe(group.locus.parentSessionId)
    expect(newTopic.locus.parentSessionId).toBe('source-1')
    expect(replacement.locus.permission).toBe('read')
    expect(newTopic.locus.permission).toBe('read')
    expect(oldTopic.locus.locusId).not.toBe(newTopic.locus.locusId)
  })

  it('refuses replacement while the old locus is busy', async () => {
    const host = fakeHost()
    const locus = controller(host)
    await locus.ensureGroup({ chatId: 'oc-project' })
    host.repository.idle = false

    await expect(
      locus.replaceAutomaticGroupParent({ chatId: 'oc-project', parentSessionId: 'source-1' }),
    ).rejects.toMatchObject({ code: 'BUSY' })
  })

  it('keeps the committed replacement and notice debt when the warning cannot be sent', async () => {
    const host = fakeHost()
    const locus = controller(host)
    const old = await locus.ensureGroup({ chatId: 'oc-project' })
    const send = host.deps.lark?.sendControlMessage
    if (send === undefined) throw new Error('test seam missing')
    host.deps.lark!.sendControlMessage = async () => {
      throw new Error('not connected')
    }

    await expect(
      locus.replaceAutomaticGroupParent({ chatId: 'oc-project', parentSessionId: 'source-1' }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_FAILED' })
    expect(host.repository.loci.get(old.locus.locusId)?.state).toBe('retired')
    expect(host.released.some(id => id.startsWith('child-'))).toBe(false)
    const current = [...host.repository.loci.values()].find(item => item.state === 'active')
    expect(current).toBeDefined()
    expect(host.repository.notices.size).toBe(1)

    // An identical bind retries the exact durable debt instead of returning a
    // false success or creating another generation.
    host.deps.lark!.sendControlMessage = send
    const retried = await locus.replaceAutomaticGroupParent({
      chatId: 'oc-project',
      parentSessionId: 'source-1',
    })
    expect(retried.created).toBe(false)
    expect(retried.locus.locusId).toBe(current?.locusId)
    expect(retried.warningText).toContain('上下文来源发生变化')
    expect(host.repository.notices.size).toBe(0)
    expect(host.createdChildren).toHaveLength(2)
  })
})

describe('explicit rebuild', () => {
  it('rebuilds an opaque legacy endpoint from the explicit parent only as a fresh read locus', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)

    const rebuilt = await controller.rebuildLegacyEndpoint({
      endpoint: { chatId: 'oc-legacy-marker-only' },
      parentSessionId: 'source-1',
      chatName: '旧入口',
    })

    expect(rebuilt.locus).toMatchObject({
      endpoint: { chatId: 'oc-legacy-marker-only' },
      generation: 1,
      parentSessionId: 'source-1',
      workspaceId: 'ws-source',
      permission: 'read',
      source: 'explicit',
      state: 'active',
    })
    expect(rebuilt.group).toMatchObject({ mainSessionId: 'source-1', workspaceId: 'ws-source' })
    expect(host.createdMains).toHaveLength(0)
  })

  it('publishes safe-v1 only after the child returns the Host attestation', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)

    const created = await controller.ensureGroup({ chatId: 'oc-safe-marker' })
    expect(created.locus.childComposition).toBe('safe-v1')

    const unsafe = fakeHost()
    unsafe.deps.dsh.createChildSession = async input => ({
      id: 'child-unattested',
      parentSessionId: input.parentSessionId,
      workspaceId: input.workspaceId,
    })
    await expect(new LocusController(unsafe.deps).ensureGroup({ chatId: 'oc-unsafe-marker' }))
      .rejects.toMatchObject({ code: 'PROVISIONING_FAILED' })
    expect(unsafe.repository.loci.size).toBe(0)
  })

  it('refuses a legacy-marker rebuild when unified state already exists', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    await controller.ensureGroup({ chatId: 'oc-unified-exists' })
    const count = host.createdChildren.length

    await expect(controller.rebuildLegacyEndpoint({
      endpoint: { chatId: 'oc-unified-exists' },
      parentSessionId: 'source-1',
    })).rejects.toMatchObject({ code: 'REPOSITORY_INCONSISTENT' })
    expect(host.createdChildren).toHaveLength(count)
  })

  it('rebuilds a stopped group as a fresh read generation and preserves history', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    const first = await controller.ensureGroup({ chatId: 'oc-rebuild' })
    host.repository.loci.set(first.locus.locusId, { ...first.locus, state: 'stopped' })
    host.repository.groups.set('oc-rebuild', { ...first.group, state: 'stopped' })

    const rebuilt = await controller.rebuildExplicit({
      endpoint: { chatId: 'oc-rebuild' },
      previousLocusId: first.locus.locusId,
      parentSessionId: 'source-1',
    })

    expect(rebuilt.locus).toMatchObject({
      generation: 2,
      parentSessionId: 'source-1',
      permission: 'read',
      source: 'explicit',
      replacesLocusId: first.locus.locusId,
    })
    expect(host.repository.loci.get(first.locus.locusId)?.state).toBe('stopped')
    expect(host.repository.groups.get('oc-rebuild')).toMatchObject({ state: 'active', mainSessionId: 'source-1' })
  })

  /**
   * The session-level repair. It exists because the per-entry rebuild reuses
   * the recorded main session — exactly the session that cannot serve — so an
   * archived session left every entry under it with no working repair, and the
   * per-entry path cannot replace the session for all of them at once.
   */
  describe('session-level replacement of an archived main session', () => {
    /**
     * The real sequence, which matters: entries are created on a LIVE session
     * and the owner archives it afterwards. Creating one directly on an
     * archived session is refused by design, so a fixture that started
     * archived could not exist.
     */
    const archivedHost = async (chatIds: readonly string[]) => {
      const archived: string[] = []
      const host = fakeHost({ archived })
      const controller = new LocusController(host.deps)
      const created: { endpoint: { chatId: string }; locusId: string }[] = []
      for (const chatId of chatIds) {
        const group = await controller.ensureGroup({ chatId, parentSessionId: 'source-1' })
        created.push({ endpoint: { chatId }, locusId: group.locus.locusId })
      }
      archived.push('source-1')
      return { host, controller, created }
    }

    it('moves every entry onto ONE newly created session', async () => {
      const { host, controller, created } = await archivedHost(['oc-a', 'oc-b'])
      const before = host.createdMains.length

      const result = await controller.replaceArchivedParent({
        parentSessionId: 'source-1',
        entries: created,
      })

      // ONE replacement for the whole session: the entries shared a session
      // before, and they must still share one after.
      expect(host.createdMains).toHaveLength(before + 1)
      expect(host.createdMains.at(-1)).toMatchObject({ workspaceId: 'ws-source', chatId: 'oc-a' })
      // The replacement CONTINUES the archived session's job, so it inherits
      // that session's title rather than stacking another 「Locus 主会话 ·」
      // prefix onto it — the doubled label read as a stray session.
      expect(host.createdMains.at(-1)?.label).not.toContain('Locus 主会话 · Locus 主会话')
      expect(result.parentSessionId).not.toBe('source-1')
      expect(result.skipped).toEqual([])
      expect(result.replaced).toEqual(created.map(entry => entry.locusId))

      const rebuilt = [...host.repository.loci.values()]
        .filter(record => record.parentSessionId === result.parentSessionId)
      expect(rebuilt).toHaveLength(2)
      // Each entry's NEWEST generation is the one on the replacement session;
      // the old rows stay as durable history and are never resumed.
      for (const entry of created) {
        const newest = [...host.repository.loci.values()]
          .filter(record => record.endpoint.chatId === entry.endpoint.chatId)
          .sort((left, right) => left.generation - right.generation)
          .at(-1)
        expect(newest).toMatchObject({
          parentSessionId: result.parentSessionId,
          replacesLocusId: entry.locusId,
        })
      }
    })

    it('refuses a session that is not archived instead of moving anything', async () => {
      const host = fakeHost()
      const controller = new LocusController(host.deps)
      const group = await controller.ensureGroup({ chatId: 'oc-not-archived', parentSessionId: 'source-1' })
      const before = host.createdMains.length

      await expect(controller.replaceArchivedParent({
        parentSessionId: 'source-1',
        entries: [{ endpoint: { chatId: 'oc-not-archived' }, locusId: group.locus.locusId }],
      })).rejects.toMatchObject({ code: 'PARENT_NOT_ALLOWED' })
      expect(host.createdMains).toHaveLength(before)
    })

    it('creates NOTHING when no entry could be moved', async () => {
      const { host, controller } = await archivedHost(['oc-c'])
      const before = host.createdMains.length

      // Every entry is proved movable BEFORE the replacement session exists.
      // Finding out afterwards is what left a freshly created, unused main
      // session behind — and cleaning that up only detaches it, which puts the
      // stray in the owner's ungrouped bucket.
      await expect(controller.replaceArchivedParent({
        parentSessionId: 'source-1',
        entries: [{ endpoint: { chatId: 'oc-c' }, locusId: 'stale-locus-id' }],
      })).rejects.toMatchObject({ code: 'GROUP_UNAVAILABLE' })
      expect(host.createdMains).toHaveLength(before)
      expect(host.released).toEqual([])
    })

    it('moves the entries it can and reports the ones it cannot', async () => {
      const { host, controller, created } = await archivedHost(['oc-e'])
      const stale = { endpoint: { chatId: 'oc-e' }, locusId: 'stale-locus-id' }

      const result = await controller.replaceArchivedParent({
        parentSessionId: 'source-1',
        entries: [...created, stale],
      })

      expect(result.replaced).toEqual([created[0]!.locusId])
      expect(result.skipped).toEqual([
        { locusId: 'stale-locus-id', reason: expect.stringContaining('代际已变化') },
      ])
      // The replacement survived because something moved onto it.
      expect(host.released).toEqual([])
    })

    it('replaces a non-terminal generation ONLY when its parent is archived', async () => {
      const { host, controller, created } = await archivedHost(['oc-d'])
      const entry = created[0]!
      const record = host.repository.loci.get(entry.locusId)!
      expect(record.state).toBe('active')

      // Without the owner-facing flag the generic rebuild still refuses an
      // active generation — the guard that keeps a healthy row from being
      // replaced by mistake is unchanged.
      await expect(controller.rebuildExplicit({
        endpoint: entry.endpoint,
        previousLocusId: entry.locusId,
        parentSessionId: 'source-1',
      })).rejects.toMatchObject({ code: 'GROUP_UNAVAILABLE' })

      // With it, and with the archived fact re-proved by the controller.
      const rebuilt = await controller.rebuildExplicit({
        endpoint: entry.endpoint,
        previousLocusId: entry.locusId,
        parentSessionId: 'source-2',
        replaceArchivedParent: true,
      })
      expect(rebuilt.locus).toMatchObject({ parentSessionId: 'source-2', generation: record.generation + 1 })
    })

    it('refuses the flag when the recorded parent is NOT archived', async () => {
      const host = fakeHost()
      const controller = new LocusController(host.deps)
      const group = await controller.ensureGroup({ chatId: 'oc-flag', parentSessionId: 'source-1' })

      // The flag alone authorizes nothing: the archived fact is re-proved here.
      await expect(controller.rebuildExplicit({
        endpoint: { chatId: 'oc-flag' },
        previousLocusId: group.locus.locusId,
        parentSessionId: 'source-2',
        replaceArchivedParent: true,
      })).rejects.toMatchObject({ code: 'GROUP_UNAVAILABLE' })
    })
  })

  it('refuses stale or busy explicit rebuild without creating another child', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    const first = await controller.ensureGroup({ chatId: 'oc-rebuild-busy' })
    host.repository.loci.set(first.locus.locusId, { ...first.locus, state: 'invalid' })
    host.repository.groups.set('oc-rebuild-busy', { ...first.group, state: 'invalid' })
    host.repository.idle = false
    const count = host.createdChildren.length

    await expect(controller.rebuildExplicit({
      endpoint: { chatId: 'oc-rebuild-busy' },
      previousLocusId: first.locus.locusId,
      parentSessionId: 'source-1',
    })).rejects.toMatchObject({ code: 'BUSY' })
    await expect(controller.rebuildExplicit({
      endpoint: { chatId: 'oc-rebuild-busy' },
      previousLocusId: 'stale-id',
      parentSessionId: 'source-1',
    })).rejects.toMatchObject({ code: 'REPOSITORY_INCONSISTENT' })
    expect(host.createdChildren).toHaveLength(count)
  })

  // Regression for the dead end an owner used to hit: `rebuild`'s
  // parentSessionId always comes from the stopped/invalid locus record (the
  // only session that was ever this endpoint's main session — see
  // `locusRebuildRequest` in `client/settings.tsx`), so there was no way to
  // retry with a different id. Archiving that session is reversible — the
  // bytes and workspace-registry membership are just hidden — unlike a
  // genuinely missing one, so the error must say so and name the one action
  // that actually unblocks it, instead of reading identically to "gone".
  it('names the archived parent and points at recovery when rebuild targets it', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    const first = await controller.ensureGroup({ chatId: 'oc-rebuild-archived' })
    host.repository.loci.set(first.locus.locusId, { ...first.locus, state: 'stopped' })
    host.repository.groups.set('oc-rebuild-archived', { ...first.group, state: 'stopped' })

    const resolveSession = host.deps.dsh.resolveSession
    host.deps.dsh.resolveSession = async id =>
      id === 'source-archived'
        ? { id: 'source-archived', workspaceId: 'ws-source', title: '已归档的研发主会话', state: 'archived' }
        : resolveSession(id)

    await expect(controller.rebuildExplicit({
      endpoint: { chatId: 'oc-rebuild-archived' },
      previousLocusId: first.locus.locusId,
      parentSessionId: 'source-archived',
    })).rejects.toMatchObject({
      code: 'PARENT_NOT_FOUND',
      message: expect.stringMatching(/已归档的研发主会话.*已被归档.*会话归档管理.*恢复/u),
    })
  })

  it('keeps the plain "unavailable" wording for a parent that is missing outright, not archived', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    const first = await controller.ensureGroup({ chatId: 'oc-rebuild-missing' })
    host.repository.loci.set(first.locus.locusId, { ...first.locus, state: 'stopped' })
    host.repository.groups.set('oc-rebuild-missing', { ...first.group, state: 'stopped' })

    await expect(controller.rebuildExplicit({
      endpoint: { chatId: 'oc-rebuild-missing' },
      previousLocusId: first.locus.locusId,
      parentSessionId: 'session-truly-gone',
    })).rejects.toMatchObject({
      code: 'PARENT_NOT_FOUND',
      message: expect.not.stringContaining('归档'),
    })
  })

  // Automatic recovery of a generation the HOST invalidated. The recorded
  // parent is the only session a rebuild is ever offered, so when it is
  // unusable the endpoint had no reachable repair at all — the deadlock the
  // owner hit on devbox. `allowFreshParent` lets recovery establish a new main
  // session the same way first-time provisioning does.
  it('establishes a fresh main session when recovery is allowed and the recorded parent is archived', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    const first = await controller.ensureGroup({ chatId: 'oc-recover-archived' })
    host.repository.loci.set(first.locus.locusId, { ...first.locus, state: 'invalid' })
    host.repository.groups.set('oc-recover-archived', { ...first.group, state: 'invalid' })

    const resolveSession = host.deps.dsh.resolveSession
    host.deps.dsh.resolveSession = async id =>
      id === 'source-archived'
        ? { id: 'source-archived', workspaceId: 'ws-source', title: '已归档主会话', state: 'archived' }
        : resolveSession(id)

    // `ensureGroup` above already created the group's own main session, so
    // compare against that baseline rather than an absolute zero.
    const mainsBefore = host.createdMains.length
    const rebuilt = await controller.rebuildExplicit({
      endpoint: { chatId: 'oc-recover-archived' },
      previousLocusId: first.locus.locusId,
      parentSessionId: 'source-archived',
      allowFreshParent: true,
    })

    // A genuinely new main session, not a revived reference to the archived one.
    expect(rebuilt.locus).toMatchObject({ generation: 2, state: 'active', permission: 'read' })
    expect(rebuilt.locus.parentSessionId).not.toBe('source-archived')
    expect(host.createdMains).toHaveLength(mainsBefore + 1)
    // The replacement is published as its own generation; the invalid row is
    // left in place as durable history rather than being revived or erased.
    expect(host.repository.loci.get(rebuilt.locus.locusId)?.state).toBe('active')
    expect(host.repository.loci.get(first.locus.locusId)).toBeDefined()
  })

  // The owner-driven path is unchanged: the panel must still be able to say
  // which session to restore rather than silently fabricating a new one.
  it('keeps refusing an archived parent when recovery is not allowed', async () => {
    const host = fakeHost()
    const controller = new LocusController(host.deps)
    const first = await controller.ensureGroup({ chatId: 'oc-recover-refused' })
    host.repository.loci.set(first.locus.locusId, { ...first.locus, state: 'invalid' })
    host.repository.groups.set('oc-recover-refused', { ...first.group, state: 'invalid' })

    const resolveSession = host.deps.dsh.resolveSession
    host.deps.dsh.resolveSession = async id =>
      id === 'source-archived'
        ? { id: 'source-archived', workspaceId: 'ws-source', title: '已归档主会话', state: 'archived' }
        : resolveSession(id)

    const mainsBefore = host.createdMains.length
    await expect(controller.rebuildExplicit({
      endpoint: { chatId: 'oc-recover-refused' },
      previousLocusId: first.locus.locusId,
      parentSessionId: 'source-archived',
    })).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' })
    // Refusing must not have fabricated a replacement session.
    expect(host.createdMains).toHaveLength(mainsBefore)
  })
})

describe('warning text', () => {
  it('states source change and does not expose full session ids', () => {
    const text = renderAutomaticReplacementWarning({
      fromSessionId: 'session-1234567890',
      fromTitle: '自动主会话',
      toSessionId: 'session-abcdefghij',
      toTitle: '显式主会话',
    })
    expect(text).toContain('自动主会话')
    expect(text).toContain('显式主会话')
    expect(text).toContain('上下文来源发生变化')
    expect(text).toContain('旧对话历史未自动合并')
    expect(text).not.toContain('session-1234567890')
  })
})
