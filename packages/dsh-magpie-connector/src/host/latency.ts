import { endpointOf, probeSocket, PROBE_TIMEOUT_MS } from './selection.js'
import type { LineSettings } from './settings.js'

/** One measured line: connect time in ms, or null when no connect completed in time. */
export interface LatencyReading { id: string; ms: number | null }

/** Injected probe seam: resolve to the connect time, or null when the deadline passed. */
export type Measure = (host: string, port: number, timeoutMs: number, signal?: AbortSignal) => Promise<number | null>

export interface LatencyControllerOptions {
  measure?: Measure
  timeoutMs?: number
}

const measureSocket: Measure = async (host, port, timeoutMs, signal) => {
  const result = await probeSocket(host, port, timeoutMs, signal)
  return result.reachable ? result.ms : null
}

/**
 * Read-only settings-page measurement: one TCP connect per saved line with a
 * parseable address, all in parallel, each capped by the selection deadline.
 * Measurements are single-flight (concurrent reads share one pass), never touch
 * settings, credentials or the selector cache, and are aborted on dispose.
 */
export class LatencyController {
  private readonly measure: Measure
  private readonly timeoutMs: number
  private readonly controllers = new Set<AbortController>()
  private inFlight: Promise<LatencyReading[]> | undefined
  private disposed = false
  constructor(private readonly lines: () => LineSettings[], options: LatencyControllerOptions = {}) {
    this.measure = options.measure ?? measureSocket
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  }
  async read(): Promise<Response> {
    if (this.disposed) return Response.json({ lines: [] })
    const readings = await this.measureOnce()
    return Response.json({ lines: readings })
  }
  private measureOnce(): Promise<LatencyReading[]> {
    if (this.inFlight) return this.inFlight
    const targets: { id: string; host: string; port: number }[] = []
    for (const line of this.lines()) {
      const endpoint = endpointOf(line.baseUrl)
      if (endpoint) targets.push({ id: line.id, host: endpoint.host, port: endpoint.port })
    }
    const measuring = Promise.all(targets.map(async target => {
      const controller = new AbortController()
      this.controllers.add(controller)
      try { return { id: target.id, ms: await this.measure(target.host, target.port, this.timeoutMs, controller.signal) } }
      catch { return { id: target.id, ms: null } }
      finally { this.controllers.delete(controller) }
    }))
    this.inFlight = measuring.finally(() => { this.inFlight = undefined })
    return this.inFlight
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}
