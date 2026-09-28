/**
 * The Host's workspace decisions, recomputed on the page's draft.
 *
 * The page cannot import the resolver (it is Node-only), so the rules that
 * decide a directory's route, memory switch, fallback decision and `personal`
 * reachability are mirrored here as pure functions. A table test keeps the two
 * in agreement (`test/settings-guard.test.ts`).
 *
 * Where the draft no longer determines a route — a workspace whose every path
 * claim was removed now falls through to remote or derived routing, which needs
 * git facts only the Host has — the answer is **conservative**: only the draft's
 * declarations close anything, and any binding that lists `personal` is assumed
 * to reach it. Over-reporting "on / reachable" can only make the guard add a
 * declaration or refuse; it can never let something open silently.
 *
 * @module dsh-memex/client/workspace-draft
 */
import type { MemexResolveResult } from '../contract.js'
import { expandPath, segmentCount, underPath } from './paths.js'
import type {
  Draft,
  EditorRow,
  MemexBinding,
  MemexWorkspaceDeclaration,
} from './settings-model.js'

export type { Draft } from './settings-model.js'

/** The read-only facts a recomputation needs besides the draft itself. */
export interface DraftContext {
  /** Bindings from the settings snapshot; the page never edits them. */
  readonly bindings: readonly MemexBinding[]
  /** The Host's home directory, for `~/…` paths. */
  readonly homeDir: string
}

/** A directory's decisions as the draft would make them. */
export interface DraftRoute {
  /** False when the draft no longer determines the route (see the module note). */
  readonly computable: boolean
  /** The current scope, when computable. */
  readonly scope?: string
  /** The deepest claimed prefix (expanded), when routed by path. */
  readonly prefix?: string
  /** The draft row carrying the route, when routed by path or by a declared entry. */
  readonly primaryKey?: string
  readonly memory: boolean
  readonly fallback: boolean
  readonly personal: { readonly read: boolean; readonly write: boolean }
  /** True when `personal` is the current scope or a sibling entry: reachable by claim, not by grant. */
  readonly personalEntry: boolean
  /**
   * The binding that adds reachability here: the current scope's binding when
   * computable, else the first binding listing `personal` (conservative).
   */
  readonly binding?: string
}

/** Declarations covering `cwd` by path segments, outermost first. */
export function coveringDeclarations(
  workspaces: readonly MemexWorkspaceDeclaration[],
  cwd: string,
  homeDir: string,
): MemexWorkspaceDeclaration[] {
  return workspaces
    .filter(declaration => declaration.path.trim() !== '' && underPath(cwd, declaration.path, homeDir))
    .sort((a, b) => segmentCount(expandPath(a.path, homeDir)) - segmentCount(expandPath(b.path, homeDir)))
}

/** The declaration written for exactly `path`, if any. */
export function declarationAt(
  workspaces: readonly MemexWorkspaceDeclaration[],
  path: string,
  homeDir: string,
): MemexWorkspaceDeclaration | undefined {
  const key = expandPath(path, homeDir)
  return workspaces.find(declaration => expandPath(declaration.path, homeDir) === key)
}

/** A draft path claim on `cwd`: the deepest prefix and every row claiming it. */
export interface PathClaim {
  readonly prefix: string
  readonly claimers: readonly EditorRow[]
}

/** The deepest draft path claim covering `cwd`, the resolver's first rule. */
export function pathClaimOf(rows: readonly EditorRow[], cwd: string, homeDir: string): PathClaim | undefined {
  let deepest = -1
  let prefix = ''
  const byDepth: Array<{ row: EditorRow; depth: number; prefix: string }> = []
  for (const row of rows) {
    if (row.name.trim() === '') continue
    for (const own of row.paths) {
      if (own.trim() === '' || !underPath(cwd, own, homeDir)) continue
      const expanded = expandPath(own, homeDir)
      const depth = segmentCount(expanded)
      byDepth.push({ row, depth, prefix: expanded })
      if (depth > deepest) { deepest = depth; prefix = expanded }
    }
  }
  if (deepest < 0) return undefined
  const claimers = [...new Map(byDepth.filter(item => item.depth === deepest).map(item => [item.row.name.trim(), item.row])).values()]
  return { prefix, claimers }
}

/**
 * The primary of a path claim, or undefined when the draft leaves it undecided.
 *
 * Same order as the resolver: the declaration at exactly this prefix, then a
 * lone claimer, then the one entry-level mark. An undecided group is a conflict
 * the page reports before saving.
 */
