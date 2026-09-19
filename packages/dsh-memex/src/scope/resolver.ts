import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  BindingEntry,
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
  const name = path.split('/').filter(Boolean).slice(-2).join('-').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return NAME_RE.test(name) ? name : undefined
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
  const namespaceDir = normalizePath(options.namespaceDir ?? join(homeDir, '.dsh-memex'), homeDir)
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

  const make = (
    scope: string,
    source: ScopeResolution['source'],
    entry?: ScopeEntry,
    workspacePaths: readonly string[] = [],
    publishKnown = true,
  ): ScopeResolution => {
    const result: ScopeResolution = {
      scope,
      home: join(namespaceDir, scope),
      publish: publishFor(entry),
      publishKnown,
      source,
      created: false,
      workspacePaths: [...new Set([...(entry?.pathPrefixes ?? []), ...workspacePaths].map(path => normalizePath(path, homeDir)))],
    }
    known.set(scope, result)
    return result
  }

  const configuredPathMatch = (cwd: string): ScopeResolution | undefined => {
    const matches = config.scopes.flatMap(entry => (entry.pathPrefixes ?? [])
      .filter(prefix => pathSegmentMatches(cwd, prefix))
      .map(prefix => ({ entry, prefix })))
      .sort((a, b) => segmentCount(b.prefix) - segmentCount(a.prefix))
    return matches[0] ? make(matches[0].entry.name, 'config', matches[0].entry) : undefined
  }

  const configuredRemoteMatch = (remote: string, cwd: string): ScopeResolution | undefined => {
    for (const entry of config.scopes) {
      if ((entry.remotePatterns ?? []).some(pattern => new RegExp(pattern).test(remote))) {
        const root = gitRoot(cwd)
        return make(entry.name, 'config', entry, root ? [root] : [cwd])
      }
    }
    return undefined
  }

  const fallback = (): ScopeResolution => make('personal', 'fallback', config.scopes.find(entry => entry.name === 'personal'))

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
        const origin = normalizedRemote(remote)
        const prior = derivedOrigins.get(scope)
        if (prior !== undefined && prior !== origin) throw new Error(`Different remotes derive the same scope ${scope}; add an explicit scope mapping`)
        derivedOrigins.set(scope, origin)
        const root = gitRoot(cwd)
        const host = hostOfRemote(remote)
        const publish: PublishDirection = host !== undefined && INTERNAL_HOSTS.has(host) ? 'internal' : 'external'
        const result = make(scope, 'derived', { name: scope, publish }, root ? [root] : [cwd])
        cache.set(key, result)
        return result
      }
    }
    const result = fallback()
    cache.set(key, result)
    return result
  }

  const list = (): readonly ScopeResolution[] => {
    const result = new Map<string, ScopeResolution>(known)
    for (const entry of config.scopes) {
      // Never clobber an entry resolved in this process: that resolution may
      // carry workspace-path evidence (a real git root) this pure enumeration
      // cannot reconstruct, and losing it would disable the path rule.
      if (!result.has(entry.name)) result.set(entry.name, make(entry.name, 'config', entry))
    }
    try {
      for (const dir of readdirSync(namespaceDir, { withFileTypes: true })) {
        if (!dir.isDirectory() || !NAME_RE.test(dir.name) || result.has(dir.name)) continue
        if (directoryExists(join(namespaceDir, dir.name, 'cards'))) result.set(dir.name, make(dir.name, 'discovered', undefined, [], false))
      }
    } catch { /* namespace may not exist yet */ }
    if (!result.has('personal')) result.set('personal', fallback())
    return [...result.values()]
  }

  const resolveByName = (scope: string): ScopeResolution => {
    if (!NAME_RE.test(scope)) throw new Error(`Unknown or invalid scope: ${scope}`)
    const found = list().find(item => item.scope === scope)
    if (!found) throw new Error(`Unknown scope: ${scope}`)
    return found
  }

  const ensure = (scope: ScopeResolution): ScopeResolution => {
    if (!NAME_RE.test(scope.scope) || scope.home !== join(namespaceDir, scope.scope)) throw new Error(`Invalid memex scope route: ${scope.scope}`)
    if (!existsSync(namespaceDir)) mkdirSync(namespaceDir, { recursive: true })
    assertSafeDirectory(namespaceDir, 'Memex namespace')
    const realNamespace = realpathSync(namespaceDir)
    assertContained(realNamespace, realNamespace)

    const scopeHome = join(namespaceDir, scope.scope)
    const existed = existsSync(join(scopeHome, 'cards'))
    if (!existsSync(scopeHome)) mkdirSync(scopeHome)
    assertSafeDirectory(scopeHome, 'Memex scope home')
    assertContained(realNamespace, realpathSync(scopeHome))

    const cards = join(scopeHome, 'cards')
    if (!existsSync(cards)) mkdirSync(cards)
    assertSafeDirectory(cards, 'Memex cards directory')
    assertContained(realpathSync(scopeHome), realpathSync(cards))
    return { ...scope, created: !existed }
  }

  const bindingFor = (scope: string): BindingEntry | undefined => config.bindings.find(binding => binding.read.includes(scope) || binding.write.includes(scope))
  const accessFor = (scope: string) => {
    const binding = bindingFor(scope)
    if (!binding) return { current: scope, read: [scope], write: scope === 'personal' ? [scope] : [scope, 'personal'] }
    return {
      current: scope,
      read: binding.read.includes('personal') ? [...binding.read] : [...binding.read, 'personal'],
      write: [...binding.write],
    }
  }

  return { resolve: resolveScope, list, resolveByName, ensure, bindingFor, accessFor }
}

export { normalizePath, pathSegmentMatches }
