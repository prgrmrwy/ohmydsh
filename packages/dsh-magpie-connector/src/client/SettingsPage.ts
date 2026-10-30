import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconTrashOutlineRegular, IconTriangleRightFillRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, failureText, isOk, type Api } from './api.js'
import { lineLatency, parseLatency, type LatencyState, type LineLatency } from './latency.js'
import { settingsCss } from './styles.js'
import { UsageCard } from './UsageCard.js'
import {
  cacheIds, cardKey, checkDiff, checkSignature, formatTime, parseCards, parseCheck, providerOrder, readTime, sameTarget,
  type Card, type CardsView, type CheckSnapshot, type ModelGroup, type ModelRow, type SettingsView, type SyncErrorKind,
} from './view-model.js'

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
const SYNC_KIND: Record<SyncErrorKind, string> = { unauthorized: 'key 无效（401）', forbidden: '无权访问（403）', http: '网关错误', unreachable: '无法连接网关', settings: '设置保存失败', registration: '路由注册失败' }
/** Human labels for the check kinds the host may report. */
const CHECK_KIND: Record<string, string> = {
  ok: '可达', unauthorized: 'key 无效', forbidden: '无权访问', http: '网关错误', redirect: '被重定向',
  unreachable: '连不上', timeout: '超时', 'invalid-catalog': '目录无法解析', incomplete: '配置不完整',
  invalid: '请求无效', busy: '已有检查在进行', pending: '宿主正在保存，稍后再试',
}
const CHECK_UNSUPPORTED = '当前宿主版本不支持线路检查'
const ACCESS_FIELDS = ['accessClientId', 'accessClientSecret'] as const

type Target = { all: true } | { provider: string; user?: string }
type Notice = 'not-reread' | 'restricted'
/** Where a refresh outcome is shown: a provider group, or the connection panel for the all-target fallback. */
type NoteScope = string | undefined
type SettingsResult = { view?: SettingsView; error?: string }
type SettingsMutation = (body: Record<string, unknown> | ((current: SettingsView) => Record<string, unknown>)) => Promise<SettingsResult | undefined>
/** One rendered check result, bound to the draft it was produced from and to the then-active line. */
type CheckEntry = { signature: string; activeLineId: string | null; result: CheckSnapshot }
type SubmittedLine = { id?: string; baseUrl?: string; accessMode?: string; key?: string; accessClientId?: string | null; accessClientSecret?: string | null }

/**
 * Does this submitted list touch the active line's identity? Only then the old usage cards must
 * disappear before the request is even sent (the host writes credentials before awaiting its
 * catalog sync, which can take up to 15s).
 */
export function touchesActiveIdentity(lines: unknown[], view: SettingsView): boolean {
  const activeId = view.activeLineId
  if (!activeId) return false
  const active = (view.lines ?? []).find(line => line.id === activeId)
  if (!active) return false
  const submitted = lines.filter((line): line is SubmittedLine => !!line && typeof line === 'object')
  const entry = submitted.find(line => line.id === activeId)
  if (!entry) return true
  if (typeof entry.baseUrl === 'string' && entry.baseUrl !== (active.baseUrl ?? '')) return true
  if (typeof entry.accessMode === 'string' && entry.accessMode !== (active.accessMode ?? 'direct')) return true
  if (typeof entry.key === 'string' && entry.key !== '') return true
  return ACCESS_FIELDS.some(field => typeof entry[field] === 'string' && entry[field] !== '')
}

/** One line of the read-only snapshot: kind, model count, diff against the cache and latency. */
export function describeCheck(snapshot: CheckSnapshot, diff: { added: string[]; removed: string[] } | undefined, lastSyncAt: string | undefined): string {
  const parts = [CHECK_KIND[snapshot.kind] ?? snapshot.kind]
  if (snapshot.kind === 'ok') {
    parts.push(`${snapshot.modelCount ?? snapshot.models?.length ?? 0} 个模型`)
    if (diff) parts.push(diff.added.length === 0 && diff.removed.length === 0 ? `与缓存目录一致${lastSyncAt ? `（缓存于 ${formatTime(lastSyncAt)}）` : ''}` : `多 ${diff.added.length} · 少 ${diff.removed.length}`)
  }
  if (snapshot.gatewayStatus !== undefined) parts.push(`HTTP ${snapshot.gatewayStatus}`)
  parts.push(`${snapshot.latencyMs}ms`)
  return parts.join(' · ')
}

