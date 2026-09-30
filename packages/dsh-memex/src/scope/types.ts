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
  /**
   * Whether memory is on for the workspaces this entry routes.
   *
   * Absent means on. `false` makes the entry's workspaces memory-free: no recall
   * injection, no write reminder, and every memex tool refuses there. It governs
   * those sessions, not the library's reachability from other workspaces — a
   * library that is also someone's fallback target stays writable by them.
   */
  readonly memory?: boolean
}

export interface BindingEntry {
  readonly name: string
  readonly read: readonly string[]
  readonly write: readonly string[]
}

/**
 * A decision about a directory, independent of which library serves it.
 *
 * A library can serve several workspaces, so a decision written on its entry
 * (`ScopeEntry.memory`, `.fallback`, `.primary`) moves with it into every one of
 * them. A declaration is keyed by path instead and only ever closes: `memory`
 * and `fallback` accept nothing but `false`, and a closure covers every session
 * cwd at or under `path` however that session is routed — path claim, remote
 * claim, derivation or local derivation. A directory closed this way can only
 * be reopened by deleting the declaration.
 *
 * `primary` is the one exception: it belongs to the group of entries that claim
 * exactly `path`, and it takes part only when a session is routed by path and
 * the deepest matching prefix is `path` itself.
 */
export interface WorkspaceDeclaration {
  readonly path: string
  readonly primary?: string
  readonly memory?: false
  readonly fallback?: false
}

export interface ScopeConfig {
  readonly autoDerive: boolean
  readonly scopes: readonly ScopeEntry[]
  readonly bindings: readonly BindingEntry[]
  /** Absent is the same as empty: a section written before declarations existed. */
  readonly workspaces?: readonly WorkspaceDeclaration[]
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
  /**
   * False when memory is off for this route: a workspace declaration covering
   * the session cwd closed it, or the primary entry did (`ScopeEntry.memory`).
   */
  readonly memory: boolean
  /**
   * The fallback *decision* (the default grant of `personal`), decided like
   * `memory`. Not reachability: a binding may still list `personal` — see
   * {@link ScopeResolution.personal}.
   */
  readonly fallback: boolean
  /**
   * Whether `personal` is actually reachable from this route, per direction,
   * after bindings: what a session here can really read and write.
   */
  readonly personal: { readonly read: boolean; readonly write: boolean }
  /**
   * How the session cwd was claimed: by a declared path prefix (the deepest
   * one), by a remote pattern, or by nothing (derived, local, or a name-only
   * lookup that has no cwd).
   */
  readonly claim: ScopeClaim
  /** Every source that closed `memory` / `fallback`, outermost declaration first. */
  readonly offBy: { readonly memory: readonly OffSource[]; readonly fallback: readonly OffSource[] }
  readonly created: boolean
  readonly workspacePaths: readonly string[]
}

export type ScopeClaim =
  | { readonly kind: 'path'; readonly prefix: string }
  | { readonly kind: 'remote' }
  | { readonly kind: 'none' }

/** A closure source: a path declaration, or the primary entry's own field. */
export type OffSource =
  | { readonly kind: 'workspace'; readonly path: string }
  | { readonly kind: 'entry'; readonly scope: string }

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
  /** Organization profile; its `internalHosts` mark derived libraries internal. */
  readonly org?: import('../org.js').OrgProfile
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
  workspaces: [],
}
