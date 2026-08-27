import { describe, expect, it, vi } from 'vitest'
import {
  encodeSessionId,
  encodeWorkspaceId,
  parseNodeId,
  type FederatedSessionId,
  type FederatedWorkspaceId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeId,
  type SearchResult,
} from '../src/core/index.js'
import {
  FederatedSearchCoordinator,
  NodeBindingError,
  NodeDirectoryFlow,
  SEARCH_RESULT_LIMIT,
  aggregateNodeRows,
  bindNodeActions,
  decideNodeDrag,
  decideSessionDrag,
  decideUngroupedDrag,
  decideWorkspaceDrag,
  deriveNodeRow,
  mergeSearchOutcomes,
  nodeSectionKey,
  orderNodeRows,
  overlayNamespaceOf,
  showsDropMarker,
  type NodeCommandSink,
  type NodeRowInput,
} from '../src/client/shell/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')
const known = new Set<NodeId>([local, vmA, vmB])

const wsA = encodeWorkspaceId({ nodeId: vmA, nativeId: 'shared' as NativeWorkspaceId })
const wsB = encodeWorkspaceId({ nodeId: vmB, nativeId: 'shared' as NativeWorkspaceId })
const sessA = encodeSessionId({ nodeId: vmA, nativeId: 'shared' as NativeSessionId })
const sessA2 = encodeSessionId({ nodeId: vmA, nativeId: 'second' as NativeSessionId })
const sessB = encodeSessionId({ nodeId: vmB, nativeId: 'shared' as NativeSessionId })

function rowInput(overrides: Partial<NodeRowInput> = {}): NodeRowInput {
  return {
    nodeId: vmA, displayName: 'VM A', kind: 'remote', enabled: true, order: 1,
    state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0, pendingInteractionCount: 0, outcomeUnknownCount: 0,
    ...overrides,
  }
}

describe('node rows and aggregates (7.2, 7.10)', () => {
  it('maps every node state to a status, writability and skeleton posture', () => {
    expect(deriveNodeRow(rowInput())).toMatchObject({ status: 'online', writable: true, showsSkeleton: false })
    expect(deriveNodeRow(rowInput({ state: 'CONNECTING' }))).toMatchObject({ status: 'connecting', writable: false })
    expect(deriveNodeRow(rowInput({ state: 'DEGRADED' }))).toMatchObject({ status: 'degraded', writable: true })
    expect(deriveNodeRow(rowInput({ state: 'INCOMPATIBLE' }))).toMatchObject({ status: 'incompatible', writable: false })
    expect(deriveNodeRow(rowInput({ state: 'SSH_UNREACHABLE' }))).toMatchObject({ status: 'offline', writable: false, showsSkeleton: true })
    expect(deriveNodeRow(rowInput({ state: 'STALE' }))).toMatchObject({ status: 'stale', writable: false, showsSkeleton: true })
    expect(deriveNodeRow(rowInput({ enabled: false }))).toMatchObject({ status: 'disabled', writable: false, expandable: false })
    expect(deriveNodeRow(rowInput({ state: 'READY', compatibility: 'INCOMPATIBLE' })).writable).toBe(false)
  })

  it('keeps central persisted order and aggregates running/pending counts', () => {
    const rows = orderNodeRows([
      deriveNodeRow(rowInput({ nodeId: vmB, order: 2, runningSessionCount: 1, pendingInteractionCount: 2 })),
      deriveNodeRow(rowInput({ nodeId: local, kind: 'local', order: 0, runningSessionCount: 3 })),
      deriveNodeRow(rowInput({ nodeId: vmA, order: 1, state: 'SSH_UNREACHABLE' })),
    ])
    expect(rows.map(row => row.nodeId)).toEqual([local, vmA, vmB])
    expect(aggregateNodeRows(rows)).toEqual({ runningSessionCount: 4, pendingInteractionCount: 2, onlineNodeCount: 2, failingNodeCount: 1 })
  })

  it('derives collision-safe CSS namespaces and stable keys', () => {
    expect(overlayNamespaceOf(vmA)).toBe('n-vm-a')
    expect(overlayNamespaceOf(parseNodeId('node_1'))).toBe('n-node_1')
    expect(overlayNamespaceOf(vmA)).not.toBe(overlayNamespaceOf(vmB))
    expect(nodeSectionKey(vmA)).toBe('fed1-node:vm-a')
  })
})

