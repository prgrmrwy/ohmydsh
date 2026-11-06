import { describe, expect, it } from 'vitest'
import {
  createLocusAccessMutation,
  LOCUS_ACCESS_CHANGE_RECEIPT,
  LOCUS_FULL_ACCESS_DISCLOSURE,
  type LocusAccessLivePort,
  type LocusAccessRepositoryPort,
} from '../src/host/locus/access-mutation.js'
import { LOCUS_WRITE_DISABLED_DIAGNOSTIC } from '../src/host/locus/policy-verification.js'
import type { LocusAccessModeV20, LocusGroupRowV20, LocusRowV20, LocusRowFenceV20 } from '../src/host/locus/contract-v20.js'
import { siblingChildren, type SiblingChildren, type SiblingParent } from './support/sibling-children.js'
import {
  classifyLocusCompositionFailure,
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_SAFE_TOOL_NAMES,
  LocusCompositionError,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'
import { LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET } from '../src/host/locus/preset.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'

const M = 'locus-main-1'

function groupRow(overrides: Partial<LocusGroupRowV20> = {}): LocusGroupRowV20 {
  return {
    endpoint: { chatId: 'oc-a' },
    locusId: 'locus-a',
    sessionId: 'session-a',
    state: 'active',
    accessMode: 'read-only',
    verifiedAt: 5,
    revision: 3,
    createdAt: 1,
    updatedAt: 5,
    locusMainSessionId: M,
    workspaceId: 'ws-1',
    ...overrides,
  } as LocusGroupRowV20
}

function coded(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** The access fence of the frozen v20 port, with a hold seam on the CAS. */
class FakeRepository implements LocusAccessRepositoryPort {
  readonly rows = new Map<string, LocusRowV20>()
  readonly changing = new Set<string>()
  nonTerminal = new Set<string>()
  calls = { acquire: 0, setAccessMode: 0 }
  /** Rows written to `locus_permission_audit`; nothing may add one. */
  readonly auditRows: unknown[] = []
  holdCas: Promise<void> | undefined

  constructor(...rows: LocusRowV20[]) {
    for (const row of rows) this.rows.set(row.locusId, row)
  }

  getLocus(locusId: string): LocusRowV20 | undefined {
    return this.rows.get(locusId)
  }

  getRow(endpoint: { readonly chatId: string; readonly threadId?: string }): LocusRowV20 | undefined {
    return [...this.rows.values()].find(row =>
      row.endpoint.chatId === endpoint.chatId && ('threadId' in row.endpoint ? row.endpoint.threadId : undefined) === endpoint.threadId)
  }

  async acquireAccessChange(locusId: string): Promise<{ readonly locusId: string; readonly revision: number }> {
    this.calls.acquire += 1
    const row = this.rows.get(locusId)
    if (row === undefined) throw coded('LOCUS_NOT_FOUND')
    if (row.state === 'stopped' || row.state === 'invalid') throw coded('INVALID_REQUEST')
    if (this.nonTerminal.has(locusId) || this.changing.has(locusId)) throw coded('LOCUS_BUSY')
    this.changing.add(locusId)
    return { locusId, revision: row.revision }
  }

  releaseAccessChange(locusId: string): void {
    this.changing.delete(locusId)
  }

  isAccessChanging(locusId: string): boolean {
    return this.changing.has(locusId)
  }

  async setAccessMode(fence: LocusRowFenceV20, mode: LocusAccessModeV20, grantedBy: string, now: number): Promise<LocusRowV20> {
    this.calls.setAccessMode += 1
    await this.holdCas
    const row = this.rows.get(fence.expectedLocusId)
    if (row === undefined) throw coded('LOCUS_NOT_FOUND')
    if (row.revision !== fence.expectedRevision) throw coded('LOCUS_CONFLICT')
    const { verifiedAt: _cleared, ...rest } = row
    const next = { ...rest, accessMode: mode, grantedBy, revision: row.revision + 1, updatedAt: now } as LocusRowV20
    this.rows.set(row.locusId, next)
    return next
  }
}

function livePort(world: SiblingChildren, overrides: Partial<LocusAccessLivePort<SiblingParent>> = {}): LocusAccessLivePort<SiblingParent> & {
  turnBusy: Set<string>
  inbox: Set<string>
} {
  const turnBusy = new Set<string>()
  const inbox = new Set<string>()
  return {
    turnBusy,
    inbox,
    isLive: id => world.live.has(id),
    liveParent: id => (id === world.parent.id ? world.parent : undefined),
    isTurnIdle: id => !turnBusy.has(id),
    hasPendingInput: id => inbox.has(id),
    drainChildren: (parent, ids) => world.drainChildren(parent, ids),
    ...overrides,
  }
}

function setup(options: {
  rows?: LocusRowV20[]
  world?: SiblingChildren
  writeEnabled?: boolean
} = {}) {
  const repository = new FakeRepository(...(options.rows ?? [groupRow()]))
  const world = options.world ?? siblingChildren({ parentId: M })
  const live = livePort(world)
  const mutation = createLocusAccessMutation({
    repository,
    live,
    now: () => 100,
    writeEnabled: options.writeEnabled ?? true,
  })
  return { repository, world, live, mutation }
}

async function refusal(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise
  } catch (error) {
    return error as { code?: string; message: string }
  }
  throw new Error('expected a refusal')
}

describe('Locus 访问模式: access-mutation (D8)', () => {
  it('spec Scenario "常驻空闲时变更访问模式"', async () => {
    const { repository, world, mutation } = setup()

    const result = await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })

    expect(world.drainCalls).toEqual([{ parent: world.parent, ids: ['session-a'] }])
    expect(world.disposeCalls).toBe(0)
    expect(world.live.has('session-a')).toBe(false)
    const row = repository.rows.get('locus-a')!
    expect(row).toMatchObject({ accessMode: 'danger-full-access', grantedBy: 'ou-owner', revision: 4 })
    expect(row.verifiedAt).toBeUndefined()
    expect(repository.changing.has('locus-a')).toBe(false)
    expect(result.receipt).toContain(LOCUS_ACCESS_CHANGE_RECEIPT)
    expect(LOCUS_ACCESS_CHANGE_RECEIPT).toBe('已更新，下次唤醒时应用并核验；核验失败将拒绝服务')
  })

  it('spec Scenario "非驻留时只写行" (change half; the wake half is in locus-composition)', async () => {
    const world = siblingChildren({ parentId: M })
    world.live.clear()
    world.resident.clear()
    const { repository, mutation } = setup({ world })

    await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })

    expect(world.drainCalls).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'danger-full-access', revision: 4 })
  })

  it('spec Scenario "释放失败时行不变"', async () => {
    const world = siblingChildren({ parentId: M, mode: 'stale-parent' })
    const { repository, mutation } = setup({ world })

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(error.message).not.toMatch(/仍在运行|still running/)
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 3 })
    expect(repository.changing.has('locus-a')).toBe(false)
    expect(repository.calls.setAccessMode).toBe(0)
  })

  it('spec Scenario "释放后 CAS 失败时下次按旧行冷恢复"', async () => {
    const { repository, world, mutation } = setup()
    // Another writer advances the revision between acquire and the CAS.
    let release!: () => void
    repository.holdCas = new Promise<void>(resolve => { release = resolve })
    const pending = refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    const row = repository.rows.get('locus-a')!
    repository.rows.set('locus-a', { ...row, revision: row.revision + 1 })
    release()

    const error = await pending
    expect(error.code).toBe('LOCUS_CONFLICT')
    expect(world.live.has('session-a')).toBe(false)
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only' })
    expect(repository.changing.has('locus-a')).toBe(false)
  })

  it('spec Scenario "只释放目标子会话"', async () => {
    const sibling = groupRow({ endpoint: { chatId: 'oc-b' }, locusId: 'locus-b', sessionId: 'session-b' })
    const { repository, world, mutation } = setup({ rows: [groupRow(), sibling] })

    await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })

    expect(world.drainCalls).toEqual([{ parent: world.parent, ids: ['session-a'] }])
    expect(world.live.has('session-b')).toBe(true)
    expect(world.resident.has('session-b')).toBe(true)
    expect(repository.rows.get('locus-b')).toEqual(sibling)
  })

  it('spec Scenario "目标不在 resident 时须确认已退出"', async () => {
    // Confirmed gone after a no-op drain: proceed.
    const gone = siblingChildren({ parentId: M, mode: 'no-op' })
    gone.resident.delete('session-a')
    const first = setup({ world: gone })
    first.live.isLive = id => id === 'session-a' && gone.drainCalls.length === 0
    await first.mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })
    expect(gone.drainCalls).toHaveLength(1)
    expect(first.repository.rows.get('locus-a')).toMatchObject({ accessMode: 'danger-full-access', revision: 4 })

    // Still live after a no-op drain: refuse.
    const stuck = siblingChildren({ parentId: M, mode: 'no-op' })
    stuck.resident.delete('session-a')
    const second = setup({ world: stuck })
    const error = await refusal(second.mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))
    expect(error.code).toBe('LOCUS_BUSY')
    expect(second.repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 3 })
    expect(second.repository.calls.setAccessMode).toBe(0)
    expect(second.repository.changing.has('locus-a')).toBe(false)
  })

  it('spec Scenario "parent 已过期时拒绝"', async () => {
    const world = siblingChildren({ parentId: M })
    const { repository, live, mutation } = setup({ world })
    // The resolved parent is a stale object, not the exact live parent.
    live.liveParent = () => ({ id: M })

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 3 })
    expect(repository.changing.has('locus-a')).toBe(false)
    expect(world.live.has('session-b')).toBe(true)
  })

  it('refuses when the exact live parent cannot be resolved for a live child', async () => {
    const { repository, live, world, mutation } = setup()
    live.liveParent = () => undefined

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(world.drainCalls).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ revision: 3 })
  })

  it('spec Scenario "drain 抛错但子会话已不存在"', async () => {
    const world = siblingChildren({ parentId: M, mode: 'reject-after-gone' })
    const { repository, mutation } = setup({ world })

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(error.message).not.toMatch(/仍在运行|still running/)
    expect(world.live.has('session-a')).toBe(false)
    expect(repository.rows.get('locus-a')).toMatchObject({ state: 'active', accessMode: 'read-only', revision: 3 })
    expect(repository.calls.setAccessMode).toBe(0)
  })

  it('spec Scenario "inbox 有待处理输入时拒绝变更"', async () => {
    const { repository, world, live, mutation } = setup()
    live.inbox.add('session-a')

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(world.drainCalls).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 3 })
    expect(repository.changing.has('locus-a')).toBe(false)
  })

  it('spec Scenario "live 不空闲时拒绝变更"', async () => {
    const { repository, world, live, mutation } = setup()
    live.turnBusy.add('session-a')

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(world.drainCalls).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 3 })
    expect(repository.changing.has('locus-a')).toBe(false)
  })

  it('refuses with the port\'s LOCUS_BUSY when the entry has a non-terminal Delivery, before any drain', async () => {
    const { repository, world, mutation } = setup()
    repository.nonTerminal.add('locus-a')

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('LOCUS_BUSY')
    expect(world.drainCalls).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ revision: 3 })
  })

  it('spec Scenario "写开关关闭时拒绝授予"', async () => {
    const { repository, world, mutation } = setup({ writeEnabled: false })

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('INVALID_REQUEST')
    expect(error.message).toBe(LOCUS_WRITE_DISABLED_DIAGNOSTIC)
    expect(repository.calls.acquire).toBe(0)
    expect(world.drainCalls).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 3 })
  })

  it('spec Scenario "写开关关闭时迁移得到的完全访问入口可改回只读"', async () => {
    const { repository, mutation } = setup({ rows: [groupRow({ accessMode: 'danger-full-access' })], writeEnabled: false })

    await mutation.set({ locusId: 'locus-a', mode: 'read-only', actorId: 'ou-owner' })
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 4 })

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))
    expect(error.code).toBe('INVALID_REQUEST')
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'read-only', revision: 4 })
  })

  it('spec Scenario "变更不写审计行"', async () => {
    const { repository, mutation } = setup()

    await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })

    expect(repository.auditRows).toHaveLength(0)
    expect(repository.rows.get('locus-a')).toMatchObject({ grantedBy: 'ou-owner' })
  })

  it.each(['stopped', 'invalid'] as const)('spec Scenario "stopped 与 invalid 的行不受理访问模式变更" (%s)', async state => {
    const row = groupRow(state === 'stopped'
      ? { state, stoppedAt: 4 }
      : { state, invalidReason: 'child lost' })
    const { repository, world, mutation } = setup({ rows: [row] })

    const error = await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))

    expect(error.code).toBe('INVALID_REQUEST')
    expect(repository.rows.get('locus-a')).toEqual(row)
    expect(repository.calls.acquire).toBe(0)
    expect(world.drainCalls).toHaveLength(0)
    expect(repository.changing.has('locus-a')).toBe(false)
  })

  it('refuses an unknown entry with LOCUS_NOT_FOUND', async () => {
    const { mutation } = setup()
    expect((await refusal(mutation.set({ locusId: 'locus-x', mode: 'read-only', actorId: 'ou-owner' }))).code).toBe('LOCUS_NOT_FOUND')
  })

  it('spec Scenario "授予完全访问"', async () => {
    const { repository, mutation } = setup()

    const result = await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })

    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'danger-full-access', grantedBy: 'ou-owner' })
    expect(repository.rows.get('locus-a')!.verifiedAt).toBeUndefined()
    expect(result.receipt).toContain(LOCUS_ACCESS_CHANGE_RECEIPT)
    expect(result.receipt).toContain(LOCUS_FULL_ACCESS_DISCLOSURE)
    expect(LOCUS_FULL_ACCESS_DISCLOSURE).toMatch(/整机无边界/)
    expect(LOCUS_FULL_ACCESS_DISCLOSURE).toMatch(/入口成员共享/)
    expect(LOCUS_FULL_ACCESS_DISCLOSURE).toMatch(/飞书凭据/)
  })

  it('a read-only receipt carries no full-access disclosure', async () => {
    const { mutation } = setup({ rows: [groupRow({ accessMode: 'danger-full-access' })] })
    const result = await mutation.set({ locusId: 'locus-a', mode: 'read-only', actorId: 'ou-owner' })
    expect(result.receipt).toBe(LOCUS_ACCESS_CHANGE_RECEIPT)
  })

  it('spec Scenario "授予不依赖上下文确认"', async () => {
    // The row carries no context-anchor fact at all, and nothing is asked for.
    const { repository, mutation } = setup()
    await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })
    expect(repository.rows.get('locus-a')).toMatchObject({ accessMode: 'danger-full-access' })
    expect(Object.keys(repository.rows.get('locus-a')!)).not.toContain('contextAnchor')
  })

  it('spec Scenario "拒绝必须给出原因而非重试提示"', async () => {
    const messages: string[] = []
    // write switch off
    messages.push((await refusal(setup({ writeEnabled: false }).mutation
      .set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))).message)
    // busy
    const busy = setup()
    busy.live.turnBusy.add('session-a')
    messages.push((await refusal(busy.mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))).message)
    // release failure
    messages.push((await refusal(setup({ world: siblingChildren({ parentId: M, mode: 'stale-parent' }) }).mutation
      .set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))).message)
    // persistence failure
    const conflict = setup()
    conflict.repository.setAccessMode = async () => { throw coded('LOCUS_CONFLICT') }
    messages.push((await refusal(conflict.mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))).message)

    expect(new Set(messages).size).toBe(4)
    for (const message of messages) {
      expect(message).not.toMatch(/稍后重试|请重试|try again/i)
      expect(message.trim()).not.toBe('')
    }
  })
})

