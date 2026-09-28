/**
 * The page's claim edits on a registered workspace: attach, detach, switch primary.
 *
 * Each edit changes only claims and the path declaration's `primary`, then goes
 * through {@link guard}, so none of them can open a closed workspace. The
 * primary of a workspace with two or more exact claimers is always written as
 * `workspaces[P].primary`, never as an entry-level mark: a mark on a library
 * decides every path it claims, which is how switching in one workspace used to
 * change another.
 *
 * @module dsh-memex/client/workspace-edits
 */
import { expandPath } from './paths.js'
import type { Draft, EditorRow, EntryCandidate } from './settings-model.js'
import { guard, withDeclaration, withoutDeclarationField, withPersonalIntent, type Env, type Note, type Outcome, type Registered, type Session } from './workspace-actions.js'
import { claimPrimary, declarationAt, pathClaimOf, type PathClaim } from './workspace-draft.js'

let stagedCounter = 0

/** How a registered workspace is routed on the current draft. */
type Situation =
  | { readonly kind: 'exact'; readonly claim: PathClaim; readonly primary?: EditorRow }
  | { readonly kind: 'inherited'; readonly claim: PathClaim; readonly primary?: EditorRow }
  | { readonly kind: 'derived'; readonly scope: string }
  | { readonly kind: 'remote' }
  | { readonly kind: 'unknown' }

function situationOf(draft: Draft, workspace: Registered, homeDir: string): Situation {
  const claim = pathClaimOf(draft.rows, workspace.path, homeDir)
  if (claim !== undefined) {
    const primary = claimPrimary(claim, draft.workspaces, homeDir)
    const kind = claim.prefix === expandPath(workspace.path, homeDir) ? 'exact' : 'inherited'
    return primary === undefined ? { kind, claim } : { kind, claim, primary }
  }
  const route = workspace.route
  if (route?.claim?.kind === 'remote') return { kind: 'remote' }
  if (route !== undefined && route.claim?.kind === 'none') return { kind: 'derived', scope: route.scope }
  return { kind: 'unknown' }
}

/** Give library `name` an exact claim on `path`, declaring it when it has no entry. */
function claimExactly(rows: readonly EditorRow[], name: string, path: string, homeDir: string): EditorRow[] {
  const target = expandPath(path, homeDir)
  if (name !== '' && rows.some(row => row.name.trim() === name)) {
    return rows.map(row => (row.name.trim() !== name || row.paths.some(own => expandPath(own.trim(), homeDir) === target)
      ? row
      : { ...row, paths: [...row.paths, path] }))
  }
  stagedCounter += 1
  return [...rows, { key: `staged-${String(stagedCounter)}`, name, paths: [path], repos: [], home: '', saved: false }]
}

/** Drop the exact claim of row `key` on `path`; its other claims are untouched. */
function unclaim(rows: readonly EditorRow[], key: string, path: string, homeDir: string): EditorRow[] {
  const target = expandPath(path, homeDir)
  return rows.map(row => (row.key === key ? { ...row, paths: row.paths.filter(own => expandPath(own.trim(), homeDir) !== target) } : row))
}

/** Exact claimers of `path` on the rows. */
function exactClaimers(rows: readonly EditorRow[], path: string, homeDir: string): EditorRow[] {
  const claim = pathClaimOf(rows, path, homeDir)
  return claim !== undefined && claim.prefix === expandPath(path, homeDir) ? [...claim.claimers] : []
}

/**
 * Write the workspace's primary where the rule needs one: on the declaration
 * when it has two or more exact claimers, nowhere when it has fewer.
 */
function settlePrimary(draft: Draft, path: string, primary: string | undefined, homeDir: string): Draft {
  const claimers = exactClaimers(draft.rows, path, homeDir).map(row => row.name.trim())
  if (claimers.length < 2) return { ...draft, workspaces: withoutDeclarationField(draft.workspaces, path, 'primary', homeDir) }
  if (primary !== undefined && claimers.includes(primary)) {
    return { ...draft, workspaces: withDeclaration(draft.workspaces, path, { primary }, homeDir) }
  }
  // The named primary no longer claims here: the declaration would be stale.
  const declared = declarationAt(draft.workspaces, path, homeDir)?.primary
  return declared !== undefined && !claimers.includes(declared)
    ? { ...draft, workspaces: withoutDeclarationField(draft.workspaces, path, 'primary', homeDir) }
    : draft
}

function registered(env: Env, path: string): Registered | undefined {
  const target = expandPath(path, env.homeDir)
  return env.registry.find(item => expandPath(item.path, env.homeDir) === target)
}

function finish(session: Session, env: Env, draft: Draft, notes: readonly Note[], personalAt?: string): Outcome {
  const next: Session = personalAt === undefined
    ? { ...session, draft }
    : withPersonalIntent({ ...session, draft }, personalAt, env.homeDir)
  const guarded = guard(next, env)
  return guarded.ok ? { ...guarded, notes: [...notes, ...guarded.notes] } : guarded
}

