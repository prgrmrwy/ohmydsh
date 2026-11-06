import { describe, expect, it, vi } from 'vitest'
import {
  LOCUS_ACCESS_RECEIPT,
  LOCUS_FENCE_STALE_MESSAGE,
  createLocusManagementPort,
  createLocusSessionDescriber,
  type LocusManagementActions,
} from '../src/host/locus/management.js'
import type { LocusRowV20 } from '../src/host/locus/contract-v20.js'
import { collectHandleCodes, endpointHandleId } from '../src/client/locus-view.js'
import { groupRow, mainRecord, managementRepo, topicRow } from './support/mgmt-snapshot.js'
import { LocusController } from '../src/host/locus/controller.js'
import { Topology } from './support/w-topology.js'

/**
 * The management port over the REAL controller, adapted exactly as `index.ts`
 * wires it (repository reads, chat-level current delivery, stop → stopEntry,
 * rebind → rebindChat). Only the repository and DSH runtime are fakes.
 */
function realHost() {
  const t = new Topology({ archived: ['W1'] })
  t.seedMain('W1', 'M-old')
  const group = t.seedGroup('oc_1', 'M-old', 'proj-1', { defaultQa: true, revision: 4, accessMode: 'danger-full-access' })
  t.seedTopic('oc_1', 't1', { revision: 2, accessMode: 'danger-full-access' })
  t.seedTopic('oc_1', 't2', { state: 'stopped', stoppedAt: 9, revision: 1 })
  const controller = new LocusController(t.deps())
  const repo = t.repository
  const port = createLocusManagementPort({
    repository: {
      listRows: () => [...repo.rows.values()],
      findMain: id => repo.findMain(id),
      hasNonTerminalDelivery: locusId => repo.hasNonTerminalDelivery(),
      hasCurrentDelivery: locusId => {
        const row = repo.getLocus(locusId)
        return row !== undefined && repo.hasCurrentDeliveryInChat(row.endpoint.chatId)
      },
    },
    resolvers: {
      session: async id => (t.archived.has(id) ? { availability: 'archived' as const } : { availability: 'available' as const, title: id }),
    },
    actions: {
      stop: fence => controller.stopEntry(fence),
      rebind: request => controller.rebindChat(request),
    },
  })
  return { t, group, port }
}