describe('node-scoped action binding (7.1, 7.4)', () => {
  function sink(calls: unknown[][]): NodeCommandSink {
    const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return Promise.resolve() }
    return {
      startSession: (...args) => { calls.push(['startSession', ...args]) },
      open: (...args) => { calls.push(['open', ...args]) },
      forkSession: (...args) => { calls.push(['forkSession', ...args]) },
      renameSession: record('renameSession'),
      renameWorkspace: record('renameWorkspace'),
      deleteWorkspace: record('deleteWorkspace'),
      insertWorkspaceBefore: record('insertWorkspaceBefore'),
      archiveSession: record('archiveSession'),
      insertSessionBefore: record('insertSessionBefore'),
    } as unknown as NodeCommandSink
  }

  it('binds every official action to its owning node id', async () => {
    const calls: unknown[][] = []
    const actions = bindNodeActions({ nodeId: vmA, knownNodes: known, writable: true, sink: sink(calls) })
    actions.startSession(wsA)
    actions.open(sessA)
    actions.forkSession(sessA)
    await actions.renameSession(sessA, 'renamed')
    await actions.renameWorkspace(wsA, 'renamed')
    await actions.deleteWorkspace(wsA)
    await actions.insertWorkspaceBefore(wsA, undefined)
    await actions.archiveSession(sessA)
    await actions.insertSessionBefore(wsA, sessA, sessA2)
    expect(calls.every(([, nodeId]) => nodeId === vmA)).toBe(true)
    expect(calls.map(([name]) => name)).toEqual([
      'startSession', 'open', 'forkSession', 'renameSession', 'renameWorkspace',
      'deleteWorkspace', 'insertWorkspaceBefore', 'archiveSession', 'insertSessionBefore',
    ])
  })

  it('refuses foreign ids and every mutation on a non-writable node', async () => {
    const calls: unknown[][] = []
    const actions = bindNodeActions({ nodeId: vmA, knownNodes: known, writable: true, sink: sink(calls) })
    expect(() => actions.startSession(wsB)).toThrow(NodeBindingError)
    await expect(actions.insertSessionBefore(wsA, sessA, sessB)).rejects.toThrow(/not owned by node/)
    expect(() => actions.open(sessB)).toThrow(/not owned by node/)

    // Foreign ids are rejected before any command reaches the sink.
    expect(calls).toEqual([])

    const readOnlyCalls: unknown[][] = []
    const readOnly = bindNodeActions({ nodeId: vmA, knownNodes: known, writable: false, sink: sink(readOnlyCalls) })
    readOnly.open(sessA)
    expect(() => readOnly.startSession(wsA)).toThrow(/not currently writable/)
    await expect(readOnly.archiveSession(sessA)).rejects.toThrow(/not currently writable/)
    expect(readOnlyCalls.map(([name]) => name)).toEqual(['open'])
  })
})

