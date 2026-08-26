import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  CarrierError,
  DualEventCarrier,
  HttpUnaryCarrier,
  type CarrierSocket,
  type SocketCloseEvent,
  type SocketMessageEvent,
} from '../src/host/index.js'

class FakeSocket implements CarrierSocket {
  readyState = 0
  readonly url: URL
  readonly closed: { code?: number; reason?: string }[] = []
  readonly listeners = new Map<string, ((event?: unknown) => void)[]>()
  constructor(url: URL) { this.url = url }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: ((event: never) => void) | (() => void)): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener as (event?: unknown) => void)
    this.listeners.set(type, list)
  }
  close(code?: number, reason?: string): void { this.closed.push({ ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) }) }
  emit(type: string, event?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
}

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init })
}

describe('loopback HTTP unary carrier', () => {
  it('accepts only explicit 127.0.0.1 tunnel origins and preserves body/abort contract', async () => {
    let generation = 1
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(init.method).toBe('POST')
      expect(init.body).toBe('{"sessionId":"native"}')
      return jsonResponse({ ok: true })
    })
    const carrier = new HttpUnaryCarrier({ endpoint: new URL('http://127.0.0.1:49152'), generation, currentGeneration: () => generation, fetch: fetch as typeof globalThis.fetch })
    await expect(carrier.request({ path: '/api/session.history', body: { sessionId: 'native' } })).resolves.toEqual({ ok: true })
    expect(() => new HttpUnaryCarrier({ endpoint: new URL('http://localhost:49152'), generation, currentGeneration: () => generation })).toThrow(/127\.0\.0\.1/)
    expect(() => new HttpUnaryCarrier({ endpoint: new URL('http://192.0.2.1:49152'), generation, currentGeneration: () => generation })).toThrow(/127\.0\.0\.1/)
  })

  it('classifies timeout, transport, invalid JSON, HTTP and body-limit errors', async () => {
    const currentGeneration = () => 1
    const cases: [typeof globalThis.fetch, Partial<{ timeoutMs: number; maxResponseBytes: number }>, string][] = [
      [((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof globalThis.fetch, { timeoutMs: 5 }, 'Aborted'],
      [(async () => { throw new Error('socket reset') }) as typeof globalThis.fetch, {}, 'Transport'],
      [(async () => new Response('not json')) as typeof globalThis.fetch, {}, 'Protocol'],
      [(async () => jsonResponse({ error: 'denied' }, { status: 403 })) as typeof globalThis.fetch, {}, 'Protocol'],
      [(async () => new Response('123456789', { headers: { 'content-length': '9' } })) as typeof globalThis.fetch, { maxResponseBytes: 4 }, 'BodyLimit'],
    ]
    for (const [fetch, options, kind] of cases) {
      const carrier = new HttpUnaryCarrier({ endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration, fetch, ...options })
      await expect(carrier.request({ path: '/api/host.describe' })).rejects.toMatchObject({ kind })
    }
  })

  it('rejects stale generation before and after network response', async () => {
    let current = 2
    const carrier = new HttpUnaryCarrier({ endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => current, fetch: vi.fn() as typeof globalThis.fetch })
    await expect(carrier.request({ path: '/api/host.describe' })).rejects.toMatchObject({ kind: 'StaleGeneration' })
    current = 1
    const delayed = new HttpUnaryCarrier({ endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => current, fetch: (async () => { current = 2; return jsonResponse({ ok: true }) }) as typeof globalThis.fetch })
    await expect(delayed.request({ path: '/api/host.describe' })).rejects.toMatchObject({ kind: 'StaleGeneration' })
  })
})

describe('dual WebSocket event carrier', () => {
  it('opens mux and host independently, validates frames and preserves stream identity', async () => {
    const sockets: FakeSocket[] = []
    const frames: unknown[] = []
    const carrier = new DualEventCarrier({
      endpoint: new URL('http://127.0.0.1:49152'),
      generation: 3,
      currentGeneration: () => 3,
      createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); queueMicrotask(() => socket.emit('open')); return socket },
      validate(stream, value) { if (typeof value !== 'object' || value === null) throw new Error(`bad ${stream}`); return value },
      onFrame(frame) { frames.push(frame) },
      onDisconnect() {},
    })
    await carrier.open()
    expect(sockets.map(socket => socket.url.pathname)).toEqual(['/api/events.mux', '/api/events.host'])
    sockets[0]!.emit('message', { data: JSON.stringify({ type: 'mux-event' }) } satisfies SocketMessageEvent)
    sockets[1]!.emit('message', { data: JSON.stringify({ type: 'host-event' }) } satisfies SocketMessageEvent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(frames).toEqual([
      { generation: 3, stream: 'mux', value: { type: 'mux-event' } },
      { generation: 3, stream: 'host', value: { type: 'host-event' } },
    ])
    carrier.dispose()
  })

  it('drops old-generation frames and reports current disconnects', async () => {
    let generation = 1
    const sockets: FakeSocket[] = []
    const frames: unknown[] = []
    const disconnects: unknown[] = []
    const carrier = new DualEventCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => generation,
      createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); queueMicrotask(() => socket.emit('open')); return socket },
      validate: (_stream, value) => value,
      onFrame: frame => { frames.push(frame) },
      onDisconnect: event => { disconnects.push(event) },
    })
    await carrier.open()
    sockets[0]!.emit('close', { code: 1006, reason: 'network' } satisfies SocketCloseEvent)
    expect(disconnects).toHaveLength(1)
    generation = 2
    sockets[0]!.emit('message', { data: '{}' } satisfies SocketMessageEvent)
    sockets[1]!.emit('close', { code: 1006, reason: 'late' } satisfies SocketCloseEvent)
    expect(frames).toEqual([])
    expect(disconnects).toHaveLength(1)
  })

  it('closes invalid, oversized and overflowing streams with bounded queue semantics', async () => {
    const sockets: FakeSocket[] = []
    const releases: (() => void)[] = []
    const disconnects: unknown[] = []
    const carrier = new DualEventCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      maxFrameBytes: 8,
      maxQueuedFrames: 1,
      createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); queueMicrotask(() => socket.emit('open')); return socket },
      validate(_stream, value) { if ((value as { bad?: boolean }).bad) throw new Error('schema invalid'); return value },
      onFrame: () => new Promise<void>(resolve => releases.push(resolve)),
      onDisconnect: event => { disconnects.push(event) },
    })
    await carrier.open()
    sockets[0]!.emit('message', { data: '{"x":1}' } satisfies SocketMessageEvent)
    sockets[0]!.emit('message', { data: '{"y":2}' } satisfies SocketMessageEvent)
    sockets[0]!.emit('message', { data: '{"z":3}' } satisfies SocketMessageEvent)
    expect(disconnects).toHaveLength(1)
    expect(sockets[0]!.closed.at(-1)?.code).toBe(1008)
    sockets[1]!.emit('message', { data: '0123456789' } satisfies SocketMessageEvent)
    expect(disconnects).toHaveLength(2)
    releases.forEach(resolve => resolve())
    carrier.dispose()
  })
})
