/**
 * Pure editing model behind the Memory settings page.
 *
 * Everything here is framework-free and unit-tested: the page renders these
 * rows, and the same functions decide what a save would store and which
 * conflicts block it. The rules mirror the Host validator for the two claims
 * that are decidable from the configuration itself; pattern *overlap* is not
 * decidable here and is detected by the resolver instead.
 *
 * @module dsh-memex/client/settings-model
 */
import type { MemexStoreView, MemexWorkspacesResult } from '../contract.js'

/** One scope entry as stored in the settings section. */
export interface MemexScopeEntry {
  readonly name: string
  readonly primary?: boolean
  readonly home?: string
  readonly pathPrefixes?: readonly string[]
  readonly remotePatterns?: readonly string[]
  readonly publish?: 'internal' | 'external'
  readonly fallback?: boolean
}

/** The part of the settings section this page reads. */
export interface MemexSettingsShape {
  readonly scopes?: readonly MemexScopeEntry[]
}

/** One editable row: a memory library and the workspaces claimed for it. */
export interface EditorRow {
  /** Stable React key; survives renames while editing. */
  readonly key: string
  readonly name: string
  readonly paths: readonly string[]
  readonly repos: readonly string[]
  /** Explicit library path; empty means the namespace default applies. */
  readonly home: string
  /**
   * Whether this entry is its workspaces' primary entry. Undefined means "not
   * marked": legal while it is the only claimer, rejected once another entry
   * claims the same workspace.
   */
  readonly primary?: boolean
  /** Carried through untouched — the page never edits the publication direction. */
  readonly publish?: 'internal' | 'external'
  /**
   * Whether this entry's workspaces also reach the fallback library (`personal`).
   *
   * Only the *primary* entry of a workspace is read for this, because only it
   * carries the session's current scope. Undefined means the Host default (on).
   */
  readonly fallback?: boolean
  /** True when this row came from the saved configuration. */
  readonly saved: boolean
}

/**
 * One entry row inside a workspace: either a declared entry or the fallback.
 *
 * The fallback has no configuration row of its own — it is the Host's default
 * grant of `personal`, toggled through the primary entry's `fallback` flag.
 */
export interface WorkspaceEntryRow {
  readonly kind: 'entry' | 'fallback' | 'assumed'
  /** The library name; empty for a staged new entry. */
  readonly name: string
  /** Draft row behind this entry; absent for the fallback and the assumed primary. */
  readonly row?: EditorRow
  /** True when this entry is the workspace's primary entry. */
  readonly primary: boolean
  /** True when the fallback grant is on (only meaningful for `fallback`). */
  readonly enabled?: boolean
}

/** One workspace block: the unit the page is built from. */
export interface WorkspaceView {
  /** Stable React key. */
  readonly key: string
  /** Display title: the host workspace's title, or the declared path. */
  readonly title: string
  /** Absolute workspace directory; empty for a block built only from config paths. */
  readonly path: string
  /** False when this block came from configuration because no workspace registry existed. */
  readonly fromRegistry: boolean
  /** The editable paths this block's entries claim. */
  readonly paths: readonly string[]
  readonly entries: readonly WorkspaceEntryRow[]
  /** The library a session in this directory would use today, when nothing declares it. */
  readonly assumed?: { readonly scope: string; readonly home: string; readonly source: string }
  /** Declared entries that could still be attached to this workspace. */
  readonly candidates: readonly EntryCandidate[]
  /** The configuration group behind a block that has no workspace, for path editing. */
  readonly group?: WorkspaceGroup
}

/** One option in the "add an entry" picker. */
export interface EntryCandidate {
  readonly name: string
  /** True when the library exists under the namespace without being declared. */
  readonly discovered: boolean
}

