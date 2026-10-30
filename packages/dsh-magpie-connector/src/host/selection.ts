import { connect } from 'node:net'
import type { LineSettings } from './settings.js'

/** Per-candidate TCP deadline; covers DNS lookup because the timer starts first. */
export const PROBE_TIMEOUT_MS = 600
/** Reuse a successful reachability verdict for this long. */
export const POSITIVE_TTL_MS = 10_000
/** Reuse a failed reachability verdict for this long. */
export const NEGATIVE_TTL_MS = 15_000

export type Probe = (host: string, port: number, timeoutMs: number, signal?: AbortSignal) => Promise<boolean>

export interface Endpoint { host: string; port: number }

/** Parse a configured line URL into a TCP endpoint; IPv6 literals lose brackets. */
export function endpointOf(url: string): Endpoint | undefined {
  try {
    const parsed = new URL(url)
    let host = parsed.hostname
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
    if (!host) return undefined
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined
    return { host, port }
  } catch { return undefined }
}

export interface SocketProbeResult {
  reachable: boolean
  /** TCP connect time in ms (DNS lookup included), clamped to a non-negative integer. */
  ms: number
}

/** TCP reachability and connect timing only: no HTTP request, no credentials. */
export function probeSocket(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<SocketProbeResult> {
  return new Promise(resolve => {
    let settled = false
    const started = performance.now()
    const socket = connect({ host, port })
    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve({ reachable, ms: Math.max(0, Math.round(performance.now() - started)) })
    }
    const onAbort = () => finish(false)
    // Explicit deadline: net.connect's `timeout` option only emits an event and
    // does not destroy the socket, and it does not cover DNS resolution.
    const timer = setTimeout(() => finish(false), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

/** TCP reachability only; thin wrapper kept so `Probe` and its callers stay unchanged. */
export async function probePort(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return (await probeSocket(host, port, timeoutMs, signal)).reachable
}

export interface LineSelectorOptions {
  probe?: Probe
  now?: () => number
  positiveTtlMs?: number
  negativeTtlMs?: number
  timeoutMs?: number
}

interface CacheEntry { reachable: boolean; at: number }

/**
 * Chooses the active line by priority order: the first reachable complete line
 * wins; reachability verdicts are cached in memory (10s positive / 15s
 * negative) and invalidated on line edits, line deletion, connection-phase
 * failures and dispose. A single-line list is returned without probing.
 */
export class LineSelector {
  private readonly probe: Probe
  private readonly now: () => number
  private readonly positiveTtlMs: number
  private readonly negativeTtlMs: number
  private readonly timeoutMs: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly controllers = new Set<AbortController>()
  private disposed = false
  constructor(options: LineSelectorOptions = {}) {
    this.probe = options.probe ?? probePort
    this.now = options.now ?? Date.now
    this.positiveTtlMs = options.positiveTtlMs ?? POSITIVE_TTL_MS
    this.negativeTtlMs = options.negativeTtlMs ?? NEGATIVE_TTL_MS
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  }
  private key(line: LineSettings) { return `${line.id}|${line.baseUrl}|${line.accessMode}` }
  private cached(line: LineSettings): CacheEntry | undefined {
    const entry = this.cache.get(this.key(line))
    if (!entry) return undefined
    const ttl = entry.reachable ? this.positiveTtlMs : this.negativeTtlMs
    if (this.now() - entry.at >= ttl) { this.cache.delete(this.key(line)); return undefined }
    return entry
  }
  /** Drop cached verdicts for one line (id) or all lines. */
  invalidate(lineId?: string) {
    if (lineId === undefined) { this.cache.clear(); return }
    const prefix = `${lineId}|`
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key)
  }
  async reachable(line: LineSettings): Promise<boolean> {
    const cached = this.cached(line)
    if (cached) return cached.reachable
    const endpoint = endpointOf(line.baseUrl)
    if (!endpoint) return false
    const controller = new AbortController()
    this.controllers.add(controller)
    let reachable = false
    try { reachable = await this.probe(endpoint.host, endpoint.port, this.timeoutMs, controller.signal) }
    finally { this.controllers.delete(controller) }
    if (this.disposed) return reachable
    this.cache.set(this.key(line), { reachable, at: this.now() })
    return reachable
  }
  /** First reachable line by priority, or the first line when none is known reachable. */
  async select(lines: LineSettings[]): Promise<LineSettings | undefined> {
    if (lines.length === 0) return undefined
    if (this.disposed) return lines[0]
    if (lines.length === 1) return lines[0]
    for (const line of lines) {
      const cached = this.cached(line)
      if (cached) { if (cached.reachable) return line; continue }
      const reachable = await this.reachable(line)
      if (reachable) return line
      if (this.disposed) return lines[0]
    }
    return lines[0]
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    this.cache.clear()
  }
}
