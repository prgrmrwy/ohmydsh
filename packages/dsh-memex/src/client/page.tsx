/**
 * The Memory settings page.
 *
 * The page's subject is a **workspace**, because that is the unit a human thinks
 * in and the unit DSH itself registers: each block lists the memory entries a
 * session in that directory can use. Configuration is edited here through the
 * official settings scope; library facts are read from the host channel and
 * never guessed. Publication direction is deliberately absent: it is the write
 * guard's input, so relaxing it stays a hand edit.
 *
 * Two rules shape the row rendering. An entry in a list shows only what makes
 * entries comparable — role, name, card count — and expands into its facts on
 * demand; and nothing that changes routing is written without saying so, which
 * is why every note an edit produces is listed before saving.
 *
 * Workspace-level edits (switches, attach, detach, switch primary) run through
 * `workspace-actions` / `workspace-edits`, which end in the universal guard: no
 * page action can silently open a closed workspace. Save runs the guard once
 * more, so an entry edit made by typing is held to the same rule.
 *
 * @module dsh-memex/client/page
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  MEMEX_CHANNEL,
  MEMEX_REMOTE_ENDPOINT,
  MEMEX_RESOLVE_ENDPOINT,
  MEMEX_STORES_ENDPOINT,
  MEMEX_WORKSPACES_ENDPOINT,
  type MemexRemoteAction,
  type MemexRemoteResult,
  type MemexResolveResult,
  type MemexStoresResult,
  type MemexStoreView,
  type MemexWorkspacesResult,
} from '../contract.js'
import { openBrowseTab, type BrowseOpenDeps } from './browse-open.js'
import type { MemexKey } from './locales.js'
import { expandPath } from './paths.js'
import {
  addPathToGroup,
  attachEntry,
  conflicts,
  defaultHome,
  detachEntry,
  removePathFromGroup,
  rowsFromSettings,
  setPathInGroup,
  setPrimary,
  stageAssumedPrimary,
  storesByName,
  toScopes,
  undeclaredStores,
  workspaceViews,
  type Draft,
  type EditorRow,
  type EntryCandidate,
  type MemexSettingsShape,
  type WorkspaceEntryRow,
  type WorkspaceView,
} from './settings-model.js'
import { closeSwitch, guard, openSwitch, type Env, type Note, type Outcome, type Refusal, type Session, type SwitchKey } from './workspace-actions.js'
import { attachTo, detachFrom, switchPrimary } from './workspace-edits.js'

/** The injected service face for the section slot (spread flat by the renderer). */
export interface MemexSectionInjected {
  /** Connection RPC caller for the `/dsh-memex` channel. */
  rpc: ClientConnectionRpc
  /** Section copy under the plugin's locale namespace. */
  t: (key: MemexKey) => string
  /** The `dsh-memex` entry's live Config form (DSH 0.2.0 `configForms`). */
  scope: ConfigForm<MemexSettingsShape>
  /**
   * Opens a library's card browser.
   *
   * Injected rather than built here because resolving the address may need a
   * registrant that only exists inside the cockpit iframe — this page is in
   * that iframe, a new tab is not, so the work must stay on this side.
   */
  browseOpen: BrowseOpenDeps
}

/** Props delivered to the section component (the inject face, flat). */
export type MemexSectionProps = Partial<MemexSectionInjected>

interface Notice {
  readonly kind: 'ok' | 'error'
  readonly text: string
}

/** The open picker: attaching an entry, or replacing the primary. */
interface Picker {
  readonly key: string
  readonly mode: 'attach' | 'replace'
}

/**
 * Rename a library in the draft, and every declared primary naming it.
 *
 * A declared primary is a name: renaming the library without it would leave a
 * declaration naming something that no longer claims the path.
 */
