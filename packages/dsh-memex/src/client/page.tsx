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
 * is why declaring the derived primary is reported in the notice line.
 *
 * @module dsh-memex/client/page
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
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
import type { MemexKey } from './locales.js'
import {
  addPathToGroup,
  attachEntry,
  candidatesFor,
  conflicts,
  defaultHome,
  detachEntry,
  removePathFromGroup,
  rowsFromSettings,
  setFallback,
  setMemory,
  setPathInGroup,
  setPrimary,
  stageAssumedPrimary,
  storesByName,
  toScopes,
  undeclaredStores,
  workspaceViews,
  type EditorRow,
  type EntryCandidate,
  type MemexSettingsShape,
  type WorkspaceEntryRow,
  type WorkspaceView,
} from './settings-model.js'

/** The injected service face for the section slot (spread flat by the renderer). */
export interface MemexSectionInjected {
  /** Connection RPC caller for the `/dsh-memex` channel. */
  rpc: ClientConnectionRpc
  /** Section copy under the plugin's locale namespace. */
  t: (key: MemexKey) => string
  /** The `dsh-memex` settings namespace, bound on the client. */
  scope: SettingsScope<MemexSettingsShape>
}

/** Props delivered to the section component (the inject face, flat). */
export type MemexSectionProps = Partial<MemexSectionInjected>

interface Notice {
  readonly kind: 'ok' | 'error'
  readonly text: string
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
  const { rpc, t, scope } = props
  if (rpc === undefined || t === undefined || scope === undefined) return null
  return <MemexSettingsPage rpc={rpc} t={t} scope={scope} />
}

