import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
export interface RecordedRequest { method: string; path: string; query: string; headers: IncomingHttpHeaders; body: unknown }
export type Reply = (res: ServerResponse, request: RecordedRequest) => void | Promise<void>
export async function createGateway() {
  const requests: RecordedRequest[] = []
  const handlers = new Map<string, Reply>()
  let active = 0, maxConcurrent = 0
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += String(chunk)
    const url = new URL(req.url!, 'http://localhost')
    const request = { method: req.method!, path: url.pathname, query: url.search, headers: req.headers, body: raw ? JSON.parse(raw) : undefined }
    requests.push(request); active++; maxConcurrent = Math.max(active, maxConcurrent)
    res.once('close', () => active--)
    const handler = handlers.get(`${request.method} ${request.path}`)
    if (handler) await handler(res, request)
    else { res.writeHead(404); res.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { baseUrl: `http://127.0.0.1:${port}/v1`, port, requests, handlers,
    get maxConcurrent() { return maxConcurrent },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
/** Open N independent mock gateways (array order = line priority in tests). */
export async function createGateways(count: number) {
  const gateways = []
  for (let index = 0; index < count; index++) gateways.push(await createGateway())
  return gateways
}
/**
 * A loopback HTTP base URL whose port is guaranteed closed: reserve a port,
 * stop listening, and hand the address back. Connect attempts fail fast.
 */
export async function unreachableBaseUrl(host = '127.0.0.1'): Promise<string> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, host, resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  const authority = host.includes(':') ? `[${host}]` : host
  return `http://${authority}:${port}/v1`
}
/** A plain TCP listener for probe-level tests (no HTTP semantics). */
export async function createTcpListener(host = '127.0.0.1') {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve) })
  const port = (server.address() as AddressInfo).port
  return { port, close: async () => new Promise<void>(resolve => server.close(() => resolve())) }
}
export const json = (body: unknown, status = 200): Reply => res => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
export const sse = (events: unknown[], end = true): Reply => res => {
  if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events) res.write(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`)
  if (end) res.end()
}
export function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
