import { createElement as h, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { callRouting, chipOrder, nextToast, panelOpenAfter, TOAST_MS, toastText, type Decision, type PanelEvent, type Rpc, type Toast } from './control.js'
import { CATEGORY_HINTS, type JevCategory } from '../hints.js'
import { IconInfoOutlineRegular, IconGaugeOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { LabelButton, type LabelUi } from './label.js'
import * as settingsUi from '@deepseek-ai/dsh-client-ui-primitives'
import { RoutingSettings } from './settings-section.js'
import { installRoutingNavIcon } from './nav-icon.js'

interface AutoSupport { supported: boolean; provider?: string; model?: string }
interface View {
  mode: 'AUTO' | 'MANUAL'
  policy?: string
  depth?: string
  effort?: string
  reason?: string
  disabled?: { category: JevCategory; at: number }
  decision?: Decision
  decisionToast?: boolean
  autoSupport?: AutoSupport
}
/** Reactive only as a refresh trigger: the Host state response remains the single source of truth. */
type SelectionStore = { subscribe(listener: () => void): () => void }
type SubscribeSelection = (sessionId: string, onChange: () => void) => () => void
interface Props { sessionId: string; rpc: Rpc; subscribeSelection?: SubscribeSelection }
export const name = 'dsh-auto-model-routing/client'
export const inject = ['slots', 'connection']

const REPO_URL = 'https://github.com/prgrmrwy/dsh-auto-model-routing'

// Same look as the official model picker trigger (dsh-client-ui-model-selection), values read from its bundle.
const CSS = `
.amr-root{position:relative;min-width:0;display:inline-flex}
.amr-trigger{display:flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 8px;border:none;outline:none;background:0 0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:400;line-height:20px;cursor:pointer;white-space:nowrap}
.amr-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.amr-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.amr-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.amr-icon{flex:none;color:var(--dsw-alias-label-caption)}
.amr-trigger[data-locked=true]{color:var(--dsw-alias-label-dimmed);cursor:default}
.amr-trigger[data-locked=true]:hover{background:0 0}
.amr-info{color:var(--dsw-alias-label-caption)}
.amr-card a{color:var(--dsw-alias-state-business-primary);text-decoration:none;overflow-wrap:anywhere}
.amr-card a:hover{text-decoration:underline}
.amr-trigger[data-disabled=true],.amr-trigger[data-disabled=true] .amr-icon{color:var(--dsw-alias-state-error-primary)}
.amr-panel{position:absolute;z-index:1100;bottom:100%;left:0;padding-bottom:6px}
.amr-card{width:280px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg,#fff);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px}
.amr-card p{margin:4px 0}
.amr-latest{margin:6px 0;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.amr-muted{color:var(--dsw-alias-label-tertiary)}
.amr-error{color:var(--dsw-alias-state-error-primary)}
.amr-toast{position:fixed;z-index:1100;transform:translate(-50%,-100%);padding:4px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg,#fff);color:var(--dsw-alias-label-secondary);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;white-space:normal;max-width:min(480px,calc(100vw - 24px));overflow-wrap:anywhere}
`

// Left-right swap arrows at the picker chevron's size; colour follows currentColor.
function SwapIcon() {
  return h('svg', { className: 'amr-icon amr-swap', width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M3 5.5h9.5M10 3l2.5 2.5L10 8' }),
    h('path', { d: 'M13 10.5H3.5M6 8l-2.5 2.5L6 13' }))
}

export function RoutingChip({ sessionId, rpc, initialView, initiallyOpen = false, initialToast, subscribeSelection }: Props & { initialView?: View; initiallyOpen?: boolean; initialToast?: Toast }) {
  const [view, setView] = useState<View | undefined>(initialView)
  const [open, setOpen] = useState(initiallyOpen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [toast, setToast] = useState<Toast | undefined>(initialToast)
  // The composer hides the right-side controls while the agent runs (when Jev decides), so the hint is
  // portaled to <body> and placed above the chip's last visible position.
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const anchor = useRef<{ left: number; top: number } | undefined>(undefined)
  const remember = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    // Horizontal centre of the chip; the hint centres itself on it via translate(-50%).
    if (rect && rect.width > 0) anchor.current = { left: rect.left + rect.width / 2, top: rect.top - 6 }
  }
  // The first poll of each session only primes `seen`: an old decision is never announced on mount or session switch.
  const seen = useRef<number | undefined>(undefined)
  const primed = useRef(false)
  const viewSession = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!view || viewSession.current !== sessionId) return
    const decision = view.decision
    if (!primed.current) { primed.current = true; seen.current = decision?.id; return }
    const next = nextToast(seen.current, decision)
    if (!next) return
    seen.current = next.id
    // The switch only gates the pop-up; the id is still marked seen so turning it on later shows only new decisions.
    if (!view.decisionToast) return
    remember()
    setToast(next)
  }, [view, sessionId])
  // Hiding depends only on the toast shown, so later state changes cannot cancel it.
  useEffect(() => {
    if (!toast) return
    const hide = setTimeout(() => setToast(undefined), TOAST_MS)
    return () => clearTimeout(hide)
  }, [toast])
  const refreshRef = useRef<() => void>(() => {})
  // Optional acceleration from the official picker store; retried on every state read so a late service still binds.
  const subscription = useRef<{ sessionId: string; stop: () => void } | undefined>(undefined)
  const subscribeRef = useRef<SubscribeSelection | undefined>(undefined)
  subscribeRef.current = subscribeSelection
  const ensureSubscription = () => {
    const subscribe = subscribeRef.current
    if (!subscribe || subscription.current?.sessionId === sessionId) return
    subscription.current?.stop()
    subscription.current = undefined
    let handle: ReturnType<typeof setTimeout> | undefined
    try {
      const stop = subscribe(sessionId, () => { if (handle) clearTimeout(handle); handle = setTimeout(() => refreshRef.current(), 80) })
      subscription.current = { sessionId, stop: () => { stop(); if (handle) clearTimeout(handle) } }
    } catch { subscription.current = undefined }
  }
  useEffect(() => {
    let active = true
    primed.current = false
    seen.current = undefined
    viewSession.current = undefined
    setToast(undefined)
    const refresh = () => { void callRouting(rpc, sessionId).then(value => { if (active) { viewSession.current = sessionId; setView(value as View); setError(''); ensureSubscription() } }, reason => { if (active) setError(String(reason)) }) }
    refreshRef.current = refresh
    refresh()
    const poll = setInterval(refresh, 3000)
    return () => {
      active = false
      clearInterval(poll)
      clearTimeout(timer.current)
      subscription.current?.stop()
      subscription.current = undefined
      refreshRef.current = () => {}
    }
  }, [rpc, sessionId])
  const on = (event: PanelEvent) => () => {
    clearTimeout(timer.current)
    if (panelOpenAfter(event)) timer.current = setTimeout(() => setOpen(true), 150)
    else setOpen(false)
  }
  const toggle = async () => {
    if (busy || !view) return
    setBusy(true)
    try { const next = await callRouting(rpc, sessionId, view.mode === 'AUTO' ? 'MANUAL' : 'AUTO') as View; viewSession.current = sessionId; setView(next); setError('') }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const off = view?.disabled
  const hint = off ? CATEGORY_HINTS[off.category] ?? off.category : undefined
  const locked = view?.autoSupport?.supported === false
  const support = view?.autoSupport
  const lockedModel = `${support?.provider ?? '未知 provider'} / ${support?.model ?? '未知模型'}`
  // The panel sits inside the root (padding bridges the gap), so moving onto it keeps it open.
  const place = anchor.current ?? { left: (typeof window === 'undefined' ? 0 : window.innerWidth / 2), top: (typeof window === 'undefined' ? 0 : window.innerHeight) - 96 }
  const panel = locked
    ? [
        h('p', { key: 'locked-title' }, h('strong', null, 'AUTO 不支持当前模型')),
        h('p', { key: 'locked-model' }, `${lockedModel} 不在自动路由支持范围，已切换为 MANUAL。`),
        h('p', { key: 'locked-note' }, '目前仅支持 Claude / GPT 系列模型；其他模型策略欢迎提交 issue 或 PR：'),
        h('p', { key: 'locked-link' }, h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, REPO_URL)),
        h('p', { key: 'locked-hint', className: 'amr-muted' }, '切回 Claude / GPT 系列模型后，可重新点击启用 AUTO。'),
        error && h('p', { key: 'error', role: 'alert', className: 'amr-error' }, error),
      ]
    : [
        h('p', { key: 'title' }, h('strong', null, view?.mode === 'AUTO' ? '自动调整推理强度' : '手动：不自动调整')),
        h('p', { key: 'output' }, `本回合插件输出：${view?.effort ?? '未改写'} · ${view?.reason ?? '尚无决定'}`),
        view?.decision && h('div', { key: 'latest', className: 'amr-latest' },
          h('p', null, h('strong', null, '最近决策')),
          ...toastText(view.decision).map((line, index) => h('p', { key: index, className: index ? 'amr-muted' : undefined }, line))),
        h('p', { key: 'policy', className: 'amr-muted' }, view?.policy === 'policy-v2' ? `AUTO · ${view.depth ?? '尚无判断'}；主模型不变，推理投入按请求应用；子任务自动选配。` : 'AUTO 的决定会同步到右侧模型选择；要手动指定 effort，请先切到 MANUAL。'),
        off && h('p', { key: 'disabled', role: 'status', className: 'amr-error' }, `Jev 停用（${off.category}）：${hint}。${new Date(off.at).toLocaleString()}。点击 AUTO 重试。`),
        h('p', { key: 'data', className: 'amr-muted' }, 'AUTO 会把脱敏任务文本发送给设置中所选的决策服务判档。'),
        error && h('p', { key: 'error', role: 'alert', className: 'amr-error' }, error),
      ]
  return h('span', { ref: (el: HTMLSpanElement | null) => { rootRef.current = el; remember() }, className: 'amr-root', onMouseEnter: on('enter'), onMouseLeave: on('leave'), onFocus: on('focus'), onBlur: on('blur') },
    h('style', null, CSS),
    h('button', {
      type: 'button', className: 'amr-trigger', disabled: busy || !view, onClick: () => { if (locked) return; void toggle() },
      'data-disabled': off ? 'true' : undefined, 'data-locked': locked ? 'true' : undefined,
      'aria-disabled': locked ? 'true' : undefined, style: { border: 'none' },
      title: locked ? 'AUTO 仅支持 Claude / GPT 系列模型；悬停查看说明' : off ? `Jev 判档已停用：${hint}。点击 AUTO 重试` : '点击切换自动推理强度',
      'aria-label': locked ? `推理强度模式：${view?.mode ?? 'MANUAL'}（AUTO 不支持当前模型，不可切换）` : `推理强度模式：${view?.mode ?? '加载中'}，点击切换`,
    }, h('span', null, locked ? (view?.mode ?? 'MANUAL') : off ? `${view?.mode} · Jev 停用` : view?.mode ?? '…'), locked ? h(IconInfoOutlineRegular, { size: 14, className: 'amr-icon amr-info' }) : h(SwapIcon)),
    toast && !open && (typeof document === 'undefined'
      ? h('div', { className: 'amr-toast', role: 'status', style: { pointerEvents: 'none' } }, ...toast.lines.map((line, index) => h('div', { key: index, className: index ? 'amr-muted' : undefined }, line)))
      : createPortal(h('div', { className: 'amr-toast', role: 'status', style: { pointerEvents: 'none', left: place.left, top: place.top } },
        h('style', null, CSS), ...toast.lines.map((line, index) => h('div', { key: index, className: index ? 'amr-muted' : undefined }, line))), document.body)),
    open && h('section', { className: 'amr-panel', 'aria-label': '自动路由状态' },
      h('div', { className: 'amr-card' }, ...panel),
    ),
  )
}

