import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WriteLedger, parseNodeId, type OperationId } from '../src/core/index.js'
import {
  NodeDeletionRequiresConfirmation,
  NodeReconnectBackoff,
  OpenSshTunnelManager,
  bindCatchableShutdown,
  classifyOpenSshFailure,
  disposeNodeForDeletion,
  probeSshIdentity,
  tunnelArgs,
  validateSshAlias,
  type OwnedProcess,
  type ProcessExit,
  type ProcessSpawner,
  type TunnelRequest,
} from '../src/host/index.js'

class FakeProcess implements OwnedProcess {
  readonly pid: number
  readonly signals: NodeJS.Signals[] = []
  readonly #stderr: Uint8Array[]
  readonly #exit: Promise<ProcessExit>
  #resolve!: (exit: ProcessExit) => void
  constructor(pid: number, stderr = '') {
    this.pid = pid
    this.#stderr = stderr === '' ? [] : [Buffer.from(stderr)]
    this.#exit = new Promise(resolve => { this.#resolve = resolve })
  }
  get stderr(): AsyncIterable<Uint8Array> {
    const chunks = this.#stderr
    return { async *[Symbol.asyncIterator]() { yield* chunks } }
  }
  get exited() { return this.#exit }
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal)
    this.#resolve({ code: null, signal })
    return true
  }
  exit(code: number, signal: NodeJS.Signals | null = null) { this.#resolve({ code, signal }) }
}

const nodeId = parseNodeId('vm-a')
const request: TunnelRequest = { nodeId, sshAlias: 'fixture-target', remoteDshPort: 3080 }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('SSH identity probe', () => {
  it('uses BatchMode no-session argv and executes no remote command', async () => {
    const process = new FakeProcess(1)
    let observed: readonly string[] = []
    const result = await probeSshIdentity('fixture-target', {
      stabilityMs: 5,
      terminateGraceMs: 5,
      spawn(_executable, argv) { observed = argv; return process },
    })
    expect(result.ok).toBe(true)
    expect(observed).toEqual([
      '-N', '-T', '-o', 'SessionType=none', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', 'fixture-target',
    ])
    expect(observed).not.toContain('true')
    expect(process.signals).toEqual(['SIGTERM'])
  })

  it('fails before save on interactive/auth exit and rejects option-shaped aliases before spawn', async () => {
    const process = new FakeProcess(2, 'Permission denied (publickey,password).')
    const spawn = vi.fn(() => process)
    queueMicrotask(() => process.exit(255))
    const result = await probeSshIdentity('fixture-target', { stabilityMs: 50, spawn })
    expect(result.ok).toBe(false)
    expect(result.diagnostic).toMatch(/Permission denied/)
    expect(() => validateSshAlias('-oProxyCommand=bad')).toThrow(/invalid SSH alias/)
  })
})

