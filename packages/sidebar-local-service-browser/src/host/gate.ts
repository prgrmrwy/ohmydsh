/**
 * Admission for every HTTP request under the plugin prefix (design D2):
 * (1) official `connection.requestRejection(req)` — status passed through;
 * (2) `Sec-Fetch-Site` ∈ {same-origin, none}; missing or anything else → 403.
 * WebSocket upgrades only get (1): browsers send no Sec-Fetch-Site there, and
 * (1) compares Origin with Host exactly.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

export interface BrowserFence {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway', 503: 'Service Unavailable' }

/** Plain-text error response; never reveals upstream details beyond what the caller passes. */
export function sendError(res: ServerResponse, status: number, body = STATUS_TEXT[status] ?? 'Error'): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

export function admitHttp(fence: BrowserFence, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = fence.requestRejection(req)
  if (rejection !== undefined) {
    sendError(res, rejection)
    return false
  }
  const site = req.headers['sec-fetch-site']
  if (site !== 'same-origin' && site !== 'none') {
    sendError(res, 403)
    return false
  }
  return true
}

/** Upgrade admission: fence only. Answers with a bare status line and closes. */
export function admitUpgrade(fence: BrowserFence, req: IncomingMessage, socket: Duplex): boolean {
  const rejection = fence.requestRejection(req)
  if (rejection === undefined) return true
  closeWithStatus(socket, rejection)
  return false
}

/** Write a minimal HTTP status line and close; never leaves the socket open. */
export function closeWithStatus(socket: Duplex, status: number): void {
  try {
    socket.end(`HTTP/1.1 ${String(status)} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  } catch {
    // socket already gone
  }
  // end() flushes then half-closes; the timer guarantees a peer that never closes cannot hold the socket.
  setTimeout(() => socket.destroy(), 1000).unref()
}
