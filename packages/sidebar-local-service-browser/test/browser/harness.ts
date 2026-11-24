/**
 * Browser test harness (tasks.md 0.2, test-plan "浏览器测试").
 *
 * Topology, mirroring probes/browser-feasibility.mjs but with REAL parts:
 *
 *   headless Chrome ──DevTools protocol──▶ cockpit page (http://127.0.0.1:C, cross-port, same-site)
 *        └─ iframe ▶ DSH test instance (http://127.0.0.1:D): the real Host WebServer, the real
 *                    `dsh-client-connection` (launch-token login → `dsh-auth-*` cookie), the BUILT plugin
 *                    (`lib/index.js`) and the real `dsh-host-frontend-static` fallback serving a tiny dist
 *                    (index.html + harness scripts; in `tab` mode also the BUILT client `lib/client.js`
 *                    mounted through a fake `__ModuleLoader__` / `betterSidebar`).
 *        └─ tab iframe[data-dshls] ▶ /dsh-local-service/p/<port>/… ▶ upstream servers (counted).
 *
 * Chrome comes from `DSHLS_CHROME` (default: the macOS standard path). A missing Chrome
 * FAILS (throws) — it never skips.
 *
 * Zero-count assertions must be paired with a positive control in the same test and run only
 * after an explicit completion signal (see `waitReport`, `waitFor`, `Upstream.directRequests`
 * and `BrowserHarness.directHits`).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import WebSocket, { WebSocketServer } from 'ws'
import { settle, startHostHarness, type HostHarness, type PluginModule } from '../support/host-harness.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(HERE, '../..')
export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
/** Report endpoint on the DSH instance (POST JSON). */
export const REPORT_PATH = '/__harness/report'

