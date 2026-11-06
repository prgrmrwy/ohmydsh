/**
 * Whole-W topology fixture (owner B): a recording in-memory implementation of
 * `LocusRepositoryPortV20` plus a fake Host, so controller tests can assert
 * call ORDER, what was created, and what was compensated.
 *
 * The fake repository enforces the contract's refusal vocabulary for the
 * methods the controller calls; it is not a persistence test double for owner
 * A's rows. Persistence behaviour is covered by owner A's tests.
 */
import type { PetLocusMainRecord } from '../../src/host/spec.js'
import type {
  LocusAccessModeV20,
  LocusCommitProvisioningInputV20,
  LocusGroupRowV20,
  LocusMigrateWholeWInputV20,
  LocusProvisioningBeginV20,
  LocusRebindChatInputV20,
  LocusRepositoryPortV20,
  LocusResetChatResultV20,
  LocusRowFenceV20,
  LocusRowV20,
  LocusTopicRowV20,
} from '../../src/host/locus/contract-v20.js'
import type { LocusControllerDeps, LocusParentSession } from '../../src/host/locus/controller.js'
import { LocusRepositoryV20 } from '../../src/host/locus/persistence-v20.js'
import { endpointKeyV20 } from '../../src/host/locus/locus-set-v20.js'
import { openPetHarness } from '../harness.js'
import { enableAtomicTransactions } from './three-tier.js'

export type TopologyBackend = 'fake' | 'real'
const opened: Topology[] = []
/** Close every real repository opened by `Topology.open` (call from afterEach). */
export async function closeAllTopologies(): Promise<void> {
  for (const t of opened.splice(0)) await t.close()
}

export class Refusal extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
  }
}

export const keyOf = (e: { chatId: string; threadId?: string }): string =>
  e.threadId === undefined ? e.chatId : `${e.chatId}\u0000${e.threadId}`

export type Call = string

export class FakeRepository implements Pick<LocusRepositoryPortV20, never> {
  readonly rows = new Map<string, LocusRowV20>()
  readonly mains = new Map<string, PetLocusMainRecord>()
  calls: Call[] = []
  readonly operations = new Map<string, { kind: string; state: 'begun' | 'committed' | 'completed' | 'failed' }>()
  /** chatIds that currently hold a current Delivery. */
  readonly currentChats = new Set<string>()
  failCommit = false

  // ---- reads ---------------------------------------------------------------
  getRow(e: { chatId: string; threadId?: string }): LocusRowV20 | undefined { return this.rows.get(keyOf(e)) }
  getLocus(id: string) { return [...this.rows.values()].find(r => r.locusId === id) }
  listRowsOfChat(chatId: string) {
    const group = this.rows.get(chatId)
    const topics = [...this.rows.values()].filter(r => r.endpoint.chatId === chatId && 'threadId' in r.endpoint)
    return group === undefined ? [] : [group, ...topics]
  }
  listGroupRowsOfMain(m: string) {
    return [...this.rows.values()].filter((r): r is LocusGroupRowV20 => !('threadId' in r.endpoint) && 'locusMainSessionId' in r && r.locusMainSessionId === m)
  }
  findBySessionId() { return undefined }
  findDefaultQa(w: string) {
    const main = this.findActiveMain(w)
    return main === undefined ? undefined : this.listGroupRowsOfMain(main.locusMainSessionId).find(r => r.defaultQa === true)
  }
  findMain(m: string) { return this.mains.get(m) }
  findActiveMain(w: string) { return [...this.mains.values()].find(m => m.workSessionId === w && m.status === 'active') }
  listPairingsOfWork(w: string) { return [...this.mains.values()].filter(m => m.workSessionId === w) }
  hasCurrentDeliveryInChat(chatId: string) { return this.currentChats.has(chatId) }
  hasNonTerminalDelivery() { return false }
  hasFirstDeliveryRecoveryDebt() { return false }

  // ---- provisioning ----------------------------------------------------------
  async beginProvisioning(input: LocusProvisioningBeginV20) {
    this.calls.push(`begin:${input.kind}`)
    this.operations.set(input.provisioningId, { kind: input.kind, state: 'begun' })
  }
  async recordProvisioningResource() { this.calls.push('record') }
  async completeProvisioning(id: string) { this.calls.push('complete'); this.operations.get(id)!.state = 'completed' }
  async failProvisioning(id: string) { this.calls.push('fail'); this.operations.get(id)!.state = 'failed' }

