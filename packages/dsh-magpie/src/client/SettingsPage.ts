import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { errorText, failureText, isOk, type Api } from './api.js'
import { settingsCss } from './styles.js'
import { UsageCard } from './UsageCard.js'
import { cardKey, formatTime, parseCards, providerOrder, readTime, sameTarget, type Card, type CardsView, type ModelGroup, type ModelRow, type SettingsView, type SyncErrorKind } from './view-model.js'

/**
 * Magpie settings section: connection (with an advanced access mode), then
 * per-provider groups (model visibility, DSH-side default effort, read-only
 * usage cards). Cards are read once on open or after a connection write; only
 * user refreshes reread upstream usage — each card refreshes itself, and the
 * connection panel offers "获取模型与用量" only while no card is shown.
 */
export const EMPTY_TEXT = 'Magpie 未返回可见用量'
export const RESTRICTED_HINT = '受限的 gateway key 无法让 Magpie 首次读取用量：需要 Magpie 管理员先在 Magpie 中读取一次，或者改用不受限的 key。'
export const NOT_REREAD = 'Magpie 未重新读取（可能处于节流间隔内）'
const SYNC_KIND: Record<SyncErrorKind, string> = { unauthorized: 'key 无效（401）', forbidden: '无权访问（403）', http: '网关错误', unreachable: '无法连接网关' }

type Target = { all: true } | { provider: string; user?: string }
type Notice = 'not-reread' | 'restricted'
/** Where a refresh outcome is shown: a provider group, or the connection panel for the all-target fallback. */
type NoteScope = string | undefined
type SettingsResult = { view?: SettingsView; error?: string }
type SettingsMutation = (body: Record<string, unknown> | ((current: SettingsView) => Record<string, unknown>)) => Promise<SettingsResult | undefined>

