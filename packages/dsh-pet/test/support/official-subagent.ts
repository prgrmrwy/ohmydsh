/**
 * Stand-ins for the OFFICIAL continuable-subagent runtime and `sessionQuery`
 * (DSH 0.2.0-rc.2, unpatched), shaped after what the rc.2 probe observed
 * (`openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md`):
 *
 * - `startContinuable` emits `agent/created` (source `startup`) BEFORE the first
 *   prompt is claimed, and returns only AFTER that first claim;
 * - a listener that throws makes creation fail and the first prompt never runs;
 * - a child that is not resident is cold-resumed by `queuePrompt`/`sendMessage`,
 *   which emits `agent/created` with source `resume`; a throwing listener fails
 *   the resume and the turn does not run;
 * - the default settlement notice goes to the child's parent and nowhere else;
 * - the active-child limit rejects with `ACTIVATION_LIMIT_REACHED`.
 *
 * Nothing here is a Pet seam: it is the runtime Pet must work with, so a test
 * built on it fails when Pet leans on a capability the official runtime lacks.
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'

export class FakeSubagentError extends Error {
  override readonly name = 'SubagentError'
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

export interface FakeLiveAgent {
  readonly id: string
  readonly ctx: { readonly agentId: string }
  readonly parentId?: string
  /** Notices, prompts and agent messages that reached this agent, in order. */
  readonly inbox: { readonly kind: string; readonly from?: string; readonly text?: string }[]
  /** Set while a turn is open on this agent. */
  turnOpen: boolean
}

export type FakeCreatedSource = 'startup' | 'resume'

export interface FakeAgentCreated {
  readonly agent: FakeLiveAgent
  readonly source: FakeCreatedSource
}

export interface FakeStartSpec {
  readonly provider: string
  readonly label: string
  readonly childId?: string
  readonly request: {
    readonly prompt: readonly { readonly type: string; readonly text?: string }[]
    readonly parent: { readonly id: string }
    readonly toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
    readonly [key: string]: unknown
  }
  readonly signal: AbortSignal
  readonly [key: string]: unknown
}

export interface FakeRuntimeOptions {
  /** Maximum simultaneously resident children, mirroring the official active limit. */
  readonly activeLimit?: number
  /** Whether the `spawn` provider declares `inheritsParentContext: false` (it does). */
  readonly spawnIndependent?: boolean
  /** Official submitMaterialized checks this AFTER materialization, BEFORE inbox submission. */
  readonly imageInput?: boolean
}

/** Ordered milestones, so a test can assert what happened before what. */
export type FakeMilestone =
  | `created:${string}:${FakeCreatedSource}`
  | `claimed:${string}`
  | `returned:${string}`
  | `settled:${string}`

export class FakeOfficialRuntime {
  readonly agents = new Map<string, FakeLiveAgent>()
  /** Official creation rejects a reused id even after failed creation disposed its live Agent. */
  readonly persisted = new Set<string>()
  /** Children that exist durably but are not resident (released after idling). */
  readonly released = new Set<string>()
  readonly milestones: FakeMilestone[] = []
  readonly startCalls: FakeStartSpec[] = []
  readonly queueCalls: { readonly parent: string; readonly childId: string; readonly text: string }[] = []
  activeLimit: number
  private readonly spawnIndependent: boolean
  private readonly imageInput: boolean
  private nextMessage = 1
  private nextChild = 1

  /** Serial `agent/created` listeners; a throw or rejection fails creation/resume. */
  readonly agentCreatedListeners: ((event: FakeAgentCreated) => unknown | Promise<unknown>)[] = []
  /** Runs when a turn claims a prompt, before `startContinuable` returns. */
  onClaim: (event: { readonly childId: string; readonly messageId: string }) => unknown | Promise<unknown> = () => undefined
  /** Lets a test make creation fail AFTER the `agent/created` listeners succeeded. */
  failAfterCreated: Error | undefined

  constructor(options: FakeRuntimeOptions = {}) {
    this.activeLimit = options.activeLimit ?? Number.POSITIVE_INFINITY
    this.spawnIndependent = options.spawnIndependent ?? true
    this.imageInput = options.imageInput ?? true
  }

