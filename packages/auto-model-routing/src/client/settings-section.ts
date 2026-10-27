import { createElement as h, useEffect, useState } from 'react'
import type { Rpc } from './control.js'
import { AUTO_EFFORTS, type AutomaticEffort, type RoutingCatalog, type Settings, type SettingsIssue, type SettingsPatch } from '../settings-contract.js'
import type { SettingsUi } from './settings-ui.js'
import { DECISION_SERVICES, resolveDecisionService, type DecisionProvider } from '../decision-service.js'
import { CATEGORY_HINTS, type JevCategory } from '../hints.js'
import { StrategyDetails } from './strategy-details.js'

export interface SettingsView extends RoutingCatalog {
  settings: Settings; defaults: Settings; configStatus: string; issues: SettingsIssue[]
  key: { configured: boolean; source?: string; writable: boolean; available: boolean }
  /** Retired mapping keys still present in the settings file. */
  deprecated?: string[]
}
const CSS = `
.amr-settings{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);min-width:0;container-type:inline-size}.amr-settings-section{padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.amr-settings h3{font-size:13px;font-weight:600;margin:0 0 12px}.amr-settings p{margin:6px 0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.amr-settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:14px 0}.amr-settings-row>div:first-child{min-width:0}.amr-settings-number{width:76px;text-align:right;font:inherit;font-variant-numeric:tabular-nums;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:inherit;background:var(--dsw-alias-bg-layer-1);padding:6px}.amr-settings-number:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}
.amr-settings-info,.amr-settings-reset{border:0;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;padding:2px}.amr-settings-info{display:inline-flex}.amr-settings-reset{font-size:12px;margin-top:4px}.amr-settings-reset:hover{color:var(--dsw-alias-label-primary)}.amr-settings-info:focus-visible,.amr-settings-reset:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}.amr-settings .amr-settings-error{color:var(--dsw-alias-state-error-primary)}.amr-settings .amr-settings-segments{display:inline-grid;flex:none;width:max-content;max-width:100%;height:28px;box-sizing:border-box;gap:2px;padding:2px;border-radius:var(--dsw-radius-md)}.amr-settings .amr-settings-segments>button{height:24px;min-width:44px;padding:0 8px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:20px}.amr-settings .amr-settings-segments>[aria-hidden=true]{top:2px;bottom:2px;left:2px;height:calc(100% - 4px);width:calc((100% - 4px - 2px * (var(--dsh-segment-count) - 1)) / var(--dsh-segment-count))}
.amr-test-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:12px 0 6px}.amr-test-row>span{font-size:12px;color:var(--dsw-alias-label-secondary)}.amr-test-button{height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.amr-test-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.amr-test-button:disabled{opacity:.5;cursor:not-allowed}.amr-test-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.amr-service-trigger,.amr-service-input{box-sizing:border-box;min-width:0;width:240px;max-width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.amr-service-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;text-align:left}.amr-service-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.amr-service-trigger svg{color:var(--dsw-alias-label-tertiary);flex:none}.amr-service-trigger:focus-visible,.amr-service-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
@container(max-width:480px){.amr-settings-row{flex-wrap:wrap}}
`
async function request(rpc: Rpc, action: string, payload: unknown = {}): Promise<SettingsView> {
  const response = await rpc.call('/api', `auto-model-routing.${action}`, payload)
  if (!response.ok) throw Object.assign(new Error(action === 'setKey' ? 'API key 未保存' : '设置未保存，请检查字段错误并重试'), { issues: (response.error as { details?: { issues?: SettingsIssue[] } } | undefined)?.details?.issues ?? [] })
  const value = response.value as SettingsView & { error?: string; issues?: SettingsIssue[] }
  if (value?.error) throw Object.assign(new Error(action === 'setKey' ? 'API key 未保存' : '设置未保存，请检查字段错误并重试'), { issues: value.issues })
  return value
}
/** Settings drafts are independent from the official session model selection. */
export function RoutingSettings({ rpc, ui }: { rpc: Rpc; ui: SettingsUi }) {
  const [view, setView] = useState<SettingsView>()
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [serviceMenu, setServiceMenu] = useState(false)
  const [modelMenu, setModelMenu] = useState(false)
  const [key, setKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ text: string; failed: boolean }>()
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
  const serviceConfig = settings.decisionService ?? { provider: 'openrouter' as const }
  const serviceProvider = serviceConfig.provider
  const decisionModel = serviceConfig.model ?? DECISION_SERVICES[serviceProvider].model
  // Preset choices are documented snapshots, not a live availability claim.
  const decisionModels = [...new Set([...(serviceProvider === 'openrouter' ? ['typesafe/jev-1.13'] : ['jev-1.13.0', 'jev-1.14.0']), decisionModel])]
  const changingService = serviceProvider !== (view.settings.decisionService?.provider ?? 'openrouter')
  let invalidService = false
  try { resolveDecisionService(serviceConfig) } catch { invalidService = true }
  const conflicts: SettingsIssue[] = []
  const invalidTimeout = !Number.isInteger(settings.jevTimeoutMs) || settings.jevTimeoutMs < 1000 || settings.jevTimeoutMs > 4500
  const invalidKey = key.length > 512 || /\s/.test(key)
  const dirty = Object.keys(patch).length > 0 || key.length > 0 || removeKey
  const save = async () => {
    if (saving) return
    setSaving(true); setFailed(false); setSaveIssues([])
    const results: string[] = []
    let nextView = view
    if (key || removeKey) {
      try {
        const response = await request(rpc, 'setKey', { value: removeKey ? null : key, ...(serviceProvider !== 'openrouter' ? { provider: serviceProvider } : {}) })
        if (response?.key) nextView = { ...nextView, key: response.key }
        setKey(''); setRemoveKey(false); results.push('API key 已保存')
      } catch { results.push('API key 未保存'); setFailed(true) }
    }
    if (Object.keys(patch).length) {
      try { nextView = await request(rpc, 'saveSettings', patch); setPatch({}); results.push('设置已保存') }
      catch (error) { results.push('设置未保存'); setFailed(true); setSaveIssues((error as { issues?: SettingsIssue[] }).issues ?? []) }
    }
    setView(nextView); setMessage(results.join('；')); setSaving(false)
  }
  const keyState = !view.key.available ? '不可用' : !view.key.writable ? '来自启动环境' : view.key.configured ? '已配置' : '未配置'
  const keyHint = !view.key.available ? 'DSH 凭据服务不可用。' : !view.key.writable ? '先自行保留现有 key，从启动环境（如 .env.local）删除 OPENROUTER_API_KEY 并重启，再在这里保存。' : view.key.configured ? '保存在 DSH 凭据存储，不写入设置文件；留空表示保持当前 key。' : '未配置时 AUTO 判档会停用；保存 key 后不会自动重启已停用的会话。'
  return h('div', { className: 'amr-settings' }, h('style', null, CSS), h(ui.SettingsForm, {
    labels: { unavailable: '无法读取设置', readOnly: '设置只读', saveFailed: '部分更改未保存，请检查提示', save: '保存', saving: '保存中…' },
    state: { available: true, writable: true, dirty, invalid: conflicts.length > 0 || invalidTimeout || invalidKey || invalidService, saving, failed }, onSave: () => { void save() }, onDiscard: () => {},
    children: h('fieldset', { disabled: saving || testing, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
      view.configStatus === 'invalid' && h('p', { role: 'status' }, '设置文件无法解析或含无效字段，已按可解析值与默认值显示；保存会覆盖损坏部分'),
      view.deprecated?.length ? h('p', { role: 'status', 'data-deprecated': 'true' }, `设置文件中的旧映射（${view.deprecated.join('、')}）已不再生效，下次保存设置时移除。`) : null,
      message && h('p', { role: 'status', className: failed ? 'amr-settings-error' : undefined }, message),
      h('section', { className: 'amr-settings-section' }, h('h3', null, '判档服务'), h('p', null, 'AUTO 把脱敏任务发送给所选决策服务；不跨服务自动回退。'),
        h('div', { className: 'amr-settings-row' }, h('span', null, '决策服务'),
          h(ui.Menu, { open: serviceMenu, portal: true, side: 'bottom', selectedId: serviceProvider, onClose: () => setServiceMenu(false),
            items: Object.entries(DECISION_SERVICES).map(([id, service]) => ({ id, label: service.label })),
            onSelect: id => { if (!Object.hasOwn(DECISION_SERVICES, id)) return; setKey(''); setRemoveKey(false); setPatch(old => ({ ...old, decisionService: { provider: id as DecisionProvider } })); setServiceMenu(false) },
            anchor: h('button', { type: 'button', className: 'amr-service-trigger', 'aria-label': '决策服务', 'aria-haspopup': 'menu', 'aria-expanded': serviceMenu, onClick: () => setServiceMenu(!serviceMenu) }, h('span', null, DECISION_SERVICES[serviceProvider].label), h(ui.IconChevronDownOutlineRegular, { size: 14 })),
          })),
        h('p', null, changingService ? '切换服务后先保存，再管理该服务的独立 API key；不会沿用原服务的 key。' : `凭据引用：${DECISION_SERVICES[serviceProvider].credential}`),
        h('div', { className: 'amr-settings-row' }, h('span', null, '决策模型'), serviceProvider === 'custom'
          ? h('input', { className: 'amr-service-input', 'aria-label': '决策模型', value: decisionModel, onChange: e => setPatch(old => ({ ...old, decisionService: { ...serviceConfig, model: e.currentTarget.value } })) })
          : h(ui.Menu, { open: modelMenu, portal: true, side: 'bottom', selectedId: decisionModel, onClose: () => setModelMenu(false),
            items: decisionModels.map(id => ({ id, label: id })),
            onSelect: model => { if (!decisionModels.includes(model)) return; setPatch(old => ({ ...old, decisionService: { ...serviceConfig, model } })); setModelMenu(false) },
            anchor: h('button', { type: 'button', className: 'amr-service-trigger', 'aria-label': '决策模型', 'aria-haspopup': 'menu', 'aria-expanded': modelMenu, onClick: () => setModelMenu(!modelMenu) }, h('span', null, decisionModel), h(ui.IconChevronDownOutlineRegular, { size: 14 })),
          })),
        serviceProvider==='custom' && h('label', { className: 'amr-settings-row' }, '兼容端点 ',h('input',{className:'amr-service-input','aria-label':'兼容端点',value:serviceConfig.endpoint??'',placeholder:'https://example.com/v1/systemone',onChange:e=>setPatch(old=>({...old,decisionService:{...serviceConfig,endpoint:e.currentTarget.value}}))})),
        h('p', null, serviceProvider==='custom'?'仅兼容 System One state/questions → answers；HTTPS 或回环 HTTP；禁止 URL 凭据、查询参数与重定向。':`接口：${DECISION_SERVICES[serviceProvider].endpoint}`),
        h('div', { className: 'amr-test-row' },
          h('button', { type: 'button', className: 'amr-test-button', disabled: dirty || saving || testing, 'aria-busy': testing, onClick: async () => {
            if (testing) return
            setTesting(true); setTestResult(undefined)
            try {
              const r = await rpc.call('/api', 'auto-model-routing.testDecision', {})
              const v = r.value as { kind?: string; category?: JevCategory; ms?: number } | undefined
              const ok = r.ok && v?.kind === 'ok'
              setTestResult({ failed: !ok, text: ok ? `连接成功 · ${v.ms} ms` : `连接失败：${v?.category ? CATEGORY_HINTS[v.category] ?? '服务不可用' : '无法连接决策服务，请重试'}` })
            } catch { setTestResult({ failed: true, text: '连接测试失败，请检查网络后重试' }) }
            finally { setTesting(false) }
          } }, testing ? '测试中…' : '测试连接'),
          h('span', { role: 'status', 'aria-live': 'polite', className: testResult?.failed ? 'amr-settings-error' : undefined }, testing ? '正在请求所选决策服务…' : testResult?.text ?? (dirty ? '请先保存设置，再测试连接' : ''))),
        h('p',null,'测试会产生一次决策请求，不包含会话内容；请先保存设置。'),
        invalidService && h('p',{role:'alert',className:'amr-settings-error'},'请填写有效模型和兼容端点'),
        h(ui.SettingsSecretField, { id: 'amr-key', label: `${DECISION_SERVICES[serviceProvider].label} API Key`, hint: changingService ? '请先保存服务选择' : keyHint, text: key, disabled: changingService || saving || !view.key.available || !view.key.writable, onEdit: text => { setKey(text); setRemoveKey(false) }, configured: !changingService && view.key.configured, stateLabel: changingService ? '保存后读取' : keyState }),
        !changingService && view.key.available && view.key.writable && view.key.configured && h('button', { type: 'button', className: 'amr-settings-reset', onClick: () => { setRemoveKey(!removeKey); setKey('') } }, removeKey ? '取消删除 key' : '删除 key'),
        invalidKey && h('p', { className: 'amr-settings-error' }, 'API key 不能含空白，且不能超过 512 字符'),
        h('div', { className: 'amr-settings-row' }, h('div', null, h('label', { htmlFor: 'amr-timeout' }, '判档等待上限'), h('p', null, '1000–4500 毫秒；超时后该会话停用 AUTO。')), h('span', null, h('input', { id: 'amr-timeout', type: 'number', className: 'amr-settings-number', min: 1000, max: 4500, step: 1, value: Number.isNaN(settings.jevTimeoutMs) ? '' : settings.jevTimeoutMs, 'aria-invalid': invalidTimeout, onChange: e => setPatch(old => ({ ...old, jevTimeoutMs: e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value) })) }), ' 毫秒'))),
      h('section', { className: 'amr-settings-section' }, h('h3', null, '会话'),
        h('p', null, '主模型不变；子任务独立选择模型能力与推理投入，并在创建时应用。MANUAL 不进行自动判断。'),
        h('div', { className: 'amr-settings-row' }, h('div', null, '新会话默认模式', h('p', null, settings.defaultMode === 'AUTO' ? '仅影响新会话；每个用户回合都会把脱敏任务发送给所选决策服务请求 Jev。' : '仅影响新会话，不改变已有会话。')), h(ui.SegmentedControl, { id: 'amr-default-mode', className: 'amr-settings-segments', label: '新会话默认模式', value: settings.defaultMode, options: [{ value: 'MANUAL', label: 'MANUAL' }, { value: 'AUTO', label: 'AUTO' }], onChange: value => setPatch(old => ({ ...old, defaultMode: value as Settings['defaultMode'] })) })),
        h('div', { className: 'amr-settings-row' }, h('span', null, '判档提示'), h(ui.Switch, { checked: settings.decisionToast, label: '判档提示', onChange: value => setPatch(old => ({ ...old, decisionToast: value })) })),
        h('div', { className: 'amr-settings-row' }, h('span', null, '推理强度上限'), h(ui.SegmentedControl, { id: 'amr-cap', className: 'amr-settings-segments', label: '推理强度上限', value: cap, options: AUTO_EFFORTS.map(value => ({ value, label: value })), onChange: value => setPatch(old => ({ ...old, effortCap: value as AutomaticEffort })) }))),
      h('section', { className: 'amr-settings-section' }, h('h3', null, '自动选配'),
        h('p', null, '主会话仅调整推理投入；子任务按目标与范围选择合适的能力档，再确定投入。保留显式指定的模型和推理等级，不自动重试或升级。'),
        h('p', null, 'Magpie 使用完整模型 ID 与官方允许列表；目录不可用或目标不清楚时停止并提示。fresh 子任务受支持，fork 暂不支持。'), h(StrategyDetails)),
      ...[...conflicts, ...saveIssues].map(issue => h('p', { key: issue.path, role: 'status', className: 'amr-settings-error' }, `${issue.path}：${issue.message}`)),
    ),
  }))
}