export function claimPrimary(claim: PathClaim, workspaces: readonly MemexWorkspaceDeclaration[], homeDir: string): EditorRow | undefined {
  const declared = declarationAt(workspaces, claim.prefix, homeDir)?.primary
  if (declared !== undefined) return claim.claimers.find(row => row.name.trim() === declared)
  if (claim.claimers.length === 1) return claim.claimers[0]
  const marked = claim.claimers.filter(row => row.primary === true)
  return marked.length === 1 ? marked[0] : undefined
}

/** The resolver's `accessOf`, reduced to `personal`. */
function personalReach(
  scope: string,
  entries: readonly string[],
  fallback: boolean,
  bindings: readonly MemexBinding[],
): { personal: DraftRoute['personal']; personalEntry: boolean; binding?: string } {
  const binding = bindings.find(item => item.read.includes(scope) || item.write.includes(scope))
  const named = binding === undefined ? {} : { binding: binding.name }
  if (scope === 'personal' || entries.includes('personal')) {
    return { personal: { read: true, write: true }, personalEntry: true, ...named }
  }
  return {
    personal: {
      read: fallback || binding?.read.includes('personal') === true,
      write: fallback || binding?.write.includes('personal') === true,
    },
    personalEntry: false,
    ...named,
  }
}

/**
 * Recompute one directory's decisions on the draft.
 * @param draft - the rows and declarations being edited.
 * @param context - bindings and home directory, both read-only.
 * @param cwd - the directory (usually a registered workspace's path).
 * @param before - the Host's current answer for `cwd`, which supplies the route
 *   kind the draft cannot know on its own (remote, derived, local).
 * @returns the draft's decisions, conservative where not computable.
 */
export function recompute(draft: Draft, context: DraftContext, cwd: string, before?: MemexResolveResult): DraftRoute {
  const { bindings, homeDir } = context
  const covering = coveringDeclarations(draft.workspaces, cwd, homeDir)
  const declaredMemoryOff = covering.some(declaration => declaration.memory === false)
  const declaredFallbackOff = covering.some(declaration => declaration.fallback === false)
  const byName = (name: string): EditorRow | undefined => draft.rows.find(row => row.name.trim() === name)

  const decided = (scope: string, entries: readonly string[], memoryRow: EditorRow | undefined, extra: Partial<DraftRoute>): DraftRoute => {
    const memory = !declaredMemoryOff && memoryRow?.memory !== false
    const fallback = !declaredFallbackOff && byName(scope)?.fallback !== false
    return { computable: true, scope, memory, fallback, ...personalReach(scope, entries, fallback, bindings), ...extra }
  }

  const claim = pathClaimOf(draft.rows, cwd, homeDir)
  if (claim !== undefined) {
    const primary = claimPrimary(claim, draft.workspaces, homeDir)
    if (primary !== undefined) {
      const scope = primary.name.trim()
      return decided(scope, claim.claimers.map(row => row.name.trim()), primary, { prefix: claim.prefix, primaryKey: primary.key })
    }
  } else if (before?.claim !== undefined && before.claim.kind !== 'path') {
    // (An answer without claim facts is from an older Host: not computable.)
    // No path claim before or after: the route is the Host's remote, derived or
    // local one, which page edits do not move. Only the entry fields can change.
    const own = byName(before.scope)
    if (before.claim.kind === 'remote' && own !== undefined && own.repos.length > 0) {
      // Sibling remote claimers are unknown here (patterns need the remote URL);
      // counting `personal` as one whenever it claims any repository errs on
      // the reachable side.
      const personalSibling = byName('personal')?.repos.some(pattern => pattern.trim() !== '') === true
      return decided(before.scope, personalSibling ? ['personal'] : [], own, { primaryKey: own.key })
    }
    if (before.source === 'derived') return decided(before.scope, [], undefined, {})
    if (before.source === 'local') return decided(before.scope, [], own, own === undefined ? {} : { primaryKey: own.key })
  }

  // Not computable: only declarations close, and any binding may add personal.
  const listing = bindings.find(binding => binding.read.includes('personal') || binding.write.includes('personal'))
  return {
    computable: false,
    memory: !declaredMemoryOff,
    fallback: !declaredFallbackOff,
    personal: {
      read: !declaredFallbackOff || bindings.some(binding => binding.read.includes('personal')),
      write: !declaredFallbackOff || bindings.some(binding => binding.write.includes('personal')),
    },
    personalEntry: false,
    ...(listing === undefined ? {} : { binding: listing.name }),
  }
}