/** The page body, with every injected part guaranteed present. */
function MemexSettingsPage(props: Required<MemexSectionInjected>): JSX.Element {
  const { rpc, t, scope } = props
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot())
  const [draft, setDraft] = useState<EditorRow[] | undefined>(undefined)
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
  const [picker, setPicker] = useState<string | undefined>(undefined)

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
  const rows = draft ?? savedRows
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
    }),
    [rows, namespaceDir, t],
  )
  // Workspaces are the page's subject; the host registry is the skeleton and the
  // configured paths fill in whatever it does not cover.
  const views = useMemo(
    () => workspaceViews(rows, workspaces, stores?.stores),
    [rows, workspaces, stores],
  )
  // Libraries a workspace already presents are declared from that block, which
  // also records the workspace; only the unaccounted for stay in their own list.
  const accounted = useMemo(
    () => views.flatMap(view => view.entries.filter(entry => entry.kind !== 'fallback').map(entry => entry.name)),
    [views],
  )
  const undeclared = useMemo(() => undeclaredStores(stores?.stores, rows, accounted), [stores, rows, accounted])
  // Memory off means the workspace has left daily view — it stays reachable,
  // because the switch that turns it back on lives in its block.
  const active = useMemo(() => views.filter(view => view.memory), [views])
  const hidden = useMemo(() => views.filter(view => !view.memory), [views])

  const edit = useCallback((key: string, change: (row: EditorRow) => EditorRow) => {
    setDraft(current => (current ?? savedRows).map(row => (row.key === key ? change(row) : row)))
  }, [savedRows])

  const apply = useCallback((change: (base: readonly EditorRow[]) => readonly EditorRow[], staged: string) => {
    setDraft(current => {
      const base = current ?? savedRows
      const next = [...change(base)]
      if (next.length !== base.length) setNotice({ kind: 'ok', text: staged })
      else setNotice(undefined)
      return next
    })
  }, [savedRows])

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
    try {
      await scope.mutate([{ op: 'set', path: ['scopes'], value: toScopes(rows) }])
      setDraft(undefined)
      setNotice({ kind: 'ok', text: t('saved') })
      await loadStores()
      await loadWorkspaces()
    } catch (error) {
      setNotice({ kind: 'error', text: `${t('saveFailed')}: ${messageOf(error)}` })
    }
  }, [scope, problems, rows, t, loadStores, loadWorkspaces])

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

  const dirty = draft !== undefined
  const writable = snapshot?.writable === true && snapshot.status === 'ready'

  const toggleExpanded = useCallback((key: string) => {
    setExpanded(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]))
  }, [])

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
              <dd>{sync.degraded}</dd>
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
  const renderEntry = (view: WorkspaceView, entry: WorkspaceEntryRow, many: boolean): JSX.Element => {
    const key = entry.kind === 'entry' && entry.row !== undefined ? entry.row.key : `${view.key}:${entry.kind}`
    const store = byName.get(entry.name)
    const unnamed = entry.kind === 'entry' && entry.name.trim() === ''
    const open = unnamed || expanded.includes(key)
    const role = entry.primary ? t('primaryBadge') : t('additionalBadge')
    return (
      <div className={`dshmx-entry${open ? ' dshmx-entry-open' : ''}${entry.primary ? '' : ' dshmx-entry-additional'}`} key={key}>
        <div className="dshmx-entry-line">
          {many && (
            <span className={`dshmx-role${entry.primary ? ' dshmx-role-primary' : ''}`}>{role}</span>
          )}
          {entry.kind === 'entry'
            ? (open
              ? (
                <input
                  className="dshmx-field dshmx-name"
                  aria-label={t('columnLibrary')}
                  value={entry.row?.name ?? ''}
                  placeholder="scope-name"
                  onChange={event => { if (entry.row !== undefined) edit(entry.row.key, current => ({ ...current, name: event.target.value })) }}
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
                onChange={event => apply(base => setFallback(base, view, event.target.checked), t('stagedNotice'))}
              />
              {entry.enabled === true ? t('on') : t('off')}
            </label>
          )}
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
              {entry.kind === 'assumed' && (
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  onClick={() => apply(base => stageAssumedPrimary(base, view), t('stagedNotice'))}
                >
                  {t('actionDeclareEntry')}
                </button>
              )}
              {entry.kind === 'entry' && many && !entry.primary && (
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  onClick={() => apply(base => setPrimary(base, view, entry.row?.key ?? ''), '')}
                >
                  {t('actionSetPrimary')}
                </button>
              )}
              {entry.kind === 'entry' && entry.row !== undefined && (
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  title={t('removeStoreHint')}
                  onClick={() => apply(base => (view.path === '' ? base.filter(row => row.key !== entry.row?.key) : detachEntry(base, view, entry.row?.key ?? '')), '')}
                >
                  {t('removeStore')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  /** The "add an entry" picker: choosing is how duplicates are made impossible. */
  const renderPicker = (view: WorkspaceView): JSX.Element => {
    const candidates: readonly EntryCandidate[] = view.candidates
    if (picker !== view.key) {
      return (
        <button type="button" className="dshmx-act dshmx-act-inline" onClick={() => setPicker(view.key)}>{t('actionAttach')}</button>
      )
    }
    return (
      <span className="dshmx-attach">
        <select
          className="dshmx-field"
          aria-label={t('actionAttach')}
          value=""
          onChange={event => {
            const chosen = event.target.value
            if (chosen === '') return
            const candidate = chosen === '\u0000new'
              ? { name: '', discovered: true }
              : candidates.find(item => item.name === chosen) ?? { name: chosen, discovered: false }
            setPicker(undefined)
            apply(base => attachEntry(base, view, candidate), t('stagedNotice'))
          }}
        >
          <option value="">{candidates.length === 0 ? t('attachEmpty') : t('actionAttach')}</option>
          {candidates.map(candidate => (
            <option key={candidate.name} value={candidate.name}>{`${candidate.name}${candidate.discovered ? ` · ${t('assumedLabel')}` : ''}`}</option>
          ))}
          <option value={'\u0000new'}>{t('attachNew')}</option>
        </select>
        <button type="button" className="dshmx-act dshmx-act-inline" onClick={() => setPicker(undefined)}>{t('actionCancel')}</button>
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
    // Roles are drawn on every row as soon as there is more than one row to
    // contrast. The fallback counts: a lone primary above an "additional"
    // fallback is exactly the case where an unlabelled primary reads wrong.
    const many = view.entries.length > 1
    const group = view.group
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
                      onChange={event => setDraft(current => (group === undefined ? current ?? savedRows : setPathInGroup(current ?? savedRows, group, index, event.target.value)))}
                    />
                    <button
                      type="button"
                      className="dshmx-act dshmx-act-inline"
                      aria-label={`${t('removePath')}: ${path}`}
                      onClick={() => setDraft(current => (group === undefined ? current ?? savedRows : removePathFromGroup(current ?? savedRows, group, index)))}
                    >
                      {t('removePath')}
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="dshmx-act dshmx-act-inline"
                  onClick={() => setDraft(current => (group === undefined ? current ?? savedRows : addPathToGroup(current ?? savedRows, group)))}
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
              onChange={event => apply(base => setMemory(base, view, event.target.checked), t('stagedNotice'))}
            />
            {`${t('memoryLabel')} ${view.memory ? t('on') : t('off')}`}
          </label>
        </header>
        {!view.memory && <p className="dshmx-note dshmx-prose">{t('memoryHint')}</p>}

        <div className="dshmx-entries">
          {view.entries.map(entry => renderEntry(view, entry, many))}
        </div>

        <div className="dshmx-actions">{renderPicker(view)}</div>
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
                onClick={() => apply(base => (base.some(row => row.name === store.scope) ? base : [...base, {
                  key: `declare-${store.scope}`,
                  name: store.scope,
                  paths: [],
                  repos: [],
                  home: store.homeSource === 'configured' ? store.home : '',
                  saved: false,
                }]), '')}
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

      {notice !== undefined && (
        <div className={`dshmx-banner ${notice.kind === 'ok' ? 'dshmx-banner-ok' : 'dshmx-banner-error'}`} role="status">{notice.text}</div>
      )}

      <div className="dshmx-footer">
        <button type="button" className="dshmx-primary" disabled={!writable || problems.length > 0} onClick={() => void save()}>{t('save')}</button>
        <button type="button" className="dshmx-act dshmx-act-inline" disabled={!dirty} onClick={() => { setDraft(undefined); setNotice(undefined) }}>{t('discard')}</button>
        <span className="dshmx-note">{dirty ? t('unsaved') : t('saved')}</span>
      </div>
    </div>
  )
}
