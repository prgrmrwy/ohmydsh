import { CarrierError } from './http.js'

export interface SocketMessageEvent { readonly data: string | ArrayBuffer | Uint8Array }
export interface SocketCloseEvent { readonly code: number; readonly reason: string }
export interface CarrierSocket {
  readonly readyState: number
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: SocketMessageEvent) => void): void
  addEventListener(type: 'close', listener: (event: SocketCloseEvent) => void): void
  addEventListener(type: 'error', listener: () => void): void
  close(code?: number, reason?: string): void
}
export type SocketFactory = (url: URL) => CarrierSocket
export type EventStreamKind = 'mux' | 'host'
export interface StreamFrame<T> { readonly generation: number; readonly stream: EventStreamKind; readonly value: T }
export interface StreamDisconnect { readonly generation: number; readonly stream: EventStreamKind; readonly code: number; readonly reason: string }

export interface DualEventCarrierOptions<T> {
  readonly endpoint: URL
  readonly generation: number
  readonly currentGeneration: () => number
  readonly createSocket: SocketFactory
  readonly validate: (stream: EventStreamKind, value: unknown) => T
  readonly onFrame: (frame: StreamFrame<T>) => void | Promise<void>
  readonly onDisconnect: (disconnect: StreamDisconnect) => void
  readonly maxQueuedFrames?: number
  readonly maxFrameBytes?: number
}

function websocketUrl(endpoint: URL, stream: EventStreamKind): URL {
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new CarrierError('Protocol', 'event endpoint must be loopback HTTP', false)
  const url = new URL(endpoint)
  url.protocol = 'ws:'
  url.pathname = `/api/events.${stream}`
  return url
}

export class DualEventCarrier<T> {
  readonly #options: DualEventCarrierOptions<T>
  readonly #sockets = new Map<EventStreamKind, CarrierSocket>()
  readonly #queue: StreamFrame<T>[] = []
  #draining = false
  #disposed = false

  constructor(options: DualEventCarrierOptions<T>) {
    this.#options = options
  }

  async open(): Promise<void> {
    if (this.#disposed) throw new Error('event carrier is disposed')
    await Promise.all((['mux', 'host'] as const).map(stream => this.#openStream(stream)))
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const socket of this.#sockets.values()) socket.close(1000, 'disposed')
    this.#sockets.clear()
    this.#queue.length = 0
  }

  #openStream(stream: EventStreamKind): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.#options.createSocket(websocketUrl(this.#options.endpoint, stream))
      this.#sockets.set(stream, socket)
      let opened = false
      socket.addEventListener('open', () => { opened = true; resolve() })
      socket.addEventListener('message', event => this.#message(stream, event))
      socket.addEventListener('error', () => {
        if (!opened) reject(new CarrierError('Transport', `${stream} event stream failed before open`, true))
      })
      socket.addEventListener('close', event => {
        if (!opened) reject(new CarrierError('Transport', `${stream} event stream closed before open`, true))
        if (!this.#disposed && this.#current()) this.#options.onDisconnect({ generation: this.#options.generation, stream, code: event.code, reason: event.reason })
      })
    })
  }

  #message(stream: EventStreamKind, event: SocketMessageEvent): void {
    if (this.#disposed || !this.#current()) return
    const maxBytes = this.#options.maxFrameBytes ?? 1024 * 1024
    const bytes = typeof event.data === 'string' ? new TextEncoder().encode(event.data) : event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data)
    if (bytes.byteLength > maxBytes) {
      this.#failStream(stream, 'frame exceeds configured byte limit')
      return
    }
    let value: T
    try {
      value = this.#options.validate(stream, JSON.parse(new TextDecoder().decode(bytes)))
    } catch (cause) {
      this.#failStream(stream, cause instanceof Error ? cause.message : 'invalid event frame')
      return
    }
    const limit = this.#options.maxQueuedFrames ?? 256
    if (this.#queue.length >= limit) {
      this.#failStream(stream, 'event queue overflow')
      return
    }
    this.#queue.push({ generation: this.#options.generation, stream, value })
    void this.#drain()
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      while (this.#queue.length > 0 && !this.#disposed && this.#current()) {
        const frame = this.#queue.shift()!
        await this.#options.onFrame(frame)
      }
      if (!this.#current()) this.#queue.length = 0
    } finally {
      this.#draining = false
    }
  }

  #failStream(stream: EventStreamKind, reason: string): void {
    const socket = this.#sockets.get(stream)
    socket?.close(1008, reason.slice(0, 120))
    if (!this.#disposed && this.#current()) this.#options.onDisconnect({ generation: this.#options.generation, stream, code: 1008, reason })
  }

  #current(): boolean {
    return this.#options.currentGeneration() === this.#options.generation
  }
}
