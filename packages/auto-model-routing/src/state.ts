import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import type { Effort, Tier } from './effort.js'
import type { JevCategory } from './jev.js'
import { z } from 'zod'
// Legacy files also carried `restore`/`anchor`; they are ignored (non-strict) and dropped on the next write.
const stateSchema = z.object({
  mode: z.enum(['AUTO', 'MANUAL']),
  previous: z.enum(['simple', 'standard', 'complex', 'escalated']).optional(),
  disabled: z.object({ category: z.enum(['missing-credential','insufficient-credits','unauthorized','rate-limited','region-blocked','rejected','unavailable','timeout','invalid-response']), at: z.number() }).strict().optional(),
})
export type Mode = 'AUTO' | 'MANUAL'
export interface Selection { provider: string; model: string; reasoningEffort?: Effort }
export interface Disabled { category: JevCategory; at: number }
export interface SessionState { mode: Mode; previous?: Tier; disabled?: Disabled }
export interface StateStore { get(id: string): SessionState | undefined; set(id: string, value: SessionState): void }

export class FileStateStore implements StateStore {
  constructor(private readonly directory: string) {}
  private path(id: string): string {
    return resolve(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`)
  }
  get(id: string): SessionState | undefined {
    try { return stateSchema.parse(JSON.parse(readFileSync(this.path(id), 'utf8'))) as SessionState }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  set(id: string, value: SessionState): void {
    const target = this.path(id)
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.tmp`
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    // Both paths stay in the fixed state directory; id never supplies path components.
    renameSync(temporary, target)
  }
}

export class RoutingState {
  constructor(private readonly store: StateStore) {}

  read(id: string): SessionState {
    return structuredClone(this.store.get(id) ?? { mode: 'MANUAL' })
  }

  setMode(id: string, mode: Mode): SessionState {
    const state = this.read(id)
    if (state.mode === mode) return state
    // AUTO is the user's explicit retry: it clears the last Jev failure.
    const { disabled: _, ...kept } = state
    return this.save(id, mode === 'AUTO' ? { ...kept, mode } : { ...state, mode })
  }

  /** Jev failed: switch to MANUAL (no restore) and keep the visible reason. */
  disable(id: string, category: JevCategory, at = Date.now()): SessionState {
    const state = this.read(id)
    return this.save(id, { mode: 'MANUAL', ...(state.previous ? { previous: state.previous } : {}), disabled: { category, at } })
  }

  /** Keep the latest user-turn tier (name only) so a restart still sends it to Jev as context. */
  remember(id: string, tier: Tier): void {
    const state = this.read(id)
    if (state.previous !== tier) this.save(id, { ...state, previous: tier })
  }

  private save(id: string, state: SessionState): SessionState {
    this.store.set(id, structuredClone(state))
    return structuredClone(state)
  }
}