// ---------------------------------------------------------------------------
// small utils

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Poll `fn` until it returns a truthy value; throws a descriptive error on timeout. */
export async function waitFor<T>(fn: () => T | Promise<T>, description: string, timeoutMs = 15_000, intervalMs = 50): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  for (;;) {
    try {
      const value = await fn()
      if (value) return value as NonNullable<T>
    } catch (error) {
      lastError = error
    }
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${String(timeoutMs)}ms: ${description}${lastError === undefined ? '' : ` (last error: ${String(lastError)})`}`)
    }
    await sleep(intervalMs)
  }
}

/** Resolve the Chrome binary; throws (never skips) when it is not executable. */
export function findChrome(env: NodeJS.ProcessEnv = process.env): string {
  const path = env.DSHLS_CHROME !== undefined && env.DSHLS_CHROME !== '' ? env.DSHLS_CHROME : DEFAULT_CHROME
  try {
    accessSync(path, constants.X_OK)
  } catch {
    throw new Error(`Chrome not found or not executable at "${path}". Set DSHLS_CHROME to a Chrome/Chromium binary; browser tests never skip.`)
  }
  return path
}

// ---------------------------------------------------------------------------
// minimal DevTools protocol client

interface CdpMessage {
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { message: string; code: number }
  sessionId?: string
}

export class Cdp {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>()
  private readonly listeners = new Set<(message: CdpMessage) => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as CdpMessage
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (entry === undefined) return
        this.pending.delete(message.id)
        if (message.error !== undefined) entry.reject(new Error(`CDP ${entry.method}: ${message.error.message}`))
        else entry.resolve(message.result)
        return
      }
      for (const listener of this.listeners) listener(message)
    })
    socket.on('close', () => {
      for (const entry of this.pending.values()) entry.reject(new Error(`CDP closed during ${entry.method}`))
      this.pending.clear()
    })
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolveConnect, reject) => {
      const socket = new WebSocket(url, { perMessageDeflate: false })
      socket.once('open', () => resolveConnect(new Cdp(socket)))
      socket.once('error', reject)
    })
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject, method })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }), (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  on(listener: (message: CdpMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.socket.close()
  }
}

// ---------------------------------------------------------------------------
// upstream servers (the "local services" on the DSH Host machine)

export interface UpstreamRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
  at: number
}
export interface UpstreamUpgrade {
  url: string
  headers: IncomingHttpHeaders
  at: number
}
export interface Upstream {
  name: string
  port: number
  /** TCP connections accepted (server `connection` event). */
  connections: number
  requests: UpstreamRequest[]
  upgrades: UpstreamUpgrade[]
  /**
   * Requests that reached this upstream NOT through the Host proxy: the proxy always sends
   * `Host: 127.0.0.1:<port>` (spec "已认证的同源请求被转发"), so a different Host name such as
   * `localhost:<port>` can only come from the browser connecting directly.
   * (A browser hitting `127.0.0.1:<port>` literally is indistinguishable here: use `BrowserHarness.directHits`.)
   */
  directRequests(): UpstreamRequest[]
  /** Open (proxied or direct) WebSocket server connections currently alive. */
  openSockets(): number
  close(): Promise<void>
}
export type UpstreamHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void

export interface UpstreamOptions {
  /** `/ws`-like paths that accept an upgrade and echo frames (any path when `true`). Default: none. */
  echoWebSocket?: boolean | ((req: IncomingMessage) => boolean)
  host?: '127.0.0.1' | '::1'
}

export async function startUpstream(name: string, handler: UpstreamHandler, options: UpstreamOptions = {}): Promise<Upstream> {
  const sockets = new Set<Socket>()
  const state: Upstream = {
    name,
    port: 0,
    connections: 0,
    requests: [],
    upgrades: [],
    directRequests: () => state.requests.filter((r) => !/^127\.0\.0\.1:\d+$|^\[::1\]:\d+$/.test(r.headers.host ?? '')),
    openSockets: () => wsServer === undefined ? 0 : wsServer.clients.size,
    close: async () => undefined,
  }
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      state.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body, at: Date.now() })
      handler(req, res, body)
    })
  })
  const accepts = options.echoWebSocket
  const wsServer = accepts === undefined || accepts === false ? undefined : new WebSocketServer({ noServer: true })
  wsServer?.on('connection', (socket) => socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary })))
  server.on('connection', (socket) => {
    state.connections += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    state.upgrades.push({ url: req.url ?? '', headers: req.headers, at: Date.now() })
    const ok = typeof accepts === 'function' ? accepts(req) : accepts === true
    if (wsServer === undefined || !ok) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    wsServer.handleUpgrade(req, socket, head, (client) => wsServer.emit('connection', client, req))
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, options.host ?? '127.0.0.1', () => resolveListen())
  })
  state.port = (server.address() as AddressInfo).port
  state.close = () => new Promise<void>((resolveClose) => {
    for (const socket of sockets) socket.destroy()
    wsServer?.close()
    server.close(() => resolveClose())
  })
  return state
}

// ---------------------------------------------------------------------------
// the DSH dist (index + harness scripts)

/** Reports from page scripts: `{ src, step, ... }` plus the arrival time. */
export interface Report {
  src: string
  step?: string
  at: number
  [key: string]: unknown
}

const SENTINEL = `<script>if (window.frameElement && window.frameElement.hasAttribute('data-dshls')) fetch('${REPORT_PATH}', { method: 'POST', body: JSON.stringify({ src: 'dsh-index', step: 'booted-in-iframe' }) })</script>`

/**
 * Page environment loaded by the DSH test index. Always reports `boot`. In `tab` mode it also
 * provides React (UMD), a fake `__ModuleLoader__`, a fake `ctx.betterSidebar` and mounts the
 * registered tab (`window.__hx.mount()` / `unmount()` / `dispose()`).
 */
const HARNESS_ENV_JS = `(() => {
  const report = (d) => fetch('${REPORT_PATH}', { method: 'POST', body: JSON.stringify({ src: 'dsh-page', ...d }) })
  const hx = (window.__hx = { report, tabs: {}, disposers: [], root: null, mounted: false, applied: false })
  report({ step: 'boot', inTab: !!(window.frameElement && window.frameElement.hasAttribute && window.frameElement.hasAttribute('data-dshls')) })
  if (!window.__HX_TAB_MODE__) return
  const modules = {}
  const MODULE_ID = 'dsh-sidebar-local-service-browser'
  const jsxRuntime = {
    Fragment: React.Fragment,
    jsx: (t, p, k) => React.createElement(t, k === undefined ? p : { ...p, key: k }),
    jsxs: (t, p, k) => React.createElement(t, k === undefined ? p : { ...p, key: k }),
  }
  window.__ModuleLoader__ = { load: (m) => { modules[m.id] = m } }
  const loadClient = () => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'client.js'; s.onload = resolve; s.onerror = () => reject(new Error('client.js failed to load')); document.head.appendChild(s)
  })
  const ctx = {
    betterSidebar: {
      features: [], version: 'harness',
      registerTab(d) { hx.tabs[d.id] = d; return () => { delete hx.tabs[d.id]; hx.unmount() } },
      openTab() {},
    },
    effect(fn) { const r = fn(); if (typeof r === 'function') hx.disposers.push(r) },
  }
  hx.ctx = ctx
  hx.mount = (sessionId = 'harness-session') => {
    const d = hx.tabs['sidebar-local-service-browser']
    if (!d) throw new Error('tab sidebar-local-service-browser is not registered')
    let el = document.getElementById('tab-root')
    if (!el) { el = document.createElement('div'); el.id = 'tab-root'; document.body.appendChild(el) }
    hx.root = ReactDOM.createRoot(el)
    ReactDOM.flushSync(() => hx.root.render(React.createElement(d.component, { ctx, scope: { sessionId }, tab: {}, visible: true })))
    hx.mounted = true
  }
  hx.unmount = () => { if (hx.root) { try { ReactDOM.flushSync(() => hx.root.unmount()) } catch (e) {} hx.root = null; const el = document.getElementById('tab-root'); if (el) el.remove() } hx.mounted = false }
  hx.dispose = () => { hx.unmount(); const ds = hx.disposers.splice(0); for (const d of ds) d() }
  loadClient().then(() => {
    const req = (id) => {
      if (id === 'react') return React
      if (id === 'react/jsx-runtime') return jsxRuntime
      if (id === 'react-dom' || id === 'react-dom/client') return ReactDOM
      return {}
    }
    const exp = modules[MODULE_ID].factory(req)
    hx.exports = exp
    exp.apply(ctx)
    hx.applied = true
    hx.mount()
    report({ step: 'tab-mounted' })
  }).catch((e) => report({ step: 'tab-error', error: String(e && e.stack || e) }))
})()`

const PROBE_SW = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))`