export function MagpieSettings({ api }: { api: Api }) {
  const [settings, setSettings] = useState<SettingsView>()
  const [settingsError, setSettingsError] = useState('')
  const [cards, setCards] = useState<CardsView>()
  const [refreshing, setRefreshing] = useState<Target>()
  const [notice, setNotice] = useState<Notice>()
  const [noteScope, setNoteScope] = useState<NoteScope>()
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
    setRefreshing(target); setNotice(undefined); setUsageAlert(''); setNoteScope('all' in target ? undefined : target.provider)
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
  // Catalog first, then an all-provider usage read: the only bulk refresh left, for when no card exists yet.
  const fetchAll = async () => {
    const result = await mutateSettings({ resync: true })
    if (result?.view) await refresh({ all: true })
    else if (result?.error) { setNoteScope(undefined); setUsageAlert(result.error) }
  }
  const groupNote = (provider: string) => noteScope === provider ? { notice, alert: usageAlert } : {}
  return h('div', { className: 'dmg-settings' },
    h('style', null, settingsCss),
    h('p', { className: 'dmg-intro' }, '通过自托管的 Magpie 网关使用模型。用量卡片只读，打开本页时读取一次，之后只在你点击卡片上的刷新时重新读取。'),
    settingsError ? h('p', { className: 'dmg-error', role: 'alert' }, `无法读取设置：${settingsError}`) : null,
    settings ? h(Connection, { settings, saving: savingSettings, mutateSettings,
      usage: h(UsageStatus, { cards, busy, ...(noteScope === undefined ? { notice, alert: usageAlert } : {}), onFetchAll: () => { void fetchAll() }, saving: savingSettings }) })
      : settingsError ? null : h('p', { role: 'status', className: 'dmg-hint' }, '正在读取设置…'),
    ...providerOrder(groups, cardList).map(provider => h(ProviderGroup, {
      key: provider, provider,
      group: groups.find(g => g.provider === provider),
      settings,
      cards: cardList.filter(c => c.provider === provider),
      busy, saving: savingSettings, mutateSettings, ...groupNote(provider),
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

/**
 * Usage state inside the connection panel. Silent while cards render (each card
 * carries its own refresh); otherwise says why there are none and, when a read
 * could help, offers the one bulk action.
 */
function UsageStatus({ cards, busy, saving, notice, alert, onFetchAll }: { cards: CardsView | undefined; busy: boolean; saving: boolean; notice?: Notice | undefined; alert?: string; onFetchAll: () => void }) {
  const state = !cards ? 'loading' : cards.status !== 'ok' ? cards.status : cards.cards.length ? 'ok' : 'empty'
  const message = state === 'loading' ? '正在读取用量…'
    : state === 'forbidden' ? '当前 gateway key 无权读取用量'
      : state === 'unconfigured' ? '填写网关地址和 key 后才能读取用量'
        : state === 'error' ? '读取用量失败'
          : state === 'empty' ? EMPTY_TEXT : undefined
  const canFetch = state === 'empty' || state === 'error'
  const lines = [
    message ? h('p', { key: 'm', className: state === 'error' || state === 'forbidden' ? 'dmg-error' : 'dmg-hint', role: 'status' }, message) : null,
    cards?.error && state !== 'ok' ? h('p', { key: 'e', className: 'dmg-error' }, cards.error) : null,
    state === 'empty' && notice === 'restricted' ? h('p', { key: 'r', className: 'dmg-hint' }, RESTRICTED_HINT) : null,
    notice === 'not-reread' ? h('p', { key: 'n', className: 'dmg-hint', role: 'status' }, NOT_REREAD) : null,
    busy && canFetch ? h('p', { key: 'b', className: 'dmg-hint', role: 'status' }, '正在请求 Magpie 重新读取…') : null,
    alert ? h('p', { key: 'a', className: 'dmg-error', role: 'alert', 'data-usage-alert': '' }, alert) : null,
  ].filter(Boolean)
  if (!lines.length && !canFetch) return null
  return h('div', { className: 'dmg-usage', 'data-usage-state': state, 'aria-label': '用量' },
    ...lines,
    canFetch ? h('div', { className: 'dmg-row' },
      h('button', { type: 'button', className: 'dmg-button', disabled: busy || saving, onClick: onFetchAll }, '获取模型与用量')) : null)
}

async function postSettings(api: Api, body: Record<string, unknown>): Promise<SettingsResult> {
  try {
    const response = await api({ method: 'POST', path: 'settings', body })
    if (isOk(response)) return { view: response.body as SettingsView }
    return { error: response.status === 409 ? 'key 来自启动环境，不能在这里修改' : `未保存：${failureText(response)}` }
  } catch (error) { return { error: `未保存：${errorText(error)}` } }
}

type AccessMode = 'direct' | 'cloudflare'
const ACCESS_MODES: { id: AccessMode; label: string }[] = [{ id: 'direct', label: '直连' }, { id: 'cloudflare', label: 'Cloudflare Access' }]

function Connection({ settings, saving, mutateSettings, usage }: { settings: SettingsView; saving: boolean; mutateSettings: SettingsMutation; usage: ReactNode }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [accessClientId, setAccessClientId] = useState('')
  const [accessClientSecret, setAccessClientSecret] = useState('')
  const [message, setMessage] = useState<{ text: string; failed: boolean }>()
  const writable = settings.key?.writable !== false
  const configured = settings.key?.configured === true
  const savedUrl = settings.baseUrl ?? ''
  const access = settings.access
  const accessSaved = access?.clientId?.configured === true || access?.clientSecret?.configured === true
  const accessLocked = access?.clientId?.writable === false || access?.clientSecret?.writable === false
  // The mode is not stored: it follows whether Access credentials exist, so switching to 直连 and saving clears them.
  const [mode, setMode] = useState<AccessMode>(accessSaved ? 'cloudflare' : 'direct')
  useEffect(() => { setMode(accessSaved ? 'cloudflare' : 'direct') }, [accessSaved])
  const clearsAccess = mode === 'direct' && accessSaved
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
    if (clearsAccess) { body.accessClientId = null; body.accessClientSecret = null }
    if (mode === 'cloudflare' && accessClientId) body.accessClientId = accessClientId
    if (mode === 'cloudflare' && accessClientSecret) body.accessClientSecret = accessClientSecret
    void post(body, clearsAccess ? '已保存，已清除 Access 凭据' : '已保存')
  }
  const dirty = !!key || baseUrl.trim() !== savedUrl || clearsAccess || (mode === 'cloudflare' && (!!accessClientId || !!accessClientSecret))
  return h('section', { className: 'dmg-panel', 'aria-label': '连接' },
    h('h3', null, '连接'),
    h('label', { className: 'dmg-field' }, h('span', null, '网关地址（含 /v1）'),
      h('input', { className: 'dmg-input', value: baseUrl, disabled: saving, placeholder: 'http://127.0.0.1:3425/v1', onChange: (e: { target: { value: string } }) => setBaseUrl(e.target.value) })),
    h('label', { className: 'dmg-field' }, h('span', null, `Gateway API key · ${configured ? '已配置' : '未配置'}${writable ? '' : '（来自启动环境，只读）'}`),
      h('input', {
        className: 'dmg-input', type: 'password', autoComplete: 'off', value: key, disabled: saving || !writable,
        placeholder: configured ? '留空则保持不变' : '必填', onChange: (e: { target: { value: string } }) => setKey(e.target.value),
      })),
    h('details', { className: 'dmg-advanced', open: true, 'data-advanced': '' },
      h('summary', null, '高级连接'),
      h('div', { className: 'dmg-advanced-body' },
        h('label', { className: 'dmg-field' }, h('span', null, `接入方式${accessLocked ? '（Access 凭据来自启动环境，只读）' : ''}`),
          h('select', { className: 'dmg-select', 'aria-label': '接入方式', value: mode, disabled: saving || accessLocked,
            onChange: (e: { target: { value: string } }) => setMode(e.target.value as AccessMode) },
          ...ACCESS_MODES.map(m => h('option', { key: m.id, value: m.id }, m.label)))),
        mode === 'direct'
          ? h('p', { className: 'dmg-hint' }, clearsAccess ? '保存后将清除已保存的 Cloudflare Access 凭据。' : '网关地址可直接访问时选择（局域网、Tailscale 等组网后的地址）。')
          : h('p', { className: 'dmg-hint' }, '网关在 Cloudflare Access 之后时选择：填写服务令牌的两项，仅支持 HTTPS。留空保持不变。'),
        ...(mode === 'cloudflare' ? ([
          ['Access Client ID', access?.clientId, accessClientId, setAccessClientId],
          ['Access Client Secret', access?.clientSecret, accessClientSecret, setAccessClientSecret],
        ] as const).map(([label, status, value, setValue]) => h('label', { key: label, className: 'dmg-field' },
          h('span', null, `${label} · ${status?.configured ? '已配置' : '未配置'}${status?.writable === false ? '（来自启动环境，只读）' : ''}`),
          h('input', { className: 'dmg-input', type: 'password', autoComplete: 'off', value,
            disabled: saving || status?.writable === false, placeholder: status?.configured ? '留空则保持不变' : '必填',
            onChange: (e: { target: { value: string } }) => setValue(e.target.value) }))) : []))),
    h('div', { className: 'dmg-row' },
      h('button', { type: 'button', className: 'dmg-button', disabled: saving || !dirty, onClick: save }, saving ? '保存中…' : '保存'),
      configured && writable ? h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: () => { void post({ key: null }, '已清除 key') } }, '清除 key') : null,
      h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: () => { void post({ resync: true }, '已刷新模型列表') } }, '刷新模型列表')),
    h(SyncStatus, { settings }),
    message ? h('p', { className: message.failed ? 'dmg-error' : 'dmg-ok', role: message.failed ? 'alert' : 'status' }, message.text) : null,
    usage)
}