describe('2D.5 against the real controller (index.ts wiring)', () => {
  it('spec Scenario "改绑后各入口重置而停止的保持停止" through the real rebindChat', async () => {
    const { group, port } = realHost()
    const before = (await port.view()).works
    expect(before.map(work => [work.work.sessionId, work.work.availability])).toEqual([['W1', 'archived']])

    const result = await port.rebind(
      { chatId: 'oc_1', workSessionId: 'W2', expectedLocusId: group.locusId, expectedRevision: 4 },
      OWNER,
    )
    expect(result.receipt).toContain('W2')

    const view = await port.view()
    expect(view.works.map(work => work.work.sessionId)).toEqual(['W2'])
    const chat = view.works[0]!.chats[0]!
    expect(chat.reboundFrom).toEqual({ sessionId: 'W1' })
    expect(chat.defaultQa).toBeUndefined()
    expect(chat.group).toMatchObject({ locusId: group.locusId, state: 'not-created', accessMode: 'read-only', revision: 5 })
    expect(chat.group).not.toHaveProperty('session')
    expect(chat.topics.map(topic => [topic.endpoint.threadId, topic.state, topic.accessMode])).toEqual([
      ['t1', 'not-created', 'read-only'],
      ['t2', 'stopped', 'read-only'],
    ])
  })

  it('maps the real controller refusals: stale fence → REVISION_CONFLICT, current delivery → LOCUS_BUSY', async () => {
    const { t, group, port } = realHost()
    await expect(port.rebind({ chatId: 'oc_1', workSessionId: 'W2', expectedLocusId: group.locusId, expectedRevision: 3 }, OWNER))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    t.repository.currentChats.add('oc_1')
    expect((await port.view()).works[0]!.chats[0]!.topics.every(topic => topic.hasCurrentDelivery)).toBe(true)
    await expect(port.rebind({ chatId: 'oc_1', workSessionId: 'W2', expectedLocusId: group.locusId, expectedRevision: 4 }, OWNER))
      .rejects.toMatchObject({ code: 'LOCUS_BUSY' })
  })

  it('refuses a rebind while W is not archived with the controller reason (INVALID_REQUEST)', async () => {
    const { t, group, port } = realHost()
    t.archived.delete('W1')
    await expect(port.rebind({ chatId: 'oc_1', workSessionId: 'W2', expectedLocusId: group.locusId, expectedRevision: 4 }, OWNER))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('stops a group row through the real stopEntry and leaves the topic untouched', async () => {
    const { group, port } = realHost()
    await port.stop({ endpoint: { chatId: 'oc_1' }, expectedLocusId: group.locusId, expectedRevision: 4 }, OWNER)
    const chat = (await port.view()).works[0]!.chats[0]!
    expect(chat.group.state).toBe('stopped')
    // The topic keeps its seeded serving state and revision.
    expect(chat.topics.find(topic => topic.endpoint.threadId === 't1')).toMatchObject({ state: 'not-created', revision: 2 })
  })
})

const OWNER = { actorId: 'host:dsh-pet' }

function describeAll(titles: Record<string, string> = {}) {
  return vi.fn(async (id: string) => ({ availability: 'available' as const, title: titles[id] ?? `title ${id}` }))
}

describe('spec Requirement "管理面按工作会话分组且每个入口一行" (view half)', () => {
  it('groups chats by W, nests topics by chatId and keeps one row per entry', async () => {
    const repository = managementRepo({
      rows: [
        groupRow({ chatId: 'oc_A' }),
        topicRow({ chatId: 'oc_A', threadId: 'omt_1' }),
        topicRow({ chatId: 'oc_A', threadId: 'omt_2' }),
        groupRow({ chatId: 'doc:docx:D' }),
      ],
    })
    const port = createLocusManagementPort({ repository, resolvers: { session: describeAll() } })
    const view = await port.view()
    expect(view.works).toHaveLength(1)
    expect(view.works[0]?.work).toMatchObject({ sessionId: 'session-work-1', availability: 'available' })
    expect(view.works[0]?.chats.map(chat => chat.group.endpoint.chatId)).toEqual(['doc:docx:D', 'oc_A'])
    const chat = view.works[0]!.chats.find(item => item.group.endpoint.chatId === 'oc_A')!
    expect(chat.topics.map(topic => topic.endpoint.threadId)).toEqual(['omt_1', 'omt_2'])
    expect(chat.locusMain.sessionId).toBe('session-main-1')
    expect(JSON.stringify(view)).not.toMatch(/generation"?:\s*\d+,\s*"loci|parentLocusId|toolTier|contextAnchor|childComposition|permission/)
  })

  it('spec Scenario "投递中由投递表推出"', async () => {
    const repository = managementRepo({
      rows: [groupRow({ chatId: 'oc_A' }), topicRow({ chatId: 'oc_A', threadId: 'omt_T' })],
      current: ['locus-oc_A-omt_T'],
    })
    const port = createLocusManagementPort({ repository })
    const chat = (await port.view()).works[0]!.chats[0]!
    expect(chat.topics[0]).toMatchObject({ inFlight: true, hasCurrentDelivery: true })
    expect(chat.group).toMatchObject({ inFlight: false, hasCurrentDelivery: false })
    repository.current.clear()
    const after = (await port.view()).works[0]!.chats[0]!
    expect(after.topics[0]?.inFlight).toBe(false)
  })

  it('spec Scenario "改绑后的群行显示来源"', async () => {
    const repository = managementRepo({
      rows: [
        groupRow({ chatId: 'oc_A', reboundFrom: 'session-old-w' }),
        groupRow({ chatId: 'oc_B', locusId: 'locus-b', sessionId: 'session-child-b' }),
      ],
    })
    const port = createLocusManagementPort({ repository, resolvers: { session: describeAll({ 'session-old-w': '旧工作' }) } })
    const chats = (await port.view()).works[0]!.chats
    expect(chats.find(chat => chat.group.endpoint.chatId === 'oc_A')?.reboundFrom).toEqual({ sessionId: 'session-old-w', title: '旧工作' })
    expect(chats.find(chat => chat.group.endpoint.chatId === 'oc_B')).not.toHaveProperty('reboundFrom')
  })

  it('marks default Q&A on the group row only', async () => {
    const repository = managementRepo({
      rows: [groupRow({ chatId: 'oc_A', defaultQa: true }), topicRow({ chatId: 'oc_A', threadId: 'omt_1' })],
    })
    const chat = (await createLocusManagementPort({ repository }).view()).works[0]!.chats[0]!
    expect(chat.defaultQa).toBe(true)
    expect(chat.topics[0]).not.toHaveProperty('defaultQa')
  })

  it('reports W availability as unknown when the Host cannot describe it', async () => {
    const view = await createLocusManagementPort({ repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })] }) }).view()
    expect(view.works[0]?.work.availability).toBe('unknown')
    expect(view.works[0]?.chats[0]?.group.session?.availability).toBe('unknown')
  })
})

