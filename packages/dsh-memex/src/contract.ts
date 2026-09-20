/**
 * Shared wire contract for dsh-memex's settings surface.
 *
 * One Connection RPC channel carries everything the browser cannot know on its
 * own: what each memory library *is* (path, source, card count) and where it
 * publishes to. The browser cannot read the filesystem or spawn the kernel, so
 * these facts are sampled Host-side and the page never infers them.
 *
 * Endpoint discipline:
 *
 * - `stores` and `resolve` are **pure reads** — they never create, move or
 *   delete anything, and `resolve` deliberately answers for directories that do
 *   not exist yet.
 * - `remote` is the one mutating endpoint, and only for the enumerated remote
 *   actions a human explicitly requests in the page. It delegates to the kernel
 *   CLI; the system itself never writes a library's files.
 *
 * @module dsh-memex/contract
 */

/** The Connection RPC channel this package registers on the host. */
export const MEMEX_CHANNEL = '/dsh-memex'
/** Pure read: every known library with its sampled facts. */
export const MEMEX_STORES_ENDPOINT = 'stores'
/** Pure read: which library a directory resolves to, without creating it. */
export const MEMEX_RESOLVE_ENDPOINT = 'resolve'
/** Pure read: the host's own workspace registry, so the page is not built on guesses. */
export const MEMEX_WORKSPACES_ENDPOINT = 'workspaces'
/** Human-initiated remote action, delegated to the kernel CLI. */
export const MEMEX_REMOTE_ENDPOINT = 'remote'

/** How a route was produced; mirrors the resolver's own vocabulary. */
export type MemexRouteSource = 'config' | 'derived' | 'local' | 'discovered' | 'implicit'

/** One library's sync state, or why it could not be sampled. */
export interface MemexStoreSync {
  /** False when sampling failed; `degraded` then says why (never a guessed value). */
  readonly known: boolean
  readonly configured?: boolean
  readonly remote?: string
  readonly adapter?: string
  readonly auto?: boolean
  readonly lastSync?: string
  /** Stable short reason when the state could not be sampled. */
  readonly degraded?: string
}

/** One memory library as the settings page renders it. */
export interface MemexStoreView {
  readonly scope: string
  /** Absolute library directory. */
  readonly home: string
  readonly homeSource: 'namespace' | 'configured'
  readonly publish: 'internal' | 'external'
  readonly publishKnown: boolean
  readonly source: MemexRouteSource
  /** True when the settings section declares this scope (rather than deriving it). */
  readonly declared: boolean
  /** True when the entry is marked as its workspaces' primary entry. */
  readonly primary: boolean
  /** False when memory is switched off for this library's workspaces. */
  readonly memory: boolean
  /** True when `cards/` exists — the library has been materialized. */
  readonly exists: boolean
  readonly cards?: number
  readonly archive?: number
  readonly pathPrefixes: readonly string[]
  readonly remotePatterns: readonly string[]
  readonly sync: MemexStoreSync
}

/** Kernel identity, so a version mismatch is visible before anything is trusted. */
export interface MemexKernelView {
  /** Version the adapter's pinned parsing was captured against. */
  readonly expected: string
  /** Installed kernel version, absent when it could not be resolved. */
  readonly version?: string
  /** True when an installed kernel matches {@link expected}. */
  readonly matches: boolean
}

/** Answer to the `stores` endpoint. */
export interface MemexStoresResult {
  readonly kernel: MemexKernelView
  /** Namespace directory holding libraries whose home is not configured. */
  readonly namespaceDir: string
  readonly stores: readonly MemexStoreView[]
}

/**
 * One host workspace, with the route its directory resolves to.
 *
 * The workspace list is the page's skeleton: the user's own workspaces are a DSH
 * concept, and the configured path prefixes are only a copy of them. `route` is
 * what a session started in that directory would actually use — a proposal for
 * undeclared workspaces, never a config write.
 */
export interface MemexWorkspaceView {
  readonly id: string
  readonly title: string
  readonly path: string
  /** Where this directory resolves today; absent when resolution itself failed. */
  readonly route?: MemexResolveResult
}

/** Answer to the `workspaces` endpoint. */
export interface MemexWorkspacesResult {
  /**
   * False when the host provides no workspace registry.
   *
   * A distinct answer from an empty list on purpose: "no workspaces" and "cannot
   * know the workspaces" lead to different pages, and the second one degrades to
   * the configuration-only shape instead of claiming the user has none.
   */
  readonly known: boolean
  /**
   * Home directory used to expand configured `~/…` prefixes.
   *
   * Registry paths are absolute while configured path prefixes usually are not;
   * without this the page could not tell that `~/mydir/dev/nexus` and
   * `/Users/me/mydir/dev/nexus` are the same workspace.
   */
  readonly homeDir: string
  readonly items: readonly MemexWorkspaceView[]
}

/** Answer to the `resolve` endpoint. */
export interface MemexResolveResult {
  readonly path: string
  readonly scope: string
  readonly home: string
  readonly publish: 'internal' | 'external'
  readonly publishKnown: boolean
  /** False when memory is switched off for the workspaces this directory routes. */
  readonly memory: boolean
  readonly source: MemexRouteSource
  readonly exists: boolean
  /**
   * True when this directory is the session-scope of nothing in particular:
   * a locally derived library rather than a repository-backed one.
   */
  readonly local: boolean
}

/** Every remote action the page may request; each maps to one kernel invocation. */
export type MemexRemoteAction = 'init' | 'sync' | 'push' | 'pull' | 'auto-on' | 'auto-off'

/** Request body of the `remote` endpoint. */
export interface MemexRemoteRequest {
  readonly scope: string
  readonly action: MemexRemoteAction
  /** Required for `init`: the remote URL the user typed. */
  readonly url?: string
}

/** Outcome of one remote action; transport succeeded whenever this is returned. */
export interface MemexRemoteResult {
  readonly status: 'ok' | 'failed'
  /** Kernel stdout, trimmed (may be empty). */
  readonly output?: string
  /** Failure summary — the kernel's stderr, capped. */
  readonly message?: string
}