function reactAsset(name: 'react' | 'react-dom'): string {
  const file = name === 'react' ? 'umd/react.development.js' : 'umd/react-dom.development.js'
  const candidates = [resolve(PACKAGE_ROOT, 'node_modules', name, file), resolve(PACKAGE_ROOT, '../../node_modules', name, file)]
  const found = candidates.find((p) => existsSync(p))
  if (found === undefined) throw new Error(`harness: ${name} UMD build not found (tried ${candidates.join(', ')})`)
  return found
}

function buildDist(dir: string, mode: 'tab' | 'bare', extraHead: string): string {
  mkdirSync(join(dir, '__harness-sw'), { recursive: true })
  writeFileSync(join(dir, 'harness-env.js'), HARNESS_ENV_JS)
  writeFileSync(join(dir, '__harness-sw', 'sw.js'), PROBE_SW)
  let scripts = ''
  if (mode === 'tab') {
    const client = resolve(PACKAGE_ROOT, 'lib/client.js')
    if (!existsSync(client)) throw new Error(`harness: ${client} is missing — run "npm run build" first (the browser suite exercises the BUILT plugin)`)
    copyFileSync(client, join(dir, 'client.js'))
    copyFileSync(reactAsset('react'), join(dir, 'react.js'))
    copyFileSync(reactAsset('react-dom'), join(dir, 'react-dom.js'))
    scripts = '<script>window.__HX_TAB_MODE__ = true</script><script src="react.js"></script><script src="react-dom.js"></script>'
  }
  const index = `<!doctype html><html><head><meta charset="utf-8"><title>dsh</title>${SENTINEL}${extraHead}</head><body>DSH${scripts}<script src="harness-env.js"></script></body></html>`
  const distIndex = join(dir, 'index.html')
  writeFileSync(distIndex, index)
  return distIndex
}

