/**
 * WebSocket proxy: the single exact upgrade route `/dsh-local-service/ws?fam=&port=&path=`
 * (design D10). Cookies are `Path=/` so they always reach this route.
 *
 * Admission is the official fence only (browsers send no Sec-Fetch-Site on
 * upgrades; the fence compares Origin and Host exactly). The upstream handshake
 * is rebuilt by hand from an allow-list of headers; after a 101 both sockets
 * are piped, including bytes that arrived with the handshake in either direction.
 */
import { connect } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Socket } from 'node:net'
import type { Family } from '../contract.js'
import { FAMILIES } from '../contract.js'
import { admitUpgrade, closeWithStatus } from './gate.js'
import type { BrowserFence } from './gate.js'
import { cookiePrefix, filterCookieHeader } from './headers.js'
import { parsePort, targetFor } from './target.js'

export interface WsDeps {
  fence: BrowserFence
  webServerPort(): number | undefined
  connectTimeoutMs: number
  inflight: Set<{ destroy(): unknown }>
}

/** Request headers forwarded to the upstream handshake (besides Host/Upgrade/Connection/Cookie/Origin). */
const FORWARDED = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions', 'user-agent'] as const
/** Response headers returned to the browser (no Set-Cookie: it must not reach the DSH origin unrenamed). */
const RETURNED = ['sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions'] as const

const MAX_HANDSHAKE_BYTES = 16 * 1024
/** origin-form path: starts with '/', printable ASCII only — no CR/LF/whitespace/control, no '#'. */
const VALID_PATH = /^\/[\x21-\x22\x24-\x7e]*$/

/** A header value that could break the request framing is never forwarded. */
const safeValue = (value: string): boolean => !/[\r\n\0]/.test(value)

export function createUpgradeHandler(deps: WsDeps): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    socket.pause()
    if (!admitUpgrade(deps.fence, req, socket)) return
    const url = new URL(req.url ?? '/', 'http://x')
    const one = (name: string): string | undefined => {
      const all = url.searchParams.getAll(name)
      return all.length === 1 ? all[0] : undefined
    }
    const fam = one('fam') as Family | undefined
    const port = parsePort(one('port') ?? '')
    const path = one('path')
    if (fam === undefined || !FAMILIES.includes(fam) || port === undefined || path === undefined || !VALID_PATH.test(path)) {
      closeWithStatus(socket, 400)
      return
    }
    const hostPort = deps.webServerPort()
    if (!Number.isInteger(hostPort) || (hostPort as number) <= 0) {
      closeWithStatus(socket, 503)
      return
    }
    if (port === hostPort) {
      closeWithStatus(socket, 400)
      return
    }
    const target = targetFor(fam, port, path)

    const lines = [`GET ${path} HTTP/1.1`, `Host: ${target.authority}`, 'Connection: Upgrade', 'Upgrade: websocket']
    for (const name of FORWARDED) {
      const value = req.headers[name]
      if (typeof value === 'string' && safeValue(value)) lines.push(`${name}: ${value}`)
    }
    const cookie = filterCookieHeader(req.headers.cookie, cookiePrefix(req, target))
    if (cookie !== undefined && safeValue(cookie)) lines.push(`Cookie: ${cookie}`)
    if (req.headers.origin !== undefined) lines.push(`Origin: ${target.origin}`)

    const upstream: Socket = connect({ host: target.host, port: target.port })
    deps.inflight.add(socket)
    deps.inflight.add(upstream)
    const closeBoth = (): void => {
      upstream.destroy()
      socket.destroy()
    }
    upstream.once('close', () => { deps.inflight.delete(upstream); socket.destroy() })
    socket.once('close', () => { deps.inflight.delete(socket); upstream.destroy() })
    upstream.on('error', closeBoth)
    socket.on('error', closeBoth)

    // Connect + handshake must finish within the connect timeout; an established tunnel has no time limit.
    const handshakeTimer = setTimeout(closeBoth, deps.connectTimeoutMs)
    upstream.once('connect', () => upstream.write(`${lines.join('\r\n')}\r\n\r\n`))

    let buffered = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf('\r\n\r\n')
      if (end === -1) {
        if (buffered.length > MAX_HANDSHAKE_BYTES) closeBoth()
        return
      }
      upstream.off('data', onData)
      upstream.pause()
      clearTimeout(handshakeTimer)
      const headLines = buffered.subarray(0, end).toString('latin1').split('\r\n')
      const rest = buffered.subarray(end + 4)
      if (!/^HTTP\/1\.[01] 101\b/.test(headLines[0] ?? '')) {
        closeBoth() // upstream refused the upgrade → close the client, never relay its response
        return
      }
      const returned = new Map<string, string>()
      for (const line of headLines.slice(1)) {
        const colon = line.indexOf(':')
        if (colon > 0) returned.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
      }
      const response = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade']
      for (const name of RETURNED) {
        const value = returned.get(name)
        if (value !== undefined && safeValue(value)) response.push(`${name}: ${value}`)
      }
      socket.write(`${response.join('\r\n')}\r\n\r\n`)
      if (rest.length > 0) socket.write(rest) // frames the upstream sent right behind its 101
      if (head.length > 0) upstream.write(head) // bytes the client sent right behind its request
      upstream.pipe(socket)
      socket.pipe(upstream)
      upstream.resume()
      socket.resume()
    }
    upstream.on('data', onData)
  }
}
