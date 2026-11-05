import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, type Api } from './api.js'
import { ensureStyles } from './styles.js'
import { t } from './locales.js'
import { loadCards, refreshCards } from './sidebar-api.js'
import { DEFAULT_REFRESH_MINUTES, hydrateSidebarPreference, readSidebarPreference, subscribeSidebarPreference, type SidebarPreference } from './sidebar-preference.js'
import {
  ageMinutes, cardIdentity, cardReadTime, formatResetDeadline, formatResetShort, formatUsed, sidebarRows, unchangedReads, usedLevel,
  type SidebarRow, type SidebarWindowRow,
} from './sidebar-view.js'
import { DEFAULT_SIDEBAR_WINDOWS } from '../shared/sidebar-window.js'
import { formatTime, type Card, type CardWindow, type CardsView } from './view-model.js'

/**
 * Sidebar usage card (`sidebar.footer.action`, owner prop `wide`).
 *
 * Wide sidebar: an accordion. The header row is the only interactive surface
 * (except the refresh button): clicking it toggles the detail, which grows in
 * flow and takes height away from the session list instead of covering it.
 * Collapsed, it shows one weekly row per upstream (the body caps at 320px) plus a
 * decorative overflow chevron. Collapsed sidebar: one icon that opens the same
 * content as a 320px anchored popover.
 *
 * Reads are event-driven through `sidebar-api` (60s TTL). The opt-in timer is
 * the one exception: it performs a real refresh (`POST {all:true}`) because the
 * gateway answers a card read from its kept cards and only re-reads a vendor
 * when a refresh is asked for.
 */
export interface SidebarUsageProps {
  api?: Api
  wide?: boolean
}

const RAIL_POPOVER_WIDTH = 320