function renamed(draft: Draft, key: string, name: string): Draft {
  const before = draft.rows.find(row => row.key === key)?.name.trim()
  return {
    rows: draft.rows.map(row => (row.key === key ? { ...row, name } : row)),
    workspaces: before === undefined ? draft.workspaces : draft.workspaces.map(declaration => (declaration.primary === before && before !== name.trim()
      ? { ...declaration, primary: name.trim() }
      : declaration)),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The Memory settings page.
 *
 * The inject face may be absent on the first render (slot mount before inject),
 * so the public component guards and the body runs with every part present.
 * @param props - the inject face.
 * @returns the page, or null while the face is absent.
 */
export function MemexSettingsSection(props: MemexSectionProps): JSX.Element | null {
  const { rpc, t, scope, browseOpen } = props
  if (rpc === undefined || t === undefined || scope === undefined || browseOpen === undefined) return null
  return <MemexSettingsPage rpc={rpc} t={t} scope={scope} browseOpen={browseOpen} />
}

/** The page body, with every injected part guaranteed present. */
function MemexSettingsPage(props: Required<MemexSectionInjected>): JSX.Element {
  const { rpc, t, scope, browseOpen } = props
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot())
  // The draft and the decisions the user made while editing it; undefined is
  // "nothing edited". Notes are what the edits so far must say before saving.
  const [session, setSession] = useState<Session | undefined>(undefined)
  const [notes, setNotes] = useState<readonly Note[]>([])
  const [stores, setStores] = useState<MemexStoresResult | undefined>(undefined)
  const [storesError, setStoresError] = useState<string | undefined>(undefined)
  const [workspaces, setWorkspaces] = useState<MemexWorkspacesResult | undefined>(undefined)
  const [workspacesFailed, setWorkspacesFailed] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [confirming, setConfirming] = useState<string | undefined>(undefined)
  const [urlDraft, setUrlDraft] = useState('')
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const [probePath, setProbePath] = useState('')
  const [probeResult, setProbeResult] = useState<MemexResolveResult | undefined>(undefined)
  const [probeError, setProbeError] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState<readonly string[]>([])
  // View state only: memory-off workspaces are collapsed by default, and
  // collapsing them never touches the configuration.
  const [showHidden, setShowHidden] = useState(false)
  const [picker, setPicker] = useState<Picker | undefined>(undefined)

  useEffect(() => {
    setSnapshot(scope.getSnapshot())
    return scope.subscribe(() => setSnapshot(scope.getSnapshot()))
  }, [scope])

  const loadStores = useCallback(async (): Promise<void> => {
    try {
      const result = (await rpc.call(MEMEX_CHANNEL, MEMEX_STORES_ENDPOINT, {})) as { ok?: boolean; value?: MemexStoresResult; error?: { message?: string } }
      if (result.ok !== true || result.value === undefined) {
        setStores(undefined)
        setStoresError(result.error?.message ?? 'stores failed')
        return
      }
      setStores(result.value)
      setStoresError(undefined)
    } catch (error) {
      setStores(undefined)
      setStoresError(messageOf(error))
    }
  }, [rpc])

  /**
   * Load the workspace registry.
   *
   * A failure here is not the same as an empty registry: the page keeps its
   * configuration-only blocks and says so, rather than claiming the user has no
   * workspaces.
   */
  const loadWorkspaces = useCallback(async (): Promise<void> => {
    try {
      const result = (await rpc.call(MEMEX_CHANNEL, MEMEX_WORKSPACES_ENDPOINT, {})) as { ok?: boolean; value?: MemexWorkspacesResult }
      setWorkspaces(result.ok === true ? result.value : undefined)
      // An older host answers "unknown endpoint": that is a degradation to state,
      // not a silent absence of workspaces.
      setWorkspacesFailed(result.ok !== true)
    } catch {
      setWorkspaces(undefined)
      setWorkspacesFailed(true)
    }
  }, [rpc])

  useEffect(() => { void loadStores(); void loadWorkspaces() }, [loadStores, loadWorkspaces])

  const savedRows = useMemo(() => rowsFromSettings(snapshot?.value), [snapshot])
  const savedDraft = useMemo<Draft>(() => ({ rows: savedRows, workspaces: [...(snapshot?.value?.workspaces ?? [])] }), [savedRows, snapshot])
  const bindings = useMemo(() => snapshot?.value?.bindings ?? [], [snapshot])
  const current: Session = session ?? { draft: savedDraft, intents: [] }
  const draft = current.draft
  const rows = draft.rows
  const homeDir = workspaces?.homeDir ?? ''
  // The facts every workspace action is checked against: the Host's current
  // answer for each registered workspace, and the configuration as saved.
  const env = useMemo<Env>(() => ({
    known: workspaces?.known === true,
    registry: workspaces?.known === true
      ? workspaces.items.map(item => ({ path: expandPath(item.path, workspaces.homeDir), ...(item.route === undefined ? {} : { route: item.route }) }))
      : [],
    bindings,
    homeDir: workspaces?.homeDir ?? '',
    saved: savedDraft,
  }), [workspaces, bindings, savedDraft])
  const byName = useMemo(() => storesByName(stores?.stores), [stores])
  // Absolute only when the host answered: a guessed "~/.dsh-memex/<name>" is a
  // placeholder, never something offered as the library path.
  const namespaceDir = stores?.namespaceDir
  const problems = useMemo(
    () => conflicts(rows, namespaceDir ?? '~/.dsh-memex', {
      name: t('conflictName'),
      home: t('conflictHome'),
      pattern: t('conflictPattern'),
      primary: t('conflictPrimary'),
      declared: t('conflictDeclared'),
    }, draft.workspaces, homeDir),
    [rows, draft.workspaces, homeDir, namespaceDir, t],
  )
  // Workspaces are the page's subject; the host registry is the skeleton and the
  // configured paths fill in whatever it does not cover.
  const views = useMemo(
    () => workspaceViews(rows, workspaces, stores?.stores, { workspaces: draft.workspaces, bindings }),
    [rows, draft.workspaces, bindings, workspaces, stores],
  )
  // Libraries a workspace already presents are declared from that block, which
  // also records the workspace; only the unaccounted for stay in their own list.
  const accounted = useMemo(
    () => views.flatMap(view => view.entries.filter(entry => entry.kind !== 'fallback').map(entry => entry.name)),
    [views],
  )
  const undeclared = useMemo(() => undeclaredStores(stores?.stores, rows, accounted), [stores, rows, accounted])
  // Memory off means the workspace has left daily view — it stays reachable,
  // because the switch that turns it back on lives in its block. Only registered
  // workspaces fold: a configuration block has no switch to reopen it with.
  const active = useMemo(() => views.filter(view => view.memory || !view.fromRegistry), [views])
  const hidden = useMemo(() => views.filter(view => !view.memory && view.fromRegistry), [views])

  /** Fill a copy string's `{name}` placeholders. */
  const fill = useCallback((key: MemexKey, values: Record<string, string>): string =>
    t(key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? ''), [t])
  const itemOf = useCallback((item: SwitchKey): string => t(item === 'memory' ? 'itemMemory' : 'itemFallback'), [t])

  const noteText = useCallback((note: Note): string => {
    switch (note.kind) {
      case 'preserved': return fill('notePreserved', { path: note.path, item: itemOf(note.item) })
      case 'alsoCloses': return fill('noteAlsoCloses', { path: note.path, item: itemOf(note.item) })
      case 'removedEntryField': return fill('noteRemovedEntryField', { scope: note.scope, item: itemOf(note.item) })
      case 'unregisteredReopen': return fill('noteUnregisteredReopen', { scope: note.scope, item: itemOf(note.item) })
      case 'stagedPrimary': return fill('noteStagedPrimary', { scope: note.scope })
      case 'declaredPrimary': return fill('noteDeclaredPrimary', { path: note.path, scope: note.scope })
      case 'inheritedAttach': return fill('noteInheritedAttach', { path: note.path, scope: note.scope, list: note.inherited.join(', ') })
      case 'replaced': return note.splitFrom === undefined
        ? fill('noteReplaced', { path: note.path, scope: note.scope, replaced: note.replaced })
        : fill('noteReplacedSplit', { path: note.path, scope: note.scope, replaced: note.replaced, split: note.splitFrom })
      case 'personalDespiteDeclaration': return fill('notePersonalDespiteDeclaration', { path: note.path })
    }
  }, [fill, itemOf])

  const refusalText = useCallback((refusal: Refusal): string => {
    switch (refusal.kind) {
      case 'ancestor': return fill(refusal.registered ? 'refuseAncestor' : 'refuseAncestorConfig', { path: refusal.path, ancestor: refusal.ancestor, item: itemOf(refusal.item) })
      case 'remoteEntry': return fill('refuseRemoteEntry', { path: refusal.path, scope: refusal.scope, item: itemOf(refusal.item) })
      case 'binding': return fill('refuseBinding', { path: refusal.path, binding: refusal.binding })
      case 'personalEntry': return fill('refusePersonalEntry', { path: refusal.path })
      case 'wouldClose': return fill('refuseWouldClose', { path: refusal.path, victim: refusal.victim, item: itemOf(refusal.item) })
      case 'stillClosed': return fill('refuseStillClosed', { path: refusal.path, ancestor: refusal.by, item: itemOf(refusal.item) })
      case 'unregistered': return fill('refuseUnregistered', { path: refusal.path })
      case 'degraded': return t('refuseDegraded')
      case 'remoteClaimed': return fill('refuseRemoteClaimed', { path: refusal.path })
      case 'undecided': return fill('refuseUndecided', { path: refusal.path })
      case 'becomesPrimary': return `${fill('attachBecomesPrimary', { path: refusal.path, scope: refusal.scope })} ${refusalText(refusal.cause)}`
    }
  }, [fill, itemOf, t])

  /** Run one workspace action: apply it with its notes, or say why not. */
  const run = useCallback((action: (base: Session, facts: Env) => Outcome): void => {
    const outcome = action(current, env)
    if (!outcome.ok) {
      setNotice({ kind: 'error', text: refusalText(outcome.refusal) })
      return
    }
    setSession(outcome.session)
    setNotes(existing => [...existing, ...outcome.notes])
    setNotice(undefined)
  }, [current, env, refusalText])

  /**
   * An entry edit that is not a workspace action (typing a name or a path, a
   * configuration block's own actions): applied as typed, guarded at save.
   */
  const editRows = useCallback((change: (base: readonly EditorRow[]) => readonly EditorRow[]): void => {
    setSession(existing => {
      const base = existing ?? { draft: savedDraft, intents: [] }
      return { ...base, draft: { ...base.draft, rows: [...change(base.draft.rows)] } }
    })
  }, [savedDraft])

  const edit = useCallback((key: string, change: (row: EditorRow) => EditorRow) => {
    editRows(base => base.map(row => (row.key === key ? change(row) : row)))
  }, [editRows])

  const rename = useCallback((key: string, name: string) => {
    setSession(existing => {
      const base = existing ?? { draft: savedDraft, intents: [] }
      return { ...base, draft: renamed(base.draft, key, name) }
    })
  }, [savedDraft])

  const toggle = useCallback((view: WorkspaceView, key: SwitchKey, on: boolean): void => {
    run((base, facts) => (on ? openSwitch : closeSwitch)(base, facts, view.path, key))
  }, [run])

  const copy = useCallback(async (value: string, token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(token)
    } catch {
      // Clipboard access can be denied (insecure context, permissions); the
      // value stays visible and selectable, so this degrades silently.
    }
  }, [])

  const runRemote = useCallback(async (scopeName: string, action: MemexRemoteAction, url?: string): Promise<void> => {
    const token = `${scopeName}:${action}`
    setBusy(token)
    setNotice(undefined)
    try {
      const response = (await rpc.call(MEMEX_CHANNEL, MEMEX_REMOTE_ENDPOINT, {
        scope: scopeName,
        action,
        ...(url !== undefined && url !== '' ? { url } : {}),
      })) as { ok?: boolean; value?: MemexRemoteResult; error?: { message?: string } }
      if (response.ok !== true || response.value === undefined) {
        setNotice({ kind: 'error', text: response.error?.message ?? t('remoteUnknown') })
        return
      }
      const outcome = response.value
      setNotice(outcome.status === 'ok'
        ? { kind: 'ok', text: outcome.output ?? t('saved') }
        : { kind: 'error', text: outcome.message ?? t('remoteUnknown') })
      if (outcome.status === 'ok') {
        setConfirming(undefined)
        setUrlDraft('')
      }
      await loadStores()
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) })
    } finally {
      setBusy(undefined)
    }
  }, [rpc, t, loadStores])

  const save = useCallback(async (): Promise<void> => {
    if (problems.length > 0) {
      setNotice({ kind: 'error', text: problems.join(' · ') })
      return
    }
    // The same guard once more: an entry edit made by typing is held to it too.
    const guarded = guard(current, env)
    if (!guarded.ok) {
      setNotice({ kind: 'error', text: refusalText(guarded.refusal) })
      return
    }
    if (JSON.stringify(guarded.session.draft.workspaces) !== JSON.stringify(current.draft.workspaces)) {
      // It added declarations: say so first, and save on the next click.
      setSession(guarded.session)
      setNotes(existing => [...existing, ...guarded.notes])
      return
    }
    try {
      // Two sets rather than the namespace root: an older page bundle that sets
      // only `scopes` leaves the path declarations alone.
      // DSH 0.2.0 ConfigForm.mutate resolves false when the Host refuses the
      // write (validation, stale revision, or a higher layer shadowing the row)
      // and has already reloaded Host state; only a transport failure throws.
      const accepted = await scope.mutate([
        {
          op: 'set',
          path: ['scopes'],
          value: toScopes(rows).map(entry => ({
            name: entry.name,
            ...(entry.pathPrefixes === undefined ? {} : { pathPrefixes: [...entry.pathPrefixes] }),
            ...(entry.remotePatterns === undefined ? {} : { remotePatterns: [...entry.remotePatterns] }),
            ...(entry.home === undefined ? {} : { home: entry.home }),
            ...(entry.primary === undefined ? {} : { primary: entry.primary }),
            ...(entry.publish === undefined ? {} : { publish: entry.publish }),
            ...(entry.fallback === undefined ? {} : { fallback: entry.fallback }),
            ...(entry.memory === undefined ? {} : { memory: entry.memory }),
          })),
        },
        { op: 'set', path: ['workspaces'], value: current.draft.workspaces.map(declaration => ({ ...declaration })) },
      ])
      if (!accepted) {
        // Keep the draft: the page still shows the Host's last accepted value
        // beside the user's unsaved edits, never an intermediate state.
        setNotice({ kind: 'error', text: t('saveFailed') })
        return
      }
      setSession(undefined)
      setNotes([])
      setNotice({ kind: 'ok', text: t('saved') })
      await loadStores()
      await loadWorkspaces()
    } catch (error) {
      setNotice({ kind: 'error', text: `${t('saveFailed')}: ${messageOf(error)}` })
    }
  }, [scope, problems, current, env, rows, refusalText, t, loadStores, loadWorkspaces])

  const runProbe = useCallback(async (): Promise<void> => {
    setProbeResult(undefined)
    setProbeError(undefined)
    try {
      const response = (await rpc.call(MEMEX_CHANNEL, MEMEX_RESOLVE_ENDPOINT, { path: probePath })) as { ok?: boolean; value?: MemexResolveResult; error?: { message?: string } }
      if (response.ok !== true || response.value === undefined) setProbeError(response.error?.message ?? t('probeFailed'))
      else setProbeResult(response.value)
    } catch (error) {
      setProbeError(messageOf(error))
    }
  }, [rpc, probePath, t])

  const dirty = session !== undefined
  const writable = snapshot?.writable === true && snapshot.status === 'ready'

  const toggleExpanded = useCallback((key: string) => {
    setExpanded(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]))
  }, [])

  /**
   * Why the storage kernel's facts are missing, in words a reader can act on.
   *
   * The host reports an internal failure code (`missing`, `timeout`, …) — that
   * is what diagnostics and tests need — but the page MUST NOT hand the code to
   * the user as if it were the fact. `missing` covers both "no kernel" and
   * "wrong kernel version", and the sampled kernel view tells the two apart.
   */
  const kernelReason = (): string => {
    const installed = stores?.kernel.version
    return installed === undefined
      ? fill('kernelMissing', { expected: stores?.kernel.expected ?? '' })
      : fill('kernelMismatch', { expected: stores?.kernel.expected ?? '', installed })
  }

  /** Translate one degraded sync sample into that reason. */
  const degradedReason = (code: string): string => {
    if (code === 'missing') return kernelReason()
    if (code === 'timeout') return t('kernelTimeout')
    return fill('kernelUnknownFailure', { code })
  }

  /**
   * The remote store, as a labelled fact list.
   *
   * Facts are stacked label/value pairs rather than one middot-joined string:
   * each answers a different question, and the remote URL is the only honest
   * signal that content leaves this machine — it needs no colour, only to be
   * readable.
   */
  const renderRemote = (store: MemexStoreView | undefined): JSX.Element => {
    if (store === undefined) return <span className="dshmx-empty">—</span>
    const sync = store.sync
    if (!sync.known) {
      return (
        <dl className="dshmx-facts">
          <dt>{t('factRemote')}</dt>
          <dd>{t('remoteUnknown')}</dd>
          {sync.degraded !== undefined && (
            <>
              <dt>{t('factDetail')}</dt>
              <dd>{degradedReason(sync.degraded)}</dd>
            </>
          )}
        </dl>
      )
    }
    const configured = sync.configured === true
    const token = `remote:${store.scope}`
    return (
      <>
        <dl className="dshmx-facts">
          <dt>{t('factRemote')}</dt>
          <dd className="dshmx-ident">
            {configured
              ? (
                <span className="dshmx-value">
                  <span className="dshmx-url">{sync.remote}</span>
                  <button type="button" className="dshmx-act dshmx-act-inline" disabled={busy !== undefined} onClick={() => void copy(sync.remote ?? '', token)}>
                    {copied === token ? t('copied') : t('copy')}
                  </button>
                </span>
              )
              : t('remoteUnconfigured')}
          </dd>
          {configured && (
            <>
              <dt>{t('factAuto')}</dt>
              <dd>{sync.auto === true ? t('on') : t('off')}</dd>
              {sync.lastSync !== undefined && (
                <>
                  <dt>{t('factLastSync')}</dt>
                  <dd>{sync.lastSync}</dd>
                </>
              )}
            </>
          )}
          <dt>{t('factPublish')}</dt>
          <dd>{store.publishKnown
            ? (store.publish === 'external' ? t('publishExternal') : t('publishInternal'))
            : t('publishUnknown')}</dd>
        </dl>
        {!store.exists && <span className="dshmx-note">{t('libraryAbsent')}</span>}
        <div className="dshmx-actions">
          {configured && (
            <>
              <button type="button" className="dshmx-act dshmx-act-inline" disabled={busy !== undefined} onClick={() => void runRemote(store.scope, 'sync')}>
                {busy === `${store.scope}:sync` ? t('actionBusy') : t('actionSync')}
              </button>
              <button type="button" className="dshmx-act dshmx-act-inline" disabled={busy !== undefined} onClick={() => void runRemote(store.scope, 'pull')}>
                {busy === `${store.scope}:pull` ? t('actionBusy') : t('actionPull')}
              </button>
              <button type="button" className="dshmx-act dshmx-act-inline" disabled={busy !== undefined} onClick={() => void runRemote(store.scope, sync.auto === true ? 'auto-off' : 'auto-on')}>
                {sync.auto === true ? t('actionAutoOff') : t('actionAutoOn')}
              </button>
            </>
          )}
          {confirming === store.scope
            ? (
              <>
                <input
                  className="dshmx-field dshmx-ident"
                  aria-label={t('actionConfirmChange')}
                  value={urlDraft}
                  placeholder={t('urlPlaceholder')}
                  onChange={event => setUrlDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  disabled={busy !== undefined || urlDraft.trim() === ''}
                  onClick={() => void runRemote(store.scope, 'init', urlDraft.trim())}
                >
                  {configured ? t('actionConfirmChange') : t('actionConfigureRemote')}
                </button>
                <button type="button" className="dshmx-act dshmx-act-inline" onClick={() => { setConfirming(undefined); setUrlDraft('') }}>{t('actionCancel')}</button>
              </>
            )
            : (
              <button
                type="button"
                className="dshmx-act dshmx-act-inline"
                disabled={busy !== undefined}
                onClick={() => { setConfirming(store.scope); setUrlDraft('') }}
              >
                {configured ? t('actionChangeRemote') : t('actionConfigureRemote')}
              </button>
            )}
        </div>
        {confirming === store.scope && configured && <span className="dshmx-note">{t('changeRemoteWarning')}</span>}
      </>
    )
  }

  /** The library path of one entry, editable only while it is a draft decision. */
  const renderHome = (view: WorkspaceView, entry: WorkspaceEntryRow): JSX.Element | null => {
    const row = entry.row
    if (row === undefined) return null
    const fallbackName = entry.name.trim() === '' ? t('entryNew') : entry.name.trim()
    const defaultPath = defaultHome(namespaceDir ?? '~/.dsh-memex', fallbackName)
    const effectiveHome = row.home.trim() === '' ? defaultPath : row.home.trim()
    const token = `home:${row.key}`
    return (
      <div className="dshmx-value">
        <input
          className="dshmx-field dshmx-ident"
          aria-label={t('columnLibrary')}
          value={row.home}
          placeholder={defaultPath}
          onChange={event => edit(row.key, current => ({ ...current, home: event.target.value }))}
        />
        {namespaceDir !== undefined && (
          <button
            type="button"
            className="dshmx-act dshmx-act-inline"
            aria-label={`${t('copy')}: ${effectiveHome}`}
            onClick={() => void copy(effectiveHome, token)}
          >
            {copied === token ? t('copied') : t('copy')}
          </button>
        )}
      </div>
    )
  }

  /**
   * One entry line: role, name, card count — and the details only once opened.
   *
   * Collapsed is the default because the comparison a reader makes here is
   * between entries ("which library, how much in it"), while the path, remote
   * state and actions belong to one entry's own story.
   */
  const renderEntry = (view: WorkspaceView, entry: WorkspaceEntryRow): JSX.Element => {
    // Per block: one library shared by two workspaces is two separate rows here.
    const key = entry.kind === 'entry' && entry.row !== undefined ? `${view.key}:${entry.row.key}` : `${view.key}:${entry.kind}`
    const store = byName.get(entry.name)
    const unnamed = entry.kind === 'entry' && entry.name.trim() === ''
    const open = unnamed || expanded.includes(key)
    const role = entry.primary ? t('primaryBadge') : t('additionalBadge')
    return (
      <div className={`dshmx-entry${open ? ' dshmx-entry-open' : ''}${entry.primary ? '' : ' dshmx-entry-additional'}`} key={key}>
        <div className="dshmx-entry-line">
          {/* Every row, a lone one included: an unlabelled row reads as neither. */}
          <span className={`dshmx-role${entry.primary ? ' dshmx-role-primary' : ''}`}>{role}</span>
          {entry.kind === 'entry'
            ? (open
              ? (
                <input
                  className="dshmx-field dshmx-name"
                  aria-label={t('columnLibrary')}
                  value={entry.row?.name ?? ''}
                  placeholder="scope-name"
                  onChange={event => { if (entry.row !== undefined) rename(entry.row.key, event.target.value) }}
                />
              )
              : <span className="dshmx-name-text">{entry.name}</span>)
            : <span className="dshmx-name-text">{entry.name}</span>}
          {entry.kind === 'fallback' && <span className="dshmx-note">{t('fallbackLabel')}</span>}
          {entry.kind === 'assumed' && <span className="dshmx-note">{t('assumedLabel')}</span>}
          {store?.cards !== undefined && <span className="dshmx-count">{`${String(store.cards)} ${t('cards')}`}</span>}
          {entry.kind === 'fallback' && (
            <label className="dshmx-toggle">
              <input
                type="checkbox"
                aria-label={t('fallbackLabel')}
                checked={entry.enabled === true}
                disabled={!view.switches.editable}
                onChange={event => toggle(view, 'fallback', event.target.checked)}
              />
              {entry.enabled === true ? t('on') : t('off')}
            </label>
          )}
          {entry.kind === 'fallback' && entry.enabled !== true && renderReach(view)}
          <button
            type="button"
            className="dshmx-act dshmx-act-inline dshmx-disclose"
            aria-expanded={open}
            aria-label={open ? t('actionCollapse') : t('actionExpand')}
            onClick={() => toggleExpanded(key)}
          >
            {open ? '▾' : '▸'}
          </button>
        </div>

        {open && (
          <div className="dshmx-entry-body">
            {entry.kind === 'entry' && renderHome(view, entry)}
            {entry.kind === 'assumed' && <p className="dshmx-note dshmx-prose">{t('assumedHint')}</p>}
            {entry.kind === 'fallback' && <p className="dshmx-note dshmx-prose">{t('fallbackHint')}</p>}
            {renderRemote(store)}
            <div className="dshmx-actions">
              {/*
                Card browsing. Rendered only when it can actually work: a
                memory-off workspace has no browsing at all, an unmaterialized
                library has no cards to show, and without a resolvable kernel
                nothing can be started. A button that always fails is worse
                than no button.

                The click stays synchronous on purpose — starting the service
                and resolving an address are both async, and awaiting either
                here would drop the user activation and get the new tab
                blocked. The launcher page owns that work and explains failure.
              */}
              {view.memory && store?.exists === true && stores?.kernel.version !== undefined && (
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  onClick={() => { void openBrowseTab(entry.name, browseOpen) }}
                >
                  {t('actionBrowse')}
                </button>
              )}
              {renderEntryActions(view, entry)}
            </div>
          </div>
        )}
      </div>
    )
  }

  /**
   * The fallback decision is off, but a binding still reaches `personal`: the
   * switch shows the decision, this says what a session here can actually do.
   */
  const renderReach = (view: WorkspaceView): JSX.Element | null => {
    const reach = view.reach
    if (reach === undefined || reach.entry || (!reach.read && !reach.write)) return null
    const key: MemexKey = reach.read && reach.write ? 'fallbackViaBindingBoth' : reach.read ? 'fallbackViaBindingRead' : 'fallbackViaBindingWrite'
    return <span className="dshmx-note">{fill(key, { path: view.path, binding: reach.binding ?? '' })}</span>
  }

  /**
   * An entry's claim actions.
   *
   * On a registered workspace they are workspace actions, guarded; a
   * remote-claimed one has none, because its claims live in a repository field.
   * A configuration block edits its entries directly.
   */
  const renderEntryActions = (view: WorkspaceView, entry: WorkspaceEntryRow): JSX.Element | null => {
    const button = (label: MemexKey, onClick: () => void, title?: string): JSX.Element => (
      <button type="button" className="dshmx-act dshmx-act-inline" title={title} onClick={onClick}>{t(label)}</button>
    )
    if (view.fromRegistry) {
      const claim = view.claim?.kind
      if (claim === 'remote') return null
      return (
        <>
          {entry.kind === 'assumed' && button('actionDeclareEntry', () => run((base, facts) =>
            guard({ ...base, draft: { ...base.draft, rows: stageAssumedPrimary(base.draft.rows, view) } }, facts)))}
          {entry.primary && claim !== 'unknown' && button('actionReplacePrimary', () => setPicker({ key: view.key, mode: 'replace' }))}
          {!entry.primary && entry.kind !== 'assumed' && button('actionSetPrimary', () => run((base, facts) =>
            switchPrimary(base, facts, view.path, { name: entry.name, discovered: false })))}
          {/* Only an exact claim can be removed here; an inherited one belongs to its ancestor. */}
          {entry.kind === 'entry' && entry.row !== undefined && claim === 'exact' && button('removeStore', () => {
            const key = entry.row?.key ?? ''
            run((base, facts) => detachFrom(base, facts, view.path, key))
          }, t('removeStoreHint'))}
        </>
      )
    }
    const many = view.entries.filter(item => item.kind === 'entry').length > 1
    return (
      <>
        {entry.kind === 'entry' && many && !entry.primary && button('actionSetPrimary', () => editRows(base => setPrimary(base, view, entry.row?.key ?? '')))}
        {entry.kind === 'entry' && entry.row !== undefined && button('removeStore', () => editRows(base => (view.path === ''
          ? base.filter(row => row.key !== entry.row?.key)
          : detachEntry(base, view, entry.row?.key ?? ''))), t('removeStoreHint'))}
      </>
    )
  }

  /** The "add an entry" picker: choosing is how duplicates are made impossible. */
  const renderPicker = (view: WorkspaceView): JSX.Element => {
    const candidates: readonly EntryCandidate[] = view.candidates
    const claim = view.claim
    // An inherited workspace's first own entry becomes its primary: say so on
    // the picker, before anything is chosen.
    const inherited = claim?.kind === 'inherited'
      ? <span className="dshmx-note">{fill('attachBecomesHint', { path: view.path, split: claim.prefix, list: claim.scopes.join(', ') })}</span>
      : null
    const open = picker?.key === view.key ? picker : undefined
    if (open === undefined) {
      return (
        <>
          <button type="button" className="dshmx-act dshmx-act-inline" onClick={() => setPicker({ key: view.key, mode: 'attach' })}>{t('actionAttach')}</button>
          {inherited}
        </>
      )
    }
    const label = open.mode === 'replace' ? t('actionReplacePrimary') : t('actionAttach')
    const choose = (candidate: EntryCandidate): void => {
      setPicker(undefined)
      if (open.mode === 'replace') run((base, facts) => switchPrimary(base, facts, view.path, candidate))
      else if (view.fromRegistry) run((base, facts) => attachTo(base, facts, view.path, candidate))
      else editRows(base => attachEntry(base, view, candidate))
    }
    return (
      <span className="dshmx-attach">
        <select
          className="dshmx-field"
          aria-label={label}
          value=""
          onChange={event => {
            const chosen = event.target.value
            if (chosen === '') return
            choose(chosen === '\u0000new'
              ? { name: '', discovered: true }
              : candidates.find(item => item.name === chosen) ?? { name: chosen, discovered: false })
          }}
        >
          <option value="">{candidates.length === 0 ? t('attachEmpty') : label}</option>
          {candidates.map(candidate => (
            <option key={candidate.name} value={candidate.name}>{`${candidate.name}${candidate.discovered ? ` · ${t('assumedLabel')}` : ''}`}</option>
          ))}
          <option value={'\u0000new'}>{t('attachNew')}</option>
        </select>
        <button type="button" className="dshmx-act dshmx-act-inline" onClick={() => setPicker(undefined)}>{t('actionCancel')}</button>
        {open.mode === 'attach' && inherited}
      </span>
    )
  }

  /**
   * One workspace block.
   *
   * The collapsed group of memory-off workspaces renders through this same path,
   * so "can I switch it back on here" never depends on a second code path.
   * @param view - the workspace to render.
   * @returns the block.
   */
  const renderBlock = (view: WorkspaceView): JSX.Element => {
    const group = view.group
    const switches = view.switches
    const remote = view.claim?.kind === 'remote'
    return (
      <section className="dshmx-lib" key={view.key}>
        <header className="dshmx-lib-head">
          {/* The eyebrow only appears where it distinguishes: a block that came
              from configuration is not a workspace, and saying so is
              information. Repeating "workspace" above every workspace was not —
              the title already is one. */}
          {!view.fromRegistry && <span className="dshmx-part-label">{t('noWorkspaceTitle')}</span>}
          <span className="dshmx-ws-title">{view.title === '' ? t('entryNew') : view.title}</span>
          {view.fromRegistry
            ? <span className="dshmx-ident dshmx-ws-path">{view.path}</span>
            : (
              <span className="dshmx-ws">
                {view.paths.map((path, index) => (
                  <span className="dshmx-fieldrow" key={`${view.key}-${String(index)}`}>
                    <input
                      className="dshmx-field dshmx-ident"
                      aria-label={t('workspaceHint')}
                      value={path}
                      placeholder={t('workspaceHint')}
                      onChange={event => editRows(base => (group === undefined ? base : setPathInGroup(base, group, index, event.target.value)))}
                    />
                    <button
                      type="button"
                      className="dshmx-act dshmx-act-inline"
                      aria-label={`${t('removePath')}: ${path}`}
                      onClick={() => editRows(base => (group === undefined ? base : removePathFromGroup(base, group, index)))}
                    >
                      {t('removePath')}
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  onClick={() => editRows(base => (group === undefined ? base : addPathToGroup(base, group)))}
                >
                  {t('addPath')}
                </button>
              </span>
            )}
          <span className="dshmx-count">{`${String(view.entries.length)} ${t('entryCount')}`}</span>
          {/* Memory on/off belongs to the workspace, not to one entry: it is a
              property of the route a session here takes. */}
          <label className="dshmx-toggle dshmx-ws-memory">
            <input
              type="checkbox"
              aria-label={t('memoryLabel')}
              checked={view.memory}
              disabled={!switches.editable}
              onChange={event => toggle(view, 'memory', event.target.checked)}
            />
            {`${t('memoryLabel')} ${view.memory ? t('on') : t('off')}`}
          </label>
        </header>
        {!view.memory && <p className="dshmx-note dshmx-prose">{t('memoryHint')}</p>}
        {!switches.editable && (
          <p className="dshmx-note dshmx-prose">{t(switches.reason === 'degraded'
            ? 'switchesReadonlyDegraded'
            : switches.reason === 'pathless' ? 'switchesReadonlyPathless' : 'switchesReadonlyUnregistered')}</p>
        )}
        {remote && <p className="dshmx-note dshmx-prose">{t('remoteClaimedHint')}</p>}

        <div className="dshmx-entries">
          {view.entries.map(entry => renderEntry(view, entry))}
        </div>

        {!remote && <div className="dshmx-actions">{renderPicker(view)}</div>}
      </section>
    )
  }

  return (
    <div className="dshmx-root">
      <header className="dshmx-bar">
        <h2 className="dshmx-title">{t('nav')}</h2>
        <button type="button" className="dshmx-act dshmx-act-inline" onClick={() => { void loadStores(); void loadWorkspaces() }}>{t('refresh')}</button>
      </header>
      <p className="dshmx-lede">{t('intro')}</p>

      {storesError !== undefined && (
        <div className="dshmx-banner dshmx-banner-warn" role="status">
          <div>{t('unavailableTitle')}</div>
          <div className="dshmx-note">{t('unavailableDetail')}</div>
        </div>
      )}
      {(workspacesFailed || workspaces?.known === false) && storesError === undefined && (
        <div className="dshmx-banner dshmx-banner-warn" role="status">
          <div className="dshmx-note">{t('degradedWorkspaces')}</div>
        </div>
      )}
      {/*
        The kernel is the one prerequisite whose absence degrades *everything*
        (no recall, no writes, no sync facts). Say so at the top, with the
        version it needs and where a working one comes from — an entry-level
        "unavailable" alone leaves the reader with no way to tell whether their
        library or their machine is at fault.
      */}
      {stores !== undefined && stores.kernel.matches !== true && storesError === undefined && (
        <div className="dshmx-banner dshmx-banner-warn" role="status">
          <div>{t('kernelTitle')}</div>
          <div className="dshmx-note">{kernelReason()}</div>
        </div>
      )}

      <div className="dshmx-shelf">
        {active.map(view => renderBlock(view))}
      </div>

      {hidden.length > 0 && (
        <div className="dshmx-group">
          {/* Collapsed by default: a workspace whose memory is off has left daily
              view, but the switch that turns it back on lives in this block, so
              the block stays one click away rather than filtered out. */}
          <div className="dshmx-line">
            <span className="dshmx-group-title">{`${t('hiddenGroup')} (${String(hidden.length)})`}</span>
            <button
              type="button"
              className="dshmx-act dshmx-act-inline"
              aria-expanded={showHidden}
              aria-label={t('hiddenGroup')}
              onClick={() => setShowHidden(current => !current)}
            >
              {showHidden ? t('actionHide') : t('actionShow')}
            </button>
          </div>
          {showHidden && hidden.map(view => renderBlock(view))}
        </div>
      )}

      {undeclared.length > 0 && (
        <div className="dshmx-group">
          <span className="dshmx-group-title">{t('undeclaredTitle')}</span>
          <p className="dshmx-lede">{t('undeclaredHint')}</p>
          {undeclared.map(store => (
            <div className="dshmx-line" key={store.scope}>
              <span className="dshmx-ident">{`${store.scope}  ${store.home}`}</span>
              <button
                type="button"
                className="dshmx-act dshmx-act-inline"
                onClick={() => editRows(base => (base.some(row => row.name === store.scope) ? base : [...base, {
                  key: `declare-${store.scope}`,
                  name: store.scope,
                  paths: [],
                  repos: [],
                  home: store.homeSource === 'configured' ? store.home : '',
                  saved: false,
                }]))}
              >
                {t('actionDeclare')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="dshmx-group">
        <span className="dshmx-group-title">{t('probeTitle')}</span>
        <p className="dshmx-lede">{t('probeHint')}</p>
        <div className="dshmx-probe">
          <input
            className="dshmx-field dshmx-ident"
            aria-label={t('probeTitle')}
            value={probePath}
            placeholder={t('probePlaceholder')}
            onChange={event => setProbePath(event.target.value)}
          />
          <button type="button" className="dshmx-act dshmx-act-inline" disabled={probePath.trim() === ''} onClick={() => void runProbe()}>{t('probeRun')}</button>
        </div>
        {probeResult !== undefined && <span className="dshmx-ident">{`${t('probeResult')}: ${probeResult.scope}  ${probeResult.home}`}</span>}
        {probeError !== undefined && <span className="dshmx-banner dshmx-banner-error">{`${t('probeFailed')}: ${probeError}`}</span>}
      </div>

      {problems.length > 0 && (
        <div className="dshmx-banner dshmx-banner-error" role="alert">
          {problems.map(problem => <div key={problem}>{problem}</div>)}
        </div>
      )}

      {notes.length > 0 && (
        <div className="dshmx-banner dshmx-banner-ok" role="status">
          {[...new Set(notes.map(noteText))].map(text => <div key={text}>{text}</div>)}
        </div>
      )}

      {notice !== undefined && (
        <div className={`dshmx-banner ${notice.kind === 'ok' ? 'dshmx-banner-ok' : 'dshmx-banner-error'}`} role="status">{notice.text}</div>
      )}

      <div className="dshmx-footer">
        <button type="button" className="dshmx-primary" disabled={!writable || problems.length > 0} onClick={() => void save()}>{t('save')}</button>
        <button type="button" className="dshmx-act dshmx-act-inline" disabled={!dirty} onClick={() => { setSession(undefined); setNotes([]); setNotice(undefined) }}>{t('discard')}</button>
        <span className="dshmx-note">{dirty ? t('unsaved') : t('saved')}</span>
      </div>
    </div>
  )
}