  listRows(): LocusRowV20[] { return [...this.rows.values()] }
  listMains(): PetLocusMainRecord[] { return [...this.mains.values()] }

  async commitProvisioning(input: LocusCommitProvisioningInputV20) {
    this.calls.push(`commit:${input.rows.length}`)
    if (this.failCommit) throw new Error('commit failed')
    const [group, topic] = input.rows
    if (topic !== undefined && topic.endpoint.chatId !== group.endpoint.chatId) throw new Refusal('INVALID_REQUEST')
    for (const row of input.rows) {
      if (this.rows.has(keyOf(row.endpoint))) throw new Refusal('LOCUS_CONFLICT')
    }
    if (input.main !== undefined) this.mains.set(input.main.locusMainSessionId, input.main)
    for (const row of input.rows) this.rows.set(keyOf(row.endpoint), row)
    this.operations.get(input.provisioningId)!.state = 'committed'
    return input.rows
  }
  async addTopicRow(row: LocusTopicRowV20) {
    this.calls.push('addTopicRow')
    if (!this.rows.has(row.endpoint.chatId)) throw new Refusal('LOCUS_NOT_FOUND')
    if (this.rows.has(keyOf(row.endpoint))) throw new Refusal('LOCUS_CONFLICT')
    this.rows.set(keyOf(row.endpoint), row)
    return row
  }

  // ---- reset / rebind / migrate ---------------------------------------------------
  write(): never { throw new Error('not used by the controller') }

  private reset(chatId: string, toM: string, opts: { workspaceId?: string; reboundFrom?: string; clearDefaultQa?: boolean }, reserve: () => string, now: number, revisions?: Readonly<Record<string, number>>): LocusResetChatResultV20 {
    if (this.currentChats.has(chatId)) throw new Refusal('LOCUS_BUSY')
    const out: LocusRowV20[] = []
    for (const row of this.listRowsOfChat(chatId)) {
      const expected = revisions?.[keyOf(row.endpoint)]
      if (expected !== undefined && expected !== row.revision) throw new Refusal('LOCUS_CONFLICT')
      const base = { ...row, accessMode: 'read-only' as const, revision: row.revision + 1, updatedAt: now }
      let next: LocusRowV20 = row.state === 'stopped' ? base : { ...base, sessionId: reserve(), state: 'not-created' }
      if (!('threadId' in row.endpoint)) {
        const { defaultQa, ...rest } = next as LocusGroupRowV20
        next = {
          ...rest,
          locusMainSessionId: toM,
          ...(opts.workspaceId === undefined ? {} : { workspaceId: opts.workspaceId }),
          ...(opts.reboundFrom === undefined ? {} : { reboundFrom: opts.reboundFrom }),
          ...(defaultQa === true && opts.clearDefaultQa !== true ? { defaultQa } : {}),
        } as LocusGroupRowV20
      }
      this.rows.set(keyOf(row.endpoint), next)
      out.push(next)
    }
    return { rows: out, retargetedDeliveryIds: [] }
  }
  async rebindChat(input: LocusRebindChatInputV20) {
    this.calls.push('rebindChat')
    const group = this.rows.get(input.chatId)
    if (group === undefined) throw new Refusal('LOCUS_NOT_FOUND')
    if (group.locusId !== input.expectedLocusId || group.revision !== input.expectedRevision) throw new Refusal('LOCUS_CONFLICT')
    if (input.main !== undefined) this.mains.set(input.main.locusMainSessionId, input.main)
    return this.reset(input.chatId, input.toM, { workspaceId: input.workspaceId, reboundFrom: input.reboundFrom, clearDefaultQa: true }, input.reserveChildSessionId, input.now)
  }
  async commitWholeWMigration(input: LocusMigrateWholeWInputV20) {
    this.calls.push('commitWholeWMigration')
    for (const chat of input.chats) if (this.currentChats.has(chat.chatId)) throw new Refusal('LOCUS_BUSY')
    if (input.retireMain !== undefined) {
      const old = this.mains.get(input.retireMain.locusMainSessionId)!
      this.mains.set(old.locusMainSessionId, { ...old, status: 'retired' })
    }
    this.mains.set(input.newMain.locusMainSessionId, input.newMain)
    return input.chats.map(c => this.reset(c.chatId, input.newMain.locusMainSessionId, {}, input.reserveChildSessionId, input.now, c.expectedRevisions))
  }

