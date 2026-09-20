import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  BindingEntry,
  ScopeAccess,
  PublishDirection,
  ScopeConfig,
  ScopeEntry,
  ScopeResolution,
  ScopeResolverOptions,
  ScopeService,
} from './types.js'

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INTERNAL_HOSTS = new Set(['code.byted.org'])

function normalizePath(path: string, home = homedir()): string {
  const expanded = path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
  const absolute = resolve(expanded)
  return absolute.length > 1 ? absolute.replace(/[\\/]$/, '') : absolute
}

function pathSegmentMatches(cwd: string, prefix: string): boolean {
  const a = normalizePath(cwd)
  const b = normalizePath(prefix)
  return a === b || a.startsWith(`${b}${sep}`)
}

function segmentCount(path: string): number {
  return normalizePath(path).split(/[\\/]+/).filter(Boolean).length
}

function remotePath(remote: string): string | undefined {
  const value = remote.trim().replace(/\/+$/, '')
  const scp = value.match(/^[^/@]+@[^:]+:(.+)$/)
  if (scp?.[1]) return scp[1].replace(/\/+$/, '').replace(/\.git$/i, '')
  try {
    const parsed = new URL(value)
    return parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') || undefined
  } catch {
    return undefined
  }
}

export function hostOfRemote(remote: string): string | undefined {
  const scp = remote.match(/^[^/@]+@([^:]+):/)
  if (scp?.[1]) return scp[1].toLowerCase()
  try { return new URL(remote).hostname.toLowerCase() || undefined } catch { return undefined }
}

export function deriveScopeFromRemote(remote: string): string | undefined {
  const path = remotePath(remote)
  if (!path || path.includes(' ')) return undefined
  const name = normalizeScopeName(path.split('/').filter(Boolean).slice(-2).join('-'))
  return NAME_RE.test(name) ? name : undefined
}

function normalizeScopeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Fallback library name for a local path whose tail cannot form a scope name.
 *
 * Resolution has to stay total: a directory whose last segments carry no usable
 * ASCII name still belongs to exactly one library, and inventing a transient or
 * per-invocation location for it would make the route unprovable.
 */
export const LOCAL_SCOPE_FALLBACK = 'local'

/**
 * Derive a scope name from a local path that belongs to no repository.
 *
 * Mirrors {@link deriveScopeFromRemote}: the last two path segments joined with
 * `-` and normalized. Taking only the last segment would silently merge
 * `…/work/learning` with `…/Documents/learning` into one library, which is the
 * same isolation failure the remote rule avoids.
 * @param path - the session cwd (or any directory) to derive from.
 * @param homeDir - home directory used to expand a leading `~`.
 * @returns a valid scope name, or {@link LOCAL_SCOPE_FALLBACK} when none exists.
 */
export function deriveScopeFromLocalPath(path: string, homeDir = homedir()): string {
  const segments = normalizePath(path, homeDir).split(/[\\/]+/).filter(Boolean)
  // Each of the two segments must survive normalization on its own: joining a
  // dropped segment would name the library after whatever ASCII happened to
  // surround it (`/Users/me/我的项目/src` must not become `src`).
  const tail = segments.slice(-2).map(normalizeScopeName)
  const name = tail.every(segment => segment.length > 0) ? tail.join('-') : ''
  return NAME_RE.test(name) ? name : LOCAL_SCOPE_FALLBACK
}

/**
 * Source identity of a locally derived scope.
 *
 * Shaped like {@link normalizedRemote} (`<kind>/<identity>`) so one collision
 * check covers both derivation paths: the same scope name claimed by two
 * different remotes, two different local paths, or one of each, is an error.
 */
function normalizedLocalOrigin(path: string, homeDir: string): string {
  return `local/${normalizePath(path, homeDir).toLowerCase()}`
}

/**
 * The namespace every scope's library lives under unless it is configured
 * elsewhere. One definition, so the resolver and the settings channel cannot
 * report different locations.
 * @param homeDir - home directory to anchor the namespace at.
 * @returns the absolute namespace directory.
 */
export function defaultNamespaceDir(homeDir = homedir()): string {
  return normalizePath(join(homeDir, '.dsh-memex'), homeDir)
}

function normalizedRemote(remote: string): string {
  const host = hostOfRemote(remote) ?? ''
  const path = remotePath(remote) ?? remote.trim().toLowerCase()
  return `${host}/${path.toLowerCase()}`
}

