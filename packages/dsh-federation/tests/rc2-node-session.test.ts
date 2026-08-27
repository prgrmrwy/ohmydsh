import { describe, expect, it } from 'vitest'
import { WriteLedger, parseNodeId, type OperationId } from '../src/core/index.js'
import {
  establishRc2NodeSession,
  type CarrierSocket, type SocketMessageEvent,
} from '../src/host/index.js'

class FakeSocket implements CarrierSocket {
  readyState = 0
  readonly listeners = new Map<string, ((event?: unknown) => void)[]>()
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: ((event: never) => void) | (() => void)): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener as (event?: unknown) => void)
    this.listeners.set(type, list)
  }
  close(code = 1000, reason = ''): void { this.emit('close', { code, reason }) }
  emit(type: string, event?: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event) }
}

function success(rpcId: string, value: unknown): unknown {
  return { type: 'server-response', rpcId, result: { ok: true, value } }
}

const nodeId = parseNodeId('vm-a')
const workspace = (title: string) => ({
  workspaceId: 'w1', title, path: '/remote', sessionIds: ['s1'],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
})
const eventWorkspace = workspace
const sessions = (title: string, seq: number) => ({ items: [{
  sessionId: 's1', updatedAt: 1, running: false, blank: false, cwd: '/remote',
  projections: { asOfSeq: seq, values: { title } },
}] })