  // ---- single-row lifecycle ---------------------------------------------------
  private cas(f: LocusRowFenceV20): LocusRowV20 {
    const row = this.getLocus(f.expectedLocusId)
    if (row === undefined) throw new Refusal('LOCUS_NOT_FOUND')
    if (row.revision !== f.expectedRevision) throw new Refusal('LOCUS_CONFLICT')
    return row
  }
  private put(row: LocusRowV20): LocusRowV20 { this.rows.set(keyOf(row.endpoint), row); return row }
  async stopRow(f: LocusRowFenceV20, now: number) {
    this.calls.push('stopRow')
    const row = this.cas(f)
    if (this.currentChats.has(row.endpoint.chatId)) throw new Refusal('LOCUS_BUSY')
    return this.put({ ...row, state: 'stopped', stoppedAt: now, revision: row.revision + 1, updatedAt: now })
  }
  async reenableRow(f: LocusRowFenceV20, now: number, reserve: () => string) {
    this.calls.push('reenableRow')
    const row = this.cas(f)
    const { stoppedAt: _s, ...rest } = row
    return this.put({ ...rest, state: 'not-created', sessionId: reserve(), accessMode: 'read-only' as LocusAccessModeV20, revision: row.revision + 1, updatedAt: now } as LocusRowV20)
  }
  async markInvalid(f: LocusRowFenceV20, reason: string, now: number) {
    const row = this.cas(f)
    return this.put({ ...row, state: 'invalid', invalidReason: reason, revision: row.revision + 1, updatedAt: now })
  }
  async rebuildRowInPlace(f: LocusRowFenceV20, now: number, reserve: () => string) {
    this.calls.push('rebuildRowInPlace')
    const row = this.cas(f)
    const { invalidReason: _i, ...rest } = row
    return this.put({ ...rest, state: 'not-created', sessionId: reserve(), accessMode: 'read-only' as LocusAccessModeV20, revision: row.revision + 1, updatedAt: now } as LocusRowV20)
  }
  async acquireAccessChange(): Promise<never> { throw new Error('unused') }
  releaseAccessChange(): void {}
  isAccessChanging() { return false }
  async setAccessMode(): Promise<never> { throw new Error('unused') }
  lookupChildForAgentCreated(): never { throw new Error('unused') }
  async rotateReservation(): Promise<never> { throw new Error('unused') }
}

export interface FakeSession extends LocusParentSession { readonly title: string }

export interface TopologyOptions {
  readonly archived?: readonly string[]
  readonly sessions?: readonly FakeSession[]
  /** M session ids the Host reports as unusable (archived/missing). */
  readonly unusableMains?: readonly string[]
  readonly defaultWorkspace?: string
}

export class Topology {
  /** Fake recording repository or the real v20 repository over temp SQLite: the same assertions run on both. */
  repository!: FakeRepository
  readonly calls: Call[] = []
  readonly created: { kind: 'work' | 'locus-main'; id: string }[] = []
  readonly released: string[] = []
  readonly spacesEstablished: string[] = []
  readonly spacesReleased: string[] = []
  readonly resolved: string[] = []
  readonly archived = new Set<string>()
  readonly unusableMains = new Set<string>()
  private readonly sessions = new Map<string, FakeSession>()
  failSpace = false
  /** Make commitProvisioning throw before anything is written (both backends). */
  get failCommit(): boolean { return this.failCommitFlag }
  set failCommit(value: boolean) { this.failCommitFlag = value; if (!this.isReal) this.fakeRepo().failCommit = value }
  private failCommitFlag = false
  private seq = 0
  private harness: Awaited<ReturnType<typeof openPetHarness>> | undefined
  private readonly provisioningIds: string[] = []
  private currentSeq = 0

