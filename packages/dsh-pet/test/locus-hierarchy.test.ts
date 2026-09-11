import { describe, expect, it, vi } from 'vitest'
import {
  createLocusHierarchy,
  HierarchyError,
  type GroupContext,
  type HierarchyPorts,
  type HierarchyRefusal,
} from '../src/host/locus/hierarchy.js'

const CHAT = 'oc-project'
const TOPIC = { chatId: CHAT, threadId: 'omt-review' } as const
const GROUP = { chatId: CHAT } as const
const signal = new AbortController().signal

/** A hierarchy over an in-memory group store with counted provisioning. */
function harness(options: {
  readonly existing?: (GroupContext & { invalid?: boolean })[]
  readonly defaultWorkspaceId?: string | undefined
  readonly provisioning?: boolean
  readonly explicit?: Record<string, { workspaceId: string }>
} = {}) {
  const stored = new Map<string, GroupContext & { invalid?: boolean }>()
  for (const item of options.existing ?? []) stored.set(item.chatId, item)
  let created = 0
  const diagnostics: HierarchyRefusal[] = []

  const ports: HierarchyPorts = {
    groups: {
      find: (chatId) => stored.get(chatId),
      put: async (context) => { stored.set(context.chatId, context) },
    },
    ...(options.provisioning === false
      ? {}
      : {
        provisioning: {
          createGroupMain: async ({ chatId }) => {
            created += 1
            // One automatic main per CHAT, so the id is derived from the chat.
            return { mainSessionId: `main-auto-${chatId}` }
          },
        },
      }),
    defaultWorkspaceId: () => (
      'defaultWorkspaceId' in options ? options.defaultWorkspaceId : 'ws-default'
    ),
    resolveExplicit: (sessionId) => options.explicit?.[sessionId],
    log: reason => { diagnostics.push(reason) },
  }
  return { hierarchy: createLocusHierarchy(ports), stored, diagnostics, createdCount: () => created }
}

describe('group and topic hierarchy completion', () => {
  it('creates one automatic group main for a chat-level first entry', async () => {
    const h = harness()

    const result = await h.hierarchy.ensure({ endpoint: GROUP, signal })

    expect(result.createdGroup).toBe(true)
    expect(result.group).toMatchObject({
      chatId: CHAT,
      mainSessionId: `main-auto-${CHAT}`,
      workspaceId: 'ws-default',
      source: 'auto',
    })
    expect(result.parent).toEqual({
      mainSessionId: `main-auto-${CHAT}`,
      workspaceId: 'ws-default',
      origin: 'group-auto',
    })
  })

  it('completes the group level when a topic is the first entry', async () => {
    const h = harness()

    const result = await h.hierarchy.ensure({ endpoint: TOPIC, signal })

    // A topic is structurally owned by its chat, so the group level must
    // exist before the topic can be served.
    expect(result.createdGroup).toBe(true)
    expect(h.stored.get(CHAT)?.mainSessionId).toBe(`main-auto-${CHAT}`)
    expect(result.parent.origin).toBe('inherited')
  })

  it('yields the same group main whether the group or the topic came first', async () => {
    const groupFirst = harness()
    await groupFirst.hierarchy.ensure({ endpoint: GROUP, signal })
    const afterGroup = await groupFirst.hierarchy.ensure({ endpoint: TOPIC, signal })

    const topicOnly = harness()
    const topicFirst = await topicOnly.hierarchy.ensure({ endpoint: TOPIC, signal })

    // Creation order must be unobservable in the result.
    expect(afterGroup.parent.mainSessionId).toBe(topicFirst.parent.mainSessionId)
    expect(groupFirst.createdCount()).toBe(1)
    expect(topicOnly.createdCount()).toBe(1)
  })

  it('creates exactly one group main when two topics enter concurrently', async () => {
    const h = harness()

    const [first, second] = await Promise.all([
      h.hierarchy.ensure({ endpoint: TOPIC, signal }),
      h.hierarchy.ensure({ endpoint: { chatId: CHAT, threadId: 'omt-other' }, signal }),
    ])

    // Without the group lock both would provision their own main session and
    // one would silently overwrite the other.
    expect(h.createdCount()).toBe(1)
    expect(first.parent.mainSessionId).toBe(second.parent.mainSessionId)
    expect([first.createdGroup, second.createdGroup].filter(Boolean)).toHaveLength(1)
  })

  it('reuses an existing structure instead of re-provisioning', async () => {
    const h = harness({
      existing: [{
        chatId: CHAT,
        mainSessionId: 'main-existing',
        workspaceId: 'ws-existing',
        source: 'explicit',
      }],
    })

    const result = await h.hierarchy.ensure({ endpoint: TOPIC, signal })

    // An existing entry always wins: a changed default workspace must not
    // rewrite the parent of a structure that already exists.
    expect(result.createdGroup).toBe(false)
    expect(result.parent).toEqual({
      mainSessionId: 'main-existing',
      workspaceId: 'ws-existing',
      origin: 'inherited',
    })
    expect(h.createdCount()).toBe(0)
  })

  it.each([
    ['stopped', 'group-stopped'],
    ['retired', 'group-retired'],
  ] as const)('does not let a new topic bypass a %s group marker', async (state, reason) => {
    const h = harness({
      existing: [{
        chatId: CHAT,
        mainSessionId: 'main-preserved',
        workspaceId: 'ws-existing',
        source: 'explicit',
        state,
      }],
    })

    await expect(h.hierarchy.ensure({ endpoint: TOPIC, signal })).rejects.toMatchObject({ reason })
    expect(h.createdCount()).toBe(0)
    expect(h.diagnostics).toEqual([reason])
  })

  it('diagnoses an invalid group instead of replacing it', async () => {
    const h = harness({
      existing: [{
        chatId: CHAT,
        mainSessionId: 'main-broken',
        workspaceId: 'ws-existing',
        source: 'auto',
        invalid: true,
      }],
    })

    // "Explicitly invalid" is not "missing": taking the chat over under a
    // fresh default-workspace identity is exactly what must not happen.
    await expect(h.hierarchy.ensure({ endpoint: GROUP, signal }))
      .rejects.toMatchObject({ reason: 'group-invalid' })
    expect(h.createdCount()).toBe(0)
    expect(h.diagnostics).toEqual(['group-invalid'])
  })
})