describe('drag scope (7.9)', () => {
  const writable = new Set<NodeId>([local, vmA, vmB])
  const membership = (id: FederatedSessionId): FederatedWorkspaceId | undefined =>
    id === sessA || id === sessA2 ? wsA : id === sessB ? wsB : undefined

  it('allows node, same-node workspace and same-workspace session reorders', () => {
    expect(decideNodeDrag(vmA, vmB, known)).toMatchObject({ allowed: true, kind: 'node' })
    expect(decideWorkspaceDrag(wsA, undefined, known, writable)).toMatchObject({ allowed: true, kind: 'workspace', nodeId: vmA })
    expect(decideSessionDrag(wsA, sessA, sessA2, membership, known, writable)).toMatchObject({ allowed: true, kind: 'session' })
    expect(decideUngroupedDrag()).toEqual({ allowed: true, kind: 'browser-local' })
  })

  it('shows no marker and sends no RPC across nodes, workspaces or unwritable nodes', () => {
    const crossNodeWorkspace = decideWorkspaceDrag(wsA, wsB, known, writable)
    const crossNodeSession = decideSessionDrag(wsA, sessA, sessB, membership, known, writable)
    const crossWorkspace = decideSessionDrag(wsB, sessB, undefined, () => wsA, known, writable)
    const unknownId = decideWorkspaceDrag('fed1:ghost:w:c2hhcmVk' as FederatedWorkspaceId, undefined, known, writable)
    const notWritable = decideWorkspaceDrag(wsA, undefined, known, new Set([vmB]))
    for (const decision of [crossNodeWorkspace, crossNodeSession, crossWorkspace, unknownId, notWritable]) {
      expect(decision.allowed).toBe(false)
      expect(showsDropMarker(decision)).toBe(false)
    }
    expect(crossNodeWorkspace).toMatchObject({ reason: 'cross-node' })
    expect(crossWorkspace).toMatchObject({ reason: 'cross-workspace' })
    expect(unknownId).toMatchObject({ reason: 'unknown-id' })
    expect(notWritable).toMatchObject({ reason: 'not-writable' })
  })
})