describe('production rc.2 node generation owner', () => {
  it('opens both streams, buffers before baseline, refreshes host races, then publishes an authoritative port', async () => {
    const order: string[] = []
    const sockets: FakeSocket[] = []
    let workspaceReads = 0
    let sessionReads = 0
    let releaseInitial!: () => void
    const initialGate = new Promise<void>(resolve => { releaseInitial = resolve })
    const transport = {
      async request(request: { body?: unknown }) {
        const envelope = request.body as { rpcId: string; method: string }
        order.push(envelope.method)
        if (envelope.method === 'host.describe') return success(envelope.rpcId, { version: '0.0.1', cwd: '/r', home: '/r', attachedSessions: 0, canOpenPath: false })
        if (envelope.method === 'session.search') return success(envelope.rpcId, { items: [], hasMore: false })
        if (envelope.method === 'host.listDirectory') return success(envelope.rpcId, { path: '/r', home: '/r', crumbs: [], entries: [], truncated: false })
        if (envelope.method === 'workspace.list') {
          workspaceReads += 1
          if (workspaceReads === 2) await initialGate
          return success(envelope.rpcId, { items: [workspace(workspaceReads >= 3 ? 'refresh' : 'initial')], archivedSessionIds: [] })
        }
        if (envelope.method === 'session.list') {
          sessionReads += 1
          if (sessionReads === 2) await initialGate
          return success(envelope.rpcId, sessions(sessionReads >= 3 ? 'refresh-title' : 'initial-title', sessionReads >= 3 ? 10 : 5))
        }
        if (envelope.method === 'session.cancel') return success(envelope.rpcId, { accepted: true })
        throw new Error(`unexpected ${envelope.method}`)
      },
    }
    const ledger = new WriteLedger()
    let settled = false
    const establishing = establishRc2NodeSession({
      node: {
        nodeId, kind: 'remote', displayName: 'VM A', enabled: true, order: 0,
        capabilities: new Set(), compatibility: 'INCOMPATIBLE', state: 'CONNECTING',
        sshAlias: 'vm-a', remoteDshPort: 3080,
      },
      endpoint: new URL('http://127.0.0.1:49152'), generation: 9, currentGeneration: () => 9,
      transport, ledger,
      createSocket() { const socket = new FakeSocket(); sockets.push(socket); return socket },
    }).then(value => { settled = true; return value })

    // Probe completes before stream establishment. Open both physical streams,
    // then inject a valid host mutation while initial baseline reads are held.
    while (sockets.length < 2) await new Promise(resolve => setTimeout(resolve, 0))
    sockets[0]!.emit('open')
    expect(settled).toBe(false)
    sockets[1]!.emit('open')
    sockets[1]!.emit('message', { data: JSON.stringify({
      type: 'server-request', rpcId: 'host-race', method: 'host/workspace-changed',
      payload: { type: 'host/workspace-changed', workspace: eventWorkspace('event-before-baseline') },
    }) } satisfies SocketMessageEvent)
    await Promise.resolve()
    expect(settled).toBe(false)
    releaseInitial()

    const session = await establishing
    expect(workspaceReads).toBe(3)
    expect(sessionReads).toBe(3)
    expect(session.reconciler.view()).toMatchObject({ ready: true, refreshRequired: false })
    expect(session.snapshot().workspaces[0]).toMatchObject({
      workspaceId: expect.stringMatching(/^fed1:vm-a:w:/), title: 'refresh',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(session.snapshot().sessions[0]).toMatchObject({
      displayTitle: 'refresh-title', cwd: '/remote', running: false, blank: false, updatedAt: 1, seq: 10,
    })
    expect(session.port.node.state).toBe('READY')
    expect(session.port.capabilities.has('session.write')).toBe(true)

    sockets[1]!.emit('message', { data: JSON.stringify({
      type: 'server-request', rpcId: 'late-refresh', method: 'host/session-added',
      payload: { type: 'host/session-added', sessionId: 's2', blank: true },
    }) } satisfies SocketMessageEvent)
    await Promise.resolve()
    expect(session.port.node.state).toBe('CONNECTING')
    expect(session.isAuthoritative()).toBe(false)
    for (let attempt = 0; attempt < 100 && session.port.node.state === 'CONNECTING'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    expect(workspaceReads).toBe(4)
    expect(sessionReads).toBe(4)
    expect(session.port.node.state).toBe('READY')
    expect(session.isAuthoritative()).toBe(true)
    await session.dispose()
  })

  it('reconciles an unknown prompt only from exact persistent history rpcId evidence', async () => {
    const sockets: FakeSocket[] = []
    const ledger = new WriteLedger()
    const exact = 'prompt:rpc-exact' as OperationId
    const different = 'prompt:rpc-different' as OperationId
    for (const [operationId, rpcId] of [[exact, 'rpc-exact'], [different, 'rpc-different']] as const) {
      ledger.create({ operationId, nodeId, kind: 'prompt', rpcId: rpcId as never, sessionId: 's1' as never })
      ledger.markSent(operationId)
      ledger.markConnectionLost(operationId)
    }
    let historyReads = 0
    const transport = {
      async request(request: { body?: unknown }) {
        const envelope = request.body as { rpcId: string; method: string; payload?: { beforeSeq?: number } }
        if (envelope.method === 'host.describe') return success(envelope.rpcId, { version: '0.0.1', cwd: '/r', home: '/r', attachedSessions: 0, canOpenPath: false })
        if (envelope.method === 'workspace.list') return success(envelope.rpcId, { items: [workspace('W')], archivedSessionIds: [] })
        if (envelope.method === 'session.list') return success(envelope.rpcId, sessions('S', 3))
        if (envelope.method === 'session.search') return success(envelope.rpcId, { items: [], hasMore: false })
        if (envelope.method === 'host.listDirectory') return success(envelope.rpcId, { path: '/r', home: '/r', crumbs: [], entries: [], truncated: false })
        if (envelope.method === 'session.history') {
          historyReads += 1
          if (envelope.payload?.beforeSeq === undefined) return success(envelope.rpcId, {
            events: [{ event: { type: 'user/message', seq: 10, time: 1, data: {
              role: 'user', content: [{ type: 'text', text: 'same content is not the oracle' }], source: { kind: 'user', rpcId: 'remote-other-client' },
            } } }], hasMore: true,
          })
          expect(envelope.payload.beforeSeq).toBe(10)
          return success(envelope.rpcId, {
            events: [{ event: { type: 'user/message', seq: 3, time: 1, data: {
              role: 'user', content: [{ type: 'text', text: 'same content is not the oracle' }], source: { kind: 'user', rpcId: 'rpc-exact' },
            } } }], hasMore: false,
          })
        }
        throw new Error(`unexpected ${envelope.method}`)
      },
    }
    const establishing = establishRc2NodeSession({
      node: { nodeId, kind: 'remote', displayName: 'VM A', enabled: true, order: 0, capabilities: new Set(), compatibility: 'INCOMPATIBLE', state: 'CONNECTING' },
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      transport, ledger,
      createSocket() { const socket = new FakeSocket(); sockets.push(socket); return socket },
    })
    while (sockets.length < 2) await new Promise(resolve => setTimeout(resolve, 0))
    sockets.forEach(socket => socket.emit('open'))
    const session = await establishing
    expect(historyReads).toBeGreaterThanOrEqual(2)
    expect(ledger.get(exact)?.state).toBe('ACCEPTED')
    expect(ledger.get(different)?.state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.replayable()).toEqual([])
    await session.dispose()
  })

  it('refuses to publish when a stream disconnects during final unknown-prompt history reconciliation', async () => {
    const sockets: FakeSocket[] = []
    const ledger = new WriteLedger()
    const operationId = 'prompt:late-history' as OperationId
    ledger.create({ operationId, nodeId, kind: 'prompt', rpcId: 'late-history' as never, sessionId: 's1' as never })
    ledger.markSent(operationId)
    ledger.markConnectionLost(operationId)
    let historyEntered = false
    const transport = {
      async request(request: { body?: unknown }) {
        const envelope = request.body as { rpcId: string; method: string }
        if (envelope.method === 'host.describe') return success(envelope.rpcId, { version: '0.0.1', cwd: '/r', home: '/r', attachedSessions: 0, canOpenPath: false })
        if (envelope.method === 'workspace.list') return success(envelope.rpcId, { items: [workspace('W')], archivedSessionIds: [] })
        if (envelope.method === 'session.list') return success(envelope.rpcId, sessions('S', 3))
        if (envelope.method === 'session.search') return success(envelope.rpcId, { items: [], hasMore: false })
        if (envelope.method === 'host.listDirectory') return success(envelope.rpcId, { path: '/r', home: '/r', crumbs: [], entries: [], truncated: false })
        if (envelope.method === 'session.history') {
          historyEntered = true
          sockets[0]!.emit('close', { code: 1006, reason: 'lost during history' })
          return success(envelope.rpcId, { events: [], hasMore: false })
        }
        throw new Error(`unexpected ${envelope.method}`)
      },
    }
    const establishing = establishRc2NodeSession({
      node: { nodeId, kind: 'remote', displayName: 'VM A', enabled: true, order: 0, capabilities: new Set(), compatibility: 'INCOMPATIBLE', state: 'CONNECTING' },
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      transport, ledger,
      createSocket() { const socket = new FakeSocket(); sockets.push(socket); return socket },
    })
    while (sockets.length < 2) await new Promise(resolve => setTimeout(resolve, 0))
    sockets.forEach(socket => socket.emit('open'))
    await expect(establishing).rejects.toThrow(/disconnected.*publication|generation/i)
    expect(historyEntered).toBe(true)
  })

  it('marks in-flight writes unknown and reports disconnect without automatic replay', async () => {
    const sockets: FakeSocket[] = []
    const ledger = new WriteLedger()
    const id = 'in-flight' as OperationId
    ledger.create({ operationId: id, nodeId, kind: 'opaque' })
    ledger.markSent(id)
    const disconnects: unknown[] = []
    const transport = {
      async request(request: { body?: unknown }) {
        const envelope = request.body as { rpcId: string; method: string }
        if (envelope.method === 'host.describe') return success(envelope.rpcId, { version: '0.0.1', cwd: '/r', home: '/r', attachedSessions: 0, canOpenPath: false })
        if (envelope.method === 'workspace.list') return success(envelope.rpcId, { items: [], archivedSessionIds: [] })
        if (envelope.method === 'session.list') return success(envelope.rpcId, { items: [] })
        if (envelope.method === 'session.search') return success(envelope.rpcId, { items: [], hasMore: false })
        if (envelope.method === 'host.listDirectory') return success(envelope.rpcId, { path: '/r', home: '/r', crumbs: [], entries: [], truncated: false })
        throw new Error(`unexpected ${envelope.method}`)
      },
    }
    const establishing = establishRc2NodeSession({
      node: { nodeId, kind: 'remote', displayName: 'VM A', enabled: true, order: 0, capabilities: new Set(), compatibility: 'INCOMPATIBLE', state: 'CONNECTING' },
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      transport, ledger, onDisconnect: event => { disconnects.push(event) },
      createSocket() { const socket = new FakeSocket(); sockets.push(socket); return socket },
    })
    while (sockets.length < 2) await new Promise(resolve => setTimeout(resolve, 0))
    sockets.forEach(socket => socket.emit('open'))
    const session = await establishing
    expect(session.isAuthoritative()).toBe(true)
    sockets[0]!.emit('close', { code: 1006, reason: 'network' })
    expect(session.isAuthoritative()).toBe(false)
    expect(disconnects).toHaveLength(1)
    expect(ledger.get(id)?.state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.replayable()).toEqual([])
    await session.dispose()
  })
})
