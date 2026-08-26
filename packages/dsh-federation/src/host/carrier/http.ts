export type CarrierErrorKind = 'Transport' | 'Protocol' | 'BodyLimit' | 'Aborted' | 'StaleGeneration'

export class CarrierError extends Error {
  constructor(readonly kind: CarrierErrorKind, message: string, readonly retryable: boolean, readonly status?: number, readonly cause?: unknown) {
    super(message)
    this.name = 'CarrierError'
  }
}

export interface UnaryCarrierOptions {
  readonly endpoint: URL
  readonly generation: number
  readonly currentGeneration: () => number
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

export interface UnaryRequest {
  readonly path: `/api/${string}`
  readonly method?: 'GET' | 'POST'
  readonly body?: unknown
  readonly signal?: AbortSignal
}

/**
 * Minimal unary seam the rc.2 adapter depends on. The loopback carrier and the
 * central in-process transport both satisfy it, so This Mac and remote nodes
 * share one translation and one federated-identity path.
 */
export interface Rc2UnaryTransport {
  request<T>(request: UnaryRequest): Promise<T>
}

function assertLoopback(endpoint: URL): void {
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username !== '' || endpoint.password !== '' || endpoint.pathname !== '/' || endpoint.search !== '' || endpoint.hash !== '') {
    throw new CarrierError('Protocol', 'carrier endpoint must be an origin-only http://127.0.0.1:<port> URL', false)
  }
  const port = Number(endpoint.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CarrierError('Protocol', 'carrier endpoint requires an explicit valid port', false)
}

function combineAbort(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController()
  let timeout = false
  const onAbort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { timeout = true; controller.abort(new Error('carrier timeout')) }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', onAbort) },
  }
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new CarrierError('BodyLimit', 'response exceeds configured body limit', false, response.status)
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      if (signal.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) throw new CarrierError('BodyLimit', 'response exceeds configured body limit', false, response.status)
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

export class HttpUnaryCarrier {
  readonly #endpoint: URL
  readonly #generation: number
  readonly #currentGeneration: () => number
  readonly #fetch: typeof globalThis.fetch
  readonly #timeoutMs: number
  readonly #maxResponseBytes: number

  constructor(options: UnaryCarrierOptions) {
    assertLoopback(options.endpoint)
    this.#endpoint = new URL(options.endpoint)
    this.#generation = options.generation
    this.#currentGeneration = options.currentGeneration
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) throw new Error('invalid carrier timeout')
    if (!Number.isInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1) throw new Error('invalid carrier response limit')
  }

  async request<T>(request: UnaryRequest): Promise<T> {
    this.#assertCurrent()
    const abort = combineAbort(request.signal, this.#timeoutMs)
    const url = new URL(request.path, this.#endpoint)
    try {
      const response = await this.#fetch(url, {
        method: request.method ?? (request.body === undefined ? 'GET' : 'POST'),
        headers: request.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: abort.signal,
      })
      this.#assertCurrent()
      const bytes = await readBounded(response, this.#maxResponseBytes, abort.signal)
      const text = new TextDecoder().decode(bytes)
      let payload: unknown
      try {
        payload = text === '' ? null : JSON.parse(text)
      } catch (cause) {
        throw new CarrierError('Protocol', 'remote response is not valid JSON', false, response.status, cause)
      }
      if (!response.ok) throw new CarrierError('Protocol', `remote HTTP ${response.status}`, response.status >= 500, response.status, payload)
      return payload as T
    } catch (cause) {
      if (cause instanceof CarrierError) throw cause
      if (abort.signal.aborted) throw new CarrierError('Aborted', abort.timedOut() ? 'carrier request timed out' : 'carrier request aborted', abort.timedOut(), undefined, cause)
      throw new CarrierError('Transport', cause instanceof Error ? cause.message : 'carrier transport failed', true, undefined, cause)
    } finally {
      abort.dispose()
    }
  }

  #assertCurrent(): void {
    if (this.#currentGeneration() !== this.#generation) throw new CarrierError('StaleGeneration', 'carrier generation is stale', false)
  }
}
