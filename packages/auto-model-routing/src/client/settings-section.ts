import { createElement as h, useEffect, useState } from 'react'
import type { Rpc } from './control.js'
import { AUTO_EFFORTS, PROVIDERS, type AutomaticEffort, type RoutingCatalog, type RoutingProvider, type Settings, type SettingsIssue, type SettingsPatch } from '../settings-contract.js'
import { selectableModels, supportedFamilyEfforts, validateChildRoute, validateFamilyMainEffort } from '../settings-validation.js'
import { CHILD_MODELS, mapEffort, tiers, type Effort, type Tier } from '../effort.js'
import { RoutePicker, type DraftRoute } from './route-picker.js'
import type { SettingsUi } from './settings-ui.js'

export interface SettingsView extends RoutingCatalog {
  settings: Settings; defaults: Settings; configStatus: string; issues: SettingsIssue[]
  key: { configured: boolean; source?: string; writable: boolean; available: boolean }
  criteria: Record<Tier, string>
}
const CSS = `
.amr-settings{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);min-width:0;container-type:inline-size}.amr-settings-section{padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.amr-settings h3{font-size:13px;font-weight:600;margin:0 0 12px}.amr-settings p{margin:6px 0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.amr-settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:14px 0}.amr-settings-row>div:first-child{min-width:0}.amr-settings-number{width:76px;text-align:right;font:inherit;font-variant-numeric:tabular-nums;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:inherit;background:var(--dsw-alias-bg-layer-1);padding:6px}.amr-settings-number:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}
.amr-settings-table{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);margin:12px 0;min-width:0}.amr-settings-tier,.amr-settings-head{display:grid;grid-template-columns:minmax(85px,.65fr) minmax(0,1fr) minmax(0,1.5fr);gap:10px;padding:12px;align-items:start}.amr-settings-tier,.amr-settings-head{border-bottom:.5px solid var(--dsw-alias-border-l2)}.amr-settings-tier:last-child{border-bottom:0}.amr-settings-head{color:var(--dsw-alias-label-secondary)}.amr-settings-tier-name{display:flex;align-items:center;gap:4px;min-height:30px}.amr-settings-info,.amr-settings-reset{border:0;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;padding:2px}.amr-settings-info{display:inline-flex}.amr-settings-reset{font-size:12px;margin-top:4px}.amr-settings-reset:hover{color:var(--dsw-alias-label-primary)}.amr-settings-info:focus-visible,.amr-settings-reset:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}.amr-settings .amr-settings-error{color:var(--dsw-alias-state-error-primary)}.amr-settings-cell{min-width:0}.amr-settings-cell-label{display:none}.amr-settings .amr-settings-segments{display:inline-grid;flex:none;width:max-content;max-width:100%;height:28px;box-sizing:border-box;gap:2px;padding:2px;border-radius:var(--dsw-radius-md)}.amr-settings .amr-settings-segments>button{height:24px;min-width:44px;padding:0 8px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:20px}.amr-settings .amr-settings-segments>[aria-hidden=true]{top:2px;bottom:2px;left:2px;height:calc(100% - 4px);width:calc((100% - 4px - 2px * (var(--dsh-segment-count) - 1)) / var(--dsh-segment-count))}.amr-settings .amr-settings-tabs{--dsh-segment-count:2}.amr-settings .amr-settings-tabs>[aria-hidden=true]{width:calc((100% - 6px) / 2)!important;transform:translateX(calc(var(--amr-tab-index,0) * (100% + 2px)))!important}.amr-settings .amr-settings-tabs:has([aria-selected=true]:last-child){--amr-tab-index:1}
@container(max-width:480px){.amr-settings-head{display:none}.amr-settings-tier{grid-template-columns:1fr;gap:8px}.amr-settings-cell{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(0,1fr);align-items:center;gap:8px}.amr-settings-cell-label{display:block;color:var(--dsw-alias-label-secondary)}.amr-settings-cell p,.amr-settings-reset{grid-column:2}.amr-settings-row{flex-wrap:wrap}}
`
async function request(rpc: Rpc, action: string, payload: unknown = {}): Promise<SettingsView> {
  const response = await rpc.call('/api', `auto-model-routing.${action}`, payload)
  if (!response.ok) throw Object.assign(new Error(action === 'setKey' ? 'API key 未保存' : '设置未保存，请检查字段错误并重试'), { issues: (response.error as { details?: { issues?: SettingsIssue[] } } | undefined)?.details?.issues ?? [] })
  const value = response.value as SettingsView & { error?: string; issues?: SettingsIssue[] }
  if (value?.error) throw Object.assign(new Error(action === 'setKey' ? 'API key 未保存' : '设置未保存，请检查字段错误并重试'), { issues: value.issues })
  return value
}
const has = (object: object | undefined, key: string) => !!object && Object.hasOwn(object, key)

