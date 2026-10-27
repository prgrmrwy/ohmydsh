import { createElement as h, forwardRef, type ReactNode } from 'react'
import type { SettingsUi } from '../src/client/settings-ui.js'

const wrap = ({ children, ...props }: { children?: ReactNode }) => h('div', props, children)
export const ui = {
  Menu: ({open,anchor,items,onSelect}:any) => h('span',null,anchor,open&&h('div',{role:'menu'},items.map((item:any)=>h('button',{key:item.id,onClick:()=>onSelect(item.id)},item.label)))),
  SettingsForm: ({ state, labels, onSave, children }: any) => h('div', null, children, h('button', { disabled: !state.dirty || state.invalid || state.saving, onClick: onSave }, labels.save)),
  SettingsSecretField: ({ id, label, hint, text, disabled, onEdit, stateLabel }: any) => h('div', null, h('label', { htmlFor: id }, label), h('span', null, stateLabel), h('input', { id, type: 'password', value: text, disabled, onChange: (e: any) => onEdit(e.target.value) }), h('p', null, hint)),
  SegmentedTabs: ({ items, value, onChange, label, className }: any) => h('div', { className, role: 'tablist', 'aria-label': label }, items.map((item: any) => h('button', { key: item.value, role: 'tab', 'aria-selected': value === item.value, onClick: () => onChange(item.value) }, item.label))),
  SegmentedControl: ({ options, value, onChange, label, disabled, className }: any) => h('div', { className, role: 'group', 'aria-label': label }, options.map((item: any) => h('button', { key: item.value, disabled, 'aria-pressed': value === item.value, onClick: () => onChange(item.value) }, item.label))),
  Switch: ({ checked, onChange, disabled, ...props }: any) => h('button', { role: 'switch', 'aria-checked': checked, disabled, onClick: () => onChange(!checked), ...props }),
  Tag: wrap,
  Tooltip: ({ label, children }: any) => h('span', { 'data-tooltip': label }, children),
  IconInfoOutlineRegular: () => h('svg', { 'data-info-icon': true }),
  IconChevronDownOutlineRegular: () => h('svg'),
  IconChevronLeftOutlineRegular: () => h('svg'),
  IconChevronRightOutlineRegular: () => h('svg'),
  IconCheckOutlineRegular: () => h('svg', { 'data-check': true }),
  MenuSurface: forwardRef<HTMLDivElement, any>((props, ref) => h('div', { ...props, ref })),
  MenuGroup: ({ label, children }: any) => h('section', { role: 'group', 'aria-label': label }, children),
  useAnchoredPosition: () => ({ top: 0, left: 0 }),
  focusWithoutRing: (el: HTMLElement) => el.focus(),
} as unknown as SettingsUi

export const models = [
  { provider: 'claude', model: 'claude-opus-5-5', name: 'Claude Opus', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'claude', model: 'claude-fable-5-1', name: 'Claude Fable', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
  { provider: 'codex', model: 'gpt-6-luna', name: 'GPT Luna', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
  { provider: 'codex', model: 'gpt-6.1-sol', name: 'GPT Sol', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
  { provider: 'codex', model: 'gpt-6-astra', name: 'GPT Astra', reasoningEfforts: ['low', 'medium'] },
]
export const catalog = { models, childAllowlist: { status: 'enabled' as const, allowedModels: models.filter(m => !m.model.includes('fable')).map(({ provider, model }) => ({ provider, model })) } }
export const view = () => ({
  settings: { decisionToast: true, defaultMode: 'MANUAL' as const, effortCap: 'xhigh' as const, jevTimeoutMs: 3000 },
  defaults: { decisionToast: true, defaultMode: 'MANUAL' as const, effortCap: 'xhigh' as const, jevTimeoutMs: 3000 },
  configStatus: 'ok', issues: [], deprecated: [] as string[], key: { configured: true, writable: true, available: true, source: 'store' }, ...catalog,
})