  static async open(options: TopologyOptions = {}, backend: TopologyBackend = 'fake'): Promise<Topology> {
    const t = new Topology(options)
    if (backend === 'real') {
      t.harness = await openPetHarness()
      enableAtomicTransactions(t.harness)
      const repo = new LocusRepositoryV20(t.harness.domain as never, { now: () => 1000 })
      t.wrapReal(repo)
      t.repository = repo as unknown as FakeRepository
    }
    opened.push(t)
    return t
  }

  private fakeRepo(): FakeRepository { return this.repository }
  private get isReal(): boolean { return this.harness !== undefined }
  async close(): Promise<void> { await this.harness?.close(); this.harness = undefined }

  /** Record the calls the assertions look at, and honour `failCommit`. */
  private wrapReal(repo: LocusRepositoryV20): void {
    const r = repo as unknown as Record<string, (...args: any[]) => any>
    const wrap = (name: string, before: (args: any[]) => void) => {
      const original = r[name]!.bind(repo)
      r[name] = (...args: any[]) => { before(args); return original(...args) }
    }
    wrap('beginProvisioning', ([input]) => { this.calls.push(`begin:${input.kind}`); this.provisioningIds.push(input.provisioningId) })
    wrap('commitProvisioning', ([input]) => {
      if (this.failCommitFlag) throw new Error('commit failed')
      this.calls.push(`commit:${input.rows.length}`)
    })
    wrap('addTopicRow', () => { this.calls.push('addTopicRow') })
    wrap('rebindChat', () => { this.calls.push('rebindChat') })
    wrap('commitWholeWMigration', () => { this.calls.push('commitWholeWMigration') })
  }

  // ---- uniform state helpers (same answers on both backends) ----
  rows(): LocusRowV20[] { return this.isReal ? [...(this.repository as unknown as LocusRepositoryV20).listRows()] : [...this.fakeRepo().rows.values()] }
  rowCount(): number { return this.rows().length }
  mainIds(): string[] { return this.isReal ? (this.repository as unknown as LocusRepositoryV20).listMains().map(m => m.locusMainSessionId) : [...this.fakeRepo().mains.keys()] }
  mainCount(): number { return this.mainIds().length }
  opStates(): string[] {
    if (!this.isReal) return [...this.fakeRepo().operations.values()].map(o => o.state)
    return this.provisioningIds.map(id => (this.repository as unknown as LocusRepositoryV20).getOperation(id)?.phase ?? 'missing')
  }
  /** Give the chat a `current` Delivery (queued / running / finishing count the same). */
  async setCurrent(chatId: string): Promise<void> {
    if (!this.isReal) { this.fakeRepo().currentChats.add(chatId); return }
    const repo = this.repository as unknown as LocusRepositoryV20
    const group = repo.getRow({ chatId })
    if (group === undefined) throw new Error(`no group row for ${chatId}`)
    const correlation = { endpoint: group.endpoint, locusId: group.locusId, sessionId: group.sessionId }
    const messageId = `current-${++this.currentSeq}`
    await repo.acceptDelivery({ ...correlation, messageId, senderOpenId: 'ou_owner', text: 'x', acceptedAt: 1 } as never)
    const claimed = await repo.claimCurrentDelivery({ ...correlation, now: 2 })
    if (!claimed.changed) throw new Error('could not make the delivery current')
  }

  constructor(private readonly options: TopologyOptions = {}) {
    for (const id of options.archived ?? []) this.archived.add(id)
    for (const id of options.unusableMains ?? []) this.unusableMains.add(id)
    this.addSession({ id: 'W1', workspaceId: 'proj-1', title: 'W1' })
    this.addSession({ id: 'W2', workspaceId: 'proj-2', title: 'W2' })
    for (const s of options.sessions ?? []) this.addSession(s)
    // Default backend: the recording fake (synchronous seeds). `Topology.open(…, 'real')` swaps it.
    this.repository = new FakeRepository()
    this.repository.calls = this.calls
  }

  addSession(s: FakeSession) { this.sessions.set(s.id, s) }

