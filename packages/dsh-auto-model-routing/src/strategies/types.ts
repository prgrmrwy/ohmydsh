export type Capability = 'bounded' | 'analytical' | 'frontier'
export type StartEffort = 'low' | 'medium' | 'high' | 'xhigh'

/** Everything AUTO knows about one model family. Pure data: engine rules (depth offsets, caps) stay out. */
export interface FamilyStrategy {
  readonly id: string
  readonly label: string
  /** Main-model support: matched case-insensitively against the id after its last `/`. */
  readonly modelPrefixes: readonly string[]
  /** Exact bare model id → recommended starting effort. */
  readonly effortStarts: Readonly<Record<string, StartEffort>>
  /** Bare child model names; the provider's live catalog supplies the full id. */
  readonly childModels: Readonly<Record<Capability, string>>
}
