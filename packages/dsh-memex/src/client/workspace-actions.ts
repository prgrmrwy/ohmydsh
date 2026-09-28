/**
 * The page's workspace-level writes: close, open, and the universal guard.
 *
 * Every edit that changes claims or decisions ends in {@link guard}. It compares
 * each registered workspace's **current** decisions (the Host's route facts)
 * with the draft's, per item: memory, `personal` readable, `personal` writable.
 * A value that would go from off to on without the user having opened it gets a
 * path declaration that keeps it off; when a declaration cannot keep it off, or
 * would close a workspace that is on today, the edit is refused. So no page
 * action can silently open a workspace.
 *
 * @module dsh-memex/client/workspace-actions
 */
import type { MemexResolveResult } from '../contract.js'
import { expandPath, underPath } from './paths.js'
import type { Draft, EditorRow, MemexBinding, MemexWorkspaceDeclaration } from './settings-model.js'
import { coveringDeclarations, recompute, type DraftRoute } from './workspace-draft.js'

/** A workspace-level switch. */
export type SwitchKey = 'memory' | 'fallback'

/** One explicit decision the user made in this edit session. */
export interface Intent {
  /** `personal`: the user put `personal` on this workspace from its own block (attach, set primary, replace). */
  readonly kind: 'open' | 'close' | 'personal'
  readonly path: string
  readonly item: SwitchKey
}

/** The draft plus what the user explicitly decided while editing it. */
export interface Session {
  readonly draft: Draft
  readonly intents: readonly Intent[]
}

/** One registered workspace and the Host's current answer for it. */
export interface Registered {
  /** Absolute, expanded path. */
  readonly path: string
  /** Absent when the Host could not resolve it; such a workspace is not compared. */
  readonly route?: MemexResolveResult
}

/** The read-only facts every action needs. */
export interface Env {
  /** False when the Host has no registry: nothing can be compared, so claims are frozen. */
  readonly known: boolean
  readonly registry: readonly Registered[]
  readonly bindings: readonly MemexBinding[]
  readonly homeDir: string
  /** The draft as saved, to tell claim edits from other edits. */
  readonly saved: Draft
}

/** Something the notice line must say before saving. */
export type Note =
  | { readonly kind: 'preserved'; readonly path: string; readonly item: SwitchKey }
  | { readonly kind: 'alsoCloses'; readonly path: string; readonly item: SwitchKey }
  | { readonly kind: 'removedEntryField'; readonly scope: string; readonly item: SwitchKey }
  | { readonly kind: 'unregisteredReopen'; readonly scope: string; readonly item: SwitchKey }
  | { readonly kind: 'stagedPrimary'; readonly scope: string }
  | { readonly kind: 'declaredPrimary'; readonly path: string; readonly scope: string }
  | { readonly kind: 'inheritedAttach'; readonly path: string; readonly scope: string; readonly inherited: readonly string[] }
  | { readonly kind: 'replaced'; readonly path: string; readonly scope: string; readonly replaced: string; readonly splitFrom?: string }
  | { readonly kind: 'personalDespiteDeclaration'; readonly path: string }

/** Why an edit was not applied. */
export type Refusal =
  | { readonly kind: 'ancestor'; readonly path: string; readonly ancestor: string; readonly item: SwitchKey; readonly registered: boolean }
  | { readonly kind: 'remoteEntry'; readonly path: string; readonly scope: string; readonly item: SwitchKey }
  | { readonly kind: 'binding'; readonly path: string; readonly binding: string }
  | { readonly kind: 'personalEntry'; readonly path: string }
  | { readonly kind: 'wouldClose'; readonly path: string; readonly victim: string; readonly item: SwitchKey }
  | { readonly kind: 'stillClosed'; readonly path: string; readonly by: string; readonly item: SwitchKey }
  | { readonly kind: 'unregistered'; readonly path: string }
  | { readonly kind: 'degraded' }
  | { readonly kind: 'remoteClaimed'; readonly path: string }
  | { readonly kind: 'undecided'; readonly path: string }
  | { readonly kind: 'becomesPrimary'; readonly path: string; readonly scope: string; readonly cause: Refusal }

export type Outcome =
  | { readonly ok: true; readonly session: Session; readonly notes: readonly Note[] }
  | { readonly ok: false; readonly refusal: Refusal }

type Item = 'memory' | 'read' | 'write'
const ITEMS: readonly Item[] = ['memory', 'read', 'write']
const keyOf = (item: Item): SwitchKey => (item === 'memory' ? 'memory' : 'fallback')

function valueOf(route: Pick<DraftRoute, 'memory' | 'personal'>, item: Item): boolean {
  return item === 'memory' ? route.memory : route.personal[item]
}

function samePath(a: string, b: string, homeDir: string): boolean {
  return expandPath(a, homeDir) === expandPath(b, homeDir)
}

/** Set fields on the declaration at `path`, adding it when absent. */
export function withDeclaration(
  workspaces: readonly MemexWorkspaceDeclaration[],
  path: string,
  patch: { readonly memory?: false; readonly fallback?: false; readonly primary?: string },
  homeDir: string,
): MemexWorkspaceDeclaration[] {
  const index = workspaces.findIndex(declaration => samePath(declaration.path, path, homeDir))
  if (index < 0) return [...workspaces, { path, ...patch }]
  return workspaces.map((declaration, at) => (at === index ? { ...declaration, ...patch } : declaration))
}

