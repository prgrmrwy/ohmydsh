import { useEffect, useMemo, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RepoStatusResult } from '../wire.ts'
import { post, ROUTES } from './api.ts'
import { decorateSubmit, restoreSubmit } from './handoff.ts'
import { getStage, resetStage, setStage, subscribeStage, type ClientStage } from './stage-store.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export type WorktreeControlsProps = PropsRuntime<'conversation.input.left'> & { pluginContext: ClientContext }

const containerStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }
const controlStyle: React.CSSProperties = { border: '1px solid var(--dsw-alias-line-border, #d0d0d0)', borderRadius: 8, background: 'transparent', color: 'inherit', height: 26, maxWidth: 190 }

export function WorktreeControls({ pluginContext: ctx, session, sessionId, useSessions }: WorktreeControlsProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const cwd = summary?.cwd
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const stage = cwd === undefined ? undefined : getStage(sessionId as string, cwd)

  useEffect(() => subscribeStage(sessionId as string, () => { setRevision(value => value + 1) }), [sessionId])
  useEffect(() => {
    if (cwd === undefined || !session.blank) { restoreSubmit(sessionId as string); return }
    let live = true
    void post<RepoStatusResult>(ROUTES.repoStatus, { repoPath: cwd }).then(result => {
      if (!live) return
      const current = getStage(sessionId as string, cwd)
      const selected = current.baseRef ?? result.currentBranch ?? result.refs[0]?.name
      setStage(sessionId as string, cwd, { refs: result.refs, ...(selected === undefined ? {} : { baseRef: selected }) })
    }).catch(() => { if (live) resetStage(sessionId as string) })
    return () => { live = false; restoreSubmit(sessionId as string) }
  }, [ctx, cwd, session.blank, sessionId])

  useEffect(() => {
    if (cwd === undefined || stage === undefined || !stage.enabled || !session.blank) { restoreSubmit(sessionId as string); return }
    try { return decorateSubmit(ctx, sessionId as string, cwd) } catch (error) {
      setStage(sessionId as string, cwd, { enabled: false, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [ctx, cwd, session.blank, sessionId, stage?.enabled])

  const filtered = useMemo(() => (stage?.refs ?? []).filter(ref => ref.name.toLowerCase().includes(query.toLowerCase())), [query, revision, stage?.refs])
  if (cwd === undefined || !session.blank || stage === undefined || stage.refs.length === 0) return null

  return <span style={containerStyle} data-testid="worktree-session-controls">
    <span style={{ position: 'relative' }}>
      <button type="button" style={{ ...controlStyle, padding: '0 8px' }} title="Choose the base ref; selection has no Git side effects" onClick={() => {
        const next = !open
        setOpen(next)
        if (next) void post<RepoStatusResult>(ROUTES.repoStatus, { repoPath: cwd }).then(result => { setStage(sessionId as string, cwd, { refs: result.refs }) })
      }}>⑂ {stage.baseRef ?? 'Choose base'} ▾</button>
      {open && <span style={{ position: 'absolute', bottom: 30, left: 0, zIndex: 1000, width: 300, padding: 8, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2, white)', boxShadow: '0 8px 30px #0003' }}>
        <input autoFocus value={query} onChange={event => { setQuery(event.target.value) }} placeholder="Search local and remote refs" style={{ ...controlStyle, boxSizing: 'border-box', width: '100%', maxWidth: 'none', padding: '0 7px' }} />
        <span style={{ display: 'block', maxHeight: 230, overflow: 'auto', marginTop: 6 }}>
          {(['local', 'remote'] as const).map(kind => <span key={kind} style={{ display: 'block' }}>
            <strong style={{ display: 'block', padding: '5px 7px', opacity: .65 }}>{kind === 'local' ? 'Local' : 'Remote'}</strong>
            {filtered.filter(ref => ref.kind === kind).map(ref => <button key={ref.fullName} type="button" style={{ display: 'block', width: '100%', border: 0, background: ref.name === stage.baseRef ? '#3370ff22' : 'transparent', color: 'inherit', textAlign: 'left', padding: '5px 7px', borderRadius: 6 }} onClick={() => { setStage(sessionId as string, cwd, { baseRef: ref.name }); setOpen(false) }}>{ref.name}</button>)}
          </span>)}
        </span>
      </span>}
    </span>
    <button type="button" aria-pressed={stage.enabled} style={{ ...controlStyle, padding: '0 8px', background: stage.enabled ? '#3370ff22' : 'transparent' }} onClick={() => {
      const enabled = !stage.enabled
      setStage(sessionId as string, cwd, { enabled, phase: 'idle', error: undefined, ...(enabled ? {} : { operationId: undefined, submitted: false, targetSessionId: undefined }) })
      if (!enabled) restoreSubmit(sessionId as string)
    }}>{stage.enabled ? '☑' : '☐'} Worktree</button>
    {stage.phase !== 'idle' && stage.phase !== 'done' && <span title={stage.error ?? stage.phase} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: stage.error ? '#d44' : 'inherit', opacity: .8 }}>{stage.error ?? stage.phase}</span>}
  </span>
}