/**
 * Attach a library to a registered workspace.
 *
 * - Exact claims already: the library joins them, and the existing primary is
 *   written as the workspace's declared primary.
 * - Inherited from an ancestor: the library becomes the workspace's only exact
 *   claimer, so its primary; the inherited libraries leave this block.
 * - Derived: the derived library is staged as an exact claimer and declared
 *   primary, so the new claim does not take the route.
 */
export function attachTo(session: Session, env: Env, path: string, candidate: EntryCandidate): Outcome {
  const { homeDir } = env
  const workspace = registered(env, path)
  if (workspace === undefined) return { ok: false, refusal: { kind: 'unregistered', path } }
  const draft = session.draft
  const situation = situationOf(draft, workspace, homeDir)
  if (situation.kind === 'remote') return { ok: false, refusal: { kind: 'remoteClaimed', path } }
  if (situation.kind === 'unknown') return { ok: false, refusal: { kind: 'undecided', path } }

  const notes: Note[] = []
  let rows = draft.rows
  let primary: string | undefined
  if (situation.kind === 'derived') {
    rows = claimExactly(rows, situation.scope, path, homeDir)
    primary = situation.scope
    notes.push({ kind: 'stagedPrimary', scope: situation.scope })
  } else if (situation.kind === 'exact') {
    primary = situation.primary?.name.trim()
  }
  rows = claimExactly(rows, candidate.name, path, homeDir)
  if (situation.kind === 'inherited') {
    notes.push({ kind: 'inheritedAttach', path, scope: candidate.name, inherited: situation.claim.claimers.map(row => row.name.trim()) })
  }
  const hadDeclared = declarationAt(draft.workspaces, path, homeDir)?.primary
  const settled = settlePrimary({ ...draft, rows }, path, primary, homeDir)
  const nowDeclared = declarationAt(settled.workspaces, path, homeDir)?.primary
  if (situation.kind === 'exact' && nowDeclared !== undefined && nowDeclared !== hadDeclared) {
    notes.push({ kind: 'declaredPrimary', path, scope: nowDeclared })
  }
  const outcome = finish(session, env, settled, notes, candidate.name === 'personal' ? path : undefined)
  if (!outcome.ok && situation.kind === 'inherited') {
    return { ok: false, refusal: { kind: 'becomesPrimary', path, scope: candidate.name, cause: outcome.refusal } }
  }
  return outcome
}

/** Remove one library's exact claim on a registered workspace. */
export function detachFrom(session: Session, env: Env, path: string, key: string): Outcome {
  const { homeDir } = env
  if (registered(env, path) === undefined) return { ok: false, refusal: { kind: 'unregistered', path } }
  const rows = unclaim(session.draft.rows, key, path, homeDir)
  const declared = declarationAt(session.draft.workspaces, path, homeDir)?.primary
  return finish(session, env, settlePrimary({ ...session.draft, rows }, path, declared, homeDir), [])
}

/**
 * Replace a registered workspace's primary with another library.
 *
 * Only claims and the declared primary change (design D3): the old primary
 * stops claiming the workspace — split out of an ancestor prefix when inherited,
 * with the other inherited claimers claiming it exactly — and the new one claims
 * it exactly. The guard keeps both switches' effective values.
 */
export function switchPrimary(session: Session, env: Env, path: string, candidate: EntryCandidate): Outcome {
  const { homeDir } = env
  const workspace = registered(env, path)
  if (workspace === undefined) return { ok: false, refusal: { kind: 'unregistered', path } }
  const draft = session.draft
  const situation = situationOf(draft, workspace, homeDir)
  if (situation.kind === 'remote') return { ok: false, refusal: { kind: 'remoteClaimed', path } }
  if (situation.kind === 'unknown') return { ok: false, refusal: { kind: 'undecided', path } }

  let rows = draft.rows
  let replaced: string
  let splitFrom: string | undefined
  if (situation.kind === 'derived') {
    replaced = situation.scope
  } else {
    const old = situation.primary
    if (old === undefined) return { ok: false, refusal: { kind: 'undecided', path } }
    replaced = old.name.trim()
    if (situation.kind === 'exact') {
      rows = unclaim(rows, old.key, path, homeDir)
    } else {
      splitFrom = situation.claim.prefix
      for (const sibling of situation.claim.claimers) {
        if (sibling.key !== old.key) rows = claimExactly(rows, sibling.name.trim(), path, homeDir)
      }
    }
  }
  if (replaced === candidate.name) return { ok: true, session, notes: [] }
  rows = claimExactly(rows, candidate.name, path, homeDir)
  const settled = settlePrimary({ ...draft, rows }, path, candidate.name, homeDir)
  const note: Note = splitFrom === undefined
    ? { kind: 'replaced', path, scope: candidate.name, replaced }
    : { kind: 'replaced', path, scope: candidate.name, replaced, splitFrom }
  return finish(session, env, settled, [note], candidate.name === 'personal' ? path : undefined)
}
