import type { FederatedSessionId, FederatedWorkspaceId, NodeId } from '../../core/index.js'

export interface PickerWorkspace {
  readonly workspaceId: FederatedWorkspaceId
  readonly nodeId: NodeId
  readonly title: string
  readonly path: string
}

export interface PickerNode {
  readonly nodeId: NodeId
  readonly displayName: string
  readonly writable: boolean
  /** Remote nodes browse in-app; This Mac may offer its own native chooser. */
  readonly directoryMode: 'native' | 'browse'
}

export interface BlankSession {
  readonly sessionId: FederatedSessionId
  readonly workspaceId?: FederatedWorkspaceId
  readonly nodeId: NodeId
}

export type PickerOutcome =
  | { readonly kind: 'reuse-blank'; readonly sessionId: FederatedSessionId }
  | { readonly kind: 'create-session'; readonly nodeId: NodeId; readonly workspaceId: FederatedWorkspaceId }
  | { readonly kind: 'rejected'; readonly reason: 'unknown-workspace' | 'not-writable' | 'node-mismatch' }

export interface HeroPickerOptions {
  readonly nodes: readonly PickerNode[]
  readonly workspaces: readonly PickerWorkspace[]
  readonly blankSessions: readonly BlankSession[]
}

/**
 * Node-aware Workspace picker shared by the sidebar and the conversation hero.
 *
 * Both entry points resolve a target the same way, and both reuse an existing
 * blank session for the chosen workspace instead of creating a second one — the
 * official New Session semantics, now scoped per node.
 */
export class FederatedHeroPicker {
  readonly #options: HeroPickerOptions

  constructor(options: HeroPickerOptions) {
    this.#options = options
  }

  /** Nodes offered for creation; a non-writable node cannot host a new session. */
  selectableNodes(): readonly PickerNode[] {
    return this.#options.nodes.filter(node => node.writable)
  }

  workspacesOf(nodeId: NodeId): readonly PickerWorkspace[] {
    return this.#options.workspaces.filter(workspace => workspace.nodeId === nodeId)
  }

  directoryModeOf(nodeId: NodeId): 'native' | 'browse' | undefined {
    return this.#options.nodes.find(node => node.nodeId === nodeId)?.directoryMode
  }

  /** Resolves the outcome for choosing one workspace; identical for both surfaces. */
  choose(workspaceId: FederatedWorkspaceId): PickerOutcome {
    const workspace = this.#options.workspaces.find(candidate => candidate.workspaceId === workspaceId)
    if (workspace === undefined) return { kind: 'rejected', reason: 'unknown-workspace' }
    const node = this.#options.nodes.find(candidate => candidate.nodeId === workspace.nodeId)
    if (node === undefined) return { kind: 'rejected', reason: 'node-mismatch' }
    if (!node.writable) return { kind: 'rejected', reason: 'not-writable' }
    const blank = this.#options.blankSessions.find(candidate =>
      candidate.workspaceId === workspaceId && candidate.nodeId === workspace.nodeId)
    return blank === undefined
      ? { kind: 'create-session', nodeId: workspace.nodeId, workspaceId }
      : { kind: 'reuse-blank', sessionId: blank.sessionId }
  }
}
