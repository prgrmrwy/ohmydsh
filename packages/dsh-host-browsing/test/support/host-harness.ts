/**
 * Node test harness for the Host half of dsh-host-browsing
 * (tasks.md 0.3, test-plan "两类测试 → Node 测试").
 *
 * What is REAL: the Host WebServer (`@deepseek-ai/dsh-host-webserver`) listening
 * on a random loopback port, and `@deepseek-ai/dsh-client-connection` with its
 * genuine browser-session authentication — cookies are minted by the package's
 * own `authorizeIndex` token exchange and verified by its own
 * `requestRejection` (Host fence, Sec-Fetch-Site: cross-site, Origin exact match,
 * signed `dsh-auth-*` cookie). Nothing here fakes a gate.
 * What is STUBBED: only the `credentials` service (an in-memory record store the
 * connection plugin needs to keep its signing secret).
 *
 * Usage:
 *
 *   const h = await startHostHarness()                 // webServer + connection (+ plugin under test)
 *   const cookie = await h.login()                     // "dsh-auth-…=…" bound to Host 127.0.0.1:<port>
 *   const other  = await h.login(`localhost:${h.port}`) // a second authority (different cookie name)
 *   const up = await startUpstream((req, res) => res.end('hi'))
 *   const res = await h.request({ path: '/x', headers: { cookie } })   // raw node:http, any headers incl. Host
 *   expect(up.connections).toBe(0)                     // counts upstream `connection` events
 *   await up.close(); await h.dispose()
 *
 * Zero-count assertions MUST be paired with a positive control in the same test
 * (see `positiveControl`), and run only after an explicit completion signal.
 */
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import * as ConnectionPlugin from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'

/** Minimal shape of the services the harness touches (avoids depending on module-augmented Context typing). */
export interface HarnessConnection {
  requestRejection(request: IncomingMessage): number | undefined
  authorizeIndex(request: IncomingMessage, response: ServerResponse): boolean
  authenticatedUrl(baseUrl: string): string
}
export interface HarnessWebServer {
  readonly port: number | undefined
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  registerUpgrade(route: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }): () => void
  registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): () => void
  tapIndex(transform: (html: string) => string): () => void
  renderIndex(html: string, peer: unknown): string
}

/** A cordis plugin module (namespace with `apply`) such as `../../src/index.ts`. */
export type PluginModule = { apply: (ctx: Context, config?: never) => unknown; name?: string; inject?: unknown }

export interface HostHarnessOptions {
  /** Load the real `@deepseek-ai/dsh-client-connection`. Default true. `false` exercises "connection missing". */
  connection?: boolean
  /**
   * Plugin(s) under test, applied after webServer + connection. Default: none.
   * Pass the module namespace, e.g. `await import('../../src/index.ts')`.
   */
  plugin?: PluginModule | PluginModule[]
  /**
   * `minimal` (default, requires connection): fallback that performs the real
   * `authorizeIndex` token exchange on `/` and answers 404 everywhere else, like the
   * official frontend-static fallback does for unknown paths. `none`: leave the
   * WebServer's built-in 404 in place.
   */
  fallback?: 'minimal' | 'none'
  /** Config passed to the connection plugin (e.g. `trustedHosts`). */
  connectionConfig?: Record<string, unknown>
}

export interface RawRequestOptions {
  method?: string
  /** Request target, e.g. `/dsh-local-service/p/5173/x?y=1`. */
  path: string
  headers?: Record<string, string | string[]>
  body?: string | Buffer
  /** Override the TCP port to connect to (default: the Host's port). */
  port?: number
}
export interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
  text(): string
}

export type UpgradeOutcome =
  | { kind: 'upgraded'; status: 101; headers: IncomingHttpHeaders; head: Buffer; socket: Socket }
  | { kind: 'response'; status: number; headers: IncomingHttpHeaders; body: Buffer }
  /** The server closed the connection without any HTTP response (WebServer `socket.destroy()`). */
  | { kind: 'closed' }

