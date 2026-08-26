import { CarrierError, type Rc2UnaryTransport, type UnaryRequest } from '../carrier/index.js'

/**
 * The effective composed rc.2 `/api` handler. Federation never reconstructs
 * rc.2 composition and never reaches for a bare ApiProxy: This Mac requests go
 * through the very handler the official runtime serves, so the Typert
 * interceptor-before-fallback order stays intact.
 */
export interface ComposedApiHandler {
  fetch(request: Request): Promise<Response>
}

export interface LocalTransportOptions {
  readonly origin?: string
  readonly maxResponseBytes?: number
}

/**
 * In-process transport for the local node. It speaks the same unary seam as the
 * loopback carrier, so the rc.2 adapter cannot tell the two apart, yet every
 * call is served by local Host semantics.
 */
export class CentralLocalTransport implements Rc2UnaryTransport {
  readonly #handler: ComposedApiHandler
  readonly #origin: string
  readonly #maxResponseBytes: number

  constructor(handler: ComposedApiHandler, options: LocalTransportOptions = {}) {
    this.#handler = handler
    this.#origin = options.origin ?? 'http://127.0.0.1'
    this.#maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
    if (!this.#origin.startsWith('http://127.0.0.1') && !this.#origin.startsWith('http://localhost')) {
      throw new CarrierError('Protocol', 'local transport origin must stay loopback', false)
    }
  }

  async request<T>(request: UnaryRequest): Promise<T> {
    const method = request.method ?? (request.body === undefined ? 'GET' : 'POST')
    const init: RequestInit = {
      method,
      headers: request.body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }
    let response: Response
    try {
      response = await this.#handler.fetch(new Request(new URL(request.path, this.#origin), init))
    } catch (cause) {
      if (request.signal?.aborted === true) throw new CarrierError('Aborted', 'local request aborted', false, undefined, cause)
      throw new CarrierError('Transport', cause instanceof Error ? cause.message : 'local dispatch failed', false, undefined, cause)
    }
    const text = await response.text()
    if (text.length > this.#maxResponseBytes) throw new CarrierError('BodyLimit', 'local response exceeds configured limit', false, response.status)
    let payload: unknown
    try {
      payload = text === '' ? null : JSON.parse(text)
    } catch (cause) {
      throw new CarrierError('Protocol', 'local response is not valid JSON', false, response.status, cause)
    }
    if (!response.ok) throw new CarrierError('Protocol', `local HTTP ${response.status}`, false, response.status, payload)
    return payload as T
  }
}