/** Literal scope-name grammar, matching the Host schema. */
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripGit(url: string): { host: string; path: string } | undefined {
  const scp = url.match(/^[^/@\s]+@([^:/\s]+):(.+)$/)
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    return { host: scp[1], path: scp[2].replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') }
  }
  try {
    const parsed = new URL(url)
    if (parsed.hostname === '') return undefined
    return { host: parsed.hostname, path: parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') }
  } catch {
    return undefined
  }
}

/**
 * Turn what a user types in the repository field into a stored remote pattern.
 *
 * A git URL becomes a pattern that matches the repository on any transport
 * (`host[:/]owner/repo`); anything else is kept verbatim so an operator can
 * still write a regular expression by hand.
 * @param input - typed repository URL or pattern.
 * @returns the pattern to store (empty input stays empty).
 */
export function repoToPattern(input: string): string {
  const value = input.trim()
  if (value === '') return ''
  const git = stripGit(value)
  if (git === undefined || git.path === '') return value
  return `${escapeRegExp(git.host)}[:/]${escapeRegExp(git.path)}`
}

/** The library path used when a scope declares none. */
export function defaultHome(namespaceDir: string, name: string): string {
  const base = namespaceDir.replace(/[/\\]+$/, '')
  return name === '' ? `${base}/` : `${base}/${name}`
}

/** Build the editable rows from the saved section. */
export function rowsFromSettings(settings: MemexSettingsShape | undefined): EditorRow[] {
  return (settings?.scopes ?? []).map((entry, index) => ({
    key: `saved-${entry.name}-${String(index)}`,
    name: entry.name,
    paths: [...(entry.pathPrefixes ?? [])],
    repos: [...(entry.remotePatterns ?? [])],
    home: entry.home ?? '',
    ...(entry.primary === true ? { primary: true } : {}),
    ...(entry.publish !== undefined ? { publish: entry.publish } : {}),
    ...(entry.fallback !== undefined ? { fallback: entry.fallback } : {}),
    saved: true,
  }))
}

let addedCounter = 0

/** Append one blank row (a library the user is about to declare). */
export function addRow(rows: readonly EditorRow[]): EditorRow[] {
  addedCounter += 1
  return [...rows, { key: `new-${String(addedCounter)}`, name: '', paths: [''], repos: [], home: '', saved: false }]
}

/** Append a row that declares an existing library. */
export function declareRow(rows: readonly EditorRow[], store: MemexStoreView): EditorRow[] {
  addedCounter += 1
  const already = rows.some(row => row.name === store.scope && row.paths.length === 0)
  if (already) return [...rows]
  return [...rows, {
    key: `declare-${store.scope}-${String(addedCounter)}`,
    name: store.scope,
    paths: [],
    repos: [],
    home: store.homeSource === 'configured' ? store.home : '',
    saved: false,
  }]
}

/** What a save would store: only the fields this page owns, everything else carried through. */
export function toScopes(rows: readonly EditorRow[]): MemexScopeEntry[] {
  return rows.map(row => {
    const paths = row.paths.map(path => path.trim()).filter(path => path !== '')
    const repos = row.repos.map(pattern => pattern.trim()).filter(pattern => pattern !== '')
    const home = row.home.trim()
    return {
      name: row.name.trim(),
      ...(paths.length > 0 ? { pathPrefixes: paths } : {}),
      ...(repos.length > 0 ? { remotePatterns: repos } : {}),
      ...(home !== '' ? { home } : {}),
      ...(row.primary === true ? { primary: true } : {}),
      ...(row.publish !== undefined ? { publish: row.publish } : {}),
      ...(row.fallback !== undefined ? { fallback: row.fallback } : {}),
    }
  })
}

/** Index the sampled facts by scope name for the row they belong to. */
export function storesByName(stores: readonly MemexStoreView[] | undefined): Map<string, MemexStoreView> {
  return new Map((stores ?? []).map(store => [store.scope, store]))
}

/**
 * Libraries that exist but no entry declares.
 *
 * Scopes a workspace already shows as its own route are excluded: that block is
 * the stronger place to declare them, because declaring there also records the
 * workspace they belong to. What stays here is the genuinely unaccounted for —
 * a library directory that no workspace resolves to.
 * @param stores - sampled library facts.
 * @param rows - the draft rows.
 * @param accounted - scopes the page already presents as some workspace's entry.
 * @returns the stores worth listing on their own.
 */
export function undeclaredStores(
  stores: readonly MemexStoreView[] | undefined,
  rows: readonly EditorRow[],
  accounted: readonly string[] = [],
): MemexStoreView[] {
  const known = new Set([...rows.map(row => row.name.trim()), ...accounted])
  return (stores ?? []).filter(store => !store.declared && !known.has(store.scope))
}

/**
 * Reasons a draft cannot be saved, in the user's words.
 *
 * Only claims decidable from the configuration are judged here — the same two
 * the Host validator rejects. Whether two *patterns* overlap needs a remote to
 * test against and is answered by the resolver at session time.
 * @param rows - the draft rows.
 * @param namespaceDir - namespace used to resolve each row's effective library path.
 * @returns one message per conflict; empty means the draft may be submitted.
 */
export function conflicts(
  rows: readonly EditorRow[],
  namespaceDir: string,
  messages: { name: string; home: string; pattern: string; primary: string },
): string[] {
  const problems: string[] = []
  const named = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (!NAME_RE.test(name)) problems.push(`${messages.name}: ${name === '' ? '(empty)' : name}`)
    else if (named.has(name)) problems.push(`${messages.name}: ${name}`)
    named.add(name)
  }

  const homes = new Map<string, string>()
  rows.forEach((row, index) => {
    const name = row.name.trim()
    const home = row.home.trim() === '' ? defaultHome(namespaceDir, name) : row.home.trim()
    const owner = homes.get(home)
    if (owner !== undefined) problems.push(`${messages.home}: ${owner} · ${name === '' ? `#${String(index + 1)}` : name}`)
    homes.set(home, name === '' ? `#${String(index + 1)}` : name)
  })

  // One workspace, several entries: exactly one of them must be the primary.
  const claims = (pairs: Array<[string, EditorRow]>): void => {
    const byWorkspace = new Map<string, EditorRow[]>()
    for (const [key, row] of pairs) byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), row])
    for (const [key, claimers] of byWorkspace) {
      const unique = [...new Map(claimers.map(row => [row.name.trim(), row])).values()]
      if (unique.length < 2) continue
      const primaries = unique.filter(row => row.primary === true)
      if (primaries.length !== 1) {
        problems.push(`${messages.primary}: ${key} ← ${unique.map(row => row.name.trim()).join(', ')}`)
      }
    }
  }
  claims(rows.flatMap(row => row.paths.map(path => path.trim()).filter(path => path !== '').map(path => [path, row] as [string, EditorRow])))
  claims(rows.flatMap(row => row.repos.map(pattern => pattern.trim()).filter(pattern => pattern !== '').map(pattern => [pattern, row] as [string, EditorRow])))
  return problems
}