export interface HostHarness {
  ctx: Context
  webServer: HarnessWebServer
  connection: HarnessConnection | undefined
  /** The WebServer's actual listening port. */
  port: number
  /** `http://127.0.0.1:<port>` */
  origin: string
  /** `Host` header value for the default authority (`127.0.0.1:<port>`). */
  authority: string
  /**
   * Run the real launch-token exchange for `authority` (default `127.0.0.1:<port>`) and return
   * the minted cookie as `name=value`. The cookie is bound to that authority (its name is derived from it).
   */
  login(authority?: string): Promise<string>
  /** Plain HTTP request over a fresh TCP connection (no agent, no keep-alive), arbitrary headers incl. Host. */
  request(options: RawRequestOptions): Promise<RawResponse>
  /** WebSocket-style Upgrade request without a WebSocket client, so any header can be sent. */
  upgrade(options: RawRequestOptions): Promise<UpgradeOutcome>
  /** Dispose only the plugin(s) under test (routes, taps and in-flight sockets must go away); services stay up. */
  disposePlugins(): Promise<void>
  dispose(): Promise<void>
}

/** In-memory stand-in for the `credentials` service: stores whatever `connection` grants. */
function provideCredentials(ctx: Context): void {
  const records = new Map<unknown, unknown>()
  ctx.provide('credentials', {
    async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>) {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    },
  })
}

function collect(stream: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolveBody(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export async function startHostHarness(options: HostHarnessOptions = {}): Promise<HostHarness> {
  const withConnection = options.connection ?? true
  const fallback = options.fallback ?? 'minimal'
  const ctx = new Context()
  provideCredentials(ctx)
  const webFiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await webFiber
  const webServer = ctx.get('webServer') as unknown as HarnessWebServer
  const port = webServer.port
  if (port === undefined) throw new Error('host-harness: WebServer did not report a listening port')

  const fibers: Array<{ dispose(): unknown }> = [webFiber]
  const pluginFibers: Array<{ dispose(): unknown }> = []
  let connection: HarnessConnection | undefined
  if (withConnection) {
    const connectionFiber = ctx.plugin(ConnectionPlugin as never, options.connectionConfig as never)
    await connectionFiber
    fibers.unshift(connectionFiber)
    connection = ctx.get('connection') as unknown as HarnessConnection
    if (connection === undefined) throw new Error('host-harness: connection service missing after plugin load')
  }

  if (fallback === 'minimal') {
    if (connection === undefined) throw new Error('host-harness: fallback "minimal" needs the connection plugin')
    const conn = connection
    webServer.registerFallback((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (pathname !== '/' && pathname !== '/index.html') {
        res.writeHead(404)
        res.end()
        return
      }
      if (!conn.authorizeIndex(req, res)) return
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head></head><body>dsh-index</body></html>')
    })
  }

  const plugins = options.plugin === undefined ? [] : Array.isArray(options.plugin) ? options.plugin : [options.plugin]
  for (const plugin of plugins) {
    const fiber = ctx.plugin(plugin as never)
    // ctx.inject()/ctx.plugin() callbacks run asynchronously (docs/architecture/dsh-plugin-integration-pitfalls.md):
    // awaiting the fiber settles the plugin's own apply; inject() callbacks inside it may still be pending.
    await fiber
    fibers.unshift(fiber)
    pluginFibers.push(fiber)
    await settle()
  }

  const authority = `127.0.0.1:${String(port)}`

  const request = (opts: RawRequestOptions): Promise<RawResponse> =>
    new Promise((resolveRequest, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: opts.port ?? port,
        method: opts.method ?? 'GET',
        path: opts.path,
        agent: false,
        headers: { host: authority, connection: 'close', ...opts.headers },
      }, (res) => {
        collect(res).then((body) => resolveRequest({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          text: () => body.toString('utf8'),
        }), reject)
      })
      req.on('error', reject)
      req.end(opts.body)
    })

  const upgrade = (opts: RawRequestOptions): Promise<UpgradeOutcome> =>
    new Promise((resolveUpgrade, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: opts.port ?? port,
        method: opts.method ?? 'GET',
        path: opts.path,
        agent: false,
        headers: {
          host: authority,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          ...opts.headers,
        },
      })
      req.on('upgrade', (res, socket, head) => {
        resolveUpgrade({ kind: 'upgraded', status: 101, headers: res.headers, head, socket })
      })
      req.on('response', (res) => {
        collect(res).then((body) => resolveUpgrade({ kind: 'response', status: res.statusCode ?? 0, headers: res.headers, body }), reject)
      })
      req.on('error', (error: NodeJS.ErrnoException) => {
        // WebServer destroys the socket for unknown upgrade paths: node reports ECONNRESET / "socket hang up".
        if (error.code === 'ECONNRESET' || /socket hang up/i.test(error.message)) resolveUpgrade({ kind: 'closed' })
        else reject(error)
      })
      req.end(opts.body)
    })

  const login = async (forAuthority = authority): Promise<string> => {
    if (connection === undefined) throw new Error('host-harness: login() needs the connection plugin')
    const tokenUrl = new URL(connection.authenticatedUrl(`http://${forAuthority}`))
    const res = await request({ path: `${tokenUrl.pathname}${tokenUrl.search}`, headers: { host: forAuthority } })
    if (res.status !== 303) throw new Error(`host-harness: launch-token exchange expected 303, got ${String(res.status)}: ${res.text()}`)
    const setCookie = res.headers['set-cookie']?.[0]
    const cookie = setCookie?.split(';', 1)[0]
    if (cookie === undefined || !cookie.startsWith('dsh-auth-')) throw new Error(`host-harness: no dsh-auth cookie minted (set-cookie: ${String(setCookie)})`)
    return cookie
  }

  return {
    ctx,
    webServer,
    connection,
    port,
    origin: `http://${authority}`,
    authority,
    login,
    request,
    upgrade,
    async disposePlugins() {
      for (const fiber of pluginFibers.splice(0)) await fiber.dispose()
    },
    async dispose() {
      for (const fiber of fibers) await fiber.dispose()
    },
  }
}

