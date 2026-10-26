import { createElement as h, useEffect, useRef, useState } from 'react'
import { errorText, failureText, isOk, type Api } from './api.js'
import { settingsCss } from './styles.js'
import { UsageCard } from './UsageCard.js'
import { cardKey, formatTime, parseCards, providerOrder, readTime, sameTarget, type Card, type CardsView, type ModelGroup, type ModelRow, type SettingsView, type SyncErrorKind } from './view-model.js'

/**
 * Magpie settings section: connection, per-provider groups (model visibility,
 * DSH-side default effort, read-only usage cards). Cards are read once on
 * open or after a connection write; only user refreshes reread upstream usage.
 */
export const EMPTY_TEXT = 'Magpie 未返回可见用量'
export const RESTRICTED_HINT = '受限的 gateway key 无法让 Magpie 首次读取用量：需要 Magpie 管理员先在 Magpie 中读取一次，或者改用不受限的 key。'
export const NOT_REREAD = 'Magpie 未重新读取（可能处于节流间隔内）'
const SYNC_KIND: Record<SyncErrorKind, string> = { unauthorized: 'key 无效（401）', forbidden: '无权访问（403）', http: '网关错误', unreachable: '无法连接网关' }

type Target = { all: true } | { provider: string; user?: string }
type Notice = 'not-reread' | 'restricted'
type SettingsResult = { view?: SettingsView; error?: string }
type SettingsMutation = (body: Record<string, unknown> | ((current: SettingsView) => Record<string, unknown>)) => Promise<SettingsResult | undefined>

export function MagpieSettings({ api }: { api: Api }) {
  const [settings, setSettings] = useState<SettingsView>()
  const [settingsError, setSettingsError] = useState('')
  const [cards, setCards] = useState<CardsView>()
  const [refreshing, setRefreshing] = useState<Target>()
  const [notice, setNotice] = useState<Notice>()
  const [usageAlert, setUsageAlert] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const settingsRef = useRef<SettingsView | undefined>(undefined)
  const settingsVersion = useRef(0)
  const settingsLock = useRef(false)
  const cardsEpoch = useRef(0)
  const refreshLock = useRef(false)
  const cardsRef = useRef<Card[]>([])
  cardsRef.current = cards?.cards ?? []
  const commitSettings = (view: SettingsView) => { settingsRef.current = view; setSettings(view) }
  const readCards = async (epoch: number) => {
    try {
      const response = await api({ method: 'GET', path: 'cards' })
      if (epoch === cardsEpoch.current) setCards(parseCards(response.body, response.status))
    } catch (error) {
      if (epoch === cardsEpoch.current) setCards({ status: 'error', error: errorText(error), cards: [] })
    }
  }
  const clearUsage = () => {
    const epoch = ++cardsEpoch.current
    cardsRef.current = []; refreshLock.current = false
    setCards(undefined); setRefreshing(undefined); setNotice(undefined); setUsageAlert('')
    return epoch
  }
  useEffect(() => {
    const version = ++settingsVersion.current
    settingsLock.current = false; setSavingSettings(false)
    settingsRef.current = undefined; setSettings(undefined); setSettingsError('')
    const epoch = clearUsage()
    void api({ method: 'GET', path: 'settings' }).then(response => {
      if (version !== settingsVersion.current) return
      if (isOk(response)) commitSettings(response.body as SettingsView)
      else setSettingsError(failureText(response))
    }, error => { if (version === settingsVersion.current) setSettingsError(errorText(error)) })
    void readCards(epoch)
    return () => { ++settingsVersion.current; ++cardsEpoch.current }
  }, [api])

  const mutateSettings: SettingsMutation = async change => {
    // Ref acquisition is synchronous: disabled props alone cannot stop same-tick writes.
    if (settingsLock.current || !settingsRef.current) return
    settingsLock.current = true; setSavingSettings(true)
    const version = ++settingsVersion.current
    const body = typeof change === 'function' ? change(settingsRef.current) : change
    const identityWrite = ['baseUrl', 'key', 'accessClientId', 'accessClientSecret'].some(field => Object.hasOwn(body, field))
    const epoch = identityWrite ? clearUsage() : cardsEpoch.current
    try {
      const result = await postSettings(api, body)
      if (version !== settingsVersion.current) return
      if (result.view) {
        commitSettings(result.view)
        if (identityWrite) void readCards(epoch)
      } else if (identityWrite) {
        setCards({ status: 'error', error: result.error!, cards: [] })
      }
      return result
    } finally {
      if (version === settingsVersion.current) { settingsLock.current = false; setSavingSettings(false) }
    }
  }

  const renderEpoch = cardsEpoch.current
  const refresh = async (target: Target) => {
    if (refreshLock.current || renderEpoch !== cardsEpoch.current) return
    refreshLock.current = true
    const epoch = renderEpoch
    setRefreshing(target); setNotice(undefined); setUsageAlert('')
    const before = cardsRef.current
    try {
      const response = await api({ method: 'POST', path: 'cards', body: target })
      if (epoch !== cardsEpoch.current) return
      // A failed refresh is not a card result: keep what was shown and say why.
      if (!isOk(response)) { setUsageAlert(`刷新失败：${failureText(response)}`); return }
      const next = parseCards(response.body, response.status)
      setCards(next)
      setNotice(noticeAfter(target, before, next))
    } catch (error) {
      if (epoch === cardsEpoch.current) setUsageAlert(`刷新失败：${errorText(error)}`)
    } finally {
      if (epoch === cardsEpoch.current) { refreshLock.current = false; setRefreshing(undefined) }
    }
  }

  const groups = settings?.groups ?? []
  const cardList = cards?.cards ?? []
  const busy = refreshing !== undefined
  return h('div', { className: 'dmg-settings' },
    h('style', null, settingsCss),
    h('p', { className: 'dmg-intro' }, '通过自托管的 Magpie 网关使用模型。用量卡片只读，打开本页时读取一次，之后只在你点击刷新时重新读取。'),
    settingsError ? h('p', { className: 'dmg-error', role: 'alert' }, `无法读取设置：${settingsError}`) : null,
    settings ? h(Connection, { settings, saving: savingSettings, mutateSettings })
      : settingsError ? null : h('p', { role: 'status', className: 'dmg-hint' }, '正在读取设置…'),
    h(UsageStatus, { cards, busy, notice, alert: usageAlert, onRefreshAll: () => { void refresh({ all: true }) } }),
    ...providerOrder(groups, cardList).map(provider => h(ProviderGroup, {
      key: provider, provider,
      group: groups.find(g => g.provider === provider),
      settings,
      cards: cardList.filter(c => c.provider === provider),
      busy, saving: savingSettings, mutateSettings,
      onRefresh: (card: Card) => { void refresh({ provider: card.provider, ...(card.user !== undefined ? { user: card.user } : {}) }) },
    })))
}

