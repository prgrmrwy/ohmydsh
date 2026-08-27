import type { NativeSessionId, NativeWorkspaceId, NodeId } from './types.js'

export interface SessionEntity<T> {
  readonly id: NativeSessionId
  readonly seq: number
  readonly value: T
}

export interface HostSnapshot<W, S> {
  readonly workspaces: readonly { readonly id: NativeWorkspaceId; readonly value: W }[]
  readonly statuses: readonly { readonly id: NativeSessionId; readonly value: S }[]
}

export type ReconciliationFrame<W, S, E> =
  | { readonly domain: 'session'; readonly sessionId: NativeSessionId; readonly seq: number; readonly value: E }
  | { readonly domain: 'workspace-upsert'; readonly workspaceId: NativeWorkspaceId; readonly value: W }
  | { readonly domain: 'workspace-remove'; readonly workspaceId: NativeWorkspaceId }
  | { readonly domain: 'status'; readonly sessionId: NativeSessionId; readonly value: S }
  | { readonly domain: 'status-remove'; readonly sessionId: NativeSessionId }

export interface ReconciliationView<W, S, E> {
  readonly nodeId: NodeId
  readonly generation: number
  readonly ready: boolean
  readonly workspaces: ReadonlyMap<NativeWorkspaceId, W>
  readonly statuses: ReadonlyMap<NativeSessionId, S>
  readonly sessionEvents: ReadonlyMap<NativeSessionId, SessionEntity<E>>
  readonly refreshRequired: boolean
}

interface GenerationState<W, S, E> {
  readonly generation: number
  readonly buffer: ReconciliationFrame<W, S, E>[]
  workspaces: Map<NativeWorkspaceId, W>
  statuses: Map<NativeSessionId, S>
  sessionEvents: Map<NativeSessionId, SessionEntity<E>>
  workspaceTombstones: Set<NativeWorkspaceId>
  statusTombstones: Set<NativeSessionId>
  baselineInstalled: boolean
  streamsReady: boolean
  refreshRequired: boolean
  refreshToken?: number
  refreshBuffer: ReconciliationFrame<W, S, E>[]
}

export class NodeReconciler<W, S, E> {
  #nextGeneration = 0
  #nextRefreshToken = 0
  #state?: GenerationState<W, S, E>

  constructor(readonly nodeId: NodeId) {}

  begin(): number {
    const generation = ++this.#nextGeneration
    this.#state = {
      generation,
      buffer: [],
      workspaces: new Map(),
      statuses: new Map(),
      sessionEvents: new Map(),
      workspaceTombstones: new Set(),
      statusTombstones: new Set(),
      baselineInstalled: false,
      streamsReady: false,
      refreshRequired: false,
      refreshBuffer: [],
    }
    return generation
  }

  accept(generation: number, frame: ReconciliationFrame<W, S, E>): boolean {
    const state = this.#current(generation)
    if (state === undefined) return false
    if (!state.baselineInstalled || !state.streamsReady) state.buffer.push(frame)
    else {
      this.#apply(state, frame)
      if (state.refreshToken !== undefined) state.refreshBuffer.push(frame)
    }
    return true
  }

  installBaseline(generation: number, snapshot: HostSnapshot<W, S>, sessionBaseline: readonly SessionEntity<E>[]): boolean {
    const state = this.#current(generation)
    if (state === undefined) return false
    state.workspaces = new Map(snapshot.workspaces.map(item => [item.id, item.value]))
    state.statuses = new Map(snapshot.statuses.map(item => [item.id, item.value]))
    state.sessionEvents = new Map(sessionBaseline.map(item => [item.id, item]))
    state.workspaceTombstones.clear()
    state.statusTombstones.clear()
    state.baselineInstalled = true
    this.#commitIfReady(state)
    return true
  }

  markStreamsReady(generation: number): boolean {
    const state = this.#current(generation)
    if (state === undefined) return false
    state.streamsReady = true
    this.#commitIfReady(state)
    return true
  }

  beginAuthoritativeRefresh(generation: number): number | undefined {
    const state = this.#current(generation)
    if (state === undefined || !state.baselineInstalled || !state.streamsReady) return undefined
    const token = ++this.#nextRefreshToken
    state.refreshToken = token
    state.refreshBuffer.length = 0
    return token
  }

  commitAuthoritativeRefresh(
    generation: number,
    token: number,
    snapshot: HostSnapshot<W, S>,
    sessionBaseline?: readonly SessionEntity<E>[],
  ): boolean {
    const state = this.#current(generation)
    if (state === undefined || state.refreshToken !== token) return false
    state.workspaces = new Map(snapshot.workspaces.map(item => [item.id, item.value]))
    state.statuses = new Map(snapshot.statuses.map(item => [item.id, item.value]))
    if (sessionBaseline !== undefined) state.sessionEvents = new Map(sessionBaseline.map(item => [item.id, item]))
    state.workspaceTombstones.clear()
    state.statusTombstones.clear()
    const duringRefresh = state.refreshBuffer.splice(0)
    delete state.refreshToken
    for (const frame of duringRefresh) this.#apply(state, frame)
    // A completed snapshot followed by replay of every frame observed while it
    // was in flight is converged for this generation.
    state.refreshRequired = false
    return true
  }

  view(): ReconciliationView<W, S, E> | undefined {
    const state = this.#state
    if (state === undefined) return undefined
    return Object.freeze({
      nodeId: this.nodeId,
      generation: state.generation,
      ready: state.baselineInstalled && state.streamsReady,
      workspaces: state.workspaces,
      statuses: state.statuses,
      sessionEvents: state.sessionEvents,
      refreshRequired: state.refreshRequired,
    })
  }

  #commitIfReady(state: GenerationState<W, S, E>): void {
    if (!state.baselineInstalled || !state.streamsReady) return
    const buffered = state.buffer.splice(0)
    for (const frame of buffered) this.#apply(state, frame)
    // Host frames carry no cross-stream sequence; any buffered host mutation
    // means a post-replay authoritative refresh is required for convergence.
    if (buffered.some(frame => frame.domain !== 'session')) state.refreshRequired = true
  }

  #apply(state: GenerationState<W, S, E>, frame: ReconciliationFrame<W, S, E>): void {
    switch (frame.domain) {
      case 'session': {
        const current = state.sessionEvents.get(frame.sessionId)
        if (current === undefined || frame.seq > current.seq) state.sessionEvents.set(frame.sessionId, { id: frame.sessionId, seq: frame.seq, value: frame.value })
        return
      }
      case 'workspace-upsert':
        state.workspaceTombstones.delete(frame.workspaceId)
        state.workspaces.set(frame.workspaceId, frame.value)
        return
      case 'workspace-remove':
        state.workspaces.delete(frame.workspaceId)
        state.workspaceTombstones.add(frame.workspaceId)
        return
      case 'status':
        state.statusTombstones.delete(frame.sessionId)
        state.statuses.set(frame.sessionId, frame.value)
        return
      case 'status-remove':
        state.statuses.delete(frame.sessionId)
        state.statusTombstones.add(frame.sessionId)
    }
  }

  #current(generation: number): GenerationState<W, S, E> | undefined {
    return this.#state?.generation === generation ? this.#state : undefined
  }
}
