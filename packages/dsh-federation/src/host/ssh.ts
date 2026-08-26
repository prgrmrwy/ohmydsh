import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import type { NodeId, NodeState } from '../core/index.js'

const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const LOOPBACK = '127.0.0.1'

export interface ProcessExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export interface OwnedProcess {
  readonly pid?: number
  readonly stderr: AsyncIterable<Uint8Array>
  readonly exited: Promise<ProcessExit>
  kill(signal: NodeJS.Signals): boolean
}

export type ProcessSpawner = (executable: string, argv: readonly string[]) => OwnedProcess

export interface SshIdentityProbeOptions {
  readonly sshExecutable?: string
  readonly connectTimeoutSeconds?: number
  readonly stabilityMs?: number
  readonly terminateGraceMs?: number
  readonly spawn?: ProcessSpawner
}

export interface SshIdentityProbeResult {
  readonly ok: boolean
  readonly exit: ProcessExit
  readonly diagnostic: string
}

export type TunnelReadiness =
  | { readonly ok: true; readonly state: Extract<NodeState, 'READY' | 'DEGRADED'>; readonly diagnostic: string }
  | { readonly ok: false; readonly state: Extract<NodeState, 'DSH_UNAVAILABLE' | 'NON_DSH_SERVICE' | 'INCOMPATIBLE'>; readonly diagnostic: string }

export interface TunnelManagerOptions {
  readonly sshExecutable?: string
  readonly spawn?: ProcessSpawner
  readonly readinessProbe: (endpoint: URL, signal: AbortSignal) => Promise<TunnelReadiness>
  readonly maxBindAttempts?: number
  readonly connectTimeoutSeconds?: number
  readonly serverAliveIntervalSeconds?: number
  readonly serverAliveCountMax?: number
  readonly readinessTimeoutMs?: number
  readonly maxStderrBytes?: number
  readonly terminateGraceMs?: number
  readonly random?: () => number
}

export interface TunnelRequest {
  readonly nodeId: NodeId
  readonly sshAlias: string
  readonly remoteDshPort: number
}

export interface TunnelHandle {
  readonly nodeId: NodeId
  readonly generation: number
  readonly endpoint: URL
  readonly diagnostic: string
  dispose(): Promise<void>
}

export class TunnelError extends Error {
  constructor(readonly state: Extract<NodeState, 'SSH_UNREACHABLE' | 'TUNNEL_ERROR' | 'DSH_UNAVAILABLE' | 'NON_DSH_SERVICE' | 'INCOMPATIBLE'>, message: string, readonly diagnostic: string) {
    super(message)
    this.name = 'TunnelError'
  }
}

export function validateSshAlias(alias: string): string {
  if (!ALIAS.test(alias)) throw new TunnelError('SSH_UNREACHABLE', 'invalid SSH alias', 'Alias must use letters, digits, dot, underscore or hyphen and must not begin with hyphen.')
  return alias
}

function positiveInteger(value: number, name: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`invalid ${name}`)
  return value
}

function defaultSpawner(executable: string, argv: readonly string[]): OwnedProcess {
  const child = spawn(executable, argv, {
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    stderr: child.stderr,
    exited: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    }),
    kill: signal => child.kill(signal),
  }
}

