import { createElement as h, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { callRouting, chipOrder, type Rpc } from './control.js'

interface View {
  mode: 'AUTO' | 'MANUAL'
  anchor?: { provider: string; model: string; reasoningEffort?: string; provenance: string }
  effort?: string
  reason?: string
  restore: boolean
  history: readonly { effort?: string; reason: string }[]
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
  return h('span', { style: { position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center' } },
    h('button', { type: 'button', disabled: busy || !view, onClick: () => { void toggle() }, title: '自动调整主会话推理强度；点击切换模式', style: { color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: 8, padding: '3px 7px', cursor: 'pointer', fontSize: 11 } }, view?.mode ?? '…'),
    h('button', { type: 'button', onClick: () => setOpen(!open), title: '查看路由状态', style: { color: 'inherit', border: 0, background: 'transparent', cursor: 'pointer' } }, '▾'),
    open && h('section', { 'aria-label': '自动路由状态', style: { position: 'absolute', zIndex: 20, bottom: 'calc(100% + 8px)', left: 0, width: 300, padding: 12, borderRadius: 10, background: 'var(--dsw-alias-bg, #fff)', color: 'var(--dsw-alias-label-primary, #222)', boxShadow: '0 4px 20px #0003', fontSize: 12 } },
      h('strong', null, '主会话推理强度'),
      h('p', null, view?.anchor ? `${view.anchor.provider} / ${view.anchor.model} · ${view.anchor.reasoningEffort ?? '默认'} (${view.anchor.provenance})` : '锚点待首个请求初始化'),
      h('p', null, `本回合：${view?.effort ?? '官方默认'} · ${view?.reason ?? '尚无决定'}`),
      view?.restore && h('p', null, '正在复原：等待请求及官方配置收敛。'),
      h('p', null, '停用前先切 MANUAL，并等待复原完成。子会话选模由 skill 指导。'),
      error && h('p', { role: 'alert' }, error),
      h('ol', { style: { maxHeight: 160, overflow: 'auto', paddingLeft: 18 } }, ...(view?.history ?? []).map((row, index) => h('li', { key: index }, `${row.effort ?? '默认'} · ${row.reason}`))),
    ),
  )
}

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'auto-model-routing', order: chipOrder,
    inject: (sessionId): Props => ({ sessionId, rpc: ctx.connection.rpc as unknown as Rpc }),
  }, RoutingChip))
}