/** Let pending `ctx.inject()` callbacks run (they are asynchronous, see pitfalls doc). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r))
}

// ---------------------------------------------------------------------------
// Upstream

export interface ReceivedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  /** Filled as body chunks arrive; complete once the request has ended. */
  body: Buffer
}

export interface Upstream {
  port: number
  /** Number of TCP connections the upstream accepted (`connection` events). */
  connections: number
  /** Number of HTTP requests received. */
  requests: ReceivedRequest[]
  /** HTTP upgrade requests received. */
  upgrades: ReceivedRequest[]
  server: Server
  close(): Promise<void>
}

export interface UpstreamOptions {
  /** Bind address, default `127.0.0.1` (`::1` for the p6 family). */
  host?: '127.0.0.1' | '::1'
  /** Handle an Upgrade request; default: count it and destroy the socket. */
  onUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
}

/**
 * A real `node:http` upstream on a random loopback port that counts TCP
 * connections via the server's `connection` event.
 */
export async function startUpstream(
  handler: RequestListener = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') },
  options: UpstreamOptions = {},
): Promise<Upstream> {
  const host = options.host ?? '127.0.0.1'
  const sockets = new Set<Socket>()
  const state: Upstream = {
    port: 0,
    connections: 0,
    requests: [],
    upgrades: [],
    server: undefined as unknown as Server,
    close: async () => undefined,
  }
  const record = (req: IncomingMessage): ReceivedRequest => {
    const received: ReceivedRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.alloc(0) }
    req.on('data', (chunk: Buffer) => { received.body = Buffer.concat([received.body, chunk]) })
    return received
  }
  const server = createServer((req, res) => {
    state.requests.push(record(req))
    handler(req, res)
  })
  server.on('connection', (socket) => {
    state.connections += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    state.upgrades.push(record(req))
    if (options.onUpgrade !== undefined) options.onUpgrade(req, socket, head)
    else socket.destroy()
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => resolveListen())
  })
  state.port = (server.address() as AddressInfo).port
  state.server = server
  state.close = () => new Promise<void>((resolveClose) => {
    for (const socket of sockets) socket.destroy()
    server.close(() => resolveClose())
  })
  return state
}

/** A loopback port nothing listens on (bound once, then released). */
export async function closedPort(host: '127.0.0.1' | '::1' = '127.0.0.1'): Promise<number> {
  const server = createServer()
  await new Promise<void>((r) => server.listen(0, host, () => r()))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((r) => server.close(() => r()))
  return port
}

/**
 * Positive control for "the counter stays at 0" assertions: proves that a
 * direct request makes `upstream.connections` go up, i.e. the counter can ring.
 * Call it AFTER the zero assertion has been made (it mutates the count).
 */
export async function positiveControl(upstream: Upstream, host: '127.0.0.1' | '::1' = '127.0.0.1'): Promise<void> {
  const before = upstream.connections
  await new Promise<void>((resolveControl, reject) => {
    const req = httpRequest({ host, port: upstream.port, path: '/__positive-control', agent: false, headers: { connection: 'close' } }, (res) => {
      res.resume()
      res.on('end', () => resolveControl())
    })
    req.on('error', reject)
    req.end()
  })
  if (upstream.connections !== before + 1) {
    throw new Error(`positive control failed: upstream connections ${String(before)} → ${String(upstream.connections)}`)
  }
}