describe('spec Requirement "管理面的会话可用性以持久证据判定" (management half)', () => {
  it('spec Scenario "重启后未加载的会话不得报为不可用": W, M and the child are described from cold reads', async () => {
    const session = describeAll({ 'session-work-1': 'W', 'session-main-1': 'M', 'session-child-oc_A': 'C' })
    const view = await createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })] }),
      resolvers: { session },
    }).view()
    const work = view.works[0]!
    expect(work.work).toMatchObject({ title: 'W', availability: 'available' })
    expect(work.chats[0]?.locusMain).toMatchObject({ title: 'M', availability: 'available' })
    expect(work.chats[0]?.group.session).toEqual({ title: 'C', availability: 'available' })
  })

  it('spec Scenario "未创建入口的预留会话不报缺失": a reserved sessionId is never cold-read', async () => {
    const session = describeAll()
    const view = await createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A', state: 'not-created', sessionId: 'session-reserved' })] }),
      resolvers: { session },
    }).view()
    expect(view.works[0]?.chats[0]?.group).not.toHaveProperty('session')
    expect(session).not.toHaveBeenCalledWith('session-reserved')
  })

  it('describes a session shared by several chats only once per view', async () => {
    const session = describeAll()
    await createLocusManagementPort({
      repository: managementRepo({ rows: ['a', 'b', 'c'].map(suffix => groupRow({ chatId: `oc_${suffix}` })) }),
      resolvers: { session },
    }).view()
    // 1 W + 1 M + 3 distinct children.
    expect(session).toHaveBeenCalledTimes(5)
  })
})

describe('spec Requirement "管理面的标识以确定性短码表达且名称与短码成对" (management half)', () => {
  it('spec Scenario "同名入口仍可区分"', async () => {
    const view = await createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_1111aaaa' }), groupRow({ chatId: 'oc_1111bbbb' })] }),
      resolvers: { endpoint: () => ({ chatName: '答疑 · DSH' }) },
    }).view()
    const codes = collectHandleCodes(view)
    const groups = view.works[0]!.chats.map(chat => chat.group)
    expect(groups.map(group => group.endpoint.chatName)).toEqual(['答疑 · DSH', '答疑 · DSH'])
    const [left, right] = groups.map(group => codes.endpoint.get(endpointHandleId(group.endpoint)))
    expect(left).toBeDefined()
    expect(left).not.toBe(right)
  })

  it('spec Scenario "短码不是身份": a short code fence changes nothing, a short code rebind target is passed verbatim', async () => {
    const repository = managementRepo({ rows: [groupRow({ chatId: 'oc_A', locusId: 'locus-runtime-1-2f853e76' })] })
    const stop = vi.fn(async () => undefined)
    const rebind = vi.fn(async () => undefined)
    const port = createLocusManagementPort({ repository, actions: { stop, rebind } })
    await expect(port.stop({ endpoint: { chatId: 'oc_A' }, expectedLocusId: '2f85', expectedRevision: 1 }, OWNER))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(stop).not.toHaveBeenCalled()
    await port.rebind({ chatId: 'oc_A', workSessionId: ' S·9062 ', expectedLocusId: 'locus-runtime-1-2f853e76', expectedRevision: 1 }, OWNER)
    expect(rebind).toHaveBeenCalledWith(expect.objectContaining({ workSessionId: 'S·9062' }))
  })
})