/** One workspace group: the paths it covers and the entries that claim them. */
export interface WorkspaceGroup {
  /** Stable key: the sorted names of the entries claiming these paths. */
  readonly key: string
  /** The shared paths, in declaration order. */
  readonly paths: readonly string[]
  /** The claiming entries, primary first. */
  readonly rows: readonly EditorRow[]
}

/**
 * Group the draft into workspaces.
 *
 * Paths claimed by exactly the same set of entries form one group, so the common
 * case — one entry owning several directories — stays one block, while a project
 * whose knowledge is split across an internal and an external library shows both
 * entries in the same block. Entries claiming no path at all get a block of their
 * own: they are not a shared workspace, they are a library waiting for one.
 * @param rows - the draft rows.
 * @returns groups in first-appearance order, entries primary first inside each.
 */
export function groupsOf(rows: readonly EditorRow[]): WorkspaceGroup[] {
  const claimers = new Map<string, string[]>()
  for (const row of rows) {
    for (const path of row.paths) {
      const key = path.trim()
      if (key === '') continue
      claimers.set(key, [...(claimers.get(key) ?? []), row.name.trim()])
    }
  }

  const byEntrySet = new Map<string, { paths: string[]; names: string[] }>()
  for (const row of rows) {
    const own = row.paths.map(path => path.trim()).filter(path => path !== '')
    // A row with no path of its own stands alone, keyed by its position in the draft.
    const buckets = own.length === 0
      ? [`solo:${row.key}`]
      : [...new Set(own.map(path => [...new Set(claimers.get(path) ?? [])].sort().join('|')))]
    for (const bucket of buckets) {
      const found = byEntrySet.get(bucket) ?? { paths: [], names: [] }
      const names = bucket.startsWith('solo:') ? [row.name.trim()] : bucket.split('|')
      for (const path of own) if (claimers.get(path)?.includes(row.name.trim()) === true && names.includes(row.name.trim())) {
        if (!found.paths.includes(path)) found.paths.push(path)
      }
      for (const name of names) if (!found.names.includes(name)) found.names.push(name)
      byEntrySet.set(bucket, found)
    }
  }

  const order = new Map(rows.map((row, index) => [row.key, index]))
  const seen = new Map<string, number>()
  for (const row of rows) {
    for (const path of row.paths.map(value => value.trim()).filter(value => value !== '')) {
      const bucket = [...new Set(claimers.get(path) ?? [])].sort().join('|')
      if (!seen.has(bucket)) seen.set(bucket, order.get(row.key) ?? 0)
    }
    if (row.paths.every(path => path.trim() === '') && !seen.has(`solo:${row.key}`)) seen.set(`solo:${row.key}`, order.get(row.key) ?? 0)
  }

  return [...byEntrySet.entries()]
    .sort((a, b) => (seen.get(a[0]) ?? 0) - (seen.get(b[0]) ?? 0))
    .map(([key, value]) => {
      const members = value.names
        .map(name => rows.find(row => row.name.trim() === name))
        .filter((row): row is EditorRow => row !== undefined)
      const ordered = [...members.filter(row => row.primary !== true), ...members.filter(row => row.primary === true)].reverse()
      return { key, paths: value.paths, rows: ordered.length > 0 ? ordered : members }
    })
    .filter(group => group.rows.length > 0)
}

