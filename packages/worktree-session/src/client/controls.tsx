import { useEffect, useMemo, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RepoStatusResult, SessionStatusResult } from '../wire.ts'
import { post, ROUTES } from './api.ts'
import { decorateSubmit, restoreSubmit } from './handoff.ts'
import { getStage, resetStage, resetStageForCwd, setStage, subscribeStage, type ClientStage } from './stage-store.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export type WorktreeControlsProps = PropsRuntime<'conversation.input.left'> & {
  pluginContext: ClientContext
  /** Replacement open action (e.g. from plugin config). Defaults to a `vscode://file/` deep link. */
  openWorktree?: (path: string) => void
}

const containerStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }
const controlStyle: React.CSSProperties = { border: '1px solid var(--dsw-alias-line-border, #d0d0d0)', borderRadius: 8, background: 'transparent', color: 'inherit', height: 26, maxWidth: 190 }
/**
 * Shared single-line truncation for every ref-name-bearing control: long branch
 * and ref names must clip with an ellipsis instead of wrapping and growing the
 * input row. Kept separate from `controlStyle` because the dropdown search
 * `<input>` reuses that base style and needs no text-line rules.
 */
const ellipsisStyle: React.CSSProperties = { boxSizing: 'border-box', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const BASE_REF_HINT = 'Choose the base ref; selection has no Git side effects'

/** Hover text for the base ref chooser: full ref name first, then the no-side-effects hint. */
export function baseRefChooserTitle(baseRef: string | undefined): string {
  return baseRef === undefined ? BASE_REF_HINT : `${baseRef} — ${BASE_REF_HINT}`
}

/** One dropdown candidate: single-line ellipsis label with the full ref name on hover. */
export function BaseRefOption({ name, selected, onSelect }: { name: string, selected: boolean, onSelect: () => void }) {
  return <button
    type="button"
    title={name}
    style={{ ...ellipsisStyle, width: '100%', border: 0, background: selected ? '#3370ff22' : 'transparent', color: 'inherit', textAlign: 'left', padding: '5px 7px', borderRadius: 6 }}
    onClick={onSelect}
  >{name}</button>
}

/** Open an absolute directory with the local editor via a `vscode://file/` deep link. */
export function openWorktreeInEditor(path: string): void {
  if (!path.startsWith('/') && !/^[A-Za-z]:[/\\]/.test(path)) return
  const uri = `vscode://file${encodeURI(path)}`
  window.open(uri, '_blank')
}

export function WorktreeControls({ pluginContext: ctx, session, sessionId, useSessions, openWorktree = openWorktreeInEditor }: WorktreeControlsProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const cwd = summary?.cwd
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const stage = cwd === undefined ? undefined : getStage(sessionId as string, cwd)

  useEffect(() => subscribeStage(sessionId as string, () => { setRevision(value => value + 1) }), [sessionId])
  useEffect(() => {
    if (cwd === undefined) { restoreSubmit(sessionId as string); return }
    let live = true
    void post<SessionStatusResult>(ROUTES.sessionStatus, { repoPath: cwd, sessionId: sessionId as string }).then(status => {
      if (!live) return
      if (status.bound) {
        setStage(sessionId as string, cwd, {
          enabled: false,
          ...(status.operationId === undefined ? {} : { operationId: status.operationId }),
          ...(status.taskBranch === undefined ? {} : { taskBranch: status.taskBranch }),
          ...(status.worktreePath === undefined ? {} : { worktreePath: status.worktreePath }),
          ...(status.dependencyMode === undefined ? {} : { dependencyMode: status.dependencyMode }),
          ...(status.lifecycle === undefined ? {} : { lifecycle: status.lifecycle }),
          phase: status.lifecycle === 'uncertain' ? 'uncertain' : status.lifecycle === 'cleaned' ? 'cleaned' : 'done',
        })
        restoreSubmit(sessionId as string)
        return
      }
      // Host status is authoritative: release stale cleaned/local handoff state
      // for this exact immutable Session cwd before ordinary rendering rules.
      resetStageForCwd(sessionId as string, cwd)
      restoreSubmit(sessionId as string)
      if (!session.blank) return
      void post<RepoStatusResult>(ROUTES.repoStatus, { repoPath: cwd }).then(result => {
        if (!live) return
        const current = getStage(sessionId as string, cwd)
        const selected = current.baseRef ?? result.currentBranch ?? result.refs[0]?.name
        setStage(sessionId as string, cwd, { refs: result.refs, ...(selected === undefined ? {} : { baseRef: selected }) })
      }).catch(() => { if (live) resetStage(sessionId as string) })
    }).catch(() => {
      if (live && !session.blank) restoreSubmit(sessionId as string)
    })
    return () => { live = false; restoreSubmit(sessionId as string) }
  }, [ctx, cwd, session.blank, sessionId])

  useEffect(() => {
    if (cwd === undefined || stage === undefined || !stage.enabled || !session.blank) { restoreSubmit(sessionId as string); return }
    try { return decorateSubmit(ctx, sessionId as string, cwd) } catch (error) {
      setStage(sessionId as string, cwd, { enabled: false, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [ctx, cwd, session.blank, sessionId, stage?.enabled])

  const filtered = useMemo(() => (stage?.refs ?? []).filter(ref => ref.name.toLowerCase().includes(query.toLowerCase())), [query, revision, stage?.refs])
  if (cwd === undefined || stage === undefined) return null
  if (stage.lifecycle !== undefined) {
    const lifecycle = stage.lifecycle === 'admitted' || stage.lifecycle === 'bound' || stage.lifecycle === 'submit-claimed' ? 'active' : stage.lifecycle
    const canOpen = lifecycle !== 'cleaned' && stage.worktreePath !== undefined
    const branchStyle: React.CSSProperties = { ...controlStyle, ...ellipsisStyle, lineHeight: '24px', padding: '0 8px', ...(canOpen ? { cursor: 'pointer', borderColor: 'var(--dsw-alias-line-border-strong, #a0a0a0)' } : {}) }
    const openBranch = (): void => { if (canOpen) openWorktree(stage.worktreePath as string) }
    const onBranchKeyDown = (event: React.KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBranch() }
    }
    return <span style={containerStyle} data-testid="worktree-session-status" title={stage.worktreePath}>
      <span
        title={stage.taskBranch}
        style={branchStyle}
        {...(canOpen ? { role: 'button', tabIndex: 0, onClick: openBranch, onKeyDown: onBranchKeyDown, 'aria-label': `Open worktree in editor: ${stage.taskBranch ?? 'worktree'}` } : {})}
      >⑂ {stage.taskBranch ?? 'worktree'}</span>
      <span style={{ opacity: .8 }}>{stage.dependencyMode ?? 'lean'}</span>
      <span style={{ color: lifecycle === 'uncertain' ? '#d9822b' : lifecycle === 'cleaned' ? '#888' : '#2b8a3e' }}>{lifecycle}</span>
    </span>
  }
  if (!session.blank || stage.refs.length === 0) return null

  return <span style={containerStyle} data-testid="worktree-session-controls">
    <span style={{ position: 'relative' }}>
      <button type="button" style={{ ...controlStyle, ...ellipsisStyle, padding: '0 8px' }} title={baseRefChooserTitle(stage.baseRef)} onClick={() => {
        const next = !open
        setOpen(next)
        if (next) void post<RepoStatusResult>(ROUTES.repoStatus, { repoPath: cwd }).then(result => { setStage(sessionId as string, cwd, { refs: result.refs }) })
      }}>⑂ {stage.baseRef ?? 'Choose base'} ▾</button>
      {open && <span style={{ position: 'absolute', bottom: 30, left: 0, zIndex: 1000, width: 300, padding: 8, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2, white)', boxShadow: '0 8px 30px #0003' }}>
        <input autoFocus value={query} onChange={event => { setQuery(event.target.value) }} placeholder="Search local and remote refs" style={{ ...controlStyle, boxSizing: 'border-box', width: '100%', maxWidth: 'none', padding: '0 7px' }} />
        <span style={{ display: 'block', maxHeight: 230, overflow: 'auto', marginTop: 6 }}>
          {(['local', 'remote'] as const).map(kind => <span key={kind} style={{ display: 'block' }}>
            <strong style={{ display: 'block', padding: '5px 7px', opacity: .65 }}>{kind === 'local' ? 'Local' : 'Remote'}</strong>
            {filtered.filter(ref => ref.kind === kind).map(ref => <BaseRefOption
              key={ref.fullName}
              name={ref.name}
              selected={ref.name === stage.baseRef}
              onSelect={() => { setStage(sessionId as string, cwd, { baseRef: ref.name }); setOpen(false) }}
            />)}
          </span>)}
        </span>
      </span>}
    </span>
    <button type="button" aria-pressed={stage.enabled} style={{ ...controlStyle, padding: '0 8px', background: stage.enabled ? '#3370ff22' : 'transparent' }} onClick={() => {
      const enabled = !stage.enabled
      setStage(sessionId as string, cwd, { enabled, phase: 'idle', error: undefined, ...(enabled ? {} : { submitted: false }) })
      if (!enabled) restoreSubmit(sessionId as string)
    }}>{stage.enabled ? '☑' : '☐'} Worktree</button>
    {stage.phase !== 'idle' && stage.phase !== 'done' && <span title={stage.error ?? stage.phase} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: stage.error ? '#d44' : 'inherit', opacity: .8 }}>{stage.error ?? stage.phase}</span>}
  </span>
}