  /** A resident parent the way the Host publishes it. */
  addParent(id: string): FakeLiveAgent {
    const agent: FakeLiveAgent = { id, ctx: { agentId: id }, inbox: [], turnOpen: false }
    this.agents.set(id, agent)
    return agent
  }

  get activeChildren(): number {
    return [...this.agents.values()].filter(agent => agent.parentId !== undefined).length
  }

  getProvider(name: string): { readonly inheritsParentContext?: boolean } | undefined {
    if (name === 'spawn') return { inheritsParentContext: !this.spawnIndependent }
    if (name === 'fork') return { inheritsParentContext: true }
    return undefined
  }

  private async emitCreated(event: FakeAgentCreated): Promise<void> {
    for (const listener of this.agentCreatedListeners) await listener(event)
  }

  private assertCapacity(): void {
    if (this.activeChildren >= this.activeLimit) {
      throw new FakeSubagentError(
        `subagent limit reached (active child limit: ${String(this.activeLimit)})`,
        'ACTIVATION_LIMIT_REACHED',
      )
    }
  }

  async startContinuable(spec: FakeStartSpec): Promise<{ childId: ReturnType<typeof SessionId>; messageId: ReturnType<typeof MessageId> }> {
    this.startCalls.push(spec)
    const parent = this.agents.get(spec.request.parent.id)
    if (parent === undefined || parent !== spec.request.parent as unknown) {
      throw new FakeSubagentError('start requires the exact live parent agent', 'UNAUTHORIZED')
    }
    this.assertCapacity()
    const childId = spec.childId ?? `fake-child-${String(this.nextChild++)}`
    if (this.agents.has(childId) || this.released.has(childId) || this.persisted.has(childId)) {
      throw new FakeSubagentError(`subagent "${childId}" already exists`, 'DUPLICATE_CHILD')
    }
    const child: FakeLiveAgent = { id: childId, ctx: { agentId: childId }, parentId: parent.id, inbox: [], turnOpen: false }
    this.agents.set(childId, child)
    this.persisted.add(childId)
    try {
      this.milestones.push(`created:${childId}:startup`)
      await this.emitCreated({ agent: child, source: 'startup' })
      if (this.failAfterCreated !== undefined) throw this.failAfterCreated
      // rc.2 submitMaterialized/assertImageCapable: the failed Session remains
      // persisted, but no prompt is submitted and no business turn can run.
      if (!this.imageInput && spec.request.prompt.some(block => block.type === 'image')) {
        throw new FakeSubagentError('Model "text-only" does not support image input.', 'MODEL_DOES_NOT_SUPPORT_IMAGES')
      }
      const messageId = `message-${String(this.nextMessage++)}`
      child.inbox.push({ kind: 'prompt', text: spec.request.prompt.map(block => block.text ?? '').join('') })
      child.turnOpen = true
      this.milestones.push(`claimed:${childId}`)
      await this.onClaim({ childId, messageId })
      this.milestones.push(`returned:${childId}`)
      return { childId: SessionId(childId), messageId: MessageId(messageId) }
    } catch (error) {
      // Creation failed: the official runtime disposes the child it made.
      this.agents.delete(childId)
      throw error
    }
  }

  /** `subagents.queuePrompt`: resident child takes the prompt; a released one is cold-resumed. */
  async queuePrompt(
    parent: { readonly id: string },
    childId: string,
    content: readonly { readonly type: string; readonly text?: string }[],
  ): Promise<ReturnType<typeof MessageId>> {
    this.queueCalls.push({ parent: parent.id, childId, text: content.map(block => block.text ?? '').join('') })
    let child = this.agents.get(childId)
    if (child === undefined) {
      if (!this.released.has(childId)) throw new FakeSubagentError(`no such subagent "${childId}"`, 'CHILD_NOT_FOUND')
      this.assertCapacity()
      child = { id: childId, ctx: { agentId: childId }, parentId: parent.id, inbox: [], turnOpen: false }
      this.agents.set(childId, child)
      this.released.delete(childId)
      try {
        this.milestones.push(`created:${childId}:resume`)
        await this.emitCreated({ agent: child, source: 'resume' })
      } catch (error) {
        this.agents.delete(childId)
        this.released.add(childId)
        throw error
      }
    }
    const messageId = `message-${String(this.nextMessage++)}`
    child.inbox.push({ kind: 'prompt', text: content.map(block => block.text ?? '').join('') })
    child.turnOpen = true
    this.milestones.push(`claimed:${childId}`)
    return MessageId(messageId)
  }