// ---------------------------------------------------------------------------
// The assembly half of D8: the next wake applies the row's value and verifies it.
// ---------------------------------------------------------------------------

function assembly(options: { mode: LocusAccessModeV20; resolved?: LocusAccessModeV20; writeEnabled?: boolean }) {
  const applied: LocusAccessModeV20[] = []
  let visible: readonly string[] = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS, 'bash', 'skill']
  const ports: LocusCompositionPorts = {
    lookup: {
      find: () => ({
        locusMainSessionId: M, sessionId: 'session-a', locusId: 'locus-a', revision: 4,
        accessMode: options.mode, endpoint: { chatId: 'oc-a' },
      }),
    },
    parentPreset: () => LOCUS_BASE_PRESET,
    childPreset: () => LOCUS_CHILD_PRESET,
    writeEnabled: options.writeEnabled ?? true,
    policy: {
      apply: (_id, mode) => { applied.push(mode) },
      resolve: () => options.resolved ?? applied.at(-1),
    },
    surface: {
      install: () => {},
      installOutboundGuard: () => {},
      applyAccessMode: (_agent, mode) => {
        if (mode === 'read-only') visible = visible.filter(name => name !== 'bash' && name !== 'skill')
      },
      visibleTools: () => visible,
    },
  }
  return { ports, applied, agent: { id: 'session-a', scope: { get: () => ({}) } } }
}