function publishFor(entry: ScopeEntry | undefined): PublishDirection { return entry?.publish ?? 'external' }
function mergeConfig(config?: Partial<ScopeConfig>): ScopeConfig {
  return { autoDerive: config?.autoDerive ?? true, scopes: config?.scopes ?? [], bindings: config?.bindings ?? [] }
}

function assertSafeDirectory(path: string, label: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory, not a symlink: ${path}`)
}

function assertContained(parent: string, child: string): void {
  const rel = relative(parent, child)
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return
  throw new Error(`Memex library escapes namespace: ${child}`)
}

export function createScopeResolver(options: ScopeResolverOptions = {}): ScopeService {
  const homeDir = options.homeDir ?? homedir()
  const namespaceDir = normalizePath(options.namespaceDir ?? defaultNamespaceDir(homeDir), homeDir)
  const config = mergeConfig(options.config)
  const directoryExists = options.directoryExists ?? existsSync
  const gitRemote = options.gitRemote ?? ((cwd: string) => {
    try {
      return execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
      }).trim() || undefined
    } catch { return undefined }
  })
  const gitRoot = options.gitRoot ?? ((cwd: string) => {
    try {
      return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
      }).trim() || undefined
    } catch { return undefined }
  })

  const cache = new Map<string, ScopeResolution>()
  const known = new Map<string, ScopeResolution>()
  const derivedOrigins = new Map<string, string>()

  /**
   * Reachable entries for a session whose current scope is `scope`.
   *
   * Four parts compose it: the current scope, the other entries of the same
   * workspace, whatever the current scope's binding declares, and the fallback
   * library. Reach is not a default action — see `dsh-memex-memory`: reads and
   * writes only touch the current scope unless a target is named explicitly.
   *
   * The fallback is a *default grant*: `personal` is reachable in both
   * directions unless the entry turns it off. A binding never cancels it — a
   * binding only adds — but a binding that lists `personal` explicitly keeps it
   * reachable even when the default was turned off, because an explicit
   * declaration outranks a default.
   */
  const accessOf = (scope: string, entries: readonly string[], fallback: boolean): ScopeAccess => {
    const siblings = entries.filter(name => name !== scope)
    const read = new Set<string>([scope, ...siblings])
    const write = new Set<string>([scope, ...siblings])
    const binding = config.bindings.find(item => item.read.includes(scope) || item.write.includes(scope))
    if (binding !== undefined) {
      for (const name of binding.read) read.add(name)
      for (const name of binding.write) write.add(name)
    }
    if (fallback && scope !== 'personal') {
      read.add('personal')
      write.add('personal')
    }
    return { current: scope, read: [...read], write: [...write] }
  }

  /** The fallback grant for one scope name; absent entries keep the default. */
  const fallbackOf = (scope: string): boolean =>
    config.scopes.find(entry => entry.name === scope)?.fallback !== false

  const make = (
    scope: string,
    source: ScopeResolution['source'],
    entry?: ScopeEntry,
    workspacePaths: readonly string[] = [],
    publishKnown = true,
    workspaceEntries?: readonly string[],
  ): ScopeResolution => {
    const configuredHome = entry?.home === undefined ? undefined : normalizePath(entry.home, homeDir)
    const entries = [...new Set(workspaceEntries ?? [scope])]
    const resolvedEntries = entries.includes(scope) ? entries : [scope, ...entries]
    const result: ScopeResolution = {
      scope,
      home: configuredHome ?? join(namespaceDir, scope),
      homeSource: configuredHome === undefined ? 'namespace' : 'configured',
      publish: publishFor(entry),
      publishKnown,
      source,
      created: false,
      workspacePaths: [...new Set([...(entry?.pathPrefixes ?? []), ...workspacePaths].map(path => normalizePath(path, homeDir)))],
      entries: resolvedEntries,
      access: accessOf(scope, resolvedEntries, fallbackOf(scope)),
    }
    known.set(scope, result)
    return result
  }

  /**
   * Pick the primary entry among the claimers of one workspace.
   *
   * Ambiguity fails loudly rather than falling back to declaration order: the
   * silent first-match rule is exactly how a knowledge domain's memory ends up in
   * another library without anyone noticing.
   */
  const primaryOf = (claimers: readonly ScopeEntry[], workspace: string): ScopeEntry => {
    const unique = [...new Map(claimers.map(entry => [entry.name, entry])).values()]
    if (unique.length === 1) return unique[0]!
    const primaries = unique.filter(entry => entry.primary === true)
    if (primaries.length !== 1) {
      throw new Error(
        `Workspace ${workspace} is claimed by ${unique.map(entry => entry.name).join(', ')} but has ${primaries.length} primary entries; mark exactly one with primary: true`,
      )
    }
    return primaries[0]!
  }

  /** Entries sharing a declared path prefix with `scope`, for enumerations. */
  const staticSiblings = (scope: string): string[] => {
    const mine = config.scopes.find(entry => entry.name === scope)
    if (mine === undefined) return [scope]
    const prefixes = new Set((mine.pathPrefixes ?? []).map(prefix => normalizePath(prefix, homeDir)))
    if (prefixes.size === 0) return [scope]
    const shared = config.scopes.filter(entry => entry.name !== scope
      && (entry.pathPrefixes ?? []).some(prefix => prefixes.has(normalizePath(prefix, homeDir))))
      .map(entry => entry.name)
    return [scope, ...shared]
  }

  /**
   * Route a cwd by declared path prefix.
   *
   * Every claimer of the **deepest** matching prefix belongs to this workspace;
   * the longest prefix still wins over shorter ones, but ties are no longer
   * resolved by declaration order — the primary flag decides, and an ambiguous
   * tie is an error.
   */
  const configuredPathMatch = (cwd: string): ScopeResolution | undefined => {
    const matches = config.scopes.flatMap(entry => (entry.pathPrefixes ?? [])
      .filter(prefix => pathSegmentMatches(cwd, prefix))
      .map(prefix => ({ entry, prefix })))
    if (matches.length === 0) return undefined
    const deepest = Math.max(...matches.map(match => segmentCount(match.prefix)))
    const claimers = matches.filter(match => segmentCount(match.prefix) === deepest).map(match => match.entry)
    const primary = primaryOf(claimers, cwd)
    const entries = [...new Map(claimers.map(entry => [entry.name, entry])).values()]
      .map(entry => entry.name)
      .filter(name => name !== primary.name)
    return make(primary.name, 'config', primary, [], true, [primary.name, ...entries])
  }

  /**
   * Record which source produced a derived scope name.
   *
   * Two different sources that normalize to one name would silently share a
   * library, so the second claim fails loudly instead — the caller can then add
   * an explicit scope mapping if the merge was intended.
   */
  const claimDerived = (scope: string, origin: string): void => {
    const prior = derivedOrigins.get(scope)
    if (prior !== undefined && prior !== origin) {
      throw new Error(`Different sources derive the same scope ${scope} (${prior} vs ${origin}); add an explicit scope mapping`)
    }
    derivedOrigins.set(scope, origin)
  }

  /**
   * Resolve a configured remote claim.
   *
   * Whether two patterns overlap cannot be decided from the configuration alone
   * (they are regular expressions), so ambiguity is detected here instead: one
   * remote matching several scopes is an error, not a silent first-match win
   * that would route a knowledge domain's memory into another scope's library.
   */
  const configuredRemoteMatch = (remote: string, cwd: string): ScopeResolution | undefined => {
    const matches = config.scopes.filter(entry => (entry.remotePatterns ?? []).some(pattern => new RegExp(pattern).test(remote)))
    if (matches.length === 0) return undefined
    const primary = primaryOf(matches, remote)
    const entries = matches.map(entry => entry.name).filter(name => name !== primary.name)
    const root = gitRoot(cwd)
    return make(primary.name, 'config', primary, root ? [root] : [cwd], true, [primary.name, ...entries])
  }

  /**
   * The `personal` library as a scope in its own right.
   *
   * It is always resolvable — write targets include it by default — but it is no
   * longer where an unowned directory lands: that is local derivation.
   */
  const personalScope = (): ScopeResolution => {
    const entry = config.scopes.find(item => item.name === 'personal')
    return make('personal', entry === undefined ? 'implicit' : 'config', entry)
  }

  const resolveScope = (cwd: string): ScopeResolution => {
    const key = normalizePath(cwd, homeDir)
    const cached = cache.get(key)
    if (cached) return cached
    const pathMatch = configuredPathMatch(cwd)
    if (pathMatch) { cache.set(key, pathMatch); return pathMatch }

    let remote: string | undefined
    try { remote = gitRemote(cwd) } catch { remote = undefined }
    if (remote) {
      const remoteMatch = configuredRemoteMatch(remote, cwd)
      if (remoteMatch) { cache.set(key, remoteMatch); return remoteMatch }
      const scope = config.autoDerive ? deriveScopeFromRemote(remote) : undefined
      if (scope) {
        claimDerived(scope, normalizedRemote(remote))
        const root = gitRoot(cwd)
        const host = hostOfRemote(remote)
        const publish: PublishDirection = host !== undefined && INTERNAL_HOSTS.has(host) ? 'internal' : 'external'
        const result = make(scope, 'derived', { name: scope, publish }, root ? [root] : [cwd])
        cache.set(key, result)
        return result
      }
    }

    // A directory belonging to no repository still has exactly one library: the
    // one derived from its own path. It is never merged into a shared library,
    // and it carries no sync target until a human configures one.
    const scope = deriveScopeFromLocalPath(cwd, homeDir)
    const declared = config.scopes.find(entry => entry.name === scope)
    const root = gitRoot(cwd)
    if (declared === undefined) claimDerived(scope, normalizedLocalOrigin(cwd, homeDir))
    const result = make(scope, 'local', declared, root ? [root] : [cwd])
    cache.set(key, result)
    return result
  }

  const list = (): readonly ScopeResolution[] => {
    const result = new Map<string, ScopeResolution>(known)
    for (const entry of config.scopes) {
      // Never clobber an entry resolved in this process: that resolution may
      // carry workspace-path evidence (a real git root) this pure enumeration
      // cannot reconstruct, and losing it would disable the path rule.
      if (!result.has(entry.name)) result.set(entry.name, make(entry.name, 'config', entry, [], true, staticSiblings(entry.name)))
    }
    try {
      for (const dir of readdirSync(namespaceDir, { withFileTypes: true })) {
        if (!dir.isDirectory() || !NAME_RE.test(dir.name) || result.has(dir.name)) continue
        if (directoryExists(join(namespaceDir, dir.name, 'cards'))) result.set(dir.name, make(dir.name, 'discovered', undefined, [], false))
      }
    } catch { /* namespace may not exist yet */ }
    if (!result.has('personal')) result.set('personal', personalScope())
    return [...result.values()]
  }

  const resolveByName = (scope: string): ScopeResolution => {
    if (!NAME_RE.test(scope)) throw new Error(`Unknown or invalid scope: ${scope}`)
    const found = list().find(item => item.scope === scope)
    if (!found) throw new Error(`Unknown scope: ${scope}`)
    return found
  }

  const ensure = (scope: ScopeResolution): ScopeResolution => {
    if (!NAME_RE.test(scope.scope)) throw new Error(`Invalid memex scope route: ${scope.scope}`)
    if (!isAbsolute(scope.home)) throw new Error(`Memex library path must be absolute: ${scope.home}`)
    if (scope.homeSource === 'namespace' && scope.home !== join(namespaceDir, scope.scope)) throw new Error(`Invalid namespace route for scope: ${scope.scope}`)
    // A configured library may live inside its owning repository, so the
    // namespace root is created lazily only when it is actually the parent.
    const parent = dirname(scope.home)
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    if (!existsSync(namespaceDir) && scope.homeSource === 'namespace') mkdirSync(namespaceDir, { recursive: true })
    const scopeHome = scope.home
    const existed = existsSync(join(scopeHome, 'cards'))
    if (!existsSync(scopeHome)) mkdirSync(scopeHome)
    assertSafeDirectory(scopeHome, 'Memex scope home')
    if (scope.homeSource === 'namespace') assertContained(realpathSync(namespaceDir), realpathSync(scopeHome))

    const cards = join(scopeHome, 'cards')
    if (!existsSync(cards)) mkdirSync(cards)
    assertSafeDirectory(cards, 'Memex cards directory')
    assertContained(realpathSync(scopeHome), realpathSync(cards))
    return { ...scope, created: !existed }
  }

  const bindingFor = (scope: string): BindingEntry | undefined => config.bindings.find(binding => binding.read.includes(scope) || binding.write.includes(scope))
  /**
   * Reach for a scope named without a workspace context.
   *
   * A session's route carries the authoritative `access` (it knows which entries
   * claim that cwd); this name-only form answers with what can be known without
   * one, i.e. the entries sharing a declared path prefix.
   */
  const accessFor = (scope: string): ScopeAccess => accessOf(scope, staticSiblings(scope), fallbackOf(scope))

  return { resolve: resolveScope, list, resolveByName, ensure, bindingFor, accessFor }
}

export { normalizePath, pathSegmentMatches }