describe('management mutations: stop, access, rebind fenced by locusId + revision', () => {
  it('rejects a stale revision without calling the Host', async () => {
    const stop = vi.fn(async () => undefined)
    const port = createLocusManagementPort({ repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A', revision: 6 })] }), actions: { stop } })
    await expect(port.stop({ endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 5 }, OWNER))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT', message: LOCUS_FENCE_STALE_MESSAGE })
    expect(stop).not.toHaveBeenCalled()
  })

  it('refuses stop and access while the entry is in flight', async () => {
    const actions: LocusManagementActions = { stop: vi.fn(async () => undefined), access: vi.fn(async () => ({})) }
    const port = createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })], inFlight: ['locus-oc_A'] }),
      actions,
      writeEnabled: true,
    })
    const fence = { endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 1 }
    await expect(port.stop(fence, OWNER)).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    await expect(port.access({ ...fence, accessMode: 'danger-full-access' }, OWNER)).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    expect(actions.stop).not.toHaveBeenCalled()
    expect(actions.access).not.toHaveBeenCalled()
  })

  it('passes the acting identity to access and returns the honest receipt', async () => {
    const access = vi.fn(async () => ({}))
    const port = createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A', state: 'not-created' })] }),
      actions: { access },
      writeEnabled: true,
    })
    const result = await port.access({ endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 1, accessMode: 'danger-full-access' }, OWNER)
    expect(access).toHaveBeenCalledWith({ locusId: 'locus-oc_A', mode: 'danger-full-access', actorId: 'host:dsh-pet' })
    expect(result.receipt).toBe(LOCUS_ACCESS_RECEIPT)
  })

  it('refuses full access while the write switch is off but allows read-only', async () => {
    const access = vi.fn(async () => ({}))
    const port = createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A', accessMode: 'danger-full-access' })] }),
      actions: { access },
      writeEnabled: false,
    })
    const fence = { endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 1 }
    await expect(port.access({ ...fence, accessMode: 'danger-full-access' }, OWNER)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(port.access({ ...fence, accessMode: 'read-only' }, OWNER)).resolves.toMatchObject({ action: 'access' })
  })

  it('refuses access changes on stopped and invalid rows', async () => {
    const access = vi.fn(async () => ({}))
    const port = createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A', state: 'stopped' })] }),
      actions: { access },
      writeEnabled: true,
    })
    await expect(port.access({ endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 1, accessMode: 'read-only' }, OWNER))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(access).not.toHaveBeenCalled()
  })

  it('maps Host refusals onto the stable vocabulary', async () => {
    const refusal = (code: string) => Object.assign(new Error(`refused ${code}`), { code })
    const port = createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })] }),
      actions: { rebind: vi.fn(async () => { throw refusal('LOCUS_CONFLICT') }), stop: vi.fn(async () => { throw refusal('LOCUS_BUSY') }) },
    })
    await expect(port.rebind({ chatId: 'oc_A', workSessionId: 'S', expectedLocusId: 'locus-oc_A', expectedRevision: 1 }, OWNER))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(port.stop({ endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 1 }, OWNER))
      .rejects.toMatchObject({ code: 'LOCUS_BUSY' })
  })

  it('refuses without a trusted actor or an injected Host action', async () => {
    const port = createLocusManagementPort({ repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })] }) })
    const request = { endpoint: { chatId: 'oc_A' }, expectedLocusId: 'locus-oc_A', expectedRevision: 1 }
    await expect(port.stop(request, { actorId: ' ' })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    await expect(port.stop(request, OWNER)).rejects.toMatchObject({ code: 'ACTION_UNAVAILABLE' })
  })
})