  /** The child finished a turn and goes idle; the default notice reaches its PARENT only. */
  settle(childId: string): void {
    const child = this.agents.get(childId)
    if (child === undefined || child.parentId === undefined) return
    child.turnOpen = false
    const parent = this.agents.get(child.parentId)
    parent?.inbox.push({ kind: 'settlement-notice', from: childId })
    this.milestones.push(`settled:${childId}`)
  }

  /** The runtime unloads an idle child; it stays durable and cold-resumable. */
  release(childId: string): void {
    if (this.agents.delete(childId)) this.released.add(childId)
  }

  /** The durable catalog listing of one parent's children. */
  listChildren(parentId: string): readonly { readonly id: string; readonly mode: 'continuable'; readonly parentSessionId: string }[] {
    return [...this.agents.values(), ...[...this.released].map(id => ({ id, parentId }))]
      .filter(entry => (entry as { parentId?: string }).parentId === parentId)
      .map(entry => ({ id: entry.id, mode: 'continuable' as const, parentSessionId: parentId }))
  }
}

/** One persisted/live session event in the shape `sessionQuery` returns. */
export interface FakeSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
}

export interface FakeObservation {
  readonly source: 'live' | 'prepared'
  readonly header: { readonly id: string; readonly parentSession?: string; readonly origin?: string }
  readonly events: readonly FakeSessionEvent[]
  readonly cursor: number
  disposed: boolean
  [Symbol.dispose](): void
}

/**
 * `sessionQuery.observeSession`. A `prepared` (cold) read appends the same
 * synthetic `interruptedTurnClosers` the official cold path appends: copied
 * `time`, next `seq`, `reason: { kind: 'interrupted' }`, no marker.
 */
export class FakeSessionQuery {
  readonly logs = new Map<string, { header: FakeObservation['header']; events: FakeSessionEvent[]; live: boolean }>()
  readonly observed: string[] = []
  readonly leases: FakeObservation[] = []

  add(
    id: string,
    parent: string | undefined,
    events: readonly FakeSessionEvent[],
    live = false,
  ): void {
    this.logs.set(id, {
      header: { id, ...(parent === undefined ? {} : { parentSession: parent, origin: 'subagent' }) },
      events: [...events],
      live,
    })
  }

  async observeSession(sessionId: string): Promise<FakeObservation> {
    this.observed.push(sessionId)
    const log = this.logs.get(sessionId)
    if (log === undefined) throw Object.assign(new Error(`session "${sessionId}" not found`), { code: 'SESSION_QUERY_NOT_FOUND' })
    const events = log.live ? [...log.events] : [...log.events, ...syntheticClosers(log.events)]
    const lease: FakeObservation = {
      source: log.live ? 'live' : 'prepared',
      header: log.header,
      events,
      cursor: events.at(-1)?.seq ?? -1,
      disposed: false,
      [Symbol.dispose]() { lease.disposed = true },
    }
    this.leases.push(lease)
    return lease
  }
}

/** Mirrors `interruptedTurnClosers` for the log shapes these fixtures use. */
export function syntheticClosers(events: readonly FakeSessionEvent[]): FakeSessionEvent[] {
  let openTurn: number | null = null
  for (const event of events) {
    if (event.type === 'turn/start') openTurn = event.data['turn'] as number
    else if (event.type === 'turn/end') openTurn = null
  }
  const last = events.at(-1)
  if (openTurn === null || last === undefined) return []
  return [{
    type: 'turn/end',
    seq: last.seq + 1,
    time: last.time,
    data: { turn: openTurn, reason: { kind: 'interrupted' } },
  }]
}
