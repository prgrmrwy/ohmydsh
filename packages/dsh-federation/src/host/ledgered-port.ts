import { randomUUID } from 'node:crypto'
import {
  type AbortOptions,
  type DshNodePort,
  type NativeSessionId,
  type NativeWorkspaceId,
  type OperationId,
  type PromptCommand,
  type RpcId,
  type SearchQuery,
  type WriteKind,
  WriteLedger,
} from '../core/index.js'
import { RemoteBusinessError } from './remote-adapter/rc2/index.js'
import { bindSendAttempt } from './send-attempt.js'

/**
 * The sole production write wrapper for one remote node. It records delivery,
 * never retries, and conservatively leaves any sent request without a proven
 * business response as OUTCOME_UNKNOWN.
 */
export class LedgeredNodePort implements DshNodePort {
  readonly node
  readonly capabilities

  constructor(readonly inner: DshNodePort, readonly ledger: WriteLedger) {
    this.node = inner.node
    this.capabilities = inner.capabilities
  }

  listWorkspaces(options?: AbortOptions) { return this.inner.listWorkspaces(options) }
  listSessions(options?: AbortOptions) { return this.inner.listSessions(options) }
  history(sessionId: NativeSessionId, options?: AbortOptions & { readonly beforeSeq?: number }) { return this.inner.history(sessionId, options) }
  models(sessionId: NativeSessionId, options?: AbortOptions) { return this.inner.models(sessionId, options) }
  attachment(sessionId: NativeSessionId, attachmentId: string, options?: AbortOptions) { return this.inner.attachment(sessionId, attachmentId, options) }
  search(query: SearchQuery, options?: AbortOptions) { return this.inner.search(query, options) }
  listDirectory(path: string | undefined, options?: AbortOptions) { return this.inner.listDirectory?.(path, options) ?? Promise.reject(new Error('directory browse unavailable')) }
  createDirectory(path: string, name: string, options?: AbortOptions) {
    if (this.inner.createDirectory === undefined) return Promise.reject(new Error('directory create unavailable'))
    return this.#write('opaque', bound => this.inner.createDirectory!(path, name, bound), {}, options)
  }
  openSession(id: Parameters<NonNullable<DshNodePort['openSession']>>[0]): void {
    this.inner.openSession?.(id)
  }

  createWorkspace(path: string, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.createWorkspace(path, bound), {}, options) }
  renameWorkspace(id: NativeWorkspaceId, title: string, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.renameWorkspace(id, title, bound), {}, options) }
  deleteWorkspace(id: NativeWorkspaceId, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.deleteWorkspace(id, bound), {}, options) }
  reorderWorkspace(id: NativeWorkspaceId, before: NativeWorkspaceId | undefined, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.reorderWorkspace(id, before, bound), {}, options) }
  reorderSession(workspaceId: NativeWorkspaceId, sessionId: NativeSessionId, before: NativeSessionId | undefined, options?: AbortOptions) {
    return this.#write('opaque', bound => this.inner.reorderSession(workspaceId, sessionId, before, bound), { sessionId }, options)
  }
  createSession(workspaceId: NativeWorkspaceId | undefined, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.createSession(workspaceId, bound), {}, options) }
  prompt(command: PromptCommand, options?: AbortOptions) {
    return this.#write('prompt', bound => this.inner.prompt(command, bound), {
      operationId: `prompt:${command.rpcId}` as OperationId,
      rpcId: command.rpcId,
      sessionId: command.sessionId,
    }, options)
  }
  cancel(sessionId: NativeSessionId, options?: AbortOptions) { return this.#write('cancel', bound => this.inner.cancel(sessionId, bound), { sessionId }, options) }
  renameSession(sessionId: NativeSessionId, title: string, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.renameSession(sessionId, title, bound), { sessionId }, options) }
  forkSession(sessionId: NativeSessionId, atSeq: number | undefined, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.forkSession(sessionId, atSeq, bound), { sessionId }, options) }
  selectModel(sessionId: NativeSessionId, selection: unknown, options?: AbortOptions) { return this.#write('selectModel', bound => this.inner.selectModel(sessionId, selection, bound), { sessionId }, options) }
  updateQueue(sessionId: NativeSessionId, update: unknown, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.updateQueue(sessionId, update, bound), { sessionId }, options) }
  archiveSession(sessionId: NativeSessionId, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.archiveSession(sessionId, bound), { sessionId }, options) }
  respond(rpcId: RpcId, response: unknown, options?: AbortOptions) { return this.#write('opaque', bound => this.inner.respond(rpcId, response, bound), {}, options) }

  async #write<T>(
    kind: WriteKind,
    action: (options: AbortOptions) => Promise<T>,
    evidence: { readonly operationId?: OperationId; readonly rpcId?: RpcId; readonly sessionId?: NativeSessionId } = {},
    options?: AbortOptions,
  ): Promise<T> {
    const operationId = evidence.operationId ?? `operation:${randomUUID()}` as OperationId
    this.ledger.create({
      operationId, nodeId: this.node.nodeId, kind,
      ...(evidence.rpcId === undefined ? {} : { rpcId: evidence.rpcId }),
      ...(evidence.sessionId === undefined ? {} : { sessionId: evidence.sessionId }),
    })
    let attempted = false
    const bound = bindSendAttempt(options, () => {
      if (attempted) return
      if (this.node.state !== 'READY' && this.node.state !== 'DEGRADED') {
        throw new Error(`node ${this.node.nodeId} is not writable while ${this.node.state}`)
      }
      attempted = true
      this.ledger.markSent(operationId)
    })
    try {
      const value = await action(bound)
      // In-process transports can return an explicit response without a fetch
      // callback; that response itself proves the operation was sent.
      if (!attempted) { attempted = true; this.ledger.markSent(operationId) }
      this.ledger.markAccepted(operationId)
      return value
    } catch (cause) {
      if (cause instanceof RemoteBusinessError) {
        if (!attempted) { attempted = true; this.ledger.markSent(operationId) }
        this.ledger.markRejected(operationId, cause.message)
      } else if (attempted) {
        this.ledger.markConnectionLost(operationId)
      }
      throw cause
    }
  }
}