/** What to tell the user after a 2xx refresh: unchanged read times, or a still-empty cold start. */
function noticeAfter(target: Target, before: Card[], next: CardsView): Notice | undefined {
  if ('all' in target) {
    if (next.status === 'ok' && next.cards.length === 0) return 'restricted'
    const old = new Map(before.map(c => [cardKey(c), readTime(c)]))
    return next.cards.length > 0 && next.cards.every(c => old.has(cardKey(c)) && old.get(cardKey(c)) === readTime(c)) ? 'not-reread' : undefined
  }
  const old = before.find(c => sameTarget(c, target))
  const now = next.cards.find(c => sameTarget(c, target))
  return old && now && readTime(old) === readTime(now) ? 'not-reread' : undefined
}

function UsageStatus({ cards, busy, notice, alert, onRefreshAll }: { cards: CardsView | undefined; busy: boolean; notice: Notice | undefined; alert: string; onRefreshAll: () => void }) {
  const state = !cards ? 'loading' : cards.status !== 'ok' ? cards.status : cards.cards.length ? 'ok' : 'empty'
  const message = state === 'loading' ? '正在读取用量…'
    : state === 'forbidden' ? '当前 gateway key 无权读取用量'
      : state === 'unconfigured' ? '填写网关地址和 key 后才能读取用量'
        : state === 'error' ? '读取用量失败'
          : state === 'empty' ? EMPTY_TEXT : undefined
  const canRefreshAll = state === 'ok' || state === 'empty' || state === 'error'
  return h('section', { className: 'dmg-panel', 'data-usage-state': state, 'aria-label': '用量' },
    h('div', { className: 'dmg-head' },
      h('h3', null, '用量'),
      canRefreshAll ? h('button', { type: 'button', className: 'dmg-button', disabled: busy, onClick: onRefreshAll }, '刷新全部') : null),
    message ? h('p', { className: state === 'error' || state === 'forbidden' ? 'dmg-error' : 'dmg-hint', role: 'status' }, message) : null,
    cards?.error && state !== 'ok' ? h('p', { className: 'dmg-error' }, cards.error) : null,
    state === 'empty' && notice === 'restricted' ? h('p', { className: 'dmg-hint' }, RESTRICTED_HINT) : null,
    notice === 'not-reread' ? h('p', { className: 'dmg-hint', role: 'status' }, NOT_REREAD) : null,
    busy ? h('p', { className: 'dmg-hint', role: 'status' }, '正在请求 Magpie 重新读取…') : null,
    alert ? h('p', { className: 'dmg-error', role: 'alert', 'data-usage-alert': '' }, alert) : null)
}