describe('explicit source resolution', () => {
  it('establishes a chat directly from an explicit source', async () => {
    const h = harness({ explicit: { 'main-chosen': { workspaceId: 'ws-chosen' } } })

    const result = await h.hierarchy.ensure({
      endpoint: GROUP,
      explicitMainSessionId: 'main-chosen',
      signal,
    })

    // No throwaway automatic main is created first.
    expect(h.createdCount()).toBe(0)
    expect(result.group).toMatchObject({ mainSessionId: 'main-chosen', source: 'explicit' })
    expect(result.parent.origin).toBe('explicit')
  })

  it('does not promote an explicitly bound topic to the group default', async () => {
    const h = harness({ explicit: { 'main-topic': { workspaceId: 'ws-topic' } } })

    const result = await h.hierarchy.ensure({
      endpoint: TOPIC,
      explicitMainSessionId: 'main-topic',
      signal,
    })

    // The topic uses its own source, while the chat keeps its automatic main.
    expect(result.parent).toEqual({
      mainSessionId: 'main-topic',
      workspaceId: 'ws-topic',
      origin: 'explicit',
    })
    expect(h.stored.get(CHAT)?.mainSessionId).toBe(`main-auto-${CHAT}`)
    expect(h.stored.get(CHAT)?.source).toBe('auto')
  })

  it('refuses an explicit source that cannot be resolved', async () => {
    const h = harness({ explicit: {} })

    await expect(h.hierarchy.ensure({
      endpoint: GROUP,
      explicitMainSessionId: 'main-unknown',
      signal,
    })).rejects.toMatchObject({ reason: 'explicit-source-unresolved' })
    expect(h.createdCount()).toBe(0)
  })
})

describe('automatic creation stays fail-closed', () => {
  it('refuses when no default workspace is configured', async () => {
    const h = harness({ defaultWorkspaceId: undefined })

    await expect(h.hierarchy.ensure({ endpoint: GROUP, signal }))
      .rejects.toMatchObject({ reason: 'default-workspace-unavailable' })
    expect(h.createdCount()).toBe(0)
  })

  it('refuses when this Host cannot create a main session', async () => {
    const h = harness({ provisioning: false })

    await expect(h.hierarchy.ensure({ endpoint: GROUP, signal }))
      .rejects.toBeInstanceOf(HierarchyError)
    expect(h.diagnostics).toEqual(['group-provisioning-unavailable'])
  })

  it('keeps the queue usable after a refusal', async () => {
    const stored = new Map<string, GroupContext & { invalid?: boolean }>()
    let workspace: string | undefined
    const hierarchy = createLocusHierarchy({
      groups: {
        find: chatId => stored.get(chatId),
        put: async context => { stored.set(context.chatId, context) },
      },
      provisioning: { createGroupMain: async () => ({ mainSessionId: 'main-late' }) },
      defaultWorkspaceId: () => workspace,
    })

    await expect(hierarchy.ensure({ endpoint: GROUP, signal })).rejects.toThrow()
    // A rejected first entry must not poison the per-chat chain.
    workspace = 'ws-default'
    await expect(hierarchy.ensure({ endpoint: GROUP, signal }))
      .resolves.toMatchObject({ createdGroup: true })
  })

  it('creates a separate main session per chat in the same workspace', async () => {
    const h = harness()

    const first = await h.hierarchy.ensure({ endpoint: GROUP, signal })
    const second = await h.hierarchy.ensure({ endpoint: { chatId: 'oc-other' }, signal })

    // One per chat, never one per workspace: sharing would merge two chats'
    // collaboration contexts.
    expect(first.parent.mainSessionId).not.toBe(second.parent.mainSessionId)
    expect(h.createdCount()).toBe(2)
  })
})
