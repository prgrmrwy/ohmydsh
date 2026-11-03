import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, type Api } from './api.js'
import { settingsCss } from './styles.js'
import { t } from './locales.js'
import { loadCards, refreshCards } from './sidebar-api.js'
import { hydrateSidebarPreference, readSidebarPreference, subscribeSidebarPreference } from './sidebar-preference.js'
import {
  ageMinutes, cardIdentity, cardReadTime, formatResetShort, formatUsed, sidebarRows, unchangedReads, usedLevel,
  type SidebarRow,
} from './sidebar-view.js'
import { formatTime, type Card, type CardsView } from './view-model.js'

/**
 * Sidebar usage card (`sidebar.footer.action`, owner prop `wide`).
 *
 * Wide sidebar: a dense resident card with one weekly row per upstream (at most
 * five visible), a double-chevron when more exist, and a single refresh.
 * Clicking it grows the same card upward in place; the resident card keeps its
 * flow slot so the session list never shrinks. Collapsed sidebar: one icon that
 * opens the same content as a 320px anchored popover.
 *
 * Reads are event-driven through `sidebar-api` (60s TTL); no timers.
 */
export interface SidebarUsageProps {
  api?: Api
  wide?: boolean
}

const MAX_ROWS = 5
const RAIL_POPOVER_WIDTH = 320

export function SidebarUsage({ api, wide = true }: SidebarUsageProps) {
  const [enabled, setEnabled] = useState<boolean | undefined>(() => readSidebarPreference())
  const [view, setView] = useState<CardsView | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const anchorRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [bodyMax, setBodyMax] = useState<number | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<CardsView | undefined>(undefined)
  viewRef.current = view

  // Follow the host preference (hydrated once per page, then kept live by the
  // settings toggle through the module store).
  useEffect(() => {
    const unsubscribe = subscribeSidebarPreference(value => setEnabled(value))
    void hydrateSidebarPreference(api).then(() => setEnabled(readSidebarPreference()))
    return unsubscribe
  }, [api])

  useEffect(() => {
    if (enabled !== true || api === undefined) return
    let alive = true
    void loadCards(api).then(next => { if (alive) setView(next) }, reason => { if (alive) setError(errorText(reason)) })
    return () => { alive = false }
  }, [enabled, api])

  // Show exactly MAX_ROWS rows: measure the fifth row's bottom instead of
  // assuming a per-row height (host font metrics and rows without a bar differ).
  useLayoutEffect(() => {
    const element = bodyRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const fifth = element.children[MAX_ROWS - 1]
      if (element.children.length <= MAX_ROWS || !(fifth instanceof HTMLElement)) { setBodyMax(undefined); return }
      const height = Math.round(fifth.getBoundingClientRect().bottom - element.getBoundingClientRect().top)
      if (height > 0) setBodyMax(height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of Array.from(element.children)) if (child instanceof HTMLElement) observer.observe(child)
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

  if (enabled !== true) return null

  const now = Date.now()
  const cards = view?.cards ?? []
  const rows = sidebarRows(cards)
  const latest = cards.map(cardReadTime).filter((value): value is string => typeof value === 'string').sort().at(-1)
  const status = statusText(view, error)
  const style = h('style', null, settingsCss)
  const head = (onCollapse: boolean): ReactNode => h('div', { className: 'dmg-sidebar-head', ...(onCollapse ? {} : { onClick: expand }) },
    h('span', { className: 'dmg-sidebar-bird', 'aria-hidden': true }),
    h('span', { className: 'dmg-sidebar-title' }, t('sidebarTitle')),
    latest === undefined ? null : h('span', { className: 'dmg-sidebar-fresh' }, ageText(latest, now)),
    refreshButton(refresh, busy),
    onCollapse
      ? h('button', { type: 'button', className: 'dmg-sidebar-icon', 'aria-label': t('sidebarCollapse'), 'data-dmg-sidebar-close': '', onClick: collapse }, closeIcon())
      : null,
  )

  if (!wide) {
    return h(Fragment, null,
      style,
      h('button', {
        type: 'button', className: 'dmg-sidebar-rail is-button', 'data-dmg-sidebar-rail': '',
        ref: (node: HTMLElement | null): void => { anchorRef.current = node },
        title: t('sidebarTitle'), 'aria-label': t('sidebarTitle'), 'aria-haspopup': 'dialog', 'aria-expanded': open,
        onClick: () => { if (open) setOpen(false); else expand() },
      }, h('span', { className: 'dmg-sidebar-bird', 'aria-hidden': true })),
      open ? createPortal(h('div', {
        ref: panelRef, className: 'dmg-sidebar-popover', role: 'dialog', 'aria-label': t('sidebarTitle'), 'data-dmg-sidebar-popover': '',
        style: { ...(pos ?? { visibility: 'hidden' as const, left: 0, top: 0 }), width: RAIL_POPOVER_WIDTH },
      }, head(false), h('div', { className: 'dmg-sidebar-rule', 'aria-hidden': true }),
      notice !== '' ? h('p', { className: 'dmg-sidebar-status', role: 'status' }, notice) : null,
      detail(cards, now, status)), document.body) : null,
    )
  }

  const scrollable = rows.length > MAX_ROWS
  return h('div', { className: 'dmg-sidebar', 'data-dmg-sidebar': '', 'data-open': open },
    style,
    h('div', { className: 'dmg-sidebar-slot' },
      h('div', { className: 'dmg-sidebar-card', ...(open ? { style: { visibility: 'hidden' as const }, 'aria-hidden': true } : {}) },
        head(false),
        h('div', {
          className: `dmg-sidebar-body${scrollable ? ' is-scroll' : ''}`, role: 'button', tabIndex: 0,
          ref: (node: HTMLDivElement | null): void => { bodyRef.current = node },
          ...(bodyMax === undefined ? {} : { style: { maxHeight: bodyMax } }),
          'aria-expanded': open, 'aria-label': t('sidebarExpand'),
          onClick: expand,
          onKeyDown: (event: { key: string; preventDefault(): void }) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); expand() } },
        },
          status !== undefined
            ? h('p', { className: 'dmg-sidebar-status', role: 'status' }, status)
            : rows.map(row => compactRow(row)),
        ),
        scrollable ? h('div', {
          className: 'dmg-sidebar-more', role: 'button', tabIndex: 0, 'data-dmg-sidebar-more': '', 'aria-label': t('sidebarExpand'),
          onClick: expand,
          onKeyDown: (event: { key: string; preventDefault(): void }) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); expand() } },
        }, doubleChevron()) : null,
      ),
      open ? h('div', { className: 'dmg-sidebar-expanded', role: 'dialog', 'aria-label': t('sidebarTitle'), 'data-dmg-sidebar-expanded': '' },
        head(true),
        h('div', { className: 'dmg-sidebar-rule', 'aria-hidden': true }),
        notice !== '' ? h('p', { className: 'dmg-sidebar-status', role: 'status' }, notice) : null,
        h('div', { className: 'dmg-sidebar-detail' }, detail(cards, now, status)),
      ) : null,
    ),
  )
}