function identityArgs(alias: string, timeout: number): string[] {
  return ['-N', '-T', '-o', 'SessionType=none', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${timeout}`, '--', validateSshAlias(alias)]
}

export function tunnelArgs(request: TunnelRequest, localPort: number, options: Pick<TunnelManagerOptions, 'connectTimeoutSeconds' | 'serverAliveIntervalSeconds' | 'serverAliveCountMax'>): string[] {
  const timeout = positiveInteger(options.connectTimeoutSeconds ?? 5, 'connect timeout', 60)
  const interval = positiveInteger(options.serverAliveIntervalSeconds ?? 15, 'keepalive interval', 300)
  const count = positiveInteger(options.serverAliveCountMax ?? 3, 'keepalive count', 10)
  const remotePort = positiveInteger(request.remoteDshPort, 'remote DSH port', 65535)
  const port = positiveInteger(localPort, 'local port', 65535)
  return [
    '-N', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', `ConnectTimeout=${timeout}`,
    '-o', `ServerAliveInterval=${interval}`,
    '-o', `ServerAliveCountMax=${count}`,
    '-L', `${LOOPBACK}:${port}:${LOOPBACK}:${remotePort}`,
    '--', validateSshAlias(request.sshAlias),
  ]
}

function redact(value: string, aliases: readonly string[]): string {
  let result = value.replace(/(?:sk-|xox[baprs]-|gh[pousr]_)[A-Za-z0-9_-]+/gi, '[REDACTED_TOKEN]')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '/[HOME]')
  for (const alias of aliases) result = result.replaceAll(alias, '[SSH_ALIAS]')
  return result
}

async function collectStderr(process: OwnedProcess, maxBytes: number, aliases: readonly string[]): Promise<() => string> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  void (async () => {
    for await (const chunk of process.stderr) {
      const remaining = maxBytes - bytes
      if (remaining <= 0) continue
      chunks.push(chunk.slice(0, remaining))
      bytes += Math.min(chunk.byteLength, remaining)
    }
  })()
  return () => redact(Buffer.concat(chunks).toString('utf8').trim(), aliases)
}

export async function probeSshIdentity(alias: string, options: SshIdentityProbeOptions = {}): Promise<SshIdentityProbeResult> {
  const timeout = positiveInteger(options.connectTimeoutSeconds ?? 5, 'connect timeout', 60)
  const stabilityMs = positiveInteger(options.stabilityMs ?? 250, 'identity stability window', 10_000)
  const graceMs = positiveInteger(options.terminateGraceMs ?? 1_000, 'identity terminate grace', 30_000)
  const process = (options.spawn ?? defaultSpawner)(options.sshExecutable ?? '/usr/bin/ssh', identityArgs(alias, timeout))
  const diagnostic = await collectStderr(process, 8192, [alias])
  const outcome = await Promise.race([
    process.exited.then(exit => ({ kind: 'exit' as const, exit })),
    wait(stabilityMs).then(() => ({ kind: 'stable' as const })),
  ])
  if (outcome.kind === 'exit') return { ok: false, exit: outcome.exit, diagnostic: diagnostic() }
  await terminate(process, graceMs)
  return { ok: true, exit: { code: 0, signal: null }, diagnostic: diagnostic() }
}

function reserveCandidatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, LOOPBACK, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') return reject(new Error('loopback candidate unavailable'))
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

export function classifyOpenSshFailure(diagnostic: string): { readonly state: 'SSH_UNREACHABLE' | 'TUNNEL_ERROR'; readonly code: string } {
  if (/Address already in use|cannot listen to port|Could not request local forwarding/i.test(diagnostic)) return { state: 'TUNNEL_ERROR', code: 'LOCAL_BIND_FAILED' }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(diagnostic)) return { state: 'SSH_UNREACHABLE', code: 'HOST_KEY_REJECTED' }
  if (/Permission denied|no supported authentication methods available/i.test(diagnostic)) return { state: 'SSH_UNREACHABLE', code: 'AUTHENTICATION_FAILED' }
  if (/Could not resolve hostname|Name or service not known|nodename nor servname provided/i.test(diagnostic)) return { state: 'SSH_UNREACHABLE', code: 'ALIAS_OR_DNS_FAILED' }
  if (/Connection timed out|Operation timed out|Connection refused|No route to host/i.test(diagnostic)) return { state: 'SSH_UNREACHABLE', code: 'SSH_TRANSPORT_FAILED' }
  return { state: 'SSH_UNREACHABLE', code: 'SSH_EXITED' }
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function terminate(process: OwnedProcess, graceMs: number): Promise<void> {
  let settled = false
  void process.exited.finally(() => { settled = true })
  if (!settled) process.kill('SIGTERM')
  await Promise.race([process.exited.catch(() => undefined), wait(graceMs)])
  if (!settled) {
    process.kill('SIGKILL')
    await process.exited.catch(() => undefined)
  }
}

export class OpenSshTunnelManager {
  readonly #options: Required<Pick<TunnelManagerOptions, 'sshExecutable' | 'spawn' | 'maxBindAttempts' | 'connectTimeoutSeconds' | 'serverAliveIntervalSeconds' | 'serverAliveCountMax' | 'readinessTimeoutMs' | 'maxStderrBytes' | 'terminateGraceMs' | 'random'>> & Pick<TunnelManagerOptions, 'readinessProbe'>
  readonly #active = new Map<NodeId, { generation: number; process: OwnedProcess; abort: AbortController; disposed: boolean }>()
  readonly #generations = new Map<NodeId, number>()

  constructor(options: TunnelManagerOptions) {
    this.#options = {
      readinessProbe: options.readinessProbe,
      sshExecutable: options.sshExecutable ?? '/usr/bin/ssh',
      spawn: options.spawn ?? defaultSpawner,
      maxBindAttempts: positiveInteger(options.maxBindAttempts ?? 3, 'bind attempts', 10),
      connectTimeoutSeconds: positiveInteger(options.connectTimeoutSeconds ?? 5, 'connect timeout', 60),
      serverAliveIntervalSeconds: positiveInteger(options.serverAliveIntervalSeconds ?? 15, 'keepalive interval', 300),
      serverAliveCountMax: positiveInteger(options.serverAliveCountMax ?? 3, 'keepalive count', 10),
      readinessTimeoutMs: positiveInteger(options.readinessTimeoutMs ?? 10_000, 'readiness timeout', 120_000),
      maxStderrBytes: positiveInteger(options.maxStderrBytes ?? 16_384, 'stderr bytes', 1_048_576),
      terminateGraceMs: positiveInteger(options.terminateGraceMs ?? 1_000, 'terminate grace', 30_000),
      random: options.random ?? Math.random,
    }
  }

  async connect(request: TunnelRequest): Promise<TunnelHandle> {
    validateSshAlias(request.sshAlias)
    positiveInteger(request.remoteDshPort, 'remote DSH port', 65535)
    await this.disposeNode(request.nodeId)
    const generation = (this.#generations.get(request.nodeId) ?? 0) + 1
    this.#generations.set(request.nodeId, generation)
    let lastDiagnostic = ''
    for (let attempt = 1; attempt <= this.#options.maxBindAttempts; attempt++) {
      const localPort = await reserveCandidatePort()
      const process = this.#options.spawn(this.#options.sshExecutable, tunnelArgs(request, localPort, this.#options))
      const abort = new AbortController()
      const active = { generation, process, abort, disposed: false }
      this.#active.set(request.nodeId, active)
      const diagnostic = await collectStderr(process, this.#options.maxStderrBytes, [request.sshAlias])
      const endpoint = new URL(`http://${LOOPBACK}:${localPort}`)
      const readiness = this.#readinessWithTimeout(endpoint, abort.signal)
      const outcome = await Promise.race([
        process.exited.then(exit => ({ kind: 'exit' as const, exit })),
        readiness.then(result => ({ kind: 'ready' as const, result })),
      ])
      if (outcome.kind === 'exit') {
        lastDiagnostic = diagnostic()
        this.#active.delete(request.nodeId)
        const classified = classifyOpenSshFailure(lastDiagnostic)
        if (classified.code === 'LOCAL_BIND_FAILED' && attempt < this.#options.maxBindAttempts) continue
        throw new TunnelError(classified.state, `OpenSSH exited before DSH readiness (${classified.code})`, lastDiagnostic)
      }
      if (!outcome.result.ok) {
        await this.#disposeExact(request.nodeId, active)
        throw new TunnelError(outcome.result.state, 'DSH readiness probe failed', outcome.result.diagnostic)
      }
      if (this.#active.get(request.nodeId) !== active || active.disposed) {
        await this.#disposeExact(request.nodeId, active)
        throw new TunnelError('TUNNEL_ERROR', 'tunnel generation was replaced', 'stale generation')
      }
      return Object.freeze({
        nodeId: request.nodeId,
        generation,
        endpoint,
        diagnostic: outcome.result.diagnostic,
        dispose: () => this.#disposeExact(request.nodeId, active),
      })
    }
    throw new TunnelError('TUNNEL_ERROR', 'OpenSSH could not bind a loopback port', lastDiagnostic)
  }

  async disposeNode(nodeId: NodeId): Promise<void> {
    const active = this.#active.get(nodeId)
    if (active !== undefined) await this.#disposeExact(nodeId, active)
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#active].map(([nodeId, active]) => this.#disposeExact(nodeId, active)))
  }

  reconnectDelay(attempt: number, baseMs = 500, capMs = 30_000): number {
    const boundedAttempt = Math.max(0, Math.min(16, Math.trunc(attempt)))
    const ceiling = Math.min(capMs, baseMs * 2 ** boundedAttempt)
    return Math.floor(ceiling / 2 + this.#options.random() * ceiling / 2)
  }

  async #readinessWithTimeout(endpoint: URL, parent: AbortSignal): Promise<TunnelReadiness> {
    const controller = new AbortController()
    const abort = () => controller.abort(parent.reason)
    parent.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('readiness timeout')), this.#options.readinessTimeoutMs)
    try {
      return await this.#options.readinessProbe(endpoint, controller.signal)
    } catch (cause) {
      return { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: cause instanceof Error ? cause.message : 'readiness failed' }
    } finally {
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
    }
  }

  async #disposeExact(nodeId: NodeId, active: { process: OwnedProcess; abort: AbortController; disposed: boolean }): Promise<void> {
    if (active.disposed) return
    active.disposed = true
    active.abort.abort(new Error('tunnel disposed'))
    if (this.#active.get(nodeId) === active) this.#active.delete(nodeId)
    await terminate(active.process, this.#options.terminateGraceMs)
  }
}