export function MagpieSettings({ api }: { api: Api }) {
  const [settings, setSettings] = useState<SettingsView>()
  const [settingsError, setSettingsError] = useState('')
  const [cards, setCards] = useState<CardsView>()
  const [refreshing, setRefreshing] = useState<Target>()
  const [notice, setNotice] = useState<Notice>()
  const [noteScope, setNoteScope] = useState<NoteScope>()
  const [usageAlert, setUsageAlert] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [latency, setLatency] = useState<LatencyState>({ phase: 'idle' })
  const settingsRef = useRef<SettingsView | undefined>(undefined)
  const settingsVersion = useRef(0)
  const settingsLock = useRef(false)
  const cardsEpoch = useRef(0)
  const latencyEpoch = useRef(0)
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
  /** One measurement per panel open (and after a successful line write); failures stay silent. */
  const readLatency = async () => {
    const epoch = ++latencyEpoch.current
    setLatency({ phase: 'measuring' })
    try {
      const response = await api({ method: 'GET', path: 'latency' })
      if (epoch !== latencyEpoch.current) return
      const readings = isOk(response) ? parseLatency(response.body) : undefined
      setLatency(readings ? { phase: 'done', readings } : { phase: 'failed' })
    } catch {
      if (epoch === latencyEpoch.current) setLatency({ phase: 'failed' })
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
    void readLatency()
    return () => { ++settingsVersion.current; ++cardsEpoch.current; ++latencyEpoch.current }
  }, [api])

  /**
   * After an isolated failure the old cards must not come back: reread the host's truth (settings
   * plus cards, both redacted) instead of restoring what the user saw before the write.
   */
  const rereadAfterFailure = async (epoch: number) => {
    try {
      const response = await api({ method: 'GET', path: 'settings' })
      if (epoch !== cardsEpoch.current) return
      if (isOk(response)) { commitSettings(response.body as SettingsView); void readCards(epoch) }
      else setSettingsError(failureText(response))
    } catch (error) { if (epoch === cardsEpoch.current) setSettingsError(errorText(error)) }
  }

  const mutateSettings: SettingsMutation = async change => {
    // Ref acquisition is synchronous: disabled props alone cannot stop same-tick writes.
    if (settingsLock.current || !settingsRef.current) return
    settingsLock.current = true; setSavingSettings(true)
    const version = ++settingsVersion.current
    const body = typeof change === 'function' ? change(settingsRef.current) : change
    const before = settingsRef.current
    const beforeActive = before.activeLineId ?? null
    const submitted = Array.isArray(body.lines) ? body.lines as unknown[] : undefined
    // Submit-time isolation: only a write that can change the active identity hides the cards.
    const isolated = submitted !== undefined && touchesActiveIdentity(submitted, before)
    const epoch = isolated ? clearUsage() : cardsEpoch.current
    try {
      const result = await postSettings(api, body)
      if (version !== settingsVersion.current) return
      const switched = !!result.view && (result.view.activeLineId ?? null) !== beforeActive
      if (result.view) {
        commitSettings(result.view)
        if (submitted !== undefined) void readLatency()
        if (isolated) void readCards(epoch)
        else if (switched) { clearUsage(); void readCards(cardsEpoch.current) }
      } else if (isolated) {
        void rereadAfterFailure(epoch)
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
    settings ? h(Connection, { settings, saving: savingSettings, mutateSettings, api, latency,
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
const INFO_TEXT = '线路按序号优先尝试，连不上自动试下一条；绿色方块表示当前线路；多条线路应指向同一个 Magpie 网关；延迟是 TCP 建连耗时（含 DNS 解析），不是网关健康检查。'
const hostnameOf = (baseUrl: string) => { try { return new URL(baseUrl).hostname || baseUrl } catch { return baseUrl || '未配置' } }

interface LineDraft {
  draftId: string; id?: string; baseUrl: string; accessMode: AccessMode; savedAccess: boolean
  keyConfigured: boolean; keyWritable: boolean; apiKey: string
  accessConfigured: boolean; accessWritable: boolean; accessClientId: string; accessClientSecret: string
  /** Host-reported completeness of the saved line (never of the unsaved draft). */
  complete: boolean
}

function lineDrafts(settings: SettingsView): LineDraft[] {
  const configured = (access: { clientId?: { configured?: boolean }; clientSecret?: { configured?: boolean } } | undefined) => access?.clientId?.configured === true || access?.clientSecret?.configured === true
  const source = (settings.lines ?? []).map(line => ({ id: line.id, baseUrl: line.baseUrl ?? '', accessMode: (line.accessMode ?? 'direct') as AccessMode, key: line.key, access: line.access, complete: line.complete !== false }))
  return source.map((line, index) => ({
    draftId: line.id ?? `new-${index}`, ...(line.id ? { id: line.id } : {}), baseUrl: line.baseUrl, accessMode: line.accessMode,
    savedAccess: line.accessMode === 'cloudflare', keyConfigured: line.key?.configured === true, keyWritable: line.key?.writable !== false, apiKey: '',
    accessConfigured: configured(line.access), accessWritable: line.access?.clientId?.writable !== false && line.access?.clientSecret?.writable !== false,
    accessClientId: '', accessClientSecret: '', complete: line.complete,
  }))
}
const lineSignature = (draft: LineDraft) => JSON.stringify([draft.id ?? null, draft.baseUrl.trim(), draft.accessMode])

function Connection({ settings, saving, mutateSettings, api, usage, latency }: { settings: SettingsView; saving: boolean; mutateSettings: SettingsMutation; api: Api; usage: ReactNode; latency: LatencyState }) {
  const baseline = lineDrafts(settings)
  const [drafts, setDrafts] = useState<LineDraft[]>(baseline)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; failed: boolean }>()
  // Save-time position of the pending (unsaved) draft: it keeps the row expanded
  // across the response that replaces its synthetic id with the host-assigned id.
  const pendingDraftId = useRef<string | null>(null)
  const pendingIndex = useRef<number | null>(null)
  const awaitingSave = useRef(false)
  // An isolated failure rereads settings from the host; the user's unsaved edits
  // must survive that reread (a failed save keeps the drafts as typed).
  const keepDrafts = useRef(false)
  const [checks, setChecks] = useState<Record<string, CheckEntry>>({})
  const [checking, setChecking] = useState<string>()
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({})
  const [checkUnsupported, setCheckUnsupported] = useState(false)
  const checkLock = useRef(false)
  const checkEpoch = useRef(0)
  useEffect(() => {
    const next = lineDrafts(settings)
    const preserve = keepDrafts.current
    keepDrafts.current = false
    if (preserve) {
      // Keep the typed edits, but adopt identity/completeness the host may have
      // persisted before the failed write (a partial save can assign an id).
      setDrafts(current => current.length === next.length
        ? current.map((draft, position) => {
            const saved = next[position]!
            return { ...draft, ...(saved.id ? { id: saved.id } : {}), complete: saved.complete, keyConfigured: saved.keyConfigured, keyWritable: saved.keyWritable, accessConfigured: saved.accessConfigured, accessWritable: saved.accessWritable }
          })
        : current)
    } else setDrafts(next)
    if (awaitingSave.current) {
      awaitingSave.current = false
      const index = pendingIndex.current
      pendingIndex.current = null
      setExpanded(current => current && next.some(draft => draft.draftId === current) ? current : (index !== null && next[index] ? next[index]!.draftId : null))
      pendingDraftId.current = null
    } else {
      setExpanded(current => current && next.some(draft => draft.draftId === current) ? current : null)
    }
  }, [settings])
  // Legacy hosts have no line list: keep line 1 marked active. A v2 host that
  // reports a null/absent active line (nothing complete) must show no marker.
  const activeId = settings.activeLineId ?? null
  const update = (draftId: string, patch: Partial<LineDraft>) => setDrafts(current => current.map(draft => draft.draftId === draftId ? { ...draft, ...patch } : draft))
  const move = (index: number, delta: number) => setDrafts(current => {
    const target = index + delta; if (target < 0 || target >= current.length) return current
    const next = [...current]; const swap = next[index]!; next[index] = next[target]!; next[target] = swap; return next
  })
  const remove = (draftId: string) => setDrafts(current => {
    if (current.length <= 1) return current
    if (pendingDraftId.current === draftId) pendingDraftId.current = null
    return current.filter(draft => draft.draftId !== draftId)
  })
  const add = () => setDrafts(current => {
    const draft: LineDraft = { draftId: `new-${current.length}-${Date.now()}`, baseUrl: '', accessMode: 'direct', savedAccess: false, keyConfigured: false, keyWritable: true, apiKey: '', accessConfigured: false, accessWritable: true, accessClientId: '', accessClientSecret: '', complete: false }
    pendingDraftId.current = draft.draftId
    setExpanded(draft.draftId); return [...current, draft]
  })
  const dirty = drafts.length !== baseline.length || drafts.some((draft, index) => {
    const before = baseline[index]
    return !before || lineSignature(draft) !== lineSignature(before) || !!draft.apiKey
      || (draft.accessMode === 'cloudflare' && (!!draft.accessClientId || !!draft.accessClientSecret))
      || (draft.accessMode === 'direct' && draft.savedAccess)
  })
  const dropChecks = () => { checkEpoch.current++; checkLock.current = false; setChecking(undefined); setChecks({}); setCheckErrors({}) }
  const post = async (body: Record<string, unknown>, done: string | ((view: SettingsView) => string)) => {
    setMessage(undefined)
    const result = await mutateSettings(body)
    if (!result?.view) { awaitingSave.current = false; pendingIndex.current = null; keepDrafts.current = true }
    if (!result) return
    if (result.view) setMessage({ text: typeof done === 'function' ? done(result.view) : done, failed: false })
    else setMessage({ text: result.error!, failed: true })
  }
  const savedLabel = (view: SettingsView) => {
    const index = (view.lines ?? []).findIndex(line => line.id === view.activeLineId)
    return index >= 0 ? `已保存 · 当前线路 ${index + 1}` : '已保存 · 当前无生效线路'
  }
  const save = () => {
    // A save attempt retires every snapshot: the checked draft is about to become the saved one,
    // and a failed save must not leave a result that no longer matches what the row shows.
    dropChecks()
    const pending = drafts.findIndex(draft => draft.draftId === pendingDraftId.current && !draft.id)
    pendingIndex.current = pending >= 0 ? pending : null
    awaitingSave.current = true
    const lines = drafts.map(draft => ({
      ...(draft.id ? { id: draft.id } : {}),
      baseUrl: draft.baseUrl.trim(), accessMode: draft.accessMode,
      ...(draft.apiKey ? { key: draft.apiKey } : {}),
      ...(draft.accessMode === 'cloudflare'
        ? { ...(draft.accessClientId ? { accessClientId: draft.accessClientId } : {}), ...(draft.accessClientSecret ? { accessClientSecret: draft.accessClientSecret } : {}) }
        : (draft.savedAccess ? { accessClientId: null, accessClientSecret: null } : {})),
    }))
    void post({ lines }, view => { dropChecks(); return savedLabel(view) })
  }
  const runCheck = async (draft: LineDraft) => {
    if (checkLock.current || checkUnsupported) return
    checkLock.current = true
    const epoch = ++checkEpoch.current
    const signature = checkSignature(draft)
    setChecking(draft.draftId)
    setCheckErrors(current => { const next = { ...current }; delete next[draft.draftId]; return next })
    try {
      const body: Record<string, unknown> = { baseUrl: draft.baseUrl.trim(), accessMode: draft.accessMode }
      if (draft.id) body.id = draft.id
      if (draft.apiKey) body.key = draft.apiKey
      if (draft.accessMode === 'cloudflare') {
        if (draft.accessClientId) body.accessClientId = draft.accessClientId
        if (draft.accessClientSecret) body.accessClientSecret = draft.accessClientSecret
      }
      const response = await api({ method: 'POST', path: 'line-check', body })
      if (epoch !== checkEpoch.current) return
      if (response.status === 404) { setCheckUnsupported(true); return }
      const snapshot = parseCheck(response.body)
      if (!snapshot) {
        setCheckErrors(current => ({ ...current, [draft.draftId]: isOk(response) ? '检查结果无法解析' : failureText(response) }))
        return
      }
      setChecks(current => ({ ...current, [draft.draftId]: { signature, activeLineId: activeId, result: snapshot } }))
    } catch (error) {
      if (epoch === checkEpoch.current) setCheckErrors(current => ({ ...current, [draft.draftId]: `检查失败：${errorText(error)}` }))
    } finally {
      if (epoch === checkEpoch.current) { checkLock.current = false; setChecking(undefined) }
    }
  }
  const clearCheck = (draftId: string) => {
    checkEpoch.current++
    setChecks(current => { const next = { ...current }; delete next[draftId]; return next })
    setCheckErrors(current => { const next = { ...current }; delete next[draftId]; return next })
  }
  const catalogIds = cacheIds(settings.groups)
  return h('section', { className: 'dmg-panel', 'aria-label': '连接' },
    h('div', { className: 'dmg-head' },
      h('h3', null, '连接'),
      h('span', { className: 'dmg-info', role: 'img', tabIndex: 0, 'aria-label': INFO_TEXT, title: INFO_TEXT }, 'ⓘ')),
    drafts.length === 0 ? h('p', { className: 'dmg-hint' }, '还没有线路。点击「添加线路」填写网关地址与 key。') : null,
    h('div', { className: 'dmg-lines' },
      ...drafts.map((draft, index) => {
        const entry = checks[draft.draftId]
        const fresh = entry && entry.signature === checkSignature(draft) && entry.activeLineId === activeId ? entry : undefined
        return h(LineCard, {
          key: draft.draftId, draft, index, total: drafts.length, saving,
          active: !!draft.id && draft.id === activeId,
          expanded: expanded === draft.draftId,
          latency: lineLatency(latency, draft),
          checking: checking === draft.draftId, checkDisabled: checking !== undefined || checkUnsupported,
          check: fresh?.result, checkError: checkErrors[draft.draftId],
          diff: fresh?.result && catalogIds.length > 0 && settings.lastSyncAt ? checkDiff(fresh.result, catalogIds) : undefined,
          lastSyncAt: settings.lastSyncAt,
          onToggle: () => setExpanded(current => current === draft.draftId ? null : draft.draftId),
          onChange: (patch: Partial<LineDraft>) => update(draft.draftId, patch),
          onMove: (delta: number) => move(index, delta),
          onRemove: () => remove(draft.draftId),
          onCheck: () => { void runCheck(draft) },
          onClearCheck: () => clearCheck(draft.draftId),
        })
      })),
    h('div', { className: 'dmg-row' },
      h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: add }, drafts.length ? '添加备用线路' : '添加线路')),
    h('div', { className: 'dmg-row' },
      h('button', { type: 'button', className: 'dmg-button', disabled: saving || !dirty, onClick: save }, saving ? '保存中…' : '保存'),
      h('button', { type: 'button', className: 'dmg-button', disabled: saving, onClick: () => { void post({ resync: true }, '已刷新模型列表') } }, '刷新模型列表')),
    h(SyncStatus, { settings }),
    message ? h('p', { className: message.failed ? 'dmg-error' : 'dmg-ok', ...(message.failed ? { role: 'alert' } : {}) }, message.text) : null,
    usage)
}

function iconButton(name: string, icon: ReactNode, lineLabel: string, disabled: boolean, onClick: () => void, reason?: string) {
  const action = `${name}线路 ${lineLabel}`
  const label = disabled && reason ? `${action}（${reason}）` : action
  const button = h('button', { type: 'button', className: 'dmg-icon-button', 'aria-label': label, 'data-action': name, disabled, onClick },
    h('span', { className: 'dmg-icon', 'aria-hidden': true }, icon))
  return disabled ? button : h(Tooltip, { label: action, children: button })
}

/** Per-row latency cell: 4 signal bars plus the reading; only rows that should have a reading are non-idle. */
function LatencySlot({ latency }: { latency: LineLatency }) {
  const attrs: Record<string, string> = { className: 'dmg-latency', 'data-latency': '', 'data-latency-state': latency.state }
  const level = latency.level ?? 0
  if (latency.state === 'done') {
    attrs['data-latency-level'] = String(level)
    attrs['data-latency-ms'] = latency.ms === null || latency.ms === undefined ? '' : String(latency.ms)
  }
  const reading = latency.state === 'done' && latency.ms !== null && latency.ms !== undefined
  const text = latency.state === 'measuring' ? '测速中…' : latency.state === 'failed' ? '—' : latency.state === 'done' ? (reading ? `${latency.ms} ms` : '超时') : ''
  const title = latency.state === 'done' ? (reading ? `TCP 建连耗时 ${latency.ms} ms（含 DNS 解析），不是网关健康检查` : '600ms 内未完成 TCP 建连（可能很慢或不可达）') : undefined
  return h('span', { ...attrs, ...(title ? { title } : {}) },
    reading ? h('span', { className: 'dmg-bars', 'aria-hidden': true, 'data-level': String(level) },
      ...[0, 1, 2, 3].map(index => h('i', { key: index, 'data-on': index < level ? 'true' : 'false' }))) : null,
    h('span', { className: 'dmg-latency-text' }, text))
}

function LineCard({ draft, index, total, saving, active, expanded, latency, checking, checkDisabled, check, checkError, diff, lastSyncAt, onToggle, onChange, onMove, onRemove, onCheck, onClearCheck }: {
  draft: LineDraft; index: number; total: number; saving: boolean; active: boolean; expanded: boolean; latency: LineLatency
  checking: boolean; checkDisabled: boolean; check?: CheckSnapshot | undefined; checkError?: string | undefined
  diff?: { added: string[]; removed: string[] } | undefined; lastSyncAt?: string | undefined
  onToggle: () => void; onChange: (patch: Partial<LineDraft>) => void; onMove: (delta: number) => void; onRemove: () => void
  onCheck: () => void; onClearCheck: () => void
}) {
  const diffParts = diff ? [
    diff.added.length ? h('p', { key: 'added', className: 'dmg-hint' }, `多出：${diff.added.join('、')}`) : null,
    diff.removed.length ? h('p', { key: 'removed', className: 'dmg-hint' }, `缺少：${diff.removed.join('、')}`) : null,
  ].filter(Boolean) : []
  const lineLabel = String(index + 1)
  const bodyId = `dmg-line-body-${draft.draftId}`
  return h('div', { className: 'dmg-line', 'data-line-id': draft.id, 'data-draft': draft.id ? undefined : '', 'data-expanded': expanded ? 'true' : 'false' },
    h('div', { className: 'dmg-line-head' },
      h('button', { type: 'button', className: 'dmg-line-toggle', 'aria-expanded': expanded, ...(expanded ? { 'aria-controls': bodyId } : {}), 'data-toggle': '', onClick: onToggle },
        h('span', { className: 'dmg-chevron', 'aria-hidden': true }, h(IconTriangleRightFillRegular, null)),
        h('span', { className: 'dmg-line-index' }, `线路 ${lineLabel}`),
        active ? h('span', { className: 'dmg-active', role: 'img', 'aria-label': '当前线路', title: '当前线路', 'data-active-line': draft.id }) : null,
        draft.id && !draft.complete ? h('span', { className: 'dmg-unset', 'data-line-incomplete': '' }, '未配置') : null,
        h('span', { className: 'dmg-line-title' }, `${hostnameOf(draft.baseUrl)}${draft.id ? '' : '（未保存）'}`),
        h(LatencySlot, { latency })),
      h('div', { className: 'dmg-line-actions' },
        iconButton('上移', h(IconChevronUpOutlineRegular, null), lineLabel, saving || index === 0, () => onMove(-1), '已是第一条'),
        iconButton('下移', h(IconChevronDownOutlineRegular, null), lineLabel, saving || index === total - 1, () => onMove(1), '已是最后一条'),
        iconButton('删除', h(IconTrashOutlineRegular, null), lineLabel, saving || total <= 1, onRemove, '仅剩一条'))),
    expanded ? h('div', { className: 'dmg-line-body', id: bodyId },
      h('label', { className: 'dmg-field' }, h('span', null, '网关地址（含 /v1）'),
        h('input', { className: 'dmg-input', value: draft.baseUrl, disabled: saving, placeholder: 'http://127.0.0.1:3425/v1', onChange: (e: { target: { value: string } }) => onChange({ baseUrl: e.target.value }) })),
      h('label', { className: 'dmg-field' }, h('span', null, `Gateway API key · ${draft.keyConfigured ? '已配置' : '未配置'}${draft.keyWritable ? '' : '（来自启动环境，只读）'}`),
        h('input', { className: 'dmg-input', type: 'password', autoComplete: 'off', value: draft.apiKey, disabled: saving || !draft.keyWritable,
          placeholder: draft.keyConfigured ? '留空则保持不变' : '必填', onChange: (e: { target: { value: string } }) => onChange({ apiKey: e.target.value }) })),
      h('div', { className: 'dmg-check', 'data-check': '' },
        h('div', { className: 'dmg-row' },
          h('button', {
            type: 'button', className: 'dmg-button', 'data-check-run': '',
            disabled: saving || checkDisabled || draft.baseUrl.trim() === '', onClick: onCheck,
          }, checking ? '检查中…' : '检查线路'),
          check ? h('button', { type: 'button', className: 'dmg-button', disabled: saving || checking, onClick: onClearCheck }, '清除') : null),
        h('p', { className: 'dmg-hint' }, '只读快照：不改当前线路，也不写入配置。'),
        checkError ? h('p', { className: 'dmg-error' }, checkError) : null,
        check ? h('p', { className: 'dmg-check-line', 'data-check-kind': check.kind }, describeCheck(check, diff, lastSyncAt)) : null,
        check?.reason ? h('p', { className: 'dmg-hint', 'data-check-reason': '' }, check.reason) : null,
        check?.models?.length ? h('details', { className: 'dmg-check-models' },
          h('summary', null, `模型 id（${check.models.length}）`),
          ...diffParts,
          h('p', { className: 'dmg-hint' }, check.models.map(model => model.id).join('、'))) : null),
      h('details', { className: 'dmg-advanced', open: true, 'data-advanced': '' },
        h('summary', null, '高级连接'),
        h('div', { className: 'dmg-advanced-body' },
          h('label', { className: 'dmg-field' }, h('span', null, `接入方式${draft.accessWritable ? '' : '（Access 凭据来自启动环境，只读）'}`),
            h('select', { className: 'dmg-select', 'aria-label': '接入方式', value: draft.accessMode, disabled: saving || !draft.accessWritable,
              onChange: (e: { target: { value: string } }) => onChange({ accessMode: e.target.value as AccessMode }) },
            ...ACCESS_MODES.map(mode => h('option', { key: mode.id, value: mode.id }, mode.label)))),
          draft.accessMode === 'direct'
            ? h('p', { className: 'dmg-hint' }, draft.savedAccess ? '保存后将清除已保存的 Cloudflare Access 凭据。' : '网关地址可直接访问时选择（局域网、Tailscale 等组网后的地址）。')
            : h('p', { className: 'dmg-hint' }, '网关在 Cloudflare Access 之后时选择：填写服务令牌的两项，仅支持 HTTPS。留空保持不变。'),
          ...(draft.accessMode === 'cloudflare' ? ([
            ['Access Client ID', draft.accessClientId, 'accessClientId'],
            ['Access Client Secret', draft.accessClientSecret, 'accessClientSecret'],
          ] as const).map(([label, value, field]) => h('label', { key: label, className: 'dmg-field' },
            h('span', null, `${label} · ${draft.accessConfigured ? '已配置' : '未配置'}${draft.accessWritable ? '' : '（来自启动环境，只读）'}`),
            h('input', { className: 'dmg-input', type: 'password', autoComplete: 'off', value,
              disabled: saving || !draft.accessWritable, placeholder: '留空则保持不变',
              onChange: (e: { target: { value: string } }) => onChange({ [field]: e.target.value } as Partial<LineDraft>) }))) : [])))) : null)
}

function SyncStatus({ settings }: { settings: SettingsView }) {
  const count = (settings.groups ?? []).reduce((n, g) => n + g.models.length, 0)
  const rejected = settings.rejectedOwners ?? []
  const registration = settings.routeRegistrationError
  return h('div', { className: 'dmg-meta', 'data-sync': '' },
    settings.lastSyncAt ? h('p', null, `共 ${count} 个模型 · 更新于 `, h('time', { dateTime: settings.lastSyncAt }, formatTime(settings.lastSyncAt))) : null,
    settings.lastSyncError ? h('p', { className: 'dmg-error' },
      `同步失败${settings.lastSyncErrorKind ? `（${SYNC_KIND[settings.lastSyncErrorKind] ?? settings.lastSyncErrorKind}）` : ''}：${settings.lastSyncError}`) : null,
    registration ? h('p', { className: 'dmg-error', role: 'alert' },
      `Magpie 路由注册失败（${registration.code}${registration.route ? `，${registration.route}` : ''}）：需重启 Host 后才能恢复。`) : null,
    settings.knownOwnersReset ? h('p', { className: 'dmg-hint' }, '归属列表已重置：已保存的归属无效，下次同步会重新建立。') : null,
    settings.ownerLimitReached ? h('p', { className: 'dmg-hint' },
      `归属数量已达上限（32 个），以下归属未能加入：${rejected.join('、')}`) : null)
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