/** One compact row: name, weekly window, reading, bar (or the failure text). */
function compactRow(row: SidebarRow): ReactNode {
  const reading = rowReading(row)
  const level = row.used === undefined || row.failed ? undefined : usedLevel(row.used)
  return h('div', { className: 'dmg-sidebar-row', 'data-dmg-sidebar-row': row.card.provider, key: cardIdentity(row.card) },
    h('div', { className: 'dmg-sidebar-row-line' },
      h('span', { className: 'dmg-sidebar-name' }, row.card.name ?? row.card.provider),
      row.failed || row.window?.name === undefined ? null : h('span', { className: 'dmg-sidebar-window' }, row.window.name),
      h('span', { className: 'dmg-sidebar-pct', 'data-reading': '', ...(level === undefined ? {} : { 'data-level': level }) }, reading),
    ),
    row.failed || row.used === undefined
      ? null
      : h('div', { className: 'dmg-sidebar-bar', 'aria-hidden': true },
        h('i', { ...(level === undefined ? {} : { 'data-level': level }), style: { width: `${row.used}%` } })),
  )
}

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
const rowReading = (row: SidebarRow): string => {
  if (row.failed) return t('usageReadingFailed')
  return windowReading({ ...(row.used === undefined ? {} : { used: row.used }), ...(row.display === undefined ? {} : { display: row.display }), ...(row.unlimited === true ? { unlimited: true } : {}) })
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
const closeIcon = (): ReactNode => h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', 'aria-hidden': true },
  h('path', { d: 'M4 4l8 8M12 4l-8 8' }))
const doubleChevron = (): ReactNode => h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', 'aria-hidden': true },
  h('path', { d: 'M4 6l4 4 4-4' }), h('path', { d: 'M4 10l4 4 4-4', opacity: '.55' }))
