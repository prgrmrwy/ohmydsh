export type PublishDirection = 'internal' | 'external'

export interface ScopeEntry {
  readonly name: string
  /** Trusted user setting: absolute library path (defaults to the namespace). */
  readonly home?: string
  readonly pathPrefixes?: readonly string[]
  readonly remotePatterns?: readonly string[]
  readonly publish?: PublishDirection
}

export interface BindingEntry {
  readonly name: string
  readonly read: readonly string[]
  readonly write: readonly string[]
}

export interface ScopeConfig {
  readonly autoDerive: boolean
  readonly scopes: readonly ScopeEntry[]
  readonly bindings: readonly BindingEntry[]
}

export interface ScopeResolution {
  readonly scope: string
  readonly home: string
  readonly homeSource: 'namespace' | 'configured'
  readonly publish: PublishDirection
  /** False only for a directory discovered without config/remote evidence. */
  readonly publishKnown: boolean
  readonly source: 'config' | 'derived' | 'fallback' | 'discovered'
  readonly created: boolean
  readonly workspacePaths: readonly string[]
}

export interface ScopeAccess {
  readonly current: string
  readonly read: readonly string[]
  readonly write: readonly string[]
}

export interface ScopeService {
  /** Pure route resolution: never creates a library. */
  resolve(cwd: string): ScopeResolution
  /** Pure enumeration: never creates a library. */
  list(): readonly ScopeResolution[]
  /** Pure named lookup restricted to known scopes. */
  resolveByName(scope: string): ScopeResolution
  /** Explicitly materialize the standard cards/ directory for one known route. */
  ensure(scope: ScopeResolution): ScopeResolution
  bindingFor(scope: string): BindingEntry | undefined
  accessFor(scope: string): ScopeAccess
}

export interface ScopeResolverOptions {
  readonly homeDir?: string
  readonly namespaceDir?: string
  readonly config?: Partial<ScopeConfig>
  readonly gitRemote?: (cwd: string) => string | undefined
  readonly gitRoot?: (cwd: string) => string | undefined
  readonly directoryExists?: (path: string) => boolean
}

export const DEFAULT_SCOPE_CONFIG: ScopeConfig = {
  autoDerive: true,
  scopes: [],
  bindings: [],
}