export function SidebarUsage({ api, wide = true }: SidebarUsageProps) {
  const [preference, setPreference] = useState<SidebarPreference | undefined>(() => readSidebarPreference())
  const [view, setView] = useState<CardsView | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const anchorRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // Document-level stylesheet: a slot remount must not be able to drop it.
  useLayoutEffect(() => { ensureStyles() })
  const [bodyOverflow, setBodyOverflow] = useState(false)
  const [bodyMore, setBodyMore] = useState(false)
  const [detailOverflow, setDetailOverflow] = useState(false)
  const [detailMore, setDetailMore] = useState(false)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<CardsView | undefined>(undefined)
  viewRef.current = view

  // Follow the host preference (hydrated once per page, then kept live by the
  // settings toggle through the module store).
  useEffect(() => {
    const unsubscribe = subscribeSidebarPreference(value => setPreference(value))
    void hydrateSidebarPreference(api).then(() => setPreference(readSidebarPreference()))
    return unsubscribe
  }, [api])
  const enabled = preference?.usage
  const refreshMinutes = preference?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES
  const windows = preference?.windows ?? [...DEFAULT_SIDEBAR_WINDOWS]

  useEffect(() => {
    if (enabled !== true || api === undefined) return
    let alive = true
    void loadCards(api).then(next => { if (alive) setView(next) }, reason => { if (alive) setError(errorText(reason)) })
    return () => { alive = false }
  }, [enabled, api])

  // The collapsed body caps at 320px in CSS. Track whether a surface overflows
  // (so the hint band can reserve its space) and whether content is still below
  // the fold (so the glyph shows without the band itself coming and going).
  useLayoutEffect(() => {
    const sync = (): void => {
      const body = bodyRef.current
      setBodyOverflow(overflows(body))
      setBodyMore(belowFold(body))
      const detail = detailRef.current
      setDetailOverflow(overflows(detail))
      setDetailMore(belowFold(detail))
    }
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    for (const element of [bodyRef.current, detailRef.current]) if (element !== null) observer.observe(element)
    for (const element of Array.from(bodyRef.current?.children ?? [])) if (element instanceof HTMLElement) observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, open, view])

  // Returning to the page re-reads once (the 60s TTL suppresses it otherwise).
  useEffect(() => {
    if (enabled !== true || api === undefined) return
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return
      void loadCards(api).then(setView, () => { /* keep the last reading */ })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [enabled, api])

  // Auto refresh: only when the card is enabled and the interval is positive.
  // It must be a real refresh, not a read: the gateway answers `GET cards` from
  // the cards it last read and only asks a vendor again on `POST refresh`, so a
  // timer that re-read would show the same frozen reading forever. A chained
  // timeout avoids overlap; a failure keeps the last reading silently; a hidden
  // page only reschedules (the visibility listener above re-reads once the page
  // returns).
  useEffect(() => {
    if (enabled !== true || api === undefined || refreshMinutes <= 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const interval = refreshMinutes * 60_000
    const refreshNow = (): void => {
      void refreshCards(api).then(result => { if (result.ok) setView(result.view) }, () => { /* keep the last reading */ })
    }
    const schedule = (): void => {
      timer = setTimeout(() => {
        if (stopped) return
        if (document.visibilityState === 'visible') refreshNow()
        schedule()
      }, interval)
    }
    schedule()
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
  }, [enabled, api, refreshMinutes])

  const railOpen = open && !wide
  const pos = useAnchoredPosition({ open: railOpen, anchorRef, panelRef, side: 'top', align: 'start', gap: 8, margin: 12 })
  useDismissOnOutsidePointer(anchorRef, railOpen, setOpen, panelRef)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const refresh = async (): Promise<void> => {
    if (api === undefined || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await refreshCards(api)
      if (!result.ok) { setError(result.error); return }
      const previous = viewRef.current?.cards ?? []
      setView(result.view)
      setNotice(unchangedReads(previous, result.view.cards) ? t('notReread') : '')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const expand = (): void => {
    setOpen(true)
    if (api === undefined) return
    void loadCards(api).then(setView, () => { /* keep the last reading */ })
  }
  const collapse = (): void => { setOpen(false); setNotice('') }
  const toggle = (): void => { if (open) collapse(); else expand() }

  if (enabled !== true) return null

  const now = Date.now()
  const cards = view?.cards ?? []
  const rows = sidebarRows(cards, windows)
  const latest = cards.map(cardReadTime).filter((value): value is string => typeof value === 'string').sort().at(-1)
  const status = statusText(view, error)
  const head = (): ReactNode => h('div', { className: 'dmg-sidebar-head', onClick: toggle },
    h('span', { className: 'dmg-sidebar-bird', 'aria-hidden': true }),
    h('span', { className: 'dmg-sidebar-title' }, t('sidebarTitle')),
    latest === undefined ? null : h('span', { className: 'dmg-sidebar-fresh' }, ageText(latest, now)),
    refreshButton(refresh, busy),
    h('button', {
      type: 'button', className: 'dmg-sidebar-icon', 'data-dmg-sidebar-toggle': '',
      'aria-label': open ? t('sidebarCollapse') : t('sidebarExpand'), 'aria-expanded': open,
      title: open ? t('sidebarCollapse') : t('sidebarExpand'),
    }, chevron(open)),
  )

  if (!wide) {
    return h(Fragment, null,
      h('button', {
        type: 'button', className: 'dmg-sidebar-rail is-button', 'data-dmg-sidebar-rail': '',
        ref: (node: HTMLElement | null): void => { anchorRef.current = node },
        title: t('sidebarTitle'), 'aria-label': t('sidebarTitle'), 'aria-haspopup': 'dialog', 'aria-expanded': open,
        onClick: () => { if (open) setOpen(false); else expand() },
      }, h('span', { className: 'dmg-sidebar-bird', 'aria-hidden': true })),
      open ? createPortal(h('div', {
        ref: panelRef, className: 'dmg-sidebar-popover', role: 'dialog', 'aria-label': t('sidebarTitle'), 'data-dmg-sidebar-popover': '',
        style: { ...(pos ?? { visibility: 'hidden' as const, left: 0, top: 0 }), width: RAIL_POPOVER_WIDTH },
      }, head(), h('div', { className: 'dmg-sidebar-rule', 'aria-hidden': true }),
      notice !== '' ? h('p', { className: 'dmg-sidebar-status', role: 'status' }, notice) : null,
      detail(cards, now, status)), document.body) : null,
    )
  }

  return h('div', { className: 'dmg-sidebar', 'data-dmg-sidebar': '', 'data-open': open },
    h('div', { className: 'dmg-sidebar-card' },
      head(),
      open
        ? h(Fragment, null,
          notice !== '' ? h('p', { className: 'dmg-sidebar-status', role: 'status' }, notice) : null,
          h('div', {
            className: 'dmg-sidebar-detail', 'data-dmg-sidebar-expanded': '',
            ref: (node: HTMLDivElement | null): void => { detailRef.current = node },
            onScroll: () => { setDetailOverflow(overflows(detailRef.current)); setDetailMore(belowFold(detailRef.current)) },
          }, detail(cards, now, status)),
          detailOverflow ? h('div', {
            className: `dmg-sidebar-more${detailMore ? '' : ' is-hidden'}`, 'aria-hidden': true, 'data-dmg-sidebar-more': '',
          }, doubleChevron()) : null,
        )
        : h(Fragment, null,
          h('div', {
            className: `dmg-sidebar-body${bodyMore ? ' is-scroll' : ''}`,
            ref: (node: HTMLDivElement | null): void => { bodyRef.current = node },
            onScroll: () => { setBodyOverflow(overflows(bodyRef.current)); setBodyMore(belowFold(bodyRef.current)) },
          },
            status !== undefined
              ? h('p', { className: 'dmg-sidebar-status', role: 'status' }, status)
              : rows.map(row => compactRow(row, now)),
          ),
          bodyOverflow ? h('div', {
            className: `dmg-sidebar-more${bodyMore ? '' : ' is-hidden'}`, 'aria-hidden': true, 'data-dmg-sidebar-more': '',
          }, doubleChevron()) : null,
        ),
    ),
  )
}

/**
 * One upstream block. A single window keeps the dense one-line row
 * (`Claude (7 days) · 11/20 11:00 · 20%`); several configured windows become a
 * name heading with one line per window, each with its own bar. A failed card
 * and a balance-only card stay single-line.
 */
function compactRow(row: SidebarRow, now: number): ReactNode {
  const attrs = { className: 'dmg-sidebar-row', 'data-dmg-sidebar-row': row.card.provider, key: cardIdentity(row.card) }
  const name = h('span', { className: 'dmg-sidebar-name' }, row.card.name ?? row.card.provider)
  if (row.failed) {
    return h('div', attrs,
      h('div', { className: 'dmg-sidebar-row-line' },
        h('span', { className: 'dmg-sidebar-label' }, name),
        h('span', { className: 'dmg-sidebar-pct', 'data-reading': '' }, t('usageReadingFailed'))))
  }
  if (row.windows.length === 0) {
    return h('div', attrs,
      h('div', { className: 'dmg-sidebar-row-line' },
        h('span', { className: 'dmg-sidebar-label' }, name),
        h('span', {
          className: 'dmg-sidebar-pct', 'data-reading': '', 'data-balance': '',
          ...(row.balance === undefined ? {} : { title: `${t('usageBalance')} ${row.balance}` }),
        }, row.balance ?? '—')))
  }
  if (row.windows.length === 1) {
    const only = row.windows[0]!
    return h('div', attrs,
      h('div', { className: 'dmg-sidebar-row-line' },
        h('span', { className: 'dmg-sidebar-label' }, name, windowLabel(only, true)),
        expiry(only.window, now),
        reading(only)),
      bar(only))
  }
  return h('div', { ...attrs, className: 'dmg-sidebar-row is-multi', 'data-dmg-sidebar-multi': '' },
    h('div', { className: 'dmg-sidebar-group-name' }, row.card.name ?? row.card.provider),
    ...row.windows.map((window, index) => h(Fragment, { key: index },
      h('div', { className: 'dmg-sidebar-win-row', 'data-dmg-sidebar-tier': window.kind },
        h('span', { className: 'dmg-sidebar-win-label', ...windowTitle(window) }, window.window.name ?? '—'),
        expiry(window.window, now),
        reading(window)),
      bar(window))))
}

/** The gateway's own window name, in brackets next to the account on single-line rows. */
function windowLabel(row: SidebarWindowRow, parens: boolean): ReactNode {
  if (row.window.name === undefined) return null
  return h('span', {
    className: 'dmg-sidebar-window', 'data-dmg-sidebar-tier': row.kind, ...windowTitle(row),
  }, parens ? `(${row.window.name})` : row.window.name)
}

const windowTitle = (row: SidebarWindowRow): { title?: string } =>
  row.fallback && row.window.name !== undefined ? { title: t('sidebarWindowFallbackTitle', { window: row.window.name }) } : {}

/** Absolute reset deadline; the full timestamp stays in `title`, and a missing one shows `—`. */
function expiry(window: CardWindow, now: number): ReactNode {
  const resetsAt = window.resetsAt
  const label = resetsAt === undefined ? undefined : formatResetDeadline(resetsAt, now)
  if (resetsAt === undefined || label === undefined) {
    // Some windows (an unused rolling 5-hour one, for instance) carry no reset
    // time; a dash keeps the column honest instead of looking like a layout bug.
    return h('span', {
      className: 'dmg-sidebar-expiry is-unknown', 'data-dmg-sidebar-expiry': '', 'data-unknown': '',
      title: t('sidebarResetUnknown'),
    }, '—')
  }
  return h('span', { className: 'dmg-sidebar-expiry', 'data-dmg-sidebar-expiry': '', title: `${t('usageResetAt')}${formatTime(resetsAt)}` }, label)
}

/** Does this scroll container scroll at all? */
const overflows = (element: HTMLElement | null): boolean =>
  element !== null && element.scrollHeight - element.clientHeight > 1

/** Does this scroll container still have content below the fold? */
const belowFold = (element: HTMLElement | null): boolean =>
  element !== null && element.scrollHeight - element.scrollTop - element.clientHeight > 1

const reading = (row: SidebarWindowRow): ReactNode =>
  h('span', {
    className: 'dmg-sidebar-pct', 'data-reading': '',
    ...(row.used === undefined ? {} : { 'data-level': usedLevel(row.used) }),
  }, windowReading(row))

const bar = (row: SidebarWindowRow): ReactNode =>
  row.used === undefined ? null : h('div', { className: 'dmg-sidebar-bar', 'aria-hidden': true },
    h('i', { 'data-level': usedLevel(row.used), style: { width: `${row.used}%` } }))

/** Expanded content: every upstream with every window, reset, balance and error. */
function detail(cards: Card[], now: number, status: string | undefined): ReactNode {
  if (status !== undefined) return h('p', { className: 'dmg-sidebar-status', role: 'status' }, status)
  return h(Fragment, null, ...cards.map(card => h('section', {
    className: 'dmg-sidebar-prov', 'data-provider': card.provider, key: cardIdentity(card),
  },
  h('div', { className: 'dmg-sidebar-prov-head' },
    h('strong', null, card.name ?? card.provider),
    h('span', { className: 'dmg-sidebar-meta' }, providerMeta(card, now)),
  ),
  card.error !== undefined
    ? h('p', { className: 'dmg-sidebar-error' }, card.error)
    : (card.windows ?? []).map((window, index) => {
      const used = typeof window.used === 'number' && Number.isFinite(window.used) ? Math.min(100, Math.max(0, window.used)) : undefined
      const level = used === undefined ? undefined : usedLevel(used)
      return h('div', { className: 'dmg-sidebar-win', key: index },
        h('div', { className: 'dmg-sidebar-win-line' },
          h('span', { className: 'dmg-sidebar-win-name' }, window.name ?? '—'),
          h('span', { className: 'dmg-sidebar-pct', ...(level === undefined ? {} : { 'data-level': level }) }, windowReading(window)),
          resetShort(window.resetsAt, now) === undefined ? null : h('span', { className: 'dmg-sidebar-reset', title: window.resetsAt }, resetShort(window.resetsAt, now)),
        ),
        used === undefined ? null : h('div', { className: 'dmg-sidebar-bar', 'aria-hidden': true },
          h('i', { 'data-level': level, style: { width: `${used}%` } })),
      )
    }),
  card.resets !== undefined || card.balance !== undefined
    ? h('div', { className: 'dmg-sidebar-foot' },
      typeof card.resets?.count === 'number' ? h('span', null, resetLine(card.resets.count)) : null,
      card.resets?.until === undefined ? null : h('span', null, formatTime(card.resets.until)),
      card.balance === undefined ? null : h('span', null, t('usageBalance'), ' ', h('b', null, String(card.balance))),
    ) : null,
  )))
}

const statusText = (view: CardsView | undefined, error: string): string | undefined => {
  if (error !== '') return t('usageError')
  if (view === undefined) return t('usageReading')
  if (view.status === 'forbidden') return t('usageForbidden')
  if (view.status === 'unconfigured') return t('usageUnconfigured')
  if (view.status === 'error') return view.error ?? t('usageError')
  if (view.cards.length === 0) return t('usageEmpty')
  return undefined
}

const providerMeta = (card: Card, now: number): string => {
  const parts: string[] = []
  if (card.plan !== undefined) parts.push(card.plan)
  const read = cardReadTime(card)
  if (read !== undefined) {
    const age = ageText(read, now)
    if (card.asOf !== undefined) parts.push(`${t('usageReadAtStale')} ${formatTime(read)}`)
    else parts.push(age ?? formatTime(read))
  }
  return parts.join(' · ')
}

const resetShort = (resetsAt: string | undefined, now: number): string | undefined => formatResetShort(resetsAt, now)

const resetLine = (count: number): string => count === 1 ? t('resetCountLineOne') : t('resetCountLineMany', { n: count })

const windowReading = (window: { used?: number; display?: string; unlimited?: boolean }): string => {
  if (window.unlimited === true) return t('unlimited')
  if (window.display !== undefined && window.display !== '') return window.display
  if (typeof window.used === 'number' && Number.isFinite(window.used)) return formatUsed(Math.min(100, Math.max(0, window.used)))
  return '—'
}
const ageText = (readAt: string, now: number): string | undefined => {
  const minutes = ageMinutes(readAt, now)
  if (minutes === undefined) return undefined
  if (minutes < 1) return t('sidebarJustNow')
  if (minutes < 60) return t('sidebarMinutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('sidebarHoursAgo', { n: hours })
  return t('sidebarDaysAgo', { n: Math.floor(hours / 24) })
}

const refreshButton = (refresh: () => Promise<void>, busy: boolean): ReactNode =>
  h('button', {
    type: 'button', className: 'dmg-sidebar-icon', 'data-dmg-sidebar-refresh': '', 'aria-label': t('refresh'), title: t('refresh'),
    disabled: busy, onClick: (event: { stopPropagation(): void }) => { event.stopPropagation(); void refresh() },
  }, refreshIcon())

const refreshIcon = (): ReactNode => h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', 'aria-hidden': true },
  h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }), h('path', { d: 'M13 2.4V5h-2.6' }))
const chevron = (open: boolean): ReactNode => h('svg', {
  viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', 'aria-hidden': true,
  className: `dmg-sidebar-chevron${open ? ' is-open' : ''}`,
}, h('path', { d: 'M4 6.5l4 4 4-4' }))
const doubleChevron = (): ReactNode => h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', 'aria-hidden': true },
  h('path', { d: 'M4 6l4 4 4-4' }), h('path', { d: 'M4 10l4 4 4-4', opacity: '.55' }))