describe('OpenSSH tunnel manager', () => {
  it('constructs strict loopback argv, publishes only after readiness, redacts diagnostics and disposes exact child', async () => {
    const processes: FakeProcess[] = []
    const argv: readonly string[][] = []
    const manager = new OpenSshTunnelManager({
      readinessTimeoutMs: 100,
      terminateGraceMs: 5,
      spawn(_executable, args) { argv.push(args); const child = new FakeProcess(processes.length + 10, '/Users/alice secret sk-exampletoken123456789 fixture-target'); processes.push(child); return child },
      async readinessProbe(endpoint) {
        expect(endpoint.hostname).toBe('127.0.0.1')
        return { ok: true, state: 'READY', diagnostic: 'rc.2 ready' }
      },
    })
    const handle = await manager.connect(request)
    expect(handle.endpoint.hostname).toBe('127.0.0.1')
    expect(argv[0]).toContain('BatchMode=yes')
    expect(argv[0]).toContain('ExitOnForwardFailure=yes')
    expect(argv[0]).toContain('ServerAliveInterval=15')
    expect(argv[0]).toContain('ServerAliveCountMax=3')
    expect(argv[0]!.find(value => value.startsWith('127.0.0.1:'))).toMatch(/^127\.0\.0\.1:\d+:127\.0\.0\.1:3080$/)
    await handle.dispose()
    await handle.dispose()
    expect(processes[0]!.signals).toEqual(['SIGTERM'])
  })

  it('retries only classified local bind collisions with a new owned child', async () => {
    const children = [
      new FakeProcess(15, 'bind [127.0.0.1]:49152: Address already in use'),
      new FakeProcess(16),
    ]
    let spawned = 0
    const manager = new OpenSshTunnelManager({
      maxBindAttempts: 2,
      terminateGraceMs: 5,
      spawn: () => {
        const child = children[spawned++]!
        if (spawned === 1) queueMicrotask(() => child.exit(255))
        return child
      },
      readinessProbe: async () => new Promise(resolve => setTimeout(() => resolve({ ok: true, state: 'READY', diagnostic: 'ready' }), 5)),
    })
    const handle = await manager.connect(request)
    expect(spawned).toBe(2)
    await handle.dispose()
    expect(children[1]!.signals).toEqual(['SIGTERM'])
  })

  it('does not publish listener-only success when DSH readiness fails', async () => {
    const child = new FakeProcess(20)
    const manager = new OpenSshTunnelManager({
      terminateGraceMs: 5,
      spawn: () => child,
      readinessProbe: async () => ({ ok: false, state: 'NON_DSH_SERVICE', diagnostic: 'marker mismatch' }),
    })
    await expect(manager.connect(request)).rejects.toMatchObject({ state: 'NON_DSH_SERVICE', diagnostic: 'marker mismatch' })
    expect(child.signals).toEqual(['SIGTERM'])
  })

  it('replaces a node generation, leaves unrelated children alone and disposes all owned processes', async () => {
    const children: FakeProcess[] = []
    const sentinel = new FakeProcess(999)
    const manager = new OpenSshTunnelManager({
      terminateGraceMs: 5,
      spawn: () => { const child = new FakeProcess(children.length + 30); children.push(child); return child },
      readinessProbe: async () => ({ ok: true, state: 'READY', diagnostic: 'ready' }),
    })
    const first = await manager.connect(request)
    const second = await manager.connect(request)
    expect(second.generation).toBe(first.generation + 1)
    expect(children[0]!.signals).toEqual(['SIGTERM'])
    expect(sentinel.signals).toEqual([])
    await manager.disposeAll()
    expect(children[1]!.signals).toEqual(['SIGTERM'])
    expect(sentinel.signals).toEqual([])
  })

  it('returns bounded full-jitter-above-half reconnect delays independently per manager', () => {
    const manager = new OpenSshTunnelManager({ readinessProbe: async () => ({ ok: true, state: 'READY', diagnostic: '' }), random: () => 0.5 })
    expect(manager.reconnectDelay(0)).toBe(375)
    expect(manager.reconnectDelay(3)).toBe(3000)
    expect(manager.reconnectDelay(99)).toBeLessThanOrEqual(30_000)
    expect(manager.reconnectDelay(99)).toBeGreaterThanOrEqual(15_000)
  })

  it('classifies bounded redacted SSH diagnostics without collapsing bind/auth/trust', () => {
    expect(classifyOpenSshFailure('Address already in use')).toEqual({ state: 'TUNNEL_ERROR', code: 'LOCAL_BIND_FAILED' })
    expect(classifyOpenSshFailure('Host key verification failed')).toEqual({ state: 'SSH_UNREACHABLE', code: 'HOST_KEY_REJECTED' })
    expect(classifyOpenSshFailure('Permission denied (publickey)')).toEqual({ state: 'SSH_UNREACHABLE', code: 'AUTHENTICATION_FAILED' })
    expect(classifyOpenSshFailure('Connection timed out')).toEqual({ state: 'SSH_UNREACHABLE', code: 'SSH_TRANSPORT_FAILED' })
  })

  it('binds catchable shutdown only and preserves unknown-ledger diagnostics on confirmed deletion', async () => {
    const child = new FakeProcess(50)
    const manager = new OpenSshTunnelManager({
      terminateGraceMs: 5,
      spawn: () => child,
      readinessProbe: async () => ({ ok: true, state: 'READY', diagnostic: 'ready' }),
    })
    await manager.connect(request)
    const source = new EventEmitter()
    // Cleanup must terminate the whole lifecycle, so the disposer takes the
    // connection owner rather than the tunnel manager alone.
    let lifecycleDisposed = false
    const unbind = bindCatchableShutdown({
      tunnels: manager,
      dispose: async () => { lifecycleDisposed = true },
    }, source)
    source.emit('SIGTERM')
    await vi.waitFor(() => {
      expect(lifecycleDisposed).toBe(true)
      expect(child.signals).toEqual(['SIGTERM'])
    })
    unbind()

    const ledger = new WriteLedger()
    const operationId = 'unknown-delete' as OperationId
    ledger.create({ operationId, nodeId, kind: 'cancel' })
    ledger.markSent(operationId)
    ledger.markConnectionLost(operationId)
    await expect(disposeNodeForDeletion(nodeId, ledger, manager, false)).rejects.toBeInstanceOf(NodeDeletionRequiresConfirmation)
    const result = await disposeNodeForDeletion(nodeId, ledger, manager, true)
    expect(result.retainedDiagnostics).toEqual([{ operationId, kind: 'cancel', state: 'OUTCOME_UNKNOWN' }])
  })

  it('keeps reconnect attempts independent per node and resets only the recovered node', () => {
    const manager = new OpenSshTunnelManager({ readinessProbe: async () => ({ ok: true, state: 'READY', diagnostic: '' }), random: () => 0.5 })
    const backoff = new NodeReconnectBackoff(manager)
    expect(backoff.next(nodeId)).toBe(375)
    expect(backoff.next(nodeId)).toBe(750)
    const other = parseNodeId('vm-b')
    expect(backoff.next(other)).toBe(375)
    backoff.reset(nodeId)
    expect(backoff.attempt(nodeId)).toBe(0)
    expect(backoff.attempt(other)).toBe(1)
  })

  it('bounds and validates tunnel argv without parsing ProxyJump itself', () => {
    const args = tunnelArgs(request, 49152, { connectTimeoutSeconds: 5, serverAliveIntervalSeconds: 15, serverAliveCountMax: 3 })
    expect(args.at(-1)).toBe('fixture-target')
    expect(args).not.toContain('ProxyJump')
    expect(() => tunnelArgs({ ...request, remoteDshPort: 0 }, 49152, {})).toThrow(/remote DSH port/)
  })
})