describe('federated search coordinator (7.7, 7.8)', () => {
  function result(nodeId: NodeId, native: string, title: string, path: string, snippet?: string): SearchResult {
    const id = encodeSessionId({ nodeId, nativeId: native as NativeSessionId })
    return {
      session: { ref: { nodeId, nativeId: native as NativeSessionId }, id, title, path, status: 'idle', archived: false },
      ...(snippet === undefined ? {} : { snippet }),
    }
  }
  const context = {
    nodeDisplayName: (nodeId: NodeId) => (nodeId === vmA ? 'VM A' : 'VM B'),
    workspaceTitle: (sessionId: FederatedSessionId) => (sessionId === sessA ? 'Backend' : undefined),
  }

  it('merges nodes, ranks metadata hits first and keeps node/workspace context', () => {
    const merged = mergeSearchOutcomes('shared', [
      { nodeId: vmB, results: [result(vmB, 'shared', 'content only', '/b', 'has shared inside')], failed: false },
      { nodeId: vmA, results: [result(vmA, 'shared', 'shared title', '/a', 'snippet')], failed: false },
    ], context)
    expect(merged.rows.map(row => [row.nodeDisplayName, row.matchedMetadata])).toEqual([['VM A', true], ['VM B', false]])
    expect(merged.rows[0]).toMatchObject({ sessionId: sessA, workspaceTitle: 'Backend', snippet: 'snippet' })
    expect(merged.failedNodes).toEqual([])
    expect(merged.hasMore).toBe(false)
  })

  it('caps results at 20, reports hasMore and never hides other nodes on partial failure', () => {
    const many = Array.from({ length: 25 }, (_, index) => result(vmA, `s-${index}`, `shared ${index}`, '/a'))
    const merged = mergeSearchOutcomes('shared', [
      { nodeId: vmA, results: many, failed: false },
      { nodeId: vmB, results: [], failed: true, diagnostic: 'node search timed out' },
    ], context)
    expect(merged.rows.length).toBe(SEARCH_RESULT_LIMIT)
    expect(merged.hasMore).toBe(true)
    expect(merged.failedNodes).toEqual([{ nodeId: vmB, diagnostic: 'node search timed out' }])
  })

  it('does not confuse identical native ids from different nodes', () => {
    const merged = mergeSearchOutcomes('shared', [
      { nodeId: vmA, results: [result(vmA, 'shared', 'same title', '/same')], failed: false },
      { nodeId: vmB, results: [result(vmB, 'shared', 'same title', '/same')], failed: false },
    ], context)
    expect(new Set(merged.rows.map(row => row.sessionId)).size).toBe(2)
    expect(merged.rows.map(row => row.nodeId).sort()).toEqual([vmA, vmB].sort())
  })

  it('debounces, aborts a superseded round and isolates a per-node timeout', async () => {
    vi.useFakeTimers()
    try {
      const searchNode = vi.fn(async (nodeId: NodeId, _query: string, signal: AbortSignal) => {
        if (nodeId === vmB) {
          await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
          return []
        }
        return [result(vmA, 'shared', 'shared title', '/a')]
      })
      const coordinator = new FederatedSearchCoordinator({ searchNode, context, debounceMs: 250, perNodeTimeoutMs: 100 })
      const superseded = coordinator.search('sha', [vmA, vmB])
      void superseded.catch(() => {})
      await vi.advanceTimersByTimeAsync(100)
      expect(searchNode).not.toHaveBeenCalled()

      const pending = coordinator.search('shared', [vmA, vmB])
      await vi.advanceTimersByTimeAsync(250)
      expect(searchNode).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(100)
      const merged = await pending
      expect(merged.rows.map(row => row.nodeId)).toEqual([vmA])
      expect(merged.failedNodes).toEqual([{ nodeId: vmB, diagnostic: 'node search timed out' }])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('node-bound directory flow (7.5)', () => {
  const level = { path: '/remote/project', home: '/remote', crumbs: [], entries: [{ name: '.hidden', path: '/remote/project/.hidden', hidden: true }, { name: 'src', path: '/remote/project/src', hidden: false }], truncated: false }

  it('always binds the node id, exposes browse for remote and native only for This Mac', async () => {
    const calls: unknown[][] = []
    const port = {
      listDirectory: async (nodeId: NodeId, path: string | undefined) => { calls.push(['list', nodeId, path]); return level },
      createDirectory: async (nodeId: NodeId, path: string, name: string) => { calls.push(['create', nodeId, path, name]); return { path: `${path}/${name}` } },
    }
    const remote = new NodeDirectoryFlow({ nodeId: vmA, mode: 'browse', port })
    expect(remote.usesNativeChooser).toBe(false)
    await remote.open()
    expect(calls[0]).toEqual(['list', vmA, undefined])
    expect(remote.visibleEntries().map(entry => entry.name)).toEqual(['src'])
    remote.setShowHidden(true)
    expect(remote.visibleEntries().map(entry => entry.name)).toEqual(['.hidden', 'src'])
    expect(new NodeDirectoryFlow({ nodeId: local, mode: 'native', port }).usesNativeChooser).toBe(true)
  })

  it('keeps a failure retryable against the same node instead of falling back locally', async () => {
    let fail = true
    const flow = new NodeDirectoryFlow({
      nodeId: vmA, mode: 'browse',
      port: {
        listDirectory: async () => { if (fail) throw new Error('tunnel closed'); return level },
        createDirectory: async () => ({ path: '/remote/project/new' }),
      },
    })
    expect(await flow.open('/remote/project')).toMatchObject({ kind: 'error', message: 'tunnel closed', retryPath: '/remote/project' })
    fail = false
    expect(await flow.retry()).toMatchObject({ kind: 'ready' })
  })

  it('creates exactly one level and rejects a multi-segment name', async () => {
    const created: unknown[][] = []
    const flow = new NodeDirectoryFlow({
      nodeId: vmA, mode: 'browse',
      port: {
        listDirectory: async () => level,
        createDirectory: async (nodeId, path, name) => { created.push([nodeId, path, name]); return { path: `${path}/${name}` } },
      },
    })
    await flow.open('/remote/project')
    expect(await flow.createChild('a/b')).toMatchObject({ kind: 'error', message: /single path segment/ })
    expect(created).toEqual([])
    await flow.open('/remote/project')
    expect(await flow.createChild('child')).toMatchObject({ kind: 'ready' })
    expect(created).toEqual([[vmA, '/remote/project', 'child']])
  })
})