/** Remove one field from the declaration at `path`; a declaration left empty is dropped. */
export function withoutDeclarationField(
  workspaces: readonly MemexWorkspaceDeclaration[],
  path: string,
  key: 'memory' | 'fallback' | 'primary',
  homeDir: string,
): MemexWorkspaceDeclaration[] {
  return workspaces.flatMap(declaration => {
    if (!samePath(declaration.path, path, homeDir) || declaration[key] === undefined) return [declaration]
    const { [key]: _removed, ...rest } = declaration
    return Object.keys(rest).length === 1 ? [] : [rest]
  })
}

/** A row without one of its switch fields. */
export function withoutEntryField(row: EditorRow, key: SwitchKey): EditorRow {
  const { [key]: _removed, ...rest } = row
  return rest
}

function intentsWith(intents: readonly Intent[], intent: Intent, homeDir: string): Intent[] {
  return [
    ...intents.filter(item => !(item.item === intent.item && samePath(item.path, intent.path, homeDir))),
    intent,
  ]
}

/**
 * Keep every registered workspace's off items off, unless the user opened them.
 * @param session - the draft after an edit, with the session's intents.
 * @param env - registry, bindings and home directory.
 * @returns the draft with any preserving declarations added, or the refusal.
 */
export function guard(session: Session, env: Env): Outcome {
  const { registry, homeDir } = env
  if (!env.known && claimsChanged(env.saved, session.draft, homeDir)) return { ok: false, refusal: { kind: 'degraded' } }
  const context = { bindings: env.bindings, homeDir }
  const opened = (path: string, key: SwitchKey): boolean =>
    session.intents.some(intent => (intent.kind === 'open' || intent.kind === 'personal')
      && intent.item === key && samePath(intent.path, path, homeDir))
  const at = (draft: Draft, workspace: Registered): DraftRoute => recompute(draft, context, workspace.path, workspace.route)
  const compared = registry.filter((workspace): workspace is Registered & { route: MemexResolveResult } => workspace.route !== undefined)

  let draft = session.draft
  const notes: Note[] = []
  // Each pass adds at least one declaration or stops; a declaration per
  // workspace and switch bounds the passes.
  for (let pass = 0; pass <= compared.length * 2; pass += 1) {
    let added = false
    for (const workspace of compared) {
      const after = at(draft, workspace)
      for (const item of ITEMS) {
        const key = keyOf(item)
        if (valueOf(workspace.route, item) || !valueOf(after, item) || opened(workspace.path, key)) continue
        const next: Draft = { ...draft, workspaces: withDeclaration(draft.workspaces, workspace.path, { [key]: false }, homeDir) }
        const kept = at(next, workspace)
        if (valueOf(kept, item)) {
          // Only a claim or a binding still reaches `personal`; a declaration
          // cannot take that back, and letting it open is not an option.
          return kept.personalEntry
            ? { ok: false, refusal: { kind: 'personalEntry', path: workspace.path } }
            : { ok: false, refusal: { kind: 'binding', path: workspace.path, binding: kept.binding ?? '' } }
        }
        for (const other of compared) {
          if (other === workspace || !underPath(other.path, workspace.path, homeDir)) continue
          const was = at(draft, other)
          const now = at(next, other)
          for (const otherItem of ITEMS) {
            if (keyOf(otherItem) !== key) continue
            if (valueOf(other.route, otherItem) && valueOf(was, otherItem) && !valueOf(now, otherItem)) {
              return { ok: false, refusal: { kind: 'wouldClose', path: workspace.path, victim: other.path, item: key } }
            }
          }
        }
        draft = next
        notes.push({ kind: 'preserved', path: workspace.path, item: key })
        added = true
        break
      }
      if (added) break
    }
    if (!added) break
  }

  const closed = (path: string, key: SwitchKey): boolean =>
    session.intents.some(intent => intent.kind === 'close' && intent.item === key && samePath(intent.path, path, homeDir))
  for (const workspace of compared) {
    const after = at(draft, workspace)
    for (const key of ['memory', 'fallback'] as const) {
      const before = key === 'memory' ? workspace.route.memory : workspace.route.personal.read || workspace.route.personal.write
      const now = key === 'memory' ? after.memory : after.personal.read || after.personal.write
      if (before && !now && !closed(workspace.path, key)) notes.push({ kind: 'alsoCloses', path: workspace.path, item: key })
    }
  }
  for (const intent of session.intents) {
    if (intent.kind !== 'personal') continue
    const workspace = compared.find(item => samePath(item.path, intent.path, homeDir))
    const route = workspace === undefined ? undefined : at(draft, workspace)
    if (route?.personalEntry === true && coveringDeclarations(draft.workspaces, intent.path, homeDir).some(item => item.fallback === false)) {
      notes.push({ kind: 'personalDespiteDeclaration', path: intent.path })
    }
  }
  return { ok: true, session: { ...session, draft }, notes }
}