describe('Locus 访问模式: the next assembly (D8 verification)', () => {
  it('spec Scenario "非驻留时只写行" (wake half): the next assembly serves danger-full-access and may stamp verifiedAt', () => {
    const { ports, applied, agent } = assembly({ mode: 'danger-full-access' })
    expect(composeLocusChild(agent, ports)).toMatchObject({ composed: true, accessMode: 'danger-full-access' })
    expect(applied).toEqual(['danger-full-access'])
  })

  it('spec Scenario "来源会话可写时新建入口仍为只读"', () => {
    // The work session's own write ability is not an input at all: the child
    // applies its row's read-only value and is proven read-only by readback.
    const { ports, applied, agent } = assembly({ mode: 'read-only' })
    expect(composeLocusChild(agent, ports)).toMatchObject({ composed: true, accessMode: 'read-only' })
    expect(applied).toEqual(['read-only'])
    const { ports: widened, agent: same } = assembly({ mode: 'read-only', resolved: 'danger-full-access' })
    expect(() => composeLocusChild(same, widened)).toThrow(LocusCompositionError)
  })

  it('spec Scenario "下次组装回读不符时拒绝发布"', () => {
    const { ports, applied, agent } = assembly({ mode: 'danger-full-access', resolved: 'read-only' })
    let error: unknown
    try { composeLocusChild(agent, ports) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(LocusCompositionError)
    expect(classifyLocusCompositionFailure(error)).toBe('B')
    // Host policy, not a prompt matter; and no other mode was tried.
    expect((error as Error).message).toMatch(/宿主策略/)
    expect(applied).toEqual(['danger-full-access'])
  })

  it('spec Scenario "写开关关闭时既有完全访问入口拒绝服务且行不改写"', () => {
    const { ports, applied, agent } = assembly({ mode: 'danger-full-access', writeEnabled: false })
    let error: unknown
    try { composeLocusChild(agent, ports) } catch (caught) { error = caught }
    expect((error as LocusCompositionError).reason).toBe('write-disabled')
    expect((error as Error).message).toBe(LOCUS_WRITE_DISABLED_DIAGNOSTIC)
    expect(classifyLocusCompositionFailure(error)).toBe('B')
    // Nothing served as read-only: no sandbox was applied at all.
    expect(applied).toEqual([])
    expect(LOCUS_WRITE_DISABLED_DIAGNOSTIC).not.toMatch(/按只读服务/)
  })

  it('spec Scenario "shell 档的出站保证如实表述"', () => {
    expect(LOCUS_FULL_ACCESS_DISCLOSURE).toMatch(/仅防误操作|只防误操作/)
    expect(LOCUS_FULL_ACCESS_DISCLOSURE).toMatch(/不是安全边界/)
    expect(LOCUS_FULL_ACCESS_DISCLOSURE).not.toMatch(/只能经\s*finish|只能通过\s*finish|只能经 pet_locus_finish/)
  })
})

// ---------------------------------------------------------------------------
// Against owner A's real v20 repository (persistence-v20.ts)
// ---------------------------------------------------------------------------

function memoryDomain(): LocusDomain {
  const tables = new Map<string, Map<string, unknown>>()
  const table = (name: string) => {
    let map = tables.get(name)
    if (map === undefined) {
      map = new Map()
      tables.set(name, map)
    }
    return {
      get: (key: string) => map!.get(key),
      entries: () => map!.entries(),
      keys: () => map!.keys(),
      get size() { return map!.size },
      put: async (key: string, value: unknown) => { map!.set(key, value) },
      delete: async (key: string) => map!.delete(key),
    }
  }
  return {
    table,
    supportsTransaction: true,
    transaction: async (body: (tx: { put(t: string, k: string, v: unknown): void; delete(t: string, k: string): void }) => void) => {
      body({ put: (t, k, v) => { table(t).put(k, v) }, delete: (t, k) => { table(t).delete(k) } })
    },
  } as unknown as LocusDomain
}

describe('access-mutation over the real v20 repository', () => {
  it('changes a resident idle entry end to end and leaves the set empty', async () => {
    const domain = memoryDomain()
    await domain.table('loci').put('oc-a', groupRow())
    const repository = new LocusRepositoryV20(domain, { now: () => 50 })
    const world = siblingChildren({ parentId: M })
    const mutation = createLocusAccessMutation({ repository, live: livePort(world), now: () => 100, writeEnabled: true })

    const result = await mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' })

    expect(result.row).toMatchObject({ accessMode: 'danger-full-access', grantedBy: 'ou-owner', revision: 4 })
    expect(result.row.verifiedAt).toBeUndefined()
    expect(repository.isAccessChanging('locus-a')).toBe(false)
    expect(world.drainCalls).toEqual([{ parent: world.parent, ids: ['session-a'] }])

    // The assembly stamp keeps the revision (lead-approved contract addition).
    const verified = await repository.recordAccessVerified({ expectedLocusId: 'locus-a', expectedRevision: 4 }, 'danger-full-access', 120)
    expect(verified).toMatchObject({ verifiedAt: 120, revision: 4 })
  })

  it('refuses a stopped row with INVALID_REQUEST before acquiring', async () => {
    const domain = memoryDomain()
    await domain.table('loci').put('oc-a', groupRow({ state: 'stopped', stoppedAt: 4 }))
    const repository = new LocusRepositoryV20(domain, { now: () => 50 })
    const mutation = createLocusAccessMutation({ repository, live: livePort(siblingChildren({ parentId: M })), writeEnabled: true })
    expect((await refusal(mutation.set({ locusId: 'locus-a', mode: 'danger-full-access', actorId: 'ou-owner' }))).code).toBe('INVALID_REQUEST')
    expect(repository.isAccessChanging('locus-a')).toBe(false)
  })
})
