import type { FederatedSessionId, FederatedWorkspaceId, NodeId } from '../core/types.js'

/** One workspace row as the official subtree consumes it. */
export interface NodeWorkspaceView {
  readonly workspaceId: FederatedWorkspaceId
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly FederatedSessionId[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** One session summary as the official subtree consumes it. */
export interface NodeSessionSummary {
  readonly id: FederatedSessionId
  readonly displayTitle: string
  readonly cwd: string
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt: number
  readonly parentId?: FederatedSessionId
  readonly origin?: 'subagent'
  readonly pendingInteraction?: 'approval' | 'question'
}

export interface NodeSessionsState {
  readonly ids: readonly FederatedSessionId[]
  readonly byId: Readonly<Record<string, NodeSessionSummary>>
  readonly current: FederatedSessionId | undefined
  readonly phase: 'loading' | 'ready'
  readonly subagentsByParent: Readonly<Record<string, readonly FederatedSessionId[]>>
  readonly jobsBySession: Readonly<Record<string, readonly unknown[]>>
  readonly currentAddress: undefined
}

export interface NodeWorkspacesState {
  readonly items: readonly NodeWorkspaceView[]
  readonly archivedSessionIds: readonly FederatedSessionId[]
  readonly state: 'idle' | 'loading'
  readonly phase: 'loading' | 'ready'
  readonly error: null
  readonly baselinesReady: boolean
  readonly recentWorkspaceId: FederatedWorkspaceId | undefined
}

/** Baseline the Host publishes for one node, already carrying federated ids. */
export interface NodeBaseline {
  readonly workspaces: readonly NodeWorkspaceView[]
  readonly sessions: readonly NodeSessionSummary[]
  readonly archivedSessionIds: readonly FederatedSessionId[]
}

/**
 * Central frames the browser consumes. These are the already-rewritten frames
 * `toCentralFrame` produces, so every identity is federated and no rc.2 schema
 * reaches this layer beyond the frame `type` discriminator.
 */
export type CentralBrowserFrame =
  | { readonly type: 'host/session-status'; readonly sessionId: FederatedSessionId; readonly running: boolean }
  | { readonly type: 'host/session-removed'; readonly sessionId: FederatedSessionId }
  | { readonly type: 'host/workspace-changed'; readonly workspace: NodeWorkspaceView }
  | { readonly type: 'host/workspace-removed'; readonly workspaceId: FederatedWorkspaceId }
  | { readonly type: 'host/archived-sessions-changed'; readonly archivedSessionIds: readonly FederatedSessionId[] }
  | { readonly type: 'session/projection'; readonly sessionId: FederatedSessionId; readonly key: string; readonly value: unknown; readonly seq: number }
  | { readonly type: string; readonly [key: string]: unknown }

type Listener = () => void

/**
 * Per-node browser projection.
 *
 * It owns exactly the two stores the official Workspace/Session subtree reads,
 * scoped to one node. Frames are accepted only when they belong to this node,
 * so a frame for another node can never mutate this projection even when both
 * nodes use identical native ids.
 *
 * Projection values follow higher-seq-wins, matching the approved reconciliation
 * rule; frames without a proven seq only mutate transient status.
 */
export class NodeProjectionRuntime {
  readonly nodeId: NodeId
  readonly #prefixWorkspace: string
  readonly #prefixSession: string
  readonly #listeners = new Set<Listener>()
  readonly #titleSeq = new Map<string, number>()

  #sessions: NodeSessionsState
  #workspaces: NodeWorkspacesState

  constructor(nodeId: NodeId) {
    this.nodeId = nodeId
    this.#prefixWorkspace = `fed1:${nodeId}:w:`
    this.#prefixSession = `fed1:${nodeId}:s:`
    this.#sessions = {
      ids: [], byId: {}, current: undefined, phase: 'loading',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
    this.#workspaces = {
      items: [], archivedSessionIds: [], state: 'idle', phase: 'loading',
      error: null, baselinesReady: false, recentWorkspaceId: undefined,
    }
  }

  get ready(): boolean { return this.#workspaces.baselinesReady }
  get sessionsState(): NodeSessionsState { return this.#sessions }
  get workspacesState(): NodeWorkspacesState { return this.#workspaces }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** True when this federated id belongs to this node. */
  ownsSession(id: string): boolean { return id.startsWith(this.#prefixSession) }
  ownsWorkspace(id: string): boolean { return id.startsWith(this.#prefixWorkspace) }

  /** Installs an authoritative baseline; replaces any previous generation. */
  installBaseline(baseline: NodeBaseline): void {
    const sessions = baseline.sessions.filter(session => this.ownsSession(session.id))
    const workspaces = baseline.workspaces.filter(workspace => this.ownsWorkspace(workspace.workspaceId))
    this.#titleSeq.clear()
    this.#sessions = {
      ...this.#sessions,
      ids: sessions.map(session => session.id),
      byId: Object.fromEntries(sessions.map(session => [session.id, session])),
      phase: 'ready',
    }
    this.#workspaces = {
      ...this.#workspaces,
      items: workspaces,
      archivedSessionIds: baseline.archivedSessionIds.filter(id => this.ownsSession(id)),
      phase: 'ready',
      baselinesReady: true,
      recentWorkspaceId: workspaces[0]?.workspaceId,
    }
    this.#emit()
  }

  /** Marks the projection stale without discarding the last known tree. */
  invalidate(): void {
    if (!this.#workspaces.baselinesReady) return
    this.#workspaces = { ...this.#workspaces, baselinesReady: false }
    this.#emit()
  }

  /** The federated current session, kept only while it resolves to this node. */
  setCurrent(sessionId: FederatedSessionId | undefined): void {
    const next = sessionId !== undefined && this.ownsSession(sessionId) && this.#sessions.byId[sessionId] !== undefined
      ? sessionId
      : undefined
    if (next === this.#sessions.current) return
    this.#sessions = { ...this.#sessions, current: next }
    this.#emit()
  }

  /**
   * Applies one central frame. Returns false when the frame does not belong to
   * this node, so a caller can fan one stream out to many runtimes safely.
   */
  accept(frame: CentralBrowserFrame): boolean {
    switch (frame.type) {
      case 'host/session-status': {
        const { sessionId, running } = frame as { sessionId: FederatedSessionId; running: boolean }
        if (!this.ownsSession(sessionId)) return false
        const existing = this.#sessions.byId[sessionId]
        if (existing === undefined || existing.running === running) return existing !== undefined
        this.#sessions = {
          ...this.#sessions,
          byId: { ...this.#sessions.byId, [sessionId]: { ...existing, running } },
        }
        this.#emit()
        return true
      }
      case 'host/session-removed': {
        const { sessionId } = frame as { sessionId: FederatedSessionId }
        if (!this.ownsSession(sessionId)) return false
        if (this.#sessions.byId[sessionId] === undefined) return true
        const byId = { ...this.#sessions.byId }
        delete byId[sessionId]
        this.#sessions = {
          ...this.#sessions,
          byId,
          ids: this.#sessions.ids.filter(id => id !== sessionId),
          current: this.#sessions.current === sessionId ? undefined : this.#sessions.current,
        }
        this.#emit()
        return true
      }
      case 'host/workspace-changed': {
        const { workspace } = frame as { workspace: NodeWorkspaceView }
        if (workspace === undefined || !this.ownsWorkspace(workspace.workspaceId)) return false
        const items = this.#workspaces.items.some(item => item.workspaceId === workspace.workspaceId)
          ? this.#workspaces.items.map(item => (item.workspaceId === workspace.workspaceId ? workspace : item))
          : [...this.#workspaces.items, workspace]
        this.#workspaces = { ...this.#workspaces, items }
        this.#emit()
        return true
      }
      case 'host/workspace-removed': {
        const { workspaceId } = frame as { workspaceId: FederatedWorkspaceId }
        if (!this.ownsWorkspace(workspaceId)) return false
        this.#workspaces = {
          ...this.#workspaces,
          items: this.#workspaces.items.filter(item => item.workspaceId !== workspaceId),
        }
        this.#emit()
        return true
      }
      case 'host/archived-sessions-changed': {
        const { archivedSessionIds } = frame as { archivedSessionIds: readonly FederatedSessionId[] }
        if (!Array.isArray(archivedSessionIds)) return false
        const owned = archivedSessionIds.filter(id => this.ownsSession(id))
        // A whole-set frame is authoritative only for this node's slice.
        this.#workspaces = { ...this.#workspaces, archivedSessionIds: owned }
        this.#emit()
        return true
      }
      case 'session/projection': {
        const { sessionId, key, value, seq } = frame as { sessionId: FederatedSessionId; key: string; value: unknown; seq: number }
        if (!this.ownsSession(sessionId) || key !== 'title' || typeof value !== 'string') return false
        const existing = this.#sessions.byId[sessionId]
        if (existing === undefined) return false
        // Higher-seq-wins: a late lower-seq frame must not overwrite.
        const seen = this.#titleSeq.get(sessionId)
        if (seen !== undefined && Number.isFinite(seq) && seq <= seen) return true
        if (Number.isFinite(seq)) this.#titleSeq.set(sessionId, seq)
        this.#sessions = {
          ...this.#sessions,
          byId: { ...this.#sessions.byId, [sessionId]: { ...existing, displayTitle: value } },
        }
        this.#emit()
        return true
      }
      default:
        return false
    }
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}