/**
 * Rename one shared path on every entry of a group.
 *
 * The group is the workspace, so a path it covers must stay the same string in
 * all of its entries — otherwise the entries would describe two workspaces.
 */
export function setPathInGroup(rows: readonly EditorRow[], group: WorkspaceGroup, index: number, value: string): EditorRow[] {
  const from = group.paths[index]
  const members = new Set(group.rows.map(row => row.key))
  return rows.map(row => (members.has(row.key)
    ? { ...row, paths: row.paths.map(path => (path === from ? value : path)) }
    : row))
}

/** Append an empty path to every entry of a group. */
export function addPathToGroup(rows: readonly EditorRow[], group: WorkspaceGroup): EditorRow[] {
  const members = new Set(group.rows.map(row => row.key))
  return rows.map(row => (members.has(row.key) ? { ...row, paths: [...row.paths, ''] } : row))
}

/** Drop one shared path from every entry of a group. */
export function removePathFromGroup(rows: readonly EditorRow[], group: WorkspaceGroup, index: number): EditorRow[] {
  const members = new Set(group.rows.map(row => row.key))
  return rows.map(row => (members.has(row.key) ? { ...row, paths: row.paths.filter((_, at) => at !== index) } : row))
}

/** Add one more entry to a group, keeping exactly one primary behind it. */
export function addEntryToGroup(rows: readonly EditorRow[], group: WorkspaceGroup): EditorRow[] {
  addedCounter += 1
  const paths = group.paths.length > 0 ? [...group.paths] : ['']
  const next: EditorRow = { key: `entry-${String(addedCounter)}`, name: '', paths, repos: [], home: '', saved: false }
  // A second claimer makes the primary flag load-bearing: keep the existing entry
  // as the primary so the draft is valid the moment it is saved.
  const members = new Set(group.rows.map(row => row.key))
  const groupAlreadyPrimary = group.rows.some(item => item.primary === true)
  const kept = rows.map(row => {
    if (!members.has(row.key)) return row
    if (groupAlreadyPrimary || row.primary === true) return row
    return { ...row, primary: true }
  })
  return [...kept, next]
}

