import { createElement as h, useEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react'
import type { Rpc } from './control.js'

type Tier = 'simple' | 'standard' | 'complex' | 'escalated'
interface Labelled { tier: Tier; effort?: string; label?: Tier }
const TIERS: readonly Tier[] = ['simple', 'standard', 'complex', 'escalated']
const NAMES: Readonly<Record<Tier, string>> = { simple: '简单', standard: '标准', complex: '复杂', escalated: '升级' }

/** Official primitives, injected so the component carries no styles of its own (tests pass doubles). */
export interface LabelUi {
  Tooltip: ComponentType<{ label: string; side?: 'bottom'; children: ReactElement }>
  Menu: ComponentType<{ open: boolean; anchor: ReactNode; items: readonly MenuEntry[]; onSelect: (id: string) => void; onClose?: () => void; selectedId?: string; side?: 'top' | 'bottom'; portal?: boolean }>
  Icon: ComponentType
}
/** Same look as the official reply-bar buttons (copy, branch, feedback): values from dsh-client-ui-chat's action class. */
type MenuEntry = { id: string; label: string } | { type: 'label'; id: string; text: string }
const CSS = `.amr-label-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}.amr-label-action svg{width:calc(17px + var(--dsh-content-font-delta,0px));height:calc(17px + var(--dsh-content-font-delta,0px))}.amr-label-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}`

async function callLabel(rpc: Rpc, sessionId: string, messageId: string, label?: Tier): Promise<Labelled | Record<string, never>> {
  const result = await rpc.call('/api', 'auto-model-routing.label', { sessionId, messageId, ...(label ? { label } : {}) })
  if (!result.ok) throw new Error(result.error?.message ?? '标注请求失败')
  return result.value as Labelled | Record<string, never>
}

export function tooltipText(view: Labelled): string {
  return `AUTO 判档：${NAMES[view.tier]}${view.effort ? ` → ${view.effort}` : ''}${view.label ? ` · 你标注：${NAMES[view.label]}` : ''}`
}

/** Reply-bar tier button (design D13): shown only for replies of a judged turn; selecting a tier records a label. */
export function LabelButton({ sessionId, messageId, rpc, ui }: { sessionId: string; messageId: string; rpc: Rpc; ui: LabelUi }) {
  const [view, setView] = useState<Labelled | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    let active = true
    setView(undefined)
    // One query per message; `{}` (or an error) renders nothing.
    callLabel(rpc, sessionId, messageId).then(value => { if (active && 'tier' in value) setView(value as Labelled) }, () => {})
    return () => { active = false }
  }, [rpc, sessionId, messageId])
  if (!view) return null
  const choose = (label: Tier) => {
    setOpen(false)
    // A failure leaves the shown label unchanged.
    callLabel(rpc, sessionId, messageId, label).then(value => { if (alive.current && 'tier' in value) setView(value as Labelled) }, () => {})
  }
  const button = h('button', { type: 'button', className: 'amr-label-action', 'aria-label': tooltipText(view), onClick: () => setOpen(value => !value) }, h(ui.Icon))
  return h('span', null,
    h('style', null, CSS),
    h(ui.Menu, {
      open, side: 'top', portal: true, onClose: () => setOpen(false),
      // The official menu draws the check on the selected (labelled) row.
      ...(view.label ? { selectedId: view.label } : {}),
      items: [{ type: 'label', id: 'title', text: '这轮应该用哪档？' }, ...TIERS.map(tier => ({ id: tier, label: `${NAMES[tier]}${tier === view.tier ? ' · Jev' : ''}` }))],
      onSelect: id => { if (TIERS.includes(id as Tier)) choose(id as Tier) },
      anchor: h(ui.Tooltip, { label: tooltipText(view), side: 'bottom', children: button }),
    }),
  )
}
