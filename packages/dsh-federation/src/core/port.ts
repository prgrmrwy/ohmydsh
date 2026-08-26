import type {
  FederatedSessionId,
  NativeSessionId,
  NativeWorkspaceId,
  NodeCapability,
  NodeDescriptor,
  RpcId,
  SearchQuery,
  SearchResult,
  SessionProjection,
  WorkspaceProjection,
} from './types.js'

export interface AbortOptions {
  readonly signal?: AbortSignal
}

export interface PromptCommand {
  readonly sessionId: NativeSessionId
  readonly rpcId: RpcId
  readonly mode: 'queue' | 'steer'
  readonly content: readonly unknown[]
  readonly clientTimeZone?: string
}

export interface DshNodePort {
  readonly node: NodeDescriptor
  readonly capabilities: ReadonlySet<NodeCapability>
  listWorkspaces(options?: AbortOptions): Promise<readonly WorkspaceProjection[]>
  createWorkspace(path: string, options?: AbortOptions): Promise<WorkspaceProjection>
  renameWorkspace(workspaceId: NativeWorkspaceId, title: string, options?: AbortOptions): Promise<WorkspaceProjection>
  deleteWorkspace(workspaceId: NativeWorkspaceId, options?: AbortOptions): Promise<void>
  reorderWorkspace(workspaceId: NativeWorkspaceId, beforeId: NativeWorkspaceId | undefined, options?: AbortOptions): Promise<void>
  listSessions(options?: AbortOptions): Promise<readonly SessionProjection[]>
  createSession(workspaceId: NativeWorkspaceId | undefined, options?: AbortOptions): Promise<NativeSessionId>
  history(sessionId: NativeSessionId, options?: AbortOptions & { readonly beforeSeq?: number }): Promise<unknown>
  models(sessionId: NativeSessionId, options?: AbortOptions): Promise<unknown>
  prompt(command: PromptCommand, options?: AbortOptions): Promise<void>
  cancel(sessionId: NativeSessionId, options?: AbortOptions): Promise<void>
  renameSession(sessionId: NativeSessionId, title: string, options?: AbortOptions): Promise<{ readonly title: string; readonly seq: number }>
  forkSession(sessionId: NativeSessionId, atSeq: number | undefined, options?: AbortOptions): Promise<NativeSessionId>
  selectModel(sessionId: NativeSessionId, selection: unknown, options?: AbortOptions): Promise<unknown>
  updateQueue(sessionId: NativeSessionId, update: unknown, options?: AbortOptions): Promise<void>
  attachment(sessionId: NativeSessionId, attachmentId: string, options?: AbortOptions): Promise<unknown>
  search(query: SearchQuery, options?: AbortOptions): Promise<readonly SearchResult[]>
  archiveSession(sessionId: NativeSessionId, options?: AbortOptions): Promise<void>
  respond(rpcId: RpcId, response: unknown, options?: AbortOptions): Promise<void>
  /** Node-bound directory browse; present only under the node's browse capability. */
  listDirectory?(path: string | undefined, options?: AbortOptions): Promise<unknown>
  /** Node-bound single-level directory creation; present only under the node's browse capability. */
  createDirectory?(path: string, name: string, options?: AbortOptions): Promise<unknown>
  openSession?(id: FederatedSessionId): void
}
