import { describe, expect, it, vi } from 'vitest'
import {
  CommandRouter,
  NodeReconciler,
  NodeRegistryModel,
  WriteLedger,
  encodeSessionId,
  encodeWorkspaceId,
  parseNodeId,
  type DshNodePort,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeCapability,
  type NodeDescriptor,
  type NodeId,
  type OperationId,
  type RpcId,
} from '../src/core/index.js'
import {
  CentralUplink,
  DualEventCarrier,
  HostActivationCoordinator,
  HttpUnaryCarrier,
  OpenSshTunnelManager,
  classifyOpenSshFailure,
  type CarrierSocket,
} from '../src/host/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')
const known = new Set<NodeId>([local, vmA, vmB])
const all = new Set<NodeCapability>([
  'workspace.read', 'workspace.write', 'session.read', 'session.write', 'session.search',
  'session.attachment', 'directory.read', 'directory.write', 'events.mux', 'events.host', 'interaction.respond',
])

function descriptor(nodeId: NodeId, state: NodeDescriptor['state'] = 'READY'): NodeDescriptor {
  return { nodeId, kind: nodeId === local ? 'local' : 'remote', displayName: nodeId, enabled: true, order: 0, capabilities: all, compatibility: 'SUPPORTED', state }
}

function port(nodeId: NodeId, state: NodeDescriptor['state'] = 'READY', behaviour: 'ok' | 'hang' | 'fail' = 'ok'): DshNodePort {
  const act = (value: unknown = { ok: true }) => async () => {
    if (behaviour === 'fail') throw new Error(`${nodeId} unavailable`)
    if (behaviour === 'hang') await new Promise(() => {})
    return value
  }
  return {
    node: descriptor(nodeId, state), capabilities: all,
    listWorkspaces: act([]), createWorkspace: act(), renameWorkspace: act(), deleteWorkspace: act(), reorderWorkspace: act(),
    listSessions: act([]), createSession: act('n'), history: act(), models: act(), prompt: act(), cancel: act(),
    renameSession: act({ title: 't', seq: 1 }), forkSession: act('n'), selectModel: act(), updateQueue: act(),
    attachment: act(), search: act([]), archiveSession: act(), respond: act(),
    listDirectory: act(), createDirectory: act(),
  } as unknown as DshNodePort
}

