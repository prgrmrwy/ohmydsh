/**
 * Service discovery: `GET /dsh-local-service/services` (spec 首页列出 Host 上的网页服务).
 *
 * 1. Enumerate TCP listeners on the Host machine bound to 127.0.0.1, ::1, 0.0.0.0 or ::
 *    (macOS: `lsof`; Linux: /proc/net/tcp{,6}); drop the DSH port itself.
 * 2. Probe the (at most 64, lowest-port) candidates with a credential-less `GET /`
 *    (800 ms each, ≤ 16 at once). Only the response HEAD is read; the request is destroyed as
 *    soon as it arrives and a `Location` is never followed. Listed when `Content-Type`
 *    starts with `text/html` (any status).
 * 3. ONE budget (default 2.8 s, under the spec's 3 s) covers enumeration AND probing: at the
 *    deadline every outstanding probe and the enumeration child process are cancelled and the
 *    results so far are returned. `process` is a bare executable name or null; nothing else
 *    about a process (arguments, path, environment) is ever read into the response.
 * Any failure to enumerate yields `200 []` without details.
 */
import { spawn } from 'node:child_process'
import { readFile, readdir, readlink } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Family, ServiceEntry } from '../contract.js'
import { sendError } from './gate.js'

export interface Listener {
  fam: Family
  port: number
  process: string | null
}

export const MAX_CANDIDATES = 64
export const MAX_CONCURRENT_PROBES = 16
export const DEFAULT_PROBE_TIMEOUT_MS = 800
/** Below the spec's "within 3 seconds" so connection setup and serialisation still fit. */
export const DEFAULT_SERVICES_DEADLINE_MS = 2800

export interface ServicesDeps {
  /** Read per request: the Host WebServer's live listening port. */
  webServerPort(): number | undefined
  /** Listener enumeration; must honour `signal`. Default: the platform implementation. */
  listListeners?: (signal: AbortSignal) => Promise<Listener[]>
  probeTimeoutMs?: number
  deadlineMs?: number
  /** Requests that must be destroyed on unload. */
  inflight: Set<{ destroy(): unknown }>
}

/** Bare executable name: no spaces, slashes, controls, markup. Anything else is not trusted → null. */
const BARE_NAME = /^[A-Za-z0-9._+-]{1,64}$/
export const sanitizeProcessName = (name: string | null | undefined): string | null =>
  typeof name === 'string' && BARE_NAME.test(name) ? name : null

// ---------------------------------------------------------------------------
// enumeration