/** Settings drafts are independent from the official session model selection. */
export function RoutingSettings({ rpc, ui }: { rpc: Rpc; ui: SettingsUi }) {
  const [view, setView] = useState<SettingsView>()
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [childDrafts, setChildDrafts] = useState<Record<string, DraftRoute>>({})
  const [provider, setProvider] = useState<RoutingProvider>('claude')
  const [key, setKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [saveIssues, setSaveIssues] = useState<SettingsIssue[]>([])
  useEffect(() => {
    let live = true
    void request(rpc, 'settings').then(value => { if (live) setView(value) }, () => { if (live) setMessage('无法读取设置，请重新打开此页面') })
    return () => { live = false }
  }, [rpc])
  if (!view) return h('div', { className: 'amr-settings', role: 'status' }, message || '正在读取设置…')
  const settings = { ...view.settings, ...patch }
  const cap = settings.effortCap
  const invalidFamily = (p: RoutingProvider) => {
    const family = view.settings.mainEfforts?.[p]
    return family !== undefined && (!family || typeof family !== 'object' || Array.isArray(family) || Object.keys(family).some(key => !tiers.includes(key as Tier)))
  }
  const familyUnresolved = (p: RoutingProvider) => invalidFamily(p) && !has(patch.mainEfforts, p)
  const mainValue = (p: RoutingProvider, tier: Tier) => {
    const cells = patch.mainEfforts?.[p]
    if (has(patch.mainEfforts, p) && (cells === null || invalidFamily(p))) return cells?.[tier] ?? undefined
    return has(cells ?? undefined, tier) ? cells![tier] ?? undefined : view.settings.mainEfforts?.[p]?.[tier]
  }
  const childValue = (p: RoutingProvider, tier: Tier): DraftRoute => {
    if (childDrafts[`${p}.${tier}`]) return childDrafts[`${p}.${tier}`]!
    const cells = patch.childRoutes?.[p]
    const explicit = has(cells, tier) ? cells![tier] ?? undefined : view.settings.childRoutes?.[p]?.[tier]
    if (explicit) return {
      model: typeof explicit.model === 'string' ? explicit.model : '无效配置',
      reasoningEffort: typeof explicit.reasoningEffort === 'string' ? explicit.reasoningEffort : undefined,
    }
    const model = CHILD_MODELS[p][tiers.indexOf(tier)]!
    const info = view.models.find(m => m.provider === p && m.model === model)
    return { model, reasoningEffort: info ? mapEffort(model, tier, info.reasoningEfforts as Effort[], cap) : undefined }
  }
  const mainExplicit = (p: RoutingProvider, tier: Tier) => mainValue(p, tier) !== undefined
  const childExplicit = (p: RoutingProvider, tier: Tier) => !!childDrafts[`${p}.${tier}`] || (has(patch.childRoutes?.[p], tier) ? patch.childRoutes![p]![tier] !== null : !!view.settings.childRoutes?.[p]?.[tier])
  const changed = (field: string) => Object.hasOwn(patch, field)
  const capChanged = changed('effortCap') && cap !== view.settings.effortCap
  const conflicts: SettingsIssue[] = []
  for (const p of PROVIDERS.map(p => p.id)) {
    for (const tier of tiers) {
      const value = mainValue(p, tier)
      if (value !== undefined && (capChanged || has(patch.mainEfforts?.[p] ?? undefined, tier))) conflicts.push(...validateFamilyMainEffort(view, p, value, cap, `mainEfforts.${p}.${tier}`))
    }
    if (capChanged && familyUnresolved(p)) conflicts.push({ path: `mainEfforts.${p}`, code: 'invalid', message: '主会话映射格式无效，请恢复该体系默认值或重新配置' })
    for (const tier of tiers) if (childExplicit(p, tier) && (capChanged || has(patch.childRoutes?.[p], tier) || !!childDrafts[`${p}.${tier}`])) {
      conflicts.push(...validateChildRoute(view, p, childValue(p, tier), cap, `childRoutes.${p}.${tier}`))
    }
  }
  const invalidTimeout = !Number.isInteger(settings.jevTimeoutMs) || settings.jevTimeoutMs < 1000 || settings.jevTimeoutMs > 4500
  const invalidKey = key.length > 512 || /\s/.test(key)
  const dirty = Object.keys(patch).length > 0 || key.length > 0 || removeKey
  const setMain = (tier: Tier, effort: AutomaticEffort | null) => setPatch(old => ({ ...old, mainEfforts: { ...old.mainEfforts, [provider]: { ...(old.mainEfforts?.[provider] === null ? Object.fromEntries(tiers.map(tier => [tier, null])) : old.mainEfforts?.[provider]), [tier]: effort } } }))
  const setChild = (tier: Tier, route: DraftRoute | null) => {
    setChildDrafts(old => { const next = { ...old }; if (route) next[`${provider}.${tier}`] = route; else delete next[`${provider}.${tier}`]; return next })
    setPatch(old => ({ ...old, childRoutes: { ...old.childRoutes, [provider]: { ...old.childRoutes?.[provider], [tier]: route === null ? null : { model: route.model, reasoningEffort: route.reasoningEffort as AutomaticEffort } } } }))
  }
  const save = async () => {
    if (saving) return
    setSaving(true); setFailed(false); setSaveIssues([])
    const results: string[] = []
    let nextView = view
    if (key || removeKey) {
      try {
        const response = await request(rpc, 'setKey', { value: removeKey ? null : key })
        if (response?.key) nextView = { ...nextView, key: response.key }
        setKey(''); setRemoveKey(false); results.push('API key 已保存')
      } catch { results.push('API key 未保存'); setFailed(true) }
    }
    if (Object.keys(patch).length) {
      try { nextView = await request(rpc, 'saveSettings', patch); setPatch({}); setChildDrafts({}); results.push('设置已保存') }
      catch (error) { results.push('设置未保存'); setFailed(true); setSaveIssues((error as { issues?: SettingsIssue[] }).issues ?? []) }
    }
    setView(nextView); setMessage(results.join('；')); setSaving(false)
  }
  const issueText = (path: string) => [...conflicts, ...saveIssues, ...view.issues].filter(issue => issue.path === path).map(issue => issue.message).join('；')
  const cell = (label: string, control: ReturnType<typeof h>, overridden: boolean, reset: () => void, issue: string) => h('div', { className: 'amr-settings-cell' }, h('span', { className: 'amr-settings-cell-label' }, label), control,
    overridden && h('button', { className: 'amr-settings-reset', type: 'button', disabled: saving, onClick: reset, 'aria-label': `${label}恢复默认` }, '恢复默认'), issue && h('p', { className: 'amr-settings-error', role: 'status' }, issue))
  const keyState = !view.key.available ? '不可用' : !view.key.writable ? '来自启动环境' : view.key.configured ? '已配置' : '未配置'
  const keyHint = !view.key.available ? 'DSH 凭据服务不可用。' : !view.key.writable ? '先自行保留现有 key，从启动环境（如 .env.local）删除 OPENROUTER_API_KEY 并重启，再在这里保存。' : view.key.configured ? '保存在 DSH 凭据存储，不写入设置文件；留空表示保持当前 key。' : '未配置时 AUTO 判档会停用；保存 key 后不会自动重启已停用的会话。'
  return h('div', { className: 'amr-settings' }, h('style', null, CSS), h(ui.SettingsForm, {
    labels: { unavailable: '无法读取设置', readOnly: '设置只读', saveFailed: '部分更改未保存，请检查提示', save: '保存', saving: '保存中…' },
    state: { available: true, writable: true, dirty, invalid: conflicts.length > 0 || invalidTimeout || invalidKey, saving, failed }, onSave: () => { void save() }, onDiscard: () => {},
    children: h('fieldset', { disabled: saving, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
      view.configStatus === 'invalid' && h('p', { role: 'status' }, '设置文件无法解析或含无效字段，已按可解析值与默认值显示；保存会覆盖损坏部分'),
      message && h('p', { role: 'status', className: failed ? 'amr-settings-error' : undefined }, message),
      h('section', { className: 'amr-settings-section' }, h('h3', null, '判档服务'), h('p', null, 'AUTO 时每个用户回合请 Jev（经 OpenRouter）判断任务难度。'),
        h(ui.SettingsSecretField, { id: 'amr-key', label: 'OpenRouter API Key', hint: keyHint, text: key, disabled: saving || !view.key.available || !view.key.writable, onEdit: text => { setKey(text); setRemoveKey(false) }, configured: view.key.configured, stateLabel: keyState }),
        view.key.available && view.key.writable && view.key.configured && h('button', { type: 'button', className: 'amr-settings-reset', onClick: () => { setRemoveKey(!removeKey); setKey('') } }, removeKey ? '取消删除 key' : '删除 key'),
        invalidKey && h('p', { className: 'amr-settings-error' }, 'API key 不能含空白，且不能超过 512 字符'),
        h('div', { className: 'amr-settings-row' }, h('div', null, h('label', { htmlFor: 'amr-timeout' }, '判档等待上限'), h('p', null, '1000–4500 毫秒；超时后该会话停用 AUTO。')), h('span', null, h('input', { id: 'amr-timeout', type: 'number', className: 'amr-settings-number', min: 1000, max: 4500, step: 1, value: Number.isNaN(settings.jevTimeoutMs) ? '' : settings.jevTimeoutMs, 'aria-invalid': invalidTimeout, onChange: e => setPatch(old => ({ ...old, jevTimeoutMs: e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value) })) }), ' 毫秒'))),
      h('section', { className: 'amr-settings-section' }, h('h3', null, '会话'),
        h('div', { className: 'amr-settings-row' }, h('div', null, '新会话默认模式', h('p', null, settings.defaultMode === 'AUTO' ? '仅影响新会话；每个用户回合都会把消息发送给 OpenRouter/TypeSafe 请求 Jev。' : '仅影响新会话，不改变已有会话。')), h(ui.SegmentedControl, { id: 'amr-default-mode', className: 'amr-settings-segments', label: '新会话默认模式', value: settings.defaultMode, options: [{ value: 'MANUAL', label: 'MANUAL' }, { value: 'AUTO', label: 'AUTO' }], onChange: value => setPatch(old => ({ ...old, defaultMode: value as Settings['defaultMode'] })) })),
        h('div', { className: 'amr-settings-row' }, h('span', null, '判档提示'), h(ui.Switch, { checked: settings.decisionToast, label: '判档提示', onChange: value => setPatch(old => ({ ...old, decisionToast: value })) })),
        h('div', { className: 'amr-settings-row' }, h('span', null, '推理强度上限'), h(ui.SegmentedControl, { id: 'amr-cap', className: 'amr-settings-segments', label: '推理强度上限', value: cap, options: AUTO_EFFORTS.map(value => ({ value, label: value })), onChange: value => setPatch(old => ({ ...old, effortCap: value as AutomaticEffort })) }))),
      h('section', { className: 'amr-settings-section' }, h('h3', null, '路由映射'),
        h(ui.SegmentedTabs, { className: 'amr-settings-segments amr-settings-tabs', label: '模型体系', value: provider, items: [{ value: 'claude', label: 'Claude', id: 'amr-tab-claude', panelId: 'amr-panel-claude' }, { value: 'codex', label: 'GPT', id: 'amr-tab-codex', panelId: 'amr-panel-codex' }], onChange: value => setProvider(value as RoutingProvider) }),
        h('div', { role: 'tabpanel', id: `amr-panel-${provider}`, 'aria-labelledby': `amr-tab-${provider}` },
          h('p', null, '主会话推理等级适用于本体系所有模型；默认随实际模型计算。可选覆盖值为当前体系模型共同支持且不超过上限的等级。'),
          !supportedFamilyEfforts(view, provider, cap).length && h('p', { role: 'status' }, '当前体系没有共同支持且不超过上限的推理等级；主会话覆盖暂不可选，可恢复默认。'),
          familyUnresolved(provider) && h('p', { className: 'amr-settings-error', role: 'status' }, '主会话映射格式无效（含旧版按模型配置），不会按默认值执行。请重新配置或', h('button', { type: 'button', className: 'amr-settings-reset', onClick: () => setPatch(old => ({ ...old, mainEfforts: { ...old.mainEfforts, [provider]: null } })) }, '恢复本体系默认值')),
          h('p', null, '主会话保留当前模型，只调 effort；子会话在 route_subagent 判档后返回推荐 model + effort，不改既有子会话、不决定是否派发。'),
          view.childAllowlist.status !== 'enabled' || !selectableModels(view, provider, 'child').length ? h('p', { role: 'status' }, view.childAllowlist.status === 'unavailable' ? '无法读取子智能体允许列表；请检查官方子智能体设置。' : '请在官方子智能体设置启用并配置允许列表。') : null,
          h('div', { className: 'amr-settings-table' }, h('div', { className: 'amr-settings-head', 'aria-hidden': true }, h('span', null, '档位'), h('span', null, '主会话推理等级'), h('span', null, '子会话推荐')),
            ...tiers.map(tier => {
              const effort = mainValue(provider, tier)
              return h('div', { key: tier, className: 'amr-settings-tier', 'data-tier': tier }, h('div', { className: 'amr-settings-tier-name' }, tier, h(ui.Tooltip, { label: view.criteria[tier], side: 'top', portal: true, children: h('button', { type: 'button', className: 'amr-settings-info', 'aria-label': `${tier} 判档标准`, onFocus: () => {} }, h(ui.IconInfoOutlineRegular, { size: 14 })) })),
                cell('主会话推理等级', h(RoutePicker, { ui, catalog: view, provider, cap, mode: 'effort', label: `${tier} 主会话推理等级`, value: { model: '', reasoningEffort: effort === undefined ? undefined : typeof effort === 'string' ? effort : '无效配置' }, invalid: familyUnresolved(provider), disabled: saving, onChange: value => setMain(tier, value.reasoningEffort as AutomaticEffort) }), mainExplicit(provider, tier), () => setMain(tier, null), issueText(`mainEfforts.${provider}.${tier}`)),
                cell('子会话推荐', h(RoutePicker, { ui, catalog: view, provider, cap, label: `${tier} 子会话推荐`, value: childValue(provider, tier), disabled: saving || !selectableModels(view, provider, 'child').length, onChange: value => setChild(tier, value) }), childExplicit(provider, tier), () => setChild(tier, null), issueText(`childRoutes.${provider}.${tier}`)))
            })), h('p', null, '官方允许列表是会话创建时的快照；已有会话仍可能拒绝新配置的推荐。'))),
      ...conflicts.filter(issue => !issue.path.startsWith(`childRoutes.${provider}.`) && !issue.path.startsWith(`mainEfforts.${provider}.`)).map(issue => h('p', { key: issue.path, role: 'status', className: 'amr-settings-error' }, `${issue.path}：${issue.message}`)),
    ),
  }))
}
