import { describe, expect, it, vi } from 'vitest'
import { FederationBridge, type FederatedNodeFacts, type NodeRuntimeBinding } from '../src/client/bridge.js'
import { parseNodeId } from '../src/core/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')

function facts(overrides: Partial<FederatedNodeFacts> = {}): FederatedNodeFacts {
  return {
    nodeId: local, displayName: 'This Mac', kind: 'local', enabled: true, order: 0,
    state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0, pendingInteractionCount: 0,
    ...overrides,
  }
}

/** A binding whose contents do not matter here; only presence does. */
const stubBinding = {} as NodeRuntimeBinding

function rpcReturning(value: unknown, ok = true) {
  return { call: vi.fn(async () => (ok ? { ok: true, value } : { ok: false, error: { message: 'denied' } })) }
}

describe('federated client bridge readiness', () => {
  it('becomes ready only when every enabled node has a binding', async () => {
    const rpc = rpcReturning({ nodes: [facts(), facts({ nodeId: vmA, kind: 'remote', displayName: 'VM A' })] })
    const bridge = new FederationBridge({ rpc, bindingFor: () => stubBinding })
    expect(bridge.ready()).toBe(false)
    expect(await bridge.refresh()).toBe(true)
    expect(bridge.ready()).toBe(true)
    expect(bridge.nodes().map(node => node.nodeId)).toEqual([local, vmA])
    expect(rpc.call).toHaveBeenCalledWith('/api', 'federation/nodes', {}, undefined)
  })

  it('stays not-ready when an enabled node has no binding', async () => {
    const rpc = rpcReturning({ nodes: [facts(), facts({ nodeId: vmA, kind: 'remote' })] })
    const bridge = new FederationBridge({ rpc, bindingFor: node => (node.kind === 'local' ? stubBinding : undefined) })
    expect(await bridge.refresh()).toBe(false)
    expect(bridge.ready()).toBe(false)
    expect(bridge.diagnostic).toMatch(/missing runtime binding for vm-a/)
    // The node list is still published so the shell can show diagnostics.
    expect(bridge.nodes()).toHaveLength(2)
  })

  it('stays not-ready with no enabled node, a failed call, or a thrown transport', async () => {
    const disabled = new FederationBridge({
      rpc: rpcReturning({ nodes: [facts({ enabled: false })] }),
      bindingFor: () => stubBinding,
    })
    expect(await disabled.refresh()).toBe(false)
    expect(disabled.diagnostic).toMatch(/no enabled federation node/)

    const denied = new FederationBridge({ rpc: rpcReturning({}, false), bindingFor: () => stubBinding })
    expect(await denied.refresh()).toBe(false)
    expect(denied.diagnostic).toBe('denied')

    const thrown = new FederationBridge({
      rpc: { call: async () => { throw new Error('transport lost') } },
      bindingFor: () => stubBinding,
    })
    expect(await thrown.refresh()).toBe(false)
    expect(thrown.diagnostic).toBe('transport lost')
    expect(thrown.ready()).toBe(false)
  })

  it('ignores malformed node entries instead of trusting them', async () => {
    const rpc = rpcReturning({
      nodes: [
        facts(),
        { nodeId: '', kind: 'local' },
        { nodeId: 'no-kind' },
        { nodeId: 'bad-kind', kind: 'sideways' },
        'not-an-object',
      ],
    })
    const bridge = new FederationBridge({ rpc, bindingFor: () => stubBinding })
    expect(await bridge.refresh()).toBe(true)
    expect(bridge.nodes().map(node => node.nodeId)).toEqual([local])
  })

  it('defaults unknown state/compatibility conservatively', async () => {
    const rpc = rpcReturning({ nodes: [{ nodeId: 'vm-x', kind: 'remote', enabled: true }] })
    const bridge = new FederationBridge({ rpc, bindingFor: () => stubBinding })
    await bridge.refresh()
    const [node] = bridge.nodes()
    expect(node!.state).toBe('CONNECTING')
    expect(node!.compatibility).toBe('INCOMPATIBLE')
    expect(node!.displayName).toBe('vm-x')
  })

  it('invalidate drops readiness but keeps the last known nodes', async () => {
    const onChange = vi.fn()
    const bridge = new FederationBridge({
      rpc: rpcReturning({ nodes: [facts()] }), bindingFor: () => stubBinding, onChange,
    })
    await bridge.refresh()
    expect(bridge.ready()).toBe(true)
    bridge.invalidate('tunnel lost')
    expect(bridge.ready()).toBe(false)
    expect(bridge.diagnostic).toBe('tunnel lost')
    expect(bridge.nodes()).toHaveLength(1)
    expect(onChange).toHaveBeenCalled()
  })
})
