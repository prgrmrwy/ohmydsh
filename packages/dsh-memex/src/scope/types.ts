export type PublishDirection = 'internal' | 'external'

export interface ScopeEntry {
  readonly name: string
  /**
   * Marks this entry as its workspaces' primary entry.
   *
   * A workspace may be claimed by several entries — one library per publication
   * direction, say — and exactly one of them is primary. The primary carries the
   * session's current scope: recall, the graph-level operations, and default
   * reads and writes. A lone claimer needs no flag.
   */
  readonly primary?: boolean
  /** Trusted user setting: absolute library path (defaults to the namespace). */
  readonly home?: string
  readonly pathPrefixes?: readonly string[]
  readonly remotePatterns?: readonly string[]
  readonly publish?: PublishDirection
  /**
   * Whether this entry's workspaces also reach the fallback library (`personal`).
   *
   * Absent means on: a new workspace is usable with no configuration at all. Only
   * an explicit `false` turns it off, and turning it off removes `personal` from
   * both directions — "not using an entry" means neither reading nor writing it.
   */
  readonly fallback?: boolean
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
  /**
   * How this route was produced: from configuration, from a repository's
   * remote, from a local path that belongs to no repository, from a library
   * found under the namespace, or as the implicit `personal` scope that stays
   * resolvable even when it is not declared.
   */
  readonly source: 'config' | 'derived' | 'local' | 'discovered' | 'implicit'
  /**
   * Every entry of the workspace this route belongs to, primary first.
   *
   * Dynamic routes (from a session cwd) list all claimers of that workspace; an
   * enumeration lists what can be known without a cwd, which is the entries
   * sharing a declared path prefix with this one. Editing a workspace's paths is
   * therefore visible here, while the routing decision still comes from a cwd.
   */
  readonly entries: readonly string[]
  /** Reachable entries for a session whose current scope is this route. */
  readonly access: ScopeAccess
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