/** Move the primary flag inside one group. */
export function setPrimaryInGroup(rows: readonly EditorRow[], group: WorkspaceGroup, key: string): EditorRow[] {
  const members = new Set(group.rows.map(row => row.key))
  return rows.map(row => {
    if (row.key === key) return { ...row, primary: true }
    if (members.has(row.key)) return { ...row, primary: false }
    return row
  })
}


/* ------------------------------------------------------------------ *
 * Workspace-first view (the page's skeleton)
 * ------------------------------------------------------------------ */

/** Expand a leading `~` using the Host's home directory and drop trailing slashes. */
export function expandPath(path: string, homeDir: string): string {
  const trimmed = path.trim()
  const expanded = trimmed === '~'
    ? homeDir
    : trimmed.startsWith('~/')
      ? `${homeDir.replace(/\/+$/, '')}/${trimmed.slice(2)}`
      : trimmed
  return expanded.length > 1 ? expanded.replace(/\/+$/, '') : expanded
}

function segmentCount(path: string): number {
  return path.split('/').filter(Boolean).length
}

/**
 * Whether `path` is `prefix` or lives under it — the Host's own rule.
 *
 * Compared segment-wise, so `/a/bc` is not under `/a/b`. Both sides are expanded
 * first: configured prefixes are usually written `~/…` while a workspace path is
 * always absolute, and comparing the two raw strings would match nothing.
 */
export function underPath(path: string, prefix: string, homeDir: string): boolean {
  const a = expandPath(path, homeDir)
  const b = expandPath(prefix, homeDir)
  if (b === '') return false
  return a === b || a.startsWith(`${b}/`)
}

/**
 * The entries claiming one workspace directory.
 *
 * Mirrors the resolver: only the **deepest** matching prefix counts, so a more
 * specific claim elsewhere does not silently attach itself to this workspace.
 */
export function claimersOf(rows: readonly EditorRow[], path: string, homeDir: string): EditorRow[] {
  const depths = rows.map(row => {
    const own = row.paths
      .map(candidate => expandPath(candidate, homeDir))
      .filter(candidate => candidate !== '' && underPath(path, candidate, homeDir))
    return own.length === 0 ? -1 : Math.max(...own.map(segmentCount))
  })
  const deepest = Math.max(-1, ...depths)
  if (deepest < 0) return []
  return rows.filter((_, index) => depths[index] === deepest)
}

/** The primary entry of a workspace: the marked one, or its only claimer. */
export function primaryOf(claimers: readonly EditorRow[]): EditorRow | undefined {
  const marked = claimers.filter(row => row.primary === true)
  if (marked.length === 1) return marked[0]
  if (marked.length === 0 && claimers.length === 1) return claimers[0]
  return undefined
}

function entryRows(claimers: readonly EditorRow[]): WorkspaceEntryRow[] {
  const primary = primaryOf(claimers)
  return claimers
    .map((row): WorkspaceEntryRow => ({
      kind: 'entry',
      name: row.name.trim(),
      row,
      primary: primary !== undefined && row.key === primary.key,
    }))
    .sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1))
}