describe('spec Requirement "管理面提供「改绑到其他会话」…" (management half)', () => {
  it('spec Scenario "改绑后各入口重置而停止的保持停止"', async () => {
    const repository = managementRepo({
      rows: [
        groupRow({ chatId: 'oc_A', locusId: 'L1', revision: 4, accessMode: 'danger-full-access' }),
        topicRow({ chatId: 'oc_A', threadId: 'T1', locusId: 'LT1', accessMode: 'danger-full-access' }),
        topicRow({ chatId: 'oc_A', threadId: 'T2', locusId: 'LT2', state: 'stopped' }),
      ],
      mains: [mainRecord('session-main-1', 'session-work-old'), mainRecord('session-main-new', 'S_NEW')],
    })
    // Fake Host: the repository's resetChat semantics (D17).
    const rebind = vi.fn(async (request: { chatId: string }) => {
      repository.rows = repository.rows.map((row): LocusRowV20 => {
        if (row.endpoint.chatId !== request.chatId) return row
        const isGroup = !('threadId' in row.endpoint)
        const reset = row.state === 'stopped'
          ? { ...row, accessMode: 'read-only' as const, revision: row.revision + 1 }
          : { ...row, state: 'not-created' as const, sessionId: `${row.sessionId}-new`, accessMode: 'read-only' as const, revision: row.revision + 1 }
        return (isGroup ? { ...reset, locusMainSessionId: 'session-main-new', reboundFrom: 'session-work-old' } : reset) as LocusRowV20
      })
    })
    const port = createLocusManagementPort({ repository, actions: { rebind }, resolvers: { session: describeAll({ S_NEW: '新工作' }) } })
    const result = await port.rebind({ chatId: 'oc_A', workSessionId: 'S_NEW', expectedLocusId: 'L1', expectedRevision: 4 }, OWNER)
    expect(rebind).toHaveBeenCalledWith({ chatId: 'oc_A', workSessionId: 'S_NEW', expectedLocusId: 'L1', expectedRevision: 4 })
    expect(result.receipt).toContain('新工作')
    const view = await port.view()
    expect(view.works.map(work => work.work.sessionId)).toEqual(['S_NEW'])
    const chat = view.works[0]!.chats[0]!
    expect([chat.group, ...chat.topics].map(entry => [entry.locusId, entry.state, entry.accessMode])).toEqual([
      ['L1', 'not-created', 'read-only'],
      ['LT1', 'not-created', 'read-only'],
      ['LT2', 'stopped', 'read-only'],
    ])
    expect(chat.reboundFrom?.sessionId).toBe('session-work-old')
  })

  it('refuses a rebind addressed at a topic row', async () => {
    const rebind = vi.fn(async () => undefined)
    const port = createLocusManagementPort({ repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })] }), actions: { rebind } })
    await expect(port.rebind({ chatId: 'oc_missing', workSessionId: 'S', expectedLocusId: 'x', expectedRevision: 1 }, OWNER))
      .rejects.toMatchObject({ code: 'LOCUS_NOT_FOUND' })
    await expect(port.rebind({ chatId: 'oc_A', workSessionId: '  ', expectedLocusId: 'locus-oc_A', expectedRevision: 1 }, OWNER))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', message: '请输入目标工作会话的完整 sessionId。' })
    expect(rebind).not.toHaveBeenCalled()
  })
})