/** What decides routing in a draft: each library's claims and primary marks, and declared primaries. */
function claimsOf(draft: Draft, homeDir: string): string {
  const rows = draft.rows
    .map(row => ({
      name: row.name.trim(),
      paths: row.paths.map(path => expandPath(path.trim(), homeDir)).filter(path => path !== '').sort(),
      repos: row.repos.map(pattern => pattern.trim()).filter(pattern => pattern !== '').sort(),
      primary: row.primary === true,
    }))
    // A library that claims nothing routes nothing: declaring one is not a claim change.
    .filter(row => row.paths.length > 0 || row.repos.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  const primaries = draft.workspaces
    .filter(declaration => declaration.primary !== undefined)
    .map(declaration => [expandPath(declaration.path, homeDir), declaration.primary])
    .sort()
  return JSON.stringify({ rows, primaries })
}

/** True when the draft changes any claim or primary compared with the saved configuration. */
export function claimsChanged(saved: Draft, draft: Draft, homeDir: string): boolean {
  return claimsOf(saved, homeDir) !== claimsOf(draft, homeDir)
}

/**
 * Close memory or the fallback for one registered workspace.
 *
 * Only a declaration on its path is written: the claims, the entries and the
 * derived route are untouched. The declaration covers the directories under it,
 * so any registered workspace there that closes too is listed.
 */
export function closeSwitch(session: Session, env: Env, path: string, key: SwitchKey): Outcome {
  if (!env.registry.some(workspace => samePath(workspace.path, path, env.homeDir))) {
    return { ok: false, refusal: { kind: 'unregistered', path } }
  }
  const draft: Draft = { ...session.draft, workspaces: withDeclaration(session.draft.workspaces, path, { [key]: false }, env.homeDir) }
  return guard({ draft, intents: intentsWith(session.intents, { kind: 'close', path, item: key }, env.homeDir) }, env)
}

/**
 * Open memory or the fallback for one registered workspace.
 *
 * Removes what closes it on the draft — its own declaration's field, and the
 * primary entry's field — and refuses what cannot be removed for it alone: an
 * ancestor's declaration, or a field on an entry that also claims by remote.
 * The guard then keeps every other registered workspace as it was, and the
 * result is accepted only if this workspace actually opened.
 */
export function openSwitch(session: Session, env: Env, path: string, key: SwitchKey): Outcome {
  const { homeDir } = env
  const workspace = env.registry.find(item => samePath(item.path, path, homeDir))
  if (workspace === undefined) return { ok: false, refusal: { kind: 'unregistered', path } }
  const context = { bindings: env.bindings, homeDir }
  const draft = session.draft

  const ancestor = coveringDeclarations(draft.workspaces, path, homeDir)
    .find(declaration => declaration[key] === false && !samePath(declaration.path, path, homeDir))
  if (ancestor !== undefined) {
    const registered = env.registry.some(item => samePath(item.path, ancestor.path, homeDir))
    return { ok: false, refusal: { kind: 'ancestor', path, ancestor: ancestor.path, item: key, registered } }
  }

  const notes: Note[] = []
  let rows = draft.rows
  const route = recompute(draft, context, path, workspace.route)
  const carrier = route.primaryKey === undefined ? undefined : rows.find(row => row.key === route.primaryKey)
  if (carrier !== undefined && carrier[key] === false) {
    if (carrier.repos.some(pattern => pattern.trim() !== '')) {
      return { ok: false, refusal: { kind: 'remoteEntry', path, scope: carrier.name.trim(), item: key } }
    }
    rows = rows.map(row => (row.key === carrier.key ? withoutEntryField(row, key) : row))
    notes.push({ kind: 'removedEntryField', scope: carrier.name.trim(), item: key })
    notes.push({ kind: 'unregisteredReopen', scope: carrier.name.trim(), item: key })
  }
  const next: Session = {
    draft: { rows, workspaces: withoutDeclarationField(draft.workspaces, path, key, homeDir) },
    intents: intentsWith(session.intents, { kind: 'open', path, item: key }, homeDir),
  }
  const guarded = guard(next, env)
  if (!guarded.ok) return guarded
  const result = recompute(guarded.session.draft, context, path, workspace.route)
  if (!(key === 'memory' ? result.memory : result.fallback)) {
    const by = coveringDeclarations(guarded.session.draft.workspaces, path, homeDir).find(declaration => declaration[key] === false)
    return { ok: false, refusal: { kind: 'stillClosed', path, by: by?.path ?? '', item: key } }
  }
  return { ok: true, session: guarded.session, notes: [...notes, ...guarded.notes] }
}

/**
 * Mark that the user put `personal` on this workspace from its own block.
 *
 * That makes `personal` reachable there as an entry, which no declaration can
 * close; it is the user's explicit decision for this workspace only. Every other
 * workspace where `personal` becomes an entry is still refused by the guard.
 */
export function withPersonalIntent(session: Session, path: string, homeDir: string): Session {
  return { ...session, intents: intentsWith(session.intents, { kind: 'personal', path, item: 'fallback' }, homeDir) }
}