// ---------------------------------------------------------------------------
// the harness

export interface BrowserHarnessOptions {
  /** `tab`: mount the BUILT client (needs lib/client.js). `bare` (default): plain DSH page without the tab. */
  mode?: 'tab' | 'bare'
  /** Load the BUILT Host plugin (lib/index.js). Default true. */
  hostPlugin?: boolean
  /**
   * Where the Host plugin comes from. `src` (default): `installHost` from src/host/install.ts with the
   * service-discovery seam stubbed to an empty listing — identical behaviour to production except that
   * the Host never enumerates this machine's listeners and probes the test upstreams (the tab's home page
   * calls /dsh-local-service/services on mount). `lib`: the BUILT lib/index.js, which has no such seam.
   */
  hostSource?: 'src' | 'lib'
  /** Listener list the `src` Host reports to the services endpoint (default: none). */
  listeners?: Array<{ fam: 'p' | 'p6'; port: number; process: string | null }>
  /** Extra Host plugins applied BEFORE the plugin under test (e.g. index-inject test plugins). */
  pluginsBefore?: PluginModule[]
  /** Extra Host plugins applied AFTER the plugin under test. */
  pluginsAfter?: PluginModule[]
  /** Raw HTML appended to the DSH index `<head>` after the sentinel. */
  extraHead?: string
  /** Chrome binary override (default: findChrome()). */
  chrome?: string
}

interface FrameInfo {
  id: string
  parentId?: string
  url: string
}
export interface NetRecord {
  sessionId: string
  requestId: string
  url: string
  method: string
  kind: 'http' | 'websocket'
  fromServiceWorker?: boolean
  failed?: string
  status?: number
  /** Target type of the session that saw it (page / service_worker / worker …). */
  targetType: string
}
export interface DshRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  at: number
}
export interface SwVersion {
  versionId: string
  registrationId: string
  scriptURL: string
  runningStatus: string
  status: string
}