async function postSettings(api: Api, body: Record<string, unknown>): Promise<SettingsResult> {
  try {
    const response = await api({ method: 'POST', path: 'settings', body })
    if (isOk(response)) return { view: response.body as SettingsView }
    return { error: response.status === 409 ? 'key 来自启动环境，不能在这里修改' : `未保存：${failureText(response)}` }
  } catch (error) { return { error: `未保存：${errorText(error)}` } }
}

function Connection({ settings, saving, mutateSettings }: { settings: SettingsView; saving: boolean; mutateSettings: SettingsMutation }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [accessClientId, setAccessClientId] = useState('')
  const [accessClientSecret, setAccessClientSecret] = useState('')
  const [message, setMessage] = useState<{ text: string; failed: boolean }>()
  const writable = settings.key?.writable !== false
  const configured = settings.key?.configured === true
  const savedUrl = settings.baseUrl ?? ''
  const post = async (body: Record<string, unknown>, done: string) => {
    setMessage(undefined)
    const result = await mutateSettings(body)
    if (!result) return
    if (result.view) { setKey(''); setAccessClientId(''); setAccessClientSecret(''); setMessage({ text: done, failed: false }) }
    else setMessage({ text: result.error!, failed: true })
  }
  const save = () => {
    const body: Record<string, unknown> = {}
    if (baseUrl.trim() !== savedUrl) body.baseUrl = baseUrl.trim()
    if (key) body.key = key
    if (accessClientId) body.accessClientId = accessClientId
    if (accessClientSecret) body.accessClientSecret = accessClientSecret
    void post(body, '已保存')
  }
  return h('section', { className: 'dmg-panel', 'aria-label': '连接' },
    h('h3', null, '连接'),
    h('label', { className: 'dmg-field' }, h('span', null, '网关地址（含 /v1）'),
      h('input', { className: 'dmg-input', value: baseUrl, disabled: saving, placeholder: 'http://127.0.0.1:3425/v1', onChange: (e: { target: { value: string } }) => setBaseUrl(e.target.value) })),
    h('label', { className: 'dmg-field' }, h('span', null, `Gateway API key · ${configured ? '已配置' : '未配置'}${writable ? '' : '（来自启动环境，只读）'}`),
      h('input', {
        className: 'dmg-input', type: 'password', autoComplete: 'off', value: key, disabled: saving || !writable,
        placeholder: configured ? '留空则保持不变' : '必填', onChange: (e: { target: { value: string } }) => setKey(e.target.value),
      })),
    h('p', { className: 'dmg-hint' }, 'Cloudflare Access（可选）：公网入口填写服务令牌两项；仅支持 HTTPS。局域网直连无需填写。留空保持不变。'),
    ...([
      ['Access Client ID', settings.access?.clientId, accessClientId, setAccessClientId],
      ['Access Client Secret', settings.access?.clientSecret, accessClientSecret, setAccessClientSecret],
    ] as const).map(([label, status, value, setValue]) => h('label', { key: label, className: 'dmg-field' },
      h('span', null, `${label} · ${status?.configured ? '已配置' : '未配置'}${status?.writable === false ? '（来自启动环境，只读）' : ''}`),
      h('input', { className: 'dmg-input', type: 'password', autoComplete: 'off', value,
        disabled: saving || status?.writable === false, placeholder: '留空则保持不变',
        onChange: (e: { target: { value: string } }) => setValue(e.target.value) }))),
    h('div', { className: 'dmg-row' },
      h('button', { type: 'button', className: 'dmg-button', disabled: saving || (!key && !accessClientId && !accessClientSecret && baseUrl.trim() === savedUrl), onClick: save }, saving ? '保存中…' : '保存'),
      (settings.access?.clientId?.configured || settings.access?.clientSecret?.configured) ? h('button', { type: 'button', className: 'dmg-button',
        disabled: saving || settings.access?.clientId?.writable === false || settings.access?.clientSecret?.writable === false,
        onClick: () => { void post({ accessClientId: null, accessClientSecret: null }, '已清除 Access 凭据') } }, '清除 Access 凭据') : null,
      configured && writable ? h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: () => { void post({ key: null }, '已清除 key') } }, '清除 key') : null,
      h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: () => { void post({ resync: true }, '已重新获取目录') } }, '重新获取目录')),
    h(SyncStatus, { settings }),
    message ? h('p', { className: message.failed ? 'dmg-error' : 'dmg-ok', role: message.failed ? 'alert' : 'status' }, message.text) : null)
}

