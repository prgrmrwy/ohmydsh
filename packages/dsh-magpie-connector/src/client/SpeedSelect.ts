import { createElement as h, useEffect, useRef, useState } from 'react'
import { isOk, type Api } from './api.js'
import { settingsCss } from './styles.js'

/**
 * Composer speed control (`conversation.input.right`): standard / fast for
 * models whose gateway catalog advertises the `priority` service tier. The
 * choice lives in host memory per session (design D9); this component only
 * views it. It renders nothing unless the session's current model is a
 * `dsh-magpie-connector` model listed in `fastModels`.
 */
export const ROUTE = 'dsh-magpie-connector'
export type Tier = 'standard' | 'fast'
export interface SpeedState { visible: boolean; tier: Tier }
export interface ModelDirectories { directoryFor(sessionId: string): { load(): Promise<{ current: { provider: string; model: string } | null }> } }

export function createSpeedLoader(api: Api, models: () => ModelDirectories | undefined, sessionId: string): () => Promise<SpeedState> {
  return async () => {
    const directories = models()
    const current = directories === undefined ? null : (await directories.directoryFor(sessionId).load()).current
    const response = await api({ method: 'GET', path: 'speed', query: { session: sessionId } })
    if (!isOk(response)) throw new Error(`HTTP ${response.status}`)
    const body = response.body as { tier?: unknown; fastModels?: unknown }
    const fastModels = Array.isArray(body.fastModels) ? body.fastModels.filter((m): m is string => typeof m === 'string') : []
    const tier: Tier = body.tier === 'fast' ? 'fast' : 'standard'
    return { visible: current !== null && current.provider === ROUTE && fastModels.includes(current.model), tier }
  }
}

export function createSpeedSetter(api: Api, sessionId: string): (tier: Tier) => Promise<boolean> {
  return tier => api({ method: 'POST', path: 'speed', body: { session: sessionId, tier } }).then(isOk, () => false)
}

const POLL_MS = 3000
const TIERS: { id: Tier; name: string; description: string }[] = [
  { id: 'standard', name: '标准', description: '默认速度与用量' },
  { id: 'fast', name: '快速', description: '请求带 priority 服务档，更快但消耗更多用量' },
]

export function SpeedSelect({ loadSpeed, setSpeed }: { loadSpeed?: () => Promise<SpeedState>; setSpeed?: (tier: Tier) => Promise<boolean> }) {
  const [state, setState] = useState<SpeedState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const loadRef = useRef(loadSpeed)
  const requests = useRef({ active: false, read: 0, mutation: 0, writing: false })
  loadRef.current = loadSpeed
  const reload = async () => {
    const load = loadRef.current
    const current = requests.current
    if (!load || !current.active) return
    const version = ++current.read
    const mutation = current.mutation
    try {
      const next = await load()
      if (!current.active || version !== current.read || mutation !== current.mutation) return
      // During a write, model visibility may change but the tier is not confirmed yet.
      const writing = current.writing
      setState(previous => writing && previous ? { ...next, tier: previous.tier } : next)
      if (!next.visible) setOpen(false)
    } catch { /* A failed read keeps the last known state. */ }
  }
  // The host pushes nothing on a model switch, so keep a slow single-flight poll.
  useEffect(() => {
    const current = requests.current
    current.active = true
    let inflight = false
    const poll = () => {
      if (inflight) return
      inflight = true
      void reload().finally(() => { inflight = false })
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      current.active = false
      current.read++
      current.mutation++
      clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])
  if (!loadSpeed || !setSpeed || !state?.visible) return null
  const choose = async (tier: Tier) => {
    const current = requests.current
    if (!current.active || current.writing) return
    if (tier === state.tier) { setOpen(false); return }
    current.writing = true
    const mutation = ++current.mutation
    current.read++
    setBusy(true)
    setFailed(false)
    let ok = false
    try { ok = await setSpeed(tier) } catch { /* Treat a rejected save like a non-2xx response. */ }
    if (!current.active || mutation !== current.mutation) return
    current.writing = false
    current.mutation++
    current.read++
    setBusy(false)
    if (ok) {
      setState(previous => previous ? { ...previous, tier } : previous)
      setOpen(false)
      void reload()
    } else setFailed(true)
  }
  const label = `速度 · ${TIERS.find(t => t.id === state.tier)!.name}`
  return h('div', {
    ref: rootRef, className: 'dmg-speed', 'data-magpie-speed': '',
    onKeyDown: (event: { key: string; preventDefault(): void }) => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false) } },
  },
  h('style', null, settingsCss),
  failed ? h('span', { className: 'dmg-error', role: 'alert' }, '速度未保存，请重试') : null,
  open ? h('div', { className: 'dmg-speed-menu', role: 'menu', 'aria-label': '速度' }, ...TIERS.map(tier => h('button', {
    key: tier.id, type: 'button', role: 'menuitemradio', className: 'dmg-speed-item', 'data-tier': tier.id,
    'aria-checked': tier.id === state.tier, disabled: busy, onClick: () => choose(tier.id),
  }, h('span', null, tier.id === state.tier ? '✓' : ''), h('span', null, tier.name, h('small', null, tier.description))))) : null,
  h('button', {
    type: 'button', className: 'dmg-speed-trigger', 'aria-haspopup': 'menu', 'aria-expanded': open, title: label, disabled: busy,
    onClick: () => {
      if (open) { setOpen(false); return }
      setOpen(true)
      void reload()
    },
  }, label))
}
