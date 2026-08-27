import { describe, expect, it, vi } from 'vitest'
import {
  CommandRouter,
  NodeReconciler,
  WriteLedger,
  encodeSessionId,
  encodeWorkspaceId,
  parseNodeId,
  type DshNodePort,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeCapability,
  type OperationId,
  type RpcId,
} from '../src/core/index.js'

const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')
const sessionNative = 'native-session' as NativeSessionId
const workspaceNative = 'native-workspace' as NativeWorkspaceId

function port(nodeId = vmA, capabilities = new Set<NodeCapability>([
  'workspace.read', 'workspace.write', 'session.read', 'session.write', 'session.search',
  'session.attachment', 'interaction.respond',
])): DshNodePort & { calls: unknown[][] } {
  const calls: unknown[][] = []
  const record = (method: string, result: unknown) => (...args: unknown[]) => { calls.push([method, ...args]); return Promise.resolve(result) }
  return {
    calls,
    node: { nodeId, kind: 'remote', displayName: nodeId, enabled: true, order: 0, capabilities, compatibility: 'SUPPORTED', state: 'READY', sshAlias: nodeId, remoteDshPort: 3080 },
    capabilities,
    listWorkspaces: record('workspace.list', []),
    createWorkspace: record('workspace.create', {}),
    renameWorkspace: record('workspace.rename', {}),
    deleteWorkspace: record('workspace.delete', undefined),
    reorderWorkspace: record('workspace.reorder', undefined),
    reorderSession: record('workspace.insertSessionBefore', undefined),
    listSessions: record('session.list', []),
    createSession: record('session.create', sessionNative),
    history: record('session.history', {}),
    models: record('session.models', {}),
    prompt: record('session.prompt', undefined),
    cancel: record('session.cancel', undefined),
    renameSession: record('session.rename', { title: 'renamed', seq: 2 }),
    forkSession: record('session.fork', sessionNative),
    selectModel: record('session.selectModel', {}),
    updateQueue: record('session.updateQueue', undefined),
    attachment: record('session.attachment', {}),
    search: record('session.search', []),
    archiveSession: record('session.archive', undefined),
    respond: record('respond', undefined),
  } as unknown as DshNodePort & { calls: unknown[][] }
}

describe('capability-gated command router', () => {
  it('decodes federated IDs and calls only the encoded owner with native IDs', async () => {
    const a = port(vmA)
    const b = port(vmB)
    const router = new CommandRouter(new Map([[vmA, a], [vmB, b]]))
    await router.workspaceRename(encodeWorkspaceId({ nodeId: vmB, nativeId: workspaceNative }), 'renamed')
    await router.prompt(encodeSessionId({ nodeId: vmA, nativeId: sessionNative }), { rpcId: 'rpc-1' as RpcId, mode: 'queue', content: [] })
    await router.models(encodeSessionId({ nodeId: vmA, nativeId: sessionNative }))
    await router.sessionCreate(vmB, encodeWorkspaceId({ nodeId: vmB, nativeId: workspaceNative }))
    await router.sessionReorder(
      encodeWorkspaceId({ nodeId: vmA, nativeId: workspaceNative }),
      encodeSessionId({ nodeId: vmA, nativeId: sessionNative }),
      undefined,
    )
    expect(a.calls[0]![0]).toBe('session.prompt')
    expect((a.calls[0]![1] as { sessionId: string }).sessionId).toBe(sessionNative)
    expect(a.calls[1]!.slice(0, 2)).toEqual(['session.models', sessionNative])
    expect(a.calls[2]!.slice(0, 4)).toEqual(['workspace.insertSessionBefore', workspaceNative, sessionNative, undefined])
    expect(b.calls[0]!.slice(0, 3)).toEqual(['workspace.rename', workspaceNative, 'renamed'])
    expect(b.calls[1]!.slice(0, 2)).toEqual(['session.create', workspaceNative])
  })

  it('fails closed on capability denial, unavailable nodes and cross-node reorder', () => {
    const denied = port(vmA, new Set(['workspace.read']))
    const router = new CommandRouter(new Map([[vmA, denied], [vmB, port(vmB)]]))
    expect(() => router.cancel(encodeSessionId({ nodeId: vmA, nativeId: sessionNative }))).toThrow(/lacks session.write/)
    expect(() => router.workspaceReorder(
      encodeWorkspaceId({ nodeId: vmA, nativeId: workspaceNative }),
      encodeWorkspaceId({ nodeId: vmB, nativeId: workspaceNative }),
    )).toThrow(/cross-node/)
    expect(() => router.sessionReorder(
      encodeWorkspaceId({ nodeId: vmA, nativeId: workspaceNative }),
      encodeSessionId({ nodeId: vmB, nativeId: sessionNative }),
      undefined,
    )).toThrow(/cross-node/)
    expect(() => router.sessionReorder(
      encodeWorkspaceId({ nodeId: vmA, nativeId: workspaceNative }),
      encodeSessionId({ nodeId: vmA, nativeId: sessionNative }),
      encodeSessionId({ nodeId: vmB, nativeId: sessionNative }),
    )).toThrow(/cross-node/)
    ;(denied.node as { state: string }).state = 'STALE'
    expect(() => router.workspaceList(vmA)).toThrow(/not writable\/authoritative/)
  })
})

