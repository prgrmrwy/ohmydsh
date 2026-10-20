import { createElement as h, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { callRouting, chipOrder, type Rpc } from './control.js'
import { CATEGORY_HINTS, type JevCategory } from '../jev.js'

interface View {
  mode: 'AUTO' | 'MANUAL'
  anchor?: { provider: string; model: string; reasoningEffort?: string; provenance: string }
  effort?: string
  reason?: string
  restore: boolean
  disabled?: { category: JevCategory; at: number }
  history: readonly { effort?: string; reason: string; category?: string }[]
}
interface Props { sessionId: string; rpc: Rpc }
export const name = 'dsh-auto-model-routing/client'
export const inject = ['slots', 'connection']

export function RoutingChip({ sessionId, rpc, initialView, initiallyOpen = false }: Props & { initialView?: View; initiallyOpen?: boolean }) {
  const [view, setView] = useState<View | undefined>(initialView)
  const [open, setOpen] = useState(initiallyOpen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => { void callRouting(rpc, sessionId).then(value => { if (active) { setView(value as View); setError('') } }, reason => { if (active) setError(String(reason)) }) }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [rpc, sessionId])
  const toggle = async () => {
    if (busy || !view) return
    setBusy(true)
    try { setView(await callRouting(rpc, sessionId, view.mode === 'AUTO' ? 'MANUAL' : 'AUTO') as View); setError('') }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const off = view?.disabled
  const hint = off ? CATEGORY_HINTS[off.category] ?? off.category : undefined
  return h('span', { style: { position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center' } },
    h('button', {
      type: 'button', disabled: busy || !view, onClick: () => { void toggle() },
      'data-disabled': off ? 'true' : undefined,
      title: off ? `Jev 判档已停用：${hint}。点击 AUTO 重试` : '自动调整主会话推理强度；点击切换模式',
      style: { color: off ? '#b42318' : 'inherit', background: off ? '#fef3f2' : 'transparent', border: `1px solid ${off ? '#b42318' : 'currentColor'}`, borderRadius: 8, padding: '3px 7px', cursor: 'pointer', fontSize: 11 },
    }, off ? `${view?.mode} · Jev 停用` : view?.mode ?? '…'),
    h('button', { type: 'button', onClick: () => setOpen(!open), title: '查看路由状态', style: { color: 'inherit', border: 0, background: 'transparent', cursor: 'pointer' } }, '▾'),
    open && h('section', { 'aria-label': '自动路由状态', style: { position: 'absolute', zIndex: 20, bottom: 'calc(100% + 8px)', left: 0, width: 300, padding: 12, borderRadius: 10, background: 'var(--dsw-alias-bg, #fff)', color: 'var(--dsw-alias-label-primary, #222)', boxShadow: '0 4px 20px #0003', fontSize: 12 } },
      h('strong', null, '主会话推理强度'),
      h('p', null, view?.anchor ? `${view.anchor.provider} / ${view.anchor.model} · ${view.anchor.reasoningEffort ?? '默认'} (${view.anchor.provenance})` : '锚点待首个请求初始化'),
      h('p', null, `本回合：${view?.effort ?? '官方默认'} · ${view?.reason ?? '尚无决定'}`),
      off && h('p', { role: 'status', style: { color: '#b42318' } }, `Jev 停用（${off.category}）：${hint}。${new Date(off.at).toLocaleString()}。点击 AUTO 重试。`),
      view?.restore && h('p', null, '正在复原：等待请求及官方配置收敛。'),
      h('p', null, 'AUTO 会把任务文本发送给 OpenRouter/TypeSafe 判档。停用插件前先切 MANUAL，并等待复原完成。'),
      error && h('p', { role: 'alert' }, error),
      h('ol', { style: { maxHeight: 160, overflow: 'auto', paddingLeft: 18 } }, ...(view?.history ?? []).map((row, index) => h('li', { key: index }, `${row.effort ?? '默认'} · ${row.reason}${row.category ? ` · ${row.category}` : ''}`))),
    ),
  )
}

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'auto-model-routing', order: chipOrder,
    inject: (sessionId): Props => ({ sessionId, rpc: ctx.connection.rpc as unknown as Rpc }),
  }, RoutingChip))
}
