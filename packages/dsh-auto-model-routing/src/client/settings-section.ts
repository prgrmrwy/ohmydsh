import { createElement as h, useEffect, useState } from 'react'
import type { Rpc } from './control.js'
import { AUTO_EFFORTS, type AutomaticEffort, type RoutingCatalog, type Settings, type SettingsIssue, type SettingsPatch } from '../settings-contract.js'
import type { SettingsUi } from './settings-ui.js'
import { DECISION_SERVICES, resolveDecisionService, type DecisionProvider } from '../decision-service.js'
import type { JevCategory } from '../hints.js'
import { StrategyDetails } from './strategy-details.js'
import { CATEGORY_HINT_KEYS, SERVICE_LABEL_KEYS, t } from './locales.js'

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
  if (!response.ok) throw Object.assign(new Error(action === 'setKey' ? t('keySaveFailed') : t('settingsSaveFailed')), { issues: (response.error as { details?: { issues?: SettingsIssue[] } } | undefined)?.details?.issues ?? [] })
  const value = response.value as SettingsView & { error?: string; issues?: SettingsIssue[] }
  if (value?.error) throw Object.assign(new Error(action === 'setKey' ? t('keySaveFailed') : t('settingsSaveFailed')), { issues: value.issues })
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
    void request(rpc, 'settings').then(value => { if (live) setView(value) }, () => { if (live) setMessage(t('settingsReadFailed')) })
    return () => { live = false }
  }, [rpc])
  if (!view) return h('div', { className: 'amr-settings', role: 'status' }, message || t('readingSettings'))
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
  const invalidTimeout = !Number.isInteger(settings.jevTimeoutMs) || settings.jevTimeoutMs < 1000 || settings.jevTimeoutMs > 8000
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
        setKey(''); setRemoveKey(false); results.push(t('keySaved'))
      } catch { results.push(t('keySaveFailed')); setFailed(true) }
    }
    if (Object.keys(patch).length) {
      try { nextView = await request(rpc, 'saveSettings', patch); setPatch({}); results.push(t('settingsSaved')) }
      catch (error) { results.push(t('settingsNotSaved')); setFailed(true); setSaveIssues((error as { issues?: SettingsIssue[] }).issues ?? []) }
    }
    setView(nextView); setMessage(results.join('；')); setSaving(false)
  }
  const keyState = !view.key.available ? t('keyUnavailable') : !view.key.writable ? t('keyFromEnv') : view.key.configured ? t('keyConfigured') : t('keyUnconfigured')
  const keyHint = !view.key.available ? t('keyUnavailableHint') : !view.key.writable ? t('keyEnvHint', { ref: DECISION_SERVICES[serviceProvider].credential }) : view.key.configured ? t('keyStoredHint') : t('keyMissingHint')
  return h('div', { className: 'amr-settings' }, h('style', null, CSS), h(ui.SettingsForm, {
    labels: { unavailable: t('settingsUnavailable'), readOnly: t('settingsReadOnly'), saveFailed: t('partialSaveFailed'), save: t('save'), saving: t('saving') },
    state: { available: true, writable: true, dirty, invalid: conflicts.length > 0 || invalidTimeout || invalidKey || invalidService, saving, failed }, onSave: () => { void save() }, onDiscard: () => {},
    children: h('fieldset', { disabled: saving || testing, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
      view.configStatus === 'invalid' && h('p', { role: 'status' }, t('configInvalid')),
      view.deprecated?.length ? h('p', { role: 'status', 'data-deprecated': 'true' }, t('deprecatedKeys', { list: view.deprecated.join(t('listSeparator')) })) : null,
      message && h('p', { role: 'status', className: failed ? 'amr-settings-error' : undefined }, message),
      h('section', { className: 'amr-settings-section' }, h('h3', null, t('decisionService')), h('p', null, t('decisionServiceIntro')),
        h('div', { className: 'amr-settings-row' }, h('span', null, t('decisionService')),
          h(ui.Menu, { open: serviceMenu, portal: true, side: 'bottom', selectedId: serviceProvider, onClose: () => setServiceMenu(false),
            items: Object.entries(DECISION_SERVICES).map(([id, service]) => ({ id, label: service.label })),
            onSelect: id => { if (!Object.hasOwn(DECISION_SERVICES, id)) return; setKey(''); setRemoveKey(false); setPatch(old => ({ ...old, decisionService: { provider: id as DecisionProvider } })); setServiceMenu(false) },
            anchor: h('button', { type: 'button', className: 'amr-service-trigger', 'aria-label': t('decisionService'), 'aria-haspopup': 'menu', 'aria-expanded': serviceMenu, onClick: () => setServiceMenu(!serviceMenu) }, h('span', null, t(SERVICE_LABEL_KEYS[serviceProvider])), h(ui.IconChevronDownOutlineRegular, { size: 14 })),
          })),
        h('p', null, changingService ? t('serviceSwitchNote') : t('credentialRef', { ref: DECISION_SERVICES[serviceProvider].credential })),
        h('div', { className: 'amr-settings-row' }, h('span', null, t('decisionModel')), serviceProvider === 'custom'
          ? h('input', { className: 'amr-service-input', 'aria-label': t('decisionModel'), value: decisionModel, onChange: e => setPatch(old => ({ ...old, decisionService: { ...serviceConfig, model: e.currentTarget.value } })) })
          : h(ui.Menu, { open: modelMenu, portal: true, side: 'bottom', selectedId: decisionModel, onClose: () => setModelMenu(false),
            items: decisionModels.map(id => ({ id, label: id })),
            onSelect: model => { if (!decisionModels.includes(model)) return; setPatch(old => ({ ...old, decisionService: { ...serviceConfig, model } })); setModelMenu(false) },
            anchor: h('button', { type: 'button', className: 'amr-service-trigger', 'aria-label': t('decisionModel'), 'aria-haspopup': 'menu', 'aria-expanded': modelMenu, onClick: () => setModelMenu(!modelMenu) }, h('span', null, decisionModel), h(ui.IconChevronDownOutlineRegular, { size: 14 })),
          })),
        serviceProvider==='custom' && h('label', { className: 'amr-settings-row' }, t('compatibleEndpoint'),h('input',{className:'amr-service-input','aria-label':t('compatibleEndpoint'),value:serviceConfig.endpoint??'',placeholder:'https://example.com/v1/systemone',onChange:e=>setPatch(old=>({...old,decisionService:{...serviceConfig,endpoint:e.currentTarget.value}}))})),
        h('p', null, serviceProvider==='custom' ? t('customEndpointHint') : t('endpointLine', { endpoint: DECISION_SERVICES[serviceProvider].endpoint })),
        h('div', { className: 'amr-test-row' },
          h('button', { type: 'button', className: 'amr-test-button', disabled: dirty || saving || testing, 'aria-busy': testing, onClick: async () => {
            if (testing) return
            setTesting(true); setTestResult(undefined)
            try {
              const r = await rpc.call('/api', 'auto-model-routing.testDecision', {})
              const v = r.value as { kind?: string; category?: JevCategory; ms?: number } | undefined
              const ok = r.ok && v?.kind === 'ok'
              setTestResult({ failed: !ok, text: ok ? t('connectionOk', { ms: v.ms ?? 0 }) : t('connectionFailed', { reason: v?.category ? t(CATEGORY_HINT_KEYS[v.category]) : t('connectFailedRetry') }) })
            } catch { setTestResult({ failed: true, text: t('connectTestFailed') }) }
            finally { setTesting(false) }
          } }, testing ? t('testing') : t('testConnection')),
          h('span', { role: 'status', 'aria-live': 'polite', className: testResult?.failed ? 'amr-settings-error' : undefined }, testing ? t('testInFlight') : testResult?.text ?? (dirty ? t('saveBeforeTest') : ''))),
        h('p', null, t('testCost')),
        invalidService && h('p', { role: 'alert', className: 'amr-settings-error' }, t('invalidService')),
        h(ui.SettingsSecretField, { id: 'amr-key', label: t('serviceKeyLabel', { service: t(SERVICE_LABEL_KEYS[serviceProvider]) }), hint: changingService ? t('saveServiceFirst') : keyHint, text: key, disabled: changingService || saving || !view.key.available || !view.key.writable, onEdit: text => { setKey(text); setRemoveKey(false) }, configured: !changingService && view.key.configured, stateLabel: changingService ? t('stateAfterSave') : keyState }),
        !changingService && view.key.available && view.key.writable && view.key.configured && h('button', { type: 'button', className: 'amr-settings-reset', onClick: () => { setRemoveKey(!removeKey); setKey('') } }, removeKey ? t('cancelRemoveKey') : t('removeKey')),
        invalidKey && h('p', { className: 'amr-settings-error' }, t('invalidKey')),
        h('div', { className: 'amr-settings-row' }, h('div', null, h('label', { htmlFor: 'amr-timeout' }, t('jevTimeout')), h('p', null, t('jevTimeoutHint'))), h('span', null, h('input', { id: 'amr-timeout', type: 'number', className: 'amr-settings-number', min: 1000, max: 8000, step: 1, value: Number.isNaN(settings.jevTimeoutMs) ? '' : settings.jevTimeoutMs, 'aria-invalid': invalidTimeout, onChange: e => setPatch(old => ({ ...old, jevTimeoutMs: e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value) })) }), t('msSuffix')))),
      h('section', { className: 'amr-settings-section' }, h('h3', null, t('sessionSection')),
        h('p', null, t('sessionIntro')),
        h('div', { className: 'amr-settings-row' }, h('div', null, t('defaultMode'), h('p', null, settings.defaultMode === 'AUTO' ? t('defaultModeAutoHint') : t('defaultModeManualHint'))), h(ui.SegmentedControl, { id: 'amr-default-mode', className: 'amr-settings-segments', label: t('defaultMode'), value: settings.defaultMode, options: [{ value: 'MANUAL', label: 'MANUAL' }, { value: 'AUTO', label: 'AUTO' }], onChange: value => setPatch(old => ({ ...old, defaultMode: value as Settings['defaultMode'] })) })),
        h('div', { className: 'amr-settings-row' }, h('span', null, t('decisionToast')), h(ui.Switch, { checked: settings.decisionToast, label: t('decisionToast'), onChange: value => setPatch(old => ({ ...old, decisionToast: value })) })),
        h('div', { className: 'amr-settings-row' }, h('span', null, t('effortCap')), h(ui.SegmentedControl, { id: 'amr-cap', className: 'amr-settings-segments', label: t('effortCap'), value: cap, options: AUTO_EFFORTS.map(value => ({ value, label: value })), onChange: value => setPatch(old => ({ ...old, effortCap: value as AutomaticEffort })) }))),
      h('section', { className: 'amr-settings-section' }, h('h3', null, t('autoSection')),
        h('p', null, t('autoIntro')),
        h('p', null, t('autoCatalogNote')), h(StrategyDetails)),
      ...[...conflicts, ...saveIssues].map(issue => h('p', { key: issue.path, role: 'status', className: 'amr-settings-error' }, `${issue.path}: ${issue.message}`)),
    ),
  }))
}