describe('per-node baseline/generation reconciliation', () => {
  it('buffers the list-subscribe window, uses higher seq only for session domain and requests host refresh', () => {
    const reconcile = new NodeReconciler<string, string, string>(vmA)
    const generation = reconcile.begin()
    reconcile.accept(generation, { domain: 'workspace-upsert', workspaceId: workspaceNative, value: 'event-workspace' })
    reconcile.accept(generation, { domain: 'session', sessionId: sessionNative, seq: 12, value: 'event-12' })
    reconcile.accept(generation, { domain: 'session', sessionId: sessionNative, seq: 8, value: 'old-8' })
    reconcile.installBaseline(generation, {
      workspaces: [{ id: workspaceNative, value: 'baseline-workspace' }],
      statuses: [{ id: sessionNative, value: 'baseline-idle' }],
    }, [{ id: sessionNative, seq: 10, value: 'baseline-10' }])
    expect(reconcile.view()!.ready).toBe(false)
    reconcile.markStreamsReady(generation)
    expect(reconcile.view()!.sessionEvents.get(sessionNative)).toMatchObject({ seq: 12, value: 'event-12' })
    expect(reconcile.view()!.workspaces.get(workspaceNative)).toBe('event-workspace')
    expect(reconcile.view()!.refreshRequired).toBe(true)
    const refresh = reconcile.beginAuthoritativeRefresh(generation)!
    reconcile.accept(generation, { domain: 'workspace-upsert', workspaceId: workspaceNative, value: 'during-refresh' })
    reconcile.accept(generation, { domain: 'status-remove', sessionId: sessionNative })
    reconcile.accept(generation, { domain: 'session', sessionId: sessionNative, seq: 14, value: 'event-14-during-refresh' })
    expect(reconcile.commitAuthoritativeRefresh(
      generation, refresh,
      { workspaces: [], statuses: [{ id: sessionNative, value: 'snapshot-running' }] },
      [{ id: sessionNative, seq: 13, value: 'snapshot-13' }],
    )).toBe(true)
    expect(reconcile.view()!.workspaces.get(workspaceNative)).toBe('during-refresh')
    expect(reconcile.view()!.statuses.has(sessionNative)).toBe(false)
    expect(reconcile.view()!.sessionEvents.get(sessionNative)).toMatchObject({ seq: 14, value: 'event-14-during-refresh' })
    expect(reconcile.view()!.refreshRequired).toBe(false)
  })

  it('rejects old-generation late frames, converges removes and ignores duplicate/lower seq', () => {
    const reconcile = new NodeReconciler<string, string, string>(vmA)
    const old = reconcile.begin()
    const current = reconcile.begin()
    expect(reconcile.accept(old, { domain: 'status', sessionId: sessionNative, value: 'late' })).toBe(false)
    reconcile.installBaseline(current, { workspaces: [{ id: workspaceNative, value: 'exists' }], statuses: [] }, [])
    reconcile.markStreamsReady(current)
    reconcile.accept(current, { domain: 'workspace-remove', workspaceId: workspaceNative })
    reconcile.accept(current, { domain: 'session', sessionId: sessionNative, seq: 5, value: 'five' })
    reconcile.accept(current, { domain: 'session', sessionId: sessionNative, seq: 5, value: 'duplicate-five' })
    expect(reconcile.view()!.workspaces.has(workspaceNative)).toBe(false)
    expect(reconcile.view()!.sessionEvents.get(sessionNative)?.value).toBe('five')
    const refresh = reconcile.beginAuthoritativeRefresh(current)!
    const newerGeneration = reconcile.begin()
    expect(reconcile.commitAuthoritativeRefresh(current, refresh, { workspaces: [], statuses: [] })).toBe(false)
    expect(reconcile.commitAuthoritativeRefresh(newerGeneration, refresh, { workspaces: [], statuses: [] })).toBe(false)
  })
})