/**
 * Build the page's blocks: one per host workspace, plus declared paths that
 * belong to no workspace.
 *
 * The host's registry is the skeleton because the user's workspaces are a DSH
 * concept and the configured path prefixes are only a copy of them; a workspace
 * no configuration mentions still has to appear, otherwise there is no way to
 * give it an entry. When the registry is unavailable the blocks are built from
 * configuration alone, which is a degradation the page states out loud.
 * @param rows - the draft rows.
 * @param workspaces - the host's workspace answer, when the channel answered.
 * @param stores - sampled library facts, used to offer undeclared libraries.
 * @returns workspace blocks in registry order, configuration-only blocks last.
 */
export function workspaceViews(
  rows: readonly EditorRow[],
  workspaces: MemexWorkspacesResult | undefined,
  stores: readonly MemexStoreView[] | undefined = [],
): WorkspaceView[] {
  const homeDir = workspaces?.homeDir ?? ''
  const views: WorkspaceView[] = []
  const covered = new Set<string>()

  if (workspaces?.known === true) {
    for (const item of workspaces.items) {
      const path = expandPath(item.path, homeDir)
      const claimers = claimersOf(rows, path, homeDir).filter(row => row.name.trim() !== '')
      for (const row of rows) {
        for (const own of row.paths) {
          if (own.trim() !== '' && underPath(path, own, homeDir)) covered.add(expandPath(own, homeDir))
        }
      }
      covered.add(path)
      const primary = primaryOf(claimers)
      const entries = entryRows(claimers)
      if (primary === undefined && item.route !== undefined) {
        entries.unshift({ kind: 'assumed', name: item.route.scope, primary: true })
      }
      // The fallback is a property of the workspace's route, so an undeclared
      // workspace has one too — turning it off is what stages a declaration.
      if (primary !== undefined && primary.name.trim() !== 'personal') {
        entries.push({ kind: 'fallback', name: 'personal', primary: false, enabled: primary.fallback !== false })
      } else if (primary === undefined && item.route !== undefined && item.route.scope !== 'personal') {
        entries.push({ kind: 'fallback', name: 'personal', primary: false, enabled: true })
      }
      views.push({
        key: `ws:${item.id}`,
        title: item.title.trim() === '' ? path : item.title,
        path,
        fromRegistry: true,
        paths: [path],
        entries,
        ...(primary === undefined && item.route !== undefined
          ? { assumed: { scope: item.route.scope, home: item.route.home, source: item.route.source } }
          : {}),
        candidates: candidatesFor(rows, stores, claimers),
      })
    }
  }

  // Declared paths that no workspace covers stay visible: hiding configuration
  // would make it uneditable, which is worse than an extra block.
  const leftovers = rows.filter(row => row.paths.every(path => path.trim() === '' || !covered.has(expandPath(path, homeDir))))
  for (const group of groupsOf(leftovers)) {
    const primary = primaryOf(group.rows)
    const entries = entryRows(group.rows.filter(row => row.name.trim() !== ''))
    if (primary !== undefined && primary.name.trim() !== 'personal') {
      entries.push({ kind: 'fallback', name: 'personal', primary: false, enabled: primary.fallback !== false })
    }
    views.push({
      key: `cfg:${group.key}`,
      title: group.paths[0] ?? group.rows[0]?.name.trim() ?? '',
      path: group.paths[0] ?? '',
      fromRegistry: false,
      paths: group.paths,
      entries,
      candidates: candidatesFor(rows, stores, group.rows),
      group,
    })
  }

  return views
}

/** Libraries that could still be attached to one workspace. */
export function candidatesFor(
  rows: readonly EditorRow[],
  stores: readonly MemexStoreView[] | undefined,
  attached: readonly EditorRow[],
): EntryCandidate[] {
  const attachedNames = new Set(attached.map(row => row.name.trim()).filter(name => name !== ''))
  const declared = rows
    .map(row => row.name.trim())
    .filter(name => name !== '' && !attachedNames.has(name))
  const discovered = (stores ?? [])
    .filter(store => !store.declared && !attachedNames.has(store.scope) && !declared.includes(store.scope))
    .map(store => store.scope)
  return [
    ...[...new Set(declared)].map(name => ({ name, discovered: false })),
    ...[...new Set(discovered)].map(name => ({ name, discovered: true })),
  ]
}

