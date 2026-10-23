import { createElement as h, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AutomaticEffort, RoutingCatalog, RoutingProvider } from '../settings-contract.js'
import { selectableModels, supportedAutomaticEfforts, supportedFamilyEfforts } from '../settings-validation.js'
import type { SettingsUi } from './settings-ui.js'

export interface DraftRoute { model: string; reasoningEffort?: string | undefined }
interface Props {
  ui: SettingsUi; catalog: RoutingCatalog; provider: RoutingProvider; cap: AutomaticEffort
  label: string; value: DraftRoute; onChange: (value: DraftRoute) => void
  mode?: 'child' | 'effort' | 'model'; disabled?: boolean; invalid?: boolean
}
const CSS = `
.amr-picker-trigger{display:flex;align-items:center;gap:6px;max-width:100%;height:28px;box-sizing:border-box;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;text-align:left;cursor:pointer}
.amr-picker-trigger>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.amr-picker-effort{color:var(--dsw-alias-label-secondary);white-space:nowrap}.amr-picker-trigger:disabled{cursor:default;opacity:.55}
.amr-picker-trigger:focus-visible,.amr-picker-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.amr-picker-menu{position:fixed;z-index:1500;width:min(290px,calc(100vw - 24px));max-height:min(380px,70vh);overflow:auto;padding:4px;color:var(--dsw-alias-label-primary);font-size:13px}
.amr-picker-item{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:var(--dsw-radius-sm);background:none;color:inherit;font:inherit;text-align:left;padding:7px 8px;cursor:pointer;overflow-wrap:anywhere}.amr-picker-item:hover,.amr-picker-item:focus{background:var(--dsw-alias-interactive-bg-hover)}.amr-picker-item svg:last-child{margin-left:auto;flex:none}.amr-picker-empty{padding:8px;color:var(--dsw-alias-label-tertiary)}
`

/** A settings-only two-level picker. It never receives a session or model directory. */
export function RoutePicker({ ui, catalog, provider, cap, label, value, onChange, mode = 'child', disabled, invalid }: Props) {
  const [page, setPage] = useState<'root' | 'model' | 'effort' | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const models = selectableModels(catalog, provider, mode === 'model' ? 'main' : 'child')
  const model = catalog.models.find(m => m.provider === provider && m.model === value.model)
  const efforts = mode === 'effort' ? supportedFamilyEfforts(catalog, provider, cap) : model ? supportedAutomaticEfforts(model, cap) : []
  const unavailable = !model || (mode === 'child' && !models.some(m => m.model === value.model))
  const position = ui.useAnchoredPosition({ open: page !== null, anchorRef: trigger, panelRef: panel, gap: 4, margin: 12 })
  const close = () => { setPage(null); if (trigger.current) ui.focusWithoutRing(trigger.current) }
  useEffect(() => {
    if (!page) return
    panel.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close() }
    const tab = (event: globalThis.KeyboardEvent) => { if (event.key === 'Tab') setPage(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', tab)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', tab) }
  }, [page, position !== null])
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopPropagation()
      if (page !== 'root' && mode === 'child') setPage('root'); else close()
      return
    }
    const items = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : undefined
    if (next !== undefined) { event.preventDefault(); items[next]?.focus() }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (document.activeElement as HTMLButtonElement)?.click() }
  }
  const item = (text: string, action: () => void, checked?: boolean) => h('button', {
    key: text, type: 'button', role: checked === undefined ? 'menuitem' : 'menuitemradio', 'aria-checked': checked,
    className: 'amr-picker-item', onClick: action,
  }, text, checked ? h(ui.IconCheckOutlineRegular, { size: 14 }) : null)
  return h('span', null, h('style', null, CSS),
    h('button', { ref: trigger, type: 'button', className: 'amr-picker-trigger', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': page !== null, 'aria-controls': page ? id : undefined,
      disabled: disabled || (mode === 'effort' && efforts.length === 0), onClick: () => page ? close() : setPage(mode === 'child' ? 'root' : mode),
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === 'ArrowDown') { e.preventDefault(); setPage(mode === 'child' ? 'root' : mode) } },
    }, h('span', null, mode === 'effort' ? invalid ? '无效配置' : value.reasoningEffort ?? '默认（随模型）' : `${model?.name ?? (value.model || '请选择模型')}${unavailable ? '（不可用）' : ''}`),
    mode === 'child' && h('span', { className: 'amr-picker-effort' }, value.reasoningEffort ?? '请选择推理等级'), h(ui.IconChevronDownOutlineRegular, { size: 12 })),
    page && createPortal(h(ui.MenuSurface, { ref: panel, id, role: 'menu', 'aria-label': label, className: 'amr-picker-menu', style: { ...position, visibility: position ? undefined : 'hidden' }, onKeyDown: keyboard },
      h('style', null, CSS), h(ui.MenuGroup, { label: page === 'root' ? '子会话推荐' : page === 'model' ? '模型' : '推理等级' },
        page !== 'root' && mode === 'child' && item('返回', () => setPage('root')),
        ...(page === 'root' ? [item('模型', () => setPage('model')), item('推理等级', () => setPage('effort'))]
          : page === 'model' ? models.map(m => item(m.name, () => {
            const keep = supportedAutomaticEfforts(m, cap).includes(value.reasoningEffort as AutomaticEffort)
            onChange({ model: m.model, reasoningEffort: keep ? value.reasoningEffort : undefined }); close()
          }, m.model === value.model))
            : efforts.map(e => item(e, () => { onChange({ ...value, reasoningEffort: e }); close() }, e === value.reasoningEffort))),
        ((page === 'model' && !models.length) || (page === 'effort' && !efforts.length)) && h('p', { className: 'amr-picker-empty' }, '无可用选项，请检查模型支持与推理强度上限'),
      )), document.body))
}