const LOOPBACK_AUTHORITY = /^(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/

export class BrowserHarness {
  readonly net: NetRecord[] = []
  readonly serviceWorkers = new Map<string, SwVersion>()
  readonly upstreams: Upstream[] = []
  private readonly frames = new Map<string, FrameInfo>()
  private readonly contexts = new Map<string, number>()
  private readonly sessionTypes = new Map<string, string>()

  private constructor(
    readonly dsh: HostHarness,
    readonly cockpitUrl: string,
    readonly reports: Report[],
    readonly dshRequests: DshRequest[],
    readonly dshUpgrades: DshRequest[],
    private readonly cockpitServer: Server,
    private readonly cdp: Cdp,
    private readonly chrome: ChildProcess,
    private readonly profile: string,
    private readonly dist: string,
    private readonly pageSession: string,
    readonly chromePath: string,
    private readonly hostPluginFiber: { dispose(): unknown } | undefined,
  ) {}

  static async start(options: BrowserHarnessOptions = {}): Promise<BrowserHarness> {
    const chromePath = options.chrome ?? findChrome()
    const mode = options.mode ?? 'bare'
    const dist = mkdtempSync(join(tmpdir(), 'dshls-dist-'))
    const distIndex = buildDist(dist, mode, options.extraHead ?? '')
    const reports: Report[] = []
    const dshRequests: DshRequest[] = []
    const dshUpgrades: DshRequest[] = []

    const dsh = await startHostHarness({ fallback: 'none', plugin: options.pluginsBefore ?? [] })
    // The plugin under test is applied by hand so a test can dispose exactly this plugin (lifecycle).
    let hostPluginFiber: { dispose(): unknown } | undefined
    if (options.hostPlugin ?? true) {
      let pluginModule: PluginModule
      if ((options.hostSource ?? 'src') === 'lib') {
        const libIndex = resolve(PACKAGE_ROOT, 'lib/index.js')
        if (!existsSync(libIndex)) throw new Error(`harness: ${libIndex} is missing — run "npm run build" first`)
        pluginModule = (await import(pathToFileURL(libIndex).href)) as PluginModule
      } else {
        // Not lib/index.js: that artifact cannot take the listeners stub (see BrowserHarnessOptions.hostSource).
        const { installHost } = await import('../../src/host/install.ts')
        const listeners = options.listeners ?? []
        pluginModule = { name: 'sidebar-local-service-browser', apply: (ctx: Context) => installHost(ctx, { listListeners: () => Promise.resolve(listeners) }) }
      }
      const fiber = dsh.ctx.plugin(pluginModule as never)
      await fiber
      await settle()
      hostPluginFiber = fiber
    }
    for (const extra of options.pluginsAfter ?? []) {
      await dsh.ctx.plugin(extra as never)
      await settle()
    }

    // Observe every HTTP / upgrade request the DSH instance receives (Host-side evidence).
    const httpServer = (dsh.webServer as unknown as { server: Server }).server
    httpServer.on('request', (req: IncomingMessage) => {
      dshRequests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, at: Date.now() })
    })
    httpServer.on('upgrade', (req: IncomingMessage) => {
      dshUpgrades.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, at: Date.now() })
    })
    // Report endpoint (unauthenticated on purpose: it is test plumbing, not product surface).
    dsh.webServer.register({
      kind: 'exact',
      path: REPORT_PATH,
      handler: (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            reports.push({ ...JSON.parse(Buffer.concat(chunks).toString('utf8')), at: Date.now() })
          } catch {
            reports.push({ src: 'harness', step: 'bad-report', at: Date.now() })
          }
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('ok')
        })
      },
    })
    // The real frontend-static fallback serving the dist (index goes through the real renderIndex + taps).
    const staticFiber = dsh.ctx.plugin(FrontendStatic as never, { distIndex } as never)
    await staticFiber
    await new Promise((r) => setTimeout(r, 50))

    // Cockpit stand-in: cross-port, same-site parent embedding the DSH page through the launch-token URL.
    const dshUrl = dsh.connection!.authenticatedUrl(dsh.origin)
    const cockpitServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<!doctype html><html><body>COCKPIT<iframe id="dsh" src="${dshUrl}" style="width:1000px;height:700px"></iframe></body></html>`)
    })
    await new Promise<void>((r) => cockpitServer.listen(0, '127.0.0.1', () => r()))
    const cockpitUrl = `http://127.0.0.1:${String((cockpitServer.address() as AddressInfo).port)}/`

    const profile = mkdtempSync(join(tmpdir(), 'dshls-chrome-'))
    const chrome = spawn(chromePath, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-networking', 'about:blank',
    ], { stdio: 'ignore' })
    try {
      const exited = new Promise<never>((_, reject) => chrome.once('exit', (code) => reject(new Error(`Chrome (${chromePath}) exited early with code ${String(code)}`))))
      const portFile = join(profile, 'DevToolsActivePort')
      const [debugPort, wsPath] = await Promise.race([
        waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').trim().split('\n').length >= 2 ? readFileSync(portFile, 'utf8').trim().split('\n') : undefined, 'Chrome DevToolsActivePort', 20_000),
        exited,
      ]) as [string, string]
      const cdp = await Cdp.connect(`ws://127.0.0.1:${debugPort}${wsPath}`)
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

      const harness = new BrowserHarness(dsh, cockpitUrl, reports, dshRequests, dshUpgrades, cockpitServer, cdp, chrome, profile, dist, sessionId, chromePath, hostPluginFiber)
      harness.sessionTypes.set(sessionId, 'page')
      cdp.on((message) => harness.onEvent(message))
      for (const domain of ['Page', 'Runtime', 'Network', 'ServiceWorker']) await cdp.send(`${domain}.enable`, {}, sessionId)
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)
    return harness
    } catch (error) {
      chrome.kill('SIGKILL')
      throw error
    }
  }

  // ---- events -------------------------------------------------------------

  private onEvent(message: CdpMessage): void {
    const { method, params, sessionId } = message
    if (method === undefined) return
    switch (method) {
      case 'Target.attachedToTarget': {
        const info = params.targetInfo as { type: string }
        const child = params.sessionId as string
        this.sessionTypes.set(child, info.type)
        void this.cdp.send('Network.enable', {}, child).catch(() => undefined)
        break
      }
      case 'Target.detachedFromTarget':
        this.sessionTypes.delete(params.sessionId)
        break
      case 'Page.frameAttached':
        if (!this.frames.has(params.frameId)) this.frames.set(params.frameId, { id: params.frameId, parentId: params.parentFrameId, url: '' })
        break
      case 'Page.frameNavigated': {
        const f = params.frame as { id: string; parentId?: string; url: string }
        this.frames.set(f.id, { id: f.id, ...(f.parentId === undefined ? {} : { parentId: f.parentId }), url: f.url })
        break
      }
      case 'Page.frameDetached':
        this.frames.delete(params.frameId)
        this.contexts.delete(params.frameId)
        break
      case 'Runtime.executionContextCreated': {
        const ctx = params.context as { id: number; auxData?: { frameId?: string; isDefault?: boolean } }
        if (sessionId === this.pageSession && ctx.auxData?.isDefault === true && ctx.auxData.frameId !== undefined) this.contexts.set(ctx.auxData.frameId, ctx.id)
        break
      }
      case 'Runtime.executionContextDestroyed':
        if (sessionId === this.pageSession) for (const [frameId, id] of this.contexts) if (id === params.executionContextId) this.contexts.delete(frameId)
        break
      case 'Runtime.executionContextsCleared':
        if (sessionId === this.pageSession) this.contexts.clear()
        break
      case 'Network.requestWillBeSent':
        this.net.push({
          sessionId: sessionId ?? '', requestId: params.requestId, url: params.request.url, method: params.request.method,
          kind: 'http', targetType: this.sessionTypes.get(sessionId ?? '') ?? 'unknown',
        })
        break
      case 'Network.responseReceived': {
        const rec = this.findNet(sessionId, params.requestId)
        if (rec !== undefined) {
          rec.fromServiceWorker = params.response.fromServiceWorker === true
          rec.status = params.response.status
        }
        break
      }
      case 'Network.loadingFailed': {
        const rec = this.findNet(sessionId, params.requestId)
        if (rec !== undefined) rec.failed = params.errorText
        break
      }
      case 'Network.webSocketCreated':
        this.net.push({
          sessionId: sessionId ?? '', requestId: params.requestId, url: params.url, method: 'GET',
          kind: 'websocket', targetType: this.sessionTypes.get(sessionId ?? '') ?? 'unknown',
        })
        break
      case 'ServiceWorker.workerVersionUpdated':
        for (const v of params.versions as SwVersion[]) this.serviceWorkers.set(v.versionId, v)
        break
      default:
    }
  }

  private findNet(sessionId: string | undefined, requestId: string): NetRecord | undefined {
    for (let i = this.net.length - 1; i >= 0; i--) {
      const rec = this.net[i]!
      if (rec.sessionId === (sessionId ?? '') && rec.requestId === requestId) return rec
    }
    return undefined
  }

  // ---- topology helpers ----------------------------------------------------

  /** Create and start an upstream; it is closed with the harness. */
  async upstream(name: string, handler: UpstreamHandler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`${name}-ok`) }, options?: UpstreamOptions): Promise<Upstream> {
    const up = await startUpstream(name, handler, options)
    this.upstreams.push(up)
    return up
  }

  /** Load cockpit → DSH and wait until the DSH page reported `boot` (and `tab-mounted` in tab mode). */
  async open(): Promise<void> {
    await this.cdp.send('Page.navigate', { url: this.cockpitUrl }, this.pageSession)
    await this.waitReport((r) => r.src === 'dsh-page' && r.step === 'boot', 'DSH page boot report', 20_000)
    if (this.dist !== '' && existsSync(join(this.dist, 'client.js'))) {
      await this.waitReport((r) => r.src === 'dsh-page' && (r.step === 'tab-mounted' || r.step === 'tab-error'), 'tab mount report', 20_000)
      const failed = this.reports.find((r) => r.src === 'dsh-page' && r.step === 'tab-error')
      if (failed !== undefined) throw new Error(`harness: tab failed to mount: ${String(failed.error)}`)
    }
  }

  /** Navigate the top (cockpit) page; use `open()` for the standard topology. */
  async navigateTop(url: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url }, this.pageSession)
  }

  // ---- reports ---------------------------------------------------------------

  /** Wait for the first report (after `since`, default: from the start) matching `predicate`. */
  async waitReport(predicate: (r: Report) => boolean, description: string, timeoutMs = 15_000, since = 0): Promise<Report> {
    return waitFor(() => this.reports.slice(since).find(predicate), `report: ${description}`, timeoutMs)
  }
  reportsOf(predicate: (r: Report) => boolean): Report[] {
    return this.reports.filter(predicate)
  }
  /** A marker to pass as `since` so only later reports count. */
  mark(): number {
    return this.reports.length
  }

  // ---- frames / evaluation ----------------------------------------------------

  listFrames(): FrameInfo[] {
    return [...this.frames.values()]
  }
  private frameAtDepth(depth: number): FrameInfo | undefined {
    const depthOf = (f: FrameInfo): number => {
      let d = 0
      let cur: FrameInfo | undefined = f
      while (cur?.parentId !== undefined) {
        cur = this.frames.get(cur.parentId)
        d += 1
        if (d > 10) return -1
      }
      return cur === undefined ? -1 : d
    }
    const matching = [...this.frames.values()].filter((f) => depthOf(f) === depth && this.contexts.has(f.id))
    return matching[matching.length - 1]
  }

  /** Evaluate `expression` in the default world of a frame (0 = cockpit, 1 = DSH page, 2 = tab iframe). Awaits promises, returns JSON-able values. */
  async evalAt<T = unknown>(depth: 0 | 1 | 2, expression: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const frame = await waitFor(() => this.frameAtDepth(depth), `frame at depth ${String(depth)} with an execution context`, 15_000)
      const contextId = this.contexts.get(frame.id)!
      try {
        const result = await this.cdp.send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true }, this.pageSession)
        if (result.exceptionDetails !== undefined) {
          const d = result.exceptionDetails
          throw new Error(`evaluate failed in depth ${String(depth)}: ${String(d.exception?.description ?? d.text)}`)
        }
        return result.result.value as T
      } catch (error) {
        // The document navigated between picking the context and evaluating: pick again.
        if (attempt < 5 && /Cannot find context|Execution context was destroyed/.test(String(error))) {
          await sleep(100)
          continue
        }
        throw error
      }
    }
  }
  evalCockpit<T = unknown>(expression: string): Promise<T> { return this.evalAt<T>(0, expression) }
  evalDsh<T = unknown>(expression: string): Promise<T> { return this.evalAt<T>(1, expression) }
  evalTab<T = unknown>(expression: string): Promise<T> { return this.evalAt<T>(2, expression) }
  /** URL of the frame at `depth` as the browser sees it. */
  frameUrl(depth: 0 | 1 | 2): string | undefined {
    return this.frameAtDepth(depth)?.url
  }

  // ---- network evidence --------------------------------------------------------

  /**
   * Browser-side direct hits: requests/WebSockets the browser itself sent to `localhost|127.0.0.1|[::1]:<port>`
   * that were NOT answered through a Service Worker (including failed ones). Page, worker and
   * Service Worker targets are all observed. Pair a zero expectation with a positive control
   * (e.g. a deliberate `fetch(..., { mode: 'no-cors' })` from the cockpit page).
   */
  directHits(port: number): NetRecord[] {
    return this.net.filter((r) => {
      let host: string
      try {
        host = new URL(r.url.replace(/^ws/, 'http')).host
      } catch {
        return false
      }
      const m = LOOPBACK_AUTHORITY.exec(host)
      return m !== null && Number(m[2]) === port && r.fromServiceWorker !== true
    })
  }
  /** Network records whose URL path starts with `prefix` on the DSH origin (what the browser actually asked the Host for). */
  hostRequestsMatching(predicate: (r: DshRequest) => boolean): DshRequest[] {
    return this.dshRequests.filter(predicate)
  }

  // ---- service workers -----------------------------------------------------------

  /** Latest known version of the Service Worker whose script URL ends with `suffix`. */
  serviceWorker(suffix: string): SwVersion | undefined {
    const matches = [...this.serviceWorkers.values()].filter((v) => v.scriptURL.endsWith(suffix))
    return matches.find((v) => v.status === 'activated') ?? matches[matches.length - 1]
  }
  /** `ServiceWorker.stopWorker` on the activated worker for `suffix`; resolves once it reports `stopped`. */
  async stopServiceWorker(suffix: string): Promise<void> {
    const version = await waitFor(() => {
      const v = this.serviceWorker(suffix)
      return v !== undefined && v.status === 'activated' ? v : undefined
    }, `activated Service Worker "${suffix}"`)
    await this.cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId }, this.pageSession)
    await waitFor(() => this.serviceWorkers.get(version.versionId)?.runningStatus === 'stopped', `Service Worker "${suffix}" stopped`)
  }

  /** Dispose only the Host plugin under test (routes, taps and in-flight sockets must go away). */
  async disposeHostPlugin(): Promise<void> {
    await this.hostPluginFiber?.dispose()
  }

  /** PNG screenshot of the top page (optionally clipped to a CSS-pixel rectangle). */
  async screenshot(file: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png', ...(clip === undefined ? {} : { clip: { ...clip, scale: 2 } }) }, this.pageSession)
    writeFileSync(file, Buffer.from(shot.data as string, 'base64'))
  }

  // ---- teardown ---------------------------------------------------------------------

  async close(): Promise<void> {
    try {
      this.cdp.close()
    } catch { /* already closed */ }
    this.chrome.kill('SIGKILL')
    await Promise.all(this.upstreams.map((u) => u.close()))
    await new Promise<void>((r) => this.cockpitServer.close(() => r()))
    this.cockpitServer.closeAllConnections?.()
    await this.dsh.dispose()
    rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    rmSync(this.dist, { recursive: true, force: true })
  }
}

export function startBrowserHarness(options?: BrowserHarnessOptions): Promise<BrowserHarness> {
  return BrowserHarness.start(options)
}

/** Re-exported for tests that need a standalone cordis context. */
export { Context }