  readonly deps = (): LocusControllerDeps => ({
    repository: this.repository as unknown as LocusControllerDeps['repository'],
    dsh: {
      locusMainWorkspaceId: 'pet-ws',
      resolveSession: async id => {
        this.resolved.push(id)
        this.calls.push(`resolve:${id}`)
        const s = this.sessions.get(id)
        if (s === undefined) return undefined
        if (this.archived.has(id)) return { ...s, state: 'archived' }
        if (this.unusableMains.has(id)) return { ...s, state: 'archived' }
        return s
      },
      resolveDefaultWorkspace: async () => ({ id: this.options.defaultWorkspace ?? 'default-ws' }),
      createMainSession: async input => {
        const id = `auto-W${++this.seq}`
        this.created.push({ kind: 'work', id })
        this.calls.push('createAutoWork')
        this.addSession({ id, workspaceId: input.workspaceId, title: input.label })
        return { id, workspaceId: input.workspaceId, title: input.label, rollback: async () => { this.released.push(id) } }
      },
      createLocusMainSession: async input => {
        const id = `M${++this.seq}`
        this.created.push({ kind: 'locus-main', id })
        this.calls.push('createLocusMain')
        this.addSession({ id, workspaceId: 'pet-ws', title: input.label, agentPreset: 'locus-base' })
        return { id, workspaceId: 'pet-ws', title: input.label, rollback: async () => { this.released.push(id) } }
      },
    },
    establishSpace: async input => {
      this.calls.push('establishSpace')
      this.spacesEstablished.push(input.locusMainSessionId)
      if (this.failSpace) return { ok: false, reason: 'establish-failed' }
      return { ok: true, spaceId: `space-${input.locusMainSessionId}` }
    },
    releaseSpace: async input => { this.spacesReleased.push(input.locusMainSessionId) },
    lark: {
      createGroup: async () => ({ chatId: `oc_qa${++this.seq}`, chatName: 'qa' }),
      sendControlMessage: async () => {},
    },
    reserveChildSessionId: () => `session-r${++this.seq}`,
    now: () => 1000,
    id: () => String(++this.seq),
  })

  /** Fake: write now and return the plain value (sync callers). Real: return the write's promise. */
  private seeded<T>(value: T, real: () => Promise<void>, fake: () => unknown): Promise<T> {
    if (!this.isReal) { fake(); return value as unknown as Promise<T> }
    return real().then(() => value)
  }

  private table(name: string): { put(key: string, value: unknown): Promise<void> } {
    return (this.harness!.domain as never as { table(n: string): { put(key: string, value: unknown): Promise<void> } }).table(name)
  }

  /** Seed a W's pairing as a usable active M. */
  seedMain(workSessionId: string, m: string, status: 'active' | 'retired' = 'active', generation = 1): Promise<PetLocusMainRecord> {
    const record: PetLocusMainRecord = {
      locusMainSessionId: m, workSessionId, generation, status, spaceId: `space-${m}`,
      workspaceId: 'pet-ws', createdAt: 1, updatedAt: 1,
    }
    this.addSession({ id: m, workspaceId: 'pet-ws', title: m, agentPreset: 'locus-base' })
    return this.seeded(record, () => this.table('locus_mains').put(m, record), () => this.fakeRepo().mains.set(m, record))
  }

  seedGroup(chatId: string, m: string, workspaceId = 'proj-1', extra: Partial<LocusGroupRowV20> = {}): Promise<LocusGroupRowV20> {
    const row: LocusGroupRowV20 = {
      endpoint: { chatId }, locusId: `locus-${chatId}`, sessionId: `session-seed-${chatId}`,
      state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1,
      locusMainSessionId: m, workspaceId, ...extra,
    }
    return this.seeded(row, () => this.table('loci').put(chatId, row), () => this.fakeRepo().rows.set(chatId, row))
  }

  seedTopic(chatId: string, threadId: string, extra: Partial<LocusTopicRowV20> = {}): Promise<LocusTopicRowV20> {
    const row: LocusTopicRowV20 = {
      endpoint: { chatId, threadId }, locusId: `locus-${chatId}-${threadId}`, sessionId: `session-seed-${chatId}-${threadId}`,
      state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1, ...extra,
    }
    return this.seeded(row, () => this.table('loci').put(endpointKeyV20(row.endpoint), row), () => this.fakeRepo().rows.set(keyOf(row.endpoint), row))
  }
}
