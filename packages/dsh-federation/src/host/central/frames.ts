import {
  encodeSessionId,
  encodeWorkspaceId,
  type FederatedSessionId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeId,
} from '../../core/index.js'
import type { EventStreamKind } from '../carrier/index.js'
import type { Rc2StableEvent } from '../remote-adapter/rc2/index.js'

export interface CentralFrame {
  readonly stream: EventStreamKind
  readonly rpcId: string
  readonly payload: Record<string, unknown>
}

export interface CentralFrameContext {
  readonly nodeId: NodeId
  /** Monotonic per-node push counter used only to mint central rpcIds for pure pushes. */
  nextRpcId(): string
}

function rewriteSession(nodeId: NodeId, nativeId: string): FederatedSessionId {
  return encodeSessionId({ nodeId, nativeId: nativeId as NativeSessionId })
}

/**
 * Converts one adapter-produced stable event into the central mux/host frame a
 * federated browser consumes. Every session and workspace identity is rewritten
 * to its federated form; answerable interaction frames keep the remote rpcId
 * verbatim so `respond` can be routed back to its owner without guessing.
 */
export function toCentralFrame(event: Rc2StableEvent, context: CentralFrameContext): CentralFrame | undefined {
  if (event.kind === 'interaction') {
    const payload = { ...(event.payload as Record<string, unknown>) }
    payload.sessionId = rewriteSession(context.nodeId, event.sessionId)
    return { stream: 'mux', rpcId: event.rpcId, payload }
  }
  if (event.kind === 'control') {
    return { stream: event.stream, rpcId: context.nextRpcId(), payload: { ...(event.payload as Record<string, unknown>) } }
  }
  if (event.kind === 'refresh-required') return undefined

  const frame = event.frame
  switch (frame.domain) {
    case 'session': {
      const payload = { ...(frame.value as Record<string, unknown>) }
      payload.sessionId = rewriteSession(context.nodeId, frame.sessionId)
      return { stream: 'mux', rpcId: context.nextRpcId(), payload }
    }
    case 'workspace-upsert': {
      const workspace = { ...(frame.value as Record<string, unknown>) }
      workspace.workspaceId = encodeWorkspaceId({ nodeId: context.nodeId, nativeId: frame.workspaceId as NativeWorkspaceId })
      workspace.sessionIds = Array.isArray(workspace.sessionIds)
        ? workspace.sessionIds.map(id => rewriteSession(context.nodeId, String(id)))
        : []
      return { stream: 'host', rpcId: context.nextRpcId(), payload: { type: 'host/workspace-changed', workspace } }
    }
    case 'workspace-remove':
      return {
        stream: 'host', rpcId: context.nextRpcId(),
        payload: { type: 'host/workspace-removed', workspaceId: encodeWorkspaceId({ nodeId: context.nodeId, nativeId: frame.workspaceId as NativeWorkspaceId }) },
      }
    case 'status':
      return {
        stream: 'host', rpcId: context.nextRpcId(),
        payload: { type: 'host/session-status', sessionId: rewriteSession(context.nodeId, frame.sessionId), running: (frame.value as { running?: boolean }).running === true },
      }
    case 'status-remove':
      return {
        stream: 'host', rpcId: context.nextRpcId(),
        payload: { type: 'host/session-removed', sessionId: rewriteSession(context.nodeId, frame.sessionId) },
      }
  }
}

/** Central archive/order snapshots are whole-set frames, mirroring rc.2 posture. */
export function archivedSessionsFrame(nodeIds: readonly FederatedSessionId[], rpcId: string): CentralFrame {
  return { stream: 'host', rpcId, payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [...nodeIds] } }
}

export function createRpcIdMinter(nodeId: NodeId): CentralFrameContext {
  let counter = 0
  return { nodeId, nextRpcId: () => `fed-push-${nodeId}-${++counter}` }
}
