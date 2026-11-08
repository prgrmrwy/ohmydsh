import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { basenameOf, downloadProducedFile, fileErrorMessage } from './open-produced.js'
import { pathForPresentedAction } from './presented-file.js'

type DownloadProps = PropsRuntime<'deliverables.file.actions'> & { ctx: Context }

/** Independent action in the official card's action seat; native desktop availability does not gate downloads. */
export function PresentedDownload({ ctx, sessionId, actionUrl, pending, useChat }: DownloadProps) {
  const path = useChat((snapshot) => pathForPresentedAction(snapshot, sessionId, actionUrl))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const inFlight = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => { controller.abort() }
  }, [ctx, sessionId, actionUrl])

  const download = async (event: MouseEvent<HTMLButtonElement>): Promise<void> => {
    event.stopPropagation()
    const signal = lifetime.current?.signal
    if (!path || pending || inFlight.current || !signal || signal.aborted) return
    inFlight.current = true
    setBusy(true)
    setFeedback('')
    try {
      const files = ctx.get('remote')?.workspaceFiles
      const actions = ctx.get('fileActions')
      if (!files || !actions) throw new Error('文件下载能力不可用，请检查 DSH 文件服务。')
      const result = await downloadProducedFile(files, actions, sessionId, path, signal)
      signal.throwIfAborted()
      if (result.status === 'cancelled') return
      const text = result.status === 'requested' ? '已请求浏览器下载，保存位置由浏览器决定。' : '文件已保存'
      setFeedback(text)
      ctx.get('contextMenus')?.notify(text, true)
    } catch (error) {
      if (!signal.aborted) {
        const text = fileErrorMessage(error)
        setFeedback(text)
        ctx.get('contextMenus')?.notify(text, false)
      }
    } finally {
      inFlight.current = false
      if (!signal.aborted) setBusy(false)
    }
  }

  const label = busy ? '正在下载…' : path ? `下载 ${basenameOf(path)}` : '文件声明暂不可用'
  return (
    <button
      type="button"
      data-dsh-presented-download=""
      aria-label={label}
      aria-busy={busy}
      title={feedback || (busy ? label : '下载到本地')}
      disabled={!path || busy || pending}
      onClick={(event) => { void download(event) }}
      style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 4, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: busy || !path || pending ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" />
      </svg>
    </button>
  )
}

export function registerPresentedDownloads(ctx: Context): void {
  ctx.slots.inject('deliverables.file.actions', () => ctx.slots.register({
    name: 'deliverables.file.actions',
    id: 'sidebar-session-resources:download',
    order: 90,
  }, (props) => <PresentedDownload key={`${props.sessionId}:${props.actionUrl}`} {...props} ctx={ctx} />))
}
