import { createElement as h, useEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react'
import type { Rpc } from './control.js'

/** A reply bound to an applied AUTO decision; `{}` means no binding. */
interface Allocation { depth: string; effort: string; model: string; feedback?: string | null }
const FEEDBACK: Record<string, string> = { appropriate: '分配合适', 'too-high': '投入偏高', 'too-low': '投入不足', unknown: '无法判断' }
const bound = (value: object): value is Allocation => typeof (value as { depth?: unknown }).depth === 'string'

/** Official primitives, injected so the component carries no styles of its own (tests pass doubles). */
export interface LabelUi {
  Tooltip: ComponentType<{ label: string; side?: 'bottom'; children: ReactElement }>
  Menu: ComponentType<{ open: boolean; anchor: ReactNode; items: readonly MenuEntry[]; onSelect: (id: string) => void; onClose?: () => void; selectedId?: string; side?: 'top' | 'bottom'; portal?: boolean }>
  Icon: ComponentType
}
/** Same look as the official reply-bar buttons (copy, branch, feedback): values from dsh-client-ui-chat's action class. */
type MenuEntry = { id: string; label: string } | { type: 'label'; id: string; text: string }
const CSS = `.amr-label-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}.amr-label-action svg{width:calc(17px + var(--dsh-content-font-delta,0px));height:calc(17px + var(--dsh-content-font-delta,0px))}.amr-label-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}`

async function callLabel(rpc: Rpc, sessionId: string, messageId: string, feedback?: string | null): Promise<object> {
  const result = await rpc.call('/api', 'auto-model-routing.label', { sessionId, messageId, ...(feedback !== undefined ? { feedback } : {}) })
  if (!result.ok) throw new Error(result.error?.message ?? '反馈请求失败')
  return (result.value ?? {}) as object
}

export function tooltipText(view: Allocation): string {
  return `AUTO 分配：${view.depth} → ${view.effort} · ${view.model}${view.feedback ? ` · 你反馈：${FEEDBACK[view.feedback]}` : ' · 评价资源分配是否合适'}`
}

/** Reply-bar allocation feedback: shown only for replies bound to an applied AUTO decision. */
export function LabelButton({ sessionId, messageId, rpc, ui }: { sessionId: string; messageId: string; rpc: Rpc; ui: LabelUi }) {
  const [view, setView] = useState<Allocation | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const exposureTarget = useRef<HTMLSpanElement>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    let active = true
    setView(undefined)
    // One query per message; `{}` (or an error) renders nothing.
    callLabel(rpc, sessionId, messageId).then(value => { if (active && bound(value)) setView(value) }, () => {})
    return () => { active = false }
  }, [rpc, sessionId, messageId])
  useEffect(() => {
    const target = exposureTarget.current
    if (!view || !target || typeof IntersectionObserver === 'undefined') return
    let visible = false, sent = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer); timer = undefined
      if (!sent && visible && document.visibilityState === 'visible' && document.hasFocus()) {
        timer = setTimeout(() => {
          if (!visible || document.visibilityState !== 'visible' || !document.hasFocus()) return
          sent = true
          void rpc.call('/api', 'auto-model-routing.observe', { sessionId, messageId }).catch(() => {})
        }, 3000)
      }
    }
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 1)
      update()
    }, { threshold: 1 })
    observer.observe(target)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update); window.addEventListener('blur', update)
    return () => {
      clearTimeout(timer); observer.disconnect()
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update); window.removeEventListener('blur', update)
    }
  }, [view !== undefined, rpc, sessionId, messageId])
  if (!view) return null
  const chooseFeedback = (id: string) => {
    setOpen(false); setError('')
    // A failure leaves the shown feedback unchanged.
    callLabel(rpc, sessionId, messageId, id === 'clear' ? null : id).then(value => { if (alive.current && bound(value)) setView(value) }, () => { if (alive.current) setError('反馈未保存，请重试') })
  }
  const button = h('button', { type: 'button', className: 'amr-label-action', 'aria-label': tooltipText(view), onClick: () => setOpen(value => !value) }, h(ui.Icon))
  return h('span', { ref: exposureTarget },
    h('style', null, CSS),
    h(ui.Menu, {
      open, side: 'top', portal: true, onClose: () => setOpen(false),
      // The official menu draws the check on the selected row.
      ...(view.feedback ? { selectedId: view.feedback } : {}),
      items: [{ type: 'label', id: 'title', text: '这次资源分配合适吗？' }, ...Object.entries(FEEDBACK).map(([id, label]) => ({ id, label })), ...(view.feedback ? [{ id: 'clear', label: '撤销反馈' }] : [])],
      onSelect: id => { if (Object.hasOwn(FEEDBACK, id) || id === 'clear') chooseFeedback(id) },
      anchor: h(ui.Tooltip, { label: tooltipText(view), side: 'bottom', children: button }),
    }),
    error && h('span', { role: 'alert' }, error),
  )
}
