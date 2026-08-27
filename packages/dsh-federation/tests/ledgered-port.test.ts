import { describe, expect, it } from 'vitest'
import {
  WriteLedger, parseNodeId,
  type DshNodePort, type NativeSessionId, type NativeWorkspaceId, type NodeCapability, type RpcId,
} from '../src/core/index.js'
import { LedgeredNodePort, RemoteBusinessError, notifySendAttempt } from '../src/host/index.js'

const nodeId = parseNodeId('vm-a')
const capabilities = new Set<NodeCapability>(['workspace.read', 'workspace.write', 'session.read', 'session.write'])

function inner(overrides: Partial<DshNodePort> = {}): DshNodePort {
  const ok = async () => undefined
  return {
    node: { nodeId, kind: 'remote', displayName: 'VM A', enabled: true, order: 0, capabilities, compatibility: 'SUPPORTED', state: 'READY' },
    capabilities,
    listWorkspaces: async () => [], createWorkspace: async () => ({} as never), renameWorkspace: async () => ({} as never),
    deleteWorkspace: ok, reorderWorkspace: ok, reorderSession: ok,
    listSessions: async () => [], createSession: async () => 'new' as NativeSessionId,
    history: async () => ({}), models: async () => ({}), prompt: ok, cancel: ok,
    renameSession: async () => ({ title: 'x', seq: 1 }), forkSession: async () => 'fork' as NativeSessionId,
    selectModel: async () => ({}), updateQueue: ok, attachment: async () => ({}), search: async () => [],
    archiveSession: ok, respond: ok,
    ...overrides,
  }
}

describe('production write ledger port', () => {
  it('records prompt by persistent rpcId and accepts only after a response', async () => {
    const ledger = new WriteLedger()
    const port = new LedgeredNodePort(inner(), ledger)
    await port.prompt({ sessionId: 's1' as NativeSessionId, rpcId: 'rpc-1' as RpcId, mode: 'queue', content: [] })
    expect(ledger.get('prompt:rpc-1' as never)).toMatchObject({
      state: 'ACCEPTED', rpcId: 'rpc-1', sessionId: 's1', kind: 'prompt', nodeId,
    })
  })

  it('marks remote business rejection REJECTED and transport loss OUTCOME_UNKNOWN without replay', async () => {
    const ledger = new WriteLedger()
    const rejected = new LedgeredNodePort(inner({
      renameWorkspace: async () => { throw new RemoteBusinessError('workspace.rename', { code: 'conflict' }) },
    }), ledger)
    await expect(rejected.renameWorkspace('w1' as NativeWorkspaceId, 'x')).rejects.toBeInstanceOf(RemoteBusinessError)
    expect([...ledger.unknownForNode(nodeId)]).toHaveLength(0)

    const lost = new LedgeredNodePort(inner({ cancel: async (_sessionId, options) => { notifySendAttempt(options); throw new Error('socket reset') } }), ledger)
    await expect(lost.cancel('s1' as NativeSessionId)).rejects.toThrow('socket reset')
    expect(ledger.unknownForNode(nodeId)).toHaveLength(1)
    expect(ledger.replayable()).toEqual([])
  })

  it('refuses a send admitted before refresh when node state changes at the actual attempt boundary', async () => {
    const ledger = new WriteLedger()
    const base = inner({ cancel: async (_sessionId, options) => { notifySendAttempt(options) } })
    const dynamic = { ...base, node: { ...base.node, state: 'READY' as const } }
    const port = new LedgeredNodePort(dynamic, ledger)
    dynamic.node.state = 'CONNECTING' as never
    await expect(port.cancel('s1' as NativeSessionId)).rejects.toThrow(/not writable/i)
    expect(ledger.replayable()).toHaveLength(1)
    expect(ledger.unknownForNode(nodeId)).toEqual([])
  })

  it('never exposes the browser-supplied rpcId through retained diagnostics', async () => {
    const ledger = new WriteLedger()
    const port = new LedgeredNodePort(inner({
      prompt: async (_command, options) => { notifySendAttempt(options); throw new Error('lost') },
    }), ledger)
    await expect(port.prompt({
      sessionId: 'sess-secret' as NativeSessionId,
      rpcId: 'rpc-topsecret-abc123' as RpcId,
      mode: 'queue',
      content: [],
    })).rejects.toThrow('lost')

    // Diagnostics are the one surface that survives node deletion and reaches
    // the browser, so they must carry no correlatable request identity.
    const diagnostics = ledger.unknownDiagnostics()
    expect(diagnostics).toHaveLength(1)
    const serialized = JSON.stringify(diagnostics)
    expect(serialized).not.toContain('rpc-topsecret-abc123')
    expect(serialized).not.toContain('sess-secret')

    // Internal correlation must still work for exact reconciliation.
    expect(ledger.unknownForNode(nodeId)[0]).toMatchObject({
      rpcId: 'rpc-topsecret-abc123', sessionId: 'sess-secret',
    })
  })

  it('keeps a pre-send failure NOT_SENT and marks transport loss unknown only after send attempt', async () => {
    const ledger = new WriteLedger()
    const preflight = new LedgeredNodePort(inner({ cancel: async () => { throw new Error('stale before fetch') } }), ledger)
    await expect(preflight.cancel('s1' as NativeSessionId)).rejects.toThrow('stale before fetch')
    expect(ledger.replayable()).toHaveLength(1)
    expect(ledger.replayable()[0]?.state).toBe('NOT_SENT')

    const attempted = new LedgeredNodePort(inner({
      cancel: async (_sessionId, options) => { notifySendAttempt(options); throw new Error('socket reset after fetch') },
    }), ledger)
    await expect(attempted.cancel('s2' as NativeSessionId)).rejects.toThrow('socket reset after fetch')
    expect(ledger.unknownForNode(nodeId)).toHaveLength(1)
  })

  it('accepts a late explicit business rejection after disconnect marked the write unknown', async () => {
    const ledger = new WriteLedger()
    let rejectBusiness!: () => void
    const port = new LedgeredNodePort(inner({
      cancel: async (_sessionId, options) => {
        notifySendAttempt(options)
        return new Promise<void>((_resolve, reject) => {
          rejectBusiness = () => reject(new RemoteBusinessError('session.cancel', { code: 'already-idle' }))
        })
      },
    }), ledger)
    const pending = port.cancel('s1' as NativeSessionId)
    await Promise.resolve()
    expect(ledger.markConnectionLostForNode(nodeId)).toHaveLength(1)
    rejectBusiness()
    await expect(pending).rejects.toBeInstanceOf(RemoteBusinessError)
    expect(ledger.unknownForNode(nodeId)).toEqual([])
    expect(ledger.replayable()).toEqual([])
  })

  it('marks all concurrent in-flight writes unknown on stream disconnect', async () => {
    const ledger = new WriteLedger()
    let lose!: () => void
    const blocked = new Promise<void>((_resolve, reject) => { lose = () => reject(new Error('disconnected')) })
    const port = new LedgeredNodePort(inner({ cancel: (_sessionId, options) => { notifySendAttempt(options); return blocked } }), ledger)
    const pending = port.cancel('s1' as NativeSessionId)
    await Promise.resolve()
    expect(ledger.markConnectionLostForNode(nodeId)).toHaveLength(1)
    lose()
    await expect(pending).rejects.toThrow('disconnected')
    expect(ledger.unknownForNode(nodeId)).toHaveLength(1)
  })
})
