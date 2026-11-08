import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-file-actions/client'
import type { ProducedFile } from '../shared/produced.js'
import { basenameOf, downloadProducedFile, fileErrorMessage, resolveProducedPath } from './open-produced.js'

const ACTION_STYLE: CSSProperties = {
  background: 'none',
  border: '1px solid var(--dsw-alias-border-primary)',
  borderRadius: 4,
  padding: '2px 6px',
  color: 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
}

export function ProducedFileRow({ ctx, sessionId, file, time, onOpenFile }: {
  ctx: Context
  sessionId: SessionId
  file: ProducedFile
  time: string
  onOpenFile?: ((path: string) => void) | undefined
}) {
  const [absolute, setAbsolute] = useState<string>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  const files = ctx.get('remote')?.workspaceFiles

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    if (!files) {
      setError('远端文件服务不可用。')
    } else {
      resolveProducedPath(files, sessionId, file.path, controller.signal).then(setAbsolute).catch((failure) => {
        if (!controller.signal.aborted) setError(fileErrorMessage(failure))
      })
    }
    return () => { controller.abort() }
  // Cordis service lookups return scoped proxies; their identity changes on render.
  }, [ctx, sessionId, file.path])

  const run = async (operation: (signal: AbortSignal) => Promise<string>): Promise<void> => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const feedback = await operation(signal)
      if (!signal.aborted) setStatus(feedback)
    } catch (failure) {
      if (!signal.aborted) setError(fileErrorMessage(failure))
    } finally {
      pending.current = false
      if (!signal.aborted) setBusy(false)
    }
  }

  const fullPath = async (signal: AbortSignal): Promise<string> => {
    if (absolute) return absolute
    if (!files) throw new Error('远端文件服务不可用。')
    const path = await resolveProducedPath(files, sessionId, file.path, signal)
    setAbsolute(path)
    return path
  }

  const name = basenameOf(file.path)
  return (
    <div style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.45 }} aria-busy={busy}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          disabled={busy || !onOpenFile}
          title={onOpenFile ? '在远端编辑器中打开' : '侧边栏编辑器不可用'}
          onClick={() => void run(async (signal) => { onOpenFile?.(await fullPath(signal)); return '' })}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--dsw-alias-accent, #4e8cff)', fontFamily: 'var(--dsh-font-mono, monospace)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, cursor: 'pointer' }}
        >
          # {name}
        </button>
        <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, whiteSpace: 'nowrap' }}>{time}</span>
      </div>
      <div title={absolute ?? file.path} style={{ marginTop: 3, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, fontFamily: 'var(--dsh-font-mono, monospace)', overflowWrap: 'anywhere', userSelect: 'text' }}>
        {absolute ? '远端路径' : '记录路径'}：{absolute ?? file.path}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
        <button type="button" style={ACTION_STYLE} disabled={busy || !absolute} onClick={() => void run(async () => {
          if (!navigator.clipboard?.writeText) throw new Error('浏览器无法访问剪贴板，请手动选择上方路径复制。')
          await navigator.clipboard.writeText(absolute!)
          return '已复制远端路径'
        })}>复制路径</button>
        <button type="button" style={ACTION_STYLE} disabled={busy} onClick={() => void run(async (signal) => {
          const actions = ctx.get('fileActions')
          if (!files || !actions) throw new Error('文件下载能力不可用，请检查 DSH 文件服务。')
          const result = await downloadProducedFile(files, actions, sessionId, absolute ?? file.path, signal)
          if (result.status === 'cancelled') return ''
          return result.status === 'requested' ? '已请求浏览器下载，保存位置由浏览器决定。' : '文件已保存'
        })}>{busy ? '处理中…' : '下载'}</button>
      </div>
      {error && <div role="alert" style={{ marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{error}</div>}
      {status && <div role="status" style={{ marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{status}</div>}
    </div>
  )
}