class FakeSocket implements CarrierSocket {
  readyState = 0
  readonly closed: number[] = []
  #listeners = new Map<string, ((event?: unknown) => void)[]>()
  constructor(readonly url: URL) {}
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: ((event: never) => void) | (() => void)): void {
    const list = this.#listeners.get(type) ?? []
    list.push(listener as (event?: unknown) => void)
    this.#listeners.set(type, list)
  }
  close(code?: number): void { this.closed.push(code ?? 1000) }
  emit(type: string, event?: unknown): void { for (const listener of this.#listeners.get(type) ?? []) listener(event) }
}

describe('node lifecycle and layered diagnostics (9.1)', () => {
  it('separates SSH trust, auth, transport and local bind faults', () => {
    expect(classifyOpenSshFailure('Host key verification failed').code).toBe('HOST_KEY_REJECTED')
    expect(classifyOpenSshFailure('Permission denied (publickey).').code).toBe('AUTHENTICATION_FAILED')
    expect(classifyOpenSshFailure('Could not resolve hostname vm-a').code).toBe('ALIAS_OR_DNS_FAILED')
    expect(classifyOpenSshFailure('bind [127.0.0.1]:5000: Address already in use').code).toBe('LOCAL_BIND_FAILED')
  })

  it('never leaks keys, tokens, bearer headers or real home paths into diagnostics', async () => {
    // A real OpenSSH leak is multi-line with the key material BETWEEN the BEGIN
    // and END markers, so the fixture must reproduce that shape: asserting only
    // on the header cannot prove the body was removed.
    const keyBody = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUSECRETKEYMATERIAL'
    const secret = [
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${keyBody}\n-----END OPENSSH PRIVATE KEY-----`,
      'Authorization: Bearer abcdef123456',
      'sk-livekey0987654321',
      // The keyword can sit anywhere in the identifier, so neither a prefix nor
      // a suffix anchor is sufficient.
      'AWS_SECRET_ACCESS_KEY=leaked-aws-value',
      'DB_PASSWORD_PROD=leaked-db-value',
      'client_secret=leaked-oauth-value',
      // Quotes and brackets are delimiters too: JSON/YAML shapes must not slip
      // past an identifier-only pattern.
      '{"client_secret":"leaked-json-value"}',
      'config["secret_key"] = leaked-bracket-value',
      // Useful diagnostics must survive redaction, or the operator loses the
      // information they need to act.
      'Permission denied (publickey).',
      '/etc/ssh/ssh_config line 21',
      '/Users/alice/.ssh/id_ed25519',
      '/var/root/.ssh/id_ed25519',
      'vm-a-secret-alias',
    ].join(' ')
    const manager = new OpenSshTunnelManager({
      terminateGraceMs: 5,
      spawn: () => {
        const child = {
          pid: 1,
          stderr: { async *[Symbol.asyncIterator]() { yield Buffer.from(secret) } },
          exited: Promise.resolve({ code: 255, signal: null }),
          kill: () => true,
        }
        return child
      },
      readinessProbe: async () => ({ ok: true, state: 'READY', diagnostic: '' }),
    })
    await expect(manager.connect({ nodeId: vmA, sshAlias: 'vm-a-secret-alias', remoteDshPort: 3080 })).rejects.toMatchObject({
      state: 'SSH_UNREACHABLE',
    })
    const error = await manager.connect({ nodeId: vmA, sshAlias: 'vm-a-secret-alias', remoteDshPort: 3080 }).catch(cause => cause)
    // The key BODY is the secret; a header-shaped assertion is not evidence.
    expect(error.diagnostic).not.toContain(keyBody)
    expect(error.diagnostic).not.toContain('END OPENSSH PRIVATE KEY')
    expect(error.diagnostic).not.toContain('/var/root')
    expect(error.diagnostic).not.toContain('leaked-aws-value')
    expect(error.diagnostic).not.toContain('leaked-db-value')
    expect(error.diagnostic).not.toContain('leaked-oauth-value')
    expect(error.diagnostic).not.toContain('leaked-json-value')
    expect(error.diagnostic).not.toContain('leaked-bracket-value')
    expect(error.diagnostic).toContain('Permission denied')
    expect(error.diagnostic).toContain('/etc/ssh/ssh_config')
    expect(error.diagnostic).not.toContain('abcdef123456')
    expect(error.diagnostic).not.toContain('sk-livekey0987654321')
    expect(error.diagnostic).not.toContain('/Users/alice')
    expect(error.diagnostic).not.toContain('vm-a-secret-alias')
    expect(error.diagnostic).toContain('[REDACTED_TOKEN]')
  })

  it('registry add/edit/delete keeps generation monotonic and local identity immutable', () => {
    const model = NodeRegistryModel.create(local)
    const added = new NodeRegistryModel(model.addRemote({ nodeId: vmA, displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 }))
    expect(added.snapshot.generation).toBe(1)
    const renamed = new NodeRegistryModel(added.updateRemote(vmA, { displayName: 'VM A prime' }))
    expect(renamed.snapshot.generation).toBe(2)
    const removed = new NodeRegistryModel(renamed.removeRemote(vmA))
    expect(removed.snapshot.generation).toBe(3)
    expect(removed.snapshot.localNodeId).toBe(local)
    expect(() => removed.removeRemote(local)).toThrow()
  })
})

describe('fault injection across the transport stack (9.2)', () => {
  it('classifies a lost HTTP response and a broken tunnel distinctly', async () => {
    const lost = new HttpUnaryCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1, timeoutMs: 5,
      fetch: ((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof globalThis.fetch,
    })
    await expect(lost.request({ path: '/api/session.prompt', body: {} })).rejects.toMatchObject({ kind: 'Aborted' })

    const broken = new HttpUnaryCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      fetch: (async () => { throw new Error('ECONNRESET') }) as typeof globalThis.fetch,
    })
    await expect(broken.request({ path: '/api/session.list' })).rejects.toMatchObject({ kind: 'Transport', retryable: true })
  })

  it('reports a half-broken dual stream without discarding the healthy one', async () => {
    const sockets: FakeSocket[] = []
    const frames: unknown[] = []
    const disconnects: unknown[] = []
    const carrier = new DualEventCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      createSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); queueMicrotask(() => socket.emit('open')); return socket },
      validate: (_stream, value) => value,
      onFrame: frame => { frames.push(frame) },
      onDisconnect: event => { disconnects.push(event) },
    })
    await carrier.open()
    sockets[0]!.emit('close', { code: 1006, reason: 'mux dropped' })
    sockets[1]!.emit('message', { data: JSON.stringify({ type: 'host/session-status' }) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(disconnects).toHaveLength(1)
    expect(frames).toHaveLength(1)
    carrier.dispose()
  })

  it('buffers frames until baseline and rejects injected old-generation frames', () => {
    const reconciler = new NodeReconciler<string, string, string>(vmA)
    const first = reconciler.begin()
    reconciler.accept(first, { domain: 'session', sessionId: 's' as NativeSessionId, seq: 5, value: 'early' })
    reconciler.installBaseline(first, { workspaces: [], statuses: [] }, [])
    reconciler.markStreamsReady(first)
    expect(reconciler.view()!.sessionEvents.get('s' as NativeSessionId)?.value).toBe('early')

    const second = reconciler.begin()
    expect(reconciler.accept(first, { domain: 'session', sessionId: 's' as NativeSessionId, seq: 9, value: 'stale-generation' })).toBe(false)
    // A new generation starts from its own baseline, so within that generation a
    // lower seq must not overwrite a higher one already applied.
    reconciler.installBaseline(second, { workspaces: [], statuses: [] }, [{ id: 's' as NativeSessionId, seq: 7, value: 'baseline' }])
    reconciler.markStreamsReady(second)
    reconciler.accept(second, { domain: 'session', sessionId: 's' as NativeSessionId, seq: 2, value: 'older-seq' })
    expect(reconciler.view()!.sessionEvents.get('s' as NativeSessionId)?.value).toBe('baseline')
    reconciler.accept(second, { domain: 'session', sessionId: 's' as NativeSessionId, seq: 9, value: 'newer-seq' })
    expect(reconciler.view()!.sessionEvents.get('s' as NativeSessionId)?.value).toBe('newer-seq')
  })

  it('keeps an unproven write OUTCOME_UNKNOWN and never auto-replays it', () => {
    const ledger = new WriteLedger()
    const cancel = 'op-cancel' as OperationId
    ledger.create({ operationId: cancel, nodeId: vmA, kind: 'cancel' })
    ledger.markSent(cancel)
    ledger.markConnectionLost(cancel)
    expect(ledger.get(cancel)?.state).toBe('OUTCOME_UNKNOWN')
    expect(ledger.replayable().map(entry => entry.operationId)).not.toContain(cancel)
    expect(ledger.unknownForNode(vmA).map(entry => entry.operationId)).toEqual([cancel])
  })
})

describe('concurrent clients and remote authority (9.3)', () => {
  it('takes no federation lock: concurrent central commands both reach the owner', async () => {
    const seen: string[] = []
    const counting = {
      ...port(vmA),
      cancel: async () => { seen.push('cancel'); return undefined },
      prompt: async () => { seen.push('prompt'); return undefined },
    } as unknown as DshNodePort
    const router = new CommandRouter(new Map([[local, port(local)], [vmA, counting]]))
    const session = encodeSessionId({ nodeId: vmA, nativeId: 'shared' as NativeSessionId })
    await Promise.all([
      router.prompt(session, { rpcId: 'r1' as RpcId, mode: 'queue', content: [] }),
      router.cancel(session),
    ])
    expect(seen.sort()).toEqual(['cancel', 'prompt'])
  })

  it('treats the remote Host as authoritative: a rejected write is not retried centrally', () => {
    const ledger = new WriteLedger()
    const rename = 'op-rename' as OperationId
    ledger.create({ operationId: rename, nodeId: vmA, kind: 'rename' })
    ledger.markSent(rename)
    ledger.markRejected(rename, { code: 'title-invalid' })
    expect(ledger.get(rename)?.state).toBe('REJECTED')
    expect(ledger.replayable()).toEqual([])
  })
})

describe('cross-node security (9.4)', () => {
  it('fails closed on unknown nodes, forged ids, cross-node anchors and remote openPath', async () => {
    const uplink = new CentralUplink(new CommandRouter(new Map([[local, port(local)], [vmA, port(vmA)], [vmB, port(vmB)]])), known, local)
    const wsA = encodeWorkspaceId({ nodeId: vmA, nativeId: 'shared' as NativeWorkspaceId })
    const wsB = encodeWorkspaceId({ nodeId: vmB, nativeId: 'shared' as NativeWorkspaceId })
    const cases: [string, Record<string, unknown>, string][] = [
      ['/api/session.cancel', { sessionId: 'fed1:ghost:s:c2hhcmVk' }, 'federation-id-unknown-node'],
      ['/api/session.cancel', { sessionId: 'fed1:vm-a:s:@@@' }, 'federation-id-malformed'],
      ['/api/session.cancel', { sessionId: 'fed2:vm-a:s:c2hhcmVk' }, 'federation-route-unclassified'],
      ['/api/workspace.insertBefore', { workspaceId: wsA, beforeWorkspaceId: wsB }, 'federation-capability-denied'],
      ['/api/host.openPath', { nodeId: vmA, path: '/remote/project' }, 'federation-forbidden-surface'],
    ]
    for (const [path, payload, code] of cases) {
      await expect(uplink.handle({ path, rpcId: 'r', payload })).resolves.toMatchObject({ kind: 'error', code })
    }
  })

  it('refuses writes to a node that is not authoritative', async () => {
    const router = new CommandRouter(new Map([[local, port(local)], [vmA, port(vmA, 'STALE')]]))
    const uplink = new CentralUplink(router, known, local)
    await expect(uplink.handle({
      path: '/api/session.prompt', rpcId: 'r',
      payload: { sessionId: encodeSessionId({ nodeId: vmA, nativeId: 'shared' as NativeSessionId }), mode: 'queue', content: [] },
    })).resolves.toMatchObject({ kind: 'error', code: 'federation-port-unavailable', status: 409 })
  })

  it('rejects loopback-only carriers pointed at a plaintext LAN endpoint', () => {
    for (const endpoint of ['http://192.168.1.20:3080', 'http://0.0.0.0:3080', 'http://vm-a.lan:3080']) {
      expect(() => new HttpUnaryCarrier({ endpoint: new URL(endpoint), generation: 1, currentGeneration: () => 1 })).toThrow(/127\.0\.0\.1/)
    }
  })
})

describe('scale and isolation (9.5, 9.6)', () => {
  it('one offline node neither blocks other nodes nor unbounds a queue', async () => {
    const router = new CommandRouter(new Map([
      [local, port(local)],
      [vmA, port(vmA, 'READY', 'hang')],
      [vmB, port(vmB)],
    ]))
    const healthy = await Promise.race([
      router.sessionList(vmB).then(() => 'vmB-ok'),
      new Promise(resolve => setTimeout(() => resolve('blocked'), 50)),
    ])
    expect(healthy).toBe('vmB-ok')

    const sockets: FakeSocket[] = []
    const disconnects: unknown[] = []
    const carrier = new DualEventCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      maxQueuedFrames: 2,
      createSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); queueMicrotask(() => socket.emit('open')); return socket },
      validate: (_stream, value) => value,
      onFrame: () => new Promise(() => {}),
      onDisconnect: event => { disconnects.push(event) },
    })
    await carrier.open()
    for (let index = 0; index < 10; index++) sockets[0]!.emit('message', { data: '{}' })
    expect(disconnects.length).toBeGreaterThan(0)
    expect(sockets[0]!.closed).toContain(1008)
    carrier.dispose()
  })

  it('disabling federation restores official routes with nothing left registered', async () => {
    const registered: string[] = []
    const coordinator = new HostActivationCoordinator()
    const routes = ['/api/session.prompt', '/api/workspace.list'].map(path => ({
      path,
      register() {
        registered.push(path)
        return async () => { registered.splice(registered.indexOf(path), 1) }
      },
    }))
    expect(await coordinator.activate({ prepare: async () => {} }, routes)).toBe('HOST_READY')
    expect(registered).toHaveLength(2)
    await coordinator.deactivate()
    expect(registered).toEqual([])
    expect(coordinator.state).toBe('HOST_DISABLED')
  })

  it('projects three nodes with colliding native ids without cross-talk', () => {
    const shared = 'shared' as NativeSessionId
    const ids = [local, vmA, vmB].map(nodeId => encodeSessionId({ nodeId, nativeId: shared }))
    expect(new Set(ids).size).toBe(3)
  })
})
