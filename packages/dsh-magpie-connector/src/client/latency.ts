/** One measurement pass over every saved line: readings keyed by line id. */
export type LatencyState =
  | { phase: 'idle' }
  | { phase: 'measuring' }
  | { phase: 'done'; readings: ReadonlyMap<string, number | null> }
  | { phase: 'failed' }

/** Per-row projection of the panel-wide state. */
export interface LineLatency {
  state: 'idle' | 'measuring' | 'done' | 'failed'
  ms?: number | null
  level?: number
}

/** 4 bars at ≤100/250/450/600ms; a null reading (no connect within 600ms) is level 0. */
export const latencyLevel = (ms: number): number => ms <= 100 ? 4 : ms <= 250 ? 3 : ms <= 450 ? 2 : ms <= 600 ? 1 : 0

/** Parse the host's `{lines: [{id, ms}]}` payload; malformed input reads as a failure. */
export function parseLatency(body: unknown): Map<string, number | null> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const lines = (body as { lines?: unknown }).lines
  if (!Array.isArray(lines)) return undefined
  const readings = new Map<string, number | null>()
  for (const entry of lines) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const { id, ms } = entry as { id?: unknown; ms?: unknown }
    if (typeof id !== 'string') return undefined
    if (ms !== null && (typeof ms !== 'number' || !Number.isFinite(ms))) return undefined
    readings.set(id, ms as number | null)
  }
  return readings
}

const parseable = (baseUrl: string): boolean => { try { return !!new URL(baseUrl).hostname } catch { return false } }

/**
 * A row only ever gets a reading when it is saved (has an id) and its address is
 * parseable; unsaved drafts and empty addresses stay idle in every phase.
 */
export function lineLatency(state: LatencyState, line: { id?: string | undefined; baseUrl: string }): LineLatency {
  const measured = !!line.id && parseable(line.baseUrl)
  if (!measured) return { state: 'idle' }
  if (state.phase === 'failed') return { state: 'failed' }
  if (state.phase !== 'done') return { state: 'measuring' }
  if (!state.readings.has(line.id!)) return { state: 'idle' }
  const ms = state.readings.get(line.id!) ?? null
  return ms === null ? { state: 'done', ms: null, level: 0 } : { state: 'done', ms, level: latencyLevel(ms) }
}
