export type Capability = 'bounded' | 'analytical' | 'frontier'
export type StartEffort = 'low' | 'medium' | 'high' | 'xhigh'

/** Everything AUTO knows about one model family. Pure data: engine rules (depth offsets, caps) stay out. */
export interface FamilyStrategy {
  readonly id: string
  readonly label: string
  /** Main-model support: matched case-insensitively against the id after its last `/`. */
  readonly modelPrefixes: readonly string[]
  /** Transport provider → model-id prefix for this family's child models on that transport. */
  readonly transports: Readonly<Record<string, string>>
  /** Exact bare model id → recommended starting effort. */
  readonly effortStarts: Readonly<Record<string, StartEffort>>
  readonly childModels: Readonly<Record<Capability, string>>
}