const labelUi = { Tooltip, Menu, Icon: IconGaugeOutlineRegular } as unknown as LabelUi

export function apply(ctx: Context): void {
  // Optional acceleration only: the official picker's per-session store triggers an immediate state read.
  // When the service is absent (or appears late) the chip's 3s poll remains the source of truth.
  const pickerSubscriber: { current: SubscribeSelection | undefined } = { current: undefined }
  const subscribeSelection: SubscribeSelection = (id, onChange) => pickerSubscriber.current ? pickerSubscriber.current(id, onChange) : () => {}
  try {
    const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: unknown) => unknown) => unknown }).inject
    if (typeof inject === 'function') {
      inject.call(ctx, ['modelDirectories'], (scope: unknown) => {
        const service = (scope as { modelDirectories?: { directoryFor(id: string): { store: SelectionStore } } }).modelDirectories
        if (!service) return
        pickerSubscriber.current = (id, onChange) => { try { return service.directoryFor(id).store.subscribe(onChange) } catch { return () => {} } }
        return () => { pickerSubscriber.current = undefined }
      })
    }
  } catch { /* polling stays the fallback */ }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'auto-model-routing', order: 300,
    label: () => '自动模型路由',
    inject: () => ({ rpc: ctx.connection.rpc as unknown as Rpc, ui: settingsUi }),
  }, RoutingSettings))
  ctx.effect(() => typeof document === 'undefined' ? () => {} : installRoutingNavIcon(document), 'auto-model-routing: settings navigation icon')
  // Reply-bar tier button, after the official feedback (order 10); rendered only on judged turns.
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'auto-model-routing-label', order: 20,
    inject: (sessionId) => ({ sessionId, rpc: ctx.connection.rpc as unknown as Rpc, ui: labelUi }),
  }, LabelButton as never))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'auto-model-routing', order: chipOrder,
    inject: (sessionId): Props => ({ sessionId, rpc: ctx.connection.rpc as unknown as Rpc, subscribeSelection }),
  }, RoutingChip))
}
