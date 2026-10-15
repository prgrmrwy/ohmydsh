import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import type { Effort } from './classifier.js'
import { z } from 'zod'
const stateSchema = z.object({
  mode: z.enum(['AUTO', 'MANUAL']), restore: z.boolean(),
  anchor: z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.enum(['low','medium','high','xhigh','max']).optional(), provenance: z.enum(['initialized','user-selected']) }).strict().optional(),
}).strict()
export type Mode = 'AUTO' | 'MANUAL'
export interface Selection { provider: string; model: string; reasoningEffort?: Effort }
export interface Anchor extends Selection { provenance: 'initialized' | 'user-selected' }
export interface SessionState { mode: Mode; anchor?: Anchor; restore: boolean }
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
    return structuredClone(this.store.get(id) ?? { mode: 'MANUAL', restore: false })
  }

  initialize(id: string, selection: Selection, latestPick?: Selection): SessionState {
    if (latestPick) return this.select(id, latestPick)
    const state = this.read(id)
    if (state.anchor) return state
    return this.save(id, { ...state, anchor: { ...selection, provenance: 'initialized' } })
  }

  select(id: string, selection: Selection): SessionState {
    const state = this.read(id)
    const anchor: Anchor = { ...selection, provenance: 'user-selected' }
    if (state.anchor?.provenance === anchor.provenance && state.anchor.provider === anchor.provider && state.anchor.model === anchor.model && state.anchor.reasoningEffort === anchor.reasoningEffort) return state
    return this.save(id, { ...state, anchor })
  }

  setMode(id: string, mode: Mode): SessionState {
    const state = this.read(id)
    if (state.mode === mode) return state
    return this.save(id, { ...state, mode, restore: state.restore || mode === 'MANUAL' })
  }

  completeRestore(id: string): void {
    const state = this.read(id)
    if (state.restore) this.save(id, { ...state, restore: false })
  }

  private save(id: string, state: SessionState): SessionState {
    this.store.set(id, structuredClone(state))
    return structuredClone(state)
  }
}