function portOf(text: string): number | undefined {
  if (!/^[1-9][0-9]{0,4}$/.test(text)) return undefined
  const port = Number(text)
  return port <= 65535 ? port : undefined
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -F pcftn` output into loopback/wildcard listeners. */
export function parseLsof(output: string): Listener[] {
  const out: Listener[] = []
  let command: string | null = null
  let type: string | null = null
  for (const line of output.split('\n')) {
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') { command = null; type = null } else if (tag === 'c') command = value
    else if (tag === 'f') type = null
    else if (tag === 't') type = value
    else if (tag === 'n') {
      if (value.includes('->')) continue // an established connection, not a listener
      const colon = value.lastIndexOf(':')
      if (colon < 0) continue
      const host = value.slice(0, colon)
      const port = portOf(value.slice(colon + 1))
      if (port === undefined) continue
      let fam: Family | undefined
      if (host === '127.0.0.1' || host === '0.0.0.0') fam = 'p'
      else if (host === '[::1]' || host === '[::]') fam = 'p6'
      else if (host === '*') fam = type === 'IPv6' ? 'p6' : type === 'IPv4' ? 'p' : undefined
      if (fam !== undefined) out.push({ fam, port, process: sanitizeProcessName(command) })
    }
  }
  return out
}

const V4_ADDRS = new Set(['0100007F', '00000000']) // 127.0.0.1, 0.0.0.0 (little-endian words)
const V6_ADDRS = new Set(['00000000000000000000000001000000', '00000000000000000000000000000000']) // ::1, ::

/** Parse /proc/net/tcp or /proc/net/tcp6 LISTEN rows bound to loopback/wildcard. */
export function parseProcNetTcp(text: string, fam: Family): Array<{ fam: Family; port: number; inode: string }> {
  const out: Array<{ fam: Family; port: number; inode: string }> = []
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 10 || cols[3] !== '0A') continue
    const [address, portHex] = (cols[1] ?? '').split(':')
    if (address === undefined || portHex === undefined) continue
    if (!(fam === 'p' ? V4_ADDRS : V6_ADDRS).has(address.toUpperCase())) continue
    const port = portOf(String(parseInt(portHex, 16)))
    if (port !== undefined) out.push({ fam, port, inode: cols[9] ?? '' })
  }
  return out
}

/** inode → comm (executable name) by scanning /proc/<pid>/fd; unreadable processes are skipped. */
async function linuxProcessNames(inodes: Set<string>, signal: AbortSignal): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const pids = (await readdir('/proc').catch(() => [] as string[])).filter((entry) => /^\d+$/.test(entry))
  for (const pid of pids) {
    if (signal.aborted || names.size === inodes.size) break
    const fds = await readdir(`/proc/${pid}/fd`).catch(() => [] as string[])
    for (const fd of fds) {
      const link = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1]
      if (inode === undefined || !inodes.has(inode) || names.has(inode)) continue
      const comm = (await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim()
      if (comm !== '') names.set(inode, comm)
    }
  }
  return names
}

function runLsof(signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcftn'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onAbort = (): void => { child.kill('SIGKILL'); settle() }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 8 * 1024 * 1024) { child.kill('SIGKILL'); settle(); return } // runaway output: stop, use what we have
      chunks.push(chunk)
    })
    child.on('error', () => { chunks.length = 0; settle() }) // command missing, no permission, …
    child.on('close', settle)
    if (signal.aborted) onAbort()
  })
}

/** Default enumeration for the current platform; resolves `[]` where unsupported. */
export async function listPlatformListeners(signal: AbortSignal): Promise<Listener[]> {
  if (process.platform === 'darwin') return parseLsof(await runLsof(signal))
  if (process.platform === 'linux') {
    const [v4, v6] = await Promise.all([
      readFile('/proc/net/tcp', 'utf8').catch(() => ''),
      readFile('/proc/net/tcp6', 'utf8').catch(() => ''),
    ])
    const rows = [...parseProcNetTcp(v4, 'p'), ...parseProcNetTcp(v6, 'p6')]
    // Names are only needed for ports we will actually list; resolve for the first candidates only.
    const lowest = [...rows].sort((a, b) => a.port - b.port).slice(0, MAX_CANDIDATES)
    const names = await linuxProcessNames(new Set(lowest.map((row) => row.inode)), signal)
    return rows.map((row) => ({ fam: row.fam, port: row.port, process: sanitizeProcessName(names.get(row.inode)) }))
  }
  return []
}

// ---------------------------------------------------------------------------
// probing

/**
 * `GET /` without any credential. Resolves true when the response HEAD says `text/html`.
 * The request is destroyed right after the head (no body read, no redirect followed),
 * on timeout, and on abort.
 */
function probe(listener: Listener, timeoutMs: number, signal: AbortSignal, inflight: Set<{ destroy(): unknown }>): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return }
    const req = httpRequest({
      host: listener.fam === 'p6' ? '::1' : '127.0.0.1',
      port: listener.port,
      method: 'GET',
      path: '/',
      agent: false,
      headers: { accept: 'text/html,*/*;q=0.8', connection: 'close' },
    })
    inflight.add(req)
    let done = false
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      inflight.delete(req)
      // Resolve only once the socket is really gone, so "≤ 16 at once" holds for sockets, not just logically.
      const settle = (): void => resolve(value)
      req.once('close', settle)
      setTimeout(settle, 100).unref()
      req.destroy()
    }
    const onAbort = (): void => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', () => finish(false))
    req.on('response', (res) => {
      const type = res.headers['content-type']
      res.destroy()
      finish(typeof type === 'string' && /^\s*text\/html/i.test(type))
    })
    req.end()
  })
}

export async function discoverServices(deps: ServicesDeps, hostPort: number, parent?: AbortSignal): Promise<ServiceEntry[]> {
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), deps.deadlineMs ?? DEFAULT_SERVICES_DEADLINE_MS)
  const onParent = (): void => budget.abort()
  parent?.addEventListener('abort', onParent, { once: true })
  const signal = budget.signal
  const aborted = new Promise<'aborted'>((resolve) => signal.addEventListener('abort', () => resolve('aborted'), { once: true }))
  const found: Listener[] = []
  try {
    let listeners: Listener[]
    try {
      const raw = await Promise.race([(deps.listListeners ?? listPlatformListeners)(signal), aborted])
      listeners = raw === 'aborted' ? [] : raw
    } catch {
      listeners = [] // no details are exposed
    }
    const seen = new Set<string>()
    const candidates = listeners
      .filter((l) => (l.fam === 'p' || l.fam === 'p6') && Number.isInteger(l.port) && l.port >= 1 && l.port <= 65535 && l.port !== hostPort)
      .filter((l) => { const key = `${l.fam}:${String(l.port)}`; if (seen.has(key)) return false; seen.add(key); return true })
      .sort((a, b) => a.port - b.port || a.fam.localeCompare(b.fam))
      .slice(0, MAX_CANDIDATES)
    let next = 0
    const worker = async (): Promise<void> => {
      while (!signal.aborted) {
        const candidate = candidates[next++]
        if (candidate === undefined) return
        if (await probe(candidate, deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, signal, deps.inflight)) found.push(candidate)
      }
    }
    await Promise.race([Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PROBES, candidates.length) }, worker)), aborted])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', onParent)
    budget.abort() // cancels any probe / child process still outstanding
  }
  return found
    .map((l) => ({ fam: l.fam, port: l.port, process: sanitizeProcessName(l.process) }))
    .sort((a, b) => a.port - b.port || a.fam.localeCompare(b.fam))
}

/** Handler for SERVICES_ROUTE; the caller has already run the browser gate. */
export function serveServices(deps: ServicesDeps, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD')
    sendError(res, 405)
    return
  }
  const hostPort = deps.webServerPort()
  if (!Number.isInteger(hostPort) || (hostPort as number) <= 0) {
    sendError(res, 503, 'Service Unavailable: DSH port unknown')
    return
  }
  const client = new AbortController()
  res.once('close', () => { if (!res.writableFinished) client.abort() })
  void discoverServices(deps, hostPort as number, client.signal).then((entries) => {
    if (client.signal.aborted || res.destroyed) return
    const body = JSON.stringify(entries)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
}