function SyncStatus({ settings }: { settings: SettingsView }) {
  const count = (settings.groups ?? []).reduce((n, g) => n + g.models.length, 0)
  return h('div', { className: 'dmg-meta', 'data-sync': '' },
    settings.lastSyncAt ? h('p', null, `目录 ${count} 个模型 · 同步于 `, h('time', { dateTime: settings.lastSyncAt }, formatTime(settings.lastSyncAt))) : null,
    settings.lastSyncError ? h('p', { className: 'dmg-error' },
      `同步失败${settings.lastSyncErrorKind ? `（${SYNC_KIND[settings.lastSyncErrorKind] ?? settings.lastSyncErrorKind}）` : ''}：${settings.lastSyncError}`) : null)
}

interface GroupProps {
  provider: string; group: ModelGroup | undefined; settings: SettingsView | undefined; cards: Card[]; busy: boolean
  saving: boolean; mutateSettings: SettingsMutation; onRefresh: (card: Card) => void
}

function ProviderGroup({ provider, group, settings, cards, busy, saving, mutateSettings, onRefresh }: GroupProps) {
  const [error, setError] = useState('')
  const saved = settings?.visibleModels ?? {}
  const following = !Object.hasOwn(saved, provider)
  const models = group?.models ?? []
  const post = async (body: Parameters<SettingsMutation>[0]) => {
    setError('')
    const result = await mutateSettings(body)
    if (result?.error) setError(result.error)
  }
  // Build the replacement map only after taking the page lock, from the latest response.
  const setVisible = (model: ModelRow, visible: boolean) => {
    void post(view => {
      const saved = view.visibleModels ?? {}
      const models = view.groups?.find(g => g.provider === provider)?.models ?? []
      const current = Object.hasOwn(saved, provider) ? saved[provider]! : models.map(m => m.id)
      const next = visible ? [...new Set([...current, model.id])] : current.filter(id => id !== model.id)
      return { visibleModels: { ...saved, [provider]: next } }
    })
  }
  const follow = () => {
    void post(view => {
      const rest = { ...view.visibleModels }
      delete rest[provider]
      return { visibleModels: rest }
    })
  }
  return h('section', { className: 'dmg-panel', 'data-provider': provider, 'aria-label': provider },
    h('div', { className: 'dmg-head' },
      h('h3', null, provider),
      group && !following ? h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: follow }, '跟随网关目录') : null),
    group ? h('p', { className: 'dmg-hint' }, following ? '可见性：跟随网关目录，新上架的模型自动出现' : '可见性：只显示勾选的模型，新上架的模型默认隐藏') : null,
    models.length ? h('div', { className: 'dmg-models' }, ...models.map(model => h(ModelLine, {
      key: model.id, model, disabled: saving,
      visible: model.visible ?? (following || (saved[provider] ?? []).includes(model.id)),
      effort: settings?.defaultEfforts?.[model.id],
      onVisible: (visible: boolean) => setVisible(model, visible),
      onEffort: (effort: string | null) => { void post({ defaultEffort: { model: model.id, effort } }) },
    }))) : null,
    cards.length ? h('div', { className: 'dmg-cards' }, ...cards.map(card => h(UsageCard, { key: cardKey(card), card, busy, onRefresh: () => onRefresh(card) }))) : null,
    error ? h('p', { className: 'dmg-error', role: 'alert' }, error) : null)
}

function ModelLine({ model, visible, effort, disabled, onVisible, onEffort }: {
  model: ModelRow; visible: boolean; effort: string | undefined; disabled: boolean
  onVisible: (visible: boolean) => void; onEffort: (effort: string | null) => void
}) {
  const efforts = model.efforts ?? []
  // Stale = saved but no longer offered by the gateway (design D7: the client judges this itself).
  const stale = effort !== undefined && !efforts.includes(effort)
  const label = model.name || model.id
  return h('div', { className: 'dmg-model', 'data-model': model.id },
    h('label', null,
      h('input', { type: 'checkbox', checked: visible, disabled, 'aria-label': `在选择器中显示 ${label}`, onChange: (e: { target: { checked: boolean } }) => onVisible(e.target.checked) }),
      h('span', null, label),
      model.name && model.name !== model.id ? h('code', null, model.id) : null),
    efforts.length ? h('select', {
      className: 'dmg-select', 'aria-label': `${label} 默认 effort`, disabled,
      value: effort ?? '', onChange: (e: { target: { value: string } }) => onEffort(e.target.value === '' ? null : e.target.value),
    },
    h('option', { value: '' }, '默认 effort：不设置'),
    stale ? h('option', { value: effort, disabled: true }, `${effort}（网关当前不提供，暂不生效）`) : null,
    ...efforts.map(id => h('option', { key: id, value: id }, id))) : null)
}