describe('locus session describer', () => {
  const titled = (title: string) => [{ type: 'session/title', data: { title } }]
  const foldTitle = (events: readonly unknown[]): string | undefined => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i] as { type?: string; data?: { title?: unknown } }
      if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
        return event.data.title
      }
    }
    return undefined
  }

  it('reports an unloaded but readable session as available, not missing', async () => {
    // The regression: a Host restart leaves every locus main unloaded, and
    // reading existence from the live registry reported them all unavailable.
    const inspect = vi.fn(async () => ({ events: titled('Locus 主会话 · oc_project') }))
    const describe = createLocusSessionDescriber({
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-cold')).resolves.toEqual({
      availability: 'available',
      title: 'Locus 主会话 · oc_project',
    })
    expect(inspect).toHaveBeenCalledWith('session-cold')
  })

  it('reports an archived session as archived, with the title its log carries', async () => {
    // Archived must outrank readability: its log still inspects fine, so
    // checking readability first would call it ordinarily available.
    const inspect = vi.fn(async () => ({ events: titled('Archived') }))
    const describe = createLocusSessionDescriber({
      inspect,
      archivedSessionIds: () => ['session-archived'],
      foldTitle,
    })

    await expect(describe('session-archived')).resolves.toEqual({ availability: 'archived', title: 'Archived' })
  })


  it('reports an unreadable session as missing', async () => {
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => {
        throw new Error('session "session-gone" not found')
      }),
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-gone')).resolves.toEqual({ availability: 'missing' })
  })

  it('omits availability when the Host cannot cold-read at all', async () => {
    // A Host limitation is not evidence about the session; claiming `missing`
    // here would invent a fact.
    const describe = createLocusSessionDescriber({
      inspect: undefined,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-any')).resolves.toBeUndefined()
  })

  it('reports a readable but untitled session as available without a title', async () => {
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => ({ events: [] })),
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-untitled')).resolves.toEqual({ availability: 'available' })
  })

  it('does not let load state change the answer for the same session', async () => {
    // The live-registry answer flipped as sessions loaded and unloaded, which
    // made it useless as acceptance evidence.
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => ({ events: titled('Stable') })),
      archivedSessionIds: () => [],
      foldTitle,
    })

    const first = await describe('session-stable')
    const second = await describe('session-stable')
    expect(first).toEqual(second)
  })

  it('offers the session working boundary as the confirmable execution root', async () => {
    // Without this the write gate has no reachable intent fact: the only writer
    // of `executionRoot` is the owner-facing confirm, and the surface had
    // nothing to send it.
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => ({
        events: titled('Locus 子会话'),
        meta: { cwd: '/Users/prgrmrwy/corp/acme' },
      })),
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-child')).resolves.toEqual({
      availability: 'available',
      title: 'Locus 子会话',
      executionRoot: '/Users/prgrmrwy/corp/acme',
    })
  })

  it('omits the execution root rather than guessing one', async () => {
    const make = (inspection: unknown) => createLocusSessionDescriber({
      inspect: vi.fn(async () => inspection),
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(make({ events: [] })('session-any')).resolves.toEqual({ availability: 'available' })
    await expect(make({ events: [], meta: { cwd: '   ' } })('session-any'))
      .resolves.toEqual({ availability: 'available' })
    await expect(make({ events: [], meta: { cwd: 42 } })('session-any'))
      .resolves.toEqual({ availability: 'available' })
  })

  it('answers from the header + projection cache without a full log read', async () => {
    // A full inspect decompresses and replays the whole log; doing that for
    // every parent/child on each refresh made the management list take seconds.
    const inspect = vi.fn(async () => ({ events: titled('slow') }))
    const describe = createLocusSessionDescriber({
      peek: async () => ({ exists: true, cwd: ' /repo ', titleKnown: true, title: 'Cached' }),
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-cold')).resolves.toEqual({
      availability: 'available',
      title: 'Cached',
      executionRoot: '/repo',
    })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('keeps an untitled cached session available without inventing a title', async () => {
    const inspect = vi.fn(async () => ({ events: [] }))
    const describe = createLocusSessionDescriber({
      peek: async () => ({ exists: true, titleKnown: true }),
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-untitled')).resolves.toEqual({ availability: 'available' })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('reports missing when the persisted header does not exist or cannot be read', async () => {
    const inspect = vi.fn(async () => ({ events: [] }))
    const absent = createLocusSessionDescriber({
      peek: async () => ({ exists: false }),
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })
    const broken = createLocusSessionDescriber({
      peek: async () => { throw new Error('corrupt header') },
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(absent('session-gone')).resolves.toEqual({ availability: 'missing' })
    await expect(broken('session-bad')).resolves.toEqual({ availability: 'missing' })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('falls back to a full inspection on a cache miss or a declined peek', async () => {
    const inspect = vi.fn(async () => ({ events: titled('From log'), meta: { cwd: '/repo' } }))
    const miss = createLocusSessionDescriber({
      peek: async () => ({ exists: true, cwd: '/repo', titleKnown: false }),
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })
    const declined = createLocusSessionDescriber({
      peek: async () => undefined,
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })

    const expected = { availability: 'available', title: 'From log', executionRoot: '/repo' }
    await expect(miss('session-miss')).resolves.toEqual(expected)
    await expect(declined('session-live')).resolves.toEqual(expected)
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('keeps archived ahead of the fast path and still resolves the cached title', async () => {
    const peek = vi.fn(async () => ({ exists: true as const, titleKnown: true, title: 'x' }))
    const describe = createLocusSessionDescriber({
      peek,
      inspect: vi.fn(),
      archivedSessionIds: () => ['session-archived'],
      foldTitle,
    })

    await expect(describe('session-archived')).resolves.toEqual({ availability: 'archived', title: 'x' })
  })

  it('an archived W with a cached title shows that title', async () => {
    const describe = createLocusSessionDescriber({
      peek: async () => ({ exists: true, titleKnown: true, title: '旧工作' }),
      archivedSessionIds: () => ['session-w'],
      foldTitle,
    })
    const view = await createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: 'oc_A' })], mains: [mainRecord('session-main-1', 'session-w')] }),
      resolvers: { session: describe },
    }).view()
    expect(view.works[0]?.work).toEqual({ sessionId: 'session-w', title: '旧工作', availability: 'archived' })
  })

  it('resolves an archived title by full inspection when the cache cannot answer, and stays archived when unreadable', async () => {
    const inspect = vi.fn(async () => ({ events: titled('Archived') }))
    const describe = createLocusSessionDescriber({
      peek: async () => ({ exists: true, titleKnown: false }),
      inspect,
      archivedSessionIds: () => ['session-archived'],
      foldTitle,
    })
    await expect(describe('session-archived')).resolves.toEqual({ availability: 'archived', title: 'Archived' })
    const unreadable = createLocusSessionDescriber({
      peek: async () => { throw new Error('corrupt') },
      inspect: async () => { throw new Error('gone') },
      archivedSessionIds: () => ['session-archived'],
      foldTitle,
    })
    await expect(unreadable('session-archived')).resolves.toEqual({ availability: 'archived' })
  })


})

describe('spec Requirement "管理面呈现文档入口且不提供新建入口"', () => {
  const ROOT = 'doc:docx:Dx0000000000000000000000001'

  it('spec Scenario "文档与评论嵌套呈现": the doc root carries title/url, comments nest by chatId with their quote', async () => {
    const port = createLocusManagementPort({
      repository: managementRepo({
        rows: [groupRow({ chatId: ROOT }), topicRow({ chatId: ROOT, threadId: '11' }), topicRow({ chatId: ROOT, threadId: '22' })],
      }),
      resolvers: {
        endpoint: endpoint => endpoint.threadId === undefined
          ? { chatName: '技术方案', docUrl: 'https://www.feishu.cn/docx/Dx0000000000000000000000001' }
          : { quote: endpoint.threadId === '11' ? '接口已有' : '为什么' },
      },
    })
    const chat = (await port.view()).works[0]!.chats[0]!
    expect(chat.group.endpoint).toMatchObject({ chatId: ROOT, chatName: '技术方案', docUrl: 'https://www.feishu.cn/docx/Dx0000000000000000000000001' })
    expect(chat.topics.map(item => item.endpoint.quote)).toEqual(['接口已有', '为什么'])
  })

  it('spec Scenario "标题不可得": a failing resolver leaves the facts out instead of failing the view', async () => {
    const port = createLocusManagementPort({
      repository: managementRepo({ rows: [groupRow({ chatId: ROOT })] }),
      resolvers: { endpoint: () => { throw new Error('inspect failed') } },
    })
    expect((await port.view()).works[0]?.chats[0]?.group.endpoint).toEqual({ chatId: ROOT })
  })

  it('spec Scenario "无建立控件": no management action creates a document entry from input', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const wire = await readFile(path.resolve(__dirname, '..', 'src', 'wire.ts'), 'utf8')
    const settings = await readFile(path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'), 'utf8')
    const start = wire.indexOf('export type PetLocusActionRequestV20')
    const actions = wire.slice(start, wire.indexOf('\n\n', start))
    expect(actions).not.toMatch(/doc(Url|Token|Link)|createDoc|addDoc/i)
    // The only input on the panel is the rebind dialog's sessionId field.
    expect(settings).not.toMatch(/placeholder=["'][^"']*(文档链接|docx|token)/i)
  })
})