function SyncStatus({ settings }: { settings: SettingsView }) {
  const count = (settings.groups ?? []).reduce((n, g) => n + g.models.length, 0)
  return h('div', { className: 'dmg-meta', 'data-sync': '' },
    settings.lastSyncAt ? h('p', null, `共 ${count} 个模型 · 更新于 `, h('time', { dateTime: settings.lastSyncAt }, formatTime(settings.lastSyncAt))) : null,
    settings.lastSyncError ? h('p', { className: 'dmg-error' },
      `同步失败${settings.lastSyncErrorKind ? `（${SYNC_KIND[settings.lastSyncErrorKind] ?? settings.lastSyncErrorKind}）` : ''}：${settings.lastSyncError}`) : null)
}

interface GroupProps {
  provider: string; group: ModelGroup | undefined; settings: SettingsView | undefined; cards: Card[]; busy: boolean
  saving: boolean; mutateSettings: SettingsMutation; onRefresh: (card: Card) => void
  notice?: Notice | undefined; alert?: string
}

function ProviderGroup({ provider, group, settings, cards, busy, saving, mutateSettings, onRefresh, notice, alert }: GroupProps) {
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
      group && !following ? h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: follow }, '跟随网关模型列表') : null),
    group ? h('p', { className: 'dmg-hint' }, following ? '可见性：跟随网关模型列表，新上架的模型自动出现' : '可见性：只显示勾选的模型，新上架的模型默认隐藏') : null,
    models.length ? h('div', { className: 'dmg-models' }, ...models.map(model => h(ModelLine, {
      key: model.id, model, disabled: saving,
      visible: model.visible ?? (following || (saved[provider] ?? []).includes(model.id)),
      effort: settings?.defaultEfforts?.[model.id],
      onVisible: (visible: boolean) => setVisible(model, visible),
      onEffort: (effort: string | null) => { void post({ defaultEffort: { model: model.id, effort } }) },
    }))) : null,
    cards.length ? h('div', { className: 'dmg-cards' }, ...cards.map(card => h(UsageCard, { key: cardKey(card), card, busy, onRefresh: () => onRefresh(card) }))) : null,
    notice === 'not-reread' ? h('p', { className: 'dmg-hint', role: 'status' }, NOT_REREAD) : null,
    alert ? h('p', { className: 'dmg-error', role: 'alert', 'data-usage-alert': '' }, alert) : null,
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