describe('write delivery ledger', () => {
  it('never replays sent/unknown writes and reconciles prompt only by exact persistent rpcId', () => {
    const ledger = new WriteLedger()
    const id = 'operation-prompt' as OperationId
    ledger.create({ operationId: id, nodeId: vmA, kind: 'prompt', rpcId: 'rpc-exact' as RpcId })
    ledger.markSent(id)
    expect(ledger.markConnectionLost(id).state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.replayable()).toEqual([])
    // The public diagnostic must not echo the internal operation id, which can
    // embed the caller-supplied rpcId.
    expect(ledger.unknownDiagnostics()).toEqual([{
      operationId: expect.stringMatching(/^op-[0-9a-f]{8}$/),
      nodeId: vmA, kind: 'prompt', state: 'OUTCOME_UNKNOWN',
    }])
    expect(ledger.unknownDiagnostics()[0]!.operationId).not.toContain('rpc-exact')
    expect(ledger.unknownDiagnostics()[0]).not.toHaveProperty('rpcId')
    expect(ledger.unknownDiagnostics()[0]).not.toHaveProperty('sessionId')
    expect(ledger.reconcile(id, { kind: 'prompt-rpc-id', rpcId: 'rpc-other' as RpcId }).state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.reconcile(id, { kind: 'ambiguous-state' }).state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.reconcile(id, { kind: 'prompt-rpc-id', rpcId: 'rpc-exact' as RpcId }).state).toBe('ACCEPTED')
  })

  it('keeps cancel/model unknown indefinitely and accepts exact revision evidence only', () => {
    const ledger = new WriteLedger()
    for (const kind of ['cancel', 'selectModel'] as const) {
      const id = `operation-${kind}` as OperationId
      ledger.create({ operationId: id, nodeId: vmA, kind })
      ledger.markSent(id)
      ledger.markConnectionLost(id)
      expect(ledger.reconcile(id, { kind: 'ambiguous-state' }).state).toBe('OUTCOME_UNKNOWN')
    }
    const revisioned = 'operation-revisioned' as OperationId
    ledger.create({ operationId: revisioned, nodeId: vmA, kind: 'revisioned', expectedRevision: 42 })
    ledger.markSent(revisioned)
    ledger.markConnectionLost(revisioned)
    expect(ledger.reconcile(revisioned, { kind: 'revision', revision: 41 }).state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.reconcile(revisioned, { kind: 'revision', revision: 42 }).state).toBe('ACCEPTED')
    expect(ledger.unknownForNode(vmA)).toHaveLength(2)
  })

  it('marks every in-flight write for one disconnected node unknown without touching others', () => {
    const ledger = new WriteLedger()
    const a = 'in-flight-a' as OperationId
    const b = 'in-flight-b' as OperationId
    const other = 'in-flight-other' as OperationId
    ledger.create({ operationId: a, nodeId: vmA, kind: 'opaque' })
    ledger.create({ operationId: b, nodeId: vmA, kind: 'opaque' })
    ledger.create({ operationId: other, nodeId: vmB, kind: 'opaque' })
    ledger.markSent(a)
    ledger.markSent(b)
    ledger.markSent(other)
    expect(ledger.markConnectionLostForNode(vmA).map(item => item.operationId)).toEqual([a, b])
    expect(ledger.get(other)?.state).toBe('SENT_AWAITING_RESPONSE')
    expect(ledger.replayable()).toEqual([])
  })

  it('models NOT_SENT, ACCEPTED and REJECTED transitions without duplicate side effects', () => {
    const ledger = new WriteLedger()
    const accepted = 'accepted' as OperationId
    const rejected = 'rejected' as OperationId
    ledger.create({ operationId: accepted, nodeId: vmA, kind: 'cancel' })
    ledger.create({ operationId: rejected, nodeId: vmA, kind: 'cancel' })
    expect(ledger.replayable()).toHaveLength(2)
    ledger.markSent(accepted)
    ledger.markAccepted(accepted)
    ledger.markSent(rejected)
    ledger.markRejected(rejected, 'remote denied')
    expect(ledger.get(accepted)?.state).toBe('ACCEPTED')
    expect(ledger.get(rejected)).toMatchObject({ state: 'REJECTED', rejection: 'remote denied' })
    expect(() => ledger.markSent(accepted)).toThrow(/invalid delivery transition/)
  })
})
