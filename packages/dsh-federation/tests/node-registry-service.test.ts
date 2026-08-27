import { mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WriteLedger, parseNodeId, type OperationId } from '../src/core/index.js'
import { NodeRegistryService, NodeDeletionRequiresConfirmation, RetainedDiagnosticsStore } from '../src/host/index.js'

let home: string
const disposed: string[] = []
const tunnels = { disposeNode: async (nodeId: string) => { disposed.push(nodeId) } }

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'federation-registry-service-'))
  disposed.length = 0
})
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

function service(options: {
  identity?: (alias: string) => Promise<{ ok: boolean; diagnostic: string }>
  ledger?: WriteLedger
  diagnostics?: RetainedDiagnosticsStore
} = {}) {
  return new NodeRegistryService({
    dshHome: home,
    ledger: options.ledger ?? new WriteLedger(),
    tunnels: tunnels as never,
    probeIdentity: options.identity ?? (async () => ({ ok: true, diagnostic: 'authenticated' })),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
  })
}

describe('production node registry management', () => {
  it('saves a node only after non-interactive SSH identity succeeds', async () => {
    const rejecting = service({ identity: async () => ({ ok: false, diagnostic: 'password prompt refused' }) })
    await expect(rejecting.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 }))
      .rejects.toThrow(/password prompt refused/)
    expect((await rejecting.list()).nodes.filter(node => node.kind === 'remote')).toHaveLength(0)

    const accepting = service()
    const created = await accepting.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
    expect(created.kind).toBe('remote')
    const listed = await accepting.list()
    expect(listed.nodes.some(node => node.nodeId === created.nodeId)).toBe(true)
  })

  it('keeps the node id stable across rename, alias change, reorder and disable', async () => {
    const registry = service()
    const first = await registry.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
    const second = await registry.addNode({ displayName: 'VM B', sshAlias: 'vm-b', remoteDshPort: 3080 })
    await registry.updateNode(first.nodeId, { displayName: 'Renamed', sshAlias: 'vm-a2', enabled: false })
    await registry.reorderNode(second.nodeId, first.nodeId)
    const listed = await registry.list()
    const remotes = listed.nodes.filter(node => node.kind === 'remote')
    expect(remotes.map(node => node.nodeId)).toEqual([second.nodeId, first.nodeId])
    expect(remotes.find(node => node.nodeId === first.nodeId)).toMatchObject({
      displayName: 'Renamed', sshAlias: 'vm-a2', enabled: false,
    })
  })

  // The storage lock waits out a full stale window before reporting CONFLICT.
  it('retains redacted diagnostics across a restart until explicitly cleared', async () => {
    const ledger = new WriteLedger()
    const diagnostics = new RetainedDiagnosticsStore(home)
    const registry = service({ ledger, diagnostics })
    const node = await registry.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
    const operationId = 'prompt:rpc-secret-xyz' as OperationId
    ledger.create({ operationId, nodeId: parseNodeId(node.nodeId), kind: 'prompt', rpcId: 'rpc-secret-xyz' as never })
    ledger.markSent(operationId)
    ledger.markConnectionLost(operationId)
    await registry.removeNode(node.nodeId, true)

    // A new process (fresh ledger and store) must still see the evidence, or a
    // deleted node would be misread as proof the write never ran.
    const afterRestart = await new RetainedDiagnosticsStore(home).list()
    expect(afterRestart).toHaveLength(1)
    expect(afterRestart[0]).toMatchObject({ kind: 'prompt', state: 'OUTCOME_UNKNOWN', nodeDisplayName: 'VM A' })
    expect(JSON.stringify(afterRestart)).not.toContain('rpc-secret-xyz')

    // The deleted node must leave exactly one row: a live ledger copy alongside
    // the persisted one would double-count and survive the operator's clear.
    expect(ledger.unknownDiagnostics().filter(entry => entry.nodeId === node.nodeId)).toEqual([])

    // Retention ends only on an explicit operator clear.
    expect(await new RetainedDiagnosticsStore(home).clear([afterRestart[0]!.operationId])).toEqual([])
    expect(await new RetainedDiagnosticsStore(home).list()).toEqual([])
  })

  it('refuses to read retained diagnostics through a swapped symlink', async () => {
    const store = new RetainedDiagnosticsStore(home)
    await store.retain([{ operationId: 'op-real', nodeId: parseNodeId('vm-a'), kind: 'prompt', state: 'OUTCOME_UNKNOWN' }])
    expect(await store.list()).toHaveLength(1)

    // Replacing the file with a symlink must fail closed rather than serve
    // attacker-chosen content as the operator's audit evidence.
    const decoy = path.join(home, 'decoy.json')
    await writeFile(decoy, JSON.stringify([]), { mode: 0o600 })
    await rm(store.file, { force: true })
    await symlink(decoy, store.file)
    await expect(store.list()).rejects.toThrow(/regular non-symlink/)
  })

  it('stays recoverable when the diagnostics store itself fails', async () => {
    const ledger = new WriteLedger()
    const failing = {
      list: async () => [],
      retain: async () => { throw new Error('ENOSPC: no space left on device') },
      clear: async () => [],
    }
    const registry = new NodeRegistryService({
      dshHome: home,
      ledger,
      diagnostics: failing as never,
      tunnels: tunnels as never,
      probeIdentity: async () => ({ ok: true, diagnostic: 'authenticated' }),
    })
    const node = await registry.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
    const operationId = 'prompt:rpc-storage-fault' as OperationId
    ledger.create({ operationId, nodeId: parseNodeId(node.nodeId), kind: 'prompt', rpcId: 'rpc-storage-fault' as never })
    ledger.markSent(operationId)
    ledger.markConnectionLost(operationId)

    await expect(registry.removeNode(node.nodeId, true)).rejects.toThrow(/ENOSPC/)
    // The registry commit already succeeded, so a storage fault must not leak
    // the tunnel nor leave permanently unclearable phantom rows behind.
    expect(disposed).toContain(node.nodeId)
    expect(ledger.unknownDiagnostics()).toEqual([])
    expect((await registry.list()).nodes.some(entry => entry.nodeId === node.nodeId)).toBe(false)
  })

  it('persists diagnostics even when releasing the tunnel fails', async () => {
    const ledger = new WriteLedger()
    const diagnostics = new RetainedDiagnosticsStore(home)
    const registry = new NodeRegistryService({
      dshHome: home,
      ledger,
      diagnostics,
      tunnels: { disposeNode: async () => { throw new Error('ssh child refused to die') } } as never,
      probeIdentity: async () => ({ ok: true, diagnostic: 'authenticated' }),
    })
    const node = await registry.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
    const operationId = 'prompt:rpc-fragile' as OperationId
    ledger.create({ operationId, nodeId: parseNodeId(node.nodeId), kind: 'prompt', rpcId: 'rpc-fragile' as never })
    ledger.markSent(operationId)
    ledger.markConnectionLost(operationId)

    await expect(registry.removeNode(node.nodeId, true)).rejects.toThrow('ssh child refused to die')
    // The registry entry is already committed as removed, so the evidence must
    // survive regardless of what happened to the tunnel.
    expect(await new RetainedDiagnosticsStore(home).list()).toHaveLength(1)

    // The live ledger row must also be dropped on this failure path. Leaving it
    // would show the operation twice and make the operator's clear unable to
    // remove it for the rest of the Host's lifetime.
    expect(ledger.unknownDiagnostics()).toEqual([])
    await diagnostics.clear()
    expect([...ledger.unknownDiagnostics(), ...(await diagnostics.list())]).toEqual([])
  })

  it('does not tear down a tunnel when the deletion commit fails', { timeout: 60_000 }, async () => {
    const registry = service()
    const node = await registry.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })

    // A concurrent writer holds the registry lock, so the delete cannot commit.
    // A node that is still registered must keep its tunnel: disposing first
    // would leave the registry and the runtime permanently disagreeing.
    const lock = path.join(home, 'plugins/dsh-federation/.nodes.json.dsh-federation-lock')
    await writeFile(lock, JSON.stringify({ pid: process.pid, time: Date.now() }), { mode: 0o600 })
    const keepFresh = setInterval(() => {
      void utimes(lock, new Date(), new Date()).catch(() => {})
    }, 100)
    try {
      await expect(registry.removeNode(node.nodeId, true)).rejects.toThrow(/CONFLICT|conflict|lock/i)
    } finally {
      clearInterval(keepFresh)
      await rm(lock, { force: true })
    }

    expect(disposed).toEqual([])
    expect((await registry.list()).nodes.some(entry => entry.nodeId === node.nodeId)).toBe(true)
  })

  it('requires confirmation to delete a node with unknown writes and retains minimal diagnostics', async () => {
    const ledger = new WriteLedger()
    const registry = service({ ledger })
    const node = await registry.addNode({ displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
    const operationId = 'prompt:rpc-unknown' as OperationId
    ledger.create({ operationId, nodeId: parseNodeId(node.nodeId), kind: 'prompt', rpcId: 'rpc-unknown' as never })
    ledger.markSent(operationId)
    ledger.markConnectionLost(operationId)

    await expect(registry.removeNode(node.nodeId, false)).rejects.toBeInstanceOf(NodeDeletionRequiresConfirmation)
    expect((await registry.list()).nodes.some(entry => entry.nodeId === node.nodeId)).toBe(true)
    expect(disposed).toEqual([])

    const result = await registry.removeNode(node.nodeId, true)
    expect(result.retainedDiagnostics).toEqual([{ operationId, kind: 'prompt', state: 'OUTCOME_UNKNOWN' }])
    expect((await registry.list()).nodes.some(entry => entry.nodeId === node.nodeId)).toBe(false)
    expect(disposed).toEqual([node.nodeId])
  })
})