/**
 * Stage the workspace's derived library as a declared primary entry.
 *
 * Required whenever the page is about to give an undeclared workspace a second
 * claimer or a fallback decision: `resolve()` stops deriving the moment any
 * declaration matches the directory, so a declaration without the primary flag
 * would quietly move the workspace's memory to whichever library got declared.
 */
export function stageAssumedPrimary(rows: readonly EditorRow[], view: WorkspaceView): EditorRow[] {
  const assumed = view.assumed
  if (assumed === undefined || view.path === '') return [...rows]
  const already = claimersOf(rows, view.path, '').some(row => row.name.trim() === assumed.scope)
  if (already) return [...rows]
  addedCounter += 1
  return [...rows, {
    key: `assumed-${assumed.scope}-${String(addedCounter)}`,
    name: assumed.scope,
    paths: [view.path],
    repos: [],
    home: '',
    primary: true,
    saved: false,
  }]
}

/**
 * Attach one library to a workspace, staging the derived primary when needed.
 *
 * An existing declared library gains the workspace path on its own entry (one
 * configuration entry per library, never a second row with the same name); a
 * library that exists under the namespace without being declared gains a
 * declaration of itself; an empty name is the "new library" case.
 */
export function attachEntry(
  rows: readonly EditorRow[],
  view: WorkspaceView,
  candidate: EntryCandidate,
): EditorRow[] {
  const base = stageAssumedPrimary(rows, view)
  const path = view.path
  // A candidate naming a library that has no row yet is still a declaration, not
  // a no-op: the picker only offers existing names, but dropping the choice
  // silently would be the worse failure mode.
  const known = candidate.name !== '' && !candidate.discovered
    && base.some(row => row.name.trim() === candidate.name)
  if (!known) {
    addedCounter += 1
    return [...base, {
      key: `entry-${String(addedCounter)}`,
      name: candidate.name,
      paths: path === '' ? [''] : [path],
      repos: [],
      home: '',
      primary: false,
      saved: false,
    }]
  }
  return base.map(row => {
    if (row.name.trim() !== candidate.name || path === '') return row
    if (row.paths.some(own => underPath(path, own, ''))) return { ...row, primary: false }
    return { ...row, paths: [...row.paths, path], primary: false }
  })
}

/** Turn the workspace's fallback grant on or off, on the entry that carries it. */
export function setFallback(rows: readonly EditorRow[], view: WorkspaceView, enabled: boolean): EditorRow[] {
  const base = stageAssumedPrimary(rows, view)
  const claimers = claimersOf(base, view.path, '').filter(row => row.name.trim() !== '')
  const owner = primaryOf(claimers)
  if (owner === undefined) return base
  return base.map(row => (row.key === owner.key ? { ...row, fallback: enabled } : row))
}

/** Move the primary flag to another entry of the same workspace. */
export function setPrimary(rows: readonly EditorRow[], view: WorkspaceView, key: string): EditorRow[] {
  const members = new Set(claimersOf(rows, view.path, '').map(row => row.key))
  return rows.map(row => {
    if (row.key === key) return { ...row, primary: true }
    if (members.has(row.key)) return { ...row, primary: false }
    return row
  })
}

/** Drop a library from a workspace by removing that workspace path from its entry. */
export function detachEntry(rows: readonly EditorRow[], view: WorkspaceView, key: string): EditorRow[] {
  return rows.map(row => (row.key === key && view.path !== ''
    ? { ...row, paths: row.paths.filter(path => expandPath(path, '') !== view.path) }
    : row))
}
