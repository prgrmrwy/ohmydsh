export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type NodeId = Brand<string, 'NodeId'>
export type NativeWorkspaceId = Brand<string, 'NativeWorkspaceId'>
export type NativeSessionId = Brand<string, 'NativeSessionId'>
export type FederatedWorkspaceId = Brand<string, 'FederatedWorkspaceId'>
export type FederatedSessionId = Brand<string, 'FederatedSessionId'>
export type OperationId = Brand<string, 'OperationId'>
export type RpcId = Brand<string, 'RpcId'>

export interface WorkspaceRef {
  readonly nodeId: NodeId
  readonly nativeId: NativeWorkspaceId
}

export interface SessionRef {
  readonly nodeId: NodeId
  readonly nativeId: NativeSessionId
}

export type NodeState =
  | 'DISABLED'
  | 'SSH_UNREACHABLE'
  | 'TUNNEL_ERROR'
  | 'DSH_UNAVAILABLE'
  | 'NON_DSH_SERVICE'
  | 'INCOMPATIBLE'
  | 'CONNECTING'
  | 'DEGRADED'
  | 'READY'
  | 'STALE'

export type CompatibilityStatus = 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'

export type DeliveryState =
  | 'NOT_SENT'
  | 'SENT_AWAITING_RESPONSE'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'OUTCOME_UNKNOWN'

export type NodeCapability =
  | 'workspace.read'
  | 'workspace.write'
  | 'session.read'
  | 'session.write'
  | 'session.search'
  | 'session.attachment'
  | 'directory.read'
  | 'directory.write'
  | 'events.mux'
  | 'events.host'
  | 'interaction.respond'
  | 'extension.unarchive'
  | 'extension.worktree'

export type FederationErrorKind =
  | 'Registry'
  | 'SshIdentity'
  | 'Tunnel'
  | 'Transport'
  | 'Protocol'
  | 'Compatibility'
  | 'Capability'
  | 'Routing'
  | 'RemoteBusiness'
  | 'OutcomeUnknown'
  | 'ActivationConflict'

export interface FederationError {
  readonly kind: FederationErrorKind
  readonly code: string
  readonly message: string
  readonly nodeId?: NodeId
  readonly retryable: boolean
  readonly cause?: unknown
}

export interface NodeDescriptor {
  readonly nodeId: NodeId
  readonly kind: 'local' | 'remote'
  readonly displayName: string
  readonly enabled: boolean
  readonly order: number
  readonly capabilities: ReadonlySet<NodeCapability>
  readonly compatibility: CompatibilityStatus
  readonly state: NodeState
  readonly sshAlias?: string
  readonly remoteDshPort?: number
}

export interface WorkspaceProjection {
  readonly ref: WorkspaceRef
  readonly id: FederatedWorkspaceId
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly FederatedSessionId[]
  readonly archivedSessionIds: readonly FederatedSessionId[]
  readonly order: number
}

export interface SessionProjection {
  readonly ref: SessionRef
  readonly id: FederatedSessionId
  readonly workspaceId?: FederatedWorkspaceId
  readonly title: string
  readonly path: string
  readonly status: string
  readonly seq?: number
  readonly archived: boolean
}

export interface SearchQuery {
  readonly query: string
  readonly limit: number
}

export interface SearchResult {
  readonly session: SessionProjection
  readonly snippet?: string
}
